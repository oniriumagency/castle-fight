/**
 * Cardcraft: Castles AI opponent.
 *
 *   import { chooseAction } from '@cardcraft-castles/ai';
 *   const action = chooseAction(state, 'hard');   // one action for `state.active`
 *
 * It runs in the browser, needs no server and never looks at hidden cards:
 * it only uses what the player in that seat can see.
 */
export {
  chooseAction,
  chooseActionFromView,
  explainActions,
  aiPolicy,
  type AiOptions,
} from './ai';
export {
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  DIFFICULTY_DESCRIPTIONS,
  PROFILES,
  type Difficulty,
  type Profile,
} from './difficulty';
export { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate';
export { determinize } from './determinize';
export type { RankedAction } from './search';
export {
  runBalance,
  runLadder,
  mergeBalance,
  type BalanceOptions,
  type BalanceReport,
  type CardStats,
  type LadderOptions,
  type Contender,
  type LadderReport,
} from './balance';
