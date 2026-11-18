import { DEFAULT_RULES } from '@cardcraft-castles/engine';
import { twilightValues } from '../game/twilight';
import { h, html } from '../app/dom';
import { t, type StringKey } from '../app/i18n';
import { modal } from '../app/router';
import { cardFace } from '../ui/card';

const SECTIONS: StringKey[] = ['rulesGoal', 'rulesTurn', 'rulesSchools', 'rulesDamage', 'rulesHeroes', 'rulesExtras', 'rulesTwilight', 'rulesControls'];

/** Short rules, with three example cards (one per school). */
export function openHowToPlay(): void {
  const values = {
    win: DEFAULT_RULES.keepWin,
    hand: DEFAULT_RULES.handSize,
    max: DEFAULT_RULES.maxEnchantments,
    every: DEFAULT_RULES.eventEveryRounds,
    ...twilightValues(DEFAULT_RULES),
  };
  modal(() =>
    h(
      'div.modal.panel.how-to',
      null,
      h('h2', null, t('howToPlay')),
      h(
        'div.how-cards',
        null,
        ['andamio-real', 'carga-de-lanceros', 'lluvia-de-ascuas'].map((id) => {
          const c = cardFace(id, { calm: true });
          c.style.setProperty('--w', '140px');
          return c;
        }),
      ),
      h(
        'ol.how-list',
        null,
        SECTIONS.map((key) => h('li', null, html(t(key, values)))),
      ),
    ),
  );
}
