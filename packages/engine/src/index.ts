/**
 * Cardcraft: Castles rules engine.
 *
 * Pure, deterministic and dependency-free: the same code runs on the server
 * (authoritative), in the browser (previews, AI) and in simulations.
 *
 *   const { state } = createGame({ seed, heroes: ['arquitecta', 'mariscal'] });
 *   const result = applyAction(state, { type: 'play', player: 0, uid });
 *   if (result.ok) { state = result.state; animate(result.events); }
 */

export type * from './types';

export { createGame, type GameOptions } from './setup';
export {
  applyAction,
  legalActions,
  replay,
  currentPlayer,
  isUltimateReady,
  isComboActive,
  isBoostActive,
  playBlocker,
  choosesTargets,
  cardNeedsTarget,
} from './actions';
export { getPlayerView, redactEvents } from './view';
export { isConditionMet, effectsNeedTarget } from './effects';
export {
  effectiveCost,
  costResource,
  attackBonus,
  enchantmentLife,
  roundOf,
  twilightLevel,
  wallDamageReduction,
  isSchoolBanned,
  other,
  opponents,
  alivePlayers,
  leaderOf,
  ultimateThreshold,
} from './core';

export {
  CARDS,
  HEROES,
  BATTLE_EVENTS,
  DEFAULT_RULES,
  SCHOOLS,
  RESOURCES,
  RARITIES,
  SCHOOL_RESOURCE,
  getCard,
  getHero,
  getBattleEvent,
  getEnchantmentModifiers,
  hasCombo,
  isCardId,
  isHeroId,
  buildDeckList,
} from './catalog';

export {
  GAME_TITLE,
  LOCALES,
  TERMS,
  SCHOOL_NAMES,
  RESOURCE_NAMES,
  WORKER_NAMES,
  RARITY_NAMES,
  localize,
} from './i18n';

export {
  playGame,
  simulate,
  randomPolicy,
  eagerPolicy,
  type Policy,
  type PlayoutOptions,
  type PlayoutResult,
  type SimulationOptions,
  type SimulationReport,
} from './simulator';

export { hashSeed, nextRandom, randomInt, randomPick, shuffle, type RngHolder } from './rng';
