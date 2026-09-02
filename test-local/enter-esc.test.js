// Local-only tests for the "Enter returns to the list" change and the Escape
// behavior it must not regress.
//
// Run under xvfb (MV3 extensions need a headed browser):
//   xvfb-run -a node --test "test-local/**/*.test.js"
//
// Requires a Todoist session in e2e/storageState.json and a THROWAWAY project
// (set TODOIST_TEST_URL). These tests add and complete tasks in that project.

const assert = require('node:assert');
const {after, before, beforeEach, describe, it} = require('node:test');

const h = require('./lib/harness');

const TIMEOUT = 120000;

describe('Enter / Escape in the inline task editor', {timeout: TIMEOUT}, () => {
  let ctx = null;
  let page = null;
  const marker = 'ts-local-' + Date.now();

  before(async () => {
    const opened = await h.open();
    ctx = opened.ctx;
    page = opened.page;
  });

  after(async () => {
    if (page) {
      // Remove every task any test in this file added.
      await h.completeTasksMatching(page, marker).catch(() => {});
    }
    if (ctx) await ctx.close();
  });

  // Tests share one page; start each from a clean, editor-free list.
  beforeEach(async () => {
    if (page) await h.resetToList(page);
  });

  it('adding a task with Enter closes the editor and returns to the list',
      async () => {
        const name = marker + '-add';
        await h.cursorToFirst(page);
        await h.typeInNewEditor(page, 'a', name);

        await page.keyboard.press('Enter');

        // The whole point of the change: no leftover "add another task" editor.
        assert.ok(await h.waitEditor(page, false),
            'editor should close after Enter, not stay open for the next task');
        assert.equal(await h.managerCount(page), 0);
        assert.equal(await h.editorFocused(page), false);
        // The task was still saved.
        assert.ok((await h.taskContents(page)).some((t) => t.includes(name)),
            'the typed task should have been added');
      });

  it('keyboard navigation still works after adding, without the mouse',
      async () => {
        const name = marker + '-nav';
        await h.cursorToFirst(page);
        await h.typeInNewEditor(page, 'a', name);
        await page.keyboard.press('Enter');
        assert.ok(await h.waitEditor(page, false), 'editor should close');

        // Regression guard for the reported focus loss: the cursor must return
        // to the list on its own (no mouse), and the keyboard must move it.
        const landed = await h.waitCursor(page);
        assert.ok(landed,
            'the cursor should return to the list after the editor closes, ' +
            'without moving the mouse (keyboard focus must not be lost)');

        // `a` adds at the bottom, so the cursor is on the last task; `k` moves
        // it up, proving keyboard navigation works with no mouse interaction.
        await page.keyboard.press('k');
        await h.sleep(600);
        const afterK = await h.cursorContent(page);
        assert.ok(afterK, 'k should keep a cursor on the list');
        assert.notEqual(afterK, landed, 'k should move the cursor off the added task');
      });

  it('inline-editing a task with Enter keeps the cursor on the edited task',
      async () => {
        const a = marker + '-editA';
        const b = marker + '-editB';
        // Seed two tasks so the edited one (A) has a task (B) right after it -
        // that is the task the "next task" bug would wrongly jump to.
        await h.cursorToFirst(page);
        await h.typeInNewEditor(page, 'a', a);
        await page.keyboard.press('Enter');
        assert.ok(await h.waitEditor(page, false), 'add A editor should close');
        await h.typeInNewEditor(page, 'a', b);
        await page.keyboard.press('Enter');
        assert.ok(await h.waitEditor(page, false), 'add B editor should close');

        // Edit A: cursor onto it, Enter opens the inline editor.
        assert.ok(await h.cursorTo(page, a), 'should find task A to edit');
        await page.keyboard.press('Enter');
        assert.ok(await h.waitEditorFocused(page), 'inline edit editor should open');
        await h.sleep(300);
        await page.keyboard.type(' EDITED');
        await h.sleep(300);

        await page.keyboard.press('Enter');

        assert.ok(await h.waitEditor(page, false),
            'inline edit should return to the list, not open a new task');
        assert.equal(await h.managerCount(page), 0);
        assert.ok((await h.taskContents(page)).some((t) => t.includes(a + ' EDITED')),
            'the edit should have been saved');
        // The cursor must stay on the edited task, not jump to the next one.
        const cur = await h.waitCursor(page);
        assert.ok(cur && cur.includes('editA'),
            'the cursor should stay on the edited task, but was on: ' + cur);
        assert.ok(!cur.includes('editB'),
            'the cursor must not jump to the next task');
      });

  it('Escape closes the editor and leaves keyboard navigation working',
      async () => {
        await h.cursorToFirst(page);
        assert.ok(await h.openEditor(page, 'a'), 'add editor should open');

        await page.keyboard.press('Escape');

        assert.ok(await h.waitEditor(page, false),
            'Escape should close the editor');
        // Same focus guard, for the Escape path.
        await page.keyboard.press('j');
        await h.sleep(600);
        assert.ok(await h.waitCursor(page),
            'j after Escape should move the cursor without the mouse');
      });

  it('Shift+Enter keeps the editor open (does not return to the list)',
      async () => {
        await h.cursorToFirst(page);
        await h.typeInNewEditor(page, 'a', marker + '-multiline line one');

        await page.keyboard.press('Shift+Enter');
        await h.sleep(1200);

        // The fix must ignore Shift+Enter: it is a newline, not a commit.
        assert.ok(await h.managerCount(page) > 0,
            'Shift+Enter should not close the editor');
        assert.equal(await h.editorFocused(page), true);

        // Discard the unsaved draft so it is not left behind.
        await page.keyboard.press('Escape');
        await h.waitEditor(page, false);
      });
});
