import type { Locale, LocalizedText, Rarity, Resource, School } from './types';

/**
 * Game vocabulary in Spanish and English. Card, hero and event names and
 * texts come from the catalog; this file names the things around them.
 */

export const GAME_TITLE = 'Cardcraft: Castles';

export const LOCALES: readonly Locale[] = ['es', 'en'];

export const TERMS = {
  keep: { es: 'Castillo', en: 'Castle' },
  wall: { es: 'Muralla', en: 'Wall' },
  hand: { es: 'Mano', en: 'Hand' },
  deck: { es: 'Mazo', en: 'Deck' },
  turn: { es: 'Turno', en: 'Turn' },
  combo: { es: 'Combo', en: 'Combo' },
  enchantment: { es: 'Encantamiento', en: 'Enchantment' },
  ultimate: { es: 'Definitiva', en: 'Ultimate' },
  passive: { es: 'Pasiva', en: 'Passive' },
  burn: { es: 'Quemadura', en: 'Burn' },
  frost: { es: 'Escarcha', en: 'Frost' },
  shield: { es: 'Escudo', en: 'Shield' },
  piercing: { es: 'Perforante', en: 'Piercing' },
  battleEvent: { es: 'Evento de batalla', en: 'Battle event' },
} as const satisfies Record<string, LocalizedText>;

export const SCHOOL_NAMES: Record<School, LocalizedText> = {
  construccion: { es: 'Construcción', en: 'Construction' },
  asalto: { es: 'Asalto', en: 'Assault' },
  arcano: { es: 'Arcano', en: 'Arcane' },
};

export const RESOURCE_NAMES: Record<Resource, LocalizedText> = {
  piedra: { es: 'Piedra', en: 'Stone' },
  acero: { es: 'Acero', en: 'Steel' },
  mana: { es: 'Maná', en: 'Mana' },
};

/** Worker that produces each resource. */
export const WORKER_NAMES: Record<Resource, LocalizedText> = {
  piedra: { es: 'Cantero', en: 'Mason' },
  acero: { es: 'Herrero', en: 'Smith' },
  mana: { es: 'Arcanista', en: 'Arcanist' },
};

export const RARITY_NAMES: Record<Rarity, LocalizedText> = {
  comun: { es: 'Común', en: 'Common' },
  rara: { es: 'Rara', en: 'Rare' },
  epica: { es: 'Épica', en: 'Epic' },
  legendaria: { es: 'Legendaria', en: 'Legendary' },
};

/** Pick the text for a locale. */
export function localize(text: LocalizedText, locale: Locale): string {
  return text[locale];
}
