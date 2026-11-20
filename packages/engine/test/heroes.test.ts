import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, HEROES, createGame, effectiveCost, isUltimateReady, legalActions, ultimateThreshold } from '../src/index';
import type { GameState } from '../src/index';
import { choose, discardCard, eventsOf, mustApply, playCard, scenario } from '../src/testing';

const uidOf = (state: GameState, cardId: string): string =>
  String(state.players[state.active].hand.find((c) => c.cardId === cardId)!.uid);

const ME = 0;
const OPP = 1;

/** A scenario where player 0 has the given hero and a charged ultimate. */
function charged(hero: string, extra: Parameters<typeof scenario>[0] = {}): GameState {
  return scenario({ heroes: [hero, 'guardian'], ...extra, you: { ultimateCharge: DEFAULT_RULES.ultimateCharge, ...extra.you } });
}

function ultimate(state: GameState): ReturnType<typeof mustApply> {
  return mustApply(state, { type: 'ultimate', player: state.active });
}

const HERO_TESTS: Record<string, () => void> = {
  arquitecta: () => {
    // Passive: Construction cards cost 1 less (never below 0).
    const state = charged('arquitecta', { hand: ['parapeto'] });
    expect(effectiveCost(state, ME, 'parapeto')).toBe(3);
    expect(effectiveCost(state, ME, 'cantera-abierta')).toBe(0);
    expect(effectiveCost(state, ME, 'escaramuza')).toBe(1);
    expect(effectiveCost(state, OPP, 'parapeto')).toBe(4);
    expect(playCard(state, 'parapeto').state.players[ME].resources.piedra).toBe(47);
    // Ultimate: +8 Keep, +10 Wall and +1 Mason.
    const after = ultimate(state).state.players[ME];
    expect([after.keep, after.wall]).toEqual([58, 25]);
    expect(after.workers).toEqual({ piedra: 3, acero: 2, mana: 2 });
  },
  mariscal: () => {
    // Passive: +2 damage on every hit (the Warden's Wall starts at 22).
    const state = charged('mariscal', { hand: ['doble-salva'] });
    expect(playCard(state, 'doble-salva').state.players[OPP].wall).toBe(22 - 14);
    // Ultimate: 13 damage (an attack, so the passive applies).
    const target = ultimate(state).state.players[OPP];
    expect([target.wall, target.keep]).toEqual([7, 50]);
  },
  hechicera: () => {
    // Passive: Burn and Frost she applies last 1 more turn.
    const state = charged('hechicera', { hand: ['lluvia-de-ascuas', 'prision-de-hielo'] });
    expect(playCard(state, 'lluvia-de-ascuas').state.players[OPP].burn).toBe(5);
    expect(playCard(state, 'prision-de-hielo').state.players[OPP].frost).toEqual({ piedra: 2, acero: 2, mana: 2 });
    // Ultimate: Burn (5 turns, 6 with the passive), full Frost and 3 piercing damage.
    const target = ultimate(state).state.players[OPP];
    expect(target.burn).toBe(6);
    expect(target.frost).toEqual({ piedra: 2, acero: 2, mana: 2 });
    expect([target.wall, target.keep]).toEqual([22, 47]);
  },
  alquimista: () => {
    // Passive: +3 of a random resource at the start of each of his turns.
    const { state, events } = createGame({ seed: 5, heroes: ['alquimista', 'guardian'], firstPlayer: 0 });
    const total = Object.values(state.players[ME].resources).reduce((a, b) => a + b, 0);
    expect(total).toBe(3 * 8 + 3 * 2 + 3);
    expect(eventsOf(events, 'resourcesChanged')[0]!.reason).toEqual({ kind: 'hero', id: 'alquimista' });
    // Ultimate: +7 of each resource and +6 Keep.
    const after = ultimate(charged('alquimista')).state.players[ME];
    expect(after.resources).toEqual({ piedra: 57, acero: 57, mana: 57 });
    expect(after.keep).toBe(56);
  },
  saboteadora: () => {
    // Passive: discarding steals 3 of the opponent's biggest stockpile.
    const state = charged('saboteadora', { opponent: { resources: { piedra: 1, acero: 7, mana: 3 } } });
    const after = discardCard(state).state;
    expect(after.players[OPP].resources.acero).toBe(4);
    expect(after.players[ME].resources.acero).toBe(53);
    // It also fires when a card makes her discard, once per card however many go.
    const opp = { resources: { piedra: 1, acero: 7, mana: 3 } };
    let own = playCard(
      charged('saboteadora', { opponent: opp, hand: ['tierra-quemada', 'escaramuza', 'parapeto', 'catapulta'] }),
      'tierra-quemada',
    ).state;
    expect(own.players[OPP].resources.acero).toBe(7);
    own = choose(own, uidOf(own, 'escaramuza')).state;
    expect(own.players[OPP].resources.acero).toBe(4);
    own = choose(own, uidOf(own, 'parapeto')).state;
    own = choose(own, 'done').state;
    expect(own.players[OPP].resources).toEqual({ piedra: 1, acero: 4, mana: 3 });
    // Stopping before discarding anything steals nothing.
    const none = choose(
      playCard(charged('saboteadora', { opponent: opp, hand: ['tierra-quemada', 'escaramuza', 'parapeto'] }), 'tierra-quemada').state,
      'done',
    ).state;
    expect(none.players[OPP].resources.acero).toBe(7);
    // Discarding the whole hand is one steal too.
    // (Her hand empties, so the turn passes: count the steals instead of reading the stockpile.)
    const all = playCard(charged('saboteadora', { opponent: opp, hand: ['todo-o-nada', 'escaramuza', 'parapeto'] }), 'todo-o-nada').events;
    const steals = eventsOf(all, 'resourcesChanged').filter((e) => e.reason.kind === 'hero');
    expect(steals.map((e) => [e.player, e.delta, e.to, e.from])).toEqual([
      [OPP, { acero: -3 }, ME, undefined],
      [ME, { acero: 3 }, undefined, OPP],
    ]);
    // And when her card makes the opponent discard (random or chosen).
    const burn = playCard(
      charged('saboteadora', { opponent: opp, hand: ['quema-de-pergaminos', 'escaramuza'], opponentHand: ['escaramuza', 'parapeto', 'catapulta'] }),
      'quema-de-pergaminos',
    ).state;
    expect(burn.players[OPP].resources.acero).toBe(4);
    const spy = playCard(
      charged('saboteadora', { opponent: opp, hand: ['espia-en-la-corte', 'escaramuza'], opponentHand: ['escaramuza', 'parapeto'] }),
      'espia-en-la-corte',
    ).state;
    expect(spy.players[OPP].resources.acero).toBe(7);
    expect(choose(spy, spy.pending!.options[0]!).state.players[OPP].resources.acero).toBe(4);
    // Nothing to discard, nothing stolen.
    const empty = playCard(
      charged('saboteadora', { opponent: opp, hand: ['quema-de-pergaminos', 'escaramuza'], opponentHand: [] }),
      'quema-de-pergaminos',
    ).state;
    expect(empty.players[OPP].resources.acero).toBe(7);
    // Another hero's discard card does not trigger it.
    const plain = playCard(scenario({ opponent: opp, hand: ['tierra-quemada', 'escaramuza'] }), 'tierra-quemada').state;
    expect(plain.players[OPP].resources.acero).toBe(7);
    // Ultimate: steal a worker of the type the opponent has most of, and 10 piercing damage.
    const robbedResult = ultimate(charged('saboteadora', { opponent: { workers: { piedra: 2, acero: 2, mana: 5 } } }));
    const robbed = robbedResult.state;
    // The log reads it as one steal: the loss names the thief and the gain the victim.
    expect(eventsOf(robbedResult.events, 'workersChanged').map((e) => [e.player, e.delta, e.to, e.from])).toEqual([
      [OPP, { mana: -1 }, ME, undefined],
      [ME, { mana: 1 }, undefined, OPP],
    ]);
    expect(robbed.players[OPP].workers.mana).toBe(4);
    expect(robbed.players[ME].workers.mana).toBe(3);
    expect([robbed.players[OPP].wall, robbed.players[OPP].keep]).toEqual([22, 40]);
    // The opponent never drops below 1 worker; she gains hers anyway.
    const floorResult = ultimate(charged('saboteadora', { opponent: { workers: { piedra: 1, acero: 1, mana: 1 } } }));
    const floor = floorResult.state;
    // Nothing was taken from the opponent, so her worker is a plain gain.
    expect(eventsOf(floorResult.events, 'workersChanged').map((e) => [e.player, e.from])).toEqual([[ME, undefined]]);
    expect(floor.players[OPP].workers).toEqual({ piedra: 1, acero: 1, mana: 1 });
    expect(floor.players[ME].workers.piedra).toBe(3);
  },
  guardian: () => {
    // Passive: the Wall starts 7 higher.
    const { state } = createGame({
      seed: 1,
      heroes: ['guardian', 'mariscal'],
      rules: { secondPlayerWall: 0 },
    });
    expect(state.players[0].wall).toBe(22);
    expect(state.players[1].wall).toBe(15);
    // Ultimate: Shield for 1 attack and +10 Wall.
    const after = ultimate(charged('guardian')).state.players[ME];
    expect([after.shield, after.wall]).toEqual([1, 32]);
  },
};

describe('heroes', () => {
  it('has a test for every hero', () => {
    expect(Object.keys(HERO_TESTS).sort()).toEqual(HEROES.map((h) => h.id).sort());
  });

  for (const hero of HEROES) {
    it(`${hero.id} (${hero.name.en})`, () => HERO_TESTS[hero.id]!());
  }
});

describe('ultimate', () => {
  it('charges with damage taken on Wall and Keep, from attacks and Burn', () => {
    let state = scenario({ hand: ['catapulta'], keepTurn: false, opponent: { wall: 5, burn: 1 } });
    const result = playCard(state, 'catapulta');
    state = result.state;
    // 25 from the Catapult (5 Wall + 20 Keep), then 3 from Burn.
    expect(state.players[OPP].ultimateCharge).toBe(28);
    expect(eventsOf(result.events, 'ultimateCharged').map((e) => e.charge)).toEqual([25, 28]);
    expect(isUltimateReady(state, OPP)).toBe(false);
  });

  it('does not charge with blocked hits or battle-event losses', () => {
    const state = scenario({ hand: ['catapulta'], opponent: { shield: 1 } });
    expect(playCard(state, 'catapulta').state.players[OPP].ultimateCharge).toBe(0);
  });

  it('is a free action: the player still plays a card afterwards', () => {
    let state = charged('arquitecta', { hand: ['parapeto'], keepTurn: false });
    expect(legalActions(state)[0]).toEqual({ type: 'ultimate', player: ME });
    const result = ultimate(state);
    state = result.state;
    expect(eventsOf(result.events, 'ultimateUsed')[0]).toEqual({ type: 'ultimateUsed', player: ME, heroId: 'arquitecta' });
    expect(state.active).toBe(ME);
    expect(state.phase).toBe('action');
    expect(state.players[ME].ultimateCharge).toBe(0);
    expect(playCard(state, 'parapeto').state.active).toBe(OPP);
  });

  it('needs more damage after every use', () => {
    let state = charged('guardian');
    expect(ultimateThreshold(state, ME)).toBe(35);
    state = ultimate(state).state;
    expect(ultimateThreshold(state, ME)).toBe(50);
    state.players[ME].ultimateCharge = 45;
    expect(isUltimateReady(state, ME)).toBe(false);
    state.players[ME].ultimateCharge = 50;
    expect(isUltimateReady(state, ME)).toBe(true);
  });

  it('the charge stops at the threshold', () => {
    const state = scenario({ hand: ['trabuquete-colosal'], opponent: { ultimateCharge: 15 } });
    expect(playCard(state, 'trabuquete-colosal').state.players[OPP].ultimateCharge).toBe(35);
  });

  it('can win the game', () => {
    const state = charged('mariscal', { opponent: { wall: 0, keep: 12 } });
    expect(ultimate(state).state.result).toEqual({ winner: ME, reason: 'keepDestroyed' });
  });
});
