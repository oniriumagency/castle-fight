import { describe, expect, it } from 'vitest';
import { getPlayerView, redactEvents } from '../src/index';
import { eventsOf, playCard, scenario } from '../src/testing';

const ME = 0;
const OPP = 1;

describe('player view', () => {
  it('shows my hand and hides the opponent\'s cards, decks and the RNG', () => {
    const state = scenario();
    const view = getPlayerView(state, ME);
    expect(view.viewer).toBe(ME);
    expect(view.players[ME].hand).toEqual(state.players[ME].hand);
    expect(view.players[OPP].hand).toHaveLength(6);
    expect(view.players[OPP].hand.every((c) => c.cardId === null)).toBe(true);
    expect(view.players[OPP].hand.map((c) => c.uid)).toEqual(state.players[OPP].hand.map((c) => c.uid));
    expect(view.players[OPP].deckCount).toBe(state.players[OPP].deck.length);
    const json = JSON.stringify(view);
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('"deck"');
    for (const card of state.players[OPP].hand) {
      // No opponent card id leaks unless I hold a copy of the same card myself.
      if (!state.players[ME].hand.some((c) => c.cardId === card.cardId)) expect(json).not.toContain(`"${card.cardId}"`);
    }
  });

  it('shows a revealed hand (Watchtower) to the opponent', () => {
    const { state, events } = playCard(scenario({ hand: ['torre-vigia'] }), 'torre-vigia');
    expect(getPlayerView(state, ME).players[OPP].hand).toEqual(state.players[OPP].hand);
    expect(getPlayerView(state, OPP).players[ME].hand.every((c) => c.cardId === null)).toBe(true);
    // The reveal event carries the cards only for the player who gets to see them.
    expect(eventsOf(redactEvents(events, ME), 'handRevealed')[0]!.cards).toHaveLength(6);
    expect(eventsOf(redactEvents(events, OPP), 'handRevealed')[0]!.cards).toEqual([]);
  });

  it('shows the Spy\'s choice only to the player choosing', () => {
    const { state, events } = playCard(
      scenario({ hand: ['espia-en-la-corte'], opponentHand: ['parapeto', 'catapulta'] }),
      'espia-en-la-corte',
    );
    const mine = getPlayerView(state, ME).pending!;
    expect(mine.options).toHaveLength(2);
    expect(mine.revealed!.map((c) => c.cardId)).toEqual(['parapeto', 'catapulta']);
    const theirs = getPlayerView(state, OPP).pending!;
    expect(theirs).toEqual({ player: ME, kind: 'discardFromHand', options: [] });
    expect(eventsOf(redactEvents(events, OPP), 'choiceRequested')[0]).toEqual({
      type: 'choiceRequested',
      player: ME,
      kind: 'discardFromHand',
      options: [],
    });
    expect(eventsOf(redactEvents(events, ME), 'choiceRequested')[0]!.revealed).toHaveLength(2);
  });

  it('hides the cards the opponent draws', () => {
    const { events } = playCard(scenario({ hand: ['parapeto'], keepTurn: false }), 'parapeto');
    const drawnForMe = eventsOf(redactEvents(events, ME), 'cardsDrawn')[0]!;
    const drawnForThem = eventsOf(redactEvents(events, OPP), 'cardsDrawn')[0]!;
    expect(drawnForMe.cards.every((c) => c.cardId !== null)).toBe(true);
    expect(drawnForThem.cards.every((c) => c.cardId === null)).toBe(true);
    expect(drawnForThem.cards.map((c) => c.uid)).toEqual(drawnForMe.cards.map((c) => c.uid));
  });

  it('exposes what the UI needs about the ultimate and the next event', () => {
    const view = getPlayerView(scenario({ you: { ultimateCharge: 20 } }), OPP);
    expect(view.players[ME]).toMatchObject({ ultimateCharge: 20, ultimateThreshold: 20, ultimateReady: true });
    expect(view.players[OPP].ultimateReady).toBe(false);
    expect(view.upcomingEvent.turn).toBe(9);
  });
});
