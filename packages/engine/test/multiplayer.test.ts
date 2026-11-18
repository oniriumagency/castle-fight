import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getPlayerView, legalActions, playGame, randomPolicy, eagerPolicy } from '../src/index';
import { mustApply, setHand } from '../src/testing';
import type { GameState, Rules } from '../src/types';

/** A 3-player game on turn 1, player 0 to move, everyone level and rich. */
function threeWay(rules: Partial<Rules> = {}): GameState {
  const { state } = createGame({
    seed: 3,
    heroes: ['guardian', 'guardian', 'guardian'],
    firstPlayer: 0,
    rules: { secondPlayerWall: 0, ...rules },
  });
  for (const p of state.players) {
    p.resources = { piedra: 50, acero: 50, mana: 50 };
    p.wall = state.rules.wallStart;
  }
  state.actionsLeft = 2;
  return state;
}

describe('three players', () => {
  it('deals three hands and plays in a circle', () => {
    const { state } = createGame({ seed: 1, heroes: ['mariscal', 'mariscal', 'mariscal'], firstPlayer: 1 });
    expect(state.players).toHaveLength(3);
    expect(state.players.every((p) => p.hand.length === state.rules.handSize)).toBe(true);
    // Later seats get a taller Wall for the lost tempo.
    const step = state.rules.secondPlayerWall;
    expect(state.players[2]!.wall - state.players[1]!.wall).toBe(step);
    expect(state.players[0]!.wall - state.players[1]!.wall).toBe(2 * step);

    let s = state;
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(s.active);
      s = mustApply(s, { type: 'discard', player: s.active, uid: s.players[s.active]!.hand[0]!.uid }).state;
    }
    expect(order).toEqual([1, 2, 0, 1, 2, 0]);
  });

  it('in "all" mode an attack hits every rival, scaled', () => {
    const state = threeWay({ multiTargeting: 'all', multiAllScale: 0.6 });
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const keep = state.rules.keepStart;
    const after = mustApply(state, { type: 'play', player: 0, uid: state.players[0]!.hand[0]!.uid }).state;
    expect(after.players[1]!.keep).toBe(keep - 6);
    expect(after.players[2]!.keep).toBe(keep - 6);
    expect(after.players[0]!.keep).toBe(keep);
  });

  it('in "choose" mode an attack hits only the chosen rival, and legal actions offer each target', () => {
    const state = threeWay({ multiTargeting: 'choose' });
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const plays = legalActions(state).filter((a) => a.type === 'play');
    expect(plays.map((a) => (a.type === 'play' ? a.target : null)).sort()).toEqual([1, 1, 2, 2]);

    const uid = state.players[0]!.hand[0]!.uid;
    const after = mustApply(state, { type: 'play', player: 0, uid, target: 2 }).state;
    expect(after.players[2]!.keep).toBe(state.rules.keepStart - 10);
    expect(after.players[1]!.keep).toBe(state.rules.keepStart);

    const bad = applyAction(state, { type: 'play', player: 0, uid, target: 0 });
    expect(bad.ok).toBe(false);
  });

  it('the leader takes extra damage when the rule is on', () => {
    const state = threeWay({ multiTargeting: 'choose', leaderExtraDamage: 2 });
    state.players[1]!.keep = state.rules.keepStart + 5;
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const uid = state.players[0]!.hand[0]!.uid;
    const after = mustApply(state, { type: 'play', player: 0, uid, target: 1 }).state;
    expect(after.players[1]!.keep).toBe(state.rules.keepStart + 5 - 12);
  });

  it('a fallen castle is eliminated, skipped in turn order, and the last one standing wins', () => {
    const state = threeWay({ multiTargeting: 'choose', eliminationBounty: 5 });
    state.players[1]!.keep = 5;
    state.players[1]!.wall = 0;
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const { state: after, events } = mustApply(state, {
      type: 'play',
      player: 0,
      uid: state.players[0]!.hand[0]!.uid,
      target: 1,
    });
    expect(after.players[1]!.eliminated).toBe(true);
    expect(after.phase).not.toBe('finished');
    expect(events).toContainEqual({ type: 'playerEliminated', player: 1, by: 0 });
    expect(after.players[0]!.resources.piedra).toBeGreaterThanOrEqual(state.players[0]!.resources.piedra + 5);

    // Finish player 0's turn: the next turn belongs to player 2, not the fallen player 1.
    const next = mustApply(after, { type: 'discard', player: 0, uid: after.players[0]!.hand[0]!.uid }).state;
    expect(next.active).toBe(2);
    expect(applyAction(next, { type: 'concede', player: 1 }).ok).toBe(false);

    // Player 2 concedes: player 0 is the last castle standing.
    const end = mustApply(next, { type: 'concede', player: 2 }).state;
    expect(end.result).toEqual({ winner: 0, reason: 'concede' });
  });

  it('views show every castle and hide rival hands', () => {
    const state = threeWay();
    expect(state.rules.multiTargeting).toBe('all');
    const view = getPlayerView(state, 1);
    expect(view.players).toHaveLength(3);
    expect(view.players[1]!.hand.every((c) => c.cardId !== null)).toBe(true);
    expect(view.players[0]!.hand.every((c) => c.cardId === null)).toBe(true);
    expect(view.players[2]!.hand.every((c) => c.cardId === null)).toBe(true);
  });

  for (const multiTargeting of ['all', 'choose'] as const) {
    it(`random playouts finish cleanly in "${multiTargeting}" mode`, () => {
      for (let i = 0; i < 40; i++) {
        const result = playGame({
          seed: `ffa-${multiTargeting}-${i}`,
          heroes: ['guardian', 'arquitecta', 'mariscal'],
          rules: { multiTargeting, leaderExtraDamage: 2, eliminationBounty: 5 },
          policy: i % 2 ? randomPolicy : eagerPolicy,
          onStep: (s) => {
            for (const p of s.players) {
              expect(p.keep).toBeGreaterThanOrEqual(0);
              expect(p.wall).toBeGreaterThanOrEqual(0);
            }
            if (s.phase !== 'finished') expect(s.players[s.active]!.eliminated).toBeFalsy();
          },
        });
        expect(result.reason).not.toBe('maxActions');
      }
    });
  }
});
