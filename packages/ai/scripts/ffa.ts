/**
 * Free-for-all prototype: compare rule variants for 3-player games, AI against AI.
 *
 *   pnpm ffa                         every variant, 400 games each, level normal
 *   pnpm ffa --games 1000 --level easy --only all60,chooseLeader
 *
 * For each variant it reports how long games last, how they end, who wins by
 * seat, and how much the players pile on one rival ("double-teaming").
 */
import { HEROES, applyAction, createGame, hashSeed, randomPick, type GameState, type Rules } from '@cardcraft-castles/engine';
import { chooseAction, type Difficulty } from '../src/index';
import { arg, inParallel } from './parallel';

interface Variant {
  id: string;
  label: string;
  players: number;
  rules: Partial<Rules>;
}

export const VARIANTS: Variant[] = [
  { id: 'duel', label: '1 contra 1 (referencia)', players: 2, rules: {} },
  { id: 'all100', label: 'Golpea a todos, daño completo', players: 3, rules: { multiTargeting: 'all', multiAllScale: 1 } },
  { id: 'all60', label: 'Golpea a todos, daño ×0,6', players: 3, rules: { multiTargeting: 'all', multiAllScale: 0.6 } },
  { id: 'all50', label: 'Golpea a todos, daño ×0,5', players: 3, rules: { multiTargeting: 'all', multiAllScale: 0.5 } },
  { id: 'choose', label: 'Eliges rival, sin ajustes', players: 3, rules: { multiTargeting: 'choose' } },
  {
    id: 'all60Leader',
    label: 'Golpea a todos ×0,6 + líder recibe +2',
    players: 3,
    rules: { multiTargeting: 'all', multiAllScale: 0.6, leaderExtraDamage: 2 },
  },
  {
    id: 'chooseLeader',
    label: 'Eliges rival + líder recibe +2 + botín 5',
    players: 3,
    rules: { multiTargeting: 'choose', leaderExtraDamage: 2, eliminationBounty: 5 },
  },
];

interface Tally {
  games: number;
  turns: number[];
  reasons: Record<string, number>;
  draws: number;
  seatWins: number[];
  decided: number;
  /** Attack damage that landed on the strict Keep leader, and all attack damage (3p only). */
  leaderDamage: number;
  attackDamage: number;
  /** Rounds where 2+ different attackers chose targets, and those where they all picked the same one. */
  rounds: number;
  doubleTeams: number;
  /** Games with someone eliminated before the end, and how often the midgame leader won. */
  eliminations: number;
  midLeaderKnown: number;
  midLeaderWon: number;
  midLastWon: number;
}

function emptyTally(players: number): Tally {
  return {
    games: 0,
    turns: [],
    reasons: {},
    draws: 0,
    seatWins: Array.from({ length: players }, () => 0),
    decided: 0,
    leaderDamage: 0,
    attackDamage: 0,
    rounds: 0,
    doubleTeams: 0,
    eliminations: 0,
    midLeaderKnown: 0,
    midLeaderWon: 0,
    midLastWon: 0,
  };
}

function strictLeader(state: GameState): number | null {
  const alive = state.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.eliminated);
  alive.sort((a, b) => b.p.keep - a.p.keep);
  if (alive.length < 2 || alive[0]!.p.keep === alive[1]!.p.keep) return null;
  return alive[0]!.i;
}

function strictLast(state: GameState): number | null {
  const alive = state.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.eliminated);
  alive.sort((a, b) => a.p.keep - b.p.keep);
  if (alive.length < 2 || alive[0]!.p.keep === alive[1]!.p.keep) return null;
  return alive[0]!.i;
}

function playVariant(variant: Variant, games: number, seed: string, level: Difficulty, shard: { index: number; count: number }): Tally {
  const tally = emptyTally(variant.players);
  const heroPool = HEROES.map((h) => h.id);
  for (let g = shard.index; g < games; g += shard.count) {
    const rng = { rng: hashSeed(`ffa:${seed}:${variant.id}:${g}`) };
    const heroes = Array.from({ length: variant.players }, () => randomPick(rng, heroPool));
    let { state } = createGame({ seed: `${seed}:${g}`, heroes, rules: variant.rules });
    const first = state.active;
    let midLeader: number | null = null;
    let midLast: number | null = null;
    let midTaken = false;
    let eliminated = false;
    // Targets each attacker picked during the current round (one entry per attacker turn).
    let roundTargets = new Map<number, Set<number>>();
    let roundStart = state.turn;

    for (let guard = 0; state.phase !== 'finished' && guard < 5000; guard++) {
      if (!midTaken && state.turn >= 30 * variant.players / 2) {
        midTaken = true;
        midLeader = strictLeader(state);
        midLast = strictLast(state);
      }
      const leader = strictLeader(state);
      const result = applyAction(state, chooseAction(state, level, { seed: `${g}:${guard}` }));
      if (!result.ok) throw new Error(result.error.message);
      for (const e of result.events) {
        if (e.type === 'damage' && e.cause !== 'burn' && e.source !== e.target) {
          const amount = e.wallLoss + e.keepLoss;
          tally.attackDamage += amount;
          if (leader === e.target) tally.leaderDamage += amount;
          if (variant.players > 2) {
            const set = roundTargets.get(e.source) ?? new Set<number>();
            set.add(e.target);
            roundTargets.set(e.source, set);
          }
        }
        if (e.type === 'playerEliminated') eliminated = true;
      }
      state = result.state;
      if (state.turn - roundStart >= variant.players) {
        if (roundTargets.size >= 2) {
          tally.rounds += 1;
          // Some player was attacked by both rivals, and they attacked nobody else.
          const ganged = state.players.some((_, victim) => {
            const others = [...roundTargets.entries()].filter(([attacker]) => attacker !== victim);
            return others.length >= 2 && others.every(([, targets]) => targets.size === 1 && targets.has(victim));
          });
          if (ganged) tally.doubleTeams += 1;
        }
        roundTargets = new Map();
        roundStart = state.turn;
      }
    }

    tally.games += 1;
    tally.turns.push(state.turn);
    const reason = state.result?.reason ?? 'maxActions';
    tally.reasons[reason] = (tally.reasons[reason] ?? 0) + 1;
    if (eliminated) tally.eliminations += 1;
    const winner = state.result?.winner ?? null;
    if (winner === null) tally.draws += 1;
    else {
      tally.decided += 1;
      tally.seatWins[(winner - first + variant.players) % variant.players]! += 1;
      if (midLeader !== null) {
        tally.midLeaderKnown += 1;
        if (winner === midLeader) tally.midLeaderWon += 1;
        if (winner === midLast) tally.midLastWon += 1;
      }
    }
  }
  return tally;
}

function merge(parts: Tally[]): Tally {
  const out = emptyTally(parts[0]!.seatWins.length);
  for (const t of parts) {
    out.games += t.games;
    out.turns.push(...t.turns);
    for (const [k, v] of Object.entries(t.reasons)) out.reasons[k] = (out.reasons[k] ?? 0) + v;
    out.draws += t.draws;
    t.seatWins.forEach((w, i) => (out.seatWins[i]! += w));
    out.decided += t.decided;
    out.leaderDamage += t.leaderDamage;
    out.attackDamage += t.attackDamage;
    out.rounds += t.rounds;
    out.doubleTeams += t.doubleTeams;
    out.eliminations += t.eliminations;
    out.midLeaderKnown += t.midLeaderKnown;
    out.midLeaderWon += t.midLeaderWon;
    out.midLastWon += t.midLastWon;
  }
  return out;
}

const games = Number(arg('games', '400'));
const seed = arg('seed', '1');
const level = arg('level', 'normal') as Difficulty;
const only = arg('only', '');
const extra = JSON.parse(arg('rules', '{}')) as Partial<Rules>;
const variants = VARIANTS.filter((v) => !only || only.split(',').includes(v.id)).map((v) => ({
  ...v,
  rules: { ...v.rules, ...(v.players > 2 ? extra : {}) },
}));

const results = await inParallel(import.meta.filename, (shard) =>
  variants.map((v) => playVariant(v, games, seed, level, shard)),
);
const pct = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');

console.log(`\nTodos contra todos — ${games} partidas por variante, IA "${level}", semilla "${seed}"`);
if (Object.keys(extra).length) console.log(`Reglas extra (3 jugadores): ${JSON.stringify(extra)}`);
const json: unknown[] = [];
variants.forEach((v, i) => {
  const t = merge(results.map((r) => r[i]!));
  const turns = t.turns.slice().sort((a, b) => a - b);
  const avg = turns.reduce((a, b) => a + b, 0) / turns.length;
  const rounds = avg / v.players;
  const p10 = turns[Math.floor(turns.length * 0.1)]! / v.players;
  const p90 = turns[Math.floor(turns.length * 0.9)]! / v.players;
  console.log(`\n## ${v.label}  [${v.id}]`);
  console.log(`  Rondas por partida: media ${rounds.toFixed(1)} (10% < ${p10.toFixed(0)}, 10% > ${p90.toFixed(0)})`);
  console.log(
    `  Final: ${Object.entries(t.reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${pct(n, t.games)}`)
      .join(', ')}; empates ${t.draws}`,
  );
  console.log(`  Victorias por asiento (1º, 2º, 3º en mover): ${t.seatWins.map((w) => pct(w, t.decided)).join(' / ')}`);
  if (v.players > 2) {
    console.log(`  Daño de ataque que recibe el líder: ${pct(t.leaderDamage, t.attackDamage)} (33% sería neutro)`);
    console.log(`  Rondas en que los dos atacantes van a por el mismo: ${pct(t.doubleTeams, t.rounds)}`);
    console.log(`  Partidas con un eliminado antes del final: ${pct(t.eliminations, t.games)}`);
    console.log(
      `  Gana el líder a mitad de partida: ${pct(t.midLeaderWon, t.midLeaderKnown)}; gana el último: ${pct(t.midLastWon, t.midLeaderKnown)}`,
    );
  }
  json.push({ id: v.id, label: v.label, rounds, p10, p90, ...t, turns: undefined });
});
const out = arg('json', '');
if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(json, null, 2));
