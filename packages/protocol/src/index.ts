/**
 * Messages exchanged between the client and the server, as JSON over
 * WebSocket, plus the small HTTP API of the lobby.
 *
 * The client never decides the outcome of a move: it sends intentions and the
 * server answers with each player's own view of the game. Use the typed SDK in
 * `@cardcraft-castles/protocol/client` instead of speaking this protocol by
 * hand; it handles reconnection, resuming a seat and the turn clock.
 */
import type {
  Action,
  ErrorCode as EngineErrorCode,
  GameEvent,
  GameOverReason,
  HeroId,
  PlayerId,
  PlayerView,
} from '@cardcraft-castles/engine';

export * from './validate';

/** Bumped on every breaking change; the server rejects other versions. */
export const PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** HTTP and WebSocket routes served by the Worker. */
export const ROUTES = {
  /** GET: `HealthResponse`. */
  health: '/api/health',
  /** GET: `RoomListResponse` (public rooms). POST `CreateRoomRequest`: `RoomResponse`. */
  rooms: '/api/rooms',
  /** GET: `RoomResponse` for one room, public or private (invite links). 404 when it does not exist. */
  room: (roomId: string): string => `/api/rooms/${roomId}`,
  /** POST `QuickJoinRequest`: `QuickJoinResponse`. Finds an open room or creates one. */
  quickJoin: '/api/quick-join',
  /** WebSocket: live list of public rooms (`LobbyServerMessage`). */
  lobbySocket: '/api/lobby',
  /** WebSocket of one room (`RoomClientMessage` / `RoomServerMessage`). */
  roomSocket: (roomId: string): string => `/api/rooms/${roomId}/ws`,
} as const;

/** Room ids are 8 characters from this alphabet (no 0/o, 1/l/i). */
export const ROOM_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const ROOM_ID_PATTERN = /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/;

/** Query parameter of invite links: `https://game.example/?room=abcd2345`. */
export const INVITE_PARAM = 'room';

/**
 * Plain-text heartbeat. The client sends `"ping"` and the server answers
 * `"pong"` without waking the room, so it costs nothing.
 */
export const PING = 'ping';
export const PONG = 'pong';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Nicknames are trimmed and cut to this many characters. */
  nicknameMax: 20,
  roomNameMax: 32,
  /** Larger WebSocket messages are rejected. */
  messageBytes: 4096,
} as const;

/**
 * Timings the server uses. They are fixed in production; tests and local
 * development may shorten them.
 */
export interface RoomTimings {
  /** Seconds a player has for their turn. When it runs out the server plays `timeout`. */
  turnSeconds: number;
  /** A seated player who drops has this long to come back before forfeiting. */
  reconnectMs: number;
  /** While waiting for an opponent the host has this long to come back. */
  waitingReconnectMs: number;
  /** This many timeouts in a row by the same player forfeit the game. */
  afkTimeouts: number;
}

/** Turn lengths a host can pick when creating a room, in seconds. 0 means no time limit. */
export const TURN_SECONDS_OPTIONS = [15, 30, 45, 60, 90, 0] as const;

/** `turnSeconds` value for turns with no time limit. */
export const UNLIMITED_TURN = 0;

export const DEFAULT_TIMINGS: RoomTimings = {
  turnSeconds: 30,
  reconnectMs: 60_000,
  waitingReconnectMs: 20_000,
  afkTimeouts: 3,
};

/** WebSocket close codes the server uses. The SDK does not reconnect after them. */
export const CLOSE_CODES = {
  /** The same seat connected from somewhere else (another tab or device). */
  replaced: 4000,
  /** The room was closed (everyone left, or it expired). */
  roomClosed: 4001,
  /** Every seat is taken and you hold no seat token. */
  roomFull: 4003,
  /** Too many invalid or too frequent messages. */
  abuse: 4008,
  roomNotFound: 4004,
  /** The room already has as many connections as it allows. */
  tooManyConnections: 4029,
  /** The client speaks another protocol version: reload the page. */
  outdated: 4026,
} as const;

export type CloseReason = keyof typeof CLOSE_CODES;

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: true;
  game: string;
  protocol: number;
  cards: number;
}

export type RoomStatus =
  /** One player is seated and waiting for an opponent. */
  | 'waiting'
  | 'playing'
  /** The game is over; the players may ask for a rematch. */
  | 'finished'
  | 'closed';

export interface RoomSummary {
  id: string;
  name: string;
  /** Nickname of the player who created the room. */
  host: string;
  status: RoomStatus;
  /** Seated players (0 to `size`). */
  players: number;
  /** Seats in the room: 2 for a duel, 3 for free-for-all. Absent from old servers: 2. */
  size?: number;
  /** Private rooms are only reachable with their link and never listed. */
  private: boolean;
  createdAt: number;
  /** Seconds per turn in this room. */
  turnSeconds: number;
}

export interface CreateRoomRequest {
  nickname: string;
  /** Defaults to "Sala de <nickname>". */
  name?: string;
  private?: boolean;
  /** Seconds per turn, one of `TURN_SECONDS_OPTIONS` (0: no limit). Defaults to the server's turn length. */
  turnSeconds?: number;
  /** Random id the SDK keeps per browser, so quick join never pairs you with yourself. */
  clientId?: string;
  /** Seats: 2 (default) or 3 for a free-for-all room. */
  size?: number;
}

/** Room sizes a host can pick: a duel or a 3-player free-for-all. */
export const ROOM_SIZES = [2, 3] as const;

export interface QuickJoinRequest {
  nickname: string;
  clientId?: string;
}

export interface RoomResponse {
  room: RoomSummary;
}

export interface RoomListResponse {
  rooms: RoomSummary[];
}

export interface QuickJoinResponse {
  room: RoomSummary;
  /** True when no room was waiting and a new one was created for you. */
  created: boolean;
}

export type ApiErrorCode = 'badRequest' | 'notFound' | 'rateLimited' | 'tooManyRooms' | 'internal';

/** Body of every non-2xx HTTP answer. */
export interface ApiErrorResponse {
  error: { code: ApiErrorCode; message: string; retryAfterMs?: number };
}

// ---------------------------------------------------------------------------
// Lobby socket
// ---------------------------------------------------------------------------

export interface LobbyStats {
  /** Clients connected to the lobby right now. */
  online: number;
  /** Public rooms waiting for an opponent. */
  waiting: number;
  /** Public rooms with a game in progress. */
  playing: number;
}

/**
 * The lobby sends a snapshot on connect and then only changes. Rooms with
 * nobody seated yet and private rooms are never listed.
 */
export type LobbyServerMessage =
  | { type: 'snapshot'; rooms: RoomSummary[]; stats: LobbyStats }
  /** A room appeared or changed. */
  | { type: 'room'; room: RoomSummary }
  | { type: 'roomRemoved'; id: string }
  | { type: 'stats'; stats: LobbyStats };

// ---------------------------------------------------------------------------
// Room socket
// ---------------------------------------------------------------------------

/** A hero, or `'random'` to let the server pick one when the game starts. */
export type HeroChoice = HeroId | 'random';

/** Quick reactions. There is no free-text chat, so there is nothing to moderate. */
export const EMOTES = ['greetings', 'wellPlayed', 'thanks', 'wow', 'oops', 'threaten'] as const;
export type Emote = (typeof EMOTES)[number];

/** Everything a client may do in a game. `timeout` belongs to the server. */
export type PlayerAction = Exclude<Action, { type: 'timeout' }>;

/**
 * Same as `PlayerAction` without `player`: the server always uses the seat of
 * the socket that sent it.
 */
export type ActionIntent =
  | { type: 'play'; uid: number }
  /** `also`: more cards discarded in the same action (the rules cap the total). */
  | { type: 'discard'; uid: number; also?: number[] }
  | { type: 'ultimate' }
  | { type: 'choose'; option: string }
  | { type: 'concede' };

export type RoomClientMessage =
  /** Take a free seat. `v` is `PROTOCOL_VERSION`. */
  | {
      type: 'join';
      v: number;
      nickname: string;
      hero: HeroChoice;
      /** Public random id this browser keeps, so opponents can keep a head-to-head record. See `isPlayerId`. */
      pid?: string;
    }
  /** Take back your seat after a disconnect, with the token from `welcome`. */
  | { type: 'resume'; v: number; token: string }
  /** `player` is optional and ignored: the server uses the sender's seat. */
  | { type: 'action'; action: ActionIntent | PlayerAction }
  /** After the game: ask for another one, optionally with another hero. */
  | { type: 'rematch'; hero?: HeroChoice }
  | { type: 'emote'; emote: Emote }
  /**
   * Leave for good: frees your seat while waiting, concedes a running game
   * and rules out a rematch afterwards.
   */
  | { type: 'leave' }
  /** Ask for a full snapshot (`room`, then `state` if there is a game). */
  | { type: 'sync' };

export interface SeatInfo {
  nickname: string;
  /** The player's public browser id (`join.pid`), or null if their client sent none. */
  pid: string | null;
  /** Hero of the current or last game; null before the first game starts. */
  hero: HeroId | null;
  /** True while this player has a live connection. */
  connected: boolean;
  /** When the player dropped: epoch ms at which they forfeit if they are not back. */
  reconnectBy: number | null;
  /** The player left for good. */
  left: boolean;
  /** The player asked for a rematch. */
  rematch: boolean;
}

export type ForfeitCause =
  /** Pressed "concede". */
  | 'conceded'
  /** Left the room during the game. */
  | 'left'
  /** Lost the connection and did not come back in time. */
  | 'disconnected'
  /** Let the clock run out `afkTimeouts` turns in a row. */
  | 'inactive';

/** How the last game ended, with what the engine's `result` does not say. */
export interface GameEnding {
  winner: PlayerId | null;
  reason: GameOverReason;
  forfeit: { seat: PlayerId; cause: ForfeitCause } | null;
}

export interface RoomInfo {
  id: string;
  name: string;
  private: boolean;
  status: RoomStatus;
  /** One entry per seat: 2 in a duel, 3 in a free-for-all room. */
  seats: (SeatInfo | null)[];
  /** Games won by each seat in this room (rematches add up). */
  score: number[];
  /** Games started in this room. */
  games: number;
  ending: GameEnding | null;
  timings: RoomTimings;
}

export type RoomErrorCode =
  | 'badMessage'
  | 'outdated'
  | 'roomNotFound'
  | 'roomFull'
  | 'roomClosed'
  | 'badToken'
  | 'alreadySeated'
  | 'notSeated'
  | 'notPlaying'
  | 'badHero'
  | 'rematchUnavailable'
  | 'rateLimited'
  | EngineErrorCode;

export type RoomServerMessage =
  /** You are seated (after `join` or `resume`). Keep `token` to resume later. */
  | { type: 'welcome'; seat: PlayerId; token: string; room: RoomInfo; now: number }
  /** Seats, presence, score or status changed. Also sent on connect, before joining. */
  | { type: 'room'; room: RoomInfo; now: number }
  /**
   * The game as you may see it, with what just happened (empty `events` and
   * `resumed: true` after a resume or `sync`). `deadline` is the epoch time in
   * ms at which the current turn times out; `now` is the server clock, to
   * correct for skew.
   */
  | {
      type: 'state';
      view: PlayerView;
      events: GameEvent[];
      deadline: number | null;
      now: number;
      resumed: boolean;
    }
  | { type: 'emote'; seat: PlayerId; emote: Emote }
  | { type: 'error'; code: RoomErrorCode; message: string };
