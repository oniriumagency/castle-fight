import { h, html } from '../app/dom';
import { t } from '../app/i18n';
import { settings } from '../app/settings';
import { audio } from '../fx/audio';
import { iconSvg } from './assets';

/** Speaker button that silences or restores all sound (also the M key). */
export function muteButton(cls = 'btn.icon-only'): HTMLButtonElement {
  const btn = h(`button.${cls}.mute-btn`, { type: 'button' }) as HTMLButtonElement;
  const paint = (): void => {
    const muted = settings.get().muted;
    btn.replaceChildren(html(iconSvg(muted ? 'mute' : 'sound')));
    btn.setAttribute('aria-label', muted ? t('unmute') : t('mute'));
    btn.setAttribute('aria-pressed', String(muted));
    btn.title = `${muted ? t('unmute') : t('mute')} (M)`;
  };
  btn.addEventListener('click', () => {
    toggleMute();
  });
  const unsubscribe = settings.subscribe((next, prev) => {
    if (!btn.isConnected && prev) unsubscribe();
    else if (next.muted !== prev.muted || next.locale !== prev.locale) paint();
  });
  paint();
  return btn;
}

export function toggleMute(): void {
  const muted = !settings.get().muted;
  settings.set({ muted });
  if (!muted) audio.play('uiClick');
}
