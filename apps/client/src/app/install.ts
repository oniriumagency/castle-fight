import { ON_ITCH } from './platform';

/**
 * "Add to home screen": installed from the menu, the game opens full screen
 * in landscape with no browser bar at all (see manifest.webmanifest).
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of [...listeners]) listener();
}

/** Running as the installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  return ['fullscreen', 'standalone'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

export function initInstall(): void {
  // On itch.io the game is played on itch's page: nothing to install.
  if (ON_ITCH) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's own banner for the menu button instead.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    changed();
  });
}

/** The browser offers to install the game right now. */
export function canInstall(): boolean {
  return deferred !== null && !isInstalled();
}

export async function promptInstall(): Promise<void> {
  const prompt = deferred;
  if (!prompt) return;
  deferred = null;
  changed();
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    // Dismissed or not allowed: nothing to undo.
  }
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
