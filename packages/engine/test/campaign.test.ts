import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, applyAction, buildDeckList, createGame, effectiveCost, getPlayerView, isUltimateReady, legalActions } from '../src/index';
import type { GameState } from '../src/index';
import { mustApply } from '../src/testing';

/** Per-seat options used by the campaign: own deck lists, captains without a passive, a locked ultimate. */
describe('seat options (campaign)', () => {
  const deck = ['escaramuza', 'escaramuza', 'parapeto', 'parapeto', 'cimientos', 'cimientos', 'chispa-arcana', 'chispa-arcana', 'hilada-de-piedra', 'hilada-de-piedra', 'carga-de-lanceros', 'carga-de-lanceros'];

  it('builds each seat its own deck from its list', () => {
    const { state } = createGame({ seed: 1, heroes: ['arquitecta', 'guardian'], seats: [{ deck }] });
    const p0 = state.players[0];
    const owned = [...p0.deck, ...p0.hand.map((c) => c.cardId), ...p0.discard].sort();
    expect(owned).toEqual(deck.slice().sort());
    expect(p0.deckList).toEqual(deck.slice().sort());
    // The other seat keeps the common deck.
    expect(state.players[1].deckList).toBeUndefined();
    expect(state.players[1].deck.length + state.players[1].hand.length).toBe(buildDeckList(state.rules).length);
    // The list is public: the rival can see what the deck is made of.
    expect(getPlayerView(state, 1).players[0].deckList).toEqual(deck.slice().sort());
  });

  it('rejects unknown cards and tiny decks', () => {
    expect(() => createGame({ seed: 1, heroes: ['arquitecta', 'guardian'], seats: [{ deck: [...deck, 'nope'] }] })).toThrow();
    expect(() => createGame({ seed: 1, heroes: ['arquitecta', 'guardian'], seats: [{ deck: deck.slice(0, 5) }] })).toThrow();
  });

  it('a captain plays without the hero passive', () => {
    const { state } = createGame({ seed: 2, heroes: ['arquitecta', 'guardian'], seats: [{ noPassive: true }, { noPassive: true }], firstPlayer: 0 });
    expect(effectiveCost(state, 0, 'parapeto')).toBe(4);
    // The Warden's +7 starting Wall is a passive too (seat 1 also gets the second-player bonus).
    expect(state.players[1].wall).toBe(DEFAULT_RULES.wallStart + DEFAULT_RULES.secondPlayerWall);
    expect(getPlayerView(state, 0).players[1].noPassive).toBe(true);
  });

  it('a locked ultimate never charges and is never offered', () => {
    const { state } = createGame({ seed: 3, heroes: ['mariscal', 'arquitecta'], seats: [{}, { ultimateLocked: true }], firstPlayer: 0 });
    const s: GameState = structuredClone(state);
    s.players[1].ultimateCharge = 999;
    expect(isUltimateReady(s, 1)).toBe(false);
    // Damage taken does not charge it.
    const fresh: GameState = structuredClone(state);
    fresh.players[0].hand[0] = { uid: fresh.players[0].hand[0]!.uid, cardId: 'carga-de-caballeria' };
    const after = mustApply(fresh, { type: 'play', player: 0, uid: fresh.players[0].hand[0]!.uid }).state;
    expect(after.players[1].ultimateCharge).toBe(0);
    s.active = 1;
    expect(legalActions(s).some((a) => a.type === 'ultimate')).toBe(false);
    expect(applyAction(s, { type: 'ultimate', player: 1 }).ok).toBe(false);
  });
});

describe('first battle event (campaign terrains)', () => {
  it('can be fixed', () => {
    for (const seed of [1, 2, 3]) {
      expect(createGame({ seed, heroes: ['arquitecta', 'guardian'], firstEvent: 'tregua' }).state.upcomingEvent.id).toBe('tregua');
    }
    expect(() => createGame({ seed: 1, heroes: ['arquitecta', 'guardian'], firstEvent: 'nope' as never })).toThrow();
  });
});
