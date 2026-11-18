/**
 * Balance report: the AI plays every hero against every hero.
 *
 *   pnpm balance                               normal level, 60 games per pairing
 *   pnpm balance --level hard --games 100 --seed 7
 *   pnpm balance --json report.json            also save the raw counts
 *   pnpm balance --patch try.json              try new numbers first (see scripts/patch.ts)
 *   pnpm balance --all                         list every card instead of the outliers
 *
 * A pairing is one ordered pair of heroes (36 with six heroes); who moves
 * first is decided by the seed.
 */
import { writeFileSync } from 'node:fs';
import { CARDS, HEROES, getCard, type Rules } from '@cardcraft-castles/engine';
import { mergeBalance, runBalance, type BalanceReport, type Difficulty } from '../src/index';
import { arg, inParallel } from './parallel';
import { applyPatchFromArgs } from './patch';

const games = Number(arg('games', '60'));
const seed = arg('seed', '1');
const level = arg('level', 'normal') as Difficulty;
const json = arg('json', '');
/** Rule overrides to try a change without editing the data, e.g. --rules '{"workerStart":3}'. */
const rules = JSON.parse(arg('rules', '{}')) as Partial<Rules>;

const patch = applyPatchFromArgs();

const started = Date.now();
const report: BalanceReport = mergeBalance(
  await inParallel<BalanceReport>(import.meta.filename, (shard) =>
    runBalance({ gamesPerPairing: games, seed, level, shard, rules }),
  ),
);
const seconds = (Date.now() - started) / 1000;
if (json) writeFileSync(json, JSON.stringify(report));

const pct = (n: number, digits = 1): string => `${(n * 100).toFixed(digits)}%`;
const percentile = (q: number): number => {
  let seen = 0;
  for (let t = 0; t < report.turns.length; t++) {
    seen += report.turns[t] ?? 0;
    if (seen >= q * report.games) return t;
  }
  return report.turns.length - 1;
};
const totalTurns = report.turns.reduce((sum, n, t) => sum + (n ?? 0) * t, 0);

console.log(`\nCardcraft: Castles — balance, level "${level}", ${report.games} games, seed "${seed}" (${seconds.toFixed(0)} s)`);
if (Object.keys(rules).length > 0) console.log(`Rule overrides: ${JSON.stringify(rules)}`);
if (patch) console.log(`Patch: ${JSON.stringify(patch)}`);
console.log('');
console.log(
  `Turns per game: average ${(totalTurns / report.games).toFixed(1)}, ` +
    `10% under ${percentile(0.1)}, median ${percentile(0.5)}, 10% over ${percentile(0.9)}`,
);
console.log(`First player wins ${pct(report.firstPlayerWins / Math.max(1, report.decided))}   Draws: ${report.draws}`);
console.log(
  `How games end: ${Object.entries(report.reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v / report.games, 0)}`)
    .join(', ')}`,
);

const ids = HEROES.map((h) => h.id);
const short = (id: string): string => id.slice(0, 6).padStart(7);
console.log(`\nHeroes (win rate against the other five; the row hero's win rate in each matchup)\n`);
console.log(`${''.padEnd(13)}${'total'.padStart(7)}  ${ids.map(short).join('')}`);
for (const a of ids) {
  let wins = 0;
  let total = 0;
  const cells = ids.map((b) => {
    const cell = report.matchups[a]?.[b];
    if (!cell) return '      -';
    if (a !== b) {
      wins += cell.wins;
      total += cell.games;
    }
    return a === b ? '      ·' : pct(cell.wins / cell.games, 0).padStart(7);
  });
  console.log(`${a.padEnd(13)}${pct(wins / Math.max(1, total)).padStart(7)}  ${cells.join('')}`);
}

interface Row {
  id: string;
  perGame: number;
  playShare: number;
  winRate: number;
}
const rows: Row[] = CARDS.map((card) => {
  const s = report.cards[card.id] ?? { played: 0, discarded: 0, players: 0, winners: 0 };
  return {
    id: card.id,
    perGame: s.played / report.games,
    playShare: s.played / Math.max(1, s.played + s.discarded),
    winRate: s.winners / Math.max(1, s.players),
  };
});
const line = (r: Row): string => {
  const card = getCard(r.id);
  return (
    `  ${card.name.en.padEnd(22)} ${card.school.slice(0, 5).padEnd(6)} ${card.rarity.slice(0, 4).padEnd(5)}` +
    `${String(card.cost).padStart(3)}  ${pct(r.playShare, 0).padStart(5)}  ${r.perGame.toFixed(2).padStart(5)}  ${pct(r.winRate).padStart(6)}`
  );
};
const header = `  ${'card'.padEnd(22)} ${'school'.padEnd(6)} ${'rar.'.padEnd(5)}${'cost'.padStart(3)} ${'kept'.padStart(5)} ${'/game'.padStart(6)} ${'wins'.padStart(7)}`;
console.log(`\nCards. "kept": played rather than discarded. "/game": plays per game. "wins": win rate of the players who played it.`);
if (process.argv.includes('--all')) {
  console.log(`\n${header}`);
  for (const r of rows) console.log(line(r));
} else {
  const byWin = [...rows].sort((a, b) => b.winRate - a.winRate);
  const byShare = [...rows].sort((a, b) => a.playShare - b.playShare);
  console.log(`\nMost often on the winning side\n${header}`);
  for (const r of byWin.slice(0, 8)) console.log(line(r));
  console.log(`\nLeast often on the winning side\n${header}`);
  for (const r of byWin.slice(-8)) console.log(line(r));
  console.log(`\nMost often discarded instead of played\n${header}`);
  for (const r of byShare.slice(0, 10)) console.log(line(r));
}
console.log('');
process.exit(0);
