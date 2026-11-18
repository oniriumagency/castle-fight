import { LOCALES, type Locale } from '@cardcraft-castles/engine';
import { h } from '../app/dom';
import { t } from '../app/i18n';
import { modal } from '../app/router';
import { settings, type Settings } from '../app/settings';
import { audio } from '../fx/audio';

const LOCALE_LABEL: Record<Locale, string> = { es: 'Español', en: 'English' };

function segmented<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void): HTMLElement {
  const wrap = h('div.segmented', { role: 'group' });
  const render = (selected: T): void => {
    wrap.replaceChildren(
      ...options.map(([v, label]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(v === selected),
            onclick: () => {
              audio.play('uiClick');
              onChange(v);
              render(v);
            },
          },
          label,
        ),
      ),
    );
  };
  render(value);
  return wrap;
}

function slider(key: 'masterVolume' | 'musicVolume' | 'sfxVolume', label: string): HTMLElement {
  const input = h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(settings.get()[key] * 100), 'aria-label': label });
  input.addEventListener('input', () => settings.set({ [key]: Number(input.value) / 100 } as Partial<Settings>));
  input.addEventListener('change', () => audio.play('uiClick'));
  return h('label.field', null, label, input);
}

function toggle(key: 'reducedMotion' | 'screenShake' | 'localTimer', label: string): HTMLElement {
  return h(
    'div.setting-row',
    null,
    h('span', null, label),
    segmented(settings.get()[key] ? 'on' : 'off', [['on', t('on')], ['off', t('off')]], (v) => settings.set({ [key]: v === 'on' } as Partial<Settings>)),
  );
}

/** Settings dialog, available from the menu and during a game. */
export function openSettings(): void {
  modal((close) => {
    const box = h('div.modal.panel.settings');
    const build = (): void => {
      box.replaceChildren(
        h('h2', null, t('settings')),
        h(
          'div.setting-row',
          null,
          h('span', null, t('language')),
          segmented(
            settings.get().locale,
            LOCALES.map((l) => [l, LOCALE_LABEL[l]] as [Locale, string]),
            (v) => {
              settings.set({ locale: v });
              build();
            },
          ),
        ),
        slider('masterVolume', t('masterVolume')),
        slider('musicVolume', t('musicVolume')),
        slider('sfxVolume', t('sfxVolume')),
        h(
          'div.setting-row',
          null,
          h('span', null, t('animationSpeed')),
          segmented(settings.get().animationSpeed, [['normal', t('speedNormal')], ['fast', t('speedFast')]], (v) => settings.set({ animationSpeed: v })),
        ),
        toggle('screenShake', t('screenShake')),
        toggle('reducedMotion', t('reducedMotion')),
        toggle('localTimer', t('localTimer')),
        h('div.actions', null, h('button.btn.primary', { type: 'button', onclick: () => (audio.play('uiBack'), close()) }, t('close'))),
      );
    };
    build();
    return box;
  });
}
