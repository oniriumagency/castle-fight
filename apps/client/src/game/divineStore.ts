import { DIVINE_CARDS, type CampaignSave } from '@cardcraft-castles/campaign';
import { getCard, isCardId, type CardId } from '@cardcraft-castles/engine';

/**
 * The Divine cards this player has won: one per hero they took the Crown
 * with. They live on this device apart from the campaign, so starting a new
 * campaign (or deleting it) never takes them away, and they join the player's
 * deck in every game: against the AI, online and in the campaign itself.
 */

const KEY = 'cardcraft-castles:divine';

function read(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Divine cards owned, in hero order. Ids this version does not know stay stored but are left out. */
export function ownedDivine(): CardId[] {
  const stored = new Set(read());
  return Object.values(DIVINE_CARDS).filter((id) => stored.has(id) && isCardId(id) && getCard(id).rarity === 'divina');
}

/** Keeps a Divine card. Returns true when it is new. */
export function grantDivine(cardId: CardId): boolean {
  const stored = read();
  if (stored.includes(cardId)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify([...stored, cardId]));
  } catch {
    // Storage full or blocked: it is granted again from the finished campaign next time.
  }
  return true;
}

/**
 * A campaign already won (before Divine cards existed, or on another device
 * through a progress code) still earns the card of the hero who took the Crown.
 */
export function grantFromCampaign(save: CampaignSave | null): void {
  if (save?.finished && save.conquered.includes('corona')) grantDivine(DIVINE_CARDS[save.hero]);
}
