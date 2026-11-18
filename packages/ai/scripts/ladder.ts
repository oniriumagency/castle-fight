/**
 * How strong is each level? Plays one contender against another with random
 * heroes, every deal twice with the seats swapped.
 *
 *   pnpm --filter @cardcraft-castles/ai ladder                      the standard ladder
 *   pnpm --filter @cardcraft-castles/ai ladder --a hard --b normal --pairs 500
 *
 * Contenders: easy, normal, hard, and the engine's "eager" and "random" policies.
 */
import { runLadder, type Contender, type LadderReport } from '../src/index';
import { arg, inParallel } from './parallel';

const pairs = Number(arg('pairs', '300'));
const seed = arg('seed', '1');
const single = process.argv.includes('--a') || process.argv.includes('--b');
const rungs: [Contender, Contender][] = single
  ? [[arg('a', 'hard') as Contender, arg('b', 'normal') as Contender]]
  : [
      ['easy', 'random'],
      ['easy', 'eager'],
      ['normal', 'easy'],
      ['hard', 'normal'],
      ['hard', 'easy'],
    ];

const started = Date.now();
const results = await inParallel<LadderReport[]>(import.meta.filename, (shard) =>
  rungs.map(([a, b]) => runLadder({ pairs, a, b, seed, shard })),
);

console.log(`\nCardcraft: Castles — AI ladder, ${pairs * 2} games per rung, seed "${seed}"\n`);
rungs.forEach(([a, b], i) => {
  const total = { games: 0, winsA: 0, winsB: 0, draws: 0, totalTurns: 0 };
  for (const shard of results) {
    const r = shard[i]!;
    for (const key of Object.keys(total) as (keyof LadderReport)[]) total[key] += r[key];
  }
  const rate = total.winsA / Math.max(1, total.winsA + total.winsB);
  // 95% interval of a proportion.
  const margin = 1.96 * Math.sqrt((rate * (1 - rate)) / Math.max(1, total.winsA + total.winsB));
  console.log(
    `  ${a.padEnd(7)} beats ${b.padEnd(7)} ${(rate * 100).toFixed(1).padStart(5)}% ±${(margin * 100).toFixed(1)}` +
      `   (${total.winsA}-${total.winsB}, ${total.draws} draws, ${(total.totalTurns / total.games).toFixed(0)} turns on average)`,
  );
});
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)} s\n`);
process.exit(0);
