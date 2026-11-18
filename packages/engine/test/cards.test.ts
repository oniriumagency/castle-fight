import { describe, expect, it } from 'vitest';
import { CARDS, applyAction, effectiveCost, getCard, legalActions, playBlocker } from '../src/index';
import type { GameEvent, GameState } from '../src/index';
import { choose, discardCard, eventsOf, playCard, scenario, setHand, type ScenarioOptions } from '../src/testing';

/**
 * One test per card. Scenarios start with both players at Keep 50, Wall 15,
 * 50 of each resource and 2 of each worker; player 0 ("me") is to move and,
 * unless `keepTurn: false`, keeps the turn after playing one card.
 */

const ME = 0;
const OPP = 1;

function play(cardId: string, options: ScenarioOptions = {}): { state: GameState; events: GameEvent[] } {
  // The second card is a filler: a turn ends on its own when the hand is empty.
  return playCard(scenario({ hand: [cardId, 'cimientos'], ...options }), cardId);
}

/** The uid (as a choice option) of a card in my hand. */
function uidOf(state: GameState, cardId: string): string {
  return String(state.players[ME].hand.find((c) => c.cardId === cardId)!.uid);
}

/** The active player ends the turn by discarding a card. */
function pass(state: GameState): GameState {
  return discardCard(state).state;
}

const CARD_TESTS: Record<string, () => void> = {
  // ----- Construcción ------------------------------------------------------
  'hilada-de-piedra': () => {
    const { state } = play('hilada-de-piedra');
    expect(state.players[ME].wall).toBe(20);
    expect(state.players[ME].resources.piedra).toBe(48);
  },
  parapeto: () => {
    expect(play('parapeto').state.players[ME].wall).toBe(25);
  },
  'bastida-de-granito': () => {
    expect(play('bastida-de-granito').state.players[ME].wall).toBe(35);
  },
  cimientos: () => {
    expect(play('cimientos').state.players[ME].keep).toBe(57);
  },
  'andamio-real': () => {
    expect(play('andamio-real').state.players[ME].keep).toBe(67);
  },
  'gremio-de-canteros': () => {
    const { state } = play('gremio-de-canteros');
    expect(state.players[ME].workers).toEqual({ piedra: 3, acero: 2, mana: 2 });
  },
  'cantera-abierta': () => {
    const { state } = play('cantera-abierta');
    expect(state.players[ME].resources.piedra).toBe(54);
  },
  almenas: () => {
    const { state } = play('almenas');
    expect(state.players[ME].wall).toBe(22);
    expect(state.players[ME].keep).toBe(55);
  },
  puntales: () => {
    expect(play('puntales').state.players[ME].wall).toBe(18);
    // Combo: the previous card played was also Construction.
    const combo = play('puntales', { you: { comboSchool: 'construccion' } });
    expect(combo.state.players[ME].wall).toBe(26);
    expect(eventsOf(combo.events, 'cardPlayed')[0]!.combo).toBe(true);
    // A card of another school does not trigger it.
    expect(play('puntales', { you: { comboSchool: 'asalto' } }).state.players[ME].wall).toBe(18);
  },
  'reparaciones-de-urgencia': () => {
    expect(play('reparaciones-de-urgencia').state.players[ME].keep).toBe(57);
    expect(play('reparaciones-de-urgencia', { you: { keep: 35 } }).state.players[ME].keep).toBe(42);
    expect(play('reparaciones-de-urgencia', { you: { keep: 34 } }).state.players[ME].keep).toBe(49);
  },
  'fragua-del-gremio': () => {
    const { state } = play('fragua-del-gremio');
    expect(state.players[ME].workers).toEqual({ piedra: 2, acero: 3, mana: 2 });
    expect(state.players[ME].resources.piedra).toBe(42);
  },
  'aula-de-arcanistas': () => {
    expect(play('aula-de-arcanistas').state.players[ME].workers).toEqual({ piedra: 2, acero: 2, mana: 3 });
  },
  'torre-vigia': () => {
    let { state } = play('torre-vigia', { keepTurn: false });
    expect(state.players[ME].keep).toBe(62);
    expect(state.players[OPP].handRevealed).toBe(true);
    // It lasts through the opponent's turn and ends when mine starts.
    expect(state.active).toBe(OPP);
    state = pass(state);
    expect(state.active).toBe(ME);
    expect(state.players[OPP].handRevealed).toBe(false);
  },
  contrafuertes: () => {
    let { state } = play('contrafuertes', { keepTurn: false });
    expect(state.players[ME].enchantments).toEqual([{ cardId: 'contrafuertes', turnsLeft: 0, charges: 4, fresh: false }]);
    // Each attack that hits my Wall deals 3 less (13 -> 10) and spends a charge.
    setHand(state, OPP, ['carga-de-lanceros', 'saetas-negras']);
    state.actionsLeft = 2;
    state = playCard(state, 'carga-de-lanceros').state;
    expect(state.players[ME].wall).toBe(5);
    expect(state.players[ME].enchantments[0]!.charges).toBe(3);
    // Piercing damage does not touch the Wall, so it is not reduced and spends nothing.
    state = playCard(state, 'saetas-negras').state;
    expect(state.players[ME].keep).toBe(40);
    expect(state.players[ME].enchantments[0]!.charges).toBe(3);
    // The last charge goes with the next attack on the Wall, which is still reduced.
    const again = play('contrafuertes', { keepTurn: false }).state;
    again.players[ME].enchantments[0]!.charges = 1;
    setHand(again, OPP, ['carga-de-lanceros']);
    const last = playCard(again, 'carga-de-lanceros');
    expect(last.state.players[ME].wall).toBe(5);
    expect(last.state.players[ME].enchantments).toEqual([]);
    expect(eventsOf(last.events, 'enchantmentRemoved')[0]).toMatchObject({ cardId: 'contrafuertes', reason: 'spent' });
  },
  'fortaleza-viva': () => {
    // No battle event in the way: one landing on turn 9 would change the Keep.
    let { state } = play('fortaleza-viva', { keepTurn: false, rules: { eventEveryTurns: 1000 } });
    expect(state.players[ME].keep).toBe(50);
    // +5 Keep at the start of each of my next 5 turns, then it expires.
    for (let i = 1; i <= 5; i++) {
      state = pass(state);
      expect(state.active).toBe(ME);
      expect(state.players[ME].keep).toBe(50 + 5 * i);
      state = pass(state);
    }
    expect(state.players[ME].enchantments).toEqual([]);
    state = pass(state);
    expect(state.players[ME].keep).toBe(75);
  },
  'puente-levadizo': () => {
    let { state } = play('puente-levadizo', { keepTurn: false, rules: { eventEveryTurns: 1000 } });
    expect(state.players[ME].wall).toBe(23);
    expect(state.players[ME].drawbridge).toBe(true);
    // It stays up over turns until a piercing attack comes.
    state = pass(pass(state));
    expect(state.players[ME].drawbridge).toBe(true);
    // The next piercing attack is treated as normal damage and lowers it.
    setHand(state, OPP, ['saetas-negras', 'saetas-negras']);
    state.actionsLeft = 2;
    const first = playCard(state, 'saetas-negras');
    expect(first.state.players[ME].wall).toBe(13);
    expect(first.state.players[ME].keep).toBe(50);
    expect(first.state.players[ME].drawbridge).toBe(false);
    expect(first.events.some((e) => e.type === 'drawbridgeLowered')).toBe(true);
    // The one after goes straight to the Keep again.
    state = playCard(first.state, 'saetas-negras').state;
    expect(state.players[ME].wall).toBe(13);
    expect(state.players[ME].keep).toBe(40);
  },
  'maestro-de-obras': () => {
    const { state } = play('maestro-de-obras');
    expect(state.players[ME].workers.piedra).toBe(3);
    expect(state.players[ME].wall).toBe(25);
  },
  'bastion-ciclopeo': () => {
    expect(play('bastion-ciclopeo').state.players[ME].wall).toBe(52);
  },
  'gremios-unidos': () => {
    const { state } = play('gremios-unidos');
    expect(state.players[ME].workers).toEqual({ piedra: 3, acero: 3, mana: 3 });
    expect(state.players[ME].resources.piedra).toBe(38);
  },
  'aguja-celeste': () => {
    expect(play('aguja-celeste').state.players[ME].keep).toBe(83);
  },
  'ciudadela-eterna': () => {
    const { state } = play('ciudadela-eterna', {
      you: { burn: 3, frost: { piedra: 2, acero: 0, mana: 1 } },
    });
    expect(state.players[ME].keep).toBe(83);
    expect(state.players[ME].wall).toBe(40);
    expect(state.players[ME].burn).toBe(0);
    expect(state.players[ME].frost).toEqual({ piedra: 0, acero: 0, mana: 0 });
  },

  // ----- Asalto ------------------------------------------------------------
  escaramuza: () => {
    const { state } = play('escaramuza');
    expect(state.players[OPP].wall).toBe(10);
    expect(state.players[ME].resources.acero).toBe(49);
  },
  'carga-de-lanceros': () => {
    expect(play('carga-de-lanceros').state.players[OPP].wall).toBe(2);
  },
  'doble-salva': () => {
    const { state, events } = play('doble-salva');
    expect(state.players[OPP].wall).toBe(5);
    expect(eventsOf(events, 'damage')).toHaveLength(2);
    // Two separate hits: a Shield only stops the first.
    const shielded = play('doble-salva', { opponent: { shield: 1 } });
    expect(shielded.state.players[OPP].wall).toBe(10);
    expect(shielded.state.players[OPP].shield).toBe(0);
  },
  'saetas-negras': () => {
    const { state } = play('saetas-negras');
    expect(state.players[OPP].wall).toBe(15);
    expect(state.players[OPP].keep).toBe(40);
  },
  'ariete-de-hierro': () => {
    // 10 damage, each point removes 2 Wall: five points bring down a Wall of 10.
    const full = play('ariete-de-hierro', { opponent: { wall: 10 } }).state.players[OPP];
    expect([full.wall, full.keep]).toEqual([0, 45]);
    // Wall 4: two points bring it down, the other eight reach the Keep.
    const low = play('ariete-de-hierro', { opponent: { wall: 4 } }).state.players[OPP];
    expect([low.wall, low.keep]).toEqual([0, 42]);
    // An odd Wall takes a whole point for its last stone: 8 for a Wall of 15.
    const odd = play('ariete-de-hierro').state.players[OPP];
    expect([odd.wall, odd.keep]).toEqual([0, 48]);
    const none = play('ariete-de-hierro', { opponent: { wall: 0 } }).state.players[OPP];
    expect(none.keep).toBe(40);
  },
  'leva-de-herreros': () => {
    expect(play('leva-de-herreros').state.players[ME].workers.acero).toBe(3);
  },
  'saqueo-nocturno': () => {
    // Steals from the opponent's biggest stockpile.
    const { state } = play('saqueo-nocturno', {
      opponent: { resources: { piedra: 3, acero: 5, mana: 9 } },
    });
    expect(state.players[OPP].resources).toEqual({ piedra: 3, acero: 5, mana: 4 });
    expect(state.players[ME].resources.mana).toBe(55);
    // It cannot steal more than there is.
    const poor = play('saqueo-nocturno', { opponent: { resources: { piedra: 1, acero: 2, mana: 0 } } });
    expect(poor.state.players[OPP].resources.acero).toBe(0);
    expect(poor.state.players[ME].resources.acero).toBe(50 - 4 + 2);
  },
  'carga-de-caballeria': () => {
    const target = play('carga-de-caballeria', { opponent: { wall: 4 } }).state.players[OPP];
    expect([target.wall, target.keep]).toEqual([0, 32]);
  },
  hostigamiento: () => {
    expect(play('hostigamiento').state.players[OPP].wall).toBe(8);
    expect(play('hostigamiento', { you: { comboSchool: 'asalto' } }).state.players[OPP].wall).toBe(0);
  },
  zapadores: () => {
    expect(play('zapadores').state.players[OPP].wall).toBe(2);
    // Wall only: nothing carries over to the Keep.
    const low = play('zapadores', { opponent: { wall: 3 } }).state.players[OPP];
    expect([low.wall, low.keep]).toEqual([0, 50]);
  },
  catapulta: () => {
    const target = play('catapulta').state.players[OPP];
    expect([target.wall, target.keep]).toEqual([0, 40]);
  },
  'balista-de-asedio': () => {
    const target = play('balista-de-asedio').state.players[OPP];
    expect([target.wall, target.keep]).toEqual([15, 35]);
  },
  'espia-en-la-corte': () => {
    const opponentHand = ['escaramuza', 'trabuquete-colosal', 'parapeto'];
    let { state } = play('espia-en-la-corte', { opponentHand });
    // I get to see the hand, then pick; the default is the most expensive card.
    expect(state.phase).toBe('choice');
    expect(state.pending!.kind).toBe('discardFromHand');
    expect(state.pending!.revealed!.map((c) => c.cardId)).toEqual(opponentHand);
    const uidOf = (id: string): string => String(state.players[OPP].hand.find((c) => c.cardId === id)!.uid);
    expect(state.pending!.options).toEqual([uidOf('trabuquete-colosal'), uidOf('parapeto'), uidOf('escaramuza')]);
    state = choose(state, uidOf('parapeto')).state;
    expect(state.players[OPP].hand.map((c) => c.cardId)).toEqual(['escaramuza', 'trabuquete-colosal']);
    expect(state.players[OPP].discard).toContain('parapeto');
    expect(state.phase).toBe('action');
    // With a single card there is nothing to choose.
    const single = play('espia-en-la-corte', { opponentHand: ['parapeto'] });
    expect(single.state.pending).toBeNull();
    expect(single.state.players[OPP].hand).toEqual([]);
  },
  sabotaje: () => {
    // The enchantment goes first, so Buttresses no longer reduce the damage.
    const one = play('sabotaje', {
      opponent: { enchantments: [{ cardId: 'contrafuertes', turnsLeft: 3, fresh: false }] },
    });
    expect(one.state.players[OPP].enchantments).toEqual([]);
    expect(one.state.players[OPP].wall).toBe(7);
    // With two enchantments I choose which one.
    let { state } = play('sabotaje', {
      opponent: {
        enchantments: [
          { cardId: 'contrafuertes', turnsLeft: 1, fresh: false },
          { cardId: 'fortaleza-viva', turnsLeft: 4, fresh: false },
        ],
      },
    });
    expect(state.pending!.options).toEqual(['fortaleza-viva', 'contrafuertes']);
    state = choose(state, 'fortaleza-viva').state;
    expect(state.players[OPP].enchantments.map((e) => e.cardId)).toEqual(['contrafuertes']);
    expect(state.players[OPP].wall).toBe(10);
    // Without enchantments it is just 8 damage.
    expect(play('sabotaje').state.players[OPP].wall).toBe(7);
  },
  'estandarte-de-guerra': () => {
    let state = scenario({ hand: ['estandarte-de-guerra', 'escaramuza', 'doble-salva', 'escaramuza', 'escaramuza'] });
    state.actionsLeft = 5;
    state = playCard(state, 'estandarte-de-guerra').state;
    expect(state.players[ME].enchantments[0]).toMatchObject({ cardId: 'estandarte-de-guerra', charges: 4 });
    // +3 on every hit, and every hit spends a charge.
    state = playCard(state, 'escaramuza').state;
    expect(state.players[OPP].wall).toBe(7);
    state = playCard(state, 'doble-salva').state;
    expect(state.players[OPP].wall).toBe(0);
    expect(state.players[OPP].keep).toBe(41);
    expect(state.players[ME].enchantments[0]!.charges).toBe(1);
    // The fourth attack still gets +3 and uses it up; the fifth deals the printed 5.
    state = playCard(state, 'escaramuza').state;
    expect(state.players[OPP].keep).toBe(33);
    expect(state.players[ME].enchantments).toEqual([]);
    state = playCard(state, 'escaramuza').state;
    expect(state.players[OPP].keep).toBe(28);
  },
  emboscada: () => {
    expect(play('emboscada').state.players[OPP].wall).toBe(5);
    const punished = play('emboscada', { opponent: { schoolsLastTurn: ['construccion'] } }).state.players[OPP];
    expect([punished.wall, punished.keep]).toEqual([0, 45]);
    expect(play('emboscada', { opponent: { schoolsLastTurn: ['arcano'] } }).state.players[OPP].wall).toBe(5);
  },
  'trabuquete-colosal': () => {
    const target = play('trabuquete-colosal').state.players[OPP];
    expect([target.wall, target.keep]).toEqual([0, 28]);
  },
  motin: () => {
    const { state } = play('motin', { opponent: { workers: { piedra: 2, acero: 4, mana: 3 } } });
    expect(state.players[OPP].workers).toEqual({ piedra: 2, acero: 3, mana: 3 });
    // Nobody drops below 1 worker.
    const floor = play('motin', { opponent: { workers: { piedra: 1, acero: 1, mana: 1 } } });
    expect(floor.state.players[OPP].workers).toEqual({ piedra: 1, acero: 1, mana: 1 });
  },
  'torre-de-asedio': () => {
    const target = play('torre-de-asedio').state.players[OPP];
    expect([target.wall, target.keep]).toEqual([5, 33]);
  },
  'hueste-imparable': () => {
    const { state, events } = play('hueste-imparable');
    expect([state.players[OPP].wall, state.players[OPP].keep]).toEqual([0, 25]);
    expect(eventsOf(events, 'damage').map((e) => e.kind)).toEqual(['normal', 'piercing']);
  },

  // ----- Arcano ------------------------------------------------------------
  'chispa-arcana': () => {
    const target = play('chispa-arcana').state.players[OPP];
    expect([target.wall, target.keep]).toEqual([15, 45]);
  },
  'lluvia-de-ascuas': () => {
    // No battle event in the way: one landing on turn 9 would change the Wall.
    let { state } = play('lluvia-de-ascuas', { keepTurn: false, rules: { eventEveryTurns: 1000 } });
    // Burn ticks at the start of the burned player's turn: 4 turns, 3 damage each.
    expect(state.active).toBe(OPP);
    expect(state.players[OPP].wall).toBe(12);
    expect(state.players[OPP].burn).toBe(3);
    state = pass(pass(state));
    expect(state.players[OPP].wall).toBe(9);
    state = pass(pass(state));
    expect(state.players[OPP].wall).toBe(6);
    state = pass(pass(state));
    expect(state.players[OPP].wall).toBe(3);
    expect(state.players[OPP].burn).toBe(0);
    state = pass(pass(state));
    expect(state.players[OPP].wall).toBe(3);
  },
  'egida-lunar': () => {
    let { state } = play('egida-lunar', { keepTurn: false });
    expect(state.players[ME].shield).toBe(1);
    setHand(state, OPP, ['trabuquete-colosal']);
    const result = playCard(state, 'trabuquete-colosal');
    state = result.state;
    expect(eventsOf(result.events, 'damage')[0]).toMatchObject({ blocked: true, wallLoss: 0, keepLoss: 0 });
    expect([state.players[ME].wall, state.players[ME].keep, state.players[ME].shield]).toEqual([15, 50, 0]);
  },
  'aliento-de-escarcha': () => {
    let { state } = play('aliento-de-escarcha', {
      keepTurn: false,
      opponent: { workers: { piedra: 2, acero: 4, mana: 3 } },
    });
    // I choose the resource; the default is the one with the most workers.
    expect(state.pending!.kind).toBe('frostResource');
    expect(state.pending!.options).toEqual(['acero', 'mana', 'piedra']);
    const result = choose(state, 'mana');
    state = result.state;
    // The opponent's turn starts: mana does not produce, for 2 turns.
    expect(eventsOf(result.events, 'produced')[0]).toMatchObject({ player: OPP, frozen: ['mana'] });
    expect(state.players[OPP].resources).toEqual({ piedra: 52, acero: 54, mana: 50 });
    state = pass(pass(state));
    expect(state.players[OPP].resources.mana).toBe(50);
    state = pass(pass(state));
    expect(state.players[OPP].resources.mana).toBe(53);
  },
  'circulo-de-estudio': () => {
    expect(play('circulo-de-estudio').state.players[ME].workers.mana).toBe(3);
  },
  transmutacion: () => {
    const { state } = play('transmutacion');
    expect(state.players[ME].resources).toEqual({ piedra: 53, acero: 53, mana: 48 });
  },
  'ojo-del-augur': () => {
    const before = scenario({ hand: ['ojo-del-augur', 'escaramuza', 'parapeto'], keepTurn: false });
    const oldUids = before.players[ME].hand.map((c) => c.uid);
    const { state, events } = playCard(before, 'ojo-del-augur');
    // A whole new hand, and I still get to play a card this turn.
    expect(state.players[ME].hand).toHaveLength(6);
    expect(state.players[ME].hand.some((c) => oldUids.includes(c.uid))).toBe(false);
    expect(eventsOf(events, 'handRedrawn')[0]!.count).toBe(2);
    expect(state.active).toBe(ME);
    expect(state.phase).toBe('action');
    expect(state.actionsLeft).toBe(1);
  },
  'brote-de-cristal': () => {
    expect(play('brote-de-cristal').state.players[ME].keep).toBe(60);
  },
  drenaje: () => {
    const { state } = play('drenaje', { opponent: { resources: { piedra: 10, acero: 3, mana: 1 } } });
    expect(state.players[OPP].resources).toEqual({ piedra: 7, acero: 0, mana: 0 });
  },
  purificacion: () => {
    const { state } = play('purificacion', { you: { burn: 4, frost: { piedra: 1, acero: 1, mana: 1 } } });
    expect(state.players[ME].burn).toBe(0);
    expect(state.players[ME].frost).toEqual({ piedra: 0, acero: 0, mana: 0 });
    expect(state.players[ME].keep).toBe(55);
  },
  'trueque-de-destinos': () => {
    const { state } = play('trueque-de-destinos', { you: { wall: 2 }, opponent: { wall: 31 } });
    expect(state.players[ME].wall).toBe(31);
    expect(state.players[OPP].wall).toBe(2);
  },
  espejismo: () => {
    // Copies the effect of the opponent's last card.
    const copy = play('espejismo', { opponent: { lastPlayedCard: 'catapulta' } });
    expect([copy.state.players[OPP].wall, copy.state.players[OPP].keep]).toEqual([0, 40]);
    expect(copy.state.players[ME].resources).toEqual({ piedra: 50, acero: 50, mana: 44 });
    expect(copy.state.players[ME].lastPlayedCard).toBe('catapulta');
    // A copied enchantment is mine and keeps its own name.
    const enchant = play('espejismo', { opponent: { lastPlayedCard: 'fortaleza-viva' } });
    expect(enchant.state.players[ME].enchantments[0]).toMatchObject({ cardId: 'fortaleza-viva', turnsLeft: 5 });
    // Copied cards that need a decision ask for it.
    const frost = play('espejismo', { opponent: { lastPlayedCard: 'aliento-de-escarcha' } });
    expect(frost.state.pending!.kind).toBe('frostResource');
    // With nothing to copy it cannot be played.
    const empty = scenario({ hand: ['espejismo'] });
    expect(playBlocker(empty, ME, 'espejismo')!.code).toBe('nothingToCopy');
    expect(legalActions(empty).some((a) => a.type === 'play')).toBe(false);
  },
  'maldicion-de-oxido': () => {
    let { state } = play('maldicion-de-oxido', { keepTurn: false });
    expect(state.players[ME].enchantments[0]).toMatchObject({ cardId: 'maldicion-de-oxido', turnsLeft: 3 });
    // The opponent's Assault cards cost 2 more; other schools and my own cards do not change.
    expect(effectiveCost(state, OPP, 'escaramuza')).toBe(3);
    expect(effectiveCost(state, OPP, 'parapeto')).toBe(4);
    expect(effectiveCost(state, ME, 'escaramuza')).toBe(1);
    setHand(state, OPP, ['escaramuza']);
    state = playCard(state, 'escaramuza').state;
    expect(state.players[OPP].resources.acero).toBe(52 - 3);
  },
  'manantial-de-mana': () => {
    let { state } = play('manantial-de-mana', { keepTurn: false });
    const base = { ...state.players[ME].resources };
    // +2 of each resource at the start of my next 4 turns, on top of production.
    for (let i = 1; i <= 5; i++) {
      state = pass(pass(state));
      const bonus = 2 * Math.min(i, 4);
      expect(state.players[ME].resources).toEqual({
        piedra: base.piedra + 2 * i + bonus,
        acero: base.acero + 2 * i + bonus,
        mana: base.mana + 2 * i + bonus,
      });
    }
    expect(state.players[ME].enchantments).toEqual([]);
  },
  'rayo-bifurcado': () => {
    const target = play('rayo-bifurcado').state.players[OPP];
    expect([target.wall, target.keep]).toEqual([5, 40]);
  },
  disipar: () => {
    const { state } = play('disipar', {
      opponent: { enchantments: [{ cardId: 'estandarte-de-guerra', turnsLeft: 2, fresh: false }] },
    });
    expect(state.players[OPP].enchantments).toEqual([]);
    expect(state.players[ME].resources.mana).toBe(50 - 3 + 2);
    // The mana comes back even with nothing to destroy.
    expect(play('disipar').state.players[ME].resources.mana).toBe(49);
  },
  'tormenta-de-ceniza': () => {
    const { state } = play('tormenta-de-ceniza');
    expect(state.players[OPP].wall).toBe(0);
    expect(state.players[OPP].burn).toBe(4);
  },
  'prision-de-hielo': () => {
    const result = play('prision-de-hielo', { keepTurn: false });
    const state = result.state;
    // No resource produces on the opponent's next turn, and they lose a card.
    expect(eventsOf(result.events, 'produced')[0]).toMatchObject({
      player: OPP,
      gained: { piedra: 0, acero: 0, mana: 0 },
    });
    expect(state.players[OPP].resources).toEqual({ piedra: 50, acero: 50, mana: 50 });
    expect(state.players[OPP].frost).toEqual({ piedra: 0, acero: 0, mana: 0 });
    expect(state.players[OPP].hand).toHaveLength(5);
    expect(eventsOf(result.events, 'cardDiscarded')[0]).toMatchObject({ player: OPP, reason: 'effect' });
  },
  'reloj-de-arena': () => {
    const result = play('reloj-de-arena', { keepTurn: false });
    let state = result.state;
    // I play again right away, then the turn passes as usual.
    expect(state.active).toBe(ME);
    expect(state.turn).toBe(2);
    expect(state.extraTurn).toBe(true);
    expect(eventsOf(result.events, 'turnStarted')[0]).toMatchObject({ player: ME, extraTurn: true });
    // The extra turn starts like any other: the workers produce again.
    const produced = eventsOf(result.events, 'produced');
    expect(produced).toHaveLength(1);
    expect(produced[0]).toMatchObject({ player: ME, gained: state.players[ME].workers });
    state = pass(state);
    expect(state.active).toBe(OPP);
    expect(state.extraTurn).toBe(false);
  },
  'cometa-del-ocaso': () => {
    const target = play('cometa-del-ocaso').state.players[OPP];
    expect([target.wall, target.keep]).toEqual([0, 33]);
  },

  // ----- Descartes ---------------------------------------------------------
  'escombros-utiles': () => {
    let { state } = playCard(scenario({ hand: ['escombros-utiles', 'escaramuza', 'parapeto', 'catapulta'] }), 'escombros-utiles');
    // Up to three discards, one at a time; stopping early is the default.
    expect(state.pending!.kind).toBe('discardOwn');
    expect(state.pending!.options[0]).toBe('done');
    expect(state.pending!.progress).toEqual({ done: 0, left: 3 });
    state = choose(state, uidOf(state, 'escaramuza')).state;
    expect(state.pending!.progress).toEqual({ done: 1, left: 2 });
    state = choose(state, uidOf(state, 'parapeto')).state;
    state = choose(state, 'done').state;
    expect(state.phase).toBe('action');
    expect(state.players[ME].wall).toBe(23);
    expect(state.players[ME].hand.map((c) => c.cardId)).toEqual(['catapulta']);
    expect(state.players[ME].discard).toEqual(expect.arrayContaining(['escaramuza', 'parapeto']));
    // Discarding nothing builds nothing.
    const none = choose(playCard(scenario({ hand: ['escombros-utiles', 'escaramuza'] }), 'escombros-utiles').state, 'done');
    expect(none.state.players[ME].wall).toBe(15);
    expect(eventsOf(none.events, 'built')).toEqual([]);
  },
  'planos-revisados': () => {
    let { state } = playCard(scenario({ hand: ['planos-revisados', 'escaramuza', 'parapeto'] }), 'planos-revisados');
    // The discard is mandatory: no "done", the cheapest card is the default.
    expect(state.pending!.options).toEqual([uidOf(state, 'escaramuza'), uidOf(state, 'parapeto')]);
    const result = choose(state, uidOf(state, 'escaramuza'));
    state = result.state;
    expect(state.players[ME].hand).toHaveLength(3);
    expect(eventsOf(result.events, 'cardsDrawn')[0]!.cards).toHaveLength(2);
    expect(state.actionsLeft).toBe(2);
    expect(state.active).toBe(ME);
  },
  'sillares-reciclados': () => {
    let { state } = playCard(scenario({ hand: ['sillares-reciclados', 'escaramuza', 'parapeto', 'catapulta'] }), 'sillares-reciclados');
    for (const id of ['escaramuza', 'parapeto', 'catapulta']) state = choose(state, uidOf(state, id)).state;
    // After the third card the effect stops asking.
    expect(state.pending).toBeNull();
    expect(state.players[ME].keep).toBe(62);
  },
  'tierra-quemada': () => {
    let { state, events } = playCard(scenario({ hand: ['tierra-quemada', 'escaramuza', 'parapeto', 'catapulta'] }), 'tierra-quemada');
    state = choose(state, uidOf(state, 'escaramuza')).state;
    const result = choose(state, uidOf(state, 'parapeto'));
    state = choose(result.state, 'done').state;
    // One hit of 8, not two of 4.
    expect(state.players[OPP].wall).toBe(7);
    expect(eventsOf(events, 'damage')).toEqual([]);
  },
  'relevo-de-tropas': () => {
    let { state } = playCard(scenario({ hand: ['relevo-de-tropas', 'escaramuza', 'parapeto'] }), 'relevo-de-tropas');
    expect(state.players[OPP].wall).toBe(10);
    state = choose(state, uidOf(state, 'parapeto')).state;
    expect(state.players[ME].hand.map((c) => c.cardId)).toContain('escaramuza');
    expect(state.players[ME].hand).toHaveLength(2);
    expect(state.actionsLeft).toBe(2);
    // With a single card left the discard needs no choice.
    const single = play('relevo-de-tropas');
    expect(single.state.pending).toBeNull();
    expect(single.state.players[ME].discard).toContain('cimientos');
  },
  'todo-o-nada': () => {
    const { state, events } = playCard(
      scenario({ hand: ['todo-o-nada', 'escaramuza', 'parapeto', 'catapulta', 'cimientos'], keepTurn: false }),
      'todo-o-nada',
    );
    // Four cards gone with no choice, 24 damage in one hit, and the turn ends.
    expect(eventsOf(events, 'cardDiscarded')).toHaveLength(4);
    expect(eventsOf(events, 'choiceRequested')).toEqual([]);
    const hits = eventsOf(events, 'damage').filter((e) => e.target === OPP);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.wallLoss + hits[0]!.keepLoss).toBe(24);
    expect(state.active).toBe(OPP);
    // The hand stays empty until my next turn starts.
    expect(state.players[ME].hand).toHaveLength(0);
  },
  'ofrenda-arcana': () => {
    let { state } = playCard(scenario({ hand: ['ofrenda-arcana', 'escaramuza', 'parapeto', 'catapulta'] }), 'ofrenda-arcana');
    expect(state.pending!.options).not.toContain('done');
    state = choose(state, uidOf(state, 'escaramuza')).state;
    // The second discard is not optional either.
    expect(state.pending!.options).not.toContain('done');
    state = choose(state, uidOf(state, 'catapulta')).state;
    expect(state.phase).toBe('action');
    expect(state.players[ME].hand).toHaveLength(2);
    expect(state.players[ME].hand[0]!.cardId).toBe('parapeto');
    expect(state.actionsLeft).toBe(2);
    expect(state.players[ME].resources.mana).toBe(49);
  },
  'grimorio-en-llamas': () => {
    let { state } = playCard(scenario({ hand: ['grimorio-en-llamas', 'escaramuza', 'parapeto', 'catapulta'] }), 'grimorio-en-llamas');
    for (const id of ['escaramuza', 'parapeto', 'catapulta']) state = choose(state, uidOf(state, id)).state;
    expect(state.players[OPP].wall).toBe(15);
    expect(state.players[OPP].keep).toBe(38);
  },
  'quema-de-pergaminos': () => {
    const { state } = play('quema-de-pergaminos', { opponentHand: ['escaramuza', 'parapeto', 'catapulta'] });
    expect(state.players[OPP].hand).toHaveLength(1);
    expect(state.players[OPP].discard).toHaveLength(2);
    expect(state.players[OPP].keep).toBe(44);
  },
};

describe('cards', () => {
  it('has a test for every card and no stale tests', () => {
    expect(Object.keys(CARD_TESTS).sort()).toEqual(CARDS.map((c) => c.id).sort());
  });

  for (const card of CARDS) {
    it(`${card.id} (${card.name.en})`, () => {
      const test = CARD_TESTS[card.id];
      expect(test, `no test for ${card.id}`).toBeTypeOf('function');
      test!();
    });
  }

  it('every card pays its cost in the resource of its school and goes to the discard pile', () => {
    const resourceOf = { construccion: 'piedra', asalto: 'acero', arcano: 'mana' } as const;
    for (const card of CARDS) {
      const start = scenario({ hand: [card.id], opponent: { lastPlayedCard: 'parapeto' } });
      const uid = start.players[ME].hand[0]!.uid;
      const result = applyAction(start, { type: 'play', player: ME, uid });
      expect(result.ok, card.id).toBe(true);
      if (!result.ok) continue;
      const played = eventsOf(result.events, 'cardPlayed')[0]!;
      expect(played).toMatchObject({ cardId: card.id, cost: card.cost, resource: resourceOf[card.school] });
      expect(getCard(card.id).cost).toBe(card.cost);
      expect(result.state.players[ME].hand.some((c) => c.uid === uid)).toBe(false);
    }
  });

  it('a card that costs more than you have cannot be played', () => {
    for (const card of CARDS.filter((c) => c.cost > 0)) {
      const state = scenario({ hand: [card.id], resources: card.cost - 1, opponent: { lastPlayedCard: 'parapeto' } });
      const result = applyAction(state, { type: 'play', player: ME, uid: state.players[ME].hand[0]!.uid });
      expect(result.ok, card.id).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('cannotAfford');
    }
  });
});
