// Does Todoist's NATIVE ctrl+[ / ctrl+] indent shortcut work, and in what mode
// (task focused vs. inline-editing)? Decides the fix approach for moveIn/moveOut.
//   xvfb-run -a node e2e/native-indent.mjs
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

// DISABLE the extension for this test: we want to observe pure-Todoist behavior.
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
const target = s0.find((t) => Number(t.indent) >= 2);
console.log('target:', target);
const li = page.locator('li.task_list_item[data-item-id]',
    {hasText: target.text.slice(0, 14)}).first();

async function indentOf() {
  const s = await snap(page);
  const t = s.find((x) => x.text.includes(target.text.slice(0, 14)));
  return t && t.indent;
}

// Test 1: task focused (single click selects/opens), press Ctrl+[ to dedent.
console.log('\n[1] focus task, press Control+[ (dedent)');
await li.click();
await page.waitForTimeout(800);
await page.keyboard.press('Control+[');
await page.waitForTimeout(1500);
console.log('    indent', target.indent, '->', await indentOf());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Test 2: inline edit mode. Click the task title text to open the editor,
// then Control+[ / Control+].
console.log('\n[2] open inline editor, press Control+] (indent) then Control+[ (dedent)');
const content = li.locator('.task_content, [data-testid="task-content"]').first();
await content.click();
await page.waitForTimeout(1200);
const editing = await page.evaluate(() => !!document.activeElement &&
    (document.activeElement.getAttribute('contenteditable') === 'true' ||
     document.activeElement.closest('[contenteditable="true"]') !== null ||
     document.activeElement.tagName === 'TEXTAREA'));
console.log('    in editor:', editing);
const start = await indentOf();
await page.keyboard.press('Control+]');
await page.waitForTimeout(1200);
console.log('    after Control+] indent', start, '->', await indentOf());
await page.keyboard.press('Control+[');
await page.waitForTimeout(1200);
console.log('    after Control+[ indent ->', await indentOf());
await page.keyboard.press('Escape');

await ctx.close();
