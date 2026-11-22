/**
 * Cardcraft: Castles service worker: keeps the whole game on the device so
 * the campaign, the AI and two players on one device work with no
 * connection. `sw/plugin.ts` writes the lists below into `dist/sw.js` at
 * build time.
 *
 * - CORE (page, code, styles, fonts, icons and every illustration) is saved
 *   before this version takes over. LATER (the music, about 15 MB) is saved
 *   right after, in the background, and resumes on the next visit if it was
 *   cut off.
 * - Each file carries a hash of its contents: a new version only downloads
 *   the files that changed and copies the rest from the previous cache, which
 *   is then deleted.
 * - The page itself is asked from the network first (so a deploy arrives on
 *   the next load) and comes from the cache when there is no connection.
 *   Everything else comes from the cache first.
 * - The online API (`api/`) never goes through here.
 */
/* eslint-disable no-restricted-globals */

const VERSION = '__VERSION__';
/** @type {[string, string][]} path relative to the scope, content hash */
const CORE = __CORE__;
/** @type {[string, string][]} */
const LATER = __LATER__;

const PREFIX = 'cardcraft-castles-';
const CACHE = PREFIX + VERSION;
/** Inside each cache: which hash each saved file has. */
const MANIFEST = '__manifest__';
/** The page asked from the network waits this long before using the saved copy. */
const NAVIGATION_TIMEOUT = 4000;

const scope = self.registration.scope;
const abs = (path) => new URL(path, scope).href;
const PAGE = abs('./');
const API = abs('api/');

/** url -> hash of the files already in this version's cache. */
async function readManifest(cache) {
  const res = await cache.match(MANIFEST);
  return new Map(res ? Object.entries(await res.json()) : []);
}

async function writeManifest(cache, map) {
  await cache.put(MANIFEST, new Response(JSON.stringify(Object.fromEntries(map)), { headers: { 'content-type': 'application/json' } }));
}

/** A redirected response cannot answer a navigation: keep only its body. */
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function download(url) {
  const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return clean(res);
}

/** Runs `job` over `items`, a few at a time. */
async function pool(items, size, job) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await job(queue.shift());
  });
  await Promise.all(workers);
}

/** Files of earlier versions, by url: the cache that has them and their hash. */
async function previousFiles() {
  const found = new Map();
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const cache = await caches.open(name);
    for (const [url, rev] of await readManifest(cache)) found.set(url, { cache, rev });
  }
  return found;
}

/**
 * Saves `entries` into this version's cache: unchanged files are copied from
 * an earlier version, the rest downloaded. With `network: false` only copies.
 */
async function fill(entries, { network }) {
  const cache = await caches.open(CACHE);
  const have = await readManifest(cache);
  const old = await previousFiles();
  const missing = entries.filter(([path, rev]) => have.get(abs(path)) !== rev);
  await pool(missing, 6, async ([path, rev]) => {
    const url = abs(path);
    const prev = old.get(url);
    let res = prev && prev.rev === rev ? await prev.cache.match(url, { ignoreVary: true }) : undefined;
    if (!res) {
      if (!network) return;
      res = await download(url);
    }
    await cache.put(url, res);
    have.set(url, rev);
  });
  await writeManifest(cache, have);
}

let warming = null;
/** Downloads the music still missing. Safe to call any number of times. */
function warm() {
  warming ??= fill(LATER, { network: true })
    .catch(() => undefined)
    .finally(() => {
      warming = null;
    });
  return warming;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await fill(CORE, { network: true });
      await fill(LATER, { network: false });
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
      await warm();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'warm') event.waitUntil(warm());
});

/** The cached file, or nothing. Looks in this version's cache only. */
async function cached(request, options) {
  const cache = await caches.open(CACHE);
  return cache.match(request, { ignoreVary: true, ...options });
}

/** Audio and video ask for byte ranges: cut them out of the saved file. */
async function partial(request, res) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const blob = await res.blob();
  const size = blob.size;
  if (!match || (!match[1] && !match[2])) return new Response(blob, { status: 200, headers: res.headers });
  let start = match[1] ? Number(match[1]) : size - Number(match[2]);
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }
  const headers = new Headers(res.headers);
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(blob.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
}

async function navigation(request) {
  const network = fetch(request).then(async (res) => {
    if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) {
      const cache = await caches.open(CACHE);
      await cache.put(PAGE, (await clean(res)).clone());
    }
    return res;
  });
  network.catch(() => undefined);
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
  } catch {
    // Offline: the saved page below.
  }
  const saved = await cached(PAGE);
  if (saved) return saved;
  return network;
}

async function asset(request) {
  const saved = await cached(request);
  if (saved) return request.headers.has('range') ? partial(request, saved) : saved;
  const res = await fetch(request);
  if (res.ok && res.status === 200 && res.type === 'basic' && !request.headers.has('range')) {
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = request.url;
  if (!url.startsWith(scope) || url.startsWith(API)) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }
  event.respondWith(asset(request));
});
