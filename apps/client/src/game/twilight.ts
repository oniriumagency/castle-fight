import { twilightDeadline, twilightLevel, type Rules } from '@cardcraft-castles/engine';
import { t } from '../app/i18n';

/** Twilight Fury helpers for the interface. Rules from older saves may lack its fields: then it is off. */

export function twilightOn(rules: Rules): boolean {
  return (rules.twilightTurn ?? 0) > 0;
}

/** Placeholder values for the rule texts. */
export function twilightValues(rules: Rules): Record<string, number> {
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
