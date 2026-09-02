// Pure Todoist (NO extension). Open a subtask's inline editor via alt+click,
// then probe which key actually changes indent: Ctrl+]/[ , Tab/Shift+Tab.
//   xvfb-run -a node e2e/native-keys.mjs
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
const snap = (page) => page.evaluate(() => Array.from(
    document.querySelectorAll('li.task_list_item[data-item-id]'))
    .map((el) => ({indent: el.getAttribute('data-item-indent'),
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

const s0 = await snap(page);
console.log('order:\n' + s0.map((t) => `  [i${t.indent}] ${t.text}`).join('\n'));

// Open a task's inline editor by alt+clicking its content, return whether an
// editor is focused.
async function openEditor(marker) {
  const li = page.locator('li.task_list_item[data-item-id]', {hasText: marker}).first();
  await li.scrollIntoViewIfNeeded();
  const content = li.locator('.task_content, [data-testid="task-content"]').first();
  const box = await content.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const ae = document.activeElement;
    return ae ? (ae.getAttribute('contenteditable') === 'true' ||
        !!ae.closest('[contenteditable="true"]') || ae.tagName === 'TEXTAREA') : false;
  });
}
async function indentOf(marker) {
  const s = await snap(page);
  const t = s.find((x) => x.text.includes(marker));
  return t && t.indent;
}
async function probe(marker, keys) {
  const editable = await openEditor(marker);
  const before = await indentOf(marker);
  console.log(`\n"${marker}" editor=${editable} indent=${before}`);
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(1200);
    const now = await indentOf(marker);
    console.log(`   ${k.padEnd(18)} indent ${before} -> ${now} ${now !== before ? 'CHANGED ✓' : ''}`);
    if (now !== before) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); return k; }
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  return null;
}

// DEDENT candidate: last subtask (H2c) can always dedent to i1.
const dedentTarget = [...s0].reverse().find((t) => Number(t.indent) >= 2);
// INDENT candidate: a subtask that has a preceding sibling at same indent (H2b/H2c).
let indentTarget = null;
for (let i = 1; i < s0.length; i++) {
  if (Number(s0[i].indent) >= 2 && s0[i].indent === s0[i - 1].indent) { indentTarget = s0[i]; break; }
}

console.log('\n===== DEDENT probe (target=' + dedentTarget?.text + ') =====');
const dedentKey = dedentTarget && await probe(dedentTarget.text.slice(0, 14),
    ['Control+BracketLeft', 'Meta+BracketLeft', 'Shift+Tab']);
console.log('\n===== INDENT probe (target=' + indentTarget?.text + ') =====');
const indentKey = indentTarget && await probe(indentTarget.text.slice(0, 14),
    ['Control+BracketRight', 'Meta+BracketRight', 'Tab']);

console.log('\n================ RESULT ================');
console.log('native DEDENT key:', dedentKey || 'NONE FOUND');
console.log('native INDENT key:', indentKey || 'NONE FOUND');
await ctx.close();
