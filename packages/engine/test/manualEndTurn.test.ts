import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, applyAction, canEndTurn, createGame, getPlayerView, legalActions } from '../src/index';
import type { Action, GameState } from '../src/index';
import { mustApply } from '../src/testing';

/** A real game with the "Ready" button: the turn waits for `endTurn`. */
function start(): GameState {
  return createGame({ seed: 7, heroes: ['arquitecta', 'mariscal'], firstPlayer: 0, rules: { manualEndTurn: true } }).state;
}

function errorCode(state: GameState, action: Action): string | null {
  const result = applyAction(state, action);
  return result.ok ? null : result.error.code;
}

function discardFirst(state: GameState): GameState {
  const player = state.active;
  return mustApply(state, { type: 'discard', player, uid: state.players[player].hand[0]!.uid }).state;
}

describe('manual end of turn ("Ready")', () => {
  it('keeps the turn after the card until the player says Ready', () => {
    const before = start();
    expect(canEndTurn(before)).toBe(false);
    expect(errorCode(before, { type: 'endTurn', player: 0 })).toBe('mustPlayFirst');

    const played = discardFirst(before);
    expect(played.active).toBe(0);
    expect(played.turn).toBe(before.turn);
    expect(played.phase).toBe('action');
    expect(played.actionsLeft).toBe(0);
    expect(canEndTurn(played)).toBe(true);
    expect(legalActions(played)).toEqual([{ type: 'endTurn', player: 0 }]);
    // Only one card per turn.
    const uid = played.players[0].hand[0]!.uid;
    expect(errorCode(played, { type: 'play', player: 0, uid })).toBe('noPlaysLeft');
    expect(errorCode(played, { type: 'discard', player: 0, uid })).toBe('noPlaysLeft');
    // The rival cannot end someone else's turn.
    expect(errorCode(played, { type: 'endTurn', player: 1 })).toBe('notYourTurn');

    const { state, events } = mustApply(played, { type: 'endTurn', player: 0 });
    expect(state.active).toBe(1);
    expect(state.turn).toBe(before.turn + 1);
    expect(events.map((e) => e.type)).toContain('turnEnded');
  });

  it('lets the player use the ultimate after the card', () => {
    const before = start();
    before.players[0].ultimateCharge = DEFAULT_RULES.ultimateCharge;
    const played = discardFirst(before);
    expect(legalActions(played).map((a) => a.type).sort()).toEqual(['endTurn', 'ultimate']);
    const after = mustApply(played, { type: 'ultimate', player: 0 }).state;
    expect(after.active).toBe(0);
    expect(after.players[0].ultimateUses).toBe(1);
    expect(mustApply(after, { type: 'endTurn', player: 0 }).state.active).toBe(1);
  });

  it('works from a player view too (what the client sees)', () => {
    const played = discardFirst(start());
    const view = getPlayerView(played, 0);
    expect(canEndTurn(view)).toBe(true);
    expect(legalActions(view)).toEqual([{ type: 'endTurn', player: 0 }]);
    expect(legalActions(getPlayerView(played, 1))).toEqual([]);
  });

  it('ends a waiting turn when the clock runs out, without discarding', () => {
    const played = discardFirst(start());
    const handBefore = played.players[0].hand.length;
    const { state, events } = mustApply(played, { type: 'timeout' });
    expect(state.active).toBe(1);
    expect(state.players[0].hand.length).toBe(handBefore);
    expect(events.filter((e) => e.type === 'cardDiscarded')).toEqual([]);
  });

  it('ends the turn after the card when the rule is off', () => {
    const { state } = createGame({ seed: 7, heroes: ['arquitecta', 'mariscal'], firstPlayer: 0 });
    expect(discardFirst(state).active).toBe(1);
    expect(errorCode(state, { type: 'endTurn', player: 0 })).toBe('invalidAction');
  });
});
