import { BATTLE_EVENTS, RESOURCES, getBattleEvent, getEnchantmentModifiers, getHero } from './catalog';
import {
  changeResources,
  changeWorkers,
  checkGameOver,
  dealDamage,
  drawCards,
  emptyResources,
  finishGame,
  loseStructure,
  other,
} from './core';
import { runOps } from './effects';
import { randomPick } from './rng';
import type { BattleEventId, GameEvent, GameState, PlayerId, Resource } from './types';

/** Turn structure: start of turn, end of turn and battle events. */

/** Pick the next battle event (never the same one twice in a row). */
export function rollBattleEvent(state: GameState, previous: BattleEventId | null): BattleEventId {
  const candidates = BATTLE_EVENTS.filter((e) => e.id !== previous);
  return randomPick(state, candidates).id;
}

function fireBattleEvent(state: GameState, events: GameEvent[]): void {
  const id = state.upcomingEvent.id;
  const effect = getBattleEvent(id).effect;
  const reason = { kind: 'battleEvent' as const, id };
  const lasting = effect.kind === 'halfCost' || effect.kind === 'banSchool';
  events.push({ type: 'battleEventStarted', eventId: id, turns: lasting ? effect.turns : null });

  const both: PlayerId[] = [state.active, other(state.active)];
  switch (effect.kind) {
    case 'bothLoseWall':
      for (const p of both) loseStructure(state, events, p, 'wall', effect.amount, 0, reason);
      break;
    case 'bothLoseKeep':
      for (const p of both) {
        loseStructure(state, events, p, 'keep', effect.amount, state.rules.eventKeepFloor, reason);
      }
      break;
    case 'bothGainResources':
      for (const p of both) {
        changeResources(
          state,
          events,
          p,
          { piedra: effect.amount, acero: effect.amount, mana: effect.amount },
          reason,
        );
      }
      break;
    case 'bothGainRandomWorker':
      for (const p of both) {
        changeWorkers(state, events, p, { [randomPick(state, RESOURCES)]: 1 }, reason);
      }
      break;
    case 'halfCost':
    case 'banSchool':
      state.activeEvent = { id, turnsLeft: effect.turns };
      break;
  }

  state.upcomingEvent = {
    id: rollBattleEvent(state, id),
    turn: state.turn + state.rules.eventEveryTurns,
  };
  events.push({
    type: 'battleEventForecast',
    eventId: state.upcomingEvent.id,
    turn: state.upcomingEvent.turn,
  });
}

/**
 * Begin the turn of `player`:
 *  1. effects that last "until your next turn" end;
 *  2. the battle event fires if it is due;
 *  3. Burn deals its damage;
 *  4. enchantments with a start-of-turn effect trigger;
 *  5. workers produce (unless frozen) and the hero passive pays out.
 * The game can end during steps 3 and 4.
 */
export function startTurn(state: GameState, events: GameEvent[], player: PlayerId, extraTurn: boolean): void {
  const self = state.players[player];
  const opp = state.players[other(player)];

  state.turn += 1;
  state.active = player;
  state.extraTurn = extraTurn;
  state.actionsLeft = 1;
  state.phase = 'action';
  self.schoolsThisTurn = [];
  events.push({ type: 'turnStarted', player, turn: state.turn, extraTurn });

  // 1. "Until your next turn" effects.
  if (self.drawbridge) {
    self.drawbridge = false;
    events.push({ type: 'drawbridgeLowered', player });
  }
  if (opp.handRevealed) {
    opp.handRevealed = false;
    events.push({ type: 'handHidden', player: other(player) });
  }

  // 2. Battle event.
  if (state.turn >= state.upcomingEvent.turn) fireBattleEvent(state, events);

  // 3. Burn. It is not an attack: no bonuses, and Shield does not stop it.
  if (self.burn > 0) {
    self.burn -= 1;
    dealDamage(state, events, other(player), player, state.rules.burnDamage, {
      kind: 'normal',
      cause: 'burn',
      attack: false,
    });
    if (checkGameOver(state, events)) return;
  }

  // 4. Enchantment upkeep.
  for (const enchantment of [...self.enchantments]) {
    const ops = getEnchantmentModifiers(enchantment.cardId)?.onTurnStart;
    if (!ops) continue;
    events.push({ type: 'enchantmentTriggered', player, cardId: enchantment.cardId });
    runOps(
      state,
      events,
      { player, source: { kind: 'enchantment', id: enchantment.cardId }, combo: false },
      ops,
    );
    if (checkGameOver(state, events)) return;
  }

  // 5. Production.
  const gained = emptyResources();
  const frozen: Resource[] = [];
  for (const r of RESOURCES) {
    if (self.frost[r] > 0) {
      self.frost[r] -= 1;
      frozen.push(r);
    } else {
      gained[r] = self.workers[r];
      self.resources[r] += gained[r];
    }
  }
  events.push({ type: 'produced', player, gained, frozen });

  const bonus = getHero(self.hero).passive.randomResourcePerTurn;
  if (bonus) {
    changeResources(state, events, player, { [randomPick(state, RESOURCES)]: bonus }, {
      kind: 'hero',
      id: self.hero,
    });
  }

  // A player with no cards cannot act; this cannot happen with the standard deck.
  if (self.hand.length === 0) endTurn(state, events);
}

/**
 * Finish the active player's turn: refill the hand, tick down enchantments
 * and lasting battle events, then start the next turn.
 */
export function endTurn(state: GameState, events: GameEvent[]): void {
  const player = state.active;
  const self = state.players[player];
  state.actionsLeft = 0;

  drawCards(state, events, player, state.rules.handSize - self.hand.length);

  // Enchantments last for the owner's next N turns: the turn they are played
  // on does not count.
  for (const enchantment of [...self.enchantments]) {
    if (enchantment.fresh) {
      enchantment.fresh = false;
      continue;
    }
    enchantment.turnsLeft -= 1;
    if (enchantment.turnsLeft <= 0) {
      self.enchantments.splice(self.enchantments.indexOf(enchantment), 1);
      events.push({ type: 'enchantmentRemoved', player, cardId: enchantment.cardId, reason: 'expired' });
    }
  }

  if (state.activeEvent) {
    state.activeEvent.turnsLeft -= 1;
    if (state.activeEvent.turnsLeft <= 0) {
      events.push({ type: 'battleEventEnded', eventId: state.activeEvent.id });
      state.activeEvent = null;
    }
  }

  self.schoolsLastTurn = self.schoolsThisTurn;
  self.schoolsThisTurn = [];
  events.push({ type: 'turnEnded', player, turn: state.turn });

  if (state.rules.turnLimit > 0 && state.turn >= state.rules.turnLimit) {
    const [a, b] = state.players;
    const diff = a.keep - b.keep || a.wall - b.wall;
    finishGame(state, events, diff === 0 ? null : diff > 0 ? 0 : 1, 'turnLimit');
    return;
  }

  if (self.extraTurns > 0) {
    self.extraTurns -= 1;
    startTurn(state, events, player, true);
  } else {
    startTurn(state, events, other(player), false);
  }
}

/**
 * Called after an effect finished resolving: the turn goes on if the player
 * still has a card to play, otherwise it ends.
 */
export function settle(state: GameState, events: GameEvent[]): void {
  if (state.phase === 'finished' || state.pending) return;
  if (state.actionsLeft > 0 && state.players[state.active].hand.length > 0) {
    state.phase = 'action';
  } else {
    endTurn(state, events);
  }
}
