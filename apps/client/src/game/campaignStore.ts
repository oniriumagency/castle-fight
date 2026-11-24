import { isFutureCampaign, markSeen, newCampaign, parseCampaign, settleBattle, type BattleOutcome, type CampaignDifficulty, type CampaignSave } from '@cardcraft-castles/campaign';

/**
 * The campaign saved on this device. It lives in the browser like the
 * settings and the record; a progress code copies it to another device.
 */

const KEY = 'cardcraft-castles:campaign';
/**
 * A save this version could not read (written by a newer version, say an
 * old tab still open after an update, or damaged). It is moved here before
 * anything else is written, and put back as soon as a version that reads it
 * loads: an update never costs the player their campaign.
 */
const SET_ASIDE_KEY = 'cardcraft-castles:campaign:set-aside';

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return undefined;
  }
}

function write(key: string, save: CampaignSave): void {
  try {
    localStorage.setItem(key, JSON.stringify(save));
  } catch {
    // Storage full or blocked: the campaign plays on, it just won't survive a reload.
  }
}

/** How far a save got, to tell the real campaign from a fresh one started over it. */
const progressOf = (save: CampaignSave): number => save.conquered.length * 1000 + save.wins + save.losses + save.seen.length;

export function loadCampaign(): CampaignSave | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  const raw = read(KEY);
  const current = parseCampaign(raw);
  if (stored !== null && !current) {
    // Unreadable here: keep it safe so starting a campaign cannot overwrite it.
    try {
      if (isFutureCampaign(raw) || localStorage.getItem(SET_ASIDE_KEY) === null) localStorage.setItem(SET_ASIDE_KEY, stored);
      localStorage.removeItem(KEY);
    } catch {
      // Nothing more we can do.
    }
    return null;
  }
  // A save set aside earlier that this version can read comes back, unless the one in use went further.
  const aside = read(SET_ASIDE_KEY);
  if (aside !== null) {
    const recovered = parseCampaign(aside);
    if (recovered) {
      try {
        localStorage.removeItem(SET_ASIDE_KEY);
      } catch {
        // Left in place: it is checked again next time.
      }
      if (!current || progressOf(recovered) > progressOf(current)) {
        write(KEY, recovered);
        return recovered;
      }
    }
  }
  if (current && stored !== JSON.stringify(current)) write(KEY, current); // Upgraded or tidied: store it in the current format.
  return current;
}

export function saveCampaign(save: CampaignSave): void {
  // Never write over a save from a newer version of the game (an old tab left open after an update).
  if (isFutureCampaign(read(KEY))) loadCampaign(); // Sets it aside first.
  write(KEY, save);
}

export function startCampaign(difficulty: CampaignDifficulty): CampaignSave {
  const save = newCampaign(difficulty);
  saveCampaign(save);
  return save;
}

export function deleteCampaign(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(SET_ASIDE_KEY);
  } catch {
    // Nothing to delete.
  }
}

/** Marks a scene as shown and saves. */
export function seen(key: string): void {
  const save = loadCampaign();
  if (save) saveCampaign(markSeen(save, key));
}

const PREFIX = 'CC1.';

/** The campaign as a short text the player can paste elsewhere. */
export function exportCode(save: CampaignSave): string {
  const json = JSON.stringify({ ...save, pending: null });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return PREFIX + btoa(binary);
}

export function importCode(code: string): CampaignSave | null {
  const text = code.trim();
  if (!text.startsWith(PREFIX)) return null;
  try {
    const binary = atob(text.slice(PREFIX.length));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return parseCampaign(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/**
 * Applies a finished campaign battle to the saved campaign. Returns what it
 * changed, or a bare outcome when the battle was already settled (a reload on
 * the results screen) so the screen can still say who won.
 */
export function settleCampaignBattle(battleId: string, won: boolean): BattleOutcome | null {
  const save = loadCampaign();
  if (!save) return null;
  const result = settleBattle(save, battleId, won);
  if (!result) return null;
  saveCampaign(result.save);
  return result.outcome;
}
