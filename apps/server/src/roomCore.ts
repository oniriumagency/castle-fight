/**
 * The rules of one room, independent of Cloudflare: seats, the authoritative
 * game, the turn clock, reconnection windows, rematch and cleanup.
 *
 * The Durable Object (`room.ts`) feeds it socket events and alarms and then
 * does what it asks: save `record`, arm the alarm at `nextWake()`, tell the
 * lobby about `summary()` and delete everything once `closed` is set. Tests
 * drive it directly with fake sockets and a fake clock.
 */
import {
  HEROES,
  applyAction,
  createGame,
  getPlayerView,
  redactEvents,
  type Action,
  type EngineError,
  type GameEvent,
  type GameState,
  type HeroId,
  type PlayerId,
} from '@cardcraft-castles/engine';
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  cleanNickname,
  otherSeat,
  parseRoomClientMessage,
  type ActionIntent,
  type Emote,
  type ForfeitCause,
  type GameEnding,
  type HeroChoice,
  type RoomErrorCode,
  type RoomInfo,
  type RoomServerMessage,
  type RoomStatus,
  type RoomSummary,
  type RoomTimings,
  type SeatInfo,
} from '@cardcraft-castles/protocol';
import { TokenBucket } from './limits';

/** Housekeeping limits that are not part of the protocol. */
export const ROOM_LIMITS = {
  /** Open sockets per room: two players plus a reconnecting tab or an invite page or two. */
  maxSockets: 6,
  /** Per socket: burst of messages, then this many per second. */
  messageBurst: 20,
  messagesPerSecond: 5,
  /** Bad or throttled messages a socket may send before it is closed. */
  maxStrikes: 10,
  emoteCooldownMs: 1500,
  /** A room nobody ever sat in is closed after this long. */
  emptyRoomMs: 2 * 60_000,
  /** A host may wait this long for an opponent. */
  waitingTtlMs: 30 * 60_000,
  /** After a game, the room stays this long for rematches and the result screen. */
  finishedTtlMs: 15 * 60_000,
} as const;

export interface SeatRecord {
  nickname: string;
  /** Hero for the next game. */
  choice: HeroChoice;
  /** Hero of the current or last game. */
  hero: HeroId | null;
  /** Secret that lets this player take the seat back. Only ever sent to them. */
  token: string;
  reconnectBy: number | null;
  left: boolean;
  rematch: boolean;
  /** Turn timeouts in a row. */
  timeouts: number;
}

/** Everything a room stores. One record, so each change is a single write. */
export interface RoomRecord {
  version: 1;
  id: string;
  name: string;
  host: string;
  private: boolean;
  createdAt: number;
  status: RoomStatus;
  seats: [SeatRecord | null, SeatRecord | null];
  score: [number, number];
  games: number;
  game: GameState | null;
  /** The turn the clock is running for and when it runs out. */
  clock: { turn: number; deadline: number } | null;
  ending: GameEnding | null;
  endedAt: number | null;
  timings: RoomTimings;
}

/** What the lobby needs: the public summary plus whether quick join may use it. */
export interface LobbyRoomUpdate {
  summary: RoomSummary;
  /** Waiting, one player seated and connected: anyone may join. */
  open: boolean;
}

/** The platform the core runs on: sockets, clock and randomness. */
export interface RoomHost<S> {
  now(): number;
  /** Open sockets of the room (never one that is closing). */
  sockets(): S[];
  seatOf(socket: S): PlayerId | null;
  setSeat(socket: S, seat: PlayerId | null): void;
  send(socket: S, message: RoomServerMessage): void;
  close(socket: S, code: number, reason: string): void;
  /** Unguessable secret for seat tokens. */
  randomToken(): string;
  /** Unpredictable game seed: it decides both decks. */
  randomSeed(): string;
  /** Uniform integer in [0, n). */
  randomIndex(n: number): number;
}

export interface NewRoom {
  id: string;
  name: string;
  host: string;
  private: boolean;
  timings: RoomTimings;
}

export function newRoomRecord(room: NewRoom, now: number): RoomRecord {
  return {
    version: 1,
    ...room,
    createdAt: now,
    status: 'waiting',
    seats: [null, null],
    score: [0, 0],
    games: 0,
    game: null,
    clock: null,
    ending: null,
    endedAt: null,
  };
}

const SEATS: readonly PlayerId[] = [0, 1];

export class RoomCore<S> {
  /** True once the room has closed for good: the host deletes it. */
  closed = false;
  private dirty = false;
  private readonly buckets = new Map<S, TokenBucket>();
  private readonly strikes = new Map<S, number>();
  private readonly lastEmote = new Map<PlayerId, number>();

  constructor(
    readonly record: RoomRecord,
    private readonly host: RoomHost<S>,
  ) {}

  /** True if `record` changed since the last call: save it. */
  takeDirty(): boolean {
    const dirty = this.dirty;
    this.dirty = false;
    return dirty;
  }

  // -------------------------------------------------------------------------
  // Events from the host
  // -------------------------------------------------------------------------

  /** A socket connected. It gets the room info straight away (no hidden information in it). */
  connected(socket: S): void {
    if (this.record.status === 'closed') {
      this.host.close(socket, CLOSE_CODES.roomClosed, 'The room is closed');
      return;
    }
    if (this.host.sockets().length > ROOM_LIMITS.maxSockets) {
      this.host.close(socket, CLOSE_CODES.tooManyConnections, 'Too many connections to this room');
      return;
    }
    this.host.send(socket, { type: 'room', room: this.info(), now: this.host.now() });
  }

  /** A text message arrived on `socket`. */
  receive(socket: S, text: string): void {
    if (!this.allow(socket)) return;
    const message = parseRoomClientMessage(text);
    if (!message) {
      this.strike(socket);
      this.error(socket, 'badMessage', 'Malformed or unknown message');
      return;
    }
    switch (message.type) {
      case 'join':
        return this.join(socket, message.v, message.nickname, message.hero);
      case 'resume':
        return this.resume(socket, message.v, message.token);
      case 'action':
        return this.act(socket, message.action as ActionIntent);
      case 'rematch':
        return this.rematch(socket, message.hero);
      case 'emote':
        return this.emote(socket, message.emote);
      case 'leave':
        return this.leave(socket);
      case 'sync':
        return this.sync(socket);
    }
  }

  /** `socket` closed. If it held a seat, the reconnection window opens. */
  disconnected(socket: S): void {
    this.buckets.delete(socket);
    this.strikes.delete(socket);
    const seat = this.host.seatOf(socket);
    if (seat === null || this.isConnected(seat)) return;
    const record = this.record.seats[seat];
    if (!record || record.left || this.record.status === 'closed') return;
    const { timings } = this.record;
    record.reconnectBy =
      this.host.now() + (this.record.status === 'waiting' ? timings.waitingReconnectMs : timings.reconnectMs);
    this.dirty = true;
    this.broadcastRoom();
  }

  /** The alarm rang: run every timer that is due. */
  tick(): void {
    const now = this.host.now();
    const room = this.record;
    if (room.status === 'closed') return;

    // Turn clock.
    if (room.status === 'playing' && room.game && room.clock && room.clock.deadline <= now) {
      const seat = room.game.active;
      const record = room.seats[seat]!;
      record.timeouts += 1;
      this.apply({ type: 'timeout' }, null);
      if (record.timeouts >= room.timings.afkTimeouts) this.forfeit(seat, 'inactive');
    }

    // Reconnection windows.
    for (const seat of SEATS) {
      const record = room.seats[seat];
      if (!record || record.reconnectBy === null || record.reconnectBy > now) continue;
      record.reconnectBy = null;
      this.dirty = true;
      if (room.status === 'waiting') {
        room.seats[seat] = null;
        if (room.seats.every((s) => s === null)) return this.closeRoom();
      } else {
        record.left = true;
        record.rematch = false;
        if (room.status === 'playing') this.forfeit(seat, 'disconnected');
      }
      this.broadcastRoom();
    }

    // Cleanup.
    if (room.status === 'waiting') {
      const nobody = room.seats.every((s) => s === null);
      if ((nobody && now >= room.createdAt + ROOM_LIMITS.emptyRoomMs) || now >= room.createdAt + ROOM_LIMITS.waitingTtlMs) {
        this.closeRoom();
      }
    } else if (room.status === 'finished') {
      const everyoneGone = room.seats.every((s) => !s || s.left);
      if (everyoneGone || now >= (room.endedAt ?? now) + ROOM_LIMITS.finishedTtlMs) this.closeRoom();
    }
  }

  /** When the alarm should ring next, or null when nothing is pending. */
  nextWake(): number | null {
    const room = this.record;
    if (room.status === 'closed') return null;
    const times: number[] = [];
    if (room.status === 'playing' && room.clock) times.push(room.clock.deadline);
    for (const seat of room.seats) if (seat?.reconnectBy != null) times.push(seat.reconnectBy);
    if (room.status === 'waiting') {
      times.push(room.createdAt + ROOM_LIMITS.waitingTtlMs);
      if (room.seats.every((s) => s === null)) times.push(room.createdAt + ROOM_LIMITS.emptyRoomMs);
    }
    if (room.status === 'finished' && room.endedAt !== null) times.push(room.endedAt + ROOM_LIMITS.finishedTtlMs);
    return times.length > 0 ? Math.min(...times) : null;
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  /** Public room info: the same for everyone. */
  info(): RoomInfo {
    const room = this.record;
    const seat = (index: PlayerId): SeatInfo | null => {
      const s = room.seats[index];
      if (!s) return null;
      return {
        nickname: s.nickname,
        hero: s.hero,
        connected: this.isConnected(index),
        reconnectBy: s.reconnectBy,
        left: s.left,
        rematch: s.rematch,
      };
    };
    return {
      id: room.id,
      name: room.name,
      private: room.private,
      status: room.status,
      seats: [seat(0), seat(1)],
      score: [room.score[0], room.score[1]],
      games: room.games,
      ending: room.ending,
      timings: room.timings,
    };
  }

  summary(): RoomSummary {
    const room = this.record;
    return {
      id: room.id,
      name: room.name,
      host: room.host,
      status: room.status,
      players: room.seats.filter((s) => s !== null && !s.left).length,
      private: room.private,
      createdAt: room.createdAt,
      turnSeconds: room.timings.turnSeconds,
    };
  }

  lobbyUpdate(): LobbyRoomUpdate {
    const summary = this.summary();
    const open =
      summary.status === 'waiting' &&
      summary.players === 1 &&
      SEATS.some((seat) => this.record.seats[seat] !== null && this.isConnected(seat));
    return { summary, open };
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private join(socket: S, version: number, nickname: string, hero: HeroChoice): void {
    if (!this.checkVersion(socket, version)) return;
    const room = this.record;
    if (this.host.seatOf(socket) !== null) return this.error(socket, 'alreadySeated', 'You already have a seat');
    const free = room.seats.findIndex((s) => s === null);
    if (room.status !== 'waiting' || free < 0) {
      this.error(socket, 'roomFull', 'The room is full');
      this.host.close(socket, CLOSE_CODES.roomFull, 'The room is full');
      return;
    }
    const seat = free as PlayerId;
    room.seats[seat] = {
      nickname: cleanNickname(nickname) ?? `Jugador ${seat + 1}`,
      choice: hero,
      hero: null,
      token: this.host.randomToken(),
      reconnectBy: null,
      left: false,
      rematch: false,
      timeouts: 0,
    };
    this.dirty = true;
    this.host.setSeat(socket, seat);
    this.welcome(socket, seat);
    if (room.seats[0] && room.seats[1]) this.startGame();
    else this.broadcastRoom();
  }

  private resume(socket: S, version: number, token: string): void {
    if (!this.checkVersion(socket, version)) return;
    const room = this.record;
    const seat = token.length >= 16 ? SEATS.find((i) => room.seats[i]?.token === token) : undefined;
    const record = seat === undefined ? null : room.seats[seat];
    if (seat === undefined || !record || record.left) {
      return this.error(socket, 'badToken', 'That seat is no longer yours');
    }
    const current = this.host.seatOf(socket);
    if (current !== null && current !== seat) return this.error(socket, 'alreadySeated', 'You already have a seat');

    // The newest connection wins: close any other socket holding this seat.
    for (const other of this.host.sockets()) {
      if (other !== socket && this.host.seatOf(other) === seat) {
        this.host.setSeat(other, null);
        this.host.close(other, CLOSE_CODES.replaced, 'This seat was taken from another connection');
      }
    }
    this.host.setSeat(socket, seat);
    if (record.reconnectBy !== null) {
      record.reconnectBy = null;
      this.dirty = true;
    }
    this.welcome(socket, seat);
    if (room.game) this.sendState(socket, seat, [], true);
    this.broadcastRoom();
  }

  private act(socket: S, intent: ActionIntent): void {
    const seat = this.host.seatOf(socket);
    if (seat === null) return this.error(socket, 'notSeated', 'Take a seat first');
    if (this.record.status !== 'playing' || !this.record.game) {
      return this.error(socket, 'notPlaying', 'There is no game in progress');
    }
    // Never trust the client about who it is: the seat comes from the socket.
    const action = { ...intent, player: seat } as Action;
    const error = this.apply(action, intent.type === 'concede' ? { seat, cause: 'conceded' } : null);
    if (error) return this.error(socket, error.code, error.message);
    const record = this.record.seats[seat];
    if (record && record.timeouts !== 0) {
      record.timeouts = 0;
      this.dirty = true;
    }
  }

  private rematch(socket: S, hero: HeroChoice | undefined): void {
    const seat = this.host.seatOf(socket);
    if (seat === null) return this.error(socket, 'notSeated', 'Take a seat first');
    const room = this.record;
    const me = room.seats[seat]!;
    const them = room.seats[otherSeat(seat)];
    if (room.status !== 'finished' || !them || them.left) {
      return this.error(socket, 'rematchUnavailable', 'A rematch is not possible now');
    }
    me.rematch = true;
    if (hero !== undefined) me.choice = hero;
    this.dirty = true;
    if (them.rematch) this.startGame();
    else this.broadcastRoom();
  }

  private emote(socket: S, emote: Emote): void {
    const seat = this.host.seatOf(socket);
    if (seat === null) return this.error(socket, 'notSeated', 'Take a seat first');
    const now = this.host.now();
    if (now - (this.lastEmote.get(seat) ?? -Infinity) < ROOM_LIMITS.emoteCooldownMs) {
      return this.error(socket, 'rateLimited', 'Too many emotes');
    }
    this.lastEmote.set(seat, now);
    this.broadcast({ type: 'emote', seat, emote });
  }

  private leave(socket: S): void {
    const seat = this.host.seatOf(socket);
    if (seat === null) return;
    this.host.setSeat(socket, null);
    const room = this.record;
    const record = room.seats[seat]!;
    this.dirty = true;
    switch (room.status) {
      case 'waiting':
        room.seats[seat] = null;
        if (room.seats.every((s) => s === null)) return this.closeRoom();
        break;
      case 'playing':
        record.left = true;
        record.reconnectBy = null;
        this.forfeit(seat, 'left');
        return;
      case 'finished':
        record.left = true;
        record.rematch = false;
        record.reconnectBy = null;
        if (room.seats.every((s) => !s || s.left)) return this.closeRoom();
        break;
      default:
        return;
    }
    this.broadcastRoom();
  }

  private sync(socket: S): void {
    this.host.send(socket, { type: 'room', room: this.info(), now: this.host.now() });
    const seat = this.host.seatOf(socket);
    if (seat !== null && this.record.game) this.sendState(socket, seat, [], true);
  }

  // -------------------------------------------------------------------------
  // Game
  // -------------------------------------------------------------------------

  private startGame(): void {
    const room = this.record;
    const now = this.host.now();
    const seats = room.seats as [SeatRecord, SeatRecord];
    const heroes = seats.map((s) =>
      s.choice === 'random' ? HEROES[this.host.randomIndex(HEROES.length)]!.id : s.choice,
    ) as [HeroId, HeroId];
    // In a rematch the loser starts.
    const winner = room.ending?.winner ?? null;
    const { state, events } = createGame({
      seed: this.host.randomSeed(),
      heroes,
      ...(winner === null ? {} : { firstPlayer: otherSeat(winner) }),
      rules: { turnSeconds: room.timings.turnSeconds },
    });
    seats.forEach((s, i) => {
      s.hero = heroes[i]!;
      s.rematch = false;
      s.timeouts = 0;
      // Someone who dropped while waiting gets the full in-game window.
      if (s.reconnectBy !== null) s.reconnectBy = Math.max(s.reconnectBy, now + room.timings.reconnectMs);
    });
    room.status = 'playing';
    room.games += 1;
    room.ending = null;
    room.endedAt = null;
    room.clock = null;
    this.dirty = true;
    this.broadcastRoom();
    this.publish(state, events, null);
  }

  private apply(action: Action, forfeit: GameEnding['forfeit']): EngineError | null {
    const game = this.record.game;
    if (!game) return { code: 'gameOver', message: 'There is no game' };
    const result = applyAction(game, action);
    if (!result.ok) return result.error;
    this.publish(result.state, result.events, forfeit);
    return null;
  }

  private forfeit(seat: PlayerId, cause: ForfeitCause): void {
    if (this.record.status !== 'playing') return;
    this.apply({ type: 'concede', player: seat }, { seat, cause });
  }

  /** Store the new state, restart the clock on a new turn and send each player their view. */
  private publish(state: GameState, events: GameEvent[], forfeit: GameEnding['forfeit']): void {
    const room = this.record;
    const now = this.host.now();
    room.game = state;
    this.dirty = true;

    if (state.result) {
      room.status = 'finished';
      room.clock = null;
      room.endedAt = now;
      room.ending = { winner: state.result.winner, reason: state.result.reason, forfeit };
      if (state.result.winner !== null) room.score[state.result.winner] += 1;
      for (const seat of room.seats) if (seat) seat.rematch = false;
    } else if (state.rules.turnSeconds <= 0) {
      // No time limit: turns never run out.
      room.clock = null;
    } else if (!room.clock || room.clock.turn !== state.turn) {
      room.clock = { turn: state.turn, deadline: now + state.rules.turnSeconds * 1000 };
    }

    for (const socket of this.host.sockets()) {
      const seat = this.host.seatOf(socket);
      if (seat !== null) this.sendState(socket, seat, events, false);
    }
    if (state.result) this.broadcastRoom();
  }

  private sendState(socket: S, seat: PlayerId, events: GameEvent[], resumed: boolean): void {
    const game = this.record.game!;
    this.host.send(socket, {
      type: 'state',
      view: getPlayerView(game, seat),
      events: redactEvents(events, seat),
      deadline: this.record.clock?.deadline ?? null,
      now: this.host.now(),
      resumed,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private closeRoom(): void {
    this.record.status = 'closed';
    this.record.game = null;
    this.closed = true;
    this.dirty = true;
    for (const socket of this.host.sockets()) {
      this.host.close(socket, CLOSE_CODES.roomClosed, 'The room was closed');
    }
  }

  private isConnected(seat: PlayerId): boolean {
    return this.host.sockets().some((socket) => this.host.seatOf(socket) === seat);
  }

  private welcome(socket: S, seat: PlayerId): void {
    this.host.send(socket, {
      type: 'welcome',
      seat,
      token: this.record.seats[seat]!.token,
      room: this.info(),
      now: this.host.now(),
    });
  }

  private broadcastRoom(): void {
    this.broadcast({ type: 'room', room: this.info(), now: this.host.now() });
  }

  private broadcast(message: RoomServerMessage): void {
    for (const socket of this.host.sockets()) this.host.send(socket, message);
  }

  private checkVersion(socket: S, version: number): boolean {
    if (version === PROTOCOL_VERSION) return true;
    this.error(socket, 'outdated', `The server speaks protocol ${PROTOCOL_VERSION}: reload the page`);
    this.host.close(socket, CLOSE_CODES.outdated, 'Outdated client');
    return false;
  }

  private error(socket: S, code: RoomErrorCode, message: string): void {
    this.host.send(socket, { type: 'error', code, message });
  }

  /** Per-socket flood control. */
  private allow(socket: S): boolean {
    let bucket = this.buckets.get(socket);
    if (!bucket) {
      bucket = new TokenBucket(ROOM_LIMITS.messageBurst, ROOM_LIMITS.messagesPerSecond, this.host.now());
      this.buckets.set(socket, bucket);
    }
    if (bucket.take(this.host.now())) return true;
    this.strike(socket);
    this.error(socket, 'rateLimited', 'Slow down');
    return false;
  }

  private strike(socket: S): void {
    const strikes = (this.strikes.get(socket) ?? 0) + 1;
    this.strikes.set(socket, strikes);
    if (strikes > ROOM_LIMITS.maxStrikes) {
      this.host.close(socket, CLOSE_CODES.abuse, 'Too many invalid messages');
    }
  }
}
