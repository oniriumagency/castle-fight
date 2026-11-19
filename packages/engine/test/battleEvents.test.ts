import { describe, expect, it } from 'vitest';
import { BATTLE_EVENTS, createGame, effectiveCost, isSchoolBanned, legalActions, playBlocker } from '../src/index';
import type { GameEvent, GameState } from '../src/index';
import { discardCard, eventsOf, playCard, scenario, setHand } from '../src/testing';

const ME = 0;
const OPP = 1;

/** Player 0 ends turn 1 and the given event fires at the start of turn 2. */
function fire(eventId: string, options: Parameters<typeof scenario>[0] = {}): { state: GameState; events: GameEvent[] } {
  const state = scenario({ keepTurn: false, ...options });
  state.upcomingEvent = { id: eventId, round: 1 };
  return discardCard(state);
}

/** The given event fires as round 2 starts (turn 3, player 0's turn), as it does in a real game. */
function fireAtRoundStart(eventId: string): { state: GameState; events: GameEvent[] } {
  let state = scenario({ keepTurn: false });
  state.upcomingEvent = { id: eventId, round: 2 };
  state = discardCard(state).state;
  return discardCard(state);
}

const EVENT_TESTS: Record<string, () => void> = {
  tormenta: () => {
    const { state } = fire('tormenta', { you: { wall: 3 } });
    expect(state.players[ME].wall).toBe(0);
    expect(state.players[OPP].wall).toBe(7);
  },
  mercado: () => {
    const { state } = fire('mercado');
    expect(state.players[ME].resources).toEqual({ piedra: 55, acero: 55, mana: 55 });
    // The active player also produced.
    expect(state.players[OPP].resources).toEqual({ piedra: 57, acero: 57, mana: 57 });
  },
  eclipse: () => {
    let { state, events } = fireAtRoundStart('eclipse');
    expect(eventsOf(events, 'battleEventStarted')[0]).toEqual({ type: 'battleEventStarted', eventId: 'eclipse', rounds: 2 });
    expect(state.activeEvent).toEqual({ id: 'eclipse', untilRound: 3 });
    // Arcane cards cost half, rounded up; the other schools do not change.
    expect(effectiveCost(state, ME, 'reloj-de-arena')).toBe(7);
    expect(effectiveCost(state, ME, 'aliento-de-escarcha')).toBe(2);
    expect(effectiveCost(state, ME, 'ojo-del-augur')).toBe(1);
    expect(effectiveCost(state, ME, 'parapeto')).toBe(4);
    // It lasts 2 rounds: two turns for each player.
    state = discardCard(state).state;
    expect(effectiveCost(state, OPP, 'reloj-de-arena')).toBe(7);
    state = discardCard(state).state;
    expect(state.activeEvent).toEqual({ id: 'eclipse', untilRound: 3 });
    expect(effectiveCost(state, ME, 'reloj-de-arena')).toBe(7);
    state = discardCard(state).state;
    expect(effectiveCost(state, OPP, 'reloj-de-arena')).toBe(7);
    const end = discardCard(state);
    expect(eventsOf(end.events, 'battleEventEnded')[0]!.eventId).toBe('eclipse');
    expect(end.state.activeEvent).toBeNull();
    expect(effectiveCost(end.state, ME, 'reloj-de-arena')).toBe(14);
  },
  terremoto: () => {
    const { state } = fire('terremoto', { you: { keep: 3 } });
    // Events never kill: the Keep stops at 1.
    expect(state.players[ME].keep).toBe(1);
    expect(state.players[OPP].keep).toBe(43);
    expect(state.result).toBeNull();
  },
  cosecha: () => {
    const { state } = fire('cosecha');
    for (const p of state.players) {
      expect(Object.values(p.workers).reduce((a, b) => a + b, 0)).toBe(7);
    }
  },
  tregua: () => {
    let { state } = fireAtRoundStart('tregua');
    setHand(state, ME, ['escaramuza', 'parapeto']);
    // Assault cards cannot be played for 1 round.
    expect(isSchoolBanned(state, 'escaramuza')).toBe(true);
    expect(playBlocker(state, ME, 'escaramuza')!.code).toBe('schoolBanned');
    expect(playBlocker(state, ME, 'parapeto')).toBeNull();
    expect(legalActions(state).filter((a) => a.type === 'play')).toHaveLength(1);
    state = playCard(state, 'parapeto').state;
    expect(isSchoolBanned(state, 'escaramuza')).toBe(true);
    state = discardCard(state).state;
    expect(isSchoolBanned(state, 'escaramuza')).toBe(false);
  },
};

describe('battle events', () => {
  it('has a test for every event', () => {
    expect(Object.keys(EVENT_TESTS).sort()).toEqual(BATTLE_EVENTS.map((e) => e.id).sort());
  });

  for (const event of BATTLE_EVENTS) {
    it(`${event.id} (${event.name.en})`, () => EVENT_TESTS[event.id]!());
  }

  it('fires every 4 rounds (8 turns in a duel), is announced in advance and never repeats back to back', () => {
    let { state } = createGame({ seed: 'events', heroes: ['guardian', 'guardian'], rules: { turnLimit: 0, twilightRound: 0 } });
    const fired: Array<{ id: string; turn: number }> = [];
    let announced = state.upcomingEvent;
    expect(announced.round).toBe(5);
    while (state.turn < 60 && state.phase !== 'finished') {
      const result = discardCard(state);
      for (const event of eventsOf(result.events, 'battleEventStarted')) {
        expect(event.eventId).toBe(announced.id);
        expect(result.state.round).toBe(announced.round);
        fired.push({ id: event.eventId, turn: result.state.turn });
      }
      state = result.state;
      announced = state.upcomingEvent;
    }
    expect(fired.map((f) => f.turn)).toEqual([9, 17, 25, 33, 41, 49, 57]);
    for (let i = 1; i < fired.length; i++) expect(fired[i]!.id).not.toBe(fired[i - 1]!.id);
  });

  it('losses from events do not charge the ultimate and ignore Shield', () => {
    const { state } = fire('tormenta', { you: { shield: 1 } });
    expect(state.players[ME].wall).toBe(7);
    expect(state.players[ME].shield).toBe(1);
    expect(state.players[ME].ultimateCharge).toBe(0);
  });

  it('counts rounds with 3 players, so it comes every 12 turns', () => {
    let { state } = createGame({ seed: 'events3', heroes: ['guardian', 'guardian', 'guardian'], rules: { turnLimit: 0, twilightRound: 0 } });
    const fired: number[] = [];
    while (state.turn < 40 && state.phase !== 'finished') {
      const result = discardCard(state);
      if (eventsOf(result.events, 'battleEventStarted').length) fired.push(result.state.turn);
      state = result.state;
    }
    expect(fired).toEqual([13, 25, 37]);
  });

  it('a lasting event covers whole rounds with 3 players', () => {
    let { state } = createGame({ seed: 'lasting3', heroes: ['guardian', 'guardian', 'guardian'], rules: { turnLimit: 0, twilightRound: 0 } });
    state.upcomingEvent = { id: 'eclipse', round: 2 };
    const active: boolean[] = [];
    let ended = 0;
    while (state.turn < 11) {
      const result = discardCard(state);
      ended += eventsOf(result.events, 'battleEventEnded').length;
      state = result.state;
      active.push(state.activeEvent !== null);
    }
    // Turns 2..11: the Eclipse covers rounds 2 and 3, turns 4 to 9.
    expect(active).toEqual([false, false, true, true, true, true, true, true, false, false]);
    expect(ended).toBe(1);
  });

  it('old saves keep counting events by turns', () => {
    let { state } = createGame({ seed: 'old', heroes: ['guardian', 'guardian'], rules: { turnLimit: 0, twilightRound: 0 } });
    state.upcomingEvent = { id: 'eclipse', turn: 3 } as unknown as GameState['upcomingEvent'];
    state.rules = { ...state.rules, eventEveryRounds: undefined as unknown as number, eventEveryTurns: 8 };
    state = discardCard(state).state;
    const { state: after, events } = discardCard(state);
    expect(eventsOf(events, 'battleEventStarted')).toHaveLength(1);
    expect(after.upcomingEvent.round).toBe(2 + 4);
  });
});
