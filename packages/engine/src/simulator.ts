import { applyAction, legalActions } from './actions';
import { HEROES } from './catalog';
import { hashSeed, randomPick, type RngHolder } from './rng';
import { createGame, type GameOptions } from './setup';
import type { Action, CardId, GameOverReason, GameState, HeroId, PlayerId, Rules } from './types';

/**
 * Random playouts: play whole games with simple policies. Used by the tests
 * to shake out rule bugs and by `pnpm sim` for a first look at balance. The
 * AI and the balance report build on the same functions.
 */

/** Chooses the next action. `rng` is separate from the game's own RNG. */
export type Policy = (state: GameState, legal: Action[], rng: RngHolder) => Action;

/** Uniformly random among all legal actions (it discards a lot). */
export const randomPolicy: Policy = (_state, legal, rng) => randomPick(rng, legal);

/**
 * Plays like an impatient beginner: uses the ultimate as soon as it is ready,
 * plays a random card it can afford, and only discards when it can play nothing.
 */
export const eagerPolicy: Policy = (_state, legal, rng) => {
  const ultimate = legal.find((a) => a.type === 'ultimate');
  if (ultimate) return ultimate;
  const plays = legal.filter((a) => a.type === 'play' || a.type === 'choose');
  return randomPick(rng, plays.length > 0 ? plays : legal);
};

export interface PlayoutOptions extends GameOptions {
  /** One policy for every player, or one each. Defaults to `eagerPolicy`. */
  policy?: Policy | Policy[];
  /** Called after every action, for invariant checks. */
  onStep?: (state: GameState, action: Action) => void;
  /** Safety net against endless games. */
  maxActions?: number;
}

export interface PlayoutResult {
  winner: PlayerId | null;
  reason: GameOverReason | 'maxActions';
  turns: number;
  firstPlayer: PlayerId;
  actions: Action[];
  /** Cards played by each player, in order. */
  played: CardId[][];
  finalState: GameState;
}

/** Play one whole game. */
export function playGame(options: PlayoutOptions): PlayoutResult {
  const policies: Policy[] = Array.isArray(options.policy)
    ? options.policy
    : options.heroes.map(() => (options.policy as Policy | undefined) ?? eagerPolicy);
  const rng: RngHolder = { rng: hashSeed(`policy:${options.seed}`) };
  const maxActions = options.maxActions ?? 5000;

  let { state } = createGame(options);
  const firstPlayer = state.active;
  const actions: Action[] = [];
  const played: CardId[][] = options.heroes.map(() => []);

  while (state.phase !== 'finished' && actions.length < maxActions) {
    const action = policies[state.active]!(state, legalActions(state), rng);
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(`Policy chose an illegal action (${result.error.code}): ${JSON.stringify(action)}`);
    }
    for (const event of result.events) {
      if (event.type === 'cardPlayed') played[event.player]!.push(event.cardId);
    }
    state = result.state;
    actions.push(action);
    options.onStep?.(state, action);
  }

  return {
    winner: state.result?.winner ?? null,
    reason: state.result?.reason ?? 'maxActions',
    turns: state.turn,
    firstPlayer,
    actions,
    played,
    finalState: state,
  };
}

export interface SimulationOptions {
  games: number;
  seed?: number | string;
  /** Heroes to draw from. Defaults to all of them. */
  heroes?: HeroId[];
  policy?: Policy | Policy[];
  rules?: Partial<Rules>;
  /** Players per game (2 by default; 3 for the free-for-all prototype). */
  players?: number;
}

export interface SimulationReport {
  games: number;
  averageTurns: number;
  minTurns: number;
  maxTurns: number;
  /** Share of decided games won by the player who moved first. */
  firstPlayerWinRate: number;
  /** Share of decided games won by each seat in turn order (index 0 = moved first). */
  seatWinRates: number[];
  draws: number;
  reasons: Record<string, number>;
  heroes: Record<HeroId, { games: number; wins: number; winRate: number }>;
  /** For each card: times played, and how often the player who played it won. */
  cards: Record<CardId, { played: number; winRate: number }>;
}

/** Play many games with random hero pairings and summarise them. */
export function simulate(options: SimulationOptions): SimulationReport {
  const heroPool = options.heroes ?? HEROES.map((h) => h.id);
  const rng: RngHolder = { rng: hashSeed(`sim:${options.seed ?? 0}`) };

  const reasons: Record<string, number> = {};
  const heroes: SimulationReport['heroes'] = {};
  const cardStats: Record<CardId, { played: number; inWins: number }> = {};
  let totalTurns = 0;
  let minTurns = Infinity;
  let maxTurns = 0;
  let decided = 0;
  let firstPlayerWins = 0;
  let draws = 0;
  const seats = options.players ?? 2;
  const seatWins: number[] = Array.from({ length: seats }, () => 0);

  for (let i = 0; i < options.games; i++) {
    const pair: HeroId[] = Array.from({ length: seats }, () => randomPick(rng, heroPool));
    const result = playGame({
      seed: `${options.seed ?? 0}:${i}`,
      heroes: pair,
      ...(options.policy ? { policy: options.policy } : {}),
      ...(options.rules ? { rules: options.rules } : {}),
    });

    totalTurns += result.turns;
    minTurns = Math.min(minTurns, result.turns);
    maxTurns = Math.max(maxTurns, result.turns);
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (result.winner === null) draws += 1;
    else {
      decided += 1;
      if (result.winner === result.firstPlayer) firstPlayerWins += 1;
      seatWins[(result.winner - result.firstPlayer + seats) % seats]! += 1;
    }

    for (let player = 0; player < seats; player++) {
      const hero = (heroes[pair[player]!] ??= { games: 0, wins: 0, winRate: 0 });
      hero.games += 1;
      if (result.winner === player) hero.wins += 1;
      for (const cardId of result.played[player]!) {
        const card = (cardStats[cardId] ??= { played: 0, inWins: 0 });
        card.played += 1;
        if (result.winner === player) card.inWins += 1;
      }
    }
  }

  for (const hero of Object.values(heroes)) hero.winRate = hero.games ? hero.wins / hero.games : 0;
  const cards: SimulationReport['cards'] = {};
  for (const [id, stats] of Object.entries(cardStats)) {
    cards[id] = { played: stats.played, winRate: stats.played ? stats.inWins / stats.played : 0 };
  }

  return {
    games: options.games,
    averageTurns: options.games ? totalTurns / options.games : 0,
    minTurns: options.games ? minTurns : 0,
    maxTurns,
    firstPlayerWinRate: decided ? firstPlayerWins / decided : 0,
    seatWinRates: seatWins.map((w) => (decided ? w / decided : 0)),
    draws,
    reasons,
    heroes,
    cards,
  };
}
