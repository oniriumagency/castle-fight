import { DurableObject } from 'cloudflare:workers';
import type { PlayerId } from '@cardcraft-castles/engine';
import { CLOSE_CODES, PING, PONG, type RoomServerMessage, type RoomSummary } from '@cardcraft-castles/protocol';
import type { Env } from './env';
import type { Lobby } from './lobby';
import { RoomCore, newRoomRecord, type LobbyRoomUpdate, type NewRoom, type RoomHost, type RoomRecord } from './roomCore';

/** What each WebSocket remembers across hibernation. */
interface Attachment {
  seat: PlayerId | null;
}

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
      sockets: () =>
        this.ctx.getWebSockets().filter((ws) => ws !== this.closing && ws.readyState === WebSocket.OPEN),
      seatOf: (ws) => (ws.deserializeAttachment() as Attachment | null)?.seat ?? null,
      setSeat: (ws, seat) => ws.serializeAttachment({ seat } satisfies Attachment),
      send: (ws, message: RoomServerMessage) => {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          // The socket is closing.
        }
      },
      close: (ws, code, reason) => {
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
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null } satisfies Attachment);
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
    this.core?.tick();
    await this.commit();
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

    const wake = core.nextWake();
    if (wake !== this.alarmAt) {
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
