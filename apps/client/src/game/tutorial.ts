/**
 * What the tutorial has already shown on this device: the opening comic, the
 * map guide, the guided first battle and the one-off tips. It is kept apart
 * from the campaign save, so starting a new campaign does not repeat it.
 */
/** `menu`: the main menu is open (the first hero has fallen, or the player is from before the tutorial). */
export type TutorialPart = 'intro' | 'map' | 'battle' | 'menu';

interface Flags {
  done: TutorialPart[];
  tips: string[];
  skipped?: boolean;
}

const KEY = 'cardcraft-castles:tutorial';

function load(): Flags {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Flags> | null;
    return { done: Array.isArray(raw?.done) ? raw.done : [], tips: Array.isArray(raw?.tips) ? raw.tips : [], skipped: !!raw?.skipped };
  } catch {
    return { done: [], tips: [] };
  }
}

function store(flags: Flags): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(flags));
  } catch {
    // Blocked storage: the tutorial may show again next time, nothing worse.
  }
}

export const tutorial = {
  done(part: TutorialPart): boolean {
    const f = load();
    return !!f.skipped || f.done.includes(part);
  },
  mark(part: TutorialPart): void {
    const f = load();
    if (!f.done.includes(part)) f.done.push(part);
    store(f);
  },
  /** One-off tips (combo, events, the ultimate...): shown once each, never after "Skip tutorial". */
  tipSeen(id: string): boolean {
    const f = load();
    return !!f.skipped || f.tips.includes(id);
  },
  markTip(id: string): void {
    const f = load();
    if (!f.tips.includes(id)) f.tips.push(id);
    store(f);
  },
  /** "Skip tutorial": nothing more is explained. */
  skipAll(): void {
    const f = load();
    store({ done: ['intro', 'map', 'battle', ...f.done.filter((p) => p === 'menu')], tips: f.tips, skipped: true });
  },
  /** "Replay tutorial" in the settings. */
  reset(): void {
    store({ done: load().done.filter((p) => p === 'intro' || p === 'menu'), tips: [] });
  },
  /**
   * The main menu (quick games, online, the collection...) opens once the
   * first enemy hero falls in the campaign. Until then the game is the campaign.
   * "Skip tutorial" does not open it: it only stops the explanations.
   */
  menuOpen(): boolean {
    return load().done.includes('menu');
  },
  /**
   * The very first start of the game on this device: nothing played yet. A
   * player from before the tutorial existed (they have a record or have seen
   * the release notes) goes to the menu as always.
   */
  isFirstRun(): boolean {
    try {
      if (localStorage.getItem(KEY)) return false;
      const veteran = Object.keys(localStorage).some((k) => k.startsWith('cardcraft-castles:') && k !== 'cardcraft-castles:settings');
      if (veteran) {
        store({ done: ['intro', 'menu'], tips: [] });
        return false;
      }
      return true;
    } catch {
      return false;
    }
  },
};
