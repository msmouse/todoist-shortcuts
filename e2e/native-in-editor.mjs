// Test whether Todoist's native Ctrl+]/Ctrl+[ change indent while the task's
// INLINE EDITOR is open (opened via the extension's own alt+click editor).
// Extension IS loaded so we can drive the cursor + open the editor with Enter.
//   xvfb-run -a node e2e/native-in-editor.mjs
import {chromium} from 'playwright';
import {fileURLToPath} from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'src');
const STORAGE = path.join(__dirname, 'storageState.json');
const PROJECT_URL = process.env.TODOIST_TEST_URL ||
    'https://app.todoist.com/app/project/shortcuts-test-6h46w78P7h369Jcx';

function cookies() {
  const raw = JSON.parse(fs.readFileSync(STORAGE, 'utf8'));
  return (raw.cookies || raw).filter((c) => c && c.name && typeof c.value === 'string')
      .map((c) => ({name: c.name, value: c.value,
        domain: typeof c.domain === 'string' && c.domain ? c.domain : '.todoist.com',
        path: '/', secure: true,
        sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'}));
}
const snap = (page) => page.evaluate(() => Array.from(
    document.querySelectorAll('li.task_list_item[data-item-id]'))
    .map((el) => ({indent: el.getAttribute('data-item-indent'),
      text: (el.textContent || '').trim().slice(0, 26)})));
const cursored = (page) => page.evaluate(() => {
  for (const el of document.querySelectorAll('li.task_list_item[data-item-id]'))
    if (getComputedStyle(el).borderLeftColor === 'rgb(64, 115, 214)')
      return (el.textContent || '').trim().slice(0, 26);
  return null;
});

const ctx = await chromium.launchPersistentContext('', {headless: false,
  args: [`--disable-extensions-except=${SRC}`, `--load-extension=${SRC}`]});
await ctx.addCookies(cookies());
const page = ctx.pages()[0] || await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
await page.goto(PROJECT_URL, {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(6000);
await page.waitForSelector('li.task_list_item[data-item-id]', {timeout: 15000});
for (let i = 0; i < 6; i++) {
  const b = page.locator('button[aria-label="Expand task"]');
  if (!(await b.count())) break;
  await b.first().click().catch(() => {}); await page.waitForTimeout(400);
}

const s0 = await snap(page);
console.log('order:\n' + s0.map((t) => `  [i${t.indent}] ${t.text}`).join('\n'));
const target = s0.find((t) => Number(t.indent) >= 2);
const key = target.text.slice(0, 14);
console.log('target:', target);

// Cursor to target via j-nav.
await page.locator('body').click({position: {x: 5, y: 5}}).catch(() => {});
await page.keyboard.press('^'); await page.waitForTimeout(400);
for (let i = 0; i < 40; i++) {
  if ((await cursored(page) || '').includes(key)) break;
  await page.keyboard.press('j'); await page.waitForTimeout(160);
}
console.log('cursor:', await cursored(page));

// Open inline editor via extension's Enter (alt+click .task_content).
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const editState = await page.evaluate(() => {
  const ae = document.activeElement;
  return {
    tag: ae && ae.tagName,
    editable: ae ? (ae.getAttribute('contenteditable') === 'true' ||
        !!ae.closest('[contenteditable="true"]') || ae.tagName === 'TEXTAREA') : false,
    editorsOnPage: document.querySelectorAll('[contenteditable="true"], textarea').length,
  };
});
console.log('editor state after Enter:', editState);

async function indentOf() {
  const s = await snap(page);
  const t = s.find((x) => x.text.includes(key));
  return t && t.indent;
}
console.log('\npress Control+[ (native dedent) in editor');
await page.keyboard.press('Control+BracketLeft');
await page.waitForTimeout(1500);
console.log('  indent', target.indent, '->', await indentOf());
console.log('press Control+] (native indent) in editor');
await page.keyboard.press('Control+BracketRight');
await page.waitForTimeout(1500);
console.log('  indent ->', await indentOf());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

console.log('\n--- recent logs ---');
console.log(logs.filter((l) => !/Waiting for #content|watchdog|canonicaliz|Saving options|Loaded options: |Found content/.test(l)).slice(-12).join('\n'));
await ctx.close();
