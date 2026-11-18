import { h, html } from '../app/dom';
import { t } from '../app/i18n';
import { settings, type Settings } from '../app/settings';
import { audio } from '../fx/audio';
import { iconSvg } from './assets';

type VolumeKey = 'masterVolume' | 'musicVolume' | 'sfxVolume';

const VOLUMES: VolumeKey[] = ['masterVolume', 'musicVolume', 'sfxVolume'];

/** Only one sound panel is open at a time. */
let closeOpen: (() => void) | null = null;

/**
 * Speaker button. A tap opens a small panel right there with the general,
 * music and effects volumes and a button that silences everything (also the
 * M key). The icon shows whether the sound is off.
 */
export function muteButton(cls = 'btn.icon-only'): HTMLElement {
  const btn = h(`button.${cls}.mute-btn`, { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }) as HTMLButtonElement;
  const paint = (): void => {
    const muted = settings.get().muted;
    btn.replaceChildren(html(iconSvg(muted ? 'mute' : 'sound')));
    btn.setAttribute('aria-label', t('soundSettings'));
    btn.classList.toggle('is-muted', muted);
    btn.title = `${t('soundSettings')} (M: ${muted ? t('unmute') : t('mute')})`;
  };
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-expanded') === 'true') closeOpen?.();
    else openPanel(btn);
  });
  const unsubscribe = settings.subscribe((next, prev) => {
    if (!btn.isConnected && prev) unsubscribe();
    else if (next.muted !== prev.muted || next.locale !== prev.locale) paint();
  });
  paint();
  return btn;
}

function openPanel(btn: HTMLButtonElement): void {
  closeOpen?.();
  audio.play('uiClick');

  const muteBtn = h('button.btn.sound-mute', { type: 'button' }) as HTMLButtonElement;
  muteBtn.addEventListener('click', () => toggleMute());
  const rows = VOLUMES.map((key) => {
    const value = h('span.sound-value');
    const input = h('input', { type: 'range', min: 0, max: 100, step: 5, 'aria-label': t(key) }) as HTMLInputElement;
    input.value = String(Math.round(settings.get()[key] * 100));
    const show = (): void => {
      value.textContent = `${input.value}%`;
    };
    input.addEventListener('input', () => {
      // Moving a volume while muted means the player wants to hear it.
      settings.set({ [key]: Number(input.value) / 100, ...(settings.get().muted ? { muted: false } : {}) } as Partial<Settings>);
      show();
    });
    input.addEventListener('change', () => audio.play('uiClick'));
    show();
    return h('label.sound-row', null, h('span.sound-label', null, t(key)), input, value);
  });
  const panel = h('div.sound-panel.panel', { role: 'dialog', 'aria-label': t('soundSettings') }, h('div.sound-head', null, h('span', null, t('soundSettings')), muteBtn), h('div.sound-rows', null, ...rows));

  const paint = (): void => {
    const muted = settings.get().muted;
    muteBtn.replaceChildren(html(iconSvg(muted ? 'mute' : 'sound')), muted ? t('unmute') : t('muteAll'));
    muteBtn.setAttribute('aria-pressed', String(muted));
    panel.classList.toggle('muted', muted);
  };
  paint();
  const unsubscribe = settings.subscribe((next, prev) => {
    if (next.muted !== prev.muted) paint();
  });

  const place = (): void => {
    if (!btn.isConnected) return close();
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const left = Math.max(8, Math.min(vw - w - 8, r.right - w));
    // Below the button when it fits, otherwise above it.
    const below = r.bottom + 8 + ph <= vh - 8 || r.top < vh / 2;
    panel.style.left = `${left}px`;
    panel.style.top = `${below ? Math.min(r.bottom + 8, vh - ph - 8) : Math.max(8, r.top - 8 - ph)}px`;
    panel.classList.toggle('above', !below);
  };
  const onDown = (e: PointerEvent): void => {
    const target = e.target as Node;
    if (!panel.contains(target) && !btn.contains(target)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      btn.focus();
    }
  };
  const watch = window.setInterval(() => {
    if (!btn.isConnected) close();
  }, 500);

  function close(): void {
    if (!panel.isConnected) return;
    panel.remove();
    unsubscribe();
    window.clearInterval(watch);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    btn.setAttribute('aria-expanded', 'false');
    if (closeOpen === close) closeOpen = null;
  }

  document.body.append(panel);
  place();
  requestAnimationFrame(() => panel.classList.add('in'));
  btn.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  closeOpen = close;
}

export function toggleMute(): void {
  const muted = !settings.get().muted;
  settings.set({ muted });
  if (!muted) audio.play('uiClick');
}
