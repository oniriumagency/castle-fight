/**
 * Turn-order compensation study: win rate by seat (1st, 2nd, 3rd to move) with
 * different starting Wall bonuses for the later seats. Same deals for every variant.
 *
 *   pnpm seats --games 600 --players 3 --level hard --variants "0,5,10;0,4,8;0,3,6"
 */
import { HEROES, applyAction, createGame, hashSeed, randomPick } from '@cardcraft-castles/engine';
import { chooseAction, type Difficulty } from '../src/index';
import { arg, inParallel } from './parallel';

const games = Number(arg('games', '400'));
const players = Number(arg('players', '3'));
const level = arg('level', 'hard') as Difficulty;
const seed = arg('seed', 'seats');
const variants = arg('variants', players === 2 ? '0,0;0,5' : '0,0,0;0,5,10').split(';').map((v) => v.split(',').map(Number));

interface Tally { games: number; decided: number; draws: number; rounds: number; seatWins: number[]; reasons: Record<string, number> }
const empty = (): Tally => ({ games: 0, decided: 0, draws: 0, rounds: 0, seatWins: Array(players).fill(0), reasons: {} });

function run(bonus: number[], shard: { index: number; count: number }): Tally {
  const t = empty();
  const pool = HEROES.map((h) => h.id);
  for (let g = shard.index; g < games; g += shard.count) {
    const rng = { rng: hashSeed(`${seed}:heroes:${players}:${g}`) };
    const heroes = Array.from({ length: players }, () => randomPick(rng, pool));
    let { state } = createGame({ seed: `${seed}:${players}:${g}`, heroes, rules: { secondPlayerWall: 0, multiSeatWall: 0 } });
    const first = state.active;
    for (let s = 1; s < players; s++) state.players[(first + s) % players]!.wall += bonus[s] ?? 0;
    for (let guard = 0; state.phase !== 'finished' && guard < 6000; guard++) {
      const action = chooseAction(state, level, { seed: `${g}:${guard}` });
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    t.games += 1;
    t.rounds += state.turn / players;
    const reason = state.result?.reason ?? 'maxActions';
    t.reasons[reason] = (t.reasons[reason] ?? 0) + 1;
    const winner = state.result?.winner ?? null;
    if (winner === null) t.draws += 1;
    else { t.decided += 1; t.seatWins[(winner - first + players) % players]! += 1; }
  }
  return t;
}

const results = await inParallel(import.meta.filename, (shard) => variants.map((v) => run(v, shard)));
const out = variants.map((v, i) => {
  const o = empty();
  for (const r of results) {
    const p = r[i]!;
    o.games += p.games; o.decided += p.decided; o.draws += p.draws; o.rounds += p.rounds;
    p.seatWins.forEach((w, s) => (o.seatWins[s]! += w));
    for (const [k, n] of Object.entries(p.reasons)) o.reasons[k] = (o.reasons[k] ?? 0) + n;
  }
  return { bonus: v, ...o };
});
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
console.log(`\nAsientos — ${players} jugadores, IA ${level}, ${games} partidas por variante (mismos repartos)`);
for (const t of out) {
  console.log(`Muralla +[${t.bonus.join(', ')}]: ${t.seatWins.map((w, s) => `${s + 1}º ${pct(w, t.decided)}`).join('  ')}   empates ${t.draws}   rondas ${(t.rounds / t.games).toFixed(1)}   ${Object.entries(t.reasons).map(([k, v]) => `${k} ${pct(v, t.games)}`).join(', ')}`);
}
const json = arg('json', '');
if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(out, null, 2));
process.exit(0);
