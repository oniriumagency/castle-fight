/**
 * The loading screen (`#loader` in index.html): up from the very first paint
 * until the scene's paintings have arrived, so the drawn stand-ins for the
 * sky, the land and the castles are never seen before the art.
 */
import { onArtProgress } from '../scene/artProgress';
import { t } from './i18n';

const el = (): HTMLElement | null => document.getElementById('loader');
let stopProgress = (): void => {};

/** Shows the title once its fonts are in, follows the art as it loads. */
export function initLoader(): void {
  const loader = el();
  if (!loader) return;
  const tagline = loader.querySelector('.loader-tagline');
  if (tagline) tagline.textContent = t('tagline');
  loader.setAttribute('aria-label', t('loading'));
  const fonts = document.fonts?.ready ?? Promise.resolve();
  // A slow font never holds the title back for long.
  void Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(() => loader.classList.add('fonts'));
  const fill = loader.querySelector<HTMLElement>('.loader-fill');
  let shown = 0;
  stopProgress = onArtProgress((fraction) => {
    // The total grows as the castles' lists arrive: the bar only ever moves forward.
    shown = Math.max(shown, fraction);
    if (fill) fill.style.width = `${Math.round(shown * 100)}%`;
    loader.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
  });
}

/** Fills the bar and fades the loading screen out, then removes it. */
export function hideLoader(): void {
  stopProgress();
  const loader = el();
  if (!loader || loader.classList.contains('done')) return;
  const fill = loader.querySelector<HTMLElement>('.loader-fill');
  if (fill) fill.style.width = '100%';
  loader.classList.add('done');
  setTimeout(() => loader.remove(), 1000);
}
