import type { LocalizedText } from '@cardcraft-castles/engine';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** In the order a menu should list them. */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export const DIFFICULTY_NAMES: Record<Difficulty, LocalizedText> = {
  easy: { es: 'Fácil', en: 'Easy' },
  normal: { es: 'Normal', en: 'Normal' },
  hard: { es: 'Difícil', en: 'Hard' },
};

export const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, LocalizedText> = {
  easy: {
    es: 'Juega por impulso y comete errores. Para aprender las cartas.',
    en: 'Plays on impulse and makes mistakes. Good for learning the cards.',
  },
  normal: {
    es: 'Juega con criterio, pero a veces se le escapa la mejor jugada y no se anticipa a la tuya.',
    en: 'Plays sensibly, but sometimes misses the best move and does not anticipate yours.',
  },
  hard: {
    es: 'Calcula tu respuesta antes de jugar y no perdona un descuido.',
    en: 'Works out your reply before it plays and punishes any slip.',
  },
};

/** How one difficulty level thinks. */
export interface Profile {
  /** Random guesses of the hidden cards that are averaged ("worlds"). */
  worlds: number;
  /** Opponent turns played out after the AI's own move before judging the position. */
  replies: number;
  /** How many of the AI's options get the deeper look when `replies` > 0. */
  candidates: number;
  /** Random error added to the value of every option, in evaluation points. */
  noise: number;
  /** Chance of ignoring all of the above and playing any card it can afford. */
  impulse: number;
}

export const PROFILES: Readonly<Record<Difficulty, Profile>> = Object.freeze({
  easy: { worlds: 1, replies: 0, candidates: 0, noise: 14, impulse: 0.35 },
  normal: { worlds: 2, replies: 0, candidates: 0, noise: 7, impulse: 0 },
  hard: { worlds: 6, replies: 1, candidates: 5, noise: 0, impulse: 0 },
});
