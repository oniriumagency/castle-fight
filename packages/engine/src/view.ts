import { isUltimateReady } from './actions';
import { other, ultimateThreshold } from './core';
import type {
  GameEvent,
  GameState,
  PendingChoiceView,
  PlayerId,
  PlayerPublicState,
  PlayerView,
} from './types';

/**
 * Hidden information. The full `GameState` holds both hands, both decks and
 * the RNG; it must stay on the server. Clients get a `PlayerView` and a
 * redacted event list.
 */

function publicPlayer(state: GameState, player: PlayerId, viewer: PlayerId): PlayerPublicState {
  const p = state.players[player];
  const visible = player === viewer || p.handRevealed;
  return {
    hero: p.hero,
    keep: p.keep,
    wall: p.wall,
    resources: { ...p.resources },
    workers: { ...p.workers },
    enchantments: p.enchantments.map((e) => ({ ...e })),
    burn: p.burn,
    frost: { ...p.frost },
    shield: p.shield,
    drawbridge: p.drawbridge,
    handRevealed: p.handRevealed,
    ultimateCharge: p.ultimateCharge,
    ultimateThreshold: ultimateThreshold(state, player),
    ultimateReady: isUltimateReady(state, player),
    extraTurns: p.extraTurns,
    lastPlayedCard: p.lastPlayedCard,
    comboSchool: p.comboSchool,
    hand: p.hand.map((c) => ({ uid: c.uid, cardId: visible ? c.cardId : null })),
    deckCount: p.deck.length,
    discardCount: p.discard.length,
  };
}

/** The game as `viewer` is allowed to see it. */
export function getPlayerView(state: GameState, viewer: PlayerId): PlayerView {
  let pending: PendingChoiceView | null = null;
  if (state.pending) {
    const mine = state.pending.player === viewer;
    pending = {
      player: state.pending.player,
      kind: state.pending.kind,
      options: mine ? state.pending.options.slice() : [],
      ...(mine && state.pending.revealed
        ? { revealed: state.pending.revealed.map((c) => ({ ...c })) }
        : {}),
    };
  }
  return {
    viewer,
    rules: state.rules,
    seq: state.seq,
    turn: state.turn,
    active: state.active,
    phase: state.phase,
    actionsLeft: state.actionsLeft,
    extraTurn: state.extraTurn,
    players: [publicPlayer(state, 0, viewer), publicPlayer(state, 1, viewer)],
    pending,
    activeEvent: state.activeEvent ? { ...state.activeEvent } : null,
    upcomingEvent: { ...state.upcomingEvent },
    result: state.result ? { ...state.result } : null,
  };
}

/**
 * The events `viewer` is allowed to see: cards the opponent draws are hidden
 * (unless their hand is revealed) and so are the details of choices the
 * opponent is making. Everything else in the log is public.
 */
export function redactEvents(events: readonly GameEvent[], viewer: PlayerId): GameEvent[] {
  return events.map((event) => {
    switch (event.type) {
      case 'cardsDrawn':
        if (event.player === viewer || event.visible) return event;
        return { ...event, cards: event.cards.map((c) => ({ uid: c.uid, cardId: null })) };
      case 'choiceRequested': {
        if (event.player === viewer) return event;
        return { type: event.type, player: event.player, kind: event.kind, options: [] };
      }
      case 'handRevealed':
        // The hand of `event.player` is shown to the other player, who is the only one who needs it.
        return event.player === other(viewer) ? event : { ...event, cards: [] };
      default:
        return event;
    }
  });
}
