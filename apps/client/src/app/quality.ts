import { settings } from './settings';

/**
 * Effects quality. `auto` starts high unless the device looks modest, and
 * the battlefield drops it to low for the rest of the visit if frames keep
 * running slow. Low keeps every effect but with fewer particles, no light
 * rays or smoke, and a lighter canvas resolution.
 */

function modestDevice(): boolean {
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
