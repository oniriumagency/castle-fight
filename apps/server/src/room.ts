import { DurableObject } from 'cloudflare:workers';
import {
  applyAction,
  createGame,
  getPlayerView,
  isHeroId,
  redactEvents,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerId,
} from '@cardcraft-castles/engine';
import type {
  RoomClientMessage,
  RoomServerMessage,
  RoomStatus,
  RoomSummary,
  SeatInfo,
} from '@cardcraft-castles/protocol';
import type { Env } from './env';
import type { Lobby } from './lobby';

interface RoomMeta {
  id: string;
  name: string;
  host: string;
  createdAt: number;
  seats: [SeatInfo | null, SeatInfo | null];
}

/** The turn the clock is running for and when it runs out. */
interface Clock {
  turn: number;
  deadline: number;
}

/** What each WebSocket remembers across hibernation. */
interface Attachment {
  seat: PlayerId;
}

/**
 * One match. It owns the full game state, applies every action with the
 * rules engine and sends each player only their own view. State lives in
 * Durable Object storage, so the object can hibernate between messages.
 */
export class Room extends DurableObject<Env> {
  /** Called by the Worker when the room is created. */
  async create(info: { id: string; name: string; host: string }): Promise<RoomSummary> {
    const meta: RoomMeta = { ...info, createdAt: Date.now(), seats: [null, null] };
    await this.ctx.storage.put('meta', meta);
    const summary = this.summary(meta, null);
    await this.lobby().upsert(summary);
    return summary;
  }

  override async fetch(): Promise<Response> {
    const meta = await this.ctx.storage.get<RoomMeta>('meta');
    if (!meta) return Response.json({ error: 'Room not found' }, { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let message: RoomClientMessage;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as RoomClientMessage;
    } catch {
      return this.send(ws, { type: 'error', code: 'badMessage', message: 'Messages must be JSON' });
    }
    if (message.type === 'join') return this.join(ws, message.nickname, message.hero);
    if (message.type === 'action') return this.act(ws, message.action);
    this.send(ws, { type: 'error', code: 'badMessage', message: 'Unknown message type' });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
    // Shell behaviour: a player who leaves a running game concedes it.
    // The server thread replaces this with a 60 s reconnection window.
    const seat = (ws.deserializeAttachment() as Attachment | null)?.seat;
    const meta = await this.ctx.storage.get<RoomMeta>('meta');
    if (seat === undefined || !meta) return;
    const game = await this.ctx.storage.get<GameState>('game');
    if (game) {
      if (game.phase !== 'finished') await this.apply(meta, game, { type: 'concede', player: seat });
    } else {
      meta.seats[seat] = null;
      await this.ctx.storage.put('meta', meta);
      if (meta.seats.every((s) => s === null)) await this.lobby().remove(meta.id);
      else await this.lobby().upsert(this.summary(meta, null));
    }
  }

  /** The turn clock: when it runs out the engine discards a random card. */
  override async alarm(): Promise<void> {
    const meta = await this.ctx.storage.get<RoomMeta>('meta');
    const game = await this.ctx.storage.get<GameState>('game');
    const clock = await this.ctx.storage.get<Clock>('clock');
    if (!meta || !game || !clock || game.phase === 'finished') return;
    if (clock.turn !== game.turn) return;
    await this.apply(meta, game, { type: 'timeout' });
  }

  private async join(ws: WebSocket, nickname: unknown, hero: unknown): Promise<void> {
    const meta = await this.ctx.storage.get<RoomMeta>('meta');
    if (!meta) return this.send(ws, { type: 'error', code: 'noRoom', message: 'Room not found' });
    if (ws.deserializeAttachment()) {
      return this.send(ws, { type: 'error', code: 'alreadyJoined', message: 'You are already seated' });
    }
    if (typeof hero !== 'string' || !isHeroId(hero)) {
      return this.send(ws, { type: 'error', code: 'badHero', message: 'Unknown hero' });
    }
    const free = meta.seats.findIndex((s) => s === null);
    if (free < 0) return this.send(ws, { type: 'error', code: 'roomFull', message: 'The room is full' });
    const seat = free as PlayerId;

    const name = typeof nickname === 'string' ? nickname.trim().slice(0, 20) : '';
    meta.seats[seat] = { nickname: name || `Jugador ${seat + 1}`, hero };
    ws.serializeAttachment({ seat } satisfies Attachment);
    await this.ctx.storage.put('meta', meta);
    this.send(ws, { type: 'joined', seat, seats: meta.seats });

    const [a, b] = meta.seats;
    if (a && b) {
      // The seed must be unpredictable: it decides both decks.
      const seed = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
      const { state, events } = createGame({ seed, heroes: [a.hero, b.hero] });
      await this.publish(meta, state, events, null);
    } else {
      await this.lobby().upsert(this.summary(meta, null));
    }
  }

  private async act(ws: WebSocket, action: Action): Promise<void> {
    const seat = (ws.deserializeAttachment() as Attachment | null)?.seat;
    const meta = await this.ctx.storage.get<RoomMeta>('meta');
    const game = await this.ctx.storage.get<GameState>('game');
    if (seat === undefined || !meta || !game) {
      return this.send(ws, { type: 'error', code: 'notPlaying', message: 'The game has not started' });
    }
    if (!action || typeof action !== 'object' || action.type === 'timeout') {
      return this.send(ws, { type: 'error', code: 'invalidAction', message: 'Not a player action' });
    }
    // Never trust the client about who it is.
    const error = await this.apply(meta, game, { ...action, player: seat });
    if (error) this.send(ws, { type: 'error', ...error });
  }

  private async apply(
    meta: RoomMeta,
    game: GameState,
    action: Action,
  ): Promise<{ code: string; message: string } | null> {
    const result = applyAction(game, action);
    if (!result.ok) return result.error;
    await this.publish(meta, result.state, result.events, game);
    return null;
  }

  /** Store the new state, restart the clock if the turn changed and tell everyone. */
  private async publish(
    meta: RoomMeta,
    state: GameState,
    events: GameEvent[],
    previous: GameState | null,
  ): Promise<void> {
    await this.ctx.storage.put('game', state);

    let clock = (await this.ctx.storage.get<Clock>('clock')) ?? null;
    if (state.phase === 'finished') {
      clock = null;
      await this.ctx.storage.delete('clock');
      await this.ctx.storage.deleteAlarm();
    } else if (!clock || clock.turn !== state.turn) {
      clock = { turn: state.turn, deadline: Date.now() + state.rules.turnSeconds * 1000 };
      await this.ctx.storage.put('clock', clock);
      await this.ctx.storage.setAlarm(clock.deadline);
    }

    const seats = meta.seats as [SeatInfo, SeatInfo];
    for (const ws of this.ctx.getWebSockets()) {
      const seat = (ws.deserializeAttachment() as Attachment | null)?.seat;
      if (seat === undefined) continue;
      this.send(ws, {
        type: 'state',
        view: getPlayerView(state, seat),
        events: redactEvents(events, seat),
        seats,
        deadline: clock?.deadline ?? null,
      });
    }

    const status: RoomStatus = state.phase === 'finished' ? 'finished' : 'playing';
    if (!previous || status === 'finished') await this.lobby().upsert(this.summary(meta, status));
  }

  private summary(meta: RoomMeta, status: RoomStatus | null): RoomSummary {
    return {
      id: meta.id,
      name: meta.name,
      host: meta.host,
      status: status ?? 'waiting',
      players: meta.seats.filter((s) => s !== null).length,
      createdAt: meta.createdAt,
    };
  }

  private lobby(): DurableObjectStub<Lobby> {
    return this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
  }

  private send(ws: WebSocket, message: RoomServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket is closing.
    }
  }
}
