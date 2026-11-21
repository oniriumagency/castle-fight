import { DEFAULT_RULES, buildDeckList, isCardId, isHeroId } from './catalog';
import { drawCards, emptyResources, heroPassiveFor } from './core';
import { hashSeed, randomInt, shuffle } from './rng';
import { rollBattleEvent, startTurn } from './turn';
import type { CardId, GameEvent, GameState, HeroId, PlayerId, PlayerState, Rules } from './types';

export interface GameOptions {
  /** Same seed + same actions = same game. Use an unpredictable value online. */
  seed: number | string;
  /** Hero of each player, by seat: 2 heroes for a duel, 3 for the free-for-all prototype. */
  heroes: HeroId[];
  /** Who takes the first turn. Random (from the seed) when omitted. */
  firstPlayer?: PlayerId;
  /** Overrides for the default rules, mainly for balance simulations and tests. */
  rules?: Partial<Rules>;
  /** Per-seat options, mainly for the campaign. Missing entries play as usual. */
  seats?: (SeatOptions | undefined)[];
}

/** How one seat differs from a normal game (campaign battles). */
export interface SeatOptions {
  /** The cards this seat's deck is built from, copies included. Default: the common deck. */
  deck?: readonly CardId[];
  /** Play without the hero's passive (campaign captains). */
  noPassive?: boolean;
  /** No ultimate this game: it neither charges nor can be used. */
  ultimateLocked?: boolean;
}

function createPlayer(state: GameState, hero: HeroId, multiplayer: boolean, seat: SeatOptions = {}): PlayerState {
  const rules = state.rules;
  const passive = seat.noPassive ? {} : heroPassiveFor(hero, multiplayer);
  const deckList = seat.deck ? seat.deck.slice().sort() : null;
  return {
    hero,
    ...(seat.noPassive ? { noPassive: true } : {}),
    ...(seat.ultimateLocked ? { ultimateLocked: true } : {}),
    ...(deckList ? { deckList } : {}),
    keep: rules.keepStart,
    wall: rules.wallStart + (passive.startingWallBonus ?? 0),
    resources: emptyResources(rules.resourceStart),
    workers: emptyResources(rules.workerStart),
    hand: [],
    deck: shuffle(state, deckList ? deckList.slice() : buildDeckList(rules)),
    discard: [],
    enchantments: [],
    burn: 0,
    frost: emptyResources(),
    rust: 0,
    shield: 0,
    drawbridge: false,
    handRevealed: false,
    ultimateCharge: 0,
    ultimateUses: 0,
    extraTurns: 0,
    lastPlayedCard: null,
    comboSchool: null,
    schoolsThisTurn: [],
    schoolsLastTurn: [],
  };
}

/**
 * Create a new game and start the first turn. Throws on invalid options
 * (unknown hero), since that is a programming error rather than a player move.
 */
export function createGame(options: GameOptions): { state: GameState; events: GameEvent[] } {
  if (options.heroes.length < 2 || options.heroes.length > 4) throw new Error('A game needs 2 to 4 players');
  for (const hero of options.heroes) {
    if (!isHeroId(hero)) throw new Error(`Unknown hero "${hero}"`);
  }
  for (const seat of options.seats ?? []) {
    if (!seat?.deck) continue;
    if (seat.deck.length < 12) throw new Error('A custom deck needs at least 12 cards');
    for (const cardId of seat.deck) if (!isCardId(cardId)) throw new Error(`Unknown card "${cardId}"`);
  }
  const rules: Rules = {
    ...DEFAULT_RULES,
    ...options.rules,
    deckCopies: { ...DEFAULT_RULES.deckCopies, ...options.rules?.deckCopies },
  };

  const state = {
    version: 1,
    rules,
    rng: hashSeed(options.seed),
    seq: 0,
    turn: 0,
    active: 0,
    phase: 'action',
    actionsLeft: 0,
    extraTurn: false,
    pending: null,
    activeEvent: null,
    upcomingEvent: { id: '', round: rules.eventEveryRounds + 1 },
    nextUid: 1,
    result: null,
  } as unknown as GameState;

  const n = options.heroes.length;
  state.players = options.heroes.map((hero, i) => createPlayer(state, hero, options.heroes.length > 2, options.seats?.[i]));
  state.upcomingEvent.id = rollBattleEvent(state, null);
  const firstPlayer = options.firstPlayer ?? (randomInt(state, n) as PlayerId);
  // Moving later costs tempo; a slightly taller Wall makes up for it (more for each seat further back).
  // With 3+ players the tempo matters less, so the step is smaller (balance sims: 33/32/34% with +3/+6).
  const seatWall = n > 2 ? rules.multiSeatWall : rules.secondPlayerWall;
  for (let seat = 1; seat < n; seat++) {
    state.players[(firstPlayer + seat) % n]!.wall += seatWall * seat;
  }

  const events: GameEvent[] = [
    { type: 'gameStarted', firstPlayer, heroes: options.heroes.slice() },
    { type: 'battleEventForecast', eventId: state.upcomingEvent.id, round: state.upcomingEvent.round },
  ];
  for (let p = 0; p < n; p++) drawCards(state, events, p, rules.handSize);
  startTurn(state, events, firstPlayer, false);
  return { state, events };
}
