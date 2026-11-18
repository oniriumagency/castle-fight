import { append, h, html } from '../app/dom';
import { t } from '../app/i18n';
import { modal } from '../app/router';
import { audio } from '../fx/audio';
import { gamesOf, loadRecord, nemesisOf, NEMESIS_MIN_GAMES, resetRecord, rivalsByGames, type RivalRecord, type Tally } from '../game/record';
import { iconSvg } from '../ui/assets';

const RIVALS_SHOWN = 12;

function score(r: Tally): string {
  return r.draws ? `${r.wins} – ${r.losses} – ${r.draws}` : `${r.wins} – ${r.losses}`;
}

function totals(label: string, tally: Tally): HTMLElement {
  const games = gamesOf(tally);
  const cell = (value: number, name: string, cls: string): HTMLElement => h('div.record-cell', { class: cls }, h('strong', null, String(value)), h('small', null, name));
  return h(
    'section.record-total',
    null,
    h('h3', null, label),
    h('div.record-cells', null, cell(tally.wins, t('recordWins'), 'win'), cell(tally.losses, t('recordLosses'), 'loss'), cell(tally.draws, t('recordDraws'), 'draw')),
    h('p.record-rate', null, games ? t('recordRate', { pct: Math.round((tally.wins / games) * 100) }) : '—'),
  );
}

function standing(r: RivalRecord): string {
  return r.wins > r.losses ? t('recordNemesisLead') : r.wins < r.losses ? t('recordNemesisBehind') : t('recordNemesisTied');
}

function nemesisCard(r: RivalRecord): HTMLElement {
  return h(
    'section.record-nemesis',
    null,
    h('span.nemesis-badge', null, html(iconSvg('sword')), t('nemesisBadge')),
    h('strong.record-nemesis-name', null, r.name),
    h('div.record-nemesis-score', null, h('span.win', null, String(r.wins)), h('span.sep', null, '–'), h('span.loss', null, String(r.losses))),
    h('small', null, `${standing(r)} · ${t('headToHeadGames', { n: gamesOf(r) })}`),
  );
}

/** Your wins and losses: online, against the AI, and against each online opponent, with your nemesis on top. */
export function openRecord(): void {
  modal((close) => {
    const box = h('div.modal.panel.record');
    const build = (): void => {
      const record = loadRecord();
      const nemesis = nemesisOf(record);
      const rivals = rivalsByGames(record).slice(0, RIVALS_SHOWN);
      let armed = false;
      const reset = h('button.btn.ghost', { type: 'button' }, t('recordReset'));
      reset.addEventListener('click', () => {
        audio.play('uiClick');
        if (!armed) {
          armed = true;
          reset.textContent = t('recordResetConfirm');
          return;
        }
        resetRecord();
        build();
      });
      box.replaceChildren();
      append(box, [
        h('h2', null, t('myRecord')),
        h('div.record-totals', null, totals(t('recordOnline'), record.online), totals(t('recordAi'), record.ai)),
        nemesis ? nemesisCard(nemesis) : null,
        h('h3', null, t('recordRivals')),
        rivals.length
          ? h(
              'ol.record-rivals',
              null,
              rivals.map((r) =>
                h(
                  'li',
                  { class: r === nemesis ? 'is-nemesis' : '' },
                  h('span.rival-name', null, r.name),
                  h('span.rival-games', null, t('headToHeadGames', { n: gamesOf(r) })),
                  h('span.rival-score', { class: r.wins > r.losses ? 'ahead' : r.wins < r.losses ? 'behind' : '' }, score(r)),
                ),
              ),
            )
          : h('p.record-empty', null, t('recordNoRivals')),
        h('p.record-note', null, `${t('recordNemesisHint', { n: NEMESIS_MIN_GAMES })} ${t('recordLocalNote')}`),
        h('div.actions', null, reset, h('button.btn.primary', { type: 'button', onclick: () => (audio.play('uiBack'), close()) }, t('close'))),
      ]);
    };
    build();
    return box;
  });
}
