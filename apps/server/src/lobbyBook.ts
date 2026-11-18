/**
 * The lobby's list of rooms, independent of Cloudflare: which rooms are
 * listed, what changed for the subscribers, and which room quick join picks.
 */
import type { LobbyServerMessage, LobbyStats, RoomSummary } from '@cardcraft-castles/protocol';
import type { LobbyRoomUpdate } from './roomCore';

export interface LobbyEntry extends LobbyRoomUpdate {
  /** The SDK's per-browser id of whoever created the room, so quick join never pairs you with yourself. */
  hostClientId: string | null;
  updatedAt: number;
}

export const LOBBY_LIMITS = {
  /** A listed room that has not reported for this long is dropped (games end well before). */
  staleMs: 3 * 60 * 60 * 1000,
  /** Quick join hands a room to one player at a time for this long. */
  reservationMs: 8000,
  /** At most this many rooms are listed. */
  maxListed: 200,
} as const;

/** Listed rooms: public, and either open for an opponent or with a game in progress. */
export function isListed(entry: LobbyEntry): boolean {
  return !entry.summary.private && (entry.open || entry.summary.status === 'playing');
}

function sameSummary(a: RoomSummary, b: RoomSummary): boolean {
  return (
    a.name === b.name &&
    a.host === b.host &&
    a.status === b.status &&
    a.players === b.players &&
    a.private === b.private &&
    a.createdAt === b.createdAt
  );
}

export class LobbyBook {
  private readonly entries = new Map<string, LobbyEntry>();
  private readonly reserved = new Map<string, number>();

  constructor(saved: readonly LobbyEntry[] = []) {
    for (const entry of saved) this.entries.set(entry.summary.id, entry);
  }

  /** What to store. */
  save(): LobbyEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }

  /** Listed rooms: waiting first, newest first. */
  list(): RoomSummary[] {
    return [...this.entries.values()]
      .filter(isListed)
      .map((e) => e.summary)
      .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || b.createdAt - a.createdAt)
      .slice(0, LOBBY_LIMITS.maxListed);
  }

  stats(online: number): LobbyStats {
    let waiting = 0;
    let playing = 0;
    for (const entry of this.entries.values()) {
      if (!isListed(entry)) continue;
      if (entry.summary.status === 'playing') playing += 1;
      else waiting += 1;
    }
    return { online, waiting, playing };
  }

  /**
   * Record a room's new state. Returns the message for subscribers, or null
   * when nothing they can see changed.
   */
  update(update: LobbyRoomUpdate, now: number, hostClientId?: string | null): LobbyServerMessage | null {
    const id = update.summary.id;
    const before = this.entries.get(id);
    if (update.summary.status === 'finished' || update.summary.status === 'closed') {
      return this.remove(id);
    }
    const entry: LobbyEntry = {
      ...update,
      hostClientId: hostClientId !== undefined ? hostClientId : (before?.hostClientId ?? null),
      updatedAt: now,
    };
    this.entries.set(id, entry);
    if (!update.open) this.reserved.delete(id);
    const wasListed = !!before && isListed(before);
    if (!isListed(entry)) return wasListed ? { type: 'roomRemoved', id } : null;
    if (wasListed && sameSummary(before.summary, entry.summary)) return null;
    return { type: 'room', room: entry.summary };
  }

  remove(id: string): LobbyServerMessage | null {
    const before = this.entries.get(id);
    this.entries.delete(id);
    this.reserved.delete(id);
    return before && isListed(before) ? { type: 'roomRemoved', id } : null;
  }

  /**
   * The open room quick join should send `clientId` to: the one that has
   * waited longest, not created by the same browser and not just handed to
   * someone else. It is reserved for a few seconds.
   */
  pickOpen(clientId: string | null, now: number): RoomSummary | null {
    let best: LobbyEntry | null = null;
    for (const entry of this.entries.values()) {
      if (!entry.open || entry.summary.private) continue;
      if (clientId !== null && entry.hostClientId === clientId) continue;
      if ((this.reserved.get(entry.summary.id) ?? 0) > now) continue;
      if (!best || entry.summary.createdAt < best.summary.createdAt) best = entry;
    }
    if (!best) return null;
    this.reserved.set(best.summary.id, now + LOBBY_LIMITS.reservationMs);
    return best.summary;
  }

  /** Drop rooms that stopped reporting. Returns the messages for subscribers. */
  prune(now: number): LobbyServerMessage[] {
    const messages: LobbyServerMessage[] = [];
    for (const entry of [...this.entries.values()]) {
      if (now - entry.updatedAt < LOBBY_LIMITS.staleMs) continue;
      const message = this.remove(entry.summary.id);
      if (message) messages.push(message);
    }
    return messages;
  }
}
