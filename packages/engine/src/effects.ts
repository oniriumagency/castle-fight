import { RESOURCES, getCard } from './catalog';
import {
  build,
  changeResources,
  changeWorkers,
  checkGameOver,
  dealDamage,
  discardFromHand,
  drawCards,
  highestOf,
  other,
  statusDurationBonus,
} from './core';
import { randomPick } from './rng';
import type {
  Board,
  CardId,
  CardInstance,
  ChoiceKind,
  Condition,
  EffectContext,
  EffectOp,
  GameEvent,
  GameState,
  PlayerId,
  Resource,
  ResourceMap,
} from './types';

/**
 * Effect resolution. Effects are lists of `EffectOp`; they are resolved in
 * order. When an op needs a decision from the player (and there is more than
 * one valid answer) resolution stops, the rest of the list is parked in
 * `state.pending` and it resumes when the `choose` action arrives.
 */

interface Choice {
  kind: ChoiceKind;
  /** Valid answers, best default first. */
  options: string[];
  revealed?: CardInstance[];
  progress?: { done: number; left: number };
}

/** The extra amount a `perDiscard` op gets for the cards its effect discarded. */
function discardBonus(ctx: EffectContext, op: { perDiscard?: number }): number {
  return (op.perDiscard ?? 0) * (ctx.discarded ?? 0);
}

function evalCondition(state: Board, ctx: Pick<EffectContext, 'player'>, cond: Condition): boolean {
  switch (cond.kind) {
    case 'selfKeepBelow':
      return state.players[ctx.player].keep < cond.value;
    case 'opponentPlayedSchoolLastTurn':
      return state.players[other(ctx.player)].schoolsLastTurn.includes(cond.school);
  }
}

/**
 * True if one of the card's conditions ("if your Keep is below 35...",
 * "if the opponent played Construction...") holds right now, so playing it
 * gets the stronger effect.
 */
export function isConditionMet(state: Board, player: PlayerId, cardId: CardId): boolean {
  return getCard(cardId).effects.some((op) => op.op === 'if' && evalCondition(state, { player }, op.cond));
}

/** The decision an op needs, or null when it needs none. */
function choiceFor(state: GameState, ctx: EffectContext, op: EffectOp): Choice | null {
  const opp = state.players[other(ctx.player)];
  switch (op.op) {
    case 'frost': {
      if (op.scope !== 'choice') return null;
      // Default: the resource the opponent produces most of, then stockpiles most of.
      const options = [...RESOURCES].sort(
        (a, b) => opp.workers[b] - opp.workers[a] || opp.resources[b] - opp.resources[a],
      );
      return { kind: 'frostResource', options };
    }
    case 'peekAndDiscard': {
      // Default: the most expensive card.
      const sorted = [...opp.hand].sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
      return {
        kind: 'discardFromHand',
        options: sorted.map((c) => String(c.uid)),
        revealed: opp.hand.map((c) => ({ ...c })),
      };
    }
    case 'destroyEnchantment': {
      // Default: the enchantment with the most turns left.
      const sorted = [...opp.enchantments].sort((a, b) => b.turnsLeft - a.turnsLeft);
      return { kind: 'destroyEnchantment', options: sorted.map((e) => e.cardId) };
    }
    case 'discardOwn': {
      if (op.count === 'hand') return null;
      // Default: stop if allowed, otherwise the cheapest card.
      const hand = state.players[ctx.player].hand;
      const sorted = [...hand].sort((a, b) => getCard(a.cardId).cost - getCard(b.cardId).cost);
      const uids = sorted.map((c) => String(c.uid));
      return {
        kind: 'discardOwn',
        options: op.upTo ? ['done', ...uids] : uids,
        progress: { done: ctx.discarded ?? 0, left: op.count },
      };
    }
    default:
      return null;
  }
}

function applyFrost(
  state: GameState,
  events: GameEvent[],
  ctx: EffectContext,
  resources: readonly Resource[],
  baseTurns: number,
): void {
  const target = other(ctx.player);
  const opp = state.players[target];
  const turns = baseTurns + statusDurationBonus(state, ctx.player);
  for (const resource of resources) {
    opp.frost[resource] = Math.min(state.rules.frostMaxTurns, opp.frost[resource] + turns);
    events.push({ type: 'frostApplied', player: target, resource, turns, total: opp.frost[resource] });
  }
}

/**
 * Apply one op. `answer` is the player's decision for ops that need one.
 * Returns ops to resolve next (for `if` and `copyLast`), plus the context they
 * run in.
 */
function applyOp(
  state: GameState,
  events: GameEvent[],
  ctx: EffectContext,
  op: EffectOp,
  answer: string | null,
): { ops: EffectOp[]; ctx: EffectContext } | null {
  const me = ctx.player;
  const them = other(me);
  const self = state.players[me];
  const opp = state.players[them];
  const reason = ctx.source;

  switch (op.op) {
    case 'wall':
    case 'keep': {
      const amount = op.amount + (ctx.combo ? (op.comboBonus ?? 0) : 0) + discardBonus(ctx, op);
      if (amount <= 0) return null;
      build(state, events, me, op.op, amount, reason);
      return null;
    }

    case 'damage': {
      const amount = op.amount + (ctx.combo ? (op.comboBonus ?? 0) : 0) + discardBonus(ctx, op);
      if (amount <= 0) return null;
      const times = op.times ?? 1;
      for (let i = 0; i < times; i++) {
        dealDamage(state, events, me, them, amount, {
          kind: op.kind ?? 'normal',
          cause: ctx.source.kind === 'ultimate' ? 'ultimate' : 'card',
          attack: true,
          ...(op.wallMultiplier !== undefined ? { wallMultiplier: op.wallMultiplier } : {}),
        });
        if (checkGameOver(state, events)) break;
      }
      return null;
    }

    case 'gainResource': {
      const delta: Partial<ResourceMap> =
        op.resource === 'all'
          ? { piedra: op.amount, acero: op.amount, mana: op.amount }
          : { [op.resource]: op.amount };
      changeResources(state, events, me, delta, reason);
      return null;
    }

    case 'gainWorker':
      changeWorkers(state, events, me, { [op.worker]: op.amount }, reason);
      return null;

    case 'stealResource': {
      const resource = highestOf(opp.resources);
      const taken = changeResources(state, events, them, { [resource]: -op.amount }, reason);
      const amount = -(taken[resource] ?? 0);
      if (amount > 0) changeResources(state, events, me, { [resource]: amount }, reason);
      return null;
    }

    case 'drainResources':
      changeResources(
        state,
        events,
        them,
        { piedra: -op.amount, acero: -op.amount, mana: -op.amount },
        reason,
      );
      return null;

    case 'loseWorker':
      changeWorkers(state, events, them, { [highestOf(opp.workers)]: -1 }, reason);
      return null;

    case 'stealWorker': {
      // The opponent keeps at least `minWorkers`; you gain the worker either way.
      const worker = highestOf(opp.workers);
      changeWorkers(state, events, them, { [worker]: -1 }, reason);
      changeWorkers(state, events, me, { [worker]: 1 }, reason);
      return null;
    }

    case 'burn': {
      const turns = op.turns + statusDurationBonus(state, me);
      opp.burn = Math.min(state.rules.burnMaxTurns, opp.burn + turns);
      events.push({ type: 'burnApplied', player: them, turns, total: opp.burn });
      return null;
    }

    case 'frost':
      if (op.scope === 'all') applyFrost(state, events, ctx, RESOURCES, op.turns);
      else if (answer !== null) applyFrost(state, events, ctx, [answer as Resource], op.turns);
      return null;

    case 'shield': {
      self.shield = Math.min(state.rules.shieldMaxCharges, self.shield + op.charges);
      events.push({ type: 'shieldGained', player: me, charges: op.charges, total: self.shield });
      return null;
    }

    case 'cleanse': {
      self.burn = 0;
      self.frost = { piedra: 0, acero: 0, mana: 0 };
      events.push({ type: 'statusesCleansed', player: me });
      return null;
    }

    case 'enchant': {
      const cardId = ctx.source.id;
      const existing = self.enchantments.find((e) => e.cardId === cardId);
      if (existing) {
        // Playing the same enchantment again restarts its duration.
        existing.turnsLeft = op.turns;
        existing.fresh = true;
      } else {
        if (self.enchantments.length >= state.rules.maxEnchantments) {
          const oldest = self.enchantments.shift()!;
          events.push({
            type: 'enchantmentRemoved',
            player: me,
            cardId: oldest.cardId,
            reason: 'replaced',
          });
        }
        self.enchantments.push({ cardId, turnsLeft: op.turns, fresh: true });
      }
      events.push({
        type: 'enchantmentAdded',
        player: me,
        cardId,
        turns: op.turns,
        refreshed: !!existing,
      });
      return null;
    }

    case 'destroyEnchantment': {
      if (answer === null) return null;
      const index = opp.enchantments.findIndex((e) => e.cardId === answer);
      if (index >= 0) {
        opp.enchantments.splice(index, 1);
        events.push({ type: 'enchantmentRemoved', player: them, cardId: answer, reason: 'destroyed' });
      }
      return null;
    }

    case 'revealHand':
      opp.handRevealed = true;
      events.push({ type: 'handRevealed', player: them, cards: opp.hand.map((c) => ({ ...c })) });
      return null;

    case 'drawbridge':
      self.drawbridge = true;
      events.push({ type: 'drawbridgeRaised', player: me });
      return null;

    case 'peekAndDiscard':
      if (answer !== null) discardFromHand(state, events, them, Number(answer), 'effect');
      return null;

    case 'discardRandom':
      for (let i = 0; i < op.count && opp.hand.length > 0; i++) {
        discardFromHand(state, events, them, randomPick(state, opp.hand).uid, 'effect');
      }
      return null;

    case 'discardOwn': {
      const discarded = ctx.discarded ?? 0;
      if (op.count === 'hand') {
        const uids = self.hand.map((c) => c.uid);
        for (const uid of uids) discardFromHand(state, events, me, uid, 'effect');
        return { ops: [], ctx: { ...ctx, discarded: discarded + uids.length } };
      }
      if (answer === null || answer === 'done') return null;
      if (!discardFromHand(state, events, me, Number(answer), 'effect')) return null;
      // The remaining discards come back as a smaller copy of this op.
      return {
        ops: op.count > 1 ? [{ ...op, count: op.count - 1 }] : [],
        ctx: { ...ctx, discarded: discarded + 1 },
      };
    }

    case 'draw':
      drawCards(state, events, me, op.count);
      return null;

    case 'swapWalls': {
      const mine = self.wall;
      self.wall = opp.wall;
      opp.wall = mine;
      events.push({ type: 'wallsSwapped', walls: [state.players[0].wall, state.players[1].wall] });
      return null;
    }

    case 'copyLast': {
      const copied = opp.lastPlayedCard;
      if (copied === null) return null;
      // From now on this counts as the last card you played, so a Mirage
      // answering a Mirage copies the original card instead of looping.
      self.lastPlayedCard = copied;
      events.push({ type: 'cardCopied', player: me, cardId: copied });
      return {
        ops: getCard(copied).effects,
        ctx: { player: me, source: { kind: 'card', id: copied }, combo: false },
      };
    }

    case 'extraTurn':
      if (self.extraTurns < 1) {
        self.extraTurns = 1;
        events.push({ type: 'extraTurnGranted', player: me });
      }
      return null;

    case 'redrawHand': {
      const count = self.hand.length;
      for (const card of self.hand) self.discard.push(card.cardId);
      self.hand = [];
      events.push({ type: 'handRedrawn', player: me, count });
      drawCards(state, events, me, state.rules.handSize);
      return null;
    }

    case 'extraPlay':
      state.actionsLeft += 1;
      events.push({ type: 'extraPlayGranted', player: me });
      return null;

    case 'if':
      return { ops: evalCondition(state, ctx, op.cond) ? op.then : (op.else ?? []), ctx };
  }
}

/**
 * Resolve `ops` in order. Stops early if the game ends or if a decision is
 * needed, in which case `state.phase` becomes `'choice'`.
 */
export function runOps(
  state: GameState,
  events: GameEvent[],
  context: EffectContext,
  ops: readonly EffectOp[],
): void {
  let ctx = context;
  const queue = [...ops];
  while (queue.length > 0) {
    if (state.phase === 'finished') return;
    const op = queue.shift()!;

    const choice = choiceFor(state, ctx, op);
    if (choice && choice.options.length > 1) {
      state.pending = {
        player: ctx.player,
        kind: choice.kind,
        options: choice.options,
        ...(choice.revealed ? { revealed: choice.revealed } : {}),
        ...(choice.progress ? { progress: choice.progress } : {}),
        ctx,
        op,
        rest: queue,
      };
      state.phase = 'choice';
      events.push({
        type: 'choiceRequested',
        player: ctx.player,
        kind: choice.kind,
        options: choice.options.slice(),
        ...(choice.revealed ? { revealed: choice.revealed.map((c) => ({ ...c })) } : {}),
      });
      return;
    }

    // With a single valid answer it is taken automatically; with none the op does nothing.
    const next = applyOp(state, events, ctx, op, choice ? (choice.options[0] ?? null) : null);
    if (next) {
      queue.unshift(...next.ops);
      ctx = next.ctx;
    }
    checkGameOver(state, events);
  }
}

/** Resume the parked effect with the player's answer. The caller validates the answer. */
export function resolvePending(state: GameState, events: GameEvent[], option: string): void {
  const pending = state.pending!;
  state.pending = null;
  state.phase = 'action';
  events.push({ type: 'choiceMade', player: pending.player, kind: pending.kind, option });
  const next = applyOp(state, events, pending.ctx, pending.op, option);
  if (checkGameOver(state, events)) return;
  runOps(state, events, next?.ctx ?? pending.ctx, next ? [...next.ops, ...pending.rest] : pending.rest);
}
