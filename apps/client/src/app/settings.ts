import type { Locale } from '@cardcraft-castles/engine';

export interface Settings {
  locale: Locale;
  nickname: string;
  /** 0..1 */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  animationSpeed: 'normal' | 'fast';
  reducedMotion: boolean;
  screenShake: boolean;
  /** Run the turn clock in games against the AI and on one device. */
  localTimer: boolean;
}

const KEY = 'cardcraft-castles:settings';

function defaults(): Settings {
  const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    locale: navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en',
    nickname: '',
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.8,
    animationSpeed: 'normal',
    reducedMotion: prefersReduced,
    screenShake: true,
    localTimer: true,
  };
}

function load(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return { ...base, ...saved, locale: saved.locale === 'en' || saved.locale === 'es' ? saved.locale : base.locale };
  } catch {
    return base;
  }
}

type Listener = (next: Settings, previous: Settings) => void;

/** Player preferences, kept in this browser. */
class SettingsStore {
  private value = load();
  private listeners = new Set<Listener>();

  get(): Settings {
    return this.value;
  }

  set(patch: Partial<Settings>): void {
    const previous = this.value;
    this.value = { ...previous, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Private mode or storage blocked: settings last for this visit only.
    }
    for (const listener of this.listeners) listener(this.value, previous);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const settings = new SettingsStore();

/** Multiplier for animation durations (fast mode and reduced motion shorten them). */
export function animScale(): number {
  const s = settings.get();
  if (s.reducedMotion) return 0.45;
  return s.animationSpeed === 'fast' ? 0.55 : 1;
}
