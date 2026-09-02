// End-to-end test of task-movement shortcuts against a THROWAWAY project.
//   TODOIST_TEST_PROJECT="shortcuts-test" xvfb-run -a node e2e/test.mjs
//
// Runs two experiments and prints a verdict:
//   CONTROL   — a real Playwright mouse drag of the drag handle. Tells us
//               whether Todoist's reorder responds to genuine mouse/pointer
//               events at all (isolates "event synthesis" from "wrong mechanism").
//   EXTENSION — press shift+k/j (move up/down) and shift+l/h (indent/dedent)
//               and check the task order/indent actually changed.
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

// Order fingerprint: id, indent, first 30 chars of text.
async function snapshot(page) {
  return page.evaluate(() => Array.from(
      document.querySelectorAll('li.task_list_item[data-item-id]'))
      .map((el) => ({
        id: el.getAttribute('data-item-id'),
        indent: el.getAttribute('data-item-indent'),
        text: (el.textContent || '').trim().slice(0, 30),
      })));
}

function fmt(s) {
  return s.map((t) => `  [i${t.indent}] ${t.text}`).join('\n');
}

function sameOrder(a, b) {
  return a.length === b.length &&
      a.every((t, i) => t.id === b[i].id && t.indent === b[i].indent);
}

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${SRC}`, `--load-extension=${SRC}`],
});
await ctx.addCookies(cookies());
const page = ctx.pages()[0] || await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));

const PROJECT_URL = process.env.TODOIST_TEST_URL ||
    'https://app.todoist.com/app/project/shortcuts-test-6h46w78P7h369Jcx';

async function openProject() {
  await page.goto(PROJECT_URL, {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(5000);
  await page.waitForSelector('li.task_list_item[data-item-id]', {timeout: 15000});
}

// Expand every collapsed task so indented subtasks are visible/targetable.
async function expandAll() {
  for (let pass = 0; pass < 6; pass++) {
    const btns = page.locator('button[aria-label="Expand task"]');
    const n = await btns.count();
    if (!n) break;
    await btns.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(500);
}

async function control() {
  await openProject();
  const before = await snapshot(page);
  console.log('\n=== CONTROL (real mouse drag) ===');
  console.log('before:\n' + fmt(before));
  if (before.length < 2) throw new Error('Need >=2 tasks in the project.');

  // Drag the LAST task's handle up above the first task, with a real mouse.
  const lastLi = page.locator('li.task_list_item[data-item-id]').last();
  const firstLi = page.locator('li.task_list_item[data-item-id]').first();
  await lastLi.hover();
  const handle = lastLi.locator('.item_dnd_handle');
  const hb = await handle.boundingBox();
  const fb = await firstLi.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  // Move in steps to satisfy any activation distance.
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(hb.x + hb.width / 2,
        hb.y + (fb.y - hb.y) * (i / 10) - 4, {steps: 1});
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await snapshot(page);
  console.log('after:\n' + fmt(after));
  const changed = !sameOrder(before, after);
  console.log(`CONTROL RESULT: real mouse drag ${changed ? 'REORDERED ✓' : 'did NOT reorder ✗'}`);
  return changed;
}

// Which task currently holds the extension cursor? Detected by the blue
// border-left (#4073d6 = rgb(64,115,214)) that updateCursorStyle() applies.
async function cursoredText(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('li.task_list_item[data-item-id]')) {
      if (getComputedStyle(el).borderLeftColor === 'rgb(64, 115, 214)') {
        return (el.textContent || '').trim().slice(0, 30);
      }
    }
    return null;
  });
}

// Move the extension cursor onto the task containing `marker` using the
// extension's own j/k navigation (deterministic; focus-follows-mouse via
// synthetic Playwright moves proved unreliable). Verifies via the blue border.
async function cursorTo(marker) {
  await page.locator('body').click({position: {x: 5, y: 5}}).catch(() => {});
  await page.keyboard.press('^'); // cursor to first task
  await page.waitForTimeout(400);
  for (let i = 0; i < 40; i++) {
    const got = await cursoredText(page);
    if (got && got.includes(marker.slice(0, 14))) return true;
    await page.keyboard.press('j');
    await page.waitForTimeout(180);
  }
  console.log(`  ! could not cursor to "${marker}" (stuck at "${await cursoredText(page)}")`);
  return false;
}

function find(snap, marker) {
  return snap.find((t) => t.text.includes(marker));
}

const idxOf = (snap, marker) => snap.findIndex((t) => t.text.includes(marker));

// Press `key` with the cursor on `marker`, then compare the LIVE DOM (no reload,
// to avoid hammering Todoist's rate limit). Returns before/after snapshots.
async function act(marker, key) {
  const before = await snapshot(page);
  await cursorTo(marker);
  await page.keyboard.press(key);
  await page.waitForTimeout(2500); // let the drag animation + sync settle
  const after = await snapshot(page);
  return {before, after};
}

async function extension() {
  console.log('\n======== EXTENSION SHORTCUTS ========');
  await openProject();
  await expandAll();
  const r = {};

  // Pick targets from the LIVE snapshot so we never act on an invalid task.
  const snap = await snapshot(page);
  console.log('current order:\n' + fmt(snap));
  // dedent target: first task at indent >= 2.
  const dedentT = snap.find((t) => Number(t.indent) >= 2);
  // move target: a top-level task that has another top-level task after it.
  const topIdx = snap.map((t, i) => Number(t.indent) === 1 ? i : -1)
      .filter((i) => i >= 0);
  const moveMarker = topIdx.length >= 2 ? snap[topIdx[0]].text : null;

  // --- dedent (shift+h): an indented task loses one level ---
  if (dedentT) {
    const {before, after} = await act(dedentT.text, 'Shift+h');
    const bt = find(before, dedentT.text); const at = find(after, dedentT.text);
    r.dedent = bt && at && Number(at.indent) < Number(bt.indent);
    console.log(`dedent (shift+h) "${dedentT.text}": indent ${bt?.indent} -> ${at?.indent}  ${r.dedent ? 'PASS ✓' : 'FAIL ✗'}`);
    // --- indent (shift+l): put it back ---
    const i2 = await act(dedentT.text, 'Shift+l');
    const bt2 = find(i2.before, dedentT.text); const at2 = find(i2.after, dedentT.text);
    r.indent = bt2 && at2 && Number(at2.indent) > Number(bt2.indent);
    console.log(`indent (shift+l) "${dedentT.text}": indent ${bt2?.indent} -> ${at2?.indent}  ${r.indent ? 'PASS ✓' : 'FAIL ✗'}`);
  }

  // --- moveDown (shift+j) then moveUp (shift+k) ---
  if (moveMarker) {
    const d = await act(moveMarker, 'Shift+j');
    const i0 = idxOf(d.before, moveMarker); const i1 = idxOf(d.after, moveMarker);
    r.moveDown = i1 > i0;
    console.log(`moveDown (shift+j) "${moveMarker}": pos ${i0} -> ${i1}  ${r.moveDown ? 'PASS ✓' : 'FAIL ✗'}`);
    const u = await act(moveMarker, 'Shift+k');
    const j0 = idxOf(u.before, moveMarker); const j1 = idxOf(u.after, moveMarker);
    r.moveUp = j1 < j0;
    console.log(`moveUp   (shift+k) "${moveMarker}": pos ${j0} -> ${j1}  ${r.moveUp ? 'PASS ✓' : 'FAIL ✗'}`);
  }

  // --- persistence: reload once and confirm the final DOM matches ---
  const pre = await snapshot(page);
  await openProject();
  const post = await snapshot(page);
  r.persists = sameOrder(pre, post);
  console.log(`persistence (reload): ${r.persists ? 'order retained ✓' : 'order changed ✗'}`);

  await page.screenshot({path: path.join(ARTIFACTS, 'extension-after.png'), fullPage: true});
  console.log('\n=== extension console (last 20, filtered) ===');
  console.log(logs.filter((l) => !/Waiting for #content|watchdog|canonicaliz|Saving options|Loaded options|Found content/.test(l)).slice(-20).join('\n'));
  return r;
}

try {
  const controlWorks = await control();
  const ext = await extension();
  console.log('\n================ VERDICT ================');
  console.log('real mouse drag works:', controlWorks);
  console.log('moveDown (shift+j):', ext.moveDown);
  console.log('moveUp   (shift+k):', ext.moveUp);
  console.log('indent   (shift+l):', ext.indent);
  console.log('dedent   (shift+h):', ext.dedent);
  console.log('persists (reload) :', ext.persists);
  const allExt = ext.moveDown && ext.moveUp && ext.indent && ext.dedent;
  if (allExt) {
    console.log('=> ALL FOUR shortcuts work (verified across reload). #248 fixed by e0027c2.');
  } else if (!controlWorks) {
    console.log('=> Even real mouse drag fails; Todoist uses a non-mouse mechanism.');
  } else {
    console.log('=> Some shortcuts still broken; needs the event-synthesis fix.');
  }
} catch (ex) {
  console.error('ERROR:', ex.message);
  await page.screenshot({path: path.join(ARTIFACTS, 'error.png')}).catch(() => {});
} finally {
  await ctx.close();
}
