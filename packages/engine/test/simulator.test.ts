import { describe, expect, it } from 'vitest';
import {
  CARDS,
  DEFAULT_RULES,
  HEROES,
  buildDeckList,
  getPlayerView,
  playGame,
  randomPolicy,
  redactEvents,
  simulate,
} from '../src/index';
import type { GameState } from '../src/index';

const DECK_SIZE = buildDeckList(DEFAULT_RULES).length;

/** Things that must hold after every single action of every game. */
function checkInvariants(state: GameState): void {
  for (const p of state.players) {
    expect(p.keep).toBeGreaterThanOrEqual(0);
    expect(p.keep).toBeLessThanOrEqual(state.rules.keepWin);
    expect(p.wall).toBeGreaterThanOrEqual(0);
    for (const r of ['piedra', 'acero', 'mana'] as const) {
      expect(p.resources[r]).toBeGreaterThanOrEqual(0);
      expect(p.workers[r]).toBeGreaterThanOrEqual(state.rules.minWorkers);
      expect(p.frost[r]).toBeGreaterThanOrEqual(0);
      expect(p.frost[r]).toBeLessThanOrEqual(state.rules.frostMaxTurns);
    }
    expect(p.burn).toBeGreaterThanOrEqual(0);
    expect(p.burn).toBeLessThanOrEqual(state.rules.burnMaxTurns);
    expect(p.shield).toBeGreaterThanOrEqual(0);
    expect(p.shield).toBeLessThanOrEqual(state.rules.shieldMaxCharges);
    expect(p.enchantments.length).toBeLessThanOrEqual(state.rules.maxEnchantments);
    expect(p.hand.length).toBeLessThanOrEqual(state.rules.handSize);
    // No card is ever created or lost.
    expect(p.hand.length + p.deck.length + p.discard.length).toBe(DECK_SIZE);
  }
  const uids = state.players.flatMap((p) => p.hand.map((c) => c.uid));
  expect(new Set(uids).size).toBe(uids.length);
  if (state.phase === 'finished') expect(state.result).not.toBeNull();
  else {
    expect(state.result).toBeNull();
    expect(state.phase === 'choice').toBe(state.pending !== null);
    if (state.phase === 'action') {
      expect(state.actionsLeft).toBeGreaterThan(0);
      expect(state.players[state.active].hand.length).toBeGreaterThan(0);
    }
  }
}

describe('random playouts', () => {
  it('300 games with every hero pairing finish cleanly and keep the invariants', () => {
    const heroes = HEROES.map((h) => h.id);
    const played = new Set<string>();
    const reasons = new Set<string>();
    let game = 0;
    for (let round = 0; round < 9; round++) {
      for (const a of heroes) {
        for (const b of heroes) {
          if (game >= 300) continue;
          const result = playGame({
            seed: `playout:${game}`,
            heroes: [a, b],
            // One game in three is fully random; the rest use the default eager policy.
            ...(game % 3 === 0 ? { policy: randomPolicy } : {}),
            onStep: checkInvariants,
          });
          game += 1;
          expect(result.reason).not.toBe('maxActions');
          expect(result.finalState.phase).toBe('finished');
          reasons.add(result.reason);
          for (const cards of result.played) for (const id of cards) played.add(id);
        }
      }
    }
    expect(game).toBe(300);
    // Every card got played somewhere, and games end in more than one way.
    expect([...played].sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect(reasons.has('keepDestroyed')).toBe(true);
    expect(reasons.has('keepBuilt')).toBe(true);
  });

  it('views and redacted events stay serialisable and leak nothing during a game', () => {
    playGame({
      seed: 'views',
      heroes: ['hechicera', 'saboteadora'],
      onStep: (state) => {
        for (const viewer of [0, 1] as const) {
          const view = getPlayerView(state, viewer);
          expect(JSON.parse(JSON.stringify(view))).toEqual(view);
          const opponent = view.players[viewer === 0 ? 1 : 0];
          if (!opponent.handRevealed) expect(opponent.hand.every((c) => c.cardId === null)).toBe(true);
        }
      },
    });
    expect(redactEvents([], 0)).toEqual([]);
  });

  it('is deterministic: the same seed gives the same game', () => {
    const a = playGame({ seed: 123, heroes: ['mariscal', 'alquimista'] });
    const b = playGame({ seed: 123, heroes: ['mariscal', 'alquimista'] });
    const c = playGame({ seed: 124, heroes: ['mariscal', 'alquimista'] });
    expect(a.actions).toEqual(b.actions);
    expect(a.finalState).toEqual(b.finalState);
    expect(a.finalState).not.toEqual(c.finalState);
  });

  it('summarises many games', () => {
    const report = simulate({ games: 200, seed: 'report' });
    expect(report.games).toBe(200);
    expect(report.averageTurns).toBeGreaterThan(5);
    expect(report.maxTurns).toBeLessThanOrEqual(DEFAULT_RULES.turnLimit);
    expect(Object.values(report.reasons).reduce((a, b) => a + b, 0)).toBe(200);
    expect(Object.values(report.heroes).reduce((a, h) => a + h.games, 0)).toBe(400);
    expect(report.firstPlayerWinRate).toBeGreaterThan(0.3);
    expect(report.firstPlayerWinRate).toBeLessThan(0.7);
    expect(simulate({ games: 200, seed: 'report' })).toEqual(report);
  });
});
