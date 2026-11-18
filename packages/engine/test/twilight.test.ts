import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, attackBonus, createGame, getPlayerView, roundOf, twilightLevel } from '../src/index';
import type { GameState, Rules } from '../src/index';
import { discardCard, eventsOf, playCard, scenario } from '../src/testing';

const ME = 0;
const OPP = 1;

/** Twilight numbers used here, so the tests do not move when the defaults are tuned. */
const FURY: Partial<Rules> = {
  twilightRound: 2,
  twilightEvery: 2,
  twilightAttackBonus: 3,
  twilightDamage: 5,
  twilightBuildBonus: 3,
};

/** Player 0 to move in `round`, with the Fury rules above. */
function inRound(round: number, extra: Parameters<typeof scenario>[0] = {}): GameState {
  const state = scenario({ ...extra, rules: { ...FURY, ...extra.rules } });
  state.round = round;
  state.turn = round * 2 - 1;
  return state;
}

const pass = (state: GameState): GameState => discardCard(state).state;

describe('rounds', () => {
  it('a round is every player taking one turn, counted from whoever moved first', () => {
    let state = createGame({ seed: 'r', heroes: ['guardian', 'guardian', 'guardian'], firstPlayer: 1 }).state;
    const seen: Array<[number, number]> = [];
    for (let i = 0; i < 7; i++) {
      seen.push([state.active, state.round!]);
      state = pass(state);
    }
    expect(seen).toEqual([
      [1, 1], [2, 1], [0, 1],
      [1, 2], [2, 2], [0, 2],
      [1, 3],
    ]);
    expect(getPlayerView(state, 0).round).toBe(3);
  });

  it('extra turns do not start a round', () => {
    const start = scenario({ keepTurn: false, you: { extraTurns: 1 } });
    const extra = pass(start);
    expect(extra.active).toBe(ME);
    expect(extra.round).toBe(1);
    expect(pass(pass(extra)).round).toBe(2);
  });

  it('only castles still standing take part in a round', () => {
    let state = createGame({ seed: 'r', heroes: ['guardian', 'guardian', 'guardian'], firstPlayer: 0 }).state;
    state.players[1]!.eliminated = true;
    state = pass(state); // seat 2, round 1
    expect([state.active, state.round]).toEqual([2, 1]);
    state = pass(state); // back to seat 0: round 2
    expect([state.active, state.round]).toEqual([0, 2]);
  });

  it('saves from before rounds were counted derive the round from the turn', () => {
    expect(roundOf({ turn: 21, players: [0, 1] })).toBe(11);
    expect(roundOf({ turn: 21, players: [0, 1, 2] })).toBe(7);
  });
});

describe('Twilight Fury', () => {
  it('is on by default and falls in round 11 (turn 21 in a duel)', () => {
    expect(DEFAULT_RULES.twilightRound).toBe(11);
    const rules = DEFAULT_RULES as Rules;
    expect(twilightLevel({ rules, turn: 20, players: [0, 1] })).toBe(0);
    expect(twilightLevel({ rules, turn: 21, players: [0, 1] })).toBe(1);
  });

  it('rises one level every few rounds from its first round', () => {
    const rules = { ...DEFAULT_RULES, ...FURY } as Rules;
    const at = (round: number): number => twilightLevel({ rules, turn: 0, round, players: [0, 1, 2] });
    expect([1, 2, 3, 4, 5, 6].map(at)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('does nothing when the room turned it off, or in saves from before it existed', () => {
    const off = { ...DEFAULT_RULES, twilightRound: 0 } as Rules;
    expect(twilightLevel({ rules: off, turn: 500, players: [0, 1] })).toBe(0);
    const old = { ...DEFAULT_RULES } as Partial<Rules>;
    delete old.twilightRound;
    expect(twilightLevel({ rules: old as Rules, turn: 500, players: [0, 1] })).toBe(0);

    let state = scenario({ rules: { ...FURY, twilightRound: 0 }, keepTurn: false });
    const wall = state.players[ME]!.wall;
    state = pass(pass(state));
    expect(state.players[ME]!.wall).toBe(wall);
  });

  it('is announced when its round begins and wears down whoever starts a turn', () => {
    const start = scenario({ rules: FURY, keepTurn: false, you: { wall: 10, keep: 40 }, opponent: { wall: 3, keep: 40 } });
    const second = discardCard(start); // round 1, opponent
    expect(eventsOf(second.events, 'twilightRose')).toEqual([]);
    const { state, events } = discardCard(second.state); // round 2: it falls on my turn
    expect(state.round).toBe(2);
    expect(eventsOf(events, 'twilightRose')).toEqual([{ type: 'twilightRose', level: 1 }]);
    // Normal damage: 5 at level 1, all on a Wall tall enough to take it.
    expect(state.players[ME]!.wall).toBe(5);
    expect(state.players[ME]!.keep).toBe(40);
    // Not an attack: no ultimate charge.
    expect(state.players[ME]!.ultimateCharge).toBe(0);
    // The opponent's turn in the same round wears them too, without a new announcement.
    const next = discardCard(state);
    expect(eventsOf(next.events, 'twilightRose')).toEqual([]);
    // A short Wall takes what it can and the rest reaches the Keep.
    expect(next.state.players[OPP]!.wall).toBe(0);
    expect(next.state.players[OPP]!.keep).toBe(38);
  });

  it('falls in the same round with three players', () => {
    let state = createGame({ seed: 'r', heroes: ['guardian', 'guardian', 'guardian'], firstPlayer: 0, rules: FURY }).state;
    let fell = 0;
    while (!fell) {
      const result = discardCard(state);
      state = result.state;
      if (eventsOf(result.events, 'twilightRose').length) fell = state.turn;
    }
    expect([fell, state.round]).toEqual([4, 2]);
  });

  it('never knocks a Castle down by itself', () => {
    const start = scenario({ rules: FURY, keepTurn: false, you: { wall: 0, keep: 2 } });
    const state = pass(pass(start));
    expect(state.players[ME]!.keep).toBe(1);
    expect(state.phase).not.toBe('finished');
  });

  it('makes every attack hit harder, per level', () => {
    const state = inRound(4, { hand: ['escaramuza', 'escaramuza'], opponent: { wall: 0, keep: 50 } });
    expect(attackBonus(state, ME)).toBe(6);
    const after = playCard(state, 'escaramuza').state;
    expect(after.players[OPP]!.keep).toBe(50 - 5 - 6);
  });

  it('makes cards that raise the Castle build more, per level', () => {
    const state = inRound(6, { hand: ['cimientos', 'cimientos'], you: { keep: 50 } });
    const after = playCard(state, 'cimientos').state;
    expect(after.players[ME]!.keep).toBe(50 + 7 + 9);
  });
});
