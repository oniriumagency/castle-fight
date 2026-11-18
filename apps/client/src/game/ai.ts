import { eagerPolicy, hashSeed, legalActions, type Action, type GameState } from '@cardcraft-castles/engine';

/**
 * The AI opponent. This is a stand-in until `@cardcraft-castles/ai` lands:
 * the AI thread exports `chooseAction(state, level, { seed })` with this
 * same shape, synchronous and without cheating (it only reads the active
 * player's view). Swap the body of `chooseAiAction` for that call.
 */

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export function chooseAiAction(state: GameState, level: Difficulty): Action {
  void level;
  const rng = { rng: hashSeed(`${state.seq}-${state.turn}-${state.rng}`) };
  return eagerPolicy(state, legalActions(state), rng);
}
