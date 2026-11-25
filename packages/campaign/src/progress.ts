import { CARDS, DEFAULT_RULES, getCard, isCardId, isHeroId } from '@cardcraft-castles/engine';
import type { BattleEventId, CardId, HeroId, Rules, SeatOptions } from '@cardcraft-castles/engine';
import {
  FINAL_RIVALS,
  RIVAL_KINGDOMS,
  STARTING_CARDS,
  STARTING_HERO,
  TERRITORIES,
  getKingdom,
  getTerrain,
  getTerritory,
  isTerritoryId,
  neighboursOf,
  type KingdomId,
  type Territory,
} from './data';

/**
 * The player's progress through the campaign and the pure rules that move
 * it on: which territories can be attacked, how each battle is set up, and
 * what winning or losing it does. Nothing here touches storage or the
 * screen, so the client, the tests and the simulations share it.
 */

export type CampaignDifficulty = 'historia' | 'normal' | 'dificil';
export const CAMPAIGN_DIFFICULTIES: readonly CampaignDifficulty[] = ['historia', 'normal', 'dificil'];

export interface CampaignSave {
  v: typeof CAMPAIGN_VERSION;
  difficulty: CampaignDifficulty;
  /** Territories the player holds, in the order they were taken (Valdepiedra first). */
  conquered: string[];
  /** Cards unlocked: each one comes with the usual copies for its rarity. */
  unlocked: CardId[];
  /** Copies taken by a territory after a defeat there (one entry per copy), won back by conquering it. */
  held: Record<string, CardId[]>;
  /** Heroes the player can lead into battle: the Architect and every hero defeated in their castle. */
  allies: HeroId[];
  /** Hero picked for the last battle (preselected next time). */
  hero: HeroId;
  /** Scenes and dialogues already shown. */
  seen: string[];
  /** The battle being played, so its result is applied once even after a reload. */
  pending: { id: string; territory: string; hero: HeroId } | null;
  wins: number;
  losses: number;
  finished: boolean;
  startedAt: number;
  /**
   * Progress this version of the game does not know (a territory, card or hero
   * that was removed or renamed without a `RENAMED` entry). It is kept aside
   * instead of being thrown away, and comes back on its own as soon as the id
   * exists again or a rename is added. Absent when there is nothing to keep.
   */
  retired?: RetiredProgress;
}

export interface RetiredProgress {
  conquered: string[];
  unlocked: string[];
  allies: string[];
  held: Record<string, string[]>;
}

/**
 * Version of the save format. Bump it only when the shape of `CampaignSave`
 * changes in a way `parseCampaign` cannot read by itself, and add the step
 * from the previous version to `MIGRATIONS`: every save ever written must
 * keep loading after an update.
 */
export const CAMPAIGN_VERSION = 1;

/**
 * Upgrades a save from version `n` to `n + 1`, by key `n`. Saves are run
 * through every step from their own version to `CAMPAIGN_VERSION`.
 */
const MIGRATIONS: Record<number, (save: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Ids renamed since the campaign shipped, old to new. When a territory, card
 * or hero changes its id, add it here so the progress saved under the old one
 * carries over to the new one instead of being set aside.
 */
export const RENAMED: { territories: Record<string, string>; cards: Record<string, string>; heroes: Record<string, string> } = {
  territories: {},
  cards: {},
  heroes: {},
};

/** Minimum deck size a defeat can leave the player with. */
export const MIN_DECK = 48;

export function newCampaign(difficulty: CampaignDifficulty = 'normal', now = Date.now()): CampaignSave {
  return {
    v: CAMPAIGN_VERSION,
    difficulty,
    conquered: ['valdepiedra'],
    unlocked: STARTING_CARDS.slice(),
    held: {},
    allies: [STARTING_HERO],
    hero: STARTING_HERO,
    seen: [],
    pending: null,
    wins: 0,
    losses: 0,
    finished: false,
    startedAt: now,
  };
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Splits ids into those this version knows (renames applied) and those it does not. */
function sortIds<T extends string>(ids: string[], renamed: Record<string, string>, known: (id: string) => id is T): { ok: T[]; unknown: string[] } {
  const ok: T[] = [];
  const unknown: string[] = [];
  for (const raw of ids) {
    const id = renamed[raw] ?? raw;
    if (known(id)) ok.push(id);
    else unknown.push(raw);
  }
  return { ok, unknown };
}

/** Whether a save was written by a newer version of the game than this one (it is never read nor overwritten here). */
export function isFutureCampaign(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && typeof (raw as { v?: unknown }).v === 'number' && (raw as { v: number }).v > CAMPAIGN_VERSION;
}

/**
 * A save read back from storage, brought up to the current version, or null
 * when it is not a campaign at all (or comes from a newer version of the game).
 * Anything this version does not recognise is set aside in `retired`, never lost.
 */
export function parseCampaign(raw: unknown): CampaignSave | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let s = raw as Record<string, unknown>;
  let v = typeof s.v === 'number' ? s.v : 1;
  if (!Number.isInteger(v) || v < 1 || v > CAMPAIGN_VERSION) return null;
  for (; v < CAMPAIGN_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return null;
    s = step(s);
  }
  if (!Array.isArray(s.conquered)) return null;

  const old = (s.retired ?? {}) as Partial<Record<keyof RetiredProgress, unknown>>;
  const isTerritory = (id: string): id is string => isTerritoryId(id);
  const conquered = sortIds(unique([...strings(s.conquered), ...strings(old.conquered)]), RENAMED.territories, isTerritory);
  if (!conquered.ok.includes('valdepiedra')) conquered.ok.unshift('valdepiedra');
  const unlocked = sortIds(unique([...strings(s.unlocked), ...strings(old.unlocked)]), RENAMED.cards, isCardId);
  const allies = sortIds(unique([...strings(s.allies), ...strings(old.allies)]), RENAMED.heroes, isHeroId);
  if (!allies.ok.includes(STARTING_HERO)) allies.ok.unshift(STARTING_HERO);

  const held: Record<string, CardId[]> = {};
  const retiredHeld: Record<string, string[]> = {};
  const heldSources = [s.held, old.held].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
  for (const source of heldSources) {
    for (const [rawTerritory, rawCards] of Object.entries(source)) {
      const territory = RENAMED.territories[rawTerritory] ?? rawTerritory;
      const cards = sortIds(strings(rawCards), RENAMED.cards, isCardId);
      if (isTerritoryId(territory)) {
        if (cards.ok.length) held[territory] = [...(held[territory] ?? []), ...cards.ok];
        if (cards.unknown.length) retiredHeld[territory] = [...(retiredHeld[territory] ?? []), ...cards.unknown];
      } else {
        const all = strings(rawCards);
        if (all.length) retiredHeld[rawTerritory] = [...(retiredHeld[rawTerritory] ?? []), ...all];
      }
    }
  }

  const rename = (id: unknown, map: Record<string, string>): string => (typeof id === 'string' ? (map[id] ?? id) : '');
  const hero = rename(s.hero, RENAMED.heroes);
  const p = s.pending as Record<string, unknown> | null | undefined;
  const pendingTerritory = rename(p?.territory, RENAMED.territories);
  const pendingHero = rename(p?.hero, RENAMED.heroes);
  const pending =
    p && typeof p === 'object' && isTerritoryId(pendingTerritory) && isHeroId(pendingHero) && typeof p.id === 'string'
      ? { id: p.id, territory: pendingTerritory, hero: pendingHero }
      : null;

  const save: CampaignSave = {
    v: CAMPAIGN_VERSION,
    // A difficulty this version does not know plays as normal rather than losing the campaign.
    difficulty: CAMPAIGN_DIFFICULTIES.includes(s.difficulty as CampaignDifficulty) ? (s.difficulty as CampaignDifficulty) : 'normal',
    conquered: conquered.ok,
    unlocked: unlocked.ok,
    held,
    allies: allies.ok,
    hero: allies.ok.includes(hero as HeroId) ? (hero as HeroId) : STARTING_HERO,
    seen: unique(strings(s.seen)),
    pending,
    wins: Number(s.wins) || 0,
    losses: Number(s.losses) || 0,
    finished: !!s.finished,
    startedAt: Number(s.startedAt) || Date.now(),
  };
  if (conquered.unknown.length || unlocked.unknown.length || allies.unknown.length || Object.keys(retiredHeld).length) {
    save.retired = { conquered: conquered.unknown, unlocked: unlocked.unknown, allies: allies.unknown, held: retiredHeld };
  }
  return save;
}

// ---------------------------------------------------------------------------
// Where the player stands
// ---------------------------------------------------------------------------

export function isConquered(save: CampaignSave, territory: string): boolean {
  return save.conquered.includes(territory);
}

/** Rival heroes beaten in their castle. Drives the difficulty and the ultimate. */
export function heroesDefeated(save: CampaignSave): number {
  return RIVAL_KINGDOMS.filter((k) => isConquered(save, `${k}-castillo`)).length;
}

/** The ultimate wakes up after the first hero falls. */
export function ultimateAwake(save: CampaignSave): boolean {
  return heroesDefeated(save) >= 1;
}

/** Territories the player may attack now: next to one they hold (the Crown once all five castles have fallen). */
export function attackable(save: CampaignSave): string[] {
  if (save.finished) return [];
  const out: string[] = [];
  for (const t of TERRITORIES) {
    if (isConquered(save, t.id)) continue;
    if (t.kind === 'final') {
      if (heroesDefeated(save) === RIVAL_KINGDOMS.length) out.push(t.id);
      continue;
    }
    // The hero waits in the castle until all of their captains have fallen.
    if (t.kind === 'castle' && !castleOpen(save, t.kingdom!)) continue;
    if (neighboursOf(t.id).some((n) => isConquered(save, n))) out.push(t.id);
  }
  return out;
}

/**
 * Territories the map shows: those the player holds and those they can attack
 * right now. Everything else stays hidden until it borders the player's land;
 * a hero's castle stays hidden until all four of their captains have fallen,
 * and the Crown until the five castles have. Worked out from the progress
 * alone, so saves need nothing new.
 */
export function visibleTerritories(save: CampaignSave): string[] {
  const open = new Set(attackable(save));
  return TERRITORIES.filter((t) => isConquered(save, t.id) || open.has(t.id)).map((t) => t.id);
}

/** Territories that came into view with the conquest of `territoryId` (what `visibleTerritories` adds compared to before it). */
export function revealedBy(save: CampaignSave, territoryId: string): string[] {
  if (!isConquered(save, territoryId)) return [];
  const before = new Set(visibleTerritories({ ...save, conquered: save.conquered.filter((id) => id !== territoryId), finished: false }));
  return visibleTerritories(save).filter((id) => !before.has(id));
}

/** A kingdom's castle can be challenged only once its four territories are conquered. */
export function castleOpen(save: CampaignSave, kingdom: KingdomId): boolean {
  return TERRITORIES.filter((t) => t.kingdom === kingdom && t.kind === 'territory').every((t) => isConquered(save, t.id));
}

/** Territories conquered in a kingdom (0 to 5). */
export function kingdomProgress(save: CampaignSave, kingdom: KingdomId): number {
  return TERRITORIES.filter((t) => t.kingdom === kingdom && t.kind !== 'home' && isConquered(save, t.id)).length;
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export function copiesOf(cardId: CardId): number {
  return DEFAULT_RULES.deckCopies[getCard(cardId).rarity];
}

/** How many copies of each card the player brings: the rarity's copies minus those held by territories. */
export function collection(save: CampaignSave): Map<CardId, number> {
  const out = new Map<CardId, number>();
  for (const cardId of save.unlocked) out.set(cardId, copiesOf(cardId));
  for (const cards of Object.values(save.held)) {
    for (const cardId of cards) out.set(cardId, Math.max(0, (out.get(cardId) ?? 0) - 1));
  }
  return out;
}

function expand(counts: Map<CardId, number>): CardId[] {
  const deck: CardId[] = [];
  // Catalog order keeps the list stable.
  for (const card of CARDS) for (let i = 0; i < (counts.get(card.id) ?? 0); i++) deck.push(card.id);
  return deck;
}

export function playerDeck(save: CampaignSave): CardId[] {
  return expand(collection(save));
}

/** Rewards of a kingdom's territories up to `territory` (A and B: theirs; C and D: also A and B's; the castle: all). */
function kingdomCardsFor(territory: Territory): CardId[] {
  if (!territory.kingdom) return [];
  const all = TERRITORIES.filter((t) => t.kingdom === territory.kingdom);
  const letter = territory.id.slice(-1);
  const pick =
    territory.kind === 'castle'
      ? all
      : letter === 'a' || letter === 'b'
        ? all.filter((t) => t.id === territory.id || t.id.endsWith('-a') || t.id.endsWith('-b'))
        : all.filter((t) => t.kind === 'territory');
  return pick.flatMap((t) => t.rewards);
}

/**
 * The defender's deck: whatever the player has unlocked (so the rival is never
 * behind) plus the cards of its own kingdom up to this point, with one extra
 * copy of each common and rare so the kingdom's style shows from the first battle.
 */
export function rivalDeck(save: CampaignSave, territoryId: string): CardId[] | undefined {
  const territory = getTerritory(territoryId);
  if (territory.kind === 'final') return undefined;
  const counts = new Map<CardId, number>();
  for (const cardId of new Set([...STARTING_CARDS, ...save.unlocked])) counts.set(cardId, copiesOf(cardId));
  for (const cardId of kingdomCardsFor(territory)) {
    const rarity = getCard(cardId).rarity;
    counts.set(cardId, copiesOf(cardId) + (rarity === 'comun' || rarity === 'rara' ? 1 : 0));
  }
  return expand(counts);
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

const DIFFICULTY_OFFSET: Record<CampaignDifficulty, number> = { historia: -0.5, normal: 0, dificil: 0.4 };

/**
 * How well the defender plays, on the AI's scale (0 = Easy, 1 = Normal,
 * 2 = Hard). It rises with every hero beaten, not with where the territory
 * is, so the second hero is always harder than the first whatever the path.
 */
export function rivalTier(save: CampaignSave, territoryId: string): number {
  const territory = getTerritory(territoryId);
  const stage = heroesDefeated(save);
  // A castle is a step up, except the first: its hero has an ultimate the player does not have yet.
  const castle = territory.kind === 'castle' ? (stage === 0 ? -0.15 : 0.15) : 0;
  // The final battle is two against one, which is hard enough on its own.
  let tier = territory.kind === 'final' ? 0.9 : 0.15 + 0.3 * stage + castle;
  tier += DIFFICULTY_OFFSET[save.difficulty];
  return Math.min(2, Math.max(0, Math.round(tier * 100) / 100));
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

export interface BattleSetup {
  territory: string;
  /** Seat 0 is the player; the rest are AIs. */
  heroes: HeroId[];
  seats: SeatOptions[];
  rules: Partial<Rules>;
  firstEvent?: BattleEventId;
  /** The defenders' level (see `rivalTier`). */
  tier: number;
  /** Territory battles: the defender is a captain (no passive, no ultimate). */
  captain: boolean;
}

export function battleSetup(save: CampaignSave, territoryId: string, hero: HeroId): BattleSetup {
  const territory = getTerritory(territoryId);
  if (!save.allies.includes(hero)) throw new Error(`"${hero}" has not joined the campaign yet`);
  const terrain = territory.terrain ? getTerrain(territory.terrain) : null;
  const player: SeatOptions = { deck: playerDeck(save), ...(ultimateAwake(save) ? {} : { ultimateLocked: true }) };
  const base = {
    territory: territoryId,
    rules: { ...terrain?.rules },
    ...(terrain?.firstEvent ? { firstEvent: terrain.firstEvent } : {}),
    tier: rivalTier(save, territoryId),
  };
  if (territory.kind === 'final') {
    return { ...base, heroes: [hero, ...FINAL_RIVALS], seats: [player, {}, {}], captain: false };
  }
  if (!territory.kingdom || territory.kind === 'home') throw new Error(`"${territoryId}" cannot be attacked`);
  const defender = getKingdom(territory.kingdom).hero;
  const deck = rivalDeck(save, territoryId);
  const captain = territory.kind === 'territory';
  return {
    ...base,
    heroes: [hero, defender],
    seats: [player, { ...(deck ? { deck } : {}), ...(captain ? { noPassive: true, ultimateLocked: true } : {}) }],
    captain,
  };
}

/** Marks a battle as started, so its result is applied exactly once. */
export function startBattle(save: CampaignSave, territoryId: string, hero: HeroId, id: string): CampaignSave {
  if (!attackable(save).includes(territoryId)) throw new Error(`"${territoryId}" cannot be attacked now`);
  return { ...save, hero, pending: { id, territory: territoryId, hero } };
}

export interface BattleOutcome {
  won: boolean;
  territory: string;
  /** Cards unlocked by the victory. */
  rewards: CardId[];
  /** Copies won back from this territory. */
  recovered: CardId[];
  /** The hero who joins after their castle falls. */
  ally: HeroId | null;
  /** True when this victory woke the ultimate up (the first hero beaten). */
  awakened: boolean;
  /** The copy the territory took after a defeat. */
  lost: CardId | null;
  /** The Crown fell: the campaign is over. */
  finished: boolean;
}

/**
 * Applies the result of the pending battle. Returns null when `battleId` is
 * not the pending battle (already applied, or a stale game).
 *
 * Losing costs one copy of a random card, which that territory keeps until
 * the player conquers it; nothing is taken once the deck is down to `MIN_DECK`.
 */
export function settleBattle(
  save: CampaignSave,
  battleId: string,
  won: boolean,
  random: () => number = Math.random,
): { save: CampaignSave; outcome: BattleOutcome } | null {
  const pending = save.pending;
  if (!pending || pending.id !== battleId) return null;
  const territory = getTerritory(pending.territory);
  const next: CampaignSave = { ...save, pending: null, held: { ...save.held } };
  const outcome: BattleOutcome = { won, territory: territory.id, rewards: [], recovered: [], ally: null, awakened: false, lost: null, finished: false };

  if (won) {
    const wasAwake = ultimateAwake(save);
    next.wins = save.wins + 1;
    next.conquered = [...save.conquered, territory.id];
    const rewards = territory.rewards.filter((c) => !save.unlocked.includes(c));
    next.unlocked = [...save.unlocked, ...rewards];
    outcome.rewards = rewards;
    outcome.recovered = next.held[territory.id] ?? [];
    delete next.held[territory.id];
    if (territory.kind === 'castle' && territory.kingdom) {
      const hero = getKingdom(territory.kingdom).hero;
      if (!next.allies.includes(hero)) {
        next.allies = [...next.allies, hero];
        outcome.ally = hero;
      }
    }
    outcome.awakened = !wasAwake && ultimateAwake(next);
    if (territory.kind === 'final') {
      next.finished = true;
      outcome.finished = true;
    }
    return { save: next, outcome };
  }

  next.losses = save.losses + 1;
  const owned = collection(save);
  const deck = expand(owned);
  if (deck.length > MIN_DECK && territory.kind !== 'final') {
    const lost = deck[Math.floor(random() * deck.length)]!;
    next.held[territory.id] = [...(next.held[territory.id] ?? []), lost];
    outcome.lost = lost;
  }
  return { save: next, outcome };
}

/** Records that a scene or dialogue was shown. */
export function markSeen(save: CampaignSave, key: string): CampaignSave {
  return save.seen.includes(key) ? save : { ...save, seen: [...save.seen, key] };
}
