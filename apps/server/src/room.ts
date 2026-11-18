import { DurableObject } from 'cloudflare:workers';
import type { PlayerId } from '@cardcraft-castles/engine';
import { CLOSE_CODES, PING, PONG, type RoomServerMessage, type RoomSummary } from '@cardcraft-castles/protocol';
import type { Env } from './env';
import type { Lobby } from './lobby';
import { RoomCore, newRoomRecord, type LobbyRoomUpdate, type NewRoom, type RoomHost, type RoomRecord } from './roomCore';

/** What each WebSocket remembers across hibernation. */
interface Attachment {
  seat: PlayerId | null;
  /** When the socket connected. */
  at: number;
  /** We closed it; it no longer counts even if the other side never answers. */
  closed?: boolean;
}

/**
 * A socket the client has not pinged for this long is dead: the browser went
 * away without a close frame (lost network, a sleeping laptop, a killed mobile
 * tab). The client pings every 20 s, and a throttled background tab still about
 * once a minute.
 */
export const STALE_SOCKET_MS = 2 * 60_000;
/** While anyone is connected, the room wakes this often to drop dead sockets. */
export const SWEEP_EVERY_MS = 60_000;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Answer the client's close frame so its close handshake finishes (runtimes
 * without automatic close replies leave the client hanging otherwise).
 */
export function completeClose(ws: WebSocket, code: number, reason: string): void {
  const echo = code === 1000 || (code >= 3000 && code < 5000) ? code : 1000;
  try {
    ws.close(echo, reason);
  } catch {
    // Already closed.
  }
}

/**
 * One room: a thin Durable Object around `RoomCore`. It uses the WebSocket
 * Hibernation API, so between messages the object can be evicted from memory
 * at no cost; everything it needs is in storage (one record) and in each
 * socket's attachment (its seat).
 */
export class Room extends DurableObject<Env> {
  private core: RoomCore<WebSocket> | null = null;
  private alarmAt: number | null = null;
  private lastLobby = '';
  /** The socket being closed right now, which must not count as connected. */
  private closing: WebSocket | null = null;
  private readonly host: RoomHost<WebSocket>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.host = {
      now: () => Date.now(),
      sockets: () => this.ctx.getWebSockets().filter((ws) => this.live(ws)),
      seatOf: (ws) => this.attachment(ws).seat,
      setSeat: (ws, seat) => ws.serializeAttachment({ ...this.attachment(ws), seat } satisfies Attachment),
      send: (ws, message: RoomServerMessage) => {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          // The socket is closing.
        }
      },
      close: (ws, code, reason) => {
        try {
          ws.serializeAttachment({ ...this.attachment(ws), closed: true } satisfies Attachment);
        } catch {
          // Already gone.
        }
        try {
          ws.close(code, reason);
        } catch {
          // Already closed.
        }
      },
      randomToken: () => base64url(crypto.getRandomValues(new Uint8Array(24))),
      randomSeed: () => Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
      randomIndex: (n) => crypto.getRandomValues(new Uint32Array(1))[0]! % n,
    };
    // Heartbeats are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      const record = await ctx.storage.get<RoomRecord>('room');
      if (record && record.status !== 'closed') this.core = new RoomCore(record, this.host);
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  /** RPC from the lobby when the room is created. */
  async create(room: NewRoom): Promise<LobbyRoomUpdate> {
    if (this.core || (await this.ctx.storage.get('room'))) throw new Error(`Room ${room.id} already exists`);
    this.core = new RoomCore(newRoomRecord(room, Date.now()), this.host);
    const update = this.core.lobbyUpdate();
    // The lobby records this first state itself.
    this.lastLobby = JSON.stringify(update);
    this.ctx.storage.put('room', this.core.record);
    await this.commit();
    return update;
  }

  /** RPC from the Worker: the room as an invite page shows it, or null if it does not exist. */
  async summary(): Promise<RoomSummary | null> {
    return this.core?.summary() ?? null;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.sweep();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null, at: Date.now() } satisfies Attachment);
    if (this.core) {
      this.core.connected(server);
      await this.commit();
    } else {
      this.host.send(server, { type: 'error', code: 'roomNotFound', message: 'This room does not exist or has closed' });
      this.host.close(server, CLOSE_CODES.roomNotFound, 'Room not found');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.core) {
      this.host.close(ws, CLOSE_CODES.roomClosed, 'The room is closed');
      return;
    }
    this.sweep();
    this.core.receive(ws, typeof message === 'string' ? message : '');
    await this.commit();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    completeClose(ws, code, reason);
    await this.dropped(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    this.sweep();
    this.core?.tick();
    await this.commit();
  }

  private attachment(ws: WebSocket): Attachment {
    const value = ws.deserializeAttachment() as Partial<Attachment> | null;
    // Sockets accepted by an older version only stored the seat.
    return { seat: value?.seat ?? null, at: value?.at ?? 0, ...(value?.closed ? { closed: true } : {}) };
  }

  /** Open, not closed by us, and heard from recently. */
  private live(ws: WebSocket): boolean {
    if (ws === this.closing || ws.readyState !== WebSocket.OPEN) return false;
    const { closed } = this.attachment(ws);
    return !closed && !this.stale(ws);
  }

  private stale(ws: WebSocket): boolean {
    const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
    const { at } = this.attachment(ws);
    // A socket from before this version has no `at`: judge it by its pings alone.
    return Date.now() - Math.max(pinged, at) > STALE_SOCKET_MS;
  }

  /**
   * Close sockets whose client vanished without a close frame. Left alone they
   * kept a seat looking connected (so no reconnection window ever opened) and
   * filled the room until new connections were refused.
   */
  private sweep(): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN || this.attachment(ws).closed || !this.stale(ws)) continue;
      const { seat } = this.attachment(ws);
      console.warn(`Room ${this.core?.record.id ?? '?'}: dropping a dead socket (seat ${seat ?? 'none'})`);
      // A normal close: if the client is in fact alive it reconnects and resumes.
      this.host.close(ws, 1000, 'No heartbeat');
      this.closing = ws;
      try {
        this.core?.disconnected(ws);
      } finally {
        this.closing = null;
      }
    }
  }

  private async dropped(ws: WebSocket): Promise<void> {
    this.closing = ws;
    try {
      this.core?.disconnected(ws);
    } finally {
      this.closing = null;
    }
    await this.commit();
  }

  /** Do what the core asks: save, arm the alarm, tell the lobby, or delete the room. */
  private async commit(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const { record } = core;

    if (core.closed) {
      this.core = null;
      this.alarmAt = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      if (!record.private) await this.tellLobby(() => this.lobby().remove(record.id));
      return;
    }

    // Not awaited: the output gate holds outgoing messages until the write is durable.
    if (core.takeDirty()) void this.ctx.storage.put('room', record);

    // While anyone is connected, also wake now and then to drop dead sockets.
    const now = Date.now();
    const coreWake = core.nextWake();
    const sweepAt = this.host.sockets().length > 0 ? now + SWEEP_EVERY_MS : null;
    const wake = coreWake === null ? sweepAt : sweepAt === null ? coreWake : Math.min(coreWake, sweepAt);
    // An alarm already set that rings sooner is fine: `tick` only runs what is due.
    const keep = wake !== null && this.alarmAt !== null && this.alarmAt > now && this.alarmAt <= wake;
    if (wake !== this.alarmAt && !keep) {
      this.alarmAt = wake;
      if (wake === null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(wake);
    }

    if (!record.private) {
      const update = core.lobbyUpdate();
      const key = JSON.stringify(update);
      if (key !== this.lastLobby) {
        this.lastLobby = key;
        const ok = await this.tellLobby(() => this.lobby().update(update));
        if (!ok) this.lastLobby = '';
      }
    }
  }

  private async tellLobby(call: () => Promise<unknown>): Promise<boolean> {
    try {
      await call();
      return true;
    } catch (error) {
      // The lobby is only a directory; the game goes on without it.
      console.error('Lobby update failed', error);
      return false;
    }
  }

  private lobby(): DurableObjectStub<Lobby> {
    return this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
  }
}
