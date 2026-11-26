/**
 * Counts the paintings the scene is loading (backdrop, castles, decals), so
 * the loading screen can show how far along the first art is.
 */
let total = 0;
let done = 0;
const listeners = new Set<(fraction: number) => void>();

function notify(): void {
  const fraction = total ? done / total : 0;
  for (const fn of listeners) fn(fraction);
}

/** Counts `load` while it runs; returns it unchanged. */
export function trackArt<T>(load: Promise<T>): Promise<T> {
  total++;
  notify();
  const settle = (): void => {
    done++;
    notify();
  };
  load.then(settle, settle);
  return load;
}

/** Calls `fn` with the share of the art loaded so far (0 to 1) every time it changes. Returns the unsubscribe. */
export function onArtProgress(fn: (fraction: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
