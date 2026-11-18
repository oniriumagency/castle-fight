import { applyAction } from './actions';
import { getCard } from './catalog';
import { createGame } from './setup';
import type { Action, CardId, GameEvent, GameState, HeroId, PlayerId, PlayerState, Rules } from './types';

/**
 * Helpers to build specific situations in tests. Not part of the game API:
 * import them from `@cardcraft-castles/engine/testing`.
 */

export interface ScenarioOptions {
  seed?: number | string;
  /**
   * Defaults to two Wardens, whose passive only changes the starting Wall;
   * with the default heroes both Walls are reset to `rules.wallStart`.
   */
  heroes?: [HeroId, HeroId];
  rules?: Partial<Rules>;
  /** Cards to put in player 0's hand (replacing the dealt one). */
  hand?: CardId[];
  /** Cards to put in player 1's hand. */
  opponentHand?: CardId[];
  /** Field overrides for player 0, applied after setup. */
  you?: Partial<PlayerState>;
  /** Field overrides for player 1. */
  opponent?: Partial<PlayerState>;
  /** Give both players this much of every resource (default 50, so cost is never the issue). */
  resources?: number;
  /**
   * Give player 0 a spare action so that playing one card does not end the
   * turn, which keeps start-of-turn noise out of the assertions. Default true;
   * set it to false to test the turn flow itself. The turn still ends if the
   * hand runs out, so leave a spare card in `hand`.
   */
  keepTurn?: boolean;
}

/** A game on turn 1 with player 0 to move and the given tweaks applied. */
export function scenario(options: ScenarioOptions = {}): GameState {
  const { state } = createGame({
    seed: options.seed ?? 1,
    heroes: options.heroes ?? ['guardian', 'guardian'],
    firstPlayer: 0,
    ...(options.rules ? { rules: options.rules } : {}),
  });
  const amount = options.resources ?? 50;
  for (const p of state.players) {
    p.resources = { piedra: amount, acero: amount, mana: amount };
    if (!options.heroes) p.wall = state.rules.wallStart;
  }
  if (options.hand) setHand(state, 0, options.hand);
  if (options.opponentHand) setHand(state, 1, options.opponentHand);
  Object.assign(state.players[0], options.you);
  Object.assign(state.players[1], options.opponent);
  if (options.keepTurn ?? true) state.actionsLeft = 2;
  return state;
}

/** Replace a player's hand with the given cards (fresh uids). */
export function setHand(state: GameState, player: PlayerId, cards: CardId[]): void {
  state.players[player].hand = cards.map((cardId) => {
    getCard(cardId);
    return { uid: state.nextUid++, cardId };
  });
}

/** Apply an action that must be legal; throws with the error code otherwise. */
export function mustApply(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`Expected a legal action, got ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** The active player plays the first copy of `cardId` in hand. */
export function playCard(state: GameState, cardId: CardId): { state: GameState; events: GameEvent[] } {
  const player = state.active;
  const card = state.players[player].hand.find((c) => c.cardId === cardId);
  if (!card) throw new Error(`"${cardId}" is not in the active player's hand`);
  return mustApply(state, { type: 'play', player, uid: card.uid });
}

/** The active player discards the first card in hand (or the first copy of `cardId`). */
export function discardCard(state: GameState, cardId?: CardId): { state: GameState; events: GameEvent[] } {
  const player = state.active;
  const hand = state.players[player].hand;
  const card = cardId ? hand.find((c) => c.cardId === cardId) : hand[0];
  if (!card) throw new Error('No such card to discard');
  return mustApply(state, { type: 'discard', player, uid: card.uid });
}

/** The active player answers the pending choice. */
export function choose(state: GameState, option: string): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: 'choose', player: state.active, option });
}

/** Events of one type, narrowed. */
export function eventsOf<T extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}
