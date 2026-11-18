import { getCard, getHero, hasCombo } from './catalog';
import {
  changeResources,
  cloneState,
  costResource,
  discardFromHand,
  effectiveCost,
  finishGame,
  highestOf,
  isSchoolBanned,
  other,
  ultimateThreshold,
} from './core';
import { isConditionMet, resolvePending, runOps } from './effects';
import { randomPick } from './rng';
import { settle } from './turn';
import type {
  Action,
  Board,
  ActionResult,
  CardId,
  EngineError,
  ErrorCode,
  GameEvent,
  GameState,
  PlayerId,
} from './types';

/** Player actions: validation, `applyAction` and `legalActions`. */

function fail(code: ErrorCode, message: string): EngineError {
  return { code, message };
}

/** The player who must act now, or null when the game is over. */
export function currentPlayer(state: Board): PlayerId | null {
  return state.phase === 'finished' ? null : state.active;
}

/** True if `player` has taken enough damage to use the hero ultimate. */
export function isUltimateReady(state: Board, player: PlayerId): boolean {
  return state.players[player].ultimateCharge >= ultimateThreshold(state, player);
}

/**
 * True if playing `cardId` now would get its Combo bonus: the last card the
 * player played (this turn or last turn, with no discard in between) is of the
 * same school. Only cards with a Combo bonus care.
 */
export function isComboActive(state: Board, player: PlayerId, cardId: CardId): boolean {
  return hasCombo(cardId) && state.players[player].comboSchool === getCard(cardId).school;
}

/**
 * True if playing `cardId` now would get a stronger effect than its base one:
 * its Combo is on, or one of its conditions holds.
 */
export function isBoostActive(state: Board, player: PlayerId, cardId: CardId): boolean {
  return isComboActive(state, player, cardId) || isConditionMet(state, player, cardId);
}

/**
 * Why `player` cannot play `cardId` right now, ignoring whose turn it is.
 * Returns null when the card is playable. Useful to grey out cards in the UI.
 */
export function playBlocker(state: Board, player: PlayerId, cardId: CardId): EngineError | null {
  if (isSchoolBanned(state, cardId)) {
    return fail('schoolBanned', 'A battle event forbids cards of this school right now');
  }
  const cost = effectiveCost(state, player, cardId);
  if (state.players[player].resources[costResource(cardId)] < cost) {
    return fail('cannotAfford', `Not enough ${costResource(cardId)} (needs ${cost})`);
  }
  const needsCopy = getCard(cardId).effects.some((op) => op.op === 'copyLast');
  if (needsCopy && state.players[other(player)].lastPlayedCard === null) {
    return fail('nothingToCopy', 'The opponent has not played a card yet');
  }
  return null;
}

function validate(state: GameState, action: Action): EngineError | null {
  if (state.phase === 'finished') return fail('gameOver', 'The game is over');
  if (action.type === 'timeout') return null;
  if (action.player !== 0 && action.player !== 1) return fail('invalidAction', 'Unknown player');
  if (action.type === 'concede') return null;
  if (action.player !== state.active) return fail('notYourTurn', 'It is not your turn');

  if (action.type === 'choose') {
    if (state.phase !== 'choice' || !state.pending) return fail('wrongPhase', 'There is nothing to choose');
    if (!state.pending.options.includes(action.option)) {
      return fail('invalidChoice', 'That is not one of the options');
    }
    return null;
  }

  if (state.phase !== 'action') return fail('wrongPhase', 'Answer the pending choice first');

  switch (action.type) {
    case 'ultimate':
      return isUltimateReady(state, action.player)
        ? null
        : fail('ultimateNotReady', 'The ultimate is not charged yet');
    case 'play': {
      const card = state.players[action.player].hand.find((c) => c.uid === action.uid);
      if (!card) return fail('cardNotInHand', 'That card is not in your hand');
      return playBlocker(state, action.player, card.cardId);
    }
    case 'discard': {
      const uids = [action.uid, ...(action.also ?? [])];
      if (uids.length > state.rules.discardMax || new Set(uids).size !== uids.length) {
        return fail('invalidAction', `Discard between 1 and ${state.rules.discardMax} different cards`);
      }
      const hand = state.players[action.player].hand;
      if (!uids.every((uid) => hand.some((c) => c.uid === uid))) return fail('cardNotInHand', 'That card is not in your hand');
      return null;
    }
    default:
      return fail('invalidAction', 'Unknown action');
  }
}

function playCard(state: GameState, events: GameEvent[], player: PlayerId, uid: number): void {
  const self = state.players[player];
  const index = self.hand.findIndex((c) => c.uid === uid);
  const { cardId } = self.hand[index]!;
  const card = getCard(cardId);
  const cost = effectiveCost(state, player, cardId);
  const resource = costResource(cardId);
  // Only cards with a Combo bonus get (and announce) it.
  const combo = isComboActive(state, player, cardId);

  self.hand.splice(index, 1);
  self.discard.push(cardId);
  self.resources[resource] -= cost;
  self.comboSchool = card.school;
  self.lastPlayedCard = cardId;
  self.schoolsThisTurn.push(card.school);
  state.actionsLeft -= 1;
  events.push({ type: 'cardPlayed', player, uid, cardId, resource, cost, combo });

  runOps(state, events, { player, source: { kind: 'card', id: cardId }, combo }, card.effects);
}

/** The discard action: one to `rules.discardMax` cards. The Saboteur's steal happens once per action. */
function discardCards(state: GameState, events: GameEvent[], player: PlayerId, uids: number[]): void {
  const self = state.players[player];
  for (const uid of uids) discardFromHand(state, events, player, uid, 'action');
  self.comboSchool = null;
  state.actionsLeft -= 1;

  const steal = getHero(self.hero).passive.stealOnDiscard;
  if (steal) {
    const opponent = other(player);
    const resource = highestOf(state.players[opponent].resources);
    const reason = { kind: 'hero' as const, id: self.hero };
    const taken = changeResources(state, events, opponent, { [resource]: -steal }, reason);
    const amount = -(taken[resource] ?? 0);
    if (amount > 0) changeResources(state, events, player, { [resource]: amount }, reason);
  }
}

function useUltimate(state: GameState, events: GameEvent[], player: PlayerId): void {
  const self = state.players[player];
  self.ultimateCharge = 0;
  self.ultimateUses += 1;
  events.push({ type: 'ultimateUsed', player, heroId: self.hero });
  runOps(
    state,
    events,
    { player, source: { kind: 'ultimate', id: self.hero }, combo: false },
    getHero(self.hero).ultimate,
  );
}

/** The clock ran out: take default choices, discard a random card and end the turn. */
function timeOut(state: GameState, events: GameEvent[]): void {
  const player = state.active;
  events.push({ type: 'timedOut', player });
  // Defaults can chain into further choices (Mirage); the guard is only a safety net.
  for (let guard = 0; guard < 20 && state.phase === 'choice' && state.pending; guard++) {
    resolvePending(state, events, state.pending.options[0]!);
  }
  if (state.phase === 'finished') return;

  const self = state.players[player];
  if (state.actionsLeft > 0 && self.hand.length > 0) {
    discardFromHand(state, events, player, randomPick(state, self.hand).uid, 'timeout');
    self.comboSchool = null;
  }
  state.actionsLeft = 0;
}

/**
 * Apply an action and return the new state plus the list of things that
 * happened. The input state is never modified. Illegal actions return
 * `{ ok: false, error }` and change nothing.
 */
export function applyAction(previous: GameState, action: Action): ActionResult {
  const error = validate(previous, action);
  if (error) return { ok: false, error };

  const state = cloneState(previous);
  const events: GameEvent[] = [];
  state.seq += 1;

  switch (action.type) {
    case 'play':
      playCard(state, events, action.player, action.uid);
      break;
    case 'discard':
      discardCards(state, events, action.player, [action.uid, ...(action.also ?? [])]);
      break;
    case 'ultimate':
      useUltimate(state, events, action.player);
      break;
    case 'choose':
      resolvePending(state, events, action.option);
      break;
    case 'concede':
      finishGame(state, events, other(action.player), 'concede');
      break;
    case 'timeout':
      timeOut(state, events);
      break;
  }

  settle(state, events);
  return { ok: true, state, events };
}

/**
 * Every action the player to move can take now (without `concede`, which is
 * always available, and `timeout`, which belongs to the server). Duplicate
 * cards in hand produce one action per copy.
 *
 * It accepts the full `GameState` or a `PlayerView`; with a view it answers
 * for the viewer, so it is empty while the opponent is to move.
 */
export function legalActions(state: Board): Action[] {
  if (state.phase === 'finished') return [];
  const player = state.active;
  if (state.viewer !== undefined && state.viewer !== player) return [];

  if (state.phase === 'choice' && state.pending) {
    return state.pending.options.map((option) => ({ type: 'choose', player, option }));
  }

  const actions: Action[] = [];
  if (isUltimateReady(state, player)) actions.push({ type: 'ultimate', player });
  for (const card of state.players[player].hand) {
    if (card.cardId !== null && !playBlocker(state, player, card.cardId)) {
      actions.push({ type: 'play', player, uid: card.uid });
    }
  }
  for (const card of state.players[player].hand) {
    actions.push({ type: 'discard', player, uid: card.uid });
  }
  return actions;
}

/**
 * Replay a list of actions on top of a state. Throws if one is illegal.
 * A game is fully described by its options (seed, heroes) and its actions.
 */
export function replay(initial: GameState, actions: readonly Action[]): GameState {
  let state = initial;
  for (const action of actions) {
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(`Illegal action in replay: ${result.error.code}`);
    state = result.state;
  }
  return state;
}
