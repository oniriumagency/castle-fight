import { h, html } from './dom';
import { t } from './i18n';

/**
 * Phones play in landscape only. Where the browser allows it (Android), the
 * first tap goes full screen and locks the orientation; everywhere else a
 * "turn your phone" screen covers the game while the phone is upright.
 */

/** A phone: a touch screen whose short side is phone-sized. Tablets and computers are left alone. */
export function isPhone(): boolean {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return coarse && Math.min(window.screen.width, window.screen.height) <= 540;
}

async function lockLandscape(): Promise<void> {
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch {
    // iOS and some browsers refuse: the rotate screen does the job.
  }
}

const ROTATE_ICON = `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <rect x="20" y="6" width="24" height="40" rx="4"/>
  <path d="M29 40h6"/>
  <path d="M10 44a22 22 0 0 0 30 14" class="arrow"/>
  <path d="M34 53l6 5-7 3" class="arrow"/>
</svg>`;

export function initLandscapeOnly(): void {
  if (!isPhone()) return;
  document.documentElement.classList.add('phone');
  const overlay = h(
    'div.rotate-screen',
    { role: 'alertdialog', 'aria-live': 'polite' },
    h('div.rotate-icon', null, html(ROTATE_ICON)),
    h('p.rotate-title', null, t('rotateTitle')),
    h('p.rotate-hint', null, t('rotateHint')),
  );
  document.body.appendChild(overlay);
  // Browsers only allow full screen and orientation lock from a user gesture.
  const onGesture = (): void => void lockLandscape();
  window.addEventListener('pointerup', onGesture, { passive: true });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) window.addEventListener('pointerup', onGesture, { passive: true, once: true });
  });
}
