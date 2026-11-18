import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  costResource,
  effectiveCost,
  applyAction,
  buildDeckList,
  createGame,
  currentPlayer,
  getPlayerView,
  isBoostActive,
  isComboActive,
  isConditionMet,
  legalActions,
  replay,
} from '../src/index';
import type { Action, GameState } from '../src/index';
import { choose, discardCard, eventsOf, mustApply, playCard, scenario, setHand } from '../src/testing';

const ME = 0;
const OPP = 1;

function pass(state: GameState): GameState {
  return discardCard(state).state;
}

function errorCode(state: GameState, action: Action): string | null {
  const result = applyAction(state, action);
  return result.ok ? null : result.error.code;
}

describe('setup', () => {
  it('deals the starting position from design/cards.json', () => {
    const { state, events } = createGame({ seed: 42, heroes: ['arquitecta', 'mariscal'], firstPlayer: 1 });
    expect(state.active).toBe(1);
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('action');
    // Player 1 moves first, so player 0 gets the second player's taller Wall.
    expect(state.players.map((p) => p.wall)).toEqual([20, 15]);
    for (const p of state.players) {
      expect(p.keep).toBe(50);
      expect(p.workers).toEqual({ piedra: 2, acero: 2, mana: 2 });
      expect(p.hand).toHaveLength(6);
      expect(p.hand.length + p.deck.length).toBe(buildDeckList(DEFAULT_RULES).length);
    }
    // The first player has already produced; the other has not.
    expect(state.players[1].resources).toEqual({ piedra: 10, acero: 10, mana: 10 });
    expect(state.players[0].resources).toEqual({ piedra: 8, acero: 8, mana: 8 });
    expect(events[0]).toMatchObject({ type: 'gameStarted', firstPlayer: 1 });
    expect(state.upcomingEvent.turn).toBe(9);
  });

  it('builds the deck with copies by rarity', () => {
    const deck = buildDeckList(DEFAULT_RULES);
    const count = (id: string): number => deck.filter((c) => c === id).length;
    expect(count('parapeto')).toBe(4);
    expect(count('catapulta')).toBe(3);
    expect(count('motin')).toBe(2);
    expect(count('cometa-del-ocaso')).toBe(1);
    expect(deck).toHaveLength(33 * 4 + 23 * 3 + 10 * 2 + 3);
  });

  it('rejects unknown heroes', () => {
    expect(() => createGame({ seed: 1, heroes: ['arquitecta', 'nadie'] })).toThrow(/Unknown hero/);
  });

  it('accepts rule overrides', () => {
    const { state } = createGame({ seed: 1, heroes: ['mariscal', 'mariscal'], rules: { keepStart: 50, handSize: 4 } });
    expect(state.players[0].keep).toBe(50);
    expect(state.players[0].hand).toHaveLength(4);
    expect(state.rules.wallStart).toBe(15);
  });

  it('picks the first player from the seed when not given', () => {
    const firsts = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      firsts.add(createGame({ seed, heroes: ['mariscal', 'mariscal'] }).state.active);
    }
    expect(firsts).toEqual(new Set([0, 1]));
  });
});

describe('turn flow', () => {
  it('play a card: the hand refills and the turn passes', () => {
    const start = scenario({ hand: ['parapeto', 'cimientos'], keepTurn: false });
    const { state, events } = playCard(start, 'parapeto');
    expect(state.active).toBe(OPP);
    expect(state.turn).toBe(2);
    expect(state.players[ME].hand).toHaveLength(6);
    expect(state.players[ME].discard).toEqual(['parapeto']);
    expect(events.map((e) => e.type)).toEqual([
      'cardPlayed',
      'built',
      'cardsDrawn',
      'turnEnded',
      'turnStarted',
      'produced',
    ]);
    // Production: one unit per worker.
    expect(state.players[OPP].resources).toEqual({ piedra: 52, acero: 52, mana: 52 });
  });

  it('discard a card instead of playing', () => {
    const start = scenario({ hand: ['parapeto', 'cimientos'], keepTurn: false });
    const uid = start.players[ME].hand[1]!.uid;
    const { state, events } = mustApply(start, { type: 'discard', player: ME, uid });
    expect(state.active).toBe(OPP);
    expect(state.players[ME].discard).toEqual(['cimientos']);
    expect(state.players[ME].hand).toHaveLength(6);
    expect(eventsOf(events, 'cardDiscarded')[0]).toMatchObject({ cardId: 'cimientos', reason: 'action' });
  });

  it('one discard action can throw away up to three cards', () => {
    const start = scenario({ hand: ['parapeto', 'cimientos', 'catapulta', 'almenas'], keepTurn: false });
    const [a, b, c, d] = start.players[ME].hand.map((card) => card.uid);
    const { state, events } = mustApply(start, { type: 'discard', player: ME, uid: a!, also: [b!, c!] });
    expect(state.active).toBe(OPP);
    expect(state.players[ME].discard).toEqual(['parapeto', 'cimientos', 'catapulta']);
    expect(eventsOf(events, 'cardDiscarded')).toHaveLength(3);
    // The hand refills to full at the end of the turn.
    expect(state.players[ME].hand).toHaveLength(6);

    const tooMany = applyAction(start, { type: 'discard', player: ME, uid: a!, also: [b!, c!, d!] });
    expect(tooMany.ok).toBe(false);
    const twice = applyAction(start, { type: 'discard', player: ME, uid: a!, also: [a!] });
    expect(twice.ok).toBe(false);
  });

  it('the input state is never modified', () => {
    const start = scenario({ hand: ['catapulta'], keepTurn: false });
    const snapshot = JSON.stringify(start);
    playCard(start, 'catapulta');
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it('rejects illegal actions without changing anything', () => {
    const state = scenario({ hand: ['parapeto'], keepTurn: false });
    const uid = state.players[ME].hand[0]!.uid;
    const theirs = state.players[OPP].hand[0]!.uid;
    expect(errorCode(state, { type: 'play', player: OPP, uid: theirs })).toBe('notYourTurn');
    expect(errorCode(state, { type: 'play', player: ME, uid: theirs })).toBe('cardNotInHand');
    expect(errorCode(state, { type: 'discard', player: ME, uid: 99999 })).toBe('cardNotInHand');
    expect(errorCode(state, { type: 'ultimate', player: ME })).toBe('ultimateNotReady');
    expect(errorCode(state, { type: 'choose', player: ME, option: 'acero' })).toBe('wrongPhase');
    expect(errorCode(state, { type: 'play', player: 2 as 0, uid })).toBe('invalidAction');
    expect(errorCode(state, { type: 'dance' } as unknown as Action)).toBe('invalidAction');
  });

  it('a pending choice blocks other actions and only accepts its options', () => {
    const state = playCard(scenario({ hand: ['aliento-de-escarcha', 'parapeto'] }), 'aliento-de-escarcha').state;
    const uid = state.players[ME].hand[0]!.uid;
    expect(state.phase).toBe('choice');
    expect(errorCode(state, { type: 'play', player: ME, uid })).toBe('wrongPhase');
    expect(errorCode(state, { type: 'discard', player: ME, uid })).toBe('wrongPhase');
    expect(errorCode(state, { type: 'choose', player: ME, option: 'oro' })).toBe('invalidChoice');
    expect(errorCode(state, { type: 'choose', player: OPP, option: 'acero' })).toBe('notYourTurn');
    expect(legalActions(state)).toEqual([
      { type: 'choose', player: ME, option: 'piedra' },
      { type: 'choose', player: ME, option: 'acero' },
      { type: 'choose', player: ME, option: 'mana' },
    ]);
    expect(choose(state, 'acero').state.players[OPP].frost.acero).toBe(2);
  });

  it('lists the legal actions', () => {
    const state = scenario({ hand: ['parapeto', 'trabuquete-colosal', 'espejismo'], resources: 5 });
    const [parapeto, trabuquete, espejismo] = state.players[ME].hand.map((c) => c.uid);
    expect(legalActions(state)).toEqual([
      { type: 'play', player: ME, uid: parapeto },
      { type: 'discard', player: ME, uid: parapeto },
      { type: 'discard', player: ME, uid: trabuquete },
      { type: 'discard', player: ME, uid: espejismo },
    ]);
    expect(currentPlayer(state)).toBe(ME);
  });

  it('reshuffles the discard pile when the deck runs out', () => {
    const start = scenario({ hand: ['parapeto'], keepTurn: false });
    start.players[ME].deck = ['cimientos'];
    start.players[ME].discard = ['escaramuza', 'catapulta', 'zapadores', 'motin', 'drenaje'];
    const { state, events } = playCard(start, 'parapeto');
    expect(eventsOf(events, 'deckReshuffled')).toHaveLength(1);
    expect(state.players[ME].hand).toHaveLength(6);
    expect(state.players[ME].discard).toEqual([]);
    // The played card was reshuffled too: 7 cards in total, 6 in hand.
    expect(state.players[ME].deck).toHaveLength(1);
    const all = [...state.players[ME].hand.map((c) => c.cardId), ...state.players[ME].deck];
    expect(all.sort()).toEqual(
      ['cimientos', 'escaramuza', 'catapulta', 'zapadores', 'motin', 'drenaje', 'parapeto'].sort(),
    );
  });

  it('a discarded opponent card is not replaced until the end of their own turn', () => {
    let state = playCard(scenario({ hand: ['prision-de-hielo'], keepTurn: false }), 'prision-de-hielo').state;
    expect(state.players[OPP].hand).toHaveLength(5);
    state = pass(state);
    expect(state.players[OPP].hand).toHaveLength(6);
  });

  it('replays a game from its actions', () => {
    const { state: start } = createGame({ seed: 'replay', heroes: ['hechicera', 'guardian'] });
    const actions: Action[] = [];
    let state = start;
    for (let i = 0; i < 30 && state.phase !== 'finished'; i++) {
      const action = legalActions(state)[0]!;
      actions.push(action);
      state = mustApply(state, action).state;
    }
    expect(replay(start, actions)).toEqual(state);
    expect(state.seq).toBe(actions.length);
  });
});

describe('damage', () => {
  it('normal damage hits the Wall first and the rest reaches the Keep', () => {
    const { state, events } = playCard(scenario({ hand: ['catapulta'], opponent: { wall: 5 } }), 'catapulta');
    expect([state.players[OPP].wall, state.players[OPP].keep]).toEqual([0, 30]);
    expect(eventsOf(events, 'damage')[0]).toMatchObject({ amount: 25, wallLoss: 5, keepLoss: 20, blocked: false });
  });

  it('piercing damage ignores the Wall', () => {
    const { state } = playCard(scenario({ hand: ['balista-de-asedio'] }), 'balista-de-asedio');
    expect([state.players[OPP].wall, state.players[OPP].keep]).toEqual([15, 35]);
  });

  it('a Keep at 0 loses the game', () => {
    const { state, events } = playCard(
      scenario({ hand: ['trabuquete-colosal'], opponent: { wall: 0, keep: 15 } }),
      'trabuquete-colosal',
    );
    expect(state.players[OPP].keep).toBe(0);
    expect(state.result).toEqual({ winner: ME, reason: 'keepDestroyed' });
    expect(state.phase).toBe('finished');
    expect(events.at(-1)).toEqual({ type: 'gameOver', winner: ME, reason: 'keepDestroyed' });
    expect(legalActions(state)).toEqual([]);
    expect(currentPlayer(state)).toBeNull();
    expect(errorCode(state, { type: 'concede', player: OPP })).toBe('gameOver');
  });

  it('a multi-hit card stops when the first hit wins', () => {
    const { events } = playCard(scenario({ hand: ['doble-salva'], opponent: { wall: 0, keep: 2 } }), 'doble-salva');
    expect(eventsOf(events, 'damage')).toHaveLength(1);
  });

  it('a Keep at the winning height wins the game', () => {
    const { keepWin } = DEFAULT_RULES;
    const { state } = playCard(scenario({ hand: ['aguja-celeste'], you: { keep: keepWin - 10 } }), 'aguja-celeste');
    // The Keep never grows past the winning height.
    expect(state.players[ME].keep).toBe(keepWin);
    expect(state.result).toEqual({ winner: ME, reason: 'keepBuilt' });
  });

  it('Burn can finish a player at the start of their turn', () => {
    const start = scenario({ hand: ['lluvia-de-ascuas'], keepTurn: false, opponent: { wall: 0, keep: 2 } });
    const { state } = playCard(start, 'lluvia-de-ascuas');
    expect(state.result).toEqual({ winner: ME, reason: 'keepDestroyed' });
  });
});

describe('statuses', () => {
  it('Shield blocks one hit of any kind, but not Burn', () => {
    let state = scenario({
      hand: ['balista-de-asedio', 'escaramuza'],
      keepTurn: false,
      opponent: { shield: 1, burn: 1 },
    });
    state = playCard(state, 'balista-de-asedio').state;
    // The piercing hit was blocked; Burn then ticked through at the start of their turn.
    expect(state.players[OPP].shield).toBe(0);
    expect(state.players[OPP].keep).toBe(50);
    expect(state.players[OPP].wall).toBe(12);
  });

  it('Shield charges stack up to the cap', () => {
    let state = scenario({ hand: ['egida-lunar', 'egida-lunar', 'egida-lunar', 'egida-lunar'] });
    state.actionsLeft = 4;
    for (let i = 0; i < 4; i++) state = playCard(state, 'egida-lunar').state;
    expect(state.players[ME].shield).toBe(3);
  });

  it('Burn turns stack up to the cap and Burn is not boosted by attack bonuses', () => {
    let state = scenario({
      hand: ['lluvia-de-ascuas', 'tormenta-de-ceniza'],
      heroes: ['mariscal', 'mariscal'],
      opponent: { shield: 0 },
    });
    state.actionsLeft = 2;
    state = playCard(state, 'lluvia-de-ascuas').state;
    const result = playCard(state, 'tormenta-de-ceniza');
    state = result.state;
    expect(state.players[OPP].burn).toBe(5);
    // 15 + 2 (Marshal) from the card, then 3 from Burn at the start of the turn.
    expect(eventsOf(result.events, 'damage').map((e) => [e.cause, e.amount])).toEqual([
      ['card', 17],
      ['burn', 3],
    ]);
    const capped = scenario({ hand: ['tormenta-de-ceniza', 'cimientos'], opponent: { burn: 5 } });
    expect(playCard(capped, 'tormenta-de-ceniza').state.players[OPP].burn).toBe(6);
  });

  it('Frost turns on the same resource stack up to the cap', () => {
    let state = scenario({ hand: ['aliento-de-escarcha', 'aliento-de-escarcha', 'cimientos'] });
    state.actionsLeft = 3;
    state = choose(playCard(state, 'aliento-de-escarcha').state, 'mana').state;
    state = choose(playCard(state, 'aliento-de-escarcha').state, 'mana').state;
    expect(state.players[OPP].frost).toEqual({ piedra: 0, acero: 0, mana: 3 });
  });
});

describe('enchantments', () => {
  it('a third enchantment replaces the oldest', () => {
    let state = scenario({ hand: ['contrafuertes', 'fortaleza-viva', 'estandarte-de-guerra'] });
    state.actionsLeft = 3;
    state = playCard(state, 'contrafuertes').state;
    state = playCard(state, 'fortaleza-viva').state;
    const result = playCard(state, 'estandarte-de-guerra');
    expect(result.state.players[ME].enchantments.map((e) => e.cardId)).toEqual([
      'fortaleza-viva',
      'estandarte-de-guerra',
    ]);
    expect(eventsOf(result.events, 'enchantmentRemoved')[0]).toMatchObject({
      cardId: 'contrafuertes',
      reason: 'replaced',
    });
  });

  it('playing the same enchantment again restarts its duration', () => {
    const state = scenario({
      hand: ['contrafuertes', 'cimientos'],
      you: { enchantments: [{ cardId: 'contrafuertes', turnsLeft: 1, fresh: false }] },
    });
    const result = playCard(state, 'contrafuertes');
    expect(result.state.players[ME].enchantments).toEqual([{ cardId: 'contrafuertes', turnsLeft: 4, fresh: true }]);
    expect(eventsOf(result.events, 'enchantmentAdded')[0]!.refreshed).toBe(true);
  });

  it('lasts for the owner\'s next N turns and protects during N opponent turns', () => {
    let state = playCard(scenario({ hand: ['contrafuertes'], keepTurn: false }), 'contrafuertes').state;
    let protectedTurns = 0;
    for (let i = 0; i < 6; i++) {
      // Opponent's turn: is the enchantment still up?
      if (state.players[ME].enchantments.length > 0) protectedTurns += 1;
      state = pass(pass(state));
    }
    expect(protectedTurns).toBe(4);
  });
});

describe('boosted cards', () => {
  it('sees a condition that holds, also from the player view', () => {
    const state = scenario({ opponent: { schoolsLastTurn: ['construccion'] }, you: { keep: 50 } });
    expect(isConditionMet(state, ME, 'emboscada')).toBe(true);
    expect(isBoostActive(getPlayerView(state, ME), ME, 'emboscada')).toBe(true);
    expect(isConditionMet(state, ME, 'reparaciones-de-urgencia')).toBe(false);
    state.players[ME].keep = 20;
    expect(isConditionMet(state, ME, 'reparaciones-de-urgencia')).toBe(true);
    state.players[OPP].schoolsLastTurn = ['asalto'];
    expect(isBoostActive(state, ME, 'emboscada')).toBe(false);
    // A card with no condition and no Combo is never boosted.
    expect(isBoostActive(state, ME, 'catapulta')).toBe(false);
  });

  it('counts an active Combo', () => {
    const state = scenario({ you: { comboSchool: 'construccion' } });
    expect(isBoostActive(state, ME, 'puntales')).toBe(true);
    expect(isBoostActive(state, ME, 'almenas')).toBe(false);
  });
});

describe('combo', () => {
  it('needs two cards of the same school in consecutive turns', () => {
    let state = scenario({ hand: ['hilada-de-piedra', 'puntales', 'puntales'], keepTurn: false });
    expect(isComboActive(state, ME, 'puntales')).toBe(false);
    state = playCard(state, 'hilada-de-piedra').state;
    state = pass(state);
    expect(isComboActive(state, ME, 'puntales')).toBe(true);
    expect(isComboActive(state, ME, 'hostigamiento')).toBe(false);
    const wall = state.players[ME].wall;
    state = playCard(state, 'puntales').state;
    expect(state.players[ME].wall).toBe(wall + 3 + 8);
  });

  it('discarding breaks the chain', () => {
    let state = scenario({ hand: ['hilada-de-piedra', 'cimientos', 'puntales'], keepTurn: false });
    state = pass(playCard(state, 'hilada-de-piedra').state);
    state = pass(discardCard(state, 'cimientos').state);
    expect(isComboActive(state, ME, 'puntales')).toBe(false);
  });
});

describe('timeout (turn clock hook)', () => {
  it('plays the cheapest card the player can pay and ends the turn', () => {
    const hand = ['trabuquete-colosal', 'cimientos', 'parapeto', 'catapulta'] as const;
    const start = scenario({ hand: [...hand], keepTurn: false });
    const costs = hand.map((id) => effectiveCost(start, ME, id));
    const cheapest = Math.min(...costs);
    const { state, events } = mustApply(start, { type: 'timeout' });
    expect(events[0]).toEqual({ type: 'timedOut', player: ME });
    const played = eventsOf(events, 'cardPlayed');
    expect(played).toHaveLength(1);
    expect(played[0]!.player).toBe(ME);
    expect(effectiveCost(start, ME, played[0]!.cardId)).toBe(cheapest);
    expect(eventsOf(events, 'cardDiscarded').filter((e) => e.reason === 'timeout')).toEqual([]);
    expect(state.active).toBe(OPP);
  });

  it('leaves out cards the player cannot pay', () => {
    const start = scenario({ hand: ['trabuquete-colosal', 'cimientos'], keepTurn: false, resources: 0 });
    const affordable = start.players[ME].hand.find((c) => c.cardId === 'cimientos')!;
    const cost = effectiveCost(start, ME, 'cimientos');
    start.players[ME].resources[costResource('cimientos')] = cost;
    const { events } = mustApply(start, { type: 'timeout' });
    expect(eventsOf(events, 'cardPlayed').map((e) => e.uid)).toEqual([affordable.uid]);
  });

  it('discards a random card when no card can be paid, and ends the turn', () => {
    const start = scenario({ keepTurn: false, resources: 0 });
    const { state, events } = mustApply(start, { type: 'timeout' });
    expect(state.active).toBe(OPP);
    expect(events[0]).toEqual({ type: 'timedOut', player: ME });
    expect(eventsOf(events, 'cardDiscarded')[0]).toMatchObject({ player: ME, reason: 'timeout' });
    expect(state.players[ME].hand).toHaveLength(6);
  });

  it('takes the default answer of a pending choice and does not discard after a play', () => {
    let state = scenario({
      hand: ['espia-en-la-corte', 'parapeto'],
      keepTurn: false,
      opponentHand: ['escaramuza', 'trabuquete-colosal'],
    });
    state = playCard(state, 'espia-en-la-corte').state;
    const { state: after, events } = mustApply(state, { type: 'timeout' });
    expect(after.players[OPP].discard).toEqual(['trabuquete-colosal']);
    expect(eventsOf(events, 'cardDiscarded').map((e) => e.reason)).toEqual(['effect']);
    expect(after.active).toBe(OPP);
  });

  it('ends the turn even if the player still had extra plays', () => {
    let state = scenario({ hand: ['ojo-del-augur'], keepTurn: false });
    state = playCard(state, 'ojo-del-augur').state;
    expect(state.active).toBe(ME);
    state = mustApply(state, { type: 'timeout' }).state;
    expect(state.active).toBe(OPP);
  });

  it('the Saboteur steals once per discard action, however many cards it throws away', () => {
    const start = scenario({ heroes: ['saboteadora', 'saboteadora'], hand: ['parapeto', 'cimientos', 'catapulta'], keepTurn: false });
    const [a, b, c] = start.players[ME].hand.map((card) => card.uid);
    const { events } = mustApply(start, { type: 'discard', player: ME, uid: a!, also: [b!, c!] });
    expect(eventsOf(events, 'resourcesChanged').filter((e) => e.player === ME)).toHaveLength(1);
  });

  it('the Saboteur passive does not reward a timeout', () => {
    const start = scenario({ heroes: ['saboteadora', 'saboteadora'], keepTurn: false });
    const { events } = mustApply(start, { type: 'timeout' });
    expect(eventsOf(events, 'resourcesChanged')).toEqual([]);
  });
});

describe('ending the game', () => {
  it('either player can concede at any time', () => {
    const state = scenario();
    expect(mustApply(state, { type: 'concede', player: OPP }).state.result).toEqual({ winner: ME, reason: 'concede' });
    expect(mustApply(state, { type: 'concede', player: ME }).state.result).toEqual({ winner: OPP, reason: 'concede' });
  });

  it('at the turn limit the higher Keep wins, then the higher Wall, else it is a draw', () => {
    const finish = (you: { keep: number; wall: number }): GameState['result'] => {
      const start = scenario({ rules: { turnLimit: 1 }, keepTurn: false, you });
      return pass(start).result;
    };
    expect(finish({ keep: 51, wall: 0 })).toEqual({ winner: ME, reason: 'turnLimit' });
    expect(finish({ keep: 49, wall: 50 })).toEqual({ winner: OPP, reason: 'turnLimit' });
    expect(finish({ keep: 50, wall: 16 })).toEqual({ winner: ME, reason: 'turnLimit' });
    expect(finish({ keep: 50, wall: 15 })).toEqual({ winner: null, reason: 'turnLimit' });
  });
});

describe('determinism', () => {
  it('the same seed and actions give the same game; another seed does not', () => {
    const run = (seed: number): GameState => {
      let { state } = createGame({ seed, heroes: ['alquimista', 'saboteadora'] });
      for (let i = 0; i < 40 && state.phase !== 'finished'; i++) {
        const legal = legalActions(state);
        state = mustApply(state, legal[i % legal.length]!).state;
      }
      return state;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('a state survives a JSON round trip mid-game, pending choice included', () => {
    let state = scenario({ hand: ['sabotaje'], keepTurn: false });
    state.players[OPP].enchantments = [
      { cardId: 'contrafuertes', turnsLeft: 2, fresh: false },
      { cardId: 'fortaleza-viva', turnsLeft: 3, fresh: false },
    ];
    state = playCard(state, 'sabotaje').state;
    expect(state.phase).toBe('choice');
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    expect(restored).toEqual(state);
    expect(choose(restored, 'contrafuertes').state).toEqual(choose(state, 'contrafuertes').state);
  });

  it('setHand helper keeps uids unique', () => {
    const state = scenario();
    setHand(state, ME, ['parapeto', 'parapeto']);
    const uids = [...state.players[ME].hand, ...state.players[OPP].hand].map((c) => c.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });
});
