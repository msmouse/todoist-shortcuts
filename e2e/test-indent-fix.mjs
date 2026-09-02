// Verify the moveIn/moveOut fix using id-based targeting (unambiguous).
//   xvfb-run -a node e2e/test-indent-fix.mjs
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
const list = (page) => page.evaluate(() => Array.from(
    document.querySelectorAll('li.task_list_item[data-item-id]'))
    .map((el) => ({id: el.getAttribute('data-item-id'),
      indent: el.getAttribute('data-item-indent'),
      text: (el.textContent || '').trim().slice(0, 26)})));
const indentById = (page, id) => page.evaluate((id) => {
  const el = document.querySelector(`li.task_list_item[data-item-id="${id}"]`);
  return el ? el.getAttribute('data-item-indent') : null;
}, id);
// data-item-id of the currently cursored task (blue left border).
const cursoredId = (page) => page.evaluate(() => {
  for (const el of document.querySelectorAll('li.task_list_item[data-item-id]'))
    if (getComputedStyle(el).borderLeftColor === 'rgb(64, 115, 214)')
      return el.getAttribute('data-item-id');
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

async function cursorToId(id) {
  await page.locator('body').click({position: {x: 5, y: 5}}).catch(() => {});
  await page.keyboard.press('^'); await page.waitForTimeout(400);
  for (let i = 0; i < 40; i++) {
    if ((await cursoredId(page)) === id) return true;
    await page.keyboard.press('j'); await page.waitForTimeout(160);
  }
  return false;
}
async function pressOn(id, key) {
  const ok = await cursorToId(id);
  const before = await indentById(page, id);
  const mark = logs.length;
  await page.keyboard.press(key);
  await page.waitForTimeout(3000);
  const after = await indentById(page, id);
  const relevant = logs.slice(mark).filter((l) =>
    !/Waiting for #content|watchdog|canonicaliz|Saving options|Loaded options: |Found content|CORS|ERR_FAILED|XMLHttpRequest/.test(l));
  return {ok, before, after, logs: relevant};
}

const s0 = await list(page);
console.log('order:\n' + s0.map((t) => `  [i${t.indent}] ${t.text} (${t.id})`).join('\n'));

// DEDENT: last task at indent>=2 (dedents cleanly).
const dedentT = [...s0].reverse().find((t) => Number(t.indent) >= 2);
// INDENT: a task at indent>=1 whose previous VISIBLE sibling is at >= its indent.
let indentT = null;
for (let i = 1; i < s0.length; i++) {
  if (Number(s0[i].indent) <= Number(s0[i - 1].indent)) { indentT = s0[i]; break; }
}

if (dedentT) {
  const r = await pressOn(dedentT.id, 'Shift+h');
  console.log(`\nDEDENT shift+h on "${dedentT.text}": cursor-ok=${r.ok} indent ${r.before} -> ${r.after} ${Number(r.after) < Number(r.before) ? 'PASS ✓' : 'FAIL ✗'}`);
  if (r.logs.length) console.log('  logs:', r.logs.join(' | '));
}
if (indentT) {
  const r = await pressOn(indentT.id, 'Shift+l');
  console.log(`\nINDENT shift+l on "${indentT.text}": cursor-ok=${r.ok} indent ${r.before} -> ${r.after} ${Number(r.after) > Number(r.before) ? 'PASS ✓' : 'FAIL ✗'}`);
  if (r.logs.length) console.log('  logs:', r.logs.join(' | '));
}
await ctx.close();
