import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, attackBonus, twilightDeadline, twilightLevel } from '../src/index';
import type { GameState, Rules } from '../src/index';
import { discardCard, eventsOf, playCard, scenario } from '../src/testing';

const ME = 0;
const OPP = 1;

/** Twilight numbers used here, so the tests do not move when the defaults are tuned. */
const FURY: Partial<Rules> = {
  twilightTurn: 2,
  twilightEvery: 2,
  twilightAttackBonus: 3,
  twilightErosion: 3,
  twilightKeepErosion: 2,
  twilightBuildBonus: 3,
  twilightTurns: 6,
};

/** Player 0 on `turn`, with the Fury rules above. */
function onTurn(turn: number, extra: Parameters<typeof scenario>[0] = {}): GameState {
  const state = scenario({ ...extra, rules: { ...FURY, ...extra.rules } });
  state.turn = turn;
  return state;
}

describe('Twilight Fury', () => {
  it('is on by default and starts around the sixth minute', () => {
    expect(DEFAULT_RULES.twilightTurn).toBeGreaterThan(0);
    expect(twilightDeadline(DEFAULT_RULES)).toBe(DEFAULT_RULES.twilightTurn + DEFAULT_RULES.twilightTurns - 1);
  });

  it('rises one level every few turns from its first turn', () => {
    const rules = { ...DEFAULT_RULES, ...FURY } as Rules;
    expect([1, 2, 3, 4, 5, 6, 7].map((turn) => twilightLevel({ rules, turn }))).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(twilightDeadline(rules)).toBe(7);
  });

  it('does nothing when the room turned it off, or in saves from before it existed', () => {
    const off = { ...DEFAULT_RULES, twilightTurn: 0 } as Rules;
    expect(twilightLevel({ rules: off, turn: 500 })).toBe(0);
    expect(twilightDeadline(off)).toBe(0);
    const old = { ...DEFAULT_RULES } as Partial<Rules>;
    delete old.twilightTurn;
    expect(twilightLevel({ rules: old as Rules, turn: 500 })).toBe(0);

    const start = scenario({ rules: { ...FURY, twilightTurn: 0 }, keepTurn: false });
    const { state, events } = discardCard(start);
    expect(eventsOf(events, 'twilightRose')).toEqual([]);
    expect(state.players[OPP]!.wall).toBe(start.players[OPP]!.wall);
  });

  it('is announced when it falls and erodes the Wall and Castle of whoever starts a turn', () => {
    const start = scenario({ rules: FURY, keepTurn: false, opponent: { wall: 10, keep: 40 } });
    const { state, events } = discardCard(start);
    expect(state.turn).toBe(2);
    expect(eventsOf(events, 'twilightRose')).toEqual([{ type: 'twilightRose', level: 1, deadline: 7 }]);
    expect(state.players[OPP]!.wall).toBe(7);
    expect(state.players[OPP]!.keep).toBe(38);
    // Not an attack: no ultimate charge.
    expect(state.players[OPP]!.ultimateCharge).toBe(0);
    // Turn 3 is the same level: no new announcement.
    expect(eventsOf(discardCard(state).events, 'twilightRose')).toEqual([]);
  });

  it('never knocks a Castle down by itself', () => {
    const start = scenario({ rules: FURY, keepTurn: false, opponent: { wall: 0, keep: 2 } });
    const { state } = discardCard(start);
    expect(state.players[OPP]!.keep).toBe(1);
    expect(state.phase).not.toBe('finished');
  });

  it('makes every attack hit harder, per level', () => {
    const state = onTurn(4, { hand: ['escaramuza', 'escaramuza'], opponent: { wall: 0, keep: 50 } });
    expect(attackBonus(state, ME)).toBe(6);
    const after = playCard(state, 'escaramuza').state;
    expect(after.players[OPP]!.keep).toBe(50 - 5 - 6);
  });

  it('makes cards that raise the Castle build more, per level', () => {
    const state = onTurn(6, { hand: ['cimientos', 'cimientos'], you: { keep: 50 } });
    const after = playCard(state, 'cimientos').state;
    expect(after.players[ME]!.keep).toBe(50 + 7 + 9);
  });

  it('decides the game at its deadline: highest Castle, then Wall', () => {
    const finish = (you: { keep: number; wall: number }): GameState['result'] => {
      const start = onTurn(7, { keepTurn: false, you, opponent: { keep: 50, wall: 15 } });
      return discardCard(start).state.result;
    };
    expect(finish({ keep: 51, wall: 0 })).toEqual({ winner: ME, reason: 'twilight' });
    expect(finish({ keep: 49, wall: 50 })).toEqual({ winner: OPP, reason: 'twilight' });
    expect(finish({ keep: 50, wall: 15 })).toEqual({ winner: null, reason: 'twilight' });
  });
});
