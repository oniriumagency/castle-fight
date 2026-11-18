import { describe, expect, it } from 'vitest';
import { BATTLE_EVENTS, createGame, effectiveCost, isSchoolBanned, legalActions, playBlocker } from '../src/index';
import type { GameEvent, GameState } from '../src/index';
import { discardCard, eventsOf, playCard, scenario, setHand } from '../src/testing';

const ME = 0;
const OPP = 1;

/** Player 0 ends turn 1 and the given event fires at the start of turn 2. */
function fire(eventId: string, options: Parameters<typeof scenario>[0] = {}): { state: GameState; events: GameEvent[] } {
  const state = scenario({ keepTurn: false, ...options });
  state.upcomingEvent = { id: eventId, turn: 2 };
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
    let { state, events } = fire('eclipse');
    expect(eventsOf(events, 'battleEventStarted')[0]).toEqual({ type: 'battleEventStarted', eventId: 'eclipse', turns: 2 });
    expect(state.activeEvent).toEqual({ id: 'eclipse', turnsLeft: 2 });
    // Arcane cards cost half, rounded up; the other schools do not change.
    expect(effectiveCost(state, OPP, 'reloj-de-arena')).toBe(7);
    expect(effectiveCost(state, OPP, 'aliento-de-escarcha')).toBe(2);
    expect(effectiveCost(state, OPP, 'ojo-del-augur')).toBe(1);
    expect(effectiveCost(state, OPP, 'parapeto')).toBe(4);
    // It lasts 2 turns: one for each player.
    state = discardCard(state).state;
    expect(effectiveCost(state, ME, 'reloj-de-arena')).toBe(7);
    const end = discardCard(state);
    expect(eventsOf(end.events, 'battleEventEnded')[0]!.eventId).toBe('eclipse');
    expect(end.state.activeEvent).toBeNull();
    expect(effectiveCost(end.state, OPP, 'reloj-de-arena')).toBe(14);
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
    let { state } = fire('tregua');
    setHand(state, OPP, ['escaramuza', 'parapeto']);
    // Assault cards cannot be played for 2 turns.
    expect(isSchoolBanned(state, 'escaramuza')).toBe(true);
    expect(playBlocker(state, OPP, 'escaramuza')!.code).toBe('schoolBanned');
    expect(playBlocker(state, OPP, 'parapeto')).toBeNull();
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

  it('fires every 8 turns, is announced in advance and never repeats back to back', () => {
    let { state } = createGame({ seed: 'events', heroes: ['guardian', 'guardian'], rules: { turnLimit: 0, twilightRound: 0 } });
    const fired: Array<{ id: string; turn: number }> = [];
    let announced = state.upcomingEvent;
    expect(announced.turn).toBe(9);
    while (state.turn < 60 && state.phase !== 'finished') {
      const result = discardCard(state);
      for (const event of eventsOf(result.events, 'battleEventStarted')) {
        expect(event.eventId).toBe(announced.id);
        expect(result.state.turn).toBe(announced.turn);
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
});
