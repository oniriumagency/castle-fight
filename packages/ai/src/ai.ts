import { getPlayerView, hashSeed, nextRandom } from '@cardcraft-castles/engine';
import type { Action, GameState, PlayerView, Policy, RngHolder } from '@cardcraft-castles/engine';
import { PROFILES, type Difficulty, type Profile } from './difficulty';
import { DEFAULT_WEIGHTS, type Weights } from './evaluate';
import { pickAction, rankActions, type RankedAction } from './search';

/** The AI's entry points: `chooseAction` and friends. */

export interface AiOptions {
  /**
   * Makes the decision reproducible. By default it is derived from the
   * position, so the same position always gets the same answer.
   */
  seed?: number | string;
  /** Replaces the level's settings (for experiments and tests). */
  profile?: Partial<Profile>;
  /** Replaces the evaluation weights (for experiments and tests). */
  weights?: Weights;
}

function setup(view: PlayerView, level: Difficulty, options: AiOptions | undefined) {
  const hand = view.players[view.viewer].hand.map((c) => c.uid).join(',');
  const seed = options?.seed ?? `${view.seq}:${view.turn}:${view.viewer}:${hand}`;
  return {
    profile: { ...PROFILES[level], ...options?.profile },
    weights: options?.weights ?? DEFAULT_WEIGHTS,
    rng: { rng: hashSeed(`ai:${seed}`) } satisfies RngHolder,
  };
}

/**
 * The AI's move for the player who must act in `view` (the viewer). Works
 * from a client-side view, so it can also suggest a move to a human player.
 */
export function chooseActionFromView(view: PlayerView, level: Difficulty, options?: AiOptions): Action {
  if (view.phase === 'finished') throw new Error('The game is over: there is nothing to choose');
  if (view.active !== view.viewer) throw new Error('It is not the turn of the player this view belongs to');
  const { profile, weights, rng } = setup(view, level, options);
  return pickAction(view, profile, weights, rng);
}

/**
 * The AI's move for `state.active`: exactly one action, so call it again
 * while it is still the AI's turn (after an ultimate, an extra play or a
 * pending choice). The full state is only used to build that player's view.
 */
export function chooseAction(state: GameState, level: Difficulty, options?: AiOptions): Action {
  if (state.phase === 'finished') throw new Error('The game is over: there is nothing to choose');
  return chooseActionFromView(getPlayerView(state, state.active), level, options);
}

/** Every option of the player to move with the value the AI gives it, best first. */
export function explainActions(view: PlayerView, level: Difficulty, options?: AiOptions): RankedAction[] {
  const { profile, weights, rng } = setup(view, level, options);
  return rankActions(view, { ...profile, noise: 0 }, weights, rng);
}

/** The AI as a `Policy` for the engine's `playGame` and `simulate`. */
export function aiPolicy(level: Difficulty, options?: Omit<AiOptions, 'seed'>): Policy {
  return (state, _legal, rng) =>
    chooseAction(state, level, { ...options, seed: Math.floor(nextRandom(rng) * 0x100000000) });
}
