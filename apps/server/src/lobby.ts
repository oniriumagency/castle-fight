import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE_CODES,
  PING,
  PONG,
  ROOM_ID_ALPHABET,
  cleanRoomName,
  type ApiErrorResponse,
  type LobbyServerMessage,
  type LobbyStats,
  type QuickJoinResponse,
  type RoomSummary,
} from '@cardcraft-castles/protocol';
import { timingsFrom, type Env } from './env';
import { LobbyBook, type LobbyEntry } from './lobbyBook';
import { WindowLimiter } from './limits';
import { completeClose } from './room';
import type { LobbyRoomUpdate } from './roomCore';

export const LOBBY_RATE_LIMITS = {
  /** Rooms one IP may create per minute. */
  createsPerMinute: 6,
  /** Quick joins one IP may ask for per minute. */
  quickJoinsPerMinute: 20,
  /** Public rooms waiting for an opponent that one IP may have at once (keeps the list clean). */
  openRoomsPerIp: 3,
  /** Lobby connections from one IP (homes and schools share IPs, so it is generous). */
  socketsPerIp: 16,
  /** Lobby clients only listen; this many stray messages close the socket. */
  maxClientMessages: 30,
  /**
   * The online count is pushed at most this often (room counts go out with
   * every room change). No alarm is used for it, so it costs no writes.
   */
  onlineEveryMs: 10_000,
  /** While rooms are listed, stale ones are looked for this often. */
  pruneEveryMs: 15 * 60_000,
} as const;

export type LobbyResult<T> = { ok: true; value: T } | { ok: false; status: number; error: ApiErrorResponse['error'] };

export interface CreateRoomInput {
  nickname: string;
  name: string;
  private: boolean;
  /** Seconds per turn chosen by the host; null keeps the server's default. */
  turnSeconds: number | null;
  /** Seats: 2, or 3 for free-for-all. */
  size: number;
  /** Twilight Fury on or off. */
  twilight: boolean;
  clientId: string | null;
  ip: string;
}

export interface QuickJoinInput {
  nickname: string;
  clientId: string | null;
  ip: string;
}

interface Attachment {
  ip: string;
}

export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ROOM_ID_ALPHABET[b % ROOM_ID_ALPHABET.length]).join('');
}

/**
 * The single lobby: the directory of public rooms, pushed live to every
 * connected client, plus room creation and quick join (which is where the
 * per-IP limits live). Rooms report their own changes through `update` and
 * `remove`.
 */
export class Lobby extends DurableObject<Env> {
  private book = new LobbyBook();
  private readonly creates = new WindowLimiter(LOBBY_RATE_LIMITS.createsPerMinute, 60_000);
  private readonly quickJoins = new WindowLimiter(LOBBY_RATE_LIMITS.quickJoinsPerMinute, 60_000);
  /** Who created each room still waiting (memory only; never stored). */
  private readonly owners = new Map<string, string>();
  private readonly strayMessages = new Map<WebSocket, number>();
  private lastStats = '';
  private lastStatsAt = 0;
  private pruneArmed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      this.book = new LobbyBook((await ctx.storage.get<LobbyEntry[]>('rooms')) ?? []);
    });
  }

  // ---------------------------------------------------------------------------
  // RPC from the Worker
  // ---------------------------------------------------------------------------

  async list(): Promise<RoomSummary[]> {
    return this.book.list();
  }

  async createRoom(input: CreateRoomInput): Promise<LobbyResult<RoomSummary>> {
    const now = Date.now();
    if (this.limited()) {
      const wait = this.creates.hit(input.ip, now);
      if (wait > 0) return this.tooMany('rateLimited', 'Too many rooms created; try again in a moment', wait);
      if (!input.private && this.openRoomsOf(input.ip) >= LOBBY_RATE_LIMITS.openRoomsPerIp) {
        return this.tooMany('tooManyRooms', 'You already have rooms waiting for an opponent');
      }
    }
    const summary = await this.spawnRoom(input, now);
    return { ok: true, value: summary };
  }

  async quickJoin(input: QuickJoinInput): Promise<LobbyResult<QuickJoinResponse>> {
    const now = Date.now();
    if (this.limited()) {
      const wait = this.quickJoins.hit(input.ip, now);
      if (wait > 0) return this.tooMany('rateLimited', 'Too many requests; try again in a moment', wait);
    }
    const open = this.book.pickOpen(input.clientId, now);
    if (open) return { ok: true, value: { room: open, created: false } };
    const room = await this.spawnRoom(
      {
        nickname: input.nickname,
        name: cleanRoomName(`Partida rápida de ${input.nickname}`) ?? 'Partida rápida',
        private: false,
        turnSeconds: null,
        size: 2,
        twilight: true,
        clientId: input.clientId,
        ip: input.ip,
      },
      now,
    );
    return { ok: true, value: { room, created: true } };
  }

  // ---------------------------------------------------------------------------
  // RPC from rooms
  // ---------------------------------------------------------------------------

  async update(update: LobbyRoomUpdate): Promise<void> {
    if (!update.open && update.summary.status !== 'waiting') this.owners.delete(update.summary.id);
    this.changed(this.book.update(update, Date.now()));
  }

  async remove(id: string): Promise<void> {
    this.owners.delete(id);
    this.changed(this.book.remove(id));
  }

  // ---------------------------------------------------------------------------
  // Lobby socket
  // ---------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ip } satisfies Attachment);
    const sameIp = this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.ip === ip);
    if (this.limited() && sameIp.length > LOBBY_RATE_LIMITS.socketsPerIp) {
      server.close(CLOSE_CODES.tooManyConnections, 'Too many lobby connections');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.send(server, { type: 'snapshot', rooms: this.book.list(), stats: this.stats() });
    this.statsChanged(false);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket): Promise<void> {
    const count = (this.strayMessages.get(ws) ?? 0) + 1;
    this.strayMessages.set(ws, count);
    if (count > LOBBY_RATE_LIMITS.maxClientMessages) ws.close(CLOSE_CODES.abuse, 'The lobby only listens');
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    completeClose(ws, code, reason);
    this.strayMessages.delete(ws);
    this.statsChanged(false);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.strayMessages.delete(ws);
    this.statsChanged(false);
  }

  /** Periodic pruning of rooms that stopped reporting. */
  override async alarm(): Promise<void> {
    this.pruneArmed = false;
    const pruned = this.book.prune(Date.now());
    for (const message of pruned) this.broadcast(message);
    if (pruned.length > 0) {
      await this.save();
      this.statsChanged(true);
    }
    await this.armPrune();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async spawnRoom(input: CreateRoomInput, now: number): Promise<RoomSummary> {
    const base = timingsFrom(this.env);
    const timings = input.turnSeconds !== null ? { ...base, turnSeconds: input.turnSeconds } : base;
    for (let attempt = 0; ; attempt++) {
      const id = newRoomId();
      try {
        const update = await this.env.ROOM.get(this.env.ROOM.idFromName(id)).create({
          id,
          name: input.name,
          host: input.nickname,
          private: input.private,
          timings,
          size: input.size,
          twilight: input.twilight,
        });
        if (!input.private) {
          this.owners.set(id, input.ip);
          this.changed(this.book.update(update, now, input.clientId));
        }
        return update.summary;
      } catch (error) {
        // Only an id collision is worth a retry, and two in a row means something else is wrong.
        if (attempt >= 1) throw error;
      }
    }
  }

  private openRoomsOf(ip: string): number {
    let count = 0;
    for (const owner of this.owners.values()) if (owner === ip) count += 1;
    return count;
  }

  private limited(): boolean {
    return this.env.RATE_LIMITS !== 'off';
  }

  private tooMany<T>(code: 'rateLimited' | 'tooManyRooms', message: string, retryAfterMs?: number): LobbyResult<T> {
    return { ok: false, status: 429, error: { code, message, ...(retryAfterMs ? { retryAfterMs } : {}) } };
  }

  private stats(): LobbyStats {
    const online = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).length;
    return this.book.stats(online);
  }

  /** A room changed: tell subscribers, store the list and keep the stats current. */
  private changed(message: LobbyServerMessage | null): void {
    if (message) this.broadcast(message);
    void this.save();
    this.statsChanged(true);
    void this.armPrune();
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('rooms', this.book.save());
  }

  /**
   * Push the stats if the room counts changed, or if only the online count
   * changed and it has not been pushed for a while.
   */
  private statsChanged(roomsChanged: boolean): void {
    const stats = this.stats();
    const key = `${stats.waiting}/${stats.playing}`;
    const now = Date.now();
    const due = now - this.lastStatsAt >= LOBBY_RATE_LIMITS.onlineEveryMs;
    if ((roomsChanged && key !== this.lastStats) || due) {
      this.lastStats = key;
      this.lastStatsAt = now;
      this.broadcast({ type: 'stats', stats });
    }
  }

  /** Make sure an alarm will look for stale rooms while any are listed. */
  private async armPrune(): Promise<void> {
    if (this.pruneArmed || this.book.size === 0) return;
    this.pruneArmed = true;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + LOBBY_RATE_LIMITS.pruneEveryMs);
    }
  }

  private broadcast(message: LobbyServerMessage): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // Closing; cleaned up on its own.
      }
    }
  }

  private send(ws: WebSocket, message: LobbyServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Closing.
    }
  }
}
