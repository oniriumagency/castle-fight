/**
 * Eclipse duration study: the same deals played with Eclipse lasting 1, 2 or 3 rounds.
 *
 *   pnpm tsx scripts/eclipse.ts --games 300 --players 2 --level hard --rounds 1,2,3
 */
import {
  HEROES, applyAction, createGame, effectiveCost, getBattleEvent, getCard, hashSeed, randomPick,
} from '@cardcraft-castles/engine';
import { chooseAction, type Difficulty } from '../src/index';
import { arg, inParallel } from './parallel';

const games = Number(arg('games', '200'));
const players = Number(arg('players', '2'));
const level = arg('level', 'hard') as Difficulty;
const seed = arg('seed', 'ecl');
const roundsList = arg('rounds', '1,2,3').split(',').map(Number);

interface Tally {
  games: number; turns: number; decided: number; firstWins: number; draws: number;
  reasons: Record<string, number>;
  heroGames: Record<string, number>; heroWins: Record<string, number>;
  eclipseGames: number; eclipseTurns: number;
  arcanePlaysInEclipse: number; manaSaved: number; arcanePlaysTotal: number; plays: number;
  // Games with an Eclipse where one player got clearly more out of it (mana saved), and how often that player won.
  swingKnown: number; swingWon: number; maxSaved: number;
  overlap: number;
}
const empty = (): Tally => ({
  games: 0, turns: 0, decided: 0, firstWins: 0, draws: 0, reasons: {}, heroGames: {}, heroWins: {},
  eclipseGames: 0, eclipseTurns: 0, arcanePlaysInEclipse: 0, manaSaved: 0, arcanePlaysTotal: 0, plays: 0,
  swingKnown: 0, swingWon: 0, maxSaved: 0, overlap: 0,
});

function run(rounds: number, shard: { index: number; count: number }): Tally {
  const effect = getBattleEvent('eclipse').effect as { rounds: number };
  effect.rounds = rounds;
  const t = empty();
  const pool = HEROES.map((h) => h.id);
  for (let g = shard.index; g < games; g += shard.count) {
    const rng = { rng: hashSeed(`${seed}:heroes:${players}:${g}`) };
    const heroes = Array.from({ length: players }, () => randomPick(rng, pool));
    let { state } = createGame({ seed: `${seed}:${players}:${g}`, heroes });
    const first = state.active;
    const saved = Array.from({ length: players }, () => 0);
    let sawEclipse = false;
    for (let guard = 0; state.phase !== 'finished' && guard < 6000; guard++) {
      const action = chooseAction(state, level, { seed: `${g}:${guard}` });
      const eclipse = state.activeEvent?.id === 'eclipse';
      if (eclipse) sawEclipse = true;
      if (action.type === 'play') {
        const p = state.players[state.active]!;
        const card = p.hand.find((c) => c.uid === action.uid)!;
        const def = getCard(card.cardId);
        t.plays += 1;
        if (def.school === 'arcano') {
          t.arcanePlaysTotal += 1;
          if (eclipse) {
            t.arcanePlaysInEclipse += 1;
            // What the half price saved, compared with the same cost without the event.
            const now = effectiveCost(state, state.active, card.cardId);
            const ev = state.activeEvent; state.activeEvent = null;
            const without = effectiveCost(state, state.active, card.cardId);
            state.activeEvent = ev;
            saved[state.active]! += without - now;
            t.manaSaved += without - now;
          }
        }
      }
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error.message);
      for (const e of result.events) {
        if (e.type === 'battleEventStarted' && state.activeEvent && state.activeEvent.id !== e.eventId) t.overlap += 1;
        if (e.type === 'turnEnded' && result.state.activeEvent?.id === 'eclipse') t.eclipseTurns += 1;
      }
      state = result.state;
    }
    t.games += 1;
    t.turns += state.turn;
    const reason = state.result?.reason ?? 'maxActions';
    t.reasons[reason] = (t.reasons[reason] ?? 0) + 1;
    const winner = state.result?.winner ?? null;
    heroes.forEach((h, seat) => {
      t.heroGames[h] = (t.heroGames[h] ?? 0) + 1;
      if (winner === seat) t.heroWins[h] = (t.heroWins[h] ?? 0) + 1;
    });
    if (winner === null) t.draws += 1;
    else {
      t.decided += 1;
      if (winner === first) t.firstWins += 1;
    }
    if (sawEclipse) {
      t.eclipseGames += 1;
      const best = Math.max(...saved);
      const top = saved.filter((s) => s === best).length;
      t.maxSaved += best;
      if (best > 0 && top === 1 && winner !== null) {
        t.swingKnown += 1;
        if (saved[winner] === best) t.swingWon += 1;
      }
    }
  }
  return t;
}

function merge(parts: Tally[]): Tally {
  const o = empty();
  for (const p of parts) {
    for (const k of Object.keys(o) as (keyof Tally)[]) {
      if (typeof o[k] === 'number') (o as any)[k] += p[k] as number;
    }
    for (const key of ['reasons', 'heroGames', 'heroWins'] as const) {
      for (const [k, v] of Object.entries(p[key])) o[key][k] = (o[key][k] ?? 0) + v;
    }
  }
  return o;
}

const results = await inParallel(import.meta.filename, (shard) => roundsList.map((r) => run(r, shard)));
const out = roundsList.map((r, i) => ({ rounds: r, ...merge(results.map((x) => x[i]!)) }));
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
console.log(`\nEclipse — ${players} jugadores, IA ${level}, ${games} partidas por duración (mismos repartos)`);
for (const t of out) {
  console.log(`\n## Eclipse ${t.rounds} ronda(s)`);
  console.log(`  Rondas por partida: ${(t.turns / t.games / players).toFixed(1)}   1º en mover gana: ${pct(t.firstWins, t.decided)}   empates ${t.draws}`);
  console.log(`  Final: ${Object.entries(t.reasons).map(([k, v]) => `${k} ${pct(v, t.games)}`).join(', ')}`);
  console.log(`  Partidas con Eclipse: ${pct(t.eclipseGames, t.games)}; turnos bajo Eclipse por partida con Eclipse: ${(t.eclipseTurns / Math.max(1, t.eclipseGames)).toFixed(1)}`);
  console.log(`  Cartas Arcanas: ${pct(t.arcanePlaysTotal, t.plays)} de las jugadas; ${(t.arcanePlaysInEclipse / Math.max(1, t.eclipseGames)).toFixed(2)} durante el Eclipse por partida con Eclipse; maná ahorrado ${(t.manaSaved / Math.max(1, t.eclipseGames)).toFixed(1)} (el que más: ${(t.maxSaved / Math.max(1, t.eclipseGames)).toFixed(1)})`);
  console.log(`  Quien más aprovecha el Eclipse gana: ${pct(t.swingWon, t.swingKnown)} (${t.swingKnown} partidas; neutro ${pct(1, players)})`);
  console.log(`  Solapes con otro evento: ${t.overlap}`);
  console.log(`  Héroes: ${HEROES.map((h) => `${h.id} ${pct(t.heroWins[h.id] ?? 0, t.heroGames[h.id] ?? 0)}`).join(', ')}`);
}
const json = arg('json', '');
if (json) (await import('node:fs')).writeFileSync(json, JSON.stringify(out, null, 2));
process.exit(0);
