import { applyAction, legalActions, nextRandom, rollOutcomes } from '@cardcraft-castles/engine';
import type { Action, ActionResult, CardId, GameState, PlayerId, PlayerView, RngHolder } from '@cardcraft-castles/engine';
import { determinize } from './determinize';
import type { Profile } from './difficulty';
import { WIN, evaluate, holdValue, type Weights } from './evaluate';

/**
 * Look-ahead. For every option the AI has, the rest of its turn is played out
 * with the real engine and the result is judged with `evaluate`. Harder
 * levels also play the opponent's best reply before judging, and average
 * over several guesses of the hidden cards.
 */

/** Positions looked at inside a single turn before the search stops branching. */
const TURN_NODE_BUDGET = 120;

interface Leaf {
  state: GameState;
  /** Evaluation of `state`, minus `penalty`. */
  value: number;
  /** What the turn cost beyond what the state shows: a discard is a turn without a play. */
  penalty: number;
}

function cardOf(state: GameState, player: PlayerId, uid: number): CardId {
  return state.players[player].hand.find((c) => c.uid === uid)!.cardId;
}

/**
 * The ways an action can turn out, with their chances. A card that rolls a
 * die gives one result per distinct outcome, so the AI weighs the whole die
 * instead of trusting the one face its guessed world would roll. Anything
 * else gives just its own result.
 */
function outcomes(state: GameState, action: Action): { result: ActionResult; chance: number }[] {
  if (action.type === 'play') {
    const card = state.players[action.player]!.hand.find((c) => c.uid === action.uid);
    const rolls = card ? rollOutcomes(card.cardId) : null;
    if (rolls) return rolls.map((o) => ({ result: applyAction(state, action, { rolls: [o.roll] }), chance: o.chance }));
  }
  return [{ result: applyAction(state, action), chance: 1 }];
}

/**
 * The options worth telling apart: one play and one discard per distinct
 * card (two copies of a card lead to the same position). With `onlyBestDiscard`
 * the discards collapse into the single card the player would miss least.
 */
function distinctActions(state: GameState, w: Weights, onlyBestDiscard: boolean): Action[] {
  const player = state.active;
  const result: Action[] = [];
  const seen = new Set<string>();
  let discard: Action | null = null;
  let discardValue = Infinity;
  for (const action of legalActions(state)) {
    if (action.type === 'play' || action.type === 'discard') {
      const cardId = cardOf(state, player, action.uid);
      const key = `${action.type}:${cardId}:${action.type === 'play' ? (action.target ?? '') : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (action.type === 'discard' && onlyBestDiscard) {
        const value = holdValue(state, player, cardId, w);
        if (value < discardValue) {
          discardValue = value;
          discard = action;
        }
        continue;
      }
    }
    result.push(action);
  }
  if (discard) result.push(discard);
  return result;
}

/**
 * Play out the rest of `player`'s turn the way that is best for them and
 * return where it ends: the first state in which the turn has passed (or an
 * extra turn has begun, or the game is over).
 */
function bestTurn(
  start: GameState,
  player: PlayerId,
  w: Weights,
  rootUid: number,
  onlyBestDiscard: boolean,
  startPenalty = 0,
): Leaf {
  const turn = start.turn;
  let budget = TURN_NODE_BUDGET;

  // The best way to finish the turn from `state`. A die roll is a chance node:
  // its value is the average of its outcomes, and the line goes on from the
  // likeliest one.
  const visit = (state: GameState, penalty: number): Leaf => {
    const turnOver = state.phase === 'finished' || state.active !== player || state.turn !== turn;
    if (!turnOver && budget > 0) {
      let best: Leaf | null = null;
      for (const action of distinctActions(state, w, onlyBestDiscard)) {
        const branches = outcomes(state, action);
        budget -= branches.length;
        const cost = penalty + (action.type === 'discard' ? w.discard : 0);
        let value = 0;
        let likeliest: Leaf | null = null;
        let likeliestChance = -1;
        for (const { result, chance } of branches) {
          if (!result.ok) continue;
          const leaf = visit(result.state, cost);
          value += chance * leaf.value;
          if (chance > likeliestChance) {
            likeliest = leaf;
            likeliestChance = chance;
          }
        }
        if (!likeliest) continue;
        const leaf = branches.length === 1 ? likeliest : { ...likeliest, value };
        if (!best || leaf.value > best.value) best = leaf;
      }
      if (best) return best;
    }
    return { state, value: evaluate(state, player, w, rootUid) - penalty, penalty };
  };

  return visit(start, startPenalty);
}

/** Let both sides play their best turn until the opponent has moved `replies` times. */
function playOut(start: GameState, me: PlayerId, replies: number, w: Weights, rootUid: number): number {
  let state = start;
  let opponentTurns = 0;
  // Extra turns can make one side move twice in a row; the guard bounds the loop.
  for (let guard = 0; guard < replies * 3 + 2; guard++) {
    if (state.phase === 'finished' || opponentTurns >= replies) break;
    const mover = state.active;
    state = bestTurn(state, mover, w, rootUid, true).state;
    if (mover !== me) opponentTurns += 1;
  }
  return evaluate(state, me, w, rootUid);
}

/** A standard normal sample (Box-Muller). */
function gaussian(rng: RngHolder): number {
  const u = Math.max(nextRandom(rng), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * nextRandom(rng));
}

export interface RankedAction {
  action: Action;
  /** Average evaluation of the positions this option leads to. */
  value: number;
}

/**
 * Value every option the viewer has, best first. Empty when the viewer is not
 * the one to move.
 */
export function rankActions(view: PlayerView, profile: Profile, w: Weights, rng: RngHolder): RankedAction[] {
  const me = view.viewer;
  const legal = legalActions(view);
  if (legal.length === 0) return [];

  // One option per distinct card, exactly as in `distinctActions`, but from the view.
  const options: Action[] = [];
  const seen = new Set<string>();
  for (const action of legal) {
    let key: string;
    if (action.type === 'play' || action.type === 'discard') {
      const target = action.type === 'play' ? (action.target ?? '') : '';
      key = `${action.type}:${view.players[me]!.hand.find((c) => c.uid === action.uid)!.cardId}:${target}`;
    } else {
      key =
        action.type === 'choose'
          ? `choose:${action.option}`
          : action.type === 'ultimate'
            ? `ultimate:${action.target ?? ''}`
            : action.type;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(action);
  }
  if (options.length === 1) return [{ action: options[0]!, value: 0 }];

  const worlds: GameState[] = [];
  for (let i = 0; i < Math.max(1, profile.worlds); i++) {
    const world = determinize(view, rng);
    if (world) worlds.push(world);
  }
  // A choice that cannot be rebuilt: take the engine's default, the first option.
  if (worlds.length === 0) return options.map((action, i) => ({ action, value: -i }));
  const rootUid = worlds[0]!.nextUid;

  // First look: the AI's own turn, in every world (and every outcome of a die).
  const leaves: { leaf: Leaf; chance: number }[][][] = options.map(() => []);
  const ranked: RankedAction[] = options.map((action) => ({ action, value: 0 }));
  for (const world of worlds) {
    options.forEach((action, i) => {
      const branches = outcomes(world, action).map(({ result, chance }) => ({
        chance,
        leaf: result.ok
          ? bestTurn(result.state, me, w, rootUid, false, action.type === 'discard' ? w.discard : 0)
          : ({ state: world, value: -WIN, penalty: 0 } satisfies Leaf),
      }));
      leaves[i]!.push(branches);
      ranked[i]!.value += branches.reduce((v, b) => v + b.chance * b.leaf.value, 0) / worlds.length;
    });
  }

  // Second look: the best few options again, this time with the opponent's reply.
  if (profile.replies > 0) {
    const order = options.map((_, i) => i).sort((a, b) => ranked[b]!.value - ranked[a]!.value);
    const deep = order.slice(0, Math.max(1, profile.candidates));
    const floor = ranked[deep[deep.length - 1]!]!.value;
    let deepWorst = Infinity;
    for (const i of deep) {
      let total = 0;
      for (const branches of leaves[i]!) {
        for (const { leaf, chance } of branches) {
          total += chance * (playOut(leaf.state, me, profile.replies, w, rootUid) - leaf.penalty);
        }
      }
      ranked[i]!.value = total / worlds.length;
      deepWorst = Math.min(deepWorst, ranked[i]!.value);
    }
    // The options that were not looked at again stay below the ones that were, in their old order.
    for (const i of order.slice(deep.length)) {
      ranked[i]!.value = deepWorst - 1 - (floor - ranked[i]!.value);
    }
  }

  if (profile.noise > 0) {
    for (const entry of ranked) {
      // A sure win or loss is never obscured.
      if (Math.abs(entry.value) < WIN / 4) entry.value += profile.noise * gaussian(rng);
    }
  }
  return ranked.sort((a, b) => b.value - a.value);
}

/** The action a player with this profile takes. */
export function pickAction(view: PlayerView, profile: Profile, w: Weights, rng: RngHolder): Action {
  const ranked = rankActions(view, profile, w, rng);
  if (ranked.length === 0) throw new Error('The AI was asked to move when it is not its turn');
  const best = ranked[0]!;
  // An impulsive player sometimes plays the first card that comes to hand, unless a win is on the table.
  if (profile.impulse > 0 && best.value < WIN / 2 && nextRandom(rng) < profile.impulse) {
    const plays = ranked.filter((entry) => entry.action.type === 'play' && entry.value > -WIN / 4);
    if (plays.length > 0) return plays[Math.floor(nextRandom(rng) * plays.length)]!.action;
  }
  return best.action;
}
