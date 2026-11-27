import design from '../../../design/cards.json';
import { BATTLE_EVENT_EFFECTS } from './data/battleEventEffects';
import { CARD_EFFECTS } from './data/cardEffects';
import { HERO_EFFECTS } from './data/heroEffects';
import type {
  BattleEventDef,
  BattleEventId,
  CardDef,
  CardId,
  EnchantmentModifiers,
  HeroDef,
  HeroId,
  Rarity,
  Resource,
  Rules,
  School,
} from './types';

/**
 * The catalog joins the design data (`design/cards.json`: names, texts, costs,
 * rarities) with the mechanics defined in `src/data`. It is built once when
 * the module loads and fails loudly if a card, hero or event is missing on
 * either side.
 */

export const SCHOOLS: readonly School[] = ['construccion', 'asalto', 'arcano'];
export const RESOURCES: readonly Resource[] = ['piedra', 'acero', 'mana'];
export const RARITIES: readonly Rarity[] = ['comun', 'rara', 'epica', 'legendaria', 'divina'];

/** Resource that pays for the cards of each school. */
export const SCHOOL_RESOURCE: Record<School, Resource> = {
  construccion: 'piedra',
  asalto: 'acero',
  arcano: 'mana',
};

/** Default rules: the numbers in `design/cards.json` plus the engine's own. */
export const DEFAULT_RULES: Readonly<Rules> = Object.freeze({
  keepStart: design.rules.keepStart,
  wallStart: design.rules.wallStart,
  keepWin: design.rules.keepWin,
  resourceStart: design.rules.resourceStart,
  workerStart: design.rules.workerStart,
  secondPlayerWall: design.rules.secondPlayerWall,
  multiSeatWall: design.rules.multiSeatWall,
  handSize: design.rules.handSize,
  discardMax: 3,
  turnSeconds: design.rules.turnSeconds,
  maxEnchantments: design.rules.maxEnchantments,
  eventEveryRounds: design.rules.eventEveryRounds,
  deckCopies: Object.freeze({ comun: 4, rara: 3, epica: 2, legendaria: 1, divina: 0 }),
  burnDamage: 3,
  burnMaxTurns: 6,
  frostMaxTurns: 3,
  shieldMaxCharges: 3,
  ultimateCharge: 35,
  ultimateChargeStep: 15,
  minWorkers: 1,
  eventKeepFloor: 1,
  turnLimit: 200,
  multiTargeting: 'all',
  multiAllScale: 0.6,
  leaderExtraDamage: 0,
  eliminationBounty: 0,
  twilightRound: 11,
  twilightEvery: 2,
  twilightAttackBonus: 4,
  twilightDamage: 5,
  twilightBuildBonus: 4,
});

function assertSameIds(kind: string, designIds: string[], effectIds: string[]): void {
  const missing = designIds.filter((id) => !effectIds.includes(id));
  const extra = effectIds.filter((id) => !designIds.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Catalog mismatch for ${kind}: missing effects for [${missing.join(', ')}], ` +
        `effects without design entry for [${extra.join(', ')}]`,
    );
  }
}

function oneOf<T extends string>(kind: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Unknown ${kind} "${value}" in design/cards.json`);
  }
  return value as T;
}

assertSameIds(
  'cards',
  design.cards.map((c) => c.id),
  Object.keys(CARD_EFFECTS),
);
assertSameIds(
  'heroes',
  design.heroes.map((h) => h.id),
  Object.keys(HERO_EFFECTS),
);
assertSameIds(
  'events',
  design.events.map((e) => e.id),
  Object.keys(BATTLE_EVENT_EFFECTS),
);

/** All cards, in the order of `design/cards.json`. */
export const CARDS: readonly CardDef[] = design.cards.map((c) => ({
  id: c.id,
  school: oneOf('school', c.school, SCHOOLS),
  rarity: oneOf('rarity', c.rarity, RARITIES),
  cost: c.cost,
  name: c.name,
  text: c.text,
  ...('textFfa' in c && c.textFfa ? { textFfa: c.textFfa } : {}),
  art: c.art,
  effects: CARD_EFFECTS[c.id]!,
}));

export const HEROES: readonly HeroDef[] = design.heroes.map((h) => ({
  id: h.id,
  name: h.name,
  text: h.text,
  ...('textFfa' in h && h.textFfa ? { textFfa: h.textFfa } : {}),
  art: h.art,
  ...HERO_EFFECTS[h.id]!,
}));

export const BATTLE_EVENTS: readonly BattleEventDef[] = design.events.map((e) => ({
  id: e.id,
  name: e.name,
  text: e.text,
  art: e.art,
  effect: BATTLE_EVENT_EFFECTS[e.id]!,
}));

const cardsById = new Map(CARDS.map((c) => [c.id, c]));
const heroesById = new Map(HEROES.map((h) => [h.id, h]));
const eventsById = new Map(BATTLE_EVENTS.map((e) => [e.id, e]));

export function isCardId(id: string): id is CardId {
  return cardsById.has(id);
}

export function isHeroId(id: string): id is HeroId {
  return heroesById.has(id);
}

export function getCard(id: CardId): CardDef {
  const card = cardsById.get(id);
  if (!card) throw new Error(`Unknown card "${id}"`);
  return card;
}

export function getHero(id: HeroId): HeroDef {
  const hero = heroesById.get(id);
  if (!hero) throw new Error(`Unknown hero "${id}"`);
  return hero;
}

export function getBattleEvent(id: BattleEventId): BattleEventDef {
  const event = eventsById.get(id);
  if (!event) throw new Error(`Unknown battle event "${id}"`);
  return event;
}

/** Modifiers of an enchantment card, or null if the card is not an enchantment. */
export function getEnchantmentModifiers(id: CardId): EnchantmentModifiers | null {
  for (const op of getCard(id).effects) {
    if (op.op === 'enchant') return op.modifiers;
  }
  return null;
}

/** True if the card has a Combo bonus. */
export function hasCombo(id: CardId): boolean {
  return getCard(id).effects.some(
    (op) => (op.op === 'wall' || op.op === 'keep' || op.op === 'damage') && !!op.comboBonus,
  );
}

/** The card list of one player's deck: every card, with copies by rarity. Unshuffled. */
export function buildDeckList(rules: Rules): CardId[] {
  const deck: CardId[] = [];
  for (const card of CARDS) {
    for (let i = 0; i < rules.deckCopies[card.rarity]; i++) deck.push(card.id);
  }
  return deck;
}
