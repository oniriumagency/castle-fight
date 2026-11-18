import { CARDS, GAME_TITLE } from '@cardcraft-castles/engine';
import { h, html } from '../app/dom';
import { t } from '../app/i18n';
import type { Screen } from '../app/router';
import { settings } from '../app/settings';
import { battlefield } from '../app/stage';
import { audio } from '../fx/audio';
import { iconSvg, type IconName } from '../ui/assets';
import { cardFace } from '../ui/card';
import { skyFor } from '../ui/theme';
import { flow } from './flow';
import { openHowToPlay } from './howToPlay';
import { openSettings } from './settingsModal';
import { muteButton } from '../ui/muteButton';

/** A few showpiece cards fanned beside the menu: a legendary between two epics. */
function showcase(): HTMLElement {
  const shuffled = (rarity: string): string[] =>
    CARDS.filter((c) => c.rarity === rarity)
      .map((c) => c.id)
      .sort(() => Math.random() - 0.5);
  const [left, right] = shuffled('epica');
  const ids = [left, shuffled('legendaria')[0], right];
  const fan = h('div.menu-fan', { 'aria-hidden': 'true' });
  ids.forEach((id, i) => {
    const card = cardFace(id, { tilt: true });
    card.style.setProperty('--i', String(i - 1));
    fan.appendChild(card);
  });
  return fan;
}

function modeButton(icon: IconName, label: string, hint: string, onClick: () => void): HTMLElement {
  return h(
    'button.mode-btn',
    {
      type: 'button',
      onclick: () => {
        audio.play('uiClick');
        onClick();
      },
      onpointerenter: () => audio.play('uiHover'),
    },
    h('span.mode-icon', null, html(iconSvg(icon))),
    h('span.mode-text', null, h('strong', null, label), h('small', null, hint)),
  );
}

export function menuScreen(): Screen {
  const el = h('div.menu-screen');

  const build = (): void => {
    const nickname = h('input', {
      type: 'text',
      maxlength: 20,
      autocomplete: 'nickname',
      placeholder: t('nicknamePlaceholder'),
      value: settings.get().nickname,
      'aria-label': t('nickname'),
    });
    nickname.addEventListener('change', () => settings.set({ nickname: nickname.value.trim().slice(0, 20) }));

    const [first, second] = GAME_TITLE.split(':');
    el.replaceChildren(
      h(
        'div.menu-main',
        null,
        h(
          'header.logo',
          null,
          html(
            '<svg class="logo-emblem" viewBox="0 0 120 150" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M60 4l52 71-52 71L8 75z"/><path d="M60 22l38 53-38 53-38-53z" stroke-width="1.4"/><path d="M42 104V62h-5V46h8v6h7v-6h16v6h7v-6h8v16h-5v42z" fill="currentColor" fill-opacity=".22"/><path d="M54 104V88a6 6 0 0112 0v16"/><path d="M60 46V30l12 5-12 5"/></svg>',
          ),
          h('h1', null, h('span.logo-main', null, first), h('span.logo-sub', null, (second ?? '').trim())),
          h('p.tagline', null, t('tagline')),
        ),
        h('label.field.nick', null, t('nickname'), nickname),
        h(
          'nav.modes',
          null,
          modeButton('sword', t('playAi'), t('playAiHint'), () => flow.heroSelect('ai')),
          modeButton('globe', t('playOnline'), t('playOnlineHint'), () => flow.lobby()),
          modeButton('users', t('playLocal'), t('playLocalHint'), () => flow.heroSelect('local')),
        ),
        h(
          'div.menu-secondary',
          null,
          h('button.btn', { type: 'button', onclick: () => (audio.play('uiClick'), openHowToPlay()) }, html(iconSvg('book')), t('howToPlay')),
          h('button.btn', { type: 'button', onclick: () => (audio.play('uiClick'), openSettings()) }, html(iconSvg('gear')), t('settings')),
          h(
            'button.btn',
            {
              type: 'button',
              onclick: () => {
                audio.play('uiClick');
                settings.set({ locale: settings.get().locale === 'es' ? 'en' : 'es' });
              },
            },
            html(iconSvg('globe')),
            settings.get().locale === 'es' ? 'English' : 'Español',
          ),
          muteButton('btn.icon-only'),
        ),
        h('footer.menu-foot', null, t('version')),
      ),
      showcase(),
    );
  };

  let unsubscribe = (): void => {};
  return {
    el,
    mount() {
      build();
      audio.music('menu');
      const field = battlefield();
      field.layout();
      void field.setMood(skyFor(null), 900);
      field.setShield(0, 0);
      field.setShield(1, 0);
      void field.animateCastle(0, 42, 18, 1200);
      void field.animateCastle(1, 36, 22, 1200);
      unsubscribe = settings.subscribe((next, prev) => {
        if (next.locale !== prev.locale) build();
      });
    },
    unmount() {
      unsubscribe();
    },
    resize() {
      requestAnimationFrame(() => battlefield().layout());
    },
  };
}
