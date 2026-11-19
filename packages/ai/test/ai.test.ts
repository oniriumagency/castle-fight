import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  applyAction,
  buildDeckList,
  createGame,
  getCard,
  getPlayerView,
  legalActions,
} from '@cardcraft-castles/engine';
import type { Action, GameState, PlayerId } from '@cardcraft-castles/engine';
import { playCard, scenario } from '@cardcraft-castles/engine/testing';
import {
  DIFFICULTIES,
  DIFFICULTY_DESCRIPTIONS,
  DIFFICULTY_NAMES,
  PROFILES,
  aiPolicy,
  chooseAction,
  chooseActionFromView,
  determinize,
  explainActions,
  runBalance,
  runLadder,
} from '../src/index';
import type { Difficulty } from '../src/index';

const ME = 0;
const OPP = 1;

/** The card the action plays or discards, if any. */
function cardOf(state: GameState, action: Action): string | null {
  if (action.type !== 'play' && action.type !== 'discard') return null;
  return state.players[action.player].hand.find((c) => c.uid === action.uid)!.cardId;
}

describe('chooseAction', () => {
  for (const level of DIFFICULTIES) {
    it(`${level}: only ever makes legal moves, to the end of the game`, () => {
      const games = level === 'hard' ? 2 : 4;
      for (let seed = 0; seed < games; seed++) {
        let { state } = createGame({ seed: `${level}:${seed}`, heroes: ['hechicera', 'saboteadora'] });
        for (let step = 0; state.phase !== 'finished'; step++) {
          expect(step, 'the game should end').toBeLessThan(2000);
          const action = chooseAction(state, level);
          expect(legalActions(state)).toContainEqual(action);
          const result = applyAction(state, action);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          state = result.state;
        }
        expect(state.result).not.toBeNull();
      }
    });
  }

  for (const heroes of [['hechicera', 'saboteadora'], ['arquitecta', 'mariscal', 'guardian']] as const) {
    it(`says "Ready" to end its turns (${heroes.length} players, manual end of turn)`, () => {
      let { state } = createGame({ seed: `ready:${heroes.length}`, heroes: [...heroes], rules: { manualEndTurn: true } });
      let readies = 0;
      for (let step = 0; state.phase !== 'finished'; step++) {
        expect(step, 'the game should end').toBeLessThan(3000);
        const action = chooseAction(state, 'normal');
        expect(legalActions(state)).toContainEqual(action);
        if (action.type === 'endTurn') readies += 1;
        const result = applyAction(state, action);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
      }
      expect(state.result).not.toBeNull();
      expect(readies).toBeGreaterThan(5);
    });
  }

  it('gives the same answer for the same position, and for the same seed', () => {
    const { state } = createGame({ seed: 7, heroes: ['mariscal', 'guardian'] });
    for (const level of DIFFICULTIES) {
      expect(chooseAction(state, level)).toEqual(chooseAction(state, level));
      expect(chooseAction(state, level, { seed: 'x' })).toEqual(chooseAction(state, level, { seed: 'x' }));
    }
  });

  it('does not depend on anything the player cannot see', () => {
    const a = scenario({
      seed: 3,
      hand: ['catapulta', 'parapeto', 'egida-lunar', 'cimientos'],
      opponentHand: ['trabuquete-colosal', 'aguja-celeste', 'escaramuza'],
      keepTurn: false,
    });
    // The same position, but the opponent holds other cards and both decks are in another order.
    const b = structuredClone(a);
    b.players[OPP].hand.forEach((card, i) => (card.cardId = ['hilada-de-piedra', 'drenaje', 'motin'][i]!));
    b.players[OPP].deck.reverse();
    b.players[ME].deck.reverse();
    b.rng = a.rng + 1;
    expect(getPlayerView(b, ME)).toEqual(getPlayerView(a, ME));
    for (const level of DIFFICULTIES) expect(chooseAction(b, level)).toEqual(chooseAction(a, level));
  });

  it('works from a client-side view and refuses to move out of turn', () => {
    const state = scenario({ hand: ['catapulta', 'parapeto'], keepTurn: false });
    expect(chooseActionFromView(getPlayerView(state, ME), 'normal')).toEqual(chooseAction(state, 'normal'));
    expect(() => chooseActionFromView(getPlayerView(state, OPP), 'normal')).toThrow();
    const over = applyAction(state, { type: 'concede', player: ME });
    expect(over.ok && (() => chooseAction(over.state, 'normal'))).toThrow();
  });

  it('takes a win when there is one, at every level', () => {
    for (const level of DIFFICULTIES) {
      for (let seed = 0; seed < 5; seed++) {
        const kill = scenario({
          seed,
          hand: ['parapeto', 'cimientos', 'escaramuza', 'transmutacion', 'egida-lunar'],
          opponent: { wall: 0, keep: 4 },
          keepTurn: false,
        });
        expect(cardOf(kill, chooseAction(kill, level)), `${level} kill`).toBe('escaramuza');
        expect(chooseAction(kill, level).type).toBe('play');

        const build = scenario({
          seed,
          hand: ['catapulta', 'parapeto', 'cimientos', 'transmutacion', 'egida-lunar'],
          you: { keep: DEFAULT_RULES.keepWin - 5 },
          keepTurn: false,
        });
        expect(cardOf(build, chooseAction(build, level)), `${level} build`).toBe('cimientos');
      }
    }
  });

  it('uses the ultimate to finish the game', () => {
    const state = scenario({
      heroes: ['mariscal', 'guardian'],
      hand: ['parapeto', 'cimientos'],
      you: { ultimateCharge: DEFAULT_RULES.ultimateCharge },
      opponent: { wall: 0, keep: 10 },
      keepTurn: false,
    });
    for (const level of DIFFICULTIES) expect(chooseAction(state, level)).toEqual({ type: 'ultimate', player: ME });
  });

  it('defends a Keep that is about to fall rather than racing a healthy one', () => {
    const state = scenario({
      hand: ['escaramuza', 'andamio-real', 'bastida-de-granito', 'transmutacion'],
      you: { wall: 0, keep: 6 },
      opponent: { wall: 30, keep: 60 },
      keepTurn: false,
    });
    for (const level of ['normal', 'hard'] as Difficulty[]) {
      const card = cardOf(state, chooseAction(state, level, { profile: { noise: 0 } }));
      expect(['andamio-real', 'bastida-de-granito']).toContain(card);
    }
  });

  it('does not throw away a turn: it plays a card when a useful one is affordable', () => {
    const state = scenario({ hand: ['catapulta', 'parapeto', 'andamio-real'], keepTurn: false });
    for (const level of DIFFICULTIES) expect(chooseAction(state, level).type).toBe('play');
  });

  it('answers the choices its own cards ask for', () => {
    // Spy at Court: pick one of the opponent's cards to discard.
    let state = scenario({
      hand: ['espia-en-la-corte', 'cimientos'],
      opponentHand: ['escaramuza', 'trabuquete-colosal', 'parapeto'],
      keepTurn: false,
    });
    state = playCard(state, 'espia-en-la-corte').state;
    expect(state.phase).toBe('choice');
    for (const level of DIFFICULTIES) {
      const action = chooseAction(state, level);
      expect(action.type).toBe('choose');
      expect(legalActions(state)).toContainEqual(action);
    }
    // With a clear head it removes the Trebuchet, by far the biggest threat.
    const pick = chooseAction(state, 'hard');
    const trebuchet = state.players[OPP].hand.find((c) => c.cardId === 'trabuquete-colosal')!.uid;
    expect(pick).toEqual({ type: 'choose', player: ME, option: String(trebuchet) });

    // Frost Breath: pick a resource.
    let frost = scenario({ hand: ['aliento-de-escarcha', 'cimientos'], keepTurn: false });
    frost = playCard(frost, 'aliento-de-escarcha').state;
    expect(legalActions(frost)).toContainEqual(chooseAction(frost, 'normal'));
  });
});

describe('explainActions', () => {
  it('lists every different option once, best first', () => {
    const state = scenario({ hand: ['catapulta', 'catapulta', 'parapeto'], keepTurn: false });
    const ranked = explainActions(getPlayerView(state, ME), 'normal');
    // Two cards to play or discard; the second Catapult is the same option as the first.
    expect(ranked.map((r) => `${r.action.type}:${cardOf(state, r.action)}`).sort()).toEqual([
      'discard:catapulta',
      'discard:parapeto',
      'play:catapulta',
      'play:parapeto',
    ]);
    const values = ranked.map((r) => r.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(ranked[0]!.action).toEqual(chooseAction(state, 'normal', { profile: { noise: 0 } }));
  });
});

describe('determinize', () => {
  it('builds a full state that looks exactly like the view it came from', () => {
    let { state } = createGame({ seed: 11, heroes: ['alquimista', 'arquitecta'] });
    const policy = aiPolicy('easy');
    for (let step = 0; step < 30 && state.phase !== 'finished'; step++) {
      const viewer = state.active;
      const view = getPlayerView(state, viewer);
      const world = determinize(view, { rng: 1234 + step })!;
      expect(world).not.toBeNull();
      expect(getPlayerView(world, viewer)).toEqual(view);
      for (const p of [0, 1] as PlayerId[]) {
        // Every card of the deck list is somewhere: hand, deck or discard pile.
        const cards = [...world.players[p].hand.map((c) => c.cardId), ...world.players[p].deck, ...world.players[p].discard];
        expect(cards.sort()).toEqual(buildDeckList(view.rules).sort());
        expect(world.players[p].deck).toHaveLength(view.players[p].deckCount);
      }
      // The guess never copies the real hidden hand on purpose: the viewer's own cards are the only ones kept.
      expect(world.players[viewer].hand).toEqual(state.players[viewer].hand);
      const result = applyAction(state, policy(state, legalActions(state), { rng: step }));
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
  });

  it('rebuilds a pending choice so that the look-ahead can resolve it', () => {
    let state = scenario({
      hand: ['sabotaje', 'cimientos'],
      opponent: {
        enchantments: [
          { cardId: 'contrafuertes', turnsLeft: 2, fresh: false },
          { cardId: 'fortaleza-viva', turnsLeft: 4, fresh: false },
        ],
      },
      keepTurn: false,
    });
    state = playCard(state, 'sabotaje').state;
    const world = determinize(getPlayerView(state, ME), { rng: 5 })!;
    const result = applyAction(world, { type: 'choose', player: ME, option: 'fortaleza-viva' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The rest of the card still happens: 8 damage, less 3 for the Buttresses that are left.
    expect(result.state.players[OPP].enchantments.map((e) => e.cardId)).toEqual(['contrafuertes']);
    expect(result.state.players[OPP].wall).toBe(state.players[OPP].wall - 5);
    expect(getCard('sabotaje').effects.at(-1)).toMatchObject({ op: 'damage', amount: 8 });
  });

  it('rebuilds a discard from its own hand halfway through', () => {
    let state = scenario({ hand: ['tierra-quemada', 'escaramuza', 'parapeto', 'catapulta'], keepTurn: false });
    state = playCard(state, 'tierra-quemada').state;
    const first = state.players[ME].hand.find((c) => c.cardId === 'escaramuza')!.uid;
    const step = applyAction(state, { type: 'choose', player: ME, option: String(first) });
    if (!step.ok) throw new Error(step.error.message);
    state = step.state;
    // One card gone, up to two more: the rebuilt world must remember both.
    const world = determinize(getPlayerView(state, ME), { rng: 3 })!;
    expect(world.pending!.progress).toEqual({ done: 1, left: 2 });
    const result = applyAction(world, { type: 'choose', player: ME, option: 'done' });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.players[OPP].wall).toBe(state.players[OPP].wall - 4);
    for (const level of DIFFICULTIES) expect(legalActions(state)).toContainEqual(chooseAction(state, level));
  });
});

describe('difficulty levels', () => {
  it('have a name and a description in both languages', () => {
    for (const level of DIFFICULTIES) {
      for (const text of [DIFFICULTY_NAMES[level], DIFFICULTY_DESCRIPTIONS[level]]) {
        expect(text.es.length).toBeGreaterThan(0);
        expect(text.en.length).toBeGreaterThan(0);
      }
      expect(PROFILES[level].worlds).toBeGreaterThan(0);
    }
  });

  it('each level is clearly stronger than the one before', () => {
    const rate = (a: Difficulty | 'random', b: Difficulty | 'random', pairs: number): number => {
      const r = runLadder({ pairs, a, b, seed: 'test' });
      expect(r.games).toBe(pairs * 2);
      return r.winsA / r.games;
    };
    // Measured over thousands of games: about 98%, 72%, 69% and 87%. The bounds leave room for luck.
    expect(rate('easy', 'random', 20)).toBeGreaterThan(0.85);
    expect(rate('normal', 'easy', 60)).toBeGreaterThan(0.58);
    expect(rate('hard', 'normal', 60)).toBeGreaterThan(0.55);
    expect(rate('hard', 'easy', 30)).toBeGreaterThan(0.7);
  }, 120_000);
});

describe('runBalance', () => {
  it('plays every hero pairing and its counts add up', () => {
    const heroes = ['arquitecta', 'mariscal', 'hechicera'];
    const report = runBalance({ gamesPerPairing: 2, level: 'easy', heroes, seed: 1 });
    expect(report.games).toBe(heroes.length * heroes.length * 2);
    expect(report.decided + report.draws).toBe(report.games);
    expect(report.turns.reduce((a, b) => a + (b ?? 0), 0)).toBe(report.games);
    expect(Object.values(report.reasons).reduce((a, b) => a + b, 0)).toBe(report.games);
    expect(report.matchups['arquitecta']!['mariscal']!.games).toBe(4);
    const played = Object.values(report.cards).reduce((a, c) => a + c.played, 0);
    expect(played).toBeGreaterThan(report.games * 10);
    // Split across two processes and added back together, it is the same run.
    const shards = [0, 1].map((index) =>
      runBalance({ gamesPerPairing: 2, level: 'easy', heroes, seed: 1, shard: { index, count: 2 } }),
    );
    expect(shards[0]!.games + shards[1]!.games).toBe(report.games);
  });
});

describe('the package', () => {
  it('runs in a browser: the library imports nothing from Node', () => {
    const dir = join(import.meta.dirname, '../src');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/from 'node:|require\(|process\./);
    }
  });
});
