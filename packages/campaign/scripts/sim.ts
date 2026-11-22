/**
 * How winnable each campaign battle is: a typical path through the map, each
 * battle played many times by an AI standing in for the player (with the deck
 * they would have at that point) against the defender the campaign sets up.
 *
 *   pnpm --filter @cardcraft-castles/campaign sim [--games 40] [--player 1] [--difficulty normal]
 */
import { applyAction, createGame } from '@cardcraft-castles/engine';
import { chooseAction, profileForTier } from '@cardcraft-castles/ai';
import { battleSetup, newCampaign, settleBattle, startBattle, type CampaignDifficulty, type CampaignSave } from '../src/index';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const games = Number(arg('games', '40'));
const playerTier = Number(arg('player', '1'));
const difficulty = arg('difficulty', 'normal') as CampaignDifficulty;

// Each kingdom in order, its hero last: a, c, b, d and then the castle.
const PATH = [
  ...['bastion', 'alambiques', 'ceniza', 'escarcha', 'carmesi'].flatMap((k) => ['a', 'c', 'b', 'd', 'castillo'].map((x) => `${k}-${x}`)),
  'corona',
];

function play(save: CampaignSave, territory: string, seed: string): boolean {
  const setup = battleSetup(save, territory, save.hero);
  let { state } = createGame({ seed, heroes: setup.heroes, seats: setup.seats, rules: setup.rules, ...(setup.firstEvent ? { firstEvent: setup.firstEvent } : {}) });
  const player = profileForTier(playerTier);
  const rival = profileForTier(setup.tier);
  let steps = 0;
  while (state.phase !== 'finished' && steps++ < 3000) {
    const profile = state.active === 0 ? player : rival;
    const result = applyAction(state, chooseAction(state, 'normal', { profile }));
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  const winner = state.result?.winner;
  return winner === 0;
}

let save = newCampaign(difficulty);
console.log(`Jugador simulado: nivel ${playerTier} · campaña en ${difficulty} · ${games} partidas por batalla\n`);
console.log('Batalla'.padEnd(22), 'Rival', 'Mazo', 'Gana');
for (const territory of PATH) {
  let wins = 0;
  for (let g = 0; g < games; g++) if (play(save, territory, `${territory}:${g}`)) wins++;
  const setup = battleSetup(save, territory, save.hero);
  console.log(territory.padEnd(22), setup.tier.toFixed(2).padStart(5), String(setup.seats[0]!.deck!.length).padStart(4), `${Math.round((wins / games) * 100)} %`.padStart(5));
  const started = startBattle(save, territory, save.hero, territory);
  save = settleBattle(started, territory, true)!.save;
}
