import { RESOURCES, SCHOOL_RESOURCE, getBattleEvent, getCard, getEnchantmentModifiers, getHero } from './catalog';
import { shuffle } from './rng';
import type {
  CardId,
  ChangeReason,
  DamageKind,
  GameEvent,
  GameOverReason,
  GameState,
  PlayerId,
  PlayerState,
  Resource,
  ResourceMap,
  VisibleCard,
} from './types';

/** Shared low-level helpers. Everything here mutates the state it is given. */

export function other(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

export function emptyResources(value = 0): ResourceMap {
  return { piedra: value, acero: value, mana: value };
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    resources: { ...p.resources },
    workers: { ...p.workers },
    hand: p.hand.map((c) => ({ ...c })),
    deck: p.deck.slice(),
    discard: p.discard.slice(),
    enchantments: p.enchantments.map((e) => ({ ...e })),
    frost: { ...p.frost },
    schoolsThisTurn: p.schoolsThisTurn.slice(),
    schoolsLastTurn: p.schoolsLastTurn.slice(),
  };
}

/**
 * Deep copy of a state. Rules and effect definitions are shared because the
 * engine never mutates them.
 */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
    pending: s.pending
      ? {
          ...s.pending,
          options: s.pending.options.slice(),
          ...(s.pending.revealed ? { revealed: s.pending.revealed.map((c) => ({ ...c })) } : {}),
          ctx: { ...s.pending.ctx, source: { ...s.pending.ctx.source } },
          rest: s.pending.rest.slice(),
        }
      : null,
    activeEvent: s.activeEvent ? { ...s.activeEvent } : null,
    upcomingEvent: { ...s.upcomingEvent },
    result: s.result ? { ...s.result } : null,
  };
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

/** Flat damage added to each attack of `player` (hero passive and enchantments). */
export function attackBonus(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  let bonus = getHero(p.hero).passive.attackBonus ?? 0;
  for (const e of p.enchantments) bonus += getEnchantmentModifiers(e.cardId)?.attackBonus ?? 0;
  return bonus;
}

/** Damage removed from each attack that hits the Wall of `player`. */
export function wallDamageReduction(state: GameState, player: PlayerId): number {
  let reduction = 0;
  for (const e of state.players[player].enchantments) {
    reduction += getEnchantmentModifiers(e.cardId)?.wallDamageReduction ?? 0;
  }
  return reduction;
}

/** Damage `player` must take to charge the next ultimate; it grows with every use. */
export function ultimateThreshold(state: GameState, player: PlayerId): number {
  return state.rules.ultimateCharge + state.rules.ultimateChargeStep * state.players[player].ultimateUses;
}

/** Extra turns added to the Burn and Frost that `player` applies. */
export function statusDurationBonus(state: GameState, player: PlayerId): number {
  return getHero(state.players[player].hero).passive.statusDurationBonus ?? 0;
}

/** True if a running battle event forbids playing this card. */
export function isSchoolBanned(state: GameState, cardId: CardId): boolean {
  if (!state.activeEvent) return false;
  const effect = getBattleEvent(state.activeEvent.id).effect;
  return effect.kind === 'banSchool' && effect.school === getCard(cardId).school;
}

/**
 * What `player` pays right now for `cardId`, after hero passives, enemy
 * enchantments and battle events. Never below 0.
 */
export function effectiveCost(state: GameState, player: PlayerId, cardId: CardId): number {
  const card = getCard(cardId);
  let cost = card.cost;

  const reduction = getHero(state.players[player].hero).passive.costReduction;
  if (reduction && reduction.school === card.school) cost -= reduction.amount;

  for (const e of state.players[other(player)].enchantments) {
    const increase = getEnchantmentModifiers(e.cardId)?.opponentCostIncrease;
    if (increase && increase.school === card.school) cost += increase.amount;
  }

  cost = Math.max(0, cost);

  if (state.activeEvent) {
    const effect = getBattleEvent(state.activeEvent.id).effect;
    if (effect.kind === 'halfCost' && effect.school === card.school) cost = Math.ceil(cost / 2);
  }
  return cost;
}

/** Resource that pays for `cardId`. */
export function costResource(cardId: CardId): Resource {
  return SCHOOL_RESOURCE[getCard(cardId).school];
}

/** The resource (or worker type) with the highest count; ties go to the first in `RESOURCES`. */
export function highestOf(map: ResourceMap): Resource {
  let best: Resource = RESOURCES[0]!;
  for (const r of RESOURCES) if (map[r] > map[best]) best = r;
  return best;
}

// ---------------------------------------------------------------------------
// Resources, structures
// ---------------------------------------------------------------------------

/** Add (or remove) resources, clamping at 0. Emits the real change. */
export function changeResources(
  state: GameState,
  events: GameEvent[],
  player: PlayerId,
  delta: Partial<ResourceMap>,
  reason: ChangeReason,
): Partial<ResourceMap> {
  const p = state.players[player];
  const real: Partial<ResourceMap> = {};
  let changed = false;
  for (const r of RESOURCES) {
    const d = delta[r];
    if (!d) continue;
    const next = Math.max(0, p.resources[r] + d);
    if (next !== p.resources[r]) {
      real[r] = next - p.resources[r];
      p.resources[r] = next;
      changed = true;
    }
  }
  if (changed) events.push({ type: 'resourcesChanged', player, delta: real, reason });
  return real;
}

/** Add (or remove) workers, never below `rules.minWorkers`. Emits the real change. */
export function changeWorkers(
  state: GameState,
  events: GameEvent[],
  player: PlayerId,
  delta: Partial<ResourceMap>,
  reason: ChangeReason,
): Partial<ResourceMap> {
  const p = state.players[player];
  const real: Partial<ResourceMap> = {};
  let changed = false;
  for (const r of RESOURCES) {
    const d = delta[r];
    if (!d) continue;
    const next = Math.max(state.rules.minWorkers, p.workers[r] + d);
    if (next !== p.workers[r]) {
      real[r] = next - p.workers[r];
      p.workers[r] = next;
      changed = true;
    }
  }
  if (changed) events.push({ type: 'workersChanged', player, delta: real, reason });
  return real;
}

/** Raise a Keep (capped at the winning height) or a Wall. */
export function build(
  state: GameState,
  events: GameEvent[],
  player: PlayerId,
  target: 'keep' | 'wall',
  amount: number,
  reason: ChangeReason,
): void {
  const p = state.players[player];
  const before = p[target];
  p[target] = target === 'keep' ? Math.min(state.rules.keepWin, before + amount) : before + amount;
  const real = p[target] - before;
  if (real > 0) events.push({ type: 'built', player, target, amount: real, reason });
}

/** Lower a Keep or Wall without it being an attack (battle events). */
export function loseStructure(
  state: GameState,
  events: GameEvent[],
  player: PlayerId,
  target: 'keep' | 'wall',
  amount: number,
  floor: number,
  reason: ChangeReason,
): void {
  const p = state.players[player];
  const before = p[target];
  p[target] = Math.max(Math.min(before, floor), before - amount);
  const real = before - p[target];
  if (real > 0) events.push({ type: 'structureLost', player, target, amount: real, reason });
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export interface HitOptions {
  kind: DamageKind;
  cause: 'card' | 'ultimate' | 'burn';
  /**
   * Attacks come from cards and ultimates: they get attack bonuses, can be
   * blocked by Shield and are reduced by Buttresses. Burn is not an attack.
   */
  attack: boolean;
  /** Multiplies the damage the Wall takes (Iron Ram). */
  wallMultiplier?: number;
}

/** Resolve one hit from `source` against `target`. */
export function dealDamage(
  state: GameState,
  events: GameEvent[],
  source: PlayerId,
  target: PlayerId,
  baseAmount: number,
  options: HitOptions,
): void {
  const t = state.players[target];
  let amount = baseAmount;
  let kind = options.kind;

  if (options.attack) {
    amount += attackBonus(state, source);
    if (t.shield > 0) {
      t.shield -= 1;
      events.push({
        type: 'damage',
        source,
        target,
        kind,
        cause: options.cause,
        amount,
        wallLoss: 0,
        keepLoss: 0,
        blocked: true,
      });
      return;
    }
  }

  if (kind === 'piercing' && t.drawbridge) kind = 'normal';

  if (options.attack && kind !== 'piercing' && t.wall > 0) {
    amount = Math.max(0, amount - wallDamageReduction(state, target));
  }

  const mult = options.wallMultiplier ?? 1;
  let wallLoss = 0;
  let keepLoss = 0;
  if (kind === 'piercing') {
    keepLoss = amount;
  } else {
    // Each point of damage removes `mult` Wall; points left once the Wall is
    // gone carry over to the Keep (unless the hit is wall-only).
    const pointsOnWall = Math.min(amount, Math.ceil(t.wall / mult));
    wallLoss = Math.min(t.wall, pointsOnWall * mult);
    if (kind === 'normal') keepLoss = amount - pointsOnWall;
  }
  keepLoss = Math.min(t.keep, keepLoss);

  t.wall -= wallLoss;
  t.keep -= keepLoss;
  events.push({
    type: 'damage',
    source,
    target,
    kind,
    cause: options.cause,
    amount,
    wallLoss,
    keepLoss,
    blocked: false,
  });

  const taken = wallLoss + keepLoss;
  const max = ultimateThreshold(state, target);
  if (taken > 0 && t.ultimateCharge < max) {
    t.ultimateCharge = Math.min(max, t.ultimateCharge + taken);
    events.push({
      type: 'ultimateCharged',
      player: target,
      charge: t.ultimateCharge,
      threshold: max,
      ready: t.ultimateCharge >= max,
    });
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Draw up to `count` cards, reshuffling the discard pile when the deck runs out. */
export function drawCards(state: GameState, events: GameEvent[], player: PlayerId, count: number): void {
  const p = state.players[player];
  const drawn: VisibleCard[] = [];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      p.deck = shuffle(state, p.discard);
      p.discard = [];
      events.push({ type: 'deckReshuffled', player });
    }
    const cardId = p.deck.pop()!;
    const card = { uid: state.nextUid++, cardId };
    p.hand.push(card);
    drawn.push({ ...card });
  }
  if (drawn.length > 0) {
    events.push({ type: 'cardsDrawn', player, cards: drawn, visible: p.handRevealed });
  }
}

/** Move a card from a hand to its owner's discard pile. Returns false if it is not there. */
export function discardFromHand(
  state: GameState,
  events: GameEvent[],
  player: PlayerId,
  uid: number,
  reason: 'action' | 'timeout' | 'effect',
): boolean {
  const p = state.players[player];
  const index = p.hand.findIndex((c) => c.uid === uid);
  if (index < 0) return false;
  const [card] = p.hand.splice(index, 1);
  p.discard.push(card!.cardId);
  events.push({ type: 'cardDiscarded', player, uid, cardId: card!.cardId, reason });
  return true;
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

export function finishGame(
  state: GameState,
  events: GameEvent[],
  winner: PlayerId | null,
  reason: GameOverReason,
): void {
  state.result = { winner, reason };
  state.phase = 'finished';
  state.pending = null;
  state.actionsLeft = 0;
  events.push({ type: 'gameOver', winner, reason });
}

/**
 * End the game if a Keep reached the winning height or fell to 0. When both
 * players qualify at once, the active player wins. Returns true if the game is over.
 */
export function checkGameOver(state: GameState, events: GameEvent[]): boolean {
  if (state.phase === 'finished') return true;
  const a = state.active;
  const b = other(a);
  const pa = state.players[a];
  const pb = state.players[b];
  const win = state.rules.keepWin;
  if (pa.keep >= win) finishGame(state, events, a, 'keepBuilt');
  else if (pb.keep <= 0) finishGame(state, events, a, 'keepDestroyed');
  else if (pa.keep <= 0) finishGame(state, events, b, 'keepDestroyed');
  else if (pb.keep >= win) finishGame(state, events, b, 'keepBuilt');
  return state.result !== null;
}
