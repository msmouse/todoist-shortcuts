// Decisive test: can a REAL, careful mouse drag change a task's indent in
// current Todoist? Grab a subtask handle, initiate the drag, then sweep the
// pointer horizontally while logging the live indent at each step.
//   xvfb-run -a node e2e/drag-indent.mjs
import {chromium} from 'playwright';
import {fileURLToPath} from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
// Read indent of a specific task by its data-item-id.
const indentById = (page, id) => page.evaluate((id) => {
  const el = document.querySelector(`li.task_list_item[data-item-id="${id}"]`);
  return el ? el.getAttribute('data-item-indent') : null;
}, id);
const list = (page) => page.evaluate(() => Array.from(
    document.querySelectorAll('li.task_list_item[data-item-id]'))
    .map((el) => ({id: el.getAttribute('data-item-id'),
      indent: el.getAttribute('data-item-indent'),
      text: (el.textContent || '').trim().slice(0, 26)})));

const ctx = await chromium.launchPersistentContext('', {headless: false, args: []});
await ctx.addCookies(cookies());
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(PROJECT_URL, {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(6000);
await page.waitForSelector('li.task_list_item[data-item-id]', {timeout: 15000});
for (let i = 0; i < 6; i++) {
  const b = page.locator('button[aria-label="Expand task"]');
  if (!(await b.count())) break;
  await b.first().click().catch(() => {}); await page.waitForTimeout(400);
}

const s0 = await list(page);
console.log('order:\n' + s0.map((t) => `  [i${t.indent}] ${t.text} (${t.id})`).join('\n'));
// Target: the LAST subtask at indent 2 (H2c) — can indent (under H2b) or dedent.
const target = [...s0].reverse().find((t) => Number(t.indent) >= 2);
console.log('\ntarget:', target);
const li = page.locator(`li[data-item-id="${target.id}"]`);
await li.hover();
const handle = li.locator('.item_dnd_handle');
const hb = await handle.boundingBox();
const cx = hb.x + hb.width / 2; const cy = hb.y + hb.height / 2;

console.log('\n--- drag: initiate then sweep horizontally, logging indent ---');
await page.mouse.move(cx, cy);
await page.mouse.down();
// Initiate drag with a clear vertical nudge to pass activation threshold.
for (let dy = 2; dy <= 12; dy += 2) { await page.mouse.move(cx, cy + dy, {steps: 2}); await page.waitForTimeout(60); }
// Sweep RIGHT (indent deeper) then LEFT (dedent), staying at same vertical band.
const sweep = [10, 25, 40, 60, 80, 40, 0, -20, -40, -60, -80];
for (const dx of sweep) {
  await page.mouse.move(cx + dx, cy + 8, {steps: 4});
  await page.waitForTimeout(180);
  const ind = await indentById(page, target.id);
  const dragging = await page.evaluate((id) => {
    const el = document.querySelector(`li[data-item-id="${id}"]`);
    return el ? (el.className.match(/on_drag|dragging|is_dragging/) || ['-'])[0] : 'gone';
  }, target.id);
  console.log(`   dx=${String(dx).padStart(4)}  indent=${ind}  drag-class=${dragging}`);
}
await page.mouse.up();
await page.waitForTimeout(2000);
const after = await indentById(page, target.id);
console.log('\nfinal indent:', target.indent, '->', after,
    after !== target.indent ? 'DRAG-INDENT WORKS ✓' : 'no indent change ✗');
await page.screenshot({path: path.join(__dirname, 'artifacts', 'drag-indent.png')}).catch(() => {});
await ctx.close();
