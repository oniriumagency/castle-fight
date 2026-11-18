import { HEROES, getHero, type HeroId } from '@cardcraft-castles/engine';
import { h, html } from '../app/dom';
import { L, t } from '../app/i18n';
import type { Screen } from '../app/router';
import { settings } from '../app/settings';
import { battlefield } from '../app/stage';
import { audio } from '../fx/audio';
import { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS, DIFFICULTY_NAMES, type Difficulty } from '../game/ai';
import { artUrl, iconSvg } from '../ui/assets';
import { heroCard, heroParts, rulesHtml } from '../ui/card';
import { heroCss } from '../ui/theme';
import { flow } from './flow';

export type HeroSelectMode = 'ai' | 'local' | 'online';

const LAST_HERO = 'cardcraft-castles:last-hero';
const LAST_LEVEL = 'cardcraft-castles:last-level';

function stored<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && valid.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not important.
  }
}

/**
 * Hero choice before a game. Against the AI it also sets the difficulty and
 * the opponent; on a shared device both players pick in turn; online it
 * picks the hero you join the room with.
 */
export function heroSelectScreen(mode: HeroSelectMode, roomId?: string): Screen {
  const ids = HEROES.map((hero) => hero.id);
  let picked: HeroId = stored(LAST_HERO, ids, ids[0]);
  let opponent: HeroId | 'random' = 'random';
  let difficulty: Difficulty = stored(LAST_LEVEL, DIFFICULTIES, 'normal');
  /** On a shared device: player 1 picks first, then player 2. */
  let step: 0 | 1 = 0;
  let firstPick: HeroId | null = null;

  const el = h('div.hero-screen');

  const title = (): string => {
    if (mode === 'local') return t('chooseHeroFor', { who: step === 0 ? t('player1') : t('player2') });
    return t('chooseHero');
  };

  const confirm = (): void => {
    audio.play('uiClick');
    remember(LAST_HERO, picked);
    if (mode === 'ai') {
      remember(LAST_LEVEL, difficulty);
      flow.startAi(picked, opponent, difficulty);
    } else if (mode === 'local') {
      if (step === 0) {
        firstPick = picked;
        step = 1;
        build();
        return;
      }
      flow.startLocal([firstPick!, picked]);
    } else if (roomId) {
      void import('./online').then((m) => m.joinOnline(roomId, picked));
    }
  };

  const detail = (): HTMLElement => {
    const hero = getHero(picked);
    const parts = heroParts(picked);
    return h(
      'aside.hero-detail.panel',
      { style: `--hero:${heroCss(picked)}` },
      h('div.hero-portrait', null, h('img', { src: artUrl(hero.art), alt: '' })),
      h('h2', null, L(hero.name)),
      h('div.hero-ability', null, h('h3', null, t('passive')), h('p', null, html(rulesHtml(parts.passive)))),
      h('div.hero-ability', null, h('h3', null, t('ultimate')), h('p', null, html(rulesHtml(parts.ultimate)))),
      mode === 'ai' ? aiOptions() : null,
      h(
        'div.hero-actions',
        null,
        h('button.btn', { type: 'button', onclick: back }, html(iconSvg('arrow')), t('back')),
        h('button.btn.primary.big', { type: 'button', onclick: confirm }, mode === 'local' && step === 0 ? t('confirm') : t('startGame')),
      ),
    );
  };

  const aiOptions = (): HTMLElement =>
    h(
      'div.ai-options',
      null,
      h(
        'div.option-row',
        null,
        h('span', null, t('difficulty')),
        h(
          'div.segmented',
          { role: 'group', 'aria-label': t('difficulty') },
          DIFFICULTIES.map((level) =>
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': String(level === difficulty),
                onclick: () => {
                  audio.play('uiClick');
                  difficulty = level;
                  build();
                },
              },
              L(DIFFICULTY_NAMES[level]),
            ),
          ),
        ),
        h('small.option-hint', null, L(DIFFICULTY_DESCRIPTIONS[difficulty])),
      ),
      h(
        'div.option-row',
        null,
        h('span', null, t('opponentHero')),
        h(
          'div.opponent-picks',
          null,
          h(
            'button.opp-pick.random',
            {
              type: 'button',
              'aria-pressed': String(opponent === 'random'),
              title: t('randomHero'),
              onclick: () => {
                opponent = 'random';
                audio.play('uiClick');
                build();
              },
            },
            '?',
          ),
          ids.map((id) =>
            h(
              'button.opp-pick',
              {
                type: 'button',
                'aria-pressed': String(opponent === id),
                title: L(getHero(id).name),
                style: `--hero:${heroCss(id)}`,
                onclick: () => {
                  opponent = id;
                  audio.play('uiClick');
                  build();
                },
              },
              h('img', { src: artUrl(getHero(id).art), alt: L(getHero(id).name) }),
            ),
          ),
        ),
      ),
    );

  const back = (): void => {
    audio.play('uiBack');
    if (mode === 'local' && step === 1) {
      step = 0;
      picked = firstPick ?? picked;
      build();
      return;
    }
    if (mode === 'online') flow.lobby();
    else flow.menu();
  };

  const build = (): void => {
    const grid = h(
      'div.hero-grid',
      { role: 'listbox', 'aria-label': title() },
      ids.map((id) => {
        const card = heroCard(id, { tilt: true, calm: id !== picked });
        // Compact frame: a shorter picture leaves room for readable rules text.
        card.classList.add('compact');
        card.setAttribute('role', 'option');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-selected', String(id === picked));
        if (id === picked) card.classList.add('picked');
        if (mode === 'local' && step === 1 && id === firstPick) card.classList.add('taken');
        const choose = (): void => {
          if (picked === id) return;
          picked = id;
          audio.play('cardSelect');
          battlefield().castles[0].setHero(id);
          build();
        };
        card.addEventListener('click', choose);
        card.addEventListener('dblclick', confirm);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            if (picked === id) confirm();
            else choose();
          }
        });
        return card;
      }),
    );
    el.replaceChildren(h('header.screen-head', null, h('h1', null, title())), h('div.hero-body', null, grid, detail()));
    el.querySelector<HTMLElement>('.hero-card.picked')?.focus({ preventScroll: true });
  };

  let unsubscribe = (): void => {};
  return {
    el,
    mount() {
      build();
      battlefield().castles[0].setHero(picked);
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
