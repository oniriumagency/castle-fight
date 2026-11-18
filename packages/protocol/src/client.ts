/**
 * Typed client SDK for the Cardcraft: Castles server. Works in browsers and
 * in Node 22+ (both have `WebSocket` and `fetch`).
 *
 *   const online = new OnlineClient();                       // same origin as the page
 *   const lobby = online.connectLobby();
 *   lobby.on('rooms', (rooms) => render(rooms));
 *
 *   const { room } = await online.quickJoin({ nickname: 'Magne' });
 *   const game = online.joinRoom(room.id, { nickname: 'Magne', hero: 'random' });
 *   game.on('state', ({ view, events, resumed }) => animate(view, events, resumed));
 *   game.play(uid);
 *
 * Connections reconnect on their own with backoff, and a room connection
 * takes its seat back with the token the server gave it (kept in
 * `localStorage`), so a page reload or a network blip resumes the game.
 */
import { legalActions, type GameEvent, type PlayerId, type PlayerView } from '@cardcraft-castles/engine';
import {
  CLOSE_CODES,
  INVITE_PARAM,
  PING,
  PONG,
  PROTOCOL_VERSION,
  ROUTES,
  type ActionIntent,
  type ApiErrorCode,
  type ApiErrorResponse,
  type CloseReason,
  type CreateRoomRequest,
  type Emote,
  type HealthResponse,
  type HeroChoice,
  type LobbyServerMessage,
  type LobbyStats,
  type QuickJoinResponse,
  type RoomClientMessage,
  type RoomErrorCode,
  type RoomInfo,
  type RoomListResponse,
  type RoomResponse,
  type RoomServerMessage,
  type RoomSummary,
} from './index';
import { isPlayerId, isRoomId } from './validate';

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/** The part of the standard `WebSocket` the SDK uses. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

/** `localStorage`, `sessionStorage` or anything with the same three methods. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OnlineClientOptions {
  /** Server origin, such as `https://castles.example.workers.dev`. Defaults to the page's origin. */
  baseUrl?: string;
  /** Defaults to the global `WebSocket`. */
  createSocket?: WebSocketFactory;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Where seat tokens and the client id are kept. Defaults to `localStorage`; `null` keeps them in memory. */
  storage?: KeyValueStorage | null;
  /** How often to check that the connection is alive. Default 20 s. */
  heartbeatMs?: number;
}

const STORAGE_PREFIX = 'cardcraft:';
/** Seat tokens older than this are not worth trying. */
const SEAT_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

const OPEN = 1;

interface Platform {
  baseUrl: string;
  createSocket: WebSocketFactory;
  fetch: FetchLike;
  storage: KeyValueStorage;
  heartbeatMs: number;
}

function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function defaultStorage(): KeyValueStorage {
  try {
    const storage = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (storage) {
      storage.getItem(`${STORAGE_PREFIX}probe`);
      return storage;
    }
  } catch {
    // Private mode or blocked storage.
  }
  return memoryStorage();
}

function safeStorage(storage: KeyValueStorage): KeyValueStorage {
  return {
    getItem: (key) => {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage.setItem(key, value);
      } catch {
        // Quota or blocked storage: the seat simply will not survive a reload.
      }
    },
    removeItem: (key) => {
      try {
        storage.removeItem(key);
      } catch {
        // Same as above.
      }
    },
  };
}

function randomId(bytes = 12): string {
  const data = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(data);
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
}

function closeReasonOf(code: number): CloseReason | null {
  for (const [reason, value] of Object.entries(CLOSE_CODES)) {
    if (value === code) return reason as CloseReason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

/** A tiny typed event emitter. */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  /** Listen to `type`. Returns a function that stops listening. */
  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener as (payload: never) => void);
    return () => void set.delete(listener as (payload: never) => void);
  }

  /** The next `type` event (that passes `test`, if given). */
  once<K extends keyof Events>(type: K, test: (payload: Events[K]) => boolean = () => true): Promise<Events[K]> {
    return new Promise((resolve) => {
      const stop = this.on(type, (payload) => {
        if (!test(payload)) return;
        stop();
        resolve(payload);
      });
    });
  }

  protected emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try {
        (listener as (payload: Events[K]) => void)(payload);
      } catch (error) {
        // A broken listener must not break the connection; surface it asynchronously.
        setTimeout(() => {
          throw error;
        });
      }
    }
  }
}

export type ConnectionStatus =
  /** First connection attempt. */
  | 'connecting'
  | 'open'
  /** The connection dropped; retrying with backoff. */
  | 'reconnecting'
  /** Closed for good (see the `closed` event of a room). */
  | 'closed';

// ---------------------------------------------------------------------------
// Reconnecting socket
// ---------------------------------------------------------------------------

abstract class ManagedSocket<Events extends { status: ConnectionStatus }> extends Emitter<Events> {
  private socket: WebSocketLike | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  /** When the last ping went out still unanswered, or 0. */
  private pingSentAt = 0;
  private detachWindow: (() => void) | null = null;
  private currentStatus: ConnectionStatus = 'connecting';
  protected stopped = false;

  constructor(
    private readonly url: string,
    protected readonly platform: Platform,
  ) {
    super();
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  /** Close for good. No more reconnection attempts. */
  close(): void {
    this.shutDown(1000, 'client closed');
  }

  protected start(): void {
    this.watchWindow();
    this.connect();
  }

  protected abstract onOpen(): void;
  protected abstract onMessage(message: unknown): void;
  /** A close the SDK must not retry. */
  protected abstract onTerminalClose(code: number, reason: string): void;

  protected sendRaw(text: string): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    try {
      this.socket.send(text);
      return true;
    } catch {
      return false;
    }
  }

  protected setStatus(status: ConnectionStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.emit('status', status as Events['status']);
  }

  protected shutDown(code: number, reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    this.detachWindow?.();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = socket.onmessage = socket.onopen = socket.onerror = null;
      try {
        socket.close(code, reason);
      } catch {
        // Already closing.
      }
    }
    this.setStatus('closed');
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: WebSocketLike;
    try {
      socket = this.platform.createSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.lastHeard = Date.now();
      this.pingSentAt = 0;
      this.startHeartbeat();
      this.setStatus('open');
      this.onOpen();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastHeard = Date.now();
      const data = typeof event.data === 'string' ? event.data : '';
      if (data === PONG || data === '') return;
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      this.onMessage(message);
    };
    socket.onerror = () => {
      // A close event always follows.
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.dropped(event.code, event.reason);
    };
  }

  private dropped(code: number, reason: string): void {
    this.socket = null;
    this.clearTimers();
    if (this.stopped) return;
    if (code >= 4000 && code < 5000) {
      this.onTerminalClose(code, reason);
      this.shutDown(1000, 'terminal');
      return;
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.setStatus('reconnecting');
    const base = Math.min(10_000, 400 * 2 ** this.attempts);
    this.attempts += 1;
    const delay = base * (0.75 + Math.random() * 0.5);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Skip the backoff wait (the browser came back online or the tab became visible). */
  private retryNow(): void {
    if (this.stopped || this.socket || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  }

  private startHeartbeat(): void {
    const every = this.platform.heartbeatMs;
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket) return;
      // Dead only if a ping went unanswered for a whole beat. Comparing with the
      // last message alone misfired in background tabs, whose timers the browser
      // slows to about once a minute: the tab dropped a healthy connection and
      // opened a new one every minute.
      const now = Date.now();
      if (this.pingSentAt > this.lastHeard && now - this.pingSentAt > every) {
        // Nothing heard for two beats: the connection is dead even if the browser has not noticed.
        socket.onclose = socket.onmessage = socket.onopen = socket.onerror = null;
        try {
          socket.close(4999, 'heartbeat');
        } catch {
          // Ignore.
        }
        this.dropped(1006, 'heartbeat');
        return;
      }
      if (this.sendRaw(PING) && this.pingSentAt <= this.lastHeard) this.pingSentAt = now;
    }, every);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.retryTimer = null;
    this.heartbeatTimer = null;
  }

  private watchWindow(): void {
    const target = globalThis as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
      document?: { visibilityState?: string };
    };
    if (typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return;
    const onOnline = (): void => this.retryNow();
    const onVisible = (): void => {
      if (target.document?.visibilityState === 'visible') this.retryNow();
    };
    target.addEventListener('online', onOnline);
    target.addEventListener('visibilitychange', onVisible);
    this.detachWindow = () => {
      target.removeEventListener?.('online', onOnline);
      target.removeEventListener?.('visibilitychange', onVisible);
    };
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export interface LobbyEvents {
  status: ConnectionStatus;
  /** The whole list, sorted: waiting rooms first, newest first. */
  rooms: RoomSummary[];
  stats: LobbyStats;
}

/** Live list of public rooms. */
export class LobbyConnection extends ManagedSocket<LobbyEvents> {
  private readonly byId = new Map<string, RoomSummary>();
  private sorted: RoomSummary[] = [];
  private currentStats: LobbyStats = { online: 0, waiting: 0, playing: 0 };

  constructor(url: string, platform: Platform) {
    super(url, platform);
    this.start();
  }

  get rooms(): readonly RoomSummary[] {
    return this.sorted;
  }

  get stats(): LobbyStats {
    return this.currentStats;
  }

  protected onOpen(): void {
    // The server sends a snapshot on its own.
  }

  protected onTerminalClose(): void {
    // The lobby never closes a client on purpose except for abuse; nothing to report.
  }

  protected onMessage(raw: unknown): void {
    const message = raw as LobbyServerMessage;
    switch (message.type) {
      case 'snapshot':
        this.byId.clear();
        for (const room of message.rooms) this.byId.set(room.id, room);
        this.currentStats = message.stats;
        this.emit('stats', message.stats);
        break;
      case 'room':
        this.byId.set(message.room.id, message.room);
        break;
      case 'roomRemoved':
        if (!this.byId.delete(message.id)) return;
        break;
      case 'stats':
        this.currentStats = message.stats;
        this.emit('stats', message.stats);
        return;
      default:
        return;
    }
    this.sorted = [...this.byId.values()].sort(
      (a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || b.createdAt - a.createdAt,
    );
    this.emit('rooms', this.sorted);
  }
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

/** Why a room connection ended for good. */
export type RoomEndReason =
  | CloseReason
  /** You called `leave()`. */
  | 'left'
  /** You called `close()`. */
  | 'closedByClient'
  /** Your seat is gone: you were away too long and lost the game, or the room expired. */
  | 'seatLost';

export interface RoomStateUpdate {
  view: PlayerView;
  /** What just happened, to animate. Empty after a resume. */
  events: GameEvent[];
  /** Epoch ms (local clock, already corrected) at which the turn times out. */
  deadline: number | null;
  /** True after a reconnection or `sync()`: draw the view directly, without animating. */
  resumed: boolean;
}

export interface RoomEvents {
  status: ConnectionStatus;
  /** You took (or took back) a seat. Comes again after every reconnection. */
  welcome: { seat: PlayerId; room: RoomInfo };
  /** Room info. `seats[i].reconnectBy` is already on the local clock. */
  room: RoomInfo;
  state: RoomStateUpdate;
  emote: { seat: PlayerId; emote: Emote; mine: boolean };
  /** Something you sent was refused (illegal move, too many emotes...). The connection stays up. */
  error: { code: RoomErrorCode; message: string };
  /** The connection ended for good. */
  closed: { reason: RoomEndReason; message: string };
}

export interface JoinOptions {
  nickname: string;
  hero: HeroChoice;
  /** Public browser id; `OnlineClient.joinRoom` fills it in. */
  pid?: string;
}

interface StoredSeat {
  token: string;
  seat: PlayerId;
  at: number;
}

/**
 * One room. Created by `OnlineClient.joinRoom` (takes a seat, or takes back
 * the one this browser already had) or `OnlineClient.watchRoom` (only room
 * info, for an invite page).
 */
export class RoomConnection extends ManagedSocket<RoomEvents> {
  private currentSeat: PlayerId | null = null;
  private currentRoom: RoomInfo | null = null;
  private currentView: PlayerView | null = null;
  private currentDeadline: number | null = null;
  /** Server clock minus local clock, in ms. */
  private clockOffset = 0;
  private finished = false;

  constructor(
    readonly roomId: string,
    url: string,
    platform: Platform,
    private join: JoinOptions | null,
  ) {
    super(url, platform);
    this.start();
  }

  /** Your seat, once the server has seated you. */
  get seat(): PlayerId | null {
    return this.currentSeat;
  }

  get room(): RoomInfo | null {
    return this.currentRoom;
  }

  get view(): PlayerView | null {
    return this.currentView;
  }

  /** Local epoch ms at which the current turn times out. */
  get deadline(): number | null {
    return this.currentDeadline;
  }

  /** Milliseconds left on the turn clock, or null when no clock is running. */
  timeLeft(now = Date.now()): number | null {
    return this.currentDeadline === null ? null : Math.max(0, this.currentDeadline - now);
  }

  isMyTurn(): boolean {
    const view = this.currentView;
    return !!view && view.phase !== 'finished' && view.active === view.viewer;
  }

  /** Every move you can make now (empty when it is not your turn). */
  legalActions(): ActionIntent[] {
    if (!this.currentView) return [];
    return legalActions(this.currentView).flatMap((action): ActionIntent[] => {
      switch (action.type) {
        case 'play':
          return [{ type: 'play', uid: action.uid }];
        case 'discard':
          return [{ type: 'discard', uid: action.uid }];
        case 'choose':
          return [{ type: 'choose', option: action.option }];
        case 'ultimate':
          return [{ type: 'ultimate' }];
        default:
          return [];
      }
    });
  }

  /** Send a move. Returns false when it could not be sent (not connected or not seated). */
  act(action: ActionIntent): boolean {
    if (this.currentSeat === null) return false;
    return this.send({ type: 'action', action });
  }

  play(uid: number): boolean {
    return this.act({ type: 'play', uid });
  }

  /** Discard `uid`, and the cards in `also` with the same action. */
  discard(uid: number, also: readonly number[] = []): boolean {
    return this.act(also.length ? { type: 'discard', uid, also: [...also] } : { type: 'discard', uid });
  }

  ultimate(): boolean {
    return this.act({ type: 'ultimate' });
  }

  choose(option: string): boolean {
    return this.act({ type: 'choose', option });
  }

  concede(): boolean {
    return this.act({ type: 'concede' });
  }

  /** After the game: ask for another one, optionally with another hero. */
  rematch(hero?: HeroChoice): boolean {
    if (this.currentSeat === null) return false;
    return this.send(hero === undefined ? { type: 'rematch' } : { type: 'rematch', hero });
  }

  emote(emote: Emote): boolean {
    if (this.currentSeat === null) return false;
    return this.send({ type: 'emote', emote });
  }

  /** Ask the server for a full snapshot (the next `state` has `resumed: true`). */
  sync(): boolean {
    return this.send({ type: 'sync' });
  }

  /**
   * Leave for good: frees your seat while waiting, concedes a running game
   * and rules out a rematch. The connection closes.
   */
  leave(): void {
    if (this.stopped) return;
    this.send({ type: 'leave' });
    this.forgetSeat();
    this.end('left', 'You left the room');
  }

  /** Close the connection but keep the seat: you can come back with `joinRoom` until the grace period ends. */
  override close(): void {
    this.end('closedByClient', 'Connection closed by the client');
  }

  protected onOpen(): void {
    const stored = this.storedSeat();
    if (stored) this.send({ type: 'resume', v: PROTOCOL_VERSION, token: stored.token });
    else if (this.join) this.send({ type: 'join', v: PROTOCOL_VERSION, ...this.join });
  }

  protected onTerminalClose(code: number, reason: string): void {
    const why = closeReasonOf(code) ?? 'roomClosed';
    if (why !== 'replaced') this.forgetSeat();
    this.finishWith(why, reason);
  }

  protected onMessage(raw: unknown): void {
    const message = raw as RoomServerMessage;
    switch (message.type) {
      case 'welcome': {
        this.clockOffset = message.now - Date.now();
        const room = this.localRoom(message.room);
        this.currentSeat = message.seat;
        this.currentRoom = room;
        this.platform.storage.setItem(
          this.seatKey(),
          JSON.stringify({ token: message.token, seat: message.seat, at: Date.now() } satisfies StoredSeat),
        );
        this.emit('welcome', { seat: message.seat, room });
        this.emit('room', room);
        break;
      }
      case 'room':
        this.clockOffset = message.now - Date.now();
        this.currentRoom = this.localRoom(message.room);
        this.emit('room', this.currentRoom);
        break;
      case 'state':
        this.clockOffset = message.now - Date.now();
        this.currentView = message.view;
        this.currentDeadline = message.deadline === null ? null : message.deadline - this.clockOffset;
        this.emit('state', {
          view: message.view,
          events: message.events,
          deadline: this.currentDeadline,
          resumed: message.resumed,
        });
        break;
      case 'emote':
        this.emit('emote', { seat: message.seat, emote: message.emote, mine: message.seat === this.currentSeat });
        break;
      case 'error':
        if (message.code === 'badToken') {
          // The stored seat is gone. While the room still waits for players we can take a new
          // one; once a game has started (and was lost by forfeit) there is nothing to go back to.
          this.forgetSeat();
          if (this.join && this.currentRoom?.status === 'waiting') {
            this.send({ type: 'join', v: PROTOCOL_VERSION, ...this.join });
          } else {
            this.end('seatLost', message.message);
          }
          return;
        }
        this.emit('error', { code: message.code, message: message.message });
        break;
      default:
        break;
    }
  }

  private send(message: RoomClientMessage): boolean {
    return this.sendRaw(JSON.stringify(message));
  }

  /** Server times in the room info, moved to the local clock. */
  private localRoom(room: RoomInfo): RoomInfo {
    const seat = (s: RoomInfo['seats'][number]): RoomInfo['seats'][number] =>
      s && s.reconnectBy !== null ? { ...s, reconnectBy: s.reconnectBy - this.clockOffset } : s;
    return { ...room, seats: room.seats.map(seat) };
  }

  private seatKey(): string {
    return `${STORAGE_PREFIX}seat:${this.roomId}`;
  }

  private storedSeat(): StoredSeat | null {
    const raw = this.platform.storage.getItem(this.seatKey());
    if (!raw) return null;
    try {
      const seat = JSON.parse(raw) as StoredSeat;
      if (typeof seat.token === 'string' && Date.now() - seat.at < SEAT_TOKEN_TTL_MS) return seat;
    } catch {
      // Corrupt entry.
    }
    this.forgetSeat();
    return null;
  }

  private forgetSeat(): void {
    this.platform.storage.removeItem(this.seatKey());
  }

  private end(reason: RoomEndReason, message: string): void {
    if (this.stopped) return;
    this.shutDown(1000, reason);
    this.finishWith(reason, message);
  }

  private finishWith(reason: RoomEndReason, message: string): void {
    if (this.finished) return;
    this.finished = true;
    this.join = null;
    this.emit('closed', { reason, message });
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OnlineError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'OnlineError';
  }
}

/** Entry point: the HTTP API plus factories for lobby and room connections. */
export class OnlineClient {
  private readonly platform: Platform;
  /** Random id kept per browser; lets quick join avoid pairing you with your own room. */
  readonly clientId: string;
  /** Public random id kept per browser. Sent when taking a seat, so opponents can count your games together. */
  readonly playerId: string;

  constructor(options: OnlineClientOptions = {}) {
    const location = (globalThis as { location?: { origin?: string } }).location;
    const baseUrl = (options.baseUrl ?? location?.origin ?? '').replace(/\/+$/, '');
    const createSocket =
      options.createSocket ??
      ((url: string) => {
        const Ctor = (globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
        if (!Ctor) throw new Error('No WebSocket implementation available');
        return new Ctor(url);
      });
    const fetchImpl =
      options.fetch ??
      ((url, init) => (globalThis as unknown as { fetch: FetchLike }).fetch(url, init));
    this.platform = {
      baseUrl,
      createSocket,
      fetch: fetchImpl,
      storage: safeStorage(options.storage === undefined ? defaultStorage() : (options.storage ?? memoryStorage())),
      heartbeatMs: options.heartbeatMs ?? 20_000,
    };
    const key = `${STORAGE_PREFIX}clientId`;
    let clientId = this.platform.storage.getItem(key);
    if (!clientId || !/^[0-9a-f]{24}$/.test(clientId)) {
      clientId = randomId();
      this.platform.storage.setItem(key, clientId);
    }
    this.clientId = clientId;
    // Separate from clientId, which stays private: this one is shown to opponents.
    const pidKey = `${STORAGE_PREFIX}playerId`;
    let playerId = this.platform.storage.getItem(pidKey);
    if (!playerId || !isPlayerId(playerId)) {
      playerId = randomId();
      this.platform.storage.setItem(pidKey, playerId);
    }
    this.playerId = playerId;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', ROUTES.health);
  }

  async listRooms(): Promise<RoomSummary[]> {
    return (await this.request<RoomListResponse>('GET', ROUTES.rooms)).rooms;
  }

  /** One room by id (public or private), or null if it does not exist. For invite links. */
  async getRoom(roomId: string): Promise<RoomSummary | null> {
    if (!isRoomId(roomId)) return null;
    try {
      return (await this.request<RoomResponse>('GET', ROUTES.room(roomId))).room;
    } catch (error) {
      if (error instanceof OnlineError && error.code === 'notFound') return null;
      throw error;
    }
  }

  /** Create a room. Then call `joinRoom` with its id to take the first seat. */
  async createRoom(request: Omit<CreateRoomRequest, 'clientId'>): Promise<RoomSummary> {
    const body: CreateRoomRequest = { ...request, clientId: this.clientId };
    return (await this.request<RoomResponse>('POST', ROUTES.rooms, body)).room;
  }

  /** Find a public room waiting for an opponent, or create one. Then call `joinRoom`. */
  quickJoin(request: { nickname: string }): Promise<QuickJoinResponse> {
    return this.request<QuickJoinResponse>('POST', ROUTES.quickJoin, { ...request, clientId: this.clientId });
  }

  connectLobby(): LobbyConnection {
    return new LobbyConnection(this.socketUrl(ROUTES.lobbySocket), this.platform);
  }

  /**
   * Connect to a room and take a seat. If this browser already holds a seat
   * there (page reload, dropped connection), it takes that seat back instead.
   */
  joinRoom(roomId: string, options: JoinOptions): RoomConnection {
    return new RoomConnection(roomId, this.socketUrl(ROUTES.roomSocket(roomId)), this.platform, { ...options, pid: options.pid ?? this.playerId });
  }

  /**
   * Connect without joining: you get `room` updates (and your seat back if
   * this browser holds one). Useful for an invite page before choosing a hero.
   */
  watchRoom(roomId: string): RoomConnection {
    return new RoomConnection(roomId, this.socketUrl(ROUTES.roomSocket(roomId)), this.platform, null);
  }

  /** True if this browser holds a seat in that room (so `joinRoom` will resume it). */
  hasSeat(roomId: string): boolean {
    return this.platform.storage.getItem(`${STORAGE_PREFIX}seat:${roomId}`) !== null;
  }

  /** Link that opens the game straight into a room: `<page>?room=<id>`. */
  inviteUrl(roomId: string, pageUrl?: string): string {
    const page = pageUrl ?? (globalThis as { location?: { href?: string } }).location?.href ?? this.platform.baseUrl;
    const url = new URL(page);
    url.search = '';
    url.hash = '';
    url.searchParams.set(INVITE_PARAM, roomId);
    return url.toString();
  }

  private socketUrl(path: string): string {
    return this.platform.baseUrl.replace(/^http/, 'ws') + path;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: FetchResponseLike;
    try {
      response = await this.platform.fetch(this.platform.baseUrl + path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new OnlineError('internal', `Network error: ${(error as Error).message}`, 0);
    }
    const data = (await response.json().catch(() => null)) as T | ApiErrorResponse | null;
    if (!response.ok || data === null) {
      const error = (data as ApiErrorResponse | null)?.error;
      throw new OnlineError(
        error?.code ?? 'internal',
        error?.message ?? `HTTP ${response.status}`,
        response.status,
        error?.retryAfterMs,
      );
    }
    return data as T;
  }
}

/** The room id of an invite link (`?room=<id>`), or null. */
export function roomIdFromUrl(url: string): string | null {
  try {
    const id = new URL(url).searchParams.get(INVITE_PARAM);
    return isRoomId(id) ? id : null;
  } catch {
    return null;
  }
}
