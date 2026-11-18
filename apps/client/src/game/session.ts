import type { GameEvent, HeroId, PlayerId, PlayerView } from '@cardcraft-castles/engine';
import type { PlayerAction } from '@cardcraft-castles/protocol';

/**
 * What the board talks to. A session hides where the game runs: on this
 * device against the AI, on this device between two people, or on the
 * server. The board only shows views and sends actions.
 */

export interface Seat {
  nickname: string;
  hero: HeroId;
  /** Shown on the board for AI seats. */
  isAi?: boolean;
  /** Online: the player's public browser id, for the head-to-head record. */
  pid?: string | null;
}

export type SessionKind = 'ai' | 'local' | 'online';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'closed';

export type SessionEvent =
  /** A new view and what happened since the previous one, in order. */
  | { type: 'state'; view: PlayerView; events: GameEvent[]; deadline: number | null; resumed?: boolean }
  /** The turn clock changed without a new state (local games start it once animations end). */
  | { type: 'clock'; deadline: number | null }
  | { type: 'status'; status: ConnectionStatus; message?: string }
  | { type: 'error'; message: string }
  /** Quick reaction from a player (online). */
  | { type: 'emote'; seat: PlayerId; emote: string }
  /** A new game is starting in this session (rematch). */
  | { type: 'rematch'; seat: PlayerId }
  /** Online presence: who is connected, who wants a rematch, the running score. */
  | { type: 'presence'; presence: Presence };

export interface SeatPresence {
  connected: boolean;
  /** Epoch ms at which a dropped player forfeits. */
  reconnectBy: number | null;
  left: boolean;
  wantsRematch: boolean;
}

export interface Presence {
  seats: [SeatPresence | null, SeatPresence | null];
  score: [number, number];
}

export type SessionListener = (event: SessionEvent) => void;

export interface MatchSession {
  readonly kind: SessionKind;
  readonly seats: [Seat, Seat];
  /** Whether this device plays that seat (both seats on a shared device). */
  isLocal(seat: PlayerId): boolean;
  /** Receives every event. The latest state is replayed right away to a new listener. */
  subscribe(listener: SessionListener): () => void;
  /** `player` is filled in by the session. */
  act(action: PlayerAction): void;
  /** The board finished animating the latest state. Local sessions start the AI and the clock here. */
  idle(): void;
  /** Start a new game with the same seats (or ask the opponent online). */
  rematch(): void;
  /**
   * Where the board keeps this game's statistics so they survive a page
   * reload (online games resume mid-match). Null when there is nothing to keep.
   */
  statsKey?(): string | null;
  /** Ask for the current state again (online: the server resends it). */
  resync?(): void;
  /** Online: an id for the current game, unique across rooms, so the win/loss record counts it once. */
  gameId?(): string | null;
  /** Quick reactions; only present when the session supports them. */
  emote?(emote: string): void;
  leave(): void;
}

/** Shared plumbing for sessions: listeners and the last state for late subscribers. */
export abstract class BaseSession {
  protected listeners = new Set<SessionListener>();
  protected last: Extract<SessionEvent, { type: 'state' }> | null = null;

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    if (this.last) listener(this.last);
    return () => this.listeners.delete(listener);
  }

  protected emit(event: SessionEvent): void {
    if (event.type === 'state') this.last = event;
    for (const listener of [...this.listeners]) listener(event);
  }
}
