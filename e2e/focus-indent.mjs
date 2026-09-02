// Isolated diagnostic for indent/dedent (moveIn/moveOut) only. Minimal API
// traffic so Todoist rate-limiting can't confound the result.
//   xvfb-run -a node e2e/focus-indent.mjs
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

const snap = (page) => page.evaluate(() => Array.from(
    document.querySelectorAll('li.task_list_item[data-item-id]'))
    .map((el) => ({
      indent: el.getAttribute('data-item-indent'),
      text: (el.textContent || '').trim().slice(0, 26),
    })));

const cursored = (page) => page.evaluate(() => {
  for (const el of document.querySelectorAll('li.task_list_item[data-item-id]')) {
    if (getComputedStyle(el).borderLeftColor === 'rgb(64, 115, 214)') {
      return {text: (el.textContent || '').trim().slice(0, 26),
        indent: el.getAttribute('data-item-indent')};
    }
  }
  return null;
});

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${SRC}`, `--load-extension=${SRC}`],
});
await ctx.addCookies(cookies());
const page = ctx.pages()[0] || await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));

await page.goto(PROJECT_URL, {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(6000);
await page.waitForSelector('li.task_list_item[data-item-id]', {timeout: 15000});

// Expand everything.
for (let i = 0; i < 6; i++) {
  const b = page.locator('button[aria-label="Expand task"]');
  if (!(await b.count())) break;
  await b.first().click().catch(() => {});
  await page.waitForTimeout(400);
}
await page.waitForTimeout(600);

// Cursor to the LAST indented (>=2) task via j-navigation (last child dedents
// cleanly; first-child dedent is a different Todoist case).
const s0 = await snap(page);
const target = [...s0].reverse().find((t) => Number(t.indent) >= 2);
console.log('order:\n' + s0.map((t) => `  [i${t.indent}] ${t.text}`).join('\n'));
console.log('target:', target);
await page.locator('body').click({position: {x: 5, y: 5}}).catch(() => {});
await page.keyboard.press('^');
await page.waitForTimeout(400);
let reached = false;
for (let i = 0; i < 40; i++) {
  const c = await cursored(page);
  if (c && c.text.includes(target.text.slice(0, 14))) { reached = true; break; }
  await page.keyboard.press('j');
  await page.waitForTimeout(180);
}
console.log('cursor reached target:', reached, '=>', await cursored(page));

const logMark = logs.length;
console.log('\n--- pressing shift+h (dedent) ---');
await page.keyboard.press('Shift+h');
await page.waitForTimeout(3000);
const c1 = await cursored(page);
const s1 = await snap(page);
const t1 = s1.find((t) => t.text.includes(target.text.slice(0, 14)));
console.log('cursor now:', c1);
console.log('target indent:', target.indent, '->', t1 && t1.indent,
    (t1 && t1.indent !== target.indent) ? 'DEDENT WORKED ✓' : 'NO CHANGE ✗');
console.log('\n--- extension logs emitted during the op ---');
console.log(logs.slice(logMark)
    .filter((l) => !/Waiting for #content|watchdog|canonicaliz|Saving options|Loaded options: |Found content/.test(l))
    .join('\n') || '(none)');

// CONTROL: real mouse drag to change indent. Start drag with a vertical nudge to
// pass the activation threshold, then move horizontally to change indent level.
console.log('\n--- CONTROL: real mouse horizontal drag on target ---');
const li = page.locator('li.task_list_item[data-item-id]',
    {hasText: target.text.slice(0, 14)}).first();
await li.hover();
const handle = li.locator('.item_dnd_handle');
const hb = await handle.boundingBox();
const cx = hb.x + hb.width / 2; const cy = hb.y + hb.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let dy = 3; dy <= 12; dy += 3) { // activate with vertical nudge
  await page.mouse.move(cx, cy + dy, {steps: 2}); await page.waitForTimeout(60);
}
await page.mouse.move(cx - 40, cy + 6, {steps: 8}); // dedent: drag left
await page.waitForTimeout(150);
await page.mouse.move(cx - 40, cy + 2, {steps: 3});
await page.mouse.up();
await page.waitForTimeout(2500);
const s2 = await snap(page);
const t2 = s2.find((t) => t.text.includes(target.text.slice(0, 14)));
console.log('real-drag indent:', target.indent, '->', t2 && t2.indent,
    (t2 && t2.indent !== target.indent) ?
      'REAL DRAG CHANGES INDENT ✓ (fixable via event synthesis)' :
      'real drag also no-op ✗ (Todoist may not support drag-indent; use native ctrl+[/])');

await ctx.close();
