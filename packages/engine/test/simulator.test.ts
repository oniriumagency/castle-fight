import { describe, expect, it } from 'vitest';
import {
  CARDS,
  DEFAULT_RULES,
  HEROES,
  buildDeckList,
  getPlayerView,
  legalActions,
  playGame,
  randomPolicy,
  redactEvents,
  simulate,
} from '../src/index';
import type { GameState } from '../src/index';

const DECK_SIZE = buildDeckList(DEFAULT_RULES).length;

/**
 * Things that must hold after every single action of every game. It runs
 * tens of thousands of times, so it uses plain comparisons and reports the
 * broken rules instead of calling `expect` for each one.
 */
function brokenInvariants(state: GameState): string[] {
  const broken: string[] = [];
  const check = (ok: boolean, rule: string): void => {
    if (!ok) broken.push(rule);
  };
  const { rules } = state;
  for (const p of state.players) {
    check(p.keep >= 0, 'keep >= 0');
    check(p.wall >= 0, 'wall >= 0');
    for (const r of ['piedra', 'acero', 'mana'] as const) {
      check(p.resources[r] >= 0, `${r} >= 0`);
      check(p.workers[r] >= rules.minWorkers, `${r} workers >= minWorkers`);
      check(p.frost[r] >= 0 && p.frost[r] <= rules.frostMaxTurns, `${r} frost within cap`);
    }
    check(p.burn >= 0 && p.burn <= rules.burnMaxTurns, 'burn within cap');
    check(p.shield >= 0 && p.shield <= rules.shieldMaxCharges, 'shield within cap');
    check(p.ultimateCharge >= 0, 'ultimate charge >= 0');
    check(p.enchantments.length <= rules.maxEnchantments, 'enchantments within max');
    check(p.hand.length <= rules.handSize, 'hand within size');
    // No card is ever created or lost.
    check(p.hand.length + p.deck.length + p.discard.length === DECK_SIZE, 'cards conserved');
  }
  const uids = state.players.flatMap((p) => p.hand.map((c) => c.uid));
  check(new Set(uids).size === uids.length, 'unique card uids');
  if (state.phase === 'finished') {
    check(state.result !== null, 'finished game has a result');
  } else {
    check(state.result === null, 'running game has no result');
    check((state.phase === 'choice') === (state.pending !== null), 'pending matches phase');
    if (state.phase === 'action') {
      check(state.actionsLeft > 0, 'action phase has an action left');
      check(state.players[state.active].hand.length > 0, 'active player has cards');
    }
  }
  return broken;
}

function checkInvariants(state: GameState): void {
  const broken = brokenInvariants(state);
  if (broken.length > 0) expect(broken, `turn ${state.turn}, action ${state.seq}`).toEqual([]);
}

describe('random playouts', () => {
  it('the invariant checker notices a broken state', () => {
    const { finalState } = playGame({ seed: 'broken', heroes: ['guardian', 'mariscal'], maxActions: 3 });
    expect(brokenInvariants(finalState)).toEqual([]);
    finalState.players[0].wall = -1;
    finalState.players[1].deck.pop();
    expect(brokenInvariants(finalState)).toEqual(['wall >= 0', 'cards conserved']);
  });

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
  }, 60_000);

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
          // A client can work out its own legal moves from its view alone.
          expect(legalActions(view)).toEqual(viewer === state.active ? legalActions(state) : []);
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
