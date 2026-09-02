# test-local

Local-only tests for the **"Enter returns to the list"** change (and the Escape
behavior it must not regress). Kept separate from the upstream `test/` suite
because this change is not intended for upstream.

These tests cover:

- Adding a task with **Enter** closes the editor and returns to the list
  (instead of leaving Todoist's continuous-add editor open).
- The cursor comes back to the list and **`j`/`k` work without touching the
  mouse** — the regression guard for the reported focus loss.
- Inline-editing a task with **Enter** returns to the list.
- **Escape** still closes the editor and leaves keyboard navigation working.
- **Shift+Enter** inserts a newline and keeps the editor open (the fix must
  ignore it).

## Why not use the upstream `test/` harness?

`test/` uses puppeteer against a logged-in Chrome profile plus a Todoist API
token (`etc/test-token`). This devcontainer has none of those. These tests
instead reuse the working `e2e/` approach: Playwright with its bundled Chromium,
loading the unpacked `src/` extension, authenticated by the session in
`e2e/storageState.json`.

## Running

MV3 extensions only load in a headed browser, so run under xvfb:

```sh
xvfb-run -a node --test --test-concurrency=1 "test-local/**/*.test.js"
```

Requirements (same as `e2e/`, see `e2e/README-e2e.md`):

- `e2e/storageState.json` — a Todoist session (cookies `tduser` + `todoistd`),
  exported with the Cookie-Editor extension.
- A **throwaway** project. These tests add and complete tasks, which persist
  server-side:

  ```sh
  export TODOIST_TEST_URL="https://app.todoist.com/app/project/<your-project>"
  ```

  Defaults to the `shortcuts-test` project if unset. The project needs a couple
  of existing tasks for cursor navigation. Tasks added by a run are named with a
  unique `ts-local-<timestamp>` prefix and completed in the suite's teardown.
