/**
 * Cardcraft: Castles server: a Cloudflare Worker that routes requests to two
 * kinds of Durable Objects, one `Lobby` for the room list and one `Room` per
 * match. This is the shell: it proves that the rules engine runs server-side
 * and that a match can be played over WebSockets. Reconnection, rematch,
 * emotes, private rooms and the AI opponent are still to be built on top.
 */
import { ROUTES, type CreateRoomRequest } from '@cardcraft-castles/protocol';
import { CARDS, GAME_TITLE } from '@cardcraft-castles/engine';
import type { Env } from './env';

export { Lobby } from './lobby';
export { Room } from './room';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS });
}

function isSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

/** Short, URL-friendly room id for invite links. */
function newRoomId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function cleanText(value: unknown, fallback: string, max: number): string {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return text || fallback;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby'));

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === ROUTES.health) {
      return json({ ok: true, game: GAME_TITLE, cards: CARDS.length });
    }

    if (url.pathname === ROUTES.lobbySocket) {
      if (!isSocketUpgrade(request)) return json({ error: 'Expected a WebSocket' }, 426);
      return lobby.fetch(request);
    }

    if (url.pathname === ROUTES.rooms) {
      if (request.method === 'GET') return json({ rooms: await lobby.list() });
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Partial<CreateRoomRequest>;
        const id = newRoomId();
        const host = cleanText(body.host, 'Anónimo', 20);
        const name = cleanText(body.name, `Sala de ${host}`, 40);
        const room = env.ROOM.get(env.ROOM.idFromName(id));
        return json({ room: await room.create({ id, name, host }) }, 201);
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    const roomSocket = url.pathname.match(/^\/api\/rooms\/([a-z0-9]{8})\/ws$/);
    if (roomSocket) {
      if (!isSocketUpgrade(request)) return json({ error: 'Expected a WebSocket' }, 426);
      return env.ROOM.get(env.ROOM.idFromName(roomSocket[1]!)).fetch(request);
    }

    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
