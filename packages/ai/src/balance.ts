import { HEROES, eagerPolicy, playGame, randomPolicy } from '@cardcraft-castles/engine';
import type { CardId, HeroId, Policy, Rules } from '@cardcraft-castles/engine';
import type { Difficulty } from './difficulty';
import { aiPolicy, type AiOptions } from './ai';

/**
 * AI-versus-AI tournaments. `runBalance` plays every hero against every hero
 * and counts what happened; `runLadder` pits two kinds of player against each
 * other. Both return plain counts so that runs split across processes can be
 * added together with `mergeBalance`.
 */

/** A difficulty level, or one of the engine's aimless policies as a baseline. */
export type Contender = Difficulty | 'eager' | 'random';

type AiTweaks = Omit<AiOptions, 'seed'>;

function policyFor(contender: Contender, tweaks?: AiTweaks): Policy {
  if (contender === 'eager') return eagerPolicy;
  if (contender === 'random') return randomPolicy;
  return aiPolicy(contender, tweaks);
}

export interface CardStats {
  /** Times the card was played. */
  played: number;
  /** Times it was discarded as the turn's action instead. */
  discarded: number;
  /** Players (one per game and seat) who played it at least once... */
  players: number;
  /** ...and how many of them won. */
  winners: number;
}

export interface BalanceReport {
  games: number;
  /** `turns[n]` is the number of games that lasted n turns. */
  turns: number[];
  /** Decided games, and those won by the player who moved first. */
  decided: number;
  firstPlayerWins: number;
  draws: number;
  /** How the games ended. */
  reasons: Record<string, number>;
  /** `matchups[a][b]`: games of hero a against hero b and how many a won. Mirrors are counted once. */
  matchups: Record<HeroId, Record<HeroId, { games: number; wins: number }>>;
  cards: Record<CardId, CardStats>;
}

export interface BalanceOptions {
  /** Games per ordered hero pairing (36 pairings with the six heroes). */
  gamesPerPairing: number;
  seed?: number | string;
  /** Who plays: one level for both seats by default. */
  level?: Difficulty;
  heroes?: HeroId[];
  rules?: Partial<Rules>;
  /** Play only every `count`-th game, starting at `index`, to split a run across processes. */
  shard?: { index: number; count: number };
  ai?: AiTweaks;
}

function emptyReport(): BalanceReport {
  return { games: 0, turns: [], decided: 0, firstPlayerWins: 0, draws: 0, reasons: {}, matchups: {}, cards: {} };
}

/** Wrap a policy so that the cards it discards are counted. */
function countingDiscards(policy: Policy, discarded: CardId[]): Policy {
  return (state, legal, rng) => {
    const action = policy(state, legal, rng);
    if (action.type === 'discard') {
      const card = state.players[state.active].hand.find((c) => c.uid === action.uid);
      if (card) discarded.push(card.cardId);
    }
    return action;
  };
}

/** Every hero against every hero, both players at the same level. */
export function runBalance(options: BalanceOptions): BalanceReport {
  const heroes = options.heroes ?? HEROES.map((h) => h.id);
  const report = emptyReport();
  const policy = policyFor(options.level ?? 'normal', options.ai);
  const shard = options.shard ?? { index: 0, count: 1 };
  let index = 0;

  for (const a of heroes) {
    for (const b of heroes) {
      for (let g = 0; g < options.gamesPerPairing; g++) {
        if (index++ % shard.count !== shard.index) continue;
        const discards: [CardId[], CardId[]] = [[], []];
        const result = playGame({
          seed: `${options.seed ?? 0}:${a}:${b}:${g}`,
          heroes: [a, b],
          policy: [countingDiscards(policy, discards[0]), countingDiscards(policy, discards[1])],
          ...(options.rules ? { rules: options.rules } : {}),
        });

        report.games += 1;
        report.turns[result.turns] = (report.turns[result.turns] ?? 0) + 1;
        report.reasons[result.reason] = (report.reasons[result.reason] ?? 0) + 1;
        if (result.winner === null) report.draws += 1;
        else {
          report.decided += 1;
          if (result.winner === result.firstPlayer) report.firstPlayerWins += 1;
        }

        const pair = [a, b] as const;
        for (const seat of [0, 1] as const) {
          const won = result.winner === seat;
          // A mirror match is one game of that hero, not two.
          if (a !== b || seat === 0) {
            const row = (report.matchups[pair[seat]] ??= {});
            const cell = (row[pair[1 - seat]!] ??= { games: 0, wins: 0 });
            cell.games += 1;
            if (won) cell.wins += 1;
          }
          const stats = (id: CardId): CardStats =>
            (report.cards[id] ??= { played: 0, discarded: 0, players: 0, winners: 0 });
          for (const id of result.played[seat]) stats(id).played += 1;
          for (const id of discards[seat]) stats(id).discarded += 1;
          for (const id of new Set(result.played[seat])) {
            stats(id).players += 1;
            if (won) stats(id).winners += 1;
          }
        }
      }
    }
  }
  return report;
}

/** Add up reports from separate runs. */
export function mergeBalance(reports: readonly BalanceReport[]): BalanceReport {
  const total = emptyReport();
  for (const r of reports) {
    total.games += r.games;
    total.decided += r.decided;
    total.firstPlayerWins += r.firstPlayerWins;
    total.draws += r.draws;
    r.turns.forEach((n, t) => {
      if (n) total.turns[t] = (total.turns[t] ?? 0) + n;
    });
    for (const [k, n] of Object.entries(r.reasons)) total.reasons[k] = (total.reasons[k] ?? 0) + n;
    for (const [a, row] of Object.entries(r.matchups)) {
      for (const [b, cell] of Object.entries(row)) {
        const sum = ((total.matchups[a] ??= {})[b] ??= { games: 0, wins: 0 });
        sum.games += cell.games;
        sum.wins += cell.wins;
      }
    }
    for (const [id, s] of Object.entries(r.cards)) {
      const sum = (total.cards[id] ??= { played: 0, discarded: 0, players: 0, winners: 0 });
      sum.played += s.played;
      sum.discarded += s.discarded;
      sum.players += s.players;
      sum.winners += s.winners;
    }
  }
  return total;
}

export interface LadderOptions {
  /** Each game is played twice with the seats swapped, so the total is twice this. */
  pairs: number;
  a: Contender;
  b: Contender;
  seed?: number | string;
  rules?: Partial<Rules>;
  shard?: { index: number; count: number };
  aiA?: AiTweaks;
  aiB?: AiTweaks;
}

export interface LadderReport {
  games: number;
  winsA: number;
  winsB: number;
  draws: number;
  totalTurns: number;
}

/** Contender `a` against contender `b`, with random heroes and both seats for each deal. */
export function runLadder(options: LadderOptions): LadderReport {
  const heroes = HEROES.map((h) => h.id);
  const policies = [policyFor(options.a, options.aiA), policyFor(options.b, options.aiB)] as const;
  const shard = options.shard ?? { index: 0, count: 1 };
  const report: LadderReport = { games: 0, winsA: 0, winsB: 0, draws: 0, totalTurns: 0 };

  for (let i = 0; i < options.pairs; i++) {
    if (i % shard.count !== shard.index) continue;
    const pair: [HeroId, HeroId] = [heroes[i % heroes.length]!, heroes[Math.floor(i / heroes.length) % heroes.length]!];
    for (const seatOfA of [0, 1] as const) {
      const result = playGame({
        seed: `${options.seed ?? 0}:ladder:${i}`,
        heroes: pair,
        policy: seatOfA === 0 ? [policies[0], policies[1]] : [policies[1], policies[0]],
        ...(options.rules ? { rules: options.rules } : {}),
      });
      report.games += 1;
      report.totalTurns += result.turns;
      if (result.winner === null) report.draws += 1;
      else if (result.winner === seatOfA) report.winsA += 1;
      else report.winsB += 1;
    }
  }
  return report;
}
