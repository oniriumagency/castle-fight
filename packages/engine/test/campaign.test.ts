import { describe, expect, it } from 'vitest';
import { CARDS, DEFAULT_RULES, EXCLUSIVE_CARD_DEPTH, applyAction, buildDeckList, createGame, effectiveCost, getPlayerView, isUltimateReady, legalActions } from '../src/index';
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

/** Divine cards: never in the common deck, one copy for the player who won it, early in the deck. */
describe('exclusive cards (Divine)', () => {
  const divine = CARDS.filter((c) => c.rarity === 'divina').map((c) => c.id);

  it('the common deck has no Divine card', () => {
    expect(divine).toHaveLength(6);
    expect(buildDeckList(DEFAULT_RULES).some((id) => divine.includes(id))).toBe(false);
  });

  it('joins only its owner’s deck, once, within the first draws', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { state } = createGame({ seed, heroes: ['arquitecta', 'guardian'], seats: [{ exclusiveCards: ['plano-de-la-corona', 'plano-de-la-corona'] }] });
      const p0 = state.players[0];
      const all = [...p0.deck, ...p0.hand.map((c) => c.cardId)];
      expect(all.filter((id) => id === 'plano-de-la-corona')).toHaveLength(1);
      expect(all).toHaveLength(buildDeckList(DEFAULT_RULES).length + 1);
      // Drawn from the end of the deck: in the hand already or among the next draws.
      const fromTop = p0.hand.some((c) => c.cardId === 'plano-de-la-corona') ? 0 : p0.deck.length - p0.deck.lastIndexOf('plano-de-la-corona');
      expect(p0.hand.length + fromTop).toBeLessThanOrEqual(EXCLUSIVE_CARD_DEPTH);
      expect(p0.deckList).toContain('plano-de-la-corona');
      const p1 = state.players[1];
      expect([...p1.deck, ...p1.hand.map((c) => c.cardId)]).not.toContain('plano-de-la-corona');
    }
  });

  it('adds to a campaign deck too, and rejects unknown ids', () => {
    const { state } = createGame({ seed: 3, heroes: ['arquitecta', 'guardian'], seats: [{ deck, exclusiveCards: ['la-gran-mecha'] }] });
    expect(state.players[0].deckList).toEqual([...deck, 'la-gran-mecha'].sort());
    expect(() => createGame({ seed: 1, heroes: ['arquitecta', 'guardian'], seats: [{ exclusiveCards: ['nope'] }] })).toThrow();
  });

  const deck = ['escaramuza', 'escaramuza', 'parapeto', 'parapeto', 'cimientos', 'cimientos', 'chispa-arcana', 'chispa-arcana', 'hilada-de-piedra', 'hilada-de-piedra', 'carga-de-lanceros', 'carga-de-lanceros'];
});
