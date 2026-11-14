// The performance budget of the caretaker's view (Z.1; CLAUDE.md rule 12; architecture §4): on a
// cheap phone in 3G, the notebook starts in under 2.5 s, its route loads under 200 kB gzip, and none
// of it carries the code of domain/finance. Measured on the production build, in the Chrome of the
// machine (playwright-core downloads no browser), every file fetched cold — no cache, no service worker.
// Run after `npx nx build web`: node tools/perf-budget.mjs
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';

export const BUDGET = Object.freeze({ startupMs: 2_500, routeBytes: 200 * 1024 });

/**
 * A phone of the field in 3G: the network of Chrome DevTools' « 3G » (562.5 ms of latency, 1.6 Mbit/s
 * down, 750 kbit/s up) and a processor four times slower than the machine's, as Lighthouse on mobile.
 */
export const FIELD_PHONE = Object.freeze({ latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, cpuSlowdown: 4 });

/** Strings only domain/finance writes: one of them in a caretaker file means money code reached the phone. */
export const FINANCE_MARKERS = Object.freeze(['OrderWithoutLines', 'CostTypeNotOrderable', 'NotASupplier']);

/** What breaks the budget, in words; empty when it holds. `starts`: each scenario's start, in ms. */
export function verdict({ starts, routeBytes, financeFiles }, budget = BUDGET) {
  const failures = [];
  for (const [scenario, startupMs] of Object.entries(starts)) {
    if (!(startupMs < budget.startupMs)) failures.push(`${scenario} : ${Math.round(startupMs)} ms, au-delà de ${budget.startupMs} ms en 3G.`);
  }
  if (!(routeBytes < budget.routeBytes)) failures.push(`Fichiers de la route gardien : ${kilobytes(routeBytes)} gzip, au-delà de ${kilobytes(budget.routeBytes)}.`);
  if (financeFiles.length > 0) failures.push(`Du code de domain/finance dans la vue gardien : ${financeFiles.join(', ')}.`);
  return failures;
}

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} Ko`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.png': 'image/png', '.opus': 'audio/ogg' };
const COMPRESSED = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg']);

// A caretaker signed in, on a site with a flock at day 12: what the notebook reads on opening.
const SESSION = { token: `x.${Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000051' })).toString('base64url')}.x`, expiresAt: '2099-01-01T00:00:00.000Z', role: 'collaborator', account: { name: 'Ousmane', avatar: 'baobab', language: 'fr' } };
const today = new Date().toISOString().slice(0, 10);
const CONTEXT = {
  chef: null,
  sites: [
    {
      siteId: '00000000-0000-4000-8000-000000000003',
      name: 'Poulailler Nord',
      timeZone: 'Africa/Dakar',
      today,
      primaryCaretakerId: '00000000-0000-4000-8000-000000000051',
      campaigns: [{ campaignId: '00000000-0000-4000-8000-000000000004', placementDay: new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10), campaignDay: 12, liveCount: 980, journal: [], deliveries: [], weighingRequests: [], strain: 'Cobb500' }],
    },
  ],
};

/** The built app, served as Caddy serves it: gzip, the index for every route, the API answered here. */
function serve(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === '/api/v1/caretaker/context') return send(response, 200, 'application/json', JSON.stringify(CONTEXT));
    if (path.startsWith('/api/')) return send(response, 404, 'application/json', '{}');
    const file = normalize(join(root, path));
    const target = file.startsWith(root) && existsSync(file) && statSync(file).isFile() ? file : join(root, 'index.html');
    const extension = extname(target);
    response.setHeader('Content-Type', TYPES[extension] ?? 'application/octet-stream');
    if (COMPRESSED.has(extension)) {
      response.setHeader('Content-Encoding', 'gzip');
      createReadStream(target).pipe(createGzip({ level: 6 })).pipe(response);
    } else {
      createReadStream(target).pipe(response);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type });
  response.end(body);
}

/**
 * The two starts of the field, every file downloaded cold (the worst case: a new version not yet in
 * the phone's cache). The morning: the caretaker signed in, his notebook kept on the phone — started
 * when the day strip of his flock is on screen. The very first opening: nothing on the phone —
 * started when the phone number can be typed.
 */
export const SCENARIOS = Object.freeze([
  { name: 'Le matin, après une mise à jour', storage: { 'yaar.session': SESSION, 'yaar.context': { userId: '00000000-0000-4000-8000-000000000051', context: CONTEXT } }, ready: 'app-day-strip', path: '/caretaker', route: true },
  { name: 'La toute première ouverture', storage: {}, ready: 'app-sign-in button.go', path: '/sign-in', route: false },
]);

/** Opens the app cold on the field phone in each scenario; returns what the budget judges. */
export async function measure(root) {
  const starts = {};
  let routeBytes = 0;
  const files = new Map();
  for (const scenario of SCENARIOS) {
    const result = await measureOne(root, scenario);
    starts[scenario.name] = result.startupMs;
    if (scenario.route) routeBytes = result.routeBytes;
    for (const file of result.files) files.set(file.path, file.bytes);
  }
  const financeFiles = [...files.keys()].filter((path) => FINANCE_MARKERS.some((marker) => readFileSync(join(root, path), 'utf8').includes(marker)));
  return { starts, routeBytes, financeFiles, files: [...files].map(([path, bytes]) => ({ path, bytes })) };
}

async function measureOne(root, scenario) {
  const { chromium } = await import('playwright-core');
  const server = await serve(root);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    await context.addInitScript((storage) => Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value))), scenario.storage);
    // Timed by the page itself, from the start of the navigation, so the measuring does not slow the measure.
    await context.addInitScript((ready) => {
      new MutationObserver((_changes, observer) => {
        if (document.querySelector(ready) === null) return;
        requestAnimationFrame(() => (globalThis.__startedAt = performance.now()));
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true });
    }, scenario.ready);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: FIELD_PHONE.latency, downloadThroughput: FIELD_PHONE.downloadThroughput, uploadThroughput: FIELD_PHONE.uploadThroughput });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: FIELD_PHONE.cpuSlowdown });

    const loaded = [];
    const encoded = new Map();
    const timeline = [];
    cdp.on('Network.requestWillBeSent', ({ requestId, request }) => timeline.push({ requestId, url: request.url, at: Date.now() }));
    cdp.on('Network.responseReceived', ({ requestId, response }) => loaded.push({ requestId, url: response.url, type: response.mimeType }));
    const done = new Map();
    cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => { encoded.set(requestId, encodedDataLength); done.set(requestId, Date.now()); });

    const started = Date.now();
    await page.goto(`${origin}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => typeof globalThis.__startedAt === 'number', undefined, { timeout: 60_000, polling: 100 });
    const startupMs = Math.round(await page.evaluate(() => globalThis.__startedAt));
    if (!page.url().includes(scenario.path)) throw new Error(`${scenario.name} : ${page.url()} au lieu de ${scenario.path}`);
    await page.waitForLoadState('networkidle');

    const code = loaded.filter(({ url, type }) => url.startsWith(origin) && (type.includes('javascript') || type.includes('css')));
    const routeBytes = code.reduce((sum, { requestId }) => sum + (encoded.get(requestId) ?? 0), 0);
    if (process.env.WATERFALL) for (const { requestId, url, at } of timeline) console.log(`${String(at - started).padStart(6)} → ${String((done.get(requestId) ?? 0) - started).padStart(6)}  ${new URL(url).pathname}`);
    return { startupMs, routeBytes, files: code.map(({ url, requestId }) => ({ path: new URL(url).pathname, bytes: encoded.get(requestId) ?? 0 })) };
  } finally {
    await browser.close();
    server.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('../dist/apps/web/browser/', import.meta.url));
  if (!existsSync(join(root, 'index.html'))) {
    console.error('Pas de build du web : npx nx build web');
    process.exit(1);
  }
  const result = await measure(root);
  for (const { path, bytes } of result.files) console.log(`  ${path}  ${kilobytes(bytes)}`);
  for (const [scenario, startupMs] of Object.entries(result.starts)) console.log(`${scenario}, en 3G : ${startupMs} ms (budget ${BUDGET.startupMs} ms)`);
  console.log(`Route gardien : ${kilobytes(result.routeBytes)} gzip (budget ${kilobytes(BUDGET.routeBytes)})`);
  const failures = verdict(result);
  failures.forEach((failure) => console.error(failure));
  process.exit(failures.length === 0 ? 0 : 1);
}
