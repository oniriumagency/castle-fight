/**
 * Playing without a connection: the service worker (`sw/sw.js`, written into
 * the build by `sw/plugin.ts`) keeps the game, its art, fonts and music on the
 * device. Only in builds: the dev server always serves fresh files.
 */
import { isInstalled } from './install';
import { ON_ITCH } from './platform';

/** The installed game can stay open for days: look for a new version when it comes back to the front. */
const UPDATE_EVERY = 60 * 60 * 1000;

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  let last = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - last < UPDATE_EVERY) return;
    last = Date.now();
    registration.update().catch(() => undefined);
  });
}

export function initOffline(): void {
  // Not on itch.io: itch serves each upload from its own address and keeps the files itself.
  if (!import.meta.env.PROD || ON_ITCH || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const start = (): void => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then(async (registration) => {
        watchForUpdates(registration);
        // Finish saving the music if an earlier visit was cut off.
        (await navigator.serviceWorker.ready).active?.postMessage('warm');
      })
      .catch(() => undefined);
    // The installed game asks the browser not to clear its saved files when space runs low.
    if (isInstalled()) void navigator.storage?.persist?.().catch(() => false);
  };
  // After the page has loaded, so saving files does not compete with the first screen.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
