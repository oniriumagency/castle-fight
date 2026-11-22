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
  v: 1;
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
}

/** Minimum deck size a defeat can leave the player with. */
export const MIN_DECK = 48;

export function newCampaign(difficulty: CampaignDifficulty = 'normal', now = Date.now()): CampaignSave {
  return {
    v: 1,
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

/** A save read back from storage, or null when it does not make sense (corrupt or from an unknown version). */
export function parseCampaign(raw: unknown): CampaignSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CampaignSave>;
  if (s.v !== 1) return null;
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string');
  if (!strings(s.conquered) || !strings(s.unlocked) || !strings(s.allies) || !strings(s.seen)) return null;
  if (!CAMPAIGN_DIFFICULTIES.includes(s.difficulty as CampaignDifficulty)) return null;
  const held: Record<string, CardId[]> = {};
  for (const [territory, cards] of Object.entries(s.held ?? {})) {
    if (isTerritoryId(territory) && strings(cards)) held[territory] = cards.filter(isCardId);
  }
  const allies = s.allies.filter(isHeroId);
  if (!allies.includes(STARTING_HERO)) allies.unshift(STARTING_HERO);
  const pending =
    s.pending && typeof s.pending === 'object' && isTerritoryId(s.pending.territory) && isHeroId(s.pending.hero) && typeof s.pending.id === 'string'
      ? { id: s.pending.id, territory: s.pending.territory, hero: s.pending.hero }
      : null;
  return {
    v: 1,
    difficulty: s.difficulty as CampaignDifficulty,
    conquered: s.conquered.filter(isTerritoryId),
    unlocked: s.unlocked.filter(isCardId),
    held,
    allies,
    hero: typeof s.hero === 'string' && allies.includes(s.hero) ? s.hero : STARTING_HERO,
    seen: s.seen.slice(),
    pending,
    wins: Number(s.wins) || 0,
    losses: Number(s.losses) || 0,
    finished: !!s.finished,
    startedAt: Number(s.startedAt) || Date.now(),
  };
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
