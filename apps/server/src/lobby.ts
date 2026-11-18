import { DurableObject } from 'cloudflare:workers';
import type { LobbyServerMessage, RoomSummary } from '@cardcraft-castles/protocol';
import type { Env } from './env';

/** Rooms that nobody touched for this long are dropped from the list. */
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * The single lobby: keeps the list of rooms and pushes it to every connected
 * client whenever it changes. Rooms report their own status through
 * `upsert` and `remove`.
 */
export class Lobby extends DurableObject<Env> {
  private async rooms(): Promise<Record<string, RoomSummary>> {
    return (await this.ctx.storage.get<Record<string, RoomSummary>>('rooms')) ?? {};
  }

  /** Open rooms first, newest first. */
  async list(): Promise<RoomSummary[]> {
    const now = Date.now();
    return Object.values(await this.rooms())
      .filter((room) => room.status !== 'finished' && now - room.createdAt < STALE_MS)
      .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || b.createdAt - a.createdAt);
  }

  async upsert(room: RoomSummary): Promise<void> {
    const rooms = await this.rooms();
    rooms[room.id] = room;
    const now = Date.now();
    for (const [id, other] of Object.entries(rooms)) {
      if (other.status === 'finished' || now - other.createdAt >= STALE_MS) delete rooms[id];
    }
    await this.ctx.storage.put('rooms', rooms);
    await this.broadcast();
  }

  async remove(id: string): Promise<void> {
    const rooms = await this.rooms();
    delete rooms[id];
    await this.ctx.storage.put('rooms', rooms);
    await this.broadcast();
  }

  override async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify(await this.message()));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override webSocketClose(ws: WebSocket): void {
    ws.close();
  }

  private async message(): Promise<LobbyServerMessage> {
    return { type: 'rooms', rooms: await this.list() };
  }

  private async broadcast(): Promise<void> {
    const text = JSON.stringify(await this.message());
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // The socket is closing; it will be cleaned up on its own.
      }
    }
  }
}
