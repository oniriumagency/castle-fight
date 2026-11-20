import { RESOURCES, getCard } from './catalog';
import {
  build,
  changeResources,
  changeWorkers,
  checkGameOver,
  dealDamage,
  discardFromHand,
  saboteurSteal,
  stealResource,
  drawCards,
  defaultTarget,
  enchantmentLife,
  highestOf,
  isMultiplayer,
  opponents,
  other,
  statusDurationBonus,
  twilightLevel,
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

// ---------------------------------------------------------------------------
// Targets (who "the opponent" is)
// ---------------------------------------------------------------------------

/** Ops that do something to "the opponent". With 3+ players they need a target. */
const RIVAL_OPS: ReadonlySet<EffectOp['op']> = new Set([
  'damage',
  'stealResource',
  'drainResources',
  'loseWorker',
  'stealWorker',
  'burn',
  'frost',
  'destroyEnchantment',
  'revealHand',
  'peekAndDiscard',
  'discardRandom',
  'swapWalls',
]);

/** True if these effects touch a rival (so, with 3+ players in `choose` mode, a target is picked). */
export function effectsNeedTarget(ops: readonly EffectOp[]): boolean {
  return ops.some(
    (op) =>
      RIVAL_OPS.has(op.op) || (op.op === 'if' && (effectsNeedTarget(op.then) || effectsNeedTarget(op.else ?? []))),
  );
}

/** True when every living rival is hit at once (3+ players, `all` mode, 2+ rivals left). */
function hitsAll(state: GameState, player: PlayerId): boolean {
  return isMultiplayer(state) && state.rules.multiTargeting === 'all' && opponents(state, player).length > 1;
}

/** The rivals an effect of `ctx.player` reaches. */
function victims(state: GameState, ctx: EffectContext): PlayerId[] {
  if (!isMultiplayer(state)) return [other(ctx.player)];
  if (hitsAll(state, ctx.player)) return opponents(state, ctx.player);
  return [primaryTarget(state, ctx)];
}

/** The one rival a single-target effect hits. */
function primaryTarget(state: GameState, ctx: EffectContext): PlayerId {
  if (!isMultiplayer(state)) return other(ctx.player);
  const t = ctx.target;
  if (t !== undefined && t !== ctx.player && state.players[t] && !state.players[t].eliminated) return t;
  return defaultTarget(state, ctx.player);
}

/** Scale an amount that now lands on every rival at once. */
function perRival(state: GameState, player: PlayerId, amount: number): number {
  if (!hitsAll(state, player)) return amount;
  return Math.max(1, Math.round(amount * state.rules.multiAllScale));
}

/**
 * The rival whose last card a copy effect copies: the one who played most
 * recently (previous in turn order first).
 */
export function copySource(state: Board, player: PlayerId): PlayerId | null {
  if (state.players.length <= 2) {
    return state.players[other(player)]!.lastPlayedCard !== null ? other(player) : null;
  }
  const list = opponents(state, player).reverse();
  return list.find((p) => state.players[p]!.lastPlayedCard !== null) ?? null;
}

/**
 * A card of `ctx.player` just made someone discard (its owner or a rival):
 * the Saboteur's passive fires, once per card. Returns the context to go on with.
 */
function afterDiscard(state: GameState, events: GameEvent[], ctx: EffectContext): EffectContext {
  if (ctx.sabotaged || ctx.source.kind !== 'card') return ctx;
  return saboteurSteal(state, events, ctx.player) ? { ...ctx, sabotaged: true } : ctx;
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
      return opponents(state, ctx.player).some((p) => state.players[p]!.schoolsLastTurn.includes(cond.school));
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
  // When a card hits every rival at once, rival choices take their default for each one.
  if (state.players.length > 2 && RIVAL_OPS.has(op.op) && hitsAll(state, ctx.player)) return null;
  const opp = state.players[state.players.length === 2 ? other(ctx.player) : primaryTarget(state, ctx)]!;
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
      const sorted = [...opp.enchantments].sort((a, b) => enchantmentLife(b) - enchantmentLife(a));
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

/** The resource a rival produces most of (then stockpiles most of): the default Frost pick. */
function topResource(state: GameState, player: PlayerId): Resource {
  const p = state.players[player]!;
  return [...RESOURCES].sort((a, b) => p.workers[b] - p.workers[a] || p.resources[b] - p.resources[a])[0]!;
}

function applyFrost(
  state: GameState,
  events: GameEvent[],
  ctx: EffectContext,
  target: PlayerId,
  resources: readonly Resource[],
  baseTurns: number,
): void {
  const opp = state.players[target]!;
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
  const self = state.players[me]!;
  // Who the op reaches. Duels skip the free-for-all lookups: this runs for every op the AI tries.
  const duel = state.players.length === 2;
  const them = duel ? other(me) : primaryTarget(state, ctx);
  const targets = duel ? [them] : victims(state, ctx);
  const opp = state.players[them]!;
  const reason = ctx.source;

  switch (op.op) {
    case 'wall':
    case 'keep': {
      const fury = op.op === 'keep' ? twilightLevel(state) * (state.rules.twilightBuildBonus ?? 0) : 0;
      const amount = op.amount + (ctx.combo ? (op.comboBonus ?? 0) : 0) + discardBonus(ctx, op) + fury;
      if (amount <= 0) return null;
      build(state, events, me, op.op, amount, reason);
      return null;
    }

    case 'damage': {
      const base = op.amount + (ctx.combo ? (op.comboBonus ?? 0) : 0);
      const amount = base + discardBonus(ctx, op);
      if (amount <= 0) return null;
      const times = op.times ?? 1;
      // A whole per-card amount against every rival keeps the printed number exact.
      const each =
        op.perDiscardAll !== undefined && hitsAll(state, me)
          ? (base > 0 ? perRival(state, me, base) : 0) + op.perDiscardAll * (ctx.discarded ?? 0)
          : perRival(state, me, amount);
      if (each <= 0) return null;
      for (const target of targets) {
        for (let i = 0; i < times; i++) {
          if (state.players[target]!.eliminated) break;
          dealDamage(state, events, me, target, each, {
            kind: op.kind ?? 'normal',
            cause: ctx.source.kind === 'ultimate' ? 'ultimate' : 'card',
            attack: true,
            ...(op.wallMultiplier !== undefined ? { wallMultiplier: op.wallMultiplier } : {}),
          });
          if (checkGameOver(state, events)) return null;
        }
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
      const each = perRival(state, me, op.amount);
      for (const target of targets) {
        stealResource(state, events, me, target, highestOf(state.players[target]!.resources), each, reason);
      }
      return null;
    }

    case 'drainResources': {
      const each = perRival(state, me, op.amount);
      for (const target of targets) {
        changeResources(state, events, target, { piedra: -each, acero: -each, mana: -each }, reason);
      }
      return null;
    }

    case 'loseWorker':
      for (const target of targets) {
        changeWorkers(state, events, target, { [highestOf(state.players[target]!.workers)]: -1 }, reason);
      }
      return null;

    case 'stealWorker': {
      // The opponent keeps at least `minWorkers`; you gain the worker either way.
      // Against several rivals each one loses a worker but you gain only one.
      // In a duel the log reads it as one steal when the opponent really lost the worker.
      const worker = highestOf(opp.workers);
      const lost: PlayerId[] = [];
      for (const target of targets) {
        const link = targets.length === 1 ? { to: me } : {};
        const real = changeWorkers(state, events, target, { [highestOf(state.players[target]!.workers)]: -1 }, reason, link);
        if (Object.keys(real).length) lost.push(target);
      }
      const from = targets.length === 1 && lost.length === 1 ? { from: lost[0]! } : {};
      changeWorkers(state, events, me, { [worker]: 1 }, reason, from);
      return null;
    }

    case 'burn': {
      const turns = perRival(state, me, op.turns + statusDurationBonus(state, me));
      for (const target of targets) {
        const t = state.players[target]!;
        t.burn = Math.min(state.rules.burnMaxTurns, t.burn + turns);
        events.push({ type: 'burnApplied', player: target, turns, total: t.burn });
      }
      return null;
    }

    case 'frost':
      if (op.scope === 'all') {
        for (const target of targets) applyFrost(state, events, ctx, target, RESOURCES, op.turns);
      } else if (targets.length > 1) {
        for (const target of targets) {
          applyFrost(state, events, ctx, target, [topResource(state, target)], op.turns);
        }
      } else if (answer !== null) applyFrost(state, events, ctx, them, [answer as Resource], op.turns);
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
        existing.turnsLeft = op.turns ?? 0;
        existing.fresh = true;
        if (op.charges !== undefined) existing.charges = op.charges;
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
        self.enchantments.push({
          cardId,
          turnsLeft: op.turns ?? 0,
          fresh: true,
          ...(op.charges !== undefined ? { charges: op.charges } : {}),
        });
      }
      events.push({
        type: 'enchantmentAdded',
        player: me,
        cardId,
        turns: op.turns ?? 0,
        ...(op.charges !== undefined ? { charges: op.charges } : {}),
        refreshed: !!existing,
      });
      return null;
    }

    case 'destroyEnchantment': {
      // Against several rivals each one loses its longest-lasting enchantment.
      const picks: [PlayerId, string | null][] =
        targets.length > 1
          ? targets.map((t) => [
              t,
              [...state.players[t]!.enchantments].sort((a, b) => enchantmentLife(b) - enchantmentLife(a))[0]?.cardId ?? null,
            ])
          : [[them, answer]];
      for (const [target, cardId] of picks) {
        if (cardId === null) continue;
        const list = state.players[target]!.enchantments;
        const index = list.findIndex((e) => e.cardId === cardId);
        if (index >= 0) {
          list.splice(index, 1);
          events.push({ type: 'enchantmentRemoved', player: target, cardId, reason: 'destroyed' });
        }
      }
      return null;
    }

    case 'revealHand':
      for (const target of targets) {
        const t = state.players[target]!;
        t.handRevealed = true;
        // Only free-for-all needs to know who revealed it; duels keep the player objects' shape stable (speed).
        if (!duel) t.revealedBy = me;
        events.push({ type: 'handRevealed', player: target, cards: t.hand.map((c) => ({ ...c })) });
      }
      return null;

    case 'drawbridge':
      self.drawbridge = true;
      events.push({ type: 'drawbridgeRaised', player: me });
      return null;

    case 'peekAndDiscard': {
      let hit = false;
      if (targets.length > 1) {
        // Against several rivals each one loses its most expensive card.
        for (const target of targets) {
          const hand = state.players[target]!.hand;
          const best = [...hand].sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost)[0];
          if (best && discardFromHand(state, events, target, best.uid, 'effect')) hit = true;
        }
      } else if (answer !== null) hit = discardFromHand(state, events, them, Number(answer), 'effect');
      return hit ? { ops: [], ctx: afterDiscard(state, events, ctx) } : null;
    }

    case 'discardRandom': {
      let hit = false;
      for (const target of targets) {
        const hand = state.players[target]!.hand;
        for (let i = 0; i < op.count && hand.length > 0; i++) {
          discardFromHand(state, events, target, randomPick(state, hand).uid, 'effect');
          hit = true;
        }
      }
      return hit ? { ops: [], ctx: afterDiscard(state, events, ctx) } : null;
    }

    case 'discardOwn': {
      const discarded = ctx.discarded ?? 0;
      if (op.count === 'hand') {
        const uids = self.hand.map((c) => c.uid);
        for (const uid of uids) discardFromHand(state, events, me, uid, 'effect');
        const after = uids.length > 0 ? afterDiscard(state, events, ctx) : ctx;
        return { ops: [], ctx: { ...after, discarded: discarded + uids.length } };
      }
      if (answer === null || answer === 'done') return null;
      if (!discardFromHand(state, events, me, Number(answer), 'effect')) return null;
      // The remaining discards come back as a smaller copy of this op.
      return {
        ops: op.count > 1 ? [{ ...op, count: op.count - 1 }] : [],
        ctx: { ...afterDiscard(state, events, ctx), discarded: discarded + 1 },
      };
    }

    case 'draw':
      drawCards(state, events, me, op.count);
      return null;

    case 'swapWalls': {
      // Against several rivals: swap with the tallest Wall.
      const rival = targets.reduce((a, b) => (state.players[b]!.wall > state.players[a]!.wall ? b : a), them);
      const mine = self.wall;
      self.wall = state.players[rival]!.wall;
      state.players[rival]!.wall = mine;
      events.push({ type: 'wallsSwapped', walls: state.players.map((p) => p.wall) });
      return null;
    }

    case 'copyLast': {
      const from = copySource(state, me);
      const copied = from === null ? null : state.players[from]!.lastPlayedCard;
      if (copied === null) return null;
      // From now on this counts as the last card you played, so a Mirage
      // answering a Mirage copies the original card instead of looping.
      self.lastPlayedCard = copied;
      events.push({ type: 'cardCopied', player: me, cardId: copied });
      return {
        ops: getCard(copied).effects,
        ctx: {
          player: me,
          source: { kind: 'card', id: copied },
          combo: false,
          ...(ctx.target !== undefined ? { target: ctx.target } : {}),
        },
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
