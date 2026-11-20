import { BATTLE_EVENTS, RESOURCES, getBattleEvent, getEnchantmentModifiers, getHero } from './catalog';
import {
  changeResources,
  changeWorkers,
  checkGameOver,
  dealDamage,
  drawCards,
  emptyResources,
  alivePlayers,
  finishGame,
  loseStructure,
  nextAlive,
  opponents,
  roundOf,
  twilightLevel,
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
  events.push({ type: 'battleEventStarted', eventId: id, rounds: lasting ? effect.rounds : null });

  const both: PlayerId[] = [state.active, ...opponents(state, state.active)];
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
      // It always fires as a round starts, so it lasts whole rounds: every castle gets the same turns.
      state.activeEvent = { id, untilRound: roundOf(state) + effect.rounds - 1 };
      break;
  }

  state.upcomingEvent = {
    id: rollBattleEvent(state, id),
    round: roundOf(state) + eventEveryRounds(state.rules),
  };
  events.push({
    type: 'battleEventForecast',
    eventId: state.upcomingEvent.id,
    round: state.upcomingEvent.round,
  });
}

/** Rounds between battle events (saves from before rounds counted turns: two per round). */
function eventEveryRounds(rules: GameState['rules']): number {
  return rules.eventEveryRounds ?? Math.max(1, Math.ceil((rules.eventEveryTurns ?? 8) / 2));
}

/** True when the announced battle event fires on this turn. */
function eventDue(state: GameState): boolean {
  const next = state.upcomingEvent;
  if (next.round === undefined) return state.turn >= (next.turn ?? Infinity);
  return roundOf(state) >= next.round;
}

/** A lasting battle event ends once its last round is over. */
function endBattleEvent(state: GameState, events: GameEvent[]): void {
  const active = state.activeEvent;
  if (!active || active.untilRound === undefined || roundOf(state) <= active.untilRound) return;
  events.push({ type: 'battleEventEnded', eventId: active.id });
  state.activeEvent = null;
}

/**
 * A new round starts when play comes back round to the first seat (or passes
 * it, when seats are skipped). Extra turns never start one.
 */
function advanceRound(state: GameState, player: PlayerId, extraTurn: boolean): void {
  const n = state.players.length;
  if (state.round === undefined) {
    // First turn of the game, or a save from before rounds were counted.
    state.firstSeat = state.turn === 0 ? player : (state.firstSeat ?? 0);
    state.round = state.turn === 0 ? 0 : roundOf(state);
  }
  if (extraTurn && state.round > 0) return;
  const first = state.firstSeat ?? 0;
  const pos = (seat: PlayerId): number => (seat - first + n) % n;
  if (state.round === 0 || pos(player) <= pos(state.active)) state.round += 1;
}

/**
 * Twilight Fury: once a game runs long, every attack hits harder and the
 * Walls crumble a little more each turn, until someone wins.
 */
function twilight(state: GameState, events: GameEvent[], player: PlayerId, before: number): void {
  const level = twilightLevel(state);
  if (level === 0) return;
  const rules = state.rules;
  if (level > before) events.push({ type: 'twilightRose', level });
  // Normal damage: the Wall takes it first and the rest goes to the Keep.
  // Like a battle event it is not an attack: it ignores Shield, does not
  // charge the ultimate and never takes the Keep below 1.
  const reason = { kind: 'twilight' as const, id: 'twilight' };
  const self = state.players[player]!;
  const amount = level * (rules.twilightDamage ?? 0);
  const onWall = Math.min(self.wall, amount);
  loseStructure(state, events, player, 'wall', onWall, 0, reason);
  loseStructure(state, events, player, 'keep', amount - onWall, rules.eventKeepFloor, reason);
}

/** The game is decided on points: highest Keep, then Wall, among the castles standing; a tie is a draw. */
function decideOnPoints(state: GameState, events: GameEvent[], reason: 'turnLimit'): void {
  const ranked = alivePlayers(state).sort(
    (x, y) =>
      state.players[y]!.keep - state.players[x]!.keep || state.players[y]!.wall - state.players[x]!.wall,
  );
  const [first, second] = ranked.map((p) => state.players[p]!);
  const tie = second !== undefined && first!.keep === second.keep && first!.wall === second.wall;
  finishGame(state, events, tie ? null : ranked[0]!, reason);
}

/**
 * Begin the turn of `player`:
 *  0. draw back up to a full hand;
 *  1. effects that last "until your next turn" end;
 *  2. the battle event fires if it is due, and the Twilight Fury erodes the Wall;
 *  3. Burn deals its damage;
 *  4. enchantments with a start-of-turn effect trigger;
 *  5. workers produce (unless frozen) and the hero passive pays out.
 * The game can end during steps 3 and 4.
 */
export function startTurn(state: GameState, events: GameEvent[], player: PlayerId, extraTurn: boolean): void {
  const self = state.players[player]!;

  const furyBefore = state.turn === 0 ? 0 : twilightLevel(state);
  advanceRound(state, player, extraTurn);
  state.turn += 1;
  state.active = player;
  state.extraTurn = extraTurn;
  state.actionsLeft = 1;
  state.phase = 'action';
  self.schoolsThisTurn = [];
  events.push({ type: 'turnStarted', player, turn: state.turn, extraTurn });

  // 0. Draw back up to a full hand. Cards are drawn when your turn starts, not
  // when it ends, so between your turns your hand keeps the gaps you left.
  // Always back to a full hand, whatever was played, discarded or taken since.
  drawCards(state, events, player, state.rules.handSize - self.hand.length);

  // 1. "Until your next turn" effects.
  for (let i = 0; i < state.players.length; i++) {
    // Hands this player revealed hide again. (Old saves have no `revealedBy`: 2 players only.)
    const p = state.players[i]!;
    if (i !== player && p.handRevealed && (p.revealedBy ?? player) === player) {
      p.handRevealed = false;
      if (p.revealedBy !== undefined) p.revealedBy = undefined;
      events.push({ type: 'handHidden', player: i });
    }
  }

  // 2. Battle event, then the Twilight Fury.
  endBattleEvent(state, events);
  if (eventDue(state)) fireBattleEvent(state, events);
  twilight(state, events, player, furyBefore);

  // 3. Burn. It is not an attack: no bonuses, and Shield does not stop it.
  if (self.burn > 0) {
    self.burn -= 1;
    dealDamage(state, events, nextAlive(state, player), player, state.rules.burnDamage, {
      kind: 'normal',
      cause: 'burn',
      attack: false,
    });
    if (checkGameOver(state, events)) return;
    if (self.eliminated) {
      endTurn(state, events);
      return;
    }
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
 * Finish the active player's turn: tick down enchantments
 * and lasting battle events, then start the next turn.
 */
export function endTurn(state: GameState, events: GameEvent[]): void {
  const player = state.active;
  const self = state.players[player]!;
  state.actionsLeft = 0;

  // Rust lasts for the rusted player's next N turns: it wears off as each of them ends.
  if ((self.rust ?? 0) > 0) self.rust! -= 1;

  // Enchantments last for the owner's next N turns: the turn they are played
  // on does not count.
  for (const enchantment of [...self.enchantments]) {
    // Enchantments counted in attacks are spent by attacks, not by turns.
    if (enchantment.charges !== undefined) {
      enchantment.fresh = false;
      continue;
    }
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

  // Saves from before events counted rounds still count their turns down.
  if (state.activeEvent && state.activeEvent.untilRound === undefined) {
    state.activeEvent.turnsLeft = (state.activeEvent.turnsLeft ?? 1) - 1;
    if (state.activeEvent.turnsLeft <= 0) {
      events.push({ type: 'battleEventEnded', eventId: state.activeEvent.id });
      state.activeEvent = null;
    }
  }

  self.schoolsLastTurn = self.schoolsThisTurn;
  self.schoolsThisTurn = [];
  events.push({ type: 'turnEnded', player, turn: state.turn });

  if (state.rules.turnLimit > 0 && state.turn >= state.rules.turnLimit) {
    decideOnPoints(state, events, 'turnLimit');
    return;
  }

  if (self.extraTurns > 0 && !self.eliminated) {
    self.extraTurns -= 1;
    startTurn(state, events, player, true);
  } else {
    startTurn(state, events, nextAlive(state, player), false);
  }
}

/**
 * Called after an effect finished resolving: the turn goes on if the player
 * still has a card to play, otherwise it ends. With `rules.manualEndTurn` the
 * turn only ends on `endTurn` (or `force`, the clock running out), so the
 * player can still use the ultimate after their play.
 */
export function settle(state: GameState, events: GameEvent[], force = false): void {
  if (state.phase === 'finished' || state.pending) return;
  const self = state.players[state.active]!;
  const waitForReady = state.rules.manualEndTurn === true && !force;
  if (!self.eliminated && (waitForReady || (state.actionsLeft > 0 && self.hand.length > 0))) {
    state.phase = 'action';
  } else {
    endTurn(state, events);
  }
}
