# e2e harness

Automated testing of the extension against real Todoist, using Playwright +
headless Chromium under xvfb. Loads the unpacked `src/` extension (which *is*
the extension — there's no build step).

## Setup

1. Deps (already installed in the devcontainer):
   `npm i -D playwright && npx playwright install --with-deps chromium`
   plus `apt-get install -y xvfb xauth`.

2. A Todoist session. The session cookie is `httpOnly`, so `document.cookie`
   can't read it. Use the **Cookie-Editor** extension on an `app.todoist.com`
   tab → Export → Export as JSON → save as `e2e/storageState.json` (gitignored).
   The important cookies are `tduser` and `todoistd`.

3. A throwaway project. Set the URL:
   `export TODOIST_TEST_URL="https://app.todoist.com/app/project/<your-project>"`
   Populate it with a few flat tasks plus a nested hierarchy (Task → subtask →
   sub-subtask). **Only ever point this at a throwaway project — reorders and
   indent changes persist server-side.**

## Scripts

- `xvfb-run -a node e2e/harness.mjs smoke` — loads the extension against Todoist
  and confirms it injects + initializes without error. No login needed.
- `xvfb-run -a node e2e/verify-all.mjs` — regression test: drives
  `shift+j/k/h/l` and checks reorder + indent. Note it mutates (flattens) the
  scaffold as it runs, so re-nest the project between full runs.
- `xvfb-run -a node e2e/test-indent-fix.mjs` — focused, id-based check of
  indent (`shift+l`) and dedent (`shift+h`). Most reliable single check.
- `xvfb-run -a node e2e/drag-indent.mjs` — the diagnostic experiment that found
  the fix: a real mouse drag with live `data-item-indent` logging, proving
  Todoist changes indent by horizontal pointer position during an active drag.

Other scripts (`diagnose`, `native-*`, `focus-indent`, `persist-check`) are
investigation scaffolding kept for reference.

## How the cursor is driven

The extension uses focus-follows-mouse, but synthetic Playwright hovers proved
unreliable for setting its cursor. The scripts instead drive the extension's own
`^` (first task) + `j`/`k` navigation, and detect which task holds the cursor via
the blue left border (`rgb(64, 115, 214)`) that `updateCursorStyle()` applies.
