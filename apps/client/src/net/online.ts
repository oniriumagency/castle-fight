import { HEROES, type PlayerId } from '@cardcraft-castles/engine';
import type { Emote, HeroChoice, PlayerAction, RoomInfo } from '@cardcraft-castles/protocol';
import { OnlineClient, roomIdFromUrl, type RoomConnection } from '@cardcraft-castles/protocol/client';
import { BaseSession, type MatchSession, type Presence, type Seat } from '../game/session';

/**
 * The online side of the client, on top of the server thread's SDK
 * (`@cardcraft-castles/protocol/client`). The SDK reconnects, resumes seats
 * after a reload and corrects the turn clock; this file only adapts it to the
 * `MatchSession` the board speaks.
 *
 * `VITE_SERVER_URL` points the client at a Worker on another origin; by
 * default it uses the page's origin (Vite proxies `/api` in development).
 */
const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;

export const online = new OnlineClient({ baseUrl: serverUrl });

export { roomIdFromUrl };

function presenceOf(room: RoomInfo): Presence {
  return {
    seats: room.seats.map((s) =>
      s ? { connected: s.connected, reconnectBy: s.reconnectBy, left: s.left, wantsRematch: s.rematch } : null,
    ) as Presence['seats'],
    score: room.score,
  };
}

function seatsOf(room: RoomInfo | null, fallback: [Seat, Seat]): [Seat, Seat] {
  if (!room) return fallback;
  return room.seats.map((s, i) => (s ? { nickname: s.nickname, pid: s.pid ?? null, hero: s.hero ?? fallback[i].hero } : fallback[i])) as [Seat, Seat];
}

/** One online match, wrapping a room connection of the SDK. */
export class OnlineSession extends BaseSession implements MatchSession {
  readonly kind = 'online' as const;
  seats: [Seat, Seat];
  private unsubscribers: (() => void)[] = [];

  constructor(readonly connection: RoomConnection) {
    super();
    const fallback: Seat = { nickname: '…', hero: HEROES[0].id };
    this.seats = seatsOf(connection.room, [fallback, fallback]);
    const c = connection;
    this.unsubscribers.push(
      c.on('room', (room) => {
        this.seats = seatsOf(room, this.seats);
        this.emit({ type: 'presence', presence: presenceOf(room) });
      }),
      c.on('state', ({ view, events, deadline, resumed }) => {
        // Heroes are only known once the game starts; take them from the view.
        this.seats = [
          { ...this.seats[0], hero: view.players[0].hero },
          { ...this.seats[1], hero: view.players[1].hero },
        ];
        this.emit({ type: 'state', view, events: resumed ? [] : events, deadline, resumed });
      }),
      c.on('emote', ({ seat, emote }) => this.emit({ type: 'emote', seat, emote })),
      c.on('error', ({ message }) => this.emit({ type: 'error', message })),
      c.on('status', (status) => {
        if (status === 'open') this.emit({ type: 'status', status: 'connected' });
        else if (status === 'reconnecting') this.emit({ type: 'status', status: 'reconnecting' });
      }),
      c.on('closed', ({ message }) => this.emit({ type: 'status', status: 'closed', message })),
    );
  }

  get seat(): PlayerId {
    return this.connection.seat ?? 0;
  }

  get room(): RoomInfo | null {
    return this.connection.room;
  }

  isLocal(seat: PlayerId): boolean {
    return seat === this.connection.seat;
  }

  act(action: PlayerAction): void {
    switch (action.type) {
      case 'play':
        this.connection.play(action.uid);
        break;
      case 'discard':
        this.connection.discard(action.uid, action.also ?? []);
        break;
      case 'ultimate':
        this.connection.ultimate();
        break;
      case 'choose':
        this.connection.choose(action.option);
        break;
      case 'concede':
        this.connection.concede();
        break;
    }
  }

  resync(): void {
    this.connection.sync();
  }

  idle(): void {
    // The server owns the clock.
  }

  rematch(hero?: HeroChoice): void {
    this.connection.rematch(hero);
  }

  emote(emote: string): void {
    this.connection.emote(emote as Emote);
  }

  /** One key per room; the game number keeps a rematch from reusing the last game's figures. */
  statsKey(): string | null {
    const room = this.connection.room;
    return room ? `cardcraft-castles:stats:${this.connection.roomId}:${room.games}` : null;
  }

  gameId(): string | null {
    const room = this.connection.room;
    return room ? `${this.connection.roomId}:${room.games}` : null;
  }

  leave(): void {
    clearStoredStats(this.connection.roomId);
    for (const off of this.unsubscribers) off();
    this.listeners.clear();
    this.connection.leave();
  }
}

/** Forgets the saved statistics of a room's games (after leaving it). */
function clearStoredStats(roomId: string): void {
  try {
    const prefix = `cardcraft-castles:stats:${roomId}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing was saved either.
  }
}
