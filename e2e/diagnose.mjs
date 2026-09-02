// Diagnose the live Todoist DOM + drag mechanism against a logged-in session.
//   xvfb-run -a node e2e/diagnose.mjs
import {chromium} from 'playwright';
import {fileURLToPath} from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'src');
const STORAGE = path.join(__dirname, 'storageState.json');
const ARTIFACTS = path.join(__dirname, 'artifacts');
const TEST_PROJECT = process.env.TODOIST_TEST_PROJECT || 'shortcuts-test';
fs.mkdirSync(ARTIFACTS, {recursive: true});

function cookies() {
  const raw = JSON.parse(fs.readFileSync(STORAGE, 'utf8'));
  return (raw.cookies || raw)
      .filter((c) => c && c.name && typeof c.value === 'string')
      .map((c) => ({
        name: c.name, value: c.value,
        domain: typeof c.domain === 'string' && c.domain ? c.domain : '.todoist.com',
        path: typeof c.path === 'string' && c.path ? c.path : '/',
        secure: true,
        sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      }));
}

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${SRC}`, `--load-extension=${SRC}`],
});
await ctx.addCookies(cookies());
const page = ctx.pages()[0] || await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));

// Instrument addEventListener BEFORE any app code runs.
await page.addInitScript(() => {
  window.__listened = {};
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, ...rest) {
    if (/pointer|mouse|drag/i.test(type)) {
      window.__listened[type] = (window.__listened[type] || 0) + 1;
    }
    return orig.call(this, type, ...rest);
  };
});

await page.goto('https://app.todoist.com/app', {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(6000);

// Dump sidebar links so we can see what's navigable.
const links = await page.evaluate(() => Array.from(
    document.querySelectorAll('a[href*="/app/project/"], nav a[href^="/app/"]'))
    .map((a) => `${(a.textContent || '').trim().slice(0, 30)} -> ${a.getAttribute('href')}`)
    .slice(0, 40));
console.log('=== sidebar links ===\n' + links.join('\n'));

// Navigate to the test project by clicking its sidebar link.
const link = page.getByRole('link', {name: new RegExp(TEST_PROJECT, 'i')}).first();
if (await link.count()) {
  await link.click();
  await page.waitForTimeout(4000);
} else {
  console.log(`(no sidebar link matched /${TEST_PROJECT}/i)`);
}
console.log('URL:', page.url());

const report = await page.evaluate(() => {
  const out = {};
  const sel = 'li[id^="task-"], [data-item-id], li.task_list_item, ' +
      '[data-testid="task-list-item"], li[data-item-id], div[data-item-id]';
  out.selectorUsed = sel;
  const items = Array.from(document.querySelectorAll(sel));
  out.taskCount = items.length;
  const first = items[0];
  if (first) {
    out.firstTaskTag = first.tagName;
    out.firstTaskAttrs = Array.from(first.attributes).map((a) => `${a.name}=${a.value}`);
    out.firstTaskClasses = first.className;
    // Candidate drag-handle probes.
    const probes = [
      '.item_dnd_handle', '[data-testid="task-drag-handle"]',
      '.drag_and_drop_handle', 'button.task_list_item__drag_handle',
      'span.drag_and_drop_handler', '[aria-label="Drag"]',
      '[aria-roledescription="sortable"]', '[draggable="true"]',
      '[data-drag-handle]', 'button[aria-label*="rag" i]',
    ];
    out.handleProbes = {};
    for (const p of probes) out.handleProbes[p] = first.querySelectorAll(p).length;
    out.firstTaskDraggable = first.getAttribute('draggable');
    out.firstTaskHTML = first.outerHTML.slice(0, 1600);
  }
  out.listened = window.__listened;
  // Task order fingerprint.
  out.order = items.slice(0, 12).map((el) => (el.textContent || '').trim().slice(0, 40));
  return out;
});

console.log('=== DIAGNOSE REPORT ===');
console.log(JSON.stringify(report, null, 2));
console.log('=== relevant page logs ===');
console.log(logs.filter((l) => !/Waiting for #content/.test(l)).slice(-25).join('\n'));
await page.screenshot({path: path.join(ARTIFACTS, 'diagnose.png'), fullPage: true});
fs.writeFileSync(path.join(ARTIFACTS, 'diagnose.json'), JSON.stringify(report, null, 2));
await ctx.close();
