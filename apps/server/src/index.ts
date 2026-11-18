/**
 * Cardcraft: Castles server: a Cloudflare Worker that routes requests to two
 * kinds of Durable Objects, one `Lobby` (the room directory, room creation
 * and quick join) and one `Room` per match (the authoritative game).
 */
import { CARDS, GAME_TITLE } from '@cardcraft-castles/engine';
import {
  PROTOCOL_VERSION,
  cleanNickname,
  cleanRoomName,
  cleanTurnSeconds,
  cleanRoomSize,
  cleanTwilight,
  isRoomId,
  type ApiErrorCode,
  type HealthResponse,
} from '@cardcraft-castles/protocol';
import type { Env } from './env';
import type { LobbyResult } from './lobby';

export { Lobby } from './lobby';
export { Room } from './room';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/** Request bodies are tiny; anything bigger is not a real client. */
const MAX_BODY_BYTES = 2048;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store' } });
}

function fail(status: number, code: ApiErrorCode, message: string, retryAfterMs?: number): Response {
  const headers: Record<string, string> = { ...CORS, 'cache-control': 'no-store' };
  if (retryAfterMs) headers['retry-after'] = String(Math.ceil(retryAfterMs / 1000));
  return Response.json({ error: { code, message, ...(retryAfterMs ? { retryAfterMs } : {}) } }, { status, headers });
}

function fromLobby<T>(result: LobbyResult<T>, status: number, wrap: (value: T) => unknown): Response {
  if (result.ok) return json(wrap(result.value), status);
  return fail(result.status, result.error.code, result.error.message, result.error.retryAfterMs);
}

function isSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const body: unknown = JSON.parse(text || '{}');
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clientIdOf(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{24}$/.test(value) ? value : null;
}

function ipOf(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local';
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby'));

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      if (path === '/api/health') {
        return json({ ok: true, game: GAME_TITLE, protocol: PROTOCOL_VERSION, cards: CARDS.length } satisfies HealthResponse);
      }

      if (path === '/api/lobby') {
        if (!isSocketUpgrade(request)) return fail(426, 'badRequest', 'Expected a WebSocket');
        return lobby.fetch(request);
      }

      if (path === '/api/rooms') {
        if (request.method === 'GET') return json({ rooms: await lobby.list() });
        if (request.method !== 'POST') return fail(405, 'badRequest', 'Method not allowed');
        const body = await readBody(request);
        if (!body) return fail(400, 'badRequest', 'The body must be a small JSON object');
        const nickname = cleanNickname(body.nickname);
        if (!nickname) return fail(400, 'badRequest', 'A nickname is required');
        const result = await lobby.createRoom({
          nickname,
          name: cleanRoomName(body.name) ?? cleanRoomName(`Sala de ${nickname}`)!,
          private: body.private === true,
          turnSeconds: cleanTurnSeconds(body.turnSeconds),
          size: cleanRoomSize(body.size),
          twilight: cleanTwilight(body.twilight),
          clientId: clientIdOf(body.clientId),
          ip: ipOf(request),
        });
        return fromLobby(result, 201, (room) => ({ room }));
      }

      if (path === '/api/quick-join') {
        if (request.method !== 'POST') return fail(405, 'badRequest', 'Method not allowed');
        const body = await readBody(request);
        if (!body) return fail(400, 'badRequest', 'The body must be a small JSON object');
        const nickname = cleanNickname(body.nickname);
        if (!nickname) return fail(400, 'badRequest', 'A nickname is required');
        const result = await lobby.quickJoin({ nickname, clientId: clientIdOf(body.clientId), ip: ipOf(request) });
        return fromLobby(result, 200, (value) => value);
      }

      const roomPath = path.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
      if (roomPath) {
        const [, id, socket] = roomPath;
        if (!isRoomId(id)) return fail(404, 'notFound', 'No such room');
        const room = env.ROOM.get(env.ROOM.idFromName(id));
        if (socket) {
          if (!isSocketUpgrade(request)) return fail(426, 'badRequest', 'Expected a WebSocket');
          return room.fetch(request);
        }
        if (request.method !== 'GET') return fail(405, 'badRequest', 'Method not allowed');
        const summary = await room.summary();
        return summary ? json({ room: summary }) : fail(404, 'notFound', 'No such room');
      }

      return fail(404, 'notFound', 'Not found');
    } catch (error) {
      console.error(error);
      return fail(500, 'internal', 'Something went wrong');
    }
  },
} satisfies ExportedHandler<Env>;
