import { markSeen, newCampaign, parseCampaign, settleBattle, type BattleOutcome, type CampaignDifficulty, type CampaignSave } from '@cardcraft-castles/campaign';

/**
 * The campaign saved on this device. It lives in the browser like the
 * settings and the record; a progress code copies it to another device.
 */

const KEY = 'cardcraft-castles:campaign';

export function loadCampaign(): CampaignSave | null {
  try {
    return parseCampaign(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveCampaign(save: CampaignSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage full or blocked: the campaign plays on, it just won't survive a reload.
  }
}

export function startCampaign(difficulty: CampaignDifficulty): CampaignSave {
  const save = newCampaign(difficulty);
  saveCampaign(save);
  return save;
}

export function deleteCampaign(): void {
  try {
    localStorage.removeItem(KEY);
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
