/**
 * Messages exchanged between the client and the server, as JSON over
 * WebSocket (and a couple of plain HTTP endpoints for the lobby).
 *
 * This is the first draft that the server shell speaks. The server thread
 * owns it from here: reconnection tokens, rematch, emotes and private rooms
 * are still to be added.
 */
import type { Action, GameEvent, HeroId, PlayerId, PlayerView } from '@cardcraft-castles/engine';

export const PROTOCOL_VERSION = 1;

/** HTTP and WebSocket routes served by the Worker. */
export const ROUTES = {
  health: '/api/health',
  /** GET: list of rooms. POST `CreateRoomRequest`: create one. */
  rooms: '/api/rooms',
  /** WebSocket: live list of rooms (`LobbyServerMessage`). */
  lobbySocket: '/api/lobby',
  /** WebSocket of one room (`RoomClientMessage` / `RoomServerMessage`). */
  roomSocket: (roomId: string): string => `/api/rooms/${roomId}/ws`,
} as const;

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomSummary {
  id: string;
  name: string;
  /** Nickname of the player who created the room. */
  host: string;
  status: RoomStatus;
  players: number;
  createdAt: number;
}

export interface CreateRoomRequest {
  name: string;
  host: string;
}

export type LobbyServerMessage = { type: 'rooms'; rooms: RoomSummary[] };

/** Everything a client may do in a game. `timeout` belongs to the server. */
export type PlayerAction = Exclude<Action, { type: 'timeout' }>;

export type RoomClientMessage =
  /** Take a seat. Must be the first message on the socket. */
  | { type: 'join'; nickname: string; hero: HeroId }
  /** `action.player` is ignored: the server uses the sender's seat. */
  | { type: 'action'; action: PlayerAction };

export interface SeatInfo {
  nickname: string;
  hero: HeroId;
}

export type RoomServerMessage =
  /** You are seated; the game starts when both seats are taken. */
  | { type: 'joined'; seat: PlayerId; seats: [SeatInfo | null, SeatInfo | null] }
  /**
   * The game as you may see it, with what just happened. `deadline` is the
   * epoch time in milliseconds at which the current turn times out.
   */
  | { type: 'state'; view: PlayerView; events: GameEvent[]; seats: [SeatInfo, SeatInfo]; deadline: number | null }
  | { type: 'error'; code: string; message: string };
