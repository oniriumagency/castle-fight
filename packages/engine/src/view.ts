import { isUltimateReady } from './actions';
import { roundOf, ultimateThreshold } from './core';
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

/** `null` is a spectator: they see no hand but the revealed ones. */
type Viewer = PlayerId | null;

function publicPlayer(state: GameState, player: PlayerId, viewer: Viewer): PlayerPublicState {
  const p = state.players[player];
  const visible = player === viewer || p.handRevealed;
  return {
    hero: p.hero,
    ...(p.noPassive ? { noPassive: true } : {}),
    ...(p.ultimateLocked ? { ultimateLocked: true } : {}),
    ...(p.deckList ? { deckList: p.deckList.slice() } : {}),
    keep: p.keep,
    wall: p.wall,
    resources: { ...p.resources },
    workers: { ...p.workers },
    enchantments: p.enchantments.map((e) => ({ ...e })),
    burn: p.burn,
    frost: { ...p.frost },
    rust: p.rust ?? 0,
    shield: p.shield,
    handRevealed: p.handRevealed,
    ultimateCharge: p.ultimateCharge,
    ultimateThreshold: ultimateThreshold(state, player),
    ultimateReady: isUltimateReady(state, player),
    ultimateUses: p.ultimateUses,
    extraTurns: p.extraTurns,
    lastPlayedCard: p.lastPlayedCard,
    comboSchool: p.comboSchool,
    schoolsLastTurn: p.schoolsLastTurn.slice(),
    eliminated: !!p.eliminated,
    hand: p.hand.map((c) => ({ uid: c.uid, cardId: visible ? c.cardId : null })),
    deckCount: p.deck.length,
    discardCount: p.discard.length,
  };
}

/**
 * The game as `viewer` is allowed to see it. `null` gives a spectator's view:
 * every hand hidden (unless revealed), no player's choice options, and
 * `viewer: 0` with `spectator: true` so a board can lay it out from seat 0.
 */
export function getPlayerView(state: GameState, viewer: Viewer): PlayerView {
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
      ...(state.pending.progress ? { progress: { ...state.pending.progress } } : {}),
      ...(state.pending.ctx.target !== undefined ? { target: state.pending.ctx.target } : {}),
    };
  }
  return {
    viewer: viewer ?? 0,
    ...(viewer === null ? { spectator: true as const } : {}),
    rules: state.rules,
    seq: state.seq,
    turn: state.turn,
    round: roundOf(state),
    firstSeat: state.firstSeat ?? 0,
    active: state.active,
    phase: state.phase,
    actionsLeft: state.actionsLeft,
    extraTurn: state.extraTurn,
    players: state.players.map((_, p) => publicPlayer(state, p, viewer)),
    pending,
    activeEvent: state.activeEvent ? { ...state.activeEvent } : null,
    upcomingEvent: { ...state.upcomingEvent },
    result: state.result ? { ...state.result } : null,
  };
}

/**
 * The events `viewer` is allowed to see: cards the opponent draws are hidden
 * (unless their hand is revealed) and so are the details of choices the
 * opponent is making. Everything else in the log is public. A spectator
 * (`null`) sees nobody's draws or choices.
 */
export function redactEvents(events: readonly GameEvent[], viewer: Viewer): GameEvent[] {
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
        // The revealed hand is shown to the rivals; its owner already knows it.
        return event.player !== viewer ? event : { ...event, cards: [] };
      default:
        return event;
    }
  });
}
