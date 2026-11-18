import { TERMS, roundOf, twilightLevel, type Rules } from '@cardcraft-castles/engine';
import { h, html } from '../app/dom';
import { L, t, type StringKey } from '../app/i18n';
import { modal } from '../app/router';
import { iconSvg } from '../ui/assets';
import { twilightCard, type CardOptions } from '../ui/card';

/** Twilight Fury helpers for the interface. Rules from older saves may lack its fields: then it is off. */

export function twilightOn(rules: Rules): boolean {
  return (rules.twilightRound ?? 0) > 0;
}

/** Placeholder values for the rule texts. */
export function twilightValues(rules: Rules): { start: number; step: number; atk: number; build: number; wall: number; keep: number; before: number; duelTurn: number } {
  const n = (v: number | undefined): number => v ?? 0;
  const start = n(rules.twilightRound);
  return {
    start,
    step: n(rules.twilightEvery),
    atk: n(rules.twilightAttackBonus),
    build: n(rules.twilightBuildBonus),
    wall: n(rules.twilightErosion),
    keep: n(rules.twilightKeepErosion),
    before: Math.max(0, start - 1),
    duelTurn: Math.max(1, start * 2 - 1),
  };
}

type FuryBoard = { rules: Rules; turn: number; round?: number; players: readonly unknown[] };

/** Its level and the rounds until it falls or rises again, or null when it is off or still far away. */
export interface TwilightStatus {
  level: number;
  round: number;
  /** Rounds until it falls (level 0) or rises again (level 1+). */
  next: number;
}

export function twilightStatus(board: FuryBoard, warnAhead = 3): TwilightStatus | null {
  if (!twilightOn(board.rules)) return null;
  const round = roundOf(board);
  const level = twilightLevel(board);
  const start = board.rules.twilightRound;
  if (level === 0) {
    const next = start - round;
    return next <= warnAhead ? { level, round, next } : null;
  }
  const every = Math.max(1, board.rules.twilightEvery ?? 1);
  return { level, round, next: every - ((round - start) % every) };
}

/** Short line for the chip: the round, when it falls or when it rises next. */
export function twilightLine(status: TwilightStatus): string {
  const values = { level: status.level, round: status.round, n: status.next };
  if (status.level === 0) return t(status.next <= 1 ? 'twilightSoonNext' : 'twilightSoon', values);
  return t(status.next <= 1 ? 'twilightLevelNext' : 'twilightLevel', values);
}

/** The Fury as a card, with this match's numbers. */
export function twilightCardFor(rules: Rules, opts: CardOptions = {}): HTMLDivElement {
  return twilightCard(t('twilightName'), t('twilightKind'), t('twilightCardText', twilightValues(rules)), opts);
}

/**
 * Popup that explains everything the Fury changes: its card, each effect in
 * detail and a table of the first levels. `level` highlights the current row.
 */
export function openTwilightInfo(rules: Rules, level = 0): () => void {
  const v = { ...twilightValues(rules), win: rules.keepWin };
  const section = (title: StringKey, body: StringKey): HTMLElement =>
    h('section', null, h('h3', null, t(title)), h('p', null, t(body, v)));
  const rows = Array.from({ length: Math.max(5, level + 1) }, (_, i) => i + 1).map((n) => {
    const from = v.start + (n - 1) * v.step;
    return h(
      'tr',
      { class: n === level ? 'current' : '' },
      h('th', { scope: 'row' }, String(n)),
      h('td', null, `${from}–${from + v.step - 1}`),
      h('td', null, `+${v.atk * n}`),
      h('td', null, `+${v.build * n}`),
      h('td', null, `−${v.wall * n} / −${v.keep * n}`),
    );
  });
  const wearHead = `${t('twilightTableWear')} (${L(TERMS.wall)} / ${L(TERMS.keep)})`;
  return modal(() =>
    h(
      'div.modal.panel.twilight-info',
      null,
      h('h2', null, html(iconSvg('sunset')), ' ', t('twilightName')),
      h(
        'div.twilight-info-body',
        null,
        h('div.twilight-info-card', null, twilightCardFor(rules, { calm: true })),
        h(
          'div.twilight-info-text',
          null,
          h('p.lead', null, t('twilightInfoIntro')),
          section('twilightInfoWhenTitle', 'twilightInfoWhen'),
          section('twilightInfoLevelsTitle', 'twilightInfoLevels'),
          h(
            'div.table-wrap',
            null,
            h(
              'table.twilight-table',
              null,
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', { scope: 'col' }, t('twilightTableLevel')),
                  h('th', { scope: 'col' }, t('twilightTableTurns')),
                  h('th', { scope: 'col' }, t('twilightTableAttack')),
                  h('th', { scope: 'col' }, t('twilightTableBuild')),
                  h('th', { scope: 'col' }, wearHead),
                ),
              ),
              h('tbody', null, rows),
            ),
          ),
          section('twilightInfoAttackTitle', 'twilightInfoAttack'),
          section('twilightInfoBuildTitle', 'twilightInfoBuild'),
          section('twilightInfoWearTitle', 'twilightInfoWear'),
          section('twilightInfoWinTitle', 'twilightInfoWin'),
          h('p.note', null, t('twilightInfoToggle')),
        ),
      ),
    ),
  );
}
