// Playwright harness for todoist-shortcuts.
//
// Two modes:
//   node e2e/harness.mjs smoke
//     Loads the unpacked extension, opens todoist.com, and reports whether the
//     content script injected + the page-context code initialized. No login
//     needed; proves the extension loads without error.
//
//   node e2e/harness.mjs drive
//     Requires e2e/storageState.json (an authenticated Todoist session, see
//     README-e2e.md). Opens the app, finds the test project, and exercises
//     shift+k / shift+j / shift+l / shift+h, asserting the DOM reorders.
//
// Run headed under xvfb (MV3 extension loading is most reliable headed):
//   xvfb-run -a node e2e/harness.mjs smoke
import {chromium} from 'playwright';
import {fileURLToPath} from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'src');
const STORAGE = path.join(__dirname, 'storageState.json');
const ARTIFACTS = path.join(__dirname, 'artifacts');
const TEST_PROJECT = process.env.TODOIST_TEST_PROJECT || 'shortcuts-test';

const mode = process.argv[2] || 'smoke';
fs.mkdirSync(ARTIFACTS, {recursive: true});

async function launch() {
  // Persistent context is required to load an extension. Headed + xvfb.
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${SRC}`,
      `--load-extension=${SRC}`,
    ],
  });
  return ctx;
}

function wireLogging(page) {
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  return logs;
}

async function smoke() {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  const logs = wireLogging(page);
  await page.goto('https://todoist.com/app', {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(4000);
  // inject.js stamps this attribute on <body> before injecting the page code.
  const injected = await page.evaluate(() =>
    document.body.hasAttribute('data-todoist-shortcuts-options'));
  await page.screenshot({path: path.join(ARTIFACTS, 'smoke.png')});
  console.log('URL after load:', page.url());
  console.log('content script injected (body attr present):', injected);
  console.log('--- page console ---');
  console.log(logs.join('\n') || '(none)');
  await ctx.close();
  // On the marketing/login page the content script does NOT match, so injected
  // is expected false there. On /app while logged in it must be true.
  process.exit(0);
}

async function drive() {
  if (!fs.existsSync(STORAGE)) {
    console.error('Missing e2e/storageState.json — see e2e/README-e2e.md.');
    process.exit(2);
  }
  const ctx = await launch();
  const raw = JSON.parse(fs.readFileSync(STORAGE, 'utf8'));
  const cookies = (raw.cookies || raw)
      .filter((c) => c && c.name && typeof c.value === 'string')
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: typeof c.domain === 'string' && c.domain ? c.domain : '.todoist.com',
        path: typeof c.path === 'string' && c.path ? c.path : '/',
        secure: true,
        sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      }));
  console.log('loading cookies:', cookies.map((c) => c.name).join(', '));
  await ctx.addCookies(cookies);
  const page = ctx.pages()[0] || await ctx.newPage();
  const logs = wireLogging(page);
  await page.goto('https://todoist.com/app', {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(5000);

  const injected = await page.evaluate(() =>
    document.body.hasAttribute('data-todoist-shortcuts-options'));
  if (!injected) {
    await page.screenshot({path: path.join(ARTIFACTS, 'not-logged-in.png')});
    console.error('Not logged in / extension not injected. URL:', page.url());
    console.error(logs.join('\n'));
    await ctx.close();
    process.exit(3);
  }
  console.log('Logged in, extension injected. Open the test project manually or');
  console.log('extend this script to navigate + assert reorders. URL:', page.url());
  // TODO(step 3/4): navigate to TEST_PROJECT, snapshot task order, press keys,
  // assert order changed and survives reload. Left as a stub until a real
  // session is available to observe the live DOM.
  await page.screenshot({path: path.join(ARTIFACTS, 'app.png')});
  await ctx.close();
  process.exit(0);
}

if (mode === 'smoke') await smoke();
else if (mode === 'drive') await drive();
else {
  console.error('usage: node e2e/harness.mjs [smoke|drive]');
  process.exit(1);
}
