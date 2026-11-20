import { settings } from './settings';

/**
 * Effects quality. `auto` starts high unless the device looks modest, and
 * the battlefield drops it to low for the rest of the visit if frames keep
 * running slow. Low keeps every effect but with fewer particles, no light
 * rays or smoke, and a lighter canvas resolution.
 */

/**
 * Consoles and TV browsers (Edge on Xbox, PlayStation, smart TVs) have little
 * GPU memory for the page and close the tab when a scene asks too much: the
 * Terremoto's dust once left an Xbox with a blank screen.
 */
export function consoleBrowser(): boolean {
  return /Xbox|PlayStation|Nintendo|SMART-TV|SmartTV|Tizen|Web0S|webOS|CrKey|AFT[A-Z]|BRAVIA/i.test(navigator.userAgent);
}

function modestDevice(): boolean {
  if (consoleBrowser()) return true;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return memory <= 2 || cores <= 2 || (coarse && cores <= 4);
}

let autoLow = modestDevice();

export function effectsLow(): boolean {
  const q = settings.get().effectsQuality;
  if (q === 'low') return true;
  if (q === 'high') return false;
  return autoLow;
}

/** The graphics card dropped the page's canvas: stay light for the rest of the visit. */
export function reportGpuTrouble(): void {
  autoLow = true;
}

/** Called by the frame monitor when the game keeps missing frames. */
export function reportSlowFrames(): boolean {
  if (settings.get().effectsQuality !== 'auto' || autoLow) return false;
  autoLow = true;
  return true;
}

/** Most particles alive at once. */
export function particleBudget(): number {
  return effectsLow() ? 260 : 900;
}

/** Scales particle counts. */
export function density(): number {
  if (settings.get().reducedMotion) return 0.4;
  return effectsLow() ? 0.5 : 1;
}
