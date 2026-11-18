import { TERMS, twilightDeadline, twilightLevel, type Rules } from '@cardcraft-castles/engine';
import { h, html } from '../app/dom';
import { L, t, type StringKey } from '../app/i18n';
import { modal } from '../app/router';
import { iconSvg } from '../ui/assets';
import { twilightCard, type CardOptions } from '../ui/card';

/** Twilight Fury helpers for the interface. Rules from older saves may lack its fields: then it is off. */

export function twilightOn(rules: Rules): boolean {
  return (rules.twilightTurn ?? 0) > 0;
}

/** Placeholder values for the rule texts. */
export function twilightValues(rules: Rules): { start: number; step: number; atk: number; build: number; wall: number; keep: number; end: number } {
  const level = (n: number | undefined): number => n ?? 0;
  return {
    start: level(rules.twilightTurn),
    step: level(rules.twilightEvery),
    atk: level(rules.twilightAttackBonus),
    build: level(rules.twilightBuildBonus),
    wall: level(rules.twilightErosion),
    keep: level(rules.twilightKeepErosion),
    end: twilightDeadline(rules),
  };
}

/** Turns before it starts, its level and the turns left, or null when it is off or still far away. */
export interface TwilightStatus {
  level: number;
  /** Turns until it falls (level 0) or until the game is decided (level 1+; 0 means this is the last turn). */
  turns: number;
  /** Turns until the next level. */
  next: number;
}

export function twilightStatus(board: { rules: Rules; turn: number }, warnAhead = 6): TwilightStatus | null {
  if (!twilightOn(board.rules)) return null;
  const level = twilightLevel(board);
  if (level === 0) {
    const turns = board.rules.twilightTurn - board.turn;
    return turns <= warnAhead ? { level, turns, next: turns } : null;
  }
  const end = twilightDeadline(board.rules);
  const every = Math.max(1, board.rules.twilightEvery ?? 1);
  const next = every - ((board.turn - board.rules.twilightTurn) % every);
  return { level, turns: end > 0 ? Math.max(0, end - board.turn) : -1, next };
}

/** Short line for the chip: when it falls, or its level and how long is left. */
export function twilightLine(status: TwilightStatus): string {
  if (status.level === 0) return t('twilightSoon', { n: status.turns });
  if (status.turns === 0) return t('twilightLast', { level: status.level });
  if (status.turns < 0) return t('twilightLevel', { level: status.level, n: status.next });
  return t('twilightNow', { level: status.level, n: status.turns });
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
