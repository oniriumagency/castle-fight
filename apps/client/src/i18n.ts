import type { Locale } from '@cardcraft-castles/engine';

/** Interface texts of the shell. Card, hero and event texts come from the engine. */
const STRINGS = {
  tagline: {
    es: 'Levanta tu castillo. Derriba el del rival.',
    en: 'Raise your castle. Bring down theirs.',
  },
  shellNote: {
    es: 'Demostración del motor de reglas: {cards} cartas, {heroes} héroes y {events} eventos.',
    en: 'Rules engine demo: {cards} cards, {heroes} heroes and {events} events.',
  },
  next: { es: 'Siguiente jugada', en: 'Next move' },
  restart: { es: 'Nueva partida', en: 'New game' },
  switchLocale: { es: 'English', en: 'Español' },
  turn: { es: 'Turno {turn}', en: 'Turn {turn}' },
  played: { es: '{who} juega {card}', en: '{who} plays {card}' },
  discarded: { es: '{who} descarta {card}', en: '{who} discards {card}' },
  ultimate: { es: '{who} usa su definitiva', en: '{who} uses the ultimate' },
  chose: { es: '{who} elige', en: '{who} chooses' },
  wins: { es: '¡{who} gana la partida!', en: '{who} wins the game!' },
  draw: { es: 'Empate.', en: 'Draw.' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function detectLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function t(key: StringKey, locale: Locale, values: Record<string, string | number> = {}): string {
  return STRINGS[key][locale].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
