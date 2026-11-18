import {
  DEFAULT_RULES,
  RESOURCES,
  costResource,
  effectiveCost,
  enchantmentLife,
  getCard,
  getHero,
  getEnchantmentModifiers,
  isSchoolBanned,
  ultimateThreshold,
} from '@cardcraft-castles/engine';
import type {
  CardId,
  EffectOp,
  EnchantmentModifiers,
  GameState,
  HeroId,
  PlayerId,
} from '@cardcraft-castles/engine';

/**
 * Position evaluation: one number that says how good a state is for a player,
 * in "points" that are roughly one point of Keep in the middle of a game.
 * The search plays out each option with the real engine and compares the
 * resulting states with this function, so no card needs its own AI code.
 */

export interface Weights {
  /** Value of a Keep point in the middle of the range. */
  keep: number;
  /** Extra value of a Keep point when the Keep is about to fall, and how fast that fades. */
  keepDanger: number;
  keepDangerTau: number;
  /** Extra value of a Keep point when the Keep is about to win, and how fast that fades. */
  keepGoal: number;
  keepGoalTau: number;
  /** Value of the first Wall point; later points are worth less (scale `wallTau`). */
  wall: number;
  wallTau: number;
  /** How much more the Wall matters when the Keep behind it is low. */
  wallDanger: number;
  /** Value of the first point of a resource; later points are worth less (scale `resourceTau`). */
  resource: number;
  resourceTau: number;
  /** Value of the first worker of a type for each turn the game is expected to go on. */
  worker: number;
  /** Later workers of the same type are worth less: the n-th is worth half at n = 1 + `workerHalf`. */
  workerHalf: number;
  /** Income matters less when the stock of that resource is already large (scale `workerStockTau`). */
  workerStockTau: number;
  /** Cap on the expected number of turns left, and the speeds used to estimate it. */
  horizonMax: number;
  killPace: number;
  buildPace: number;
  /** Value of one point of pending Burn damage. */
  burn: number;
  /** Value of one resource that Frost will stop from being produced. */
  frost: number;
  /** Value of one Shield charge. */
  shield: number;
  /** Share of the ultimate's value credited for charge already built up. */
  ultimate: number;
  /** Value of having the move (an extra turn). */
  tempo: number;
  /** Share of a card's potential that counts while it is still in hand. */
  hand: number;
  /** What a point of cost takes away from a card's potential. */
  spend: number;
  /** A card that cannot be paid for yet loses this share of its value per turn of waiting. */
  holdDecay: number;
  /** What a turn spent discarding costs: the play that was not made. */
  discard: number;
  /** Value of each card missing from a hand at the start of its owner's turn. */
  cardSlot: number;
  /** Per-turn value of enchantment modifiers, per point. */
  enchantAttack: number;
  enchantWallReduction: number;
  enchantCostIncrease: number;
  /**
   * 3+ players: how much the strongest rival counts against you, against the
   * average of all rivals (1 = only the strongest). Defaults to 0.6.
   */
  rivalFocus?: number;
}

export const DEFAULT_WEIGHTS: Readonly<Weights> = Object.freeze({
  keep: 1,
  keepDanger: 1.6,
  keepDangerTau: 20,
  keepGoal: 1.2,
  keepGoalTau: 23,
  wall: 0.8,
  wallTau: 40,
  wallDanger: 0.8,
  resource: 0.9,
  resourceTau: 20,
  worker: 1,
  workerHalf: 3,
  workerStockTau: 25,
  horizonMax: 10,
  killPace: 8,
  buildPace: 8,
  burn: 0.8,
  frost: 0.75,
  shield: 8,
  ultimate: 0.5,
  tempo: 10,
  hand: 0.25,
  spend: 0.65,
  holdDecay: 0.85,
  discard: 4,
  cardSlot: 2.5,
  enchantAttack: 0.7,
  enchantWallReduction: 0.6,
  enchantCostIncrease: 0.65,
});

/** Larger than any real evaluation; a win is `WIN` minus the turn it happens on. */
export const WIN = 100_000;

// ---------------------------------------------------------------------------
// Nominal values: what an effect is worth in general, before looking at the board
// ---------------------------------------------------------------------------

function modifiersPerTurn(mods: EnchantmentModifiers, w: Weights): number {
  let value = 0;
  for (const op of mods.onTurnStart ?? []) value += opNominal(op, w);
  value += (mods.attackBonus ?? 0) * w.enchantAttack;
  value += (mods.wallDamageReduction ?? 0) * w.enchantWallReduction;
  value += (mods.opponentCostIncrease?.amount ?? 0) * w.enchantCostIncrease;
  return value;
}

function sum(ops: readonly EffectOp[], w: Weights): number {
  let value = 0;
  for (const op of ops) value += opNominal(op, w);
  return value;
}

/** Cards a "for each card discarded" effect is worth counting on. */
const DISCARDS_EXPECTED = 2.5;

function opNominal(op: EffectOp, w: Weights): number {
  switch (op.op) {
    case 'wall':
      return (op.amount + (op.comboBonus ?? 0) * 0.35 + (op.perDiscard ?? 0) * DISCARDS_EXPECTED) * w.wall * 0.7;
    case 'keep':
      return (op.amount + (op.comboBonus ?? 0) * 0.35 + (op.perDiscard ?? 0) * DISCARDS_EXPECTED) * w.keep * 1.15;
    case 'damage': {
      const kind = op.kind ?? 'normal';
      const perPoint = kind === 'piercing' ? 1.2 : kind === 'wallOnly' ? 0.5 : 0.95;
      const amount = op.amount + (op.comboBonus ?? 0) * 0.35 + (op.perDiscard ?? 0) * DISCARDS_EXPECTED;
      return amount * (op.times ?? 1) * perPoint * (op.wallMultiplier ? 1.15 : 1);
    }
    case 'gainResource':
      return op.amount * (op.resource === 'all' ? 3 : 1) * w.resource * 0.7;
    case 'gainWorker':
      return op.amount * w.worker * 8;
    case 'stealResource':
      return op.amount * w.resource * 1.4;
    case 'drainResources':
      return op.amount * 3 * w.resource * 0.6;
    case 'loseWorker':
      return w.worker * 7;
    case 'stealWorker':
      return w.worker * 14;
    case 'burn':
      return op.turns * DEFAULT_RULES.burnDamage * w.burn;
    case 'frost':
      return op.turns * (op.scope === 'all' ? 6 : 2) * w.frost;
    case 'shield':
      return op.charges * w.shield;
    case 'cleanse':
      return 3;
    case 'enchant':
      // An enchantment counted in attacks lasts about one attack per turn.
      return (op.charges ?? op.turns ?? 0) * modifiersPerTurn(op.modifiers, w);
    case 'destroyEnchantment':
      return 5;
    case 'revealHand':
      return 1;
    case 'drawbridge':
      return 2;
    case 'peekAndDiscard':
      return 6;
    case 'discardRandom':
      return 5 * op.count;
    case 'discardOwn':
      // The hand refills when the next turn starts, so a discard only costs card quality.
      return op.upTo ? 0 : -(op.count === 'hand' ? 4 : op.count);
    case 'draw':
      return op.count;
    case 'swapWalls':
      return 7;
    case 'copyLast':
      return 8;
    case 'extraTurn':
      return w.tempo + 5;
    case 'redrawHand':
    case 'extraPlay':
      return 2;
    case 'if': {
      const a = sum(op.then, w);
      const b = sum(op.else ?? [], w);
      return Math.max(a, b) * 0.6 + Math.min(a, b) * 0.4;
    }
  }
}

interface Tables {
  /** Value of a Keep of each height. */
  keep: Float64Array;
  /** Value of having n workers of one type, before the turns-left and stock factors. */
  workers: Float64Array;
  card: Map<CardId, number>;
  ultimate: Map<HeroId, number>;
  enchantment: Map<CardId, number>;
}

const tablesByWeights = new WeakMap<Weights, Map<number, Tables>>();

function tablesFor(w: Weights, keepWin: number): Tables {
  let byWin = tablesByWeights.get(w);
  if (!byWin) tablesByWeights.set(w, (byWin = new Map()));
  let tables = byWin.get(keepWin);
  if (!tables) {
    const keep = new Float64Array(keepWin + 2);
    for (let k = 1; k < keep.length; k++) {
      const marginal =
        w.keep +
        w.keepDanger * Math.exp(-(k - 1) / w.keepDangerTau) +
        w.keepGoal * Math.exp(-(keepWin - k) / w.keepGoalTau);
      keep[k] = keep[k - 1]! + marginal;
    }
    const workers = new Float64Array(64);
    for (let n = 1; n < workers.length; n++) {
      workers[n] = workers[n - 1]! + 1 / (1 + ((n - 1) / w.workerHalf) ** 2);
    }
    tables = { keep, workers, card: new Map(), ultimate: new Map(), enchantment: new Map() };
    byWin.set(keepWin, tables);
  }
  return tables;
}

function cardNominal(tables: Tables, cardId: CardId, w: Weights): number {
  let value = tables.card.get(cardId);
  if (value === undefined) {
    value = sum(getCard(cardId).effects, w);
    tables.card.set(cardId, value);
  }
  return value;
}

function ultimateNominal(tables: Tables, hero: HeroId, w: Weights): number {
  let value = tables.ultimate.get(hero);
  if (value === undefined) {
    value = sum(getHero(hero).ultimate, w);
    tables.ultimate.set(hero, value);
  }
  return value;
}

function enchantmentPerTurn(tables: Tables, cardId: CardId, w: Weights): number {
  let value = tables.enchantment.get(cardId);
  if (value === undefined) {
    const mods = getEnchantmentModifiers(cardId);
    value = mods ? modifiersPerTurn(mods, w) : 0;
    tables.enchantment.set(cardId, value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Rough number of turns each player still has, from how close either Keep is to the end. */
function horizon(state: GameState, w: Weights): number {
  // A plain loop: this runs for every position the search looks at.
  let weakest = Infinity;
  let tallest = 0;
  for (const p of state.players) {
    if (p.eliminated) continue;
    weakest = Math.min(weakest, p.keep + p.wall * 0.5);
    tallest = Math.max(tallest, p.keep);
  }
  const toKill = weakest / w.killPace;
  const toBuild = (state.rules.keepWin - tallest) / w.buildPace;
  return Math.max(1, Math.min(w.horizonMax, toKill, toBuild));
}

/**
 * What a card in hand is worth to its owner: its potential minus its cost,
 * discounted by how long it will take to afford it.
 */
export function holdValue(state: GameState, player: PlayerId, cardId: CardId, w: Weights): number {
  const tables = tablesFor(w, state.rules.keepWin);
  const p = state.players[player];
  const cost = effectiveCost(state, player, cardId);
  const resource = costResource(cardId);
  let value = Math.max(0.5, cardNominal(tables, cardId, w) - w.spend * cost);
  const missing = cost - p.resources[resource];
  if (missing > 0) {
    const wait = Math.ceil(missing / Math.max(1, p.workers[resource])) + p.frost[resource];
    value *= Math.pow(w.holdDecay, wait);
  }
  if (isSchoolBanned(state, cardId)) value *= w.holdDecay;
  return value;
}

function sideValue(
  state: GameState,
  player: PlayerId,
  turnsLeft: number,
  w: Weights,
  tables: Tables,
  rootUid: number,
): number {
  const p = state.players[player];
  const rules = state.rules;
  const exposure = Math.exp(-p.keep / w.keepDangerTau);

  let value = tables.keep[Math.max(0, Math.min(rules.keepWin, p.keep))]!;
  value += w.wall * w.wallTau * (1 - Math.exp(-p.wall / w.wallTau)) * (1 + w.wallDanger * exposure);

  for (const r of RESOURCES) {
    value += w.resource * w.resourceTau * (1 - Math.exp(-p.resources[r] / w.resourceTau));
    const scarce = 0.4 + 0.6 * Math.exp(-p.resources[r] / w.workerStockTau);
    value += w.worker * turnsLeft * tables.workers[Math.min(63, p.workers[r])]! * scarce;
    if (p.frost[r] > 0) {
      // Frost hurts more on a resource the player is short of.
      const starved = 1 + 5 / (5 + p.resources[r]);
      value -= w.frost * Math.min(p.frost[r], turnsLeft) * p.workers[r] * starved;
    }
  }

  if (p.burn > 0) value -= w.burn * rules.burnDamage * p.burn * (1 + exposure);
  value += w.shield * p.shield;

  for (const e of p.enchantments) {
    value += Math.min(enchantmentLife(e), turnsLeft + 1) * enchantmentPerTurn(tables, e.cardId, w);
  }

  const threshold = ultimateThreshold(state, player);
  value += w.ultimate * ultimateNominal(tables, p.hero, w) * Math.min(1, p.ultimateCharge / threshold);
  value += w.tempo * p.extraTurns;

  // Cards drawn during the look-ahead are guesses, so only the hand as it was counts.
  for (const card of p.hand) {
    if (card.uid < rootUid) value += w.hand * holdValue(state, player, card.cardId, w);
  }
  if (state.active === player && state.phase === 'action' && state.actionsLeft > 0) {
    value -= w.cardSlot * Math.max(0, rules.handSize - p.hand.length);
  }
  return value;
}

/**
 * How good `state` is for `me`: positive when ahead. `rootUid` is the first
 * card uid that did not exist when the look-ahead started.
 */
export function evaluate(state: GameState, me: PlayerId, w: Weights, rootUid: number): number {
  if (state.result) {
    if (state.result.winner === null) return 0;
    return state.result.winner === me ? WIN - state.turn : -WIN + state.turn;
  }
  if (state.players[me]!.eliminated) return -WIN + state.turn;
  const tables = tablesFor(w, state.rules.keepWin);
  const turnsLeft = horizon(state, w);
  const mine = sideValue(state, me, turnsLeft, w, tables, rootUid);
  if (state.players.length <= 2) {
    const opponent: PlayerId = me === 0 ? 1 : 0;
    return (
      mine - sideValue(state, opponent, turnsLeft, w, tables, rootUid) + (state.active === me ? w.tempo / 2 : -w.tempo / 2)
    );
  }
  // Free-for-all: what matters is the strongest rival, and a little the rest.
  // A fallen rival counts as 0, so knocking one out is worth a lot.
  const rivals = state.players
    .map((p, i) => (i === me ? null : p.eliminated ? 0 : sideValue(state, i, turnsLeft, w, tables, rootUid)))
    .filter((v): v is number => v !== null);
  const focus = w.rivalFocus ?? 0.6;
  const strongest = Math.max(...rivals);
  const average = rivals.reduce((a, b) => a + b, 0) / rivals.length;
  const value = mine - (focus * strongest + (1 - focus) * average);
  return value + (state.active === me ? w.tempo / 2 : -w.tempo / 2);
}
