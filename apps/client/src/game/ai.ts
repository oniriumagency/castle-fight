import { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS, DIFFICULTY_NAMES, chooseAction, profileForTier, type Difficulty } from '@cardcraft-castles/ai';
import type { Action, GameState } from '@cardcraft-castles/engine';

/** The AI opponent from `@cardcraft-castles/ai`: one action per call for `state.active`. */
export { DIFFICULTIES, DIFFICULTY_DESCRIPTIONS, DIFFICULTY_NAMES, type Difficulty };

/** `tier` (campaign) picks a level between the named ones: 0 Easy, 1 Normal, 2 Hard. */
export function chooseAiAction(state: GameState, level: Difficulty, tier?: number): Action {
  return tier === undefined ? chooseAction(state, level) : chooseAction(state, level, { profile: profileForTier(tier) });
}
