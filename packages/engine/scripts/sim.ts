/**
 * Random-playout report.
 *
 *   pnpm sim                      1000 games with the eager policy
 *   pnpm sim --games 5000 --seed 7 --policy random
 */
import { HEROES, getCard, getHero, randomPolicy, simulate } from '../src/index';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const games = Number(arg('games', '1000'));
const seed = arg('seed', '1');
const policyName = arg('policy', 'eager');
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

const started = Date.now();
const report = simulate({ games, seed, ...(policyName === 'random' ? { policy: randomPolicy } : {}) });
const seconds = (Date.now() - started) / 1000;

console.log(`\nCardcraft: Castles — ${games} games, policy "${policyName}", seed "${seed}" (${seconds.toFixed(1)} s)\n`);
console.log(`Turns per game: avg ${report.averageTurns.toFixed(1)}, min ${report.minTurns}, max ${report.maxTurns}`);
console.log(`First player win rate: ${pct(report.firstPlayerWinRate)}   Draws: ${report.draws}`);
console.log(`How games end: ${Object.entries(report.reasons).map(([k, v]) => `${k} ${v}`).join(', ')}`);

console.log('\nHeroes');
for (const hero of HEROES) {
  const stats = report.heroes[hero.id];
  if (stats) console.log(`  ${getHero(hero.id).name.en.padEnd(16)} ${pct(stats.winRate).padStart(6)}  (${stats.games} games)`);
}

const cards = Object.entries(report.cards).sort((a, b) => b[1].winRate - a[1].winRate);
const line = ([id, s]: [string, { played: number; winRate: number }]): string =>
  `  ${getCard(id).name.en.padEnd(22)} ${pct(s.winRate).padStart(6)}  (${s.played} plays)`;
console.log('\nCards most often played by the winner');
for (const entry of cards.slice(0, 8)) console.log(line(entry));
console.log('\nCards least often played by the winner');
for (const entry of cards.slice(-8)) console.log(line(entry));
console.log('');
