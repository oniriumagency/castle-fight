import { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS, DIFFICULTY_NAMES, chooseAction, type Difficulty } from '@cardcraft-castles/ai';
import type { Action, GameState } from '@cardcraft-castles/engine';

/** The AI opponent from `@cardcraft-castles/ai`: one action per call for `state.active`. */
export { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS, DIFFICULTY_NAMES, type Difficulty };

export function chooseAiAction(state: GameState, level: Difficulty): Action {
  return chooseAction(state, level);
}
