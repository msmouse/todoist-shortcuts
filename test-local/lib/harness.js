// Playwright harness for the local-only tests in this folder.
//
// These tests are NOT part of the upstream suite (which uses puppeteer + a
// logged-in profile + an API token, none of which exist in this devcontainer).
// They drive the real extension against a live Todoist throwaway project using
// a session exported to e2e/storageState.json, exactly like the e2e/ scripts.
//
// Because MV3 extensions only load in a headed browser, run these under xvfb:
//   xvfb-run -a node --test "test-local/**/*.test.js"
//
// Point them at a throwaway project (reorders/adds persist server-side):
//   export TODOIST_TEST_URL="https://app.todoist.com/app/project/<id>"

const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const STORAGE = path.resolve(__dirname, '..', '..', 'e2e', 'storageState.json');
const PROJECT_URL = process.env.TODOIST_TEST_URL ||
    'https://app.todoist.com/app/project/shortcuts-test-6h46w78P7h369Jcx';

// The blue left border updateCursorStyle() paints on the cursored task.
const CURSOR_BORDER = 'rgb(64, 115, 214)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cookies() {
  const raw = JSON.parse(fs.readFileSync(STORAGE, 'utf8'));
  return (raw.cookies || raw)
      .filter((c) => c && c.name && typeof c.value === 'string')
      .map((c) => ({
        name: c.name, value: c.value,
        domain: typeof c.domain === 'string' && c.domain ? c.domain : '.todoist.com',
        path: '/', secure: true,
        sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      }));
}

// Launches Chrome with the unpacked extension and the Todoist session, opens
// the throwaway project and waits for tasks.  Returns {ctx, page, close}.
async function open() {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${SRC}`, `--load-extension=${SRC}`],
  });
  await ctx.addCookies(cookies());
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(PROJECT_URL, {waitUntil: 'domcontentloaded'});
  await sleep(6000);
  try {
    await page.waitForSelector('li.task_list_item[data-item-id]', {timeout: 15000});
  } catch (e) {
    throw new Error(
        'No tasks loaded at ' + page.url() + ' - the session in ' + STORAGE +
        ' may be expired, or the project is empty. Re-export cookies / set ' +
        'TODOIST_TEST_URL.');
  }
  return {ctx, page, close: () => ctx.close()};
}

const managerCount = (page) =>
  page.evaluate(() => document.querySelectorAll('li.manager').length);

const editorFocused = (page) =>
  page.evaluate(() => Boolean(document.querySelector('.ProseMirror-focused')));

async function waitEditor(page, wantOpen, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await managerCount(page);
    if (wantOpen ? n > 0 : n === 0) return true;
    await sleep(150);
  }
  return false;
}

async function waitEditorFocused(page, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await editorFocused(page)) return true;
    await sleep(120);
  }
  return false;
}

// Text of the task that currently holds the extension's cursor, or null.
const cursorContent = (page) => page.evaluate((border) => {
  for (const el of document.querySelectorAll('li.task_list_item[data-item-id]')) {
    if (getComputedStyle(el).borderLeftColor === border) {
      const c = el.querySelector('.task_content');
      return (c ? c.textContent : el.textContent || '').trim();
    }
  }
  return null;
}, CURSOR_BORDER);

// Waits until some task holds the cursor (Todoist briefly flickers the cursor
// off while it re-renders after a commit). Returns the cursor content or null.
async function waitCursor(page, ms = 3000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await cursorContent(page);
    if (last) return last;
    await sleep(150);
  }
  return last;
}

const taskContents = (page) => page.$$eval(
    'li.task_list_item[data-item-id] .task_content',
    (els) => els.map((e) => (e.textContent || '').trim()));

// Puts the cursor on the first task via the extension's own `^`.
async function cursorToFirst(page) {
  await page.locator('body').click({position: {x: 5, y: 5}}).catch(() => {});
  await page.keyboard.press('^');
  await sleep(400);
}

// Moves the cursor (via `^` then `j`) onto the first task whose content
// includes `substring`.  Returns whether it landed there.
async function cursorTo(page, substring, maxSteps = 40) {
  await cursorToFirst(page);
  for (let i = 0; i < maxSteps; i++) {
    const cur = await cursorContent(page);
    if (cur && cur.includes(substring)) return true;
    await page.keyboard.press('j');
    await sleep(150);
  }
  return (await cursorContent(page) || '').includes(substring);
}

// Presses `key` to open an inline editor and waits until it actually has
// focus. Retries once (a long, mutated list occasionally swallows the first
// press) after clearing any stray editor. Returns whether the editor is focused.
async function openEditor(page, key, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    await page.keyboard.press(key);
    if (await waitEditorFocused(page, 8000)) return true;
    await page.keyboard.press('Escape');
    await waitEditor(page, false, 3000);
    await sleep(300);
  }
  return false;
}

// Dismisses any open editor and puts the cursor back on the first task, so each
// test starts from a known state despite sharing one page.
async function resetToList(page) {
  await page.keyboard.press('Escape');
  await waitEditor(page, false, 3000);
  await cursorToFirst(page);
}

// Opens an editor with `key` (e.g. 'a', 'o'), waits until it has focus, types
// `content`, and returns.  Does not press Enter.
async function typeInNewEditor(page, key, content) {
  if (!await openEditor(page, key)) {
    throw new Error('editor never took focus after pressing ' + key);
  }
  await sleep(300);
  await page.keyboard.type(content);
  await sleep(300);
}

// Best-effort cleanup: completes every task whose content includes `marker`,
// so the throwaway project does not accumulate test tasks.  Completing (`d`)
// avoids Todoist's delete-confirmation modal.
async function completeTasksMatching(page, marker) {
  for (let i = 0; i < 20; i++) {
    const idx = await page.evaluate((m) => {
      const tasks = Array.from(
          document.querySelectorAll('li.task_list_item[data-item-id] .task_content'));
      return tasks.findIndex((t) => (t.textContent || '').includes(m));
    }, marker);
    if (idx < 0) return;
    await cursorToFirst(page);
    for (let j = 0; j < idx; j++) {
      await page.keyboard.press('j');
      await sleep(120);
    }
    await page.keyboard.press('d');
    await sleep(1200);
  }
}

module.exports = {
  PROJECT_URL, sleep, open,
  managerCount, editorFocused, waitEditor, waitEditorFocused,
  cursorContent, waitCursor, taskContents, cursorToFirst, cursorTo,
  openEditor, resetToList, typeInNewEditor,
  completeTasksMatching,
};
