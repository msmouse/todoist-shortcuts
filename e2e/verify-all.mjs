// Consolidated end-to-end verification of all four task-movement shortcuts,
// id-based targeting, with a persistence-across-reload check.
//   xvfb-run -a node e2e/verify-all.mjs
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
const posOf = (snap, id) => snap.findIndex((t) => t.id === id);
const indOf = (snap, id) => (snap.find((t) => t.id === id) || {}).indent;
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
let sectionErrs = 0;
page.on('console', (m) => {
  if (/Failed to find section div/.test(m.text())) sectionErrs++;
});
async function open() {
  await page.goto(PROJECT_URL, {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(5500);
  await page.waitForSelector('li.task_list_item[data-item-id]', {timeout: 15000});
  for (let i = 0; i < 6; i++) {
    const b = page.locator('button[aria-label="Expand task"]');
    if (!(await b.count())) break;
    await b.first().click().catch(() => {}); await page.waitForTimeout(400);
  }
}
async function cursorToId(id) {
  await page.locator('body').click({position: {x: 5, y: 5}}).catch(() => {});
  await page.keyboard.press('^'); await page.waitForTimeout(400);
  for (let i = 0; i < 40; i++) {
    if ((await cursoredId(page)) === id) return true;
    await page.keyboard.press('j'); await page.waitForTimeout(150);
  }
  return false;
}
async function act(id, key) {
  await cursorToId(id);
  await page.keyboard.press(key);
  await page.waitForTimeout(2800);
  return list(page);
}

await open();
const results = {};

// moveDown / moveUp on a top-level task that has a top-level task after it.
let s = await list(page);
const tops = s.filter((t) => Number(t.indent) === 1);
const mover = tops[0];
{
  const after = await act(mover.id, 'Shift+j');
  results.moveDown = posOf(after, mover.id) > posOf(s, mover.id);
  const s2 = await list(page);
  const after2 = await act(mover.id, 'Shift+k');
  results.moveUp = posOf(after2, mover.id) < posOf(s2, mover.id);
}
// dedent (last indent>=2 task) then indent it back.
s = await list(page);
const dedentT = [...s].reverse().find((t) => Number(t.indent) >= 2);
if (dedentT) {
  const after = await act(dedentT.id, 'Shift+h');
  results.dedent = Number(indOf(after, dedentT.id)) < Number(dedentT.indent);
  const after2 = await act(dedentT.id, 'Shift+l');
  results.indent = Number(indOf(after2, dedentT.id)) > Number(indOf(after, dedentT.id));
}
// persistence: snapshot, reload, compare.
const pre = await list(page);
await open();
const post = await list(page);
results.persists = pre.length === post.length &&
    pre.every((t, i) => t.id === post[i].id && t.indent === post[i].indent);

console.log('\n================ VERIFY ALL ================');
console.log('moveDown (shift+j):', results.moveDown ? 'PASS ✓' : 'FAIL ✗');
console.log('moveUp   (shift+k):', results.moveUp ? 'PASS ✓' : 'FAIL ✗');
console.log('indent   (shift+l):', results.indent ? 'PASS ✓' : 'FAIL ✗');
console.log('dedent   (shift+h):', results.dedent ? 'PASS ✓' : 'FAIL ✗');
console.log('persists (reload) :', results.persists ? 'PASS ✓' : 'FAIL ✗');
console.log('(non-fatal "section div" errors seen:', sectionErrs, ')');
await ctx.close();
