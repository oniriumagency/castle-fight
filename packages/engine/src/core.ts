import { RESOURCES, SCHOOL_RESOURCE, getBattleEvent, getCard, getEnchantmentModifiers, getHero } from './catalog';
import { shuffle } from './rng';
import type {
  Board,
  CardId,
  ChangeReason,
  DamageKind,
  EffectOp,
  Enchantment,
  GameEvent,
  GameOverReason,
  GameState,
  HeroId,
  HeroPassive,
  PlayerId,
  PlayerState,
  Resource,
  ResourceMap,
  StealLink,
  Rules,
  School,
  VisibleCard,
} from './types';

/** Shared low-level helpers. Everything here mutates the state it is given. */

/** The opponent in a 2-player game. With 3+ players use `opponents` instead. */
export function other(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Seats (2 players, or 3+ in free-for-all)
// ---------------------------------------------------------------------------

type Seats = Pick<Board, 'players'>;

export function isAlive(state: Seats, player: PlayerId): boolean {
  return !state.players[player]?.eliminated;
}

/** Players still in the game. */
export function alivePlayers(state: Seats): PlayerId[] {
  return state.players.map((_, i) => i).filter((i) => isAlive(state, i));
}

/** Living rivals of `player`, in turn order starting with the one who plays next. */
export function opponents(state: Seats, player: PlayerId): PlayerId[] {
  const n = state.players.length;
  const list: PlayerId[] = [];
  for (let k = 1; k < n; k++) {
    const p = (player + k) % n;
    if (isAlive(state, p)) list.push(p);
  }
  return list;
}

/** The next living player after `player` in turn order (`player` itself if alone). */
export function nextAlive(state: Seats, player: PlayerId): PlayerId {
  return opponents(state, player)[0] ?? player;
}

/** True when the game has 3+ seats (free-for-all rules apply). */
export function isMultiplayer(state: Seats): boolean {
  return state.players.length > 2;
}

/** A hero's passive at a table of this size (some heroes have their own numbers for 3+ players). */
export function heroPassiveFor(heroId: HeroId, multiplayer: boolean): HeroPassive {
  const hero = getHero(heroId);
  return (multiplayer && hero.ffa?.passive) || hero.passive;
}

/** A hero's ultimate at a table of this size. */
export function heroUltimateFor(heroId: HeroId, multiplayer: boolean): EffectOp[] {
  const hero = getHero(heroId);
  return (multiplayer && hero.ffa?.ultimate) || hero.ultimate;
}

/** The passive of the hero `player` plays, for this table. */
export function heroPassive(state: Seats, player: PlayerId): HeroPassive {
  if (state.players[player]!.noPassive) return {};
  return heroPassiveFor(state.players[player]!.hero, isMultiplayer(state));
}

/** The living player with the strictly highest Keep, or null on a tie. */
export function leaderOf(state: Seats & { players: { keep: number }[] }): PlayerId | null {
  let best: PlayerId | null = null;
  let tie = false;
  for (const p of alivePlayers(state)) {
    if (best === null || state.players[p]!.keep > state.players[best]!.keep) {
      best = p;
      tie = false;
    } else if (state.players[p]!.keep === state.players[best]!.keep) tie = true;
  }
  return tie ? null : best;
}

/**
 * The rival a single-target effect hits when nobody picked one: the living
 * rival with the highest Keep (then Wall), so the default goes after the leader.
 */
export function defaultTarget(state: GameState, player: PlayerId): PlayerId {
  const list = opponents(state, player);
  let best = list[0] ?? other(player);
  for (const p of list) {
    const a = state.players[p]!;
    const b = state.players[best]!;
    if (a.keep > b.keep || (a.keep === b.keep && a.wall > b.wall)) best = p;
  }
  return best;
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
    players: s.players.map(clonePlayer),
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

/** One source of the flat damage added to each attack: the hero, an enchantment or the Twilight Fury. */
export interface AttackBonusPart {
  source: 'hero' | 'enchantment' | 'twilight';
  amount: number;
  /** The enchantment's card, for `source: 'enchantment'`. */
  cardId?: CardId;
  /** Attacks the enchantment still lasts, when it is counted in attacks. */
  charges?: number;
}

/** What adds damage to each attack of `player`, one entry per source (only the ones that add something). */
export function attackBonusParts(state: Board, player: PlayerId): AttackBonusPart[] {
  const p = state.players[player];
  const parts: AttackBonusPart[] = [];
  const hero = heroPassive(state, player).attackBonus ?? 0;
  if (hero) parts.push({ source: 'hero', amount: hero });
  for (const e of p.enchantments) {
    const amount = getEnchantmentModifiers(e.cardId)?.attackBonus ?? 0;
    if (amount) parts.push({ source: 'enchantment', amount, cardId: e.cardId, ...(e.charges !== undefined ? { charges: e.charges } : {}) });
  }
  const twilight = twilightLevel(state) * (state.rules.twilightAttackBonus ?? 0);
  if (twilight) parts.push({ source: 'twilight', amount: twilight });
  return parts;
}

/** Flat damage added to each attack of `player` (hero passive, enchantments and the Twilight Fury). */
export function attackBonus(state: Board, player: PlayerId): number {
  return attackBonusParts(state, player).reduce((sum, part) => sum + part.amount, 0);
}

/** How long an enchantment still lasts: attacks left, or owner turns left. */
export function enchantmentLife(e: Enchantment): number {
  return e.charges ?? e.turnsLeft;
}

/**
 * Spend one charge of each of `player`'s enchantments counted in attacks that
 * has `modifier`, and remove the ones that run out.
 */
function spendCharges(
  state: GameState,
  events: GameEvent[],
  player: PlayerId,
  modifier: 'attackBonus' | 'wallDamageReduction',
): void {
  const p = state.players[player];
  for (const e of [...p.enchantments]) {
    if (e.charges === undefined || !getEnchantmentModifiers(e.cardId)?.[modifier]) continue;
    e.charges -= 1;
    events.push({ type: 'enchantmentCharge', player, cardId: e.cardId, charges: e.charges });
    if (e.charges <= 0) {
      p.enchantments.splice(p.enchantments.indexOf(e), 1);
      events.push({ type: 'enchantmentRemoved', player, cardId: e.cardId, reason: 'spent' });
    }
  }
}

/** Current round; saves from before rounds were counted derive it from the turn. */
export function roundOf(board: { turn: number; round?: number; players: readonly unknown[] }): number {
  return board.round ?? Math.ceil(board.turn / board.players.length);
}

/**
 * Twilight Fury level in a round: 0 before it starts (or when the rules turn
 * it off), then 1, 2, 3... rising every `twilightEvery` rounds.
 */
export function twilightLevel(board: { rules: Rules; turn: number; round?: number; players: readonly unknown[] }, round = roundOf(board)): number {
  const start = board.rules.twilightRound ?? 0;
  if (start <= 0 || round < start) return 0;
  return 1 + Math.floor((round - start) / Math.max(1, board.rules.twilightEvery ?? 1));
}

/** Damage removed from each attack that hits the Wall of `player`. */
export function wallDamageReduction(state: Board, player: PlayerId): number {
  let reduction = 0;
  for (const e of state.players[player].enchantments) {
    reduction += getEnchantmentModifiers(e.cardId)?.wallDamageReduction ?? 0;
  }
  return reduction;
}

/** Damage `player` must take to charge the next ultimate; it grows with every use. */
export function ultimateThreshold(state: Board, player: PlayerId): number {
  return state.rules.ultimateCharge + state.rules.ultimateChargeStep * state.players[player].ultimateUses;
}

/** Extra turns added to the Burn and Frost that `player` applies. */
export function statusDurationBonus(state: Board, player: PlayerId): number {
  return heroPassive(state, player).statusDurationBonus ?? 0;
}

/** True if a running battle event forbids playing this card. */
export function isSchoolBanned(state: Board, cardId: CardId): boolean {
  if (!state.activeEvent) return false;
  const effect = getBattleEvent(state.activeEvent.id).effect;
  return effect.kind === 'banSchool' && effect.school === getCard(cardId).school;
}

/** What Rust does: while it lasts, cards of this school cost this much more. */
export const RUST = Object.freeze({ school: 'asalto' as School, costIncrease: 2 });

/**
 * What `player` pays right now for `cardId`, after hero passives, enemy
 * enchantments and battle events. Never below 0.
 */
export function effectiveCost(state: Board, player: PlayerId, cardId: CardId): number {
  const card = getCard(cardId);
  let cost = card.cost;

  const reduction = heroPassive(state, player).costReduction;
  if (reduction && reduction.school === card.school) cost -= reduction.amount;

  // Enchantments of every living rival (no array allocated: this is on the AI's hot path).
  const n = state.players.length;
  for (let rival = n === 2 ? other(player) : 0; rival < n; rival++) {
    const p = state.players[rival]!;
    if (rival !== player && !p.eliminated) {
      for (const e of p.enchantments) {
        const increase = getEnchantmentModifiers(e.cardId)?.opponentCostIncrease;
        if (increase && increase.school === card.school) cost += increase.amount;
      }
    }
    if (n === 2) break;
  }

  // Rust on this player (Maldición de Óxido).
  if ((state.players[player].rust ?? 0) > 0 && card.school === RUST.school) cost += RUST.costIncrease;

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
  link: StealLink = {},
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
  if (changed) events.push({ type: 'resourcesChanged', player, delta: real, reason, ...link });
  return real;
}

/** Add (or remove) workers, never below `rules.minWorkers`. Emits the real change. */
export function changeWorkers(
  state: GameState,
  events: GameEvent[],
  player: PlayerId,
  delta: Partial<ResourceMap>,
  reason: ChangeReason,
  link: StealLink = {},
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
  if (changed) events.push({ type: 'workersChanged', player, delta: real, reason, ...link });
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
    // The attack is made even if a Shield blocks it.
    spendCharges(state, events, source, 'attackBonus');
    // Free-for-all: the leader is everyone's target, so it takes a little more.
    if (state.rules.leaderExtraDamage && isMultiplayer(state) && leaderOf(state) === target) {
      amount += state.rules.leaderExtraDamage;
    }
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

  // Drawbridge: the next piercing attack is treated as normal damage, and lowers it.
  if (kind === 'piercing' && t.drawbridge && options.attack) {
    kind = 'normal';
    t.drawbridge = false;
    events.push({ type: 'drawbridgeLowered', player: target });
  }

  if (options.attack && kind !== 'piercing' && t.wall > 0) {
    const reduction = wallDamageReduction(state, target);
    if (reduction > 0) {
      amount = Math.max(0, amount - reduction);
      spendCharges(state, events, target, 'wallDamageReduction');
    }
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
  if (taken > 0 && !t.ultimateLocked && t.ultimateCharge < max) {
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

/**
 * The Saboteur's passive: steal `stealOnDiscard` of the opponent's biggest
 * stockpile (with 3+ players, from every rival in `all` mode, or from the
 * default target in `choose` mode). Returns false if the
 * hero has no such passive. Callers fire it at most once per action or card.
 */
export function saboteurSteal(state: GameState, events: GameEvent[], player: PlayerId): boolean {
  const self = state.players[player];
  const steal = heroPassive(state, player).stealOnDiscard;
  if (!steal) return false;
  // When every card hits all rivals, so does the passive: she robs each of them.
  const victims = !isMultiplayer(state)
    ? [other(player)]
    : state.rules.multiTargeting === 'all'
      ? opponents(state, player)
      : [defaultTarget(state, player)];
  for (const victim of victims) {
    const resource = highestOf(state.players[victim].resources);
    stealResource(state, events, player, victim, resource, steal, { kind: 'hero', id: self.hero });
  }
  return true;
}

/** Move up to `amount` of one resource from `victim` to `thief`. Returns what was taken. */
export function stealResource(
  state: GameState,
  events: GameEvent[],
  thief: PlayerId,
  victim: PlayerId,
  resource: Resource,
  amount: number,
  reason: ChangeReason,
): number {
  const taken = -(changeResources(state, events, victim, { [resource]: -amount }, reason, { to: thief })[resource] ?? 0);
  if (taken > 0) changeResources(state, events, thief, { [resource]: taken }, reason, { from: victim });
  return taken;
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

/** Take `player` out of the game (3+ players). `by` gains the elimination bounty. */
export function eliminate(state: GameState, events: GameEvent[], player: PlayerId, by: PlayerId | null): void {
  const p = state.players[player]!;
  if (p.eliminated) return;
  p.eliminated = true;
  p.keep = Math.max(0, p.keep);
  p.burn = 0;
  p.rust = 0;
  p.extraTurns = 0;
  for (const e of p.enchantments) {
    events.push({ type: 'enchantmentRemoved', player, cardId: e.cardId, reason: 'destroyed' });
  }
  p.enchantments = [];
  if (p.handRevealed) {
    p.handRevealed = false;
    events.push({ type: 'handHidden', player });
  }
  events.push({ type: 'playerEliminated', player, by });
  const bounty = state.rules.eliminationBounty;
  if (by !== null && by !== player && bounty > 0) {
    changeResources(state, events, by, { piedra: bounty, acero: bounty, mana: bounty }, { kind: 'bounty', id: 'elimination' });
  }
  if (state.active === player && state.phase !== 'finished') {
    // The fallen player's turn is over: drop any pending choice.
    state.pending = null;
    state.phase = 'action';
    state.actionsLeft = 0;
  }
}

/**
 * End the game if a Keep reached the winning height or fell to 0. When several
 * players qualify at once, the active player wins (then turn order decides).
 * With 3+ players a fallen castle is eliminated and the game goes on until one
 * castle is left standing. Returns true if the game is over.
 */
export function checkGameOver(state: GameState, events: GameEvent[]): boolean {
  if (state.phase === 'finished') return true;
  const win = state.rules.keepWin;
  const a = state.active;
  if (state.players.length === 2) {
    // Duel fast path (same outcome as the general case below).
    const b = other(a);
    const pa = state.players[a]!;
    const pb = state.players[b]!;
    if (pa.keep >= win) finishGame(state, events, a, 'keepBuilt');
    else if (pb.keep <= 0) finishGame(state, events, a, 'keepDestroyed');
    else if (pa.keep <= 0) finishGame(state, events, b, 'keepDestroyed');
    else if (pb.keep >= win) finishGame(state, events, b, 'keepBuilt');
    return state.result !== null;
  }
  const order = [a, ...opponents(state, a)];
  const alive = (p: PlayerId) => !state.players[p]!.eliminated;

  if (alive(a) && state.players[a]!.keep >= win) {
    finishGame(state, events, a, 'keepBuilt');
    return true;
  }
  const fallen = order.filter((p) => alive(p) && state.players[p]!.keep <= 0);
  const standing = order.filter((p) => alive(p) && state.players[p]!.keep > 0);
  if (fallen.length > 0) {
    if (standing.length === 0) {
      // Everyone fell at once: the active player wins.
      finishGame(state, events, a, 'keepDestroyed');
      return true;
    }
    if (standing.length === 1) {
      finishGame(state, events, standing[0]!, 'keepDestroyed');
      return true;
    }
    for (const p of fallen) eliminate(state, events, p, a);
  }
  const builder = standing.find((p) => state.players[p]!.keep >= win);
  if (builder !== undefined) finishGame(state, events, builder, 'keepBuilt');
  return state.result !== null;
}
