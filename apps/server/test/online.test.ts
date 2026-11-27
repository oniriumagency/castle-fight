/**
 * End-to-end tests: a real local Worker (workerd, with the Durable Objects,
 * alarms and WebSocket hibernation) driven through the client SDK.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';
import {
  OnlineClient,
  type Emitter,
  type KeyValueStorage,
  type LobbyConnection,
  type LobbyEvents,
  type RoomConnection,
  type RoomEvents,
  type WebSocketLike,
} from '@cardcraft-castles/protocol/client';

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

const config = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));

async function startServer(vars: Record<string, string>): Promise<{ worker: Worker; base: string }> {
  const bindings = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, { type: 'plain_text' as const, value }]),
  );
  const worker = await unstable_startWorker({
    config,
    bindings,
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, watch: false, persist: false, logLevel: 'error' },
  } as Parameters<typeof unstable_startWorker>[0]);
  await worker.ready;
  return { worker, base: (await worker.url).origin };
}

function memory(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
}

/** A client whose raw sockets the test can reach, to cut them like a flaky network would. */
function client(base: string, storage: KeyValueStorage = memory()) {
  const sockets: WebSocket[] = [];
  const online = new OnlineClient({
    baseUrl: base,
    storage,
    heartbeatMs: 60_000,
    createSocket: (url) => {
      const ws = new WebSocket(url);
      sockets.push(ws);
      return ws as unknown as WebSocketLike;
    },
  });
  return { online, sockets, storage };
}

/** The next `type` event that passes `test`, or a failure after `timeoutMs`. */
function next<K extends keyof RoomEvents>(
  emitter: RoomConnection,
  type: K,
  test?: (payload: RoomEvents[K]) => boolean,
  timeoutMs?: number,
): Promise<RoomEvents[K]>;
function next<K extends keyof LobbyEvents>(
  emitter: LobbyConnection,
  type: K,
  test?: (payload: LobbyEvents[K]) => boolean,
  timeoutMs?: number,
): Promise<LobbyEvents[K]>;
function next(
  emitter: Emitter<Record<string, unknown>>,
  type: string,
  test?: (payload: unknown) => boolean,
  timeoutMs = 10_000,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
  });
  return Promise.race([emitter.once(type, test), timeout]).finally(() => clearTimeout(timer));
}

/** Seat two players in a fresh room and wait until both see the game. */
async function startGame(base: string, options: { private?: boolean } = {}) {
  const a = client(base);
  const b = client(base);
  const summary = await a.online.createRoom({ nickname: 'Ana', private: options.private ?? false });
  const roomA = a.online.joinRoom(summary.id, { nickname: 'Ana', hero: 'arquitecta' });
  await next(roomA, 'welcome');
  const roomB = b.online.joinRoom(summary.id, { nickname: 'Bea', hero: 'random' });
  await Promise.all([next(roomA, 'state'), next(roomB, 'state')]);
  return { a, b, roomA, roomB, id: summary.id };
}

/** Make whoever is to move play a legal card (or discard). */
function moveFor(rooms: RoomConnection[]): boolean {
  const room = rooms.find((r) => r.isMyTurn());
  if (!room) return false;
  const legal = room.legalActions();
  return room.act(legal.find((a) => a.type === 'play') ?? legal[0]!);
}

describe('online play', () => {
  let worker: Worker;
  let base: string;

  beforeAll(async () => {
    ({ worker, base } = await startServer({ RATE_LIMITS: 'off' }));
  });

  afterAll(async () => {
    await worker?.dispose();
  });

  it('answers the health check', async () => {
    const health = await client(base).online.health();
    expect(health).toMatchObject({ ok: true, protocol: 3, cards: 77 });
  });

  it('lists a room live in the lobby, lets a second player in and hides each hand', async () => {
    const watcher = client(base).online.connectLobby();
    await next(watcher, 'status', (s) => s === 'open');

    const a = client(base);
    const summary = await a.online.createRoom({ nickname: 'Ana', name: 'Duelo de prueba' });
    expect(summary).toMatchObject({ name: 'Duelo de prueba', host: 'Ana', status: 'waiting', private: false });

    const listed = next(watcher, 'rooms', (rooms) => rooms.some((r) => r.id === summary.id && r.status === 'waiting'));
    const roomA = a.online.joinRoom(summary.id, { nickname: 'Ana', hero: 'arquitecta' });
    expect((await next(roomA, 'welcome')).seat).toBe(0);
    await listed;
    expect((await a.online.listRooms()).map((r) => r.id)).toContain(summary.id);

    const invite = a.online.inviteUrl(summary.id, 'https://castles.example/play');
    expect(invite).toBe(`https://castles.example/play?room=${summary.id}`);
    expect(await client(base).online.getRoom(summary.id)).toMatchObject({ id: summary.id, players: 1 });
    expect(await client(base).online.getRoom('zzzzzzzz')).toBeNull();

    const playing = next(watcher, 'rooms', (rooms) => rooms.some((r) => r.id === summary.id && r.status === 'playing'));
    const b = client(base);
    const roomB = b.online.joinRoom(summary.id, { nickname: 'Bea', hero: 'mariscal' });
    const [stateA, stateB] = await Promise.all([next(roomA, 'state'), next(roomB, 'state')]);
    await playing;

    expect(stateA.view.viewer).toBe(0);
    expect(stateB.view.viewer).toBe(1);
    expect(stateA.view.players[0].hand.every((c) => c.cardId !== null)).toBe(true);
    expect(stateA.view.players[1].hand.every((c) => c.cardId === null)).toBe(true);
    expect(stateB.view.players[0].hand.every((c) => c.cardId === null)).toBe(true);
    expect(roomA.timeLeft()).toBeGreaterThan(25_000);
    expect(roomB.room?.seats.map((s) => s?.nickname)).toEqual(['Ana', 'Bea']);
    // Each browser's public id reaches the other player, for the head-to-head record.
    expect(roomB.room?.seats.map((s) => s?.pid)).toEqual([a.online.playerId, b.online.playerId]);
    expect(a.online.playerId).not.toBe(a.online.clientId);

    roomA.leave();
    const ending = await next(roomB, 'room', (r) => r.status === 'finished');
    expect(ending.ending?.forfeit).toEqual({ seat: 0, cause: 'left' });
    roomB.leave();
    watcher.close();
  });

  it('keeps private rooms out of the lobby but reachable by link', async () => {
    const { a, roomA, roomB, id } = await startGame(base, { private: true });
    expect((await a.online.listRooms()).some((r) => r.id === id)).toBe(false);
    expect(await a.online.getRoom(id)).toMatchObject({ id, private: true, status: 'playing' });
    roomA.leave();
    roomB.leave();
  });

  it('uses the turn length the host picked', async () => {
    const online = client(base).online;
    const summary = await online.createRoom({ nickname: 'Ana', private: true, turnSeconds: 90 });
    expect(summary.turnSeconds).toBe(90);
    expect(await online.getRoom(summary.id)).toMatchObject({ turnSeconds: 90 });
    // A length that is not offered falls back to the server's default.
    const other = await online.createRoom({ nickname: 'Ana', private: true, turnSeconds: 7 });
    expect(other.turnSeconds).not.toBe(7);
  });

  it('pairs two players with quick join', async () => {
    const a = client(base);
    const b = client(base);
    const first = await a.online.quickJoin({ nickname: 'Ana' });
    expect(first.created).toBe(true);
    // The creator never gets their own room back.
    const roomA = a.online.joinRoom(first.room.id, { nickname: 'Ana', hero: 'random' });
    await next(roomA, 'welcome');
    const again = await a.online.quickJoin({ nickname: 'Ana' });
    expect(again.room.id).not.toBe(first.room.id);

    const second = await b.online.quickJoin({ nickname: 'Bea' });
    expect(second).toMatchObject({ created: false, room: { id: first.room.id } });
    const roomB = b.online.joinRoom(second.room.id, { nickname: 'Bea', hero: 'random' });
    await Promise.all([next(roomA, 'state'), next(roomB, 'state')]);
    roomA.leave();
    roomB.leave();
    // Close the extra room Ana's second quick join created.
    const extra = a.online.joinRoom(again.room.id, { nickname: 'Ana', hero: 'random' });
    await next(extra, 'welcome');
    extra.leave();
  });

  it('resumes the seat after the connection drops', async () => {
    const { b, roomA, roomB } = await startGame(base);
    const dropped = next(roomA, 'room', (r) => r.seats[1]?.connected === false);
    const back = dropped.then(() => next(roomA, 'room', (r) => r.seats[1]?.connected === true));
    const reconnecting = next(roomB, 'status', (s) => s === 'reconnecting');
    const resumed = Promise.all([next(roomB, 'welcome'), next(roomB, 'state')]);
    b.sockets.at(-1)!.close();
    const [awaySeat] = await Promise.all([dropped, reconnecting]);
    const left = awaySeat.seats[1]!.reconnectBy! - Date.now();
    expect(left).toBeGreaterThan(50_000);
    expect(left).toBeLessThanOrEqual(60_000);

    const [welcome, state] = await resumed;
    expect(welcome.seat).toBe(1);
    expect(state.resumed).toBe(true);
    expect(state.events).toEqual([]);
    expect(roomB.status).toBe('open');
    expect((await back).seats[1]?.reconnectBy).toBeNull();

    // The game goes on.
    const seq = state.view.seq;
    const moved = Promise.all([next(roomA, 'state'), next(roomB, 'state')]);
    expect(moveFor([roomA, roomB])).toBe(true);
    const [after] = await moved;
    expect(after.view.seq).toBe(seq + 1);
    roomA.leave();
    roomB.leave();
  });

  it('takes the seat back after a page reload and closes the old tab', async () => {
    const { b, roomA, roomB, id } = await startGame(base);
    // Same browser storage, new page.
    const reloaded = client(base, b.storage);
    expect(reloaded.online.hasSeat(id)).toBe(true);
    const replaced = next(roomB, 'closed');
    const roomB2 = reloaded.online.joinRoom(id, { nickname: 'ignored', hero: 'random' });
    const [welcome, state] = await Promise.all([next(roomB2, 'welcome'), next(roomB2, 'state')]);
    expect(welcome.seat).toBe(1);
    expect(welcome.room.seats[1]?.nickname).toBe('Bea');
    expect(state.resumed).toBe(true);
    expect((await replaced).reason).toBe('replaced');
    roomA.leave();
    roomB2.leave();
  });

  it('plays, concedes and starts a rematch with the score kept', async () => {
    const { roomA, roomB } = await startGame(base);
    const rooms = [roomA, roomB];
    for (let i = 0; i < 6; i++) {
      const moved = Promise.all(rooms.map((r) => next(r, 'state')));
      expect(moveFor(rooms)).toBe(true);
      await moved;
    }
    const emote = next(roomB, 'emote');
    roomA.emote('wellPlayed');
    expect(await emote).toEqual({ seat: 0, emote: 'wellPlayed', mine: false });

    roomB.concede();
    const finished = await next(roomA, 'room', (r) => r.status === 'finished');
    expect(finished.score).toEqual([1, 0]);
    expect(finished.ending).toMatchObject({ winner: 0, forfeit: { seat: 1, cause: 'conceded' } });

    roomA.rematch('hechicera');
    await next(roomB, 'room', (r) => r.seats[0]?.rematch === true);
    const restarted = next(roomA, 'state', (s) => s.events.some((e) => e.type === 'gameStarted'));
    roomB.rematch();
    const { view } = await restarted;
    expect(view.players[0].hero).toBe('hechicera');
    expect(view.active).toBe(1);
    expect(roomA.room).toMatchObject({ status: 'playing', games: 2, score: [1, 0] });
    roomA.leave();
    roomB.leave();
  });

  it('refuses illegal moves and a third player', async () => {
    const { roomA, roomB, id } = await startGame(base);
    const waiting = roomA.isMyTurn() ? roomB : roomA;
    const error = next(waiting, 'error');
    waiting.play(1);
    expect((await error).code).toBe('notYourTurn');

    const third = client(base).online.joinRoom(id, { nickname: 'Carla', hero: 'random' });
    expect((await next(third, 'closed')).reason).toBe('roomFull');
    roomA.leave();
    roomB.leave();
  });

  it('reports unknown rooms and bad requests', async () => {
    const ghost = client(base).online.joinRoom('zzzzzzzz', { nickname: 'Ana', hero: 'random' });
    expect((await next(ghost, 'closed')).reason).toBe('roomNotFound');
    await expect(client(base).online.createRoom({ nickname: '​' })).rejects.toMatchObject({
      code: 'badRequest',
      status: 400,
    });
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', body: 'x'.repeat(5000) });
    expect(response.status).toBe(400);
  });
});

describe('clocks', () => {
  let worker: Worker;
  let base: string;

  beforeAll(async () => {
    ({ worker, base } = await startServer({ RATE_LIMITS: 'off', TURN_SECONDS: '1', RECONNECT_SECONDS: '2' }));
  });

  afterAll(async () => {
    await worker?.dispose();
  });

  it('times out idle turns and forfeits a player who never moves', async () => {
    const { roomA, roomB } = await startGame(base);
    const sleeper = roomA.view!.active;
    const timedOut = await next(roomA, 'state', (s) => s.events.some((e) => e.type === 'timedOut'), 5000);
    expect(timedOut.view.active).not.toBe(sleeper);
    const finished = await next(roomB, 'room', (r) => r.status === 'finished', 15_000);
    expect(finished.ending?.forfeit).toEqual({ seat: sleeper, cause: 'inactive' });
    roomA.leave();
    roomB.leave();
  });

  it('forfeits a player who drops and does not come back in time', async () => {
    const { b, roomA, roomB, id } = await startGame(base);
    // Ana keeps playing her turns, so only Bea's absence decides.
    roomA.on('state', () => {
      if (roomA.isMyTurn()) moveFor([roomA]);
    });
    moveFor([roomA]);
    const away = next(roomA, 'room', (r) => r.seats[1]?.connected === false);
    roomB.close();
    const seat = (await away).seats[1]!;
    expect(seat.reconnectBy).not.toBeNull();
    const finished = await next(roomA, 'room', (r) => r.status === 'finished', 10_000);
    expect(finished.ending?.forfeit).toEqual({ seat: 1, cause: 'disconnected' });
    expect(finished.seats[1]?.left).toBe(true);

    // Coming back too late: the seat is gone and the SDK says so instead of retrying.
    const late = client(base, b.storage).online.joinRoom(id, { nickname: 'Bea', hero: 'random' });
    expect((await next(late, 'closed')).reason).toBe('seatLost');
    roomA.leave();
  });
});

describe('limits', () => {
  let worker: Worker;
  let base: string;

  beforeAll(async () => {
    ({ worker, base } = await startServer({}));
  });

  afterAll(async () => {
    await worker?.dispose();
  });

  it('caps the rooms one IP can keep waiting and how fast it creates them', async () => {
    const { online } = client(base);
    for (let i = 0; i < 3; i++) await online.createRoom({ nickname: `Ana ${i}` });
    await expect(online.createRoom({ nickname: 'Ana 3' })).rejects.toMatchObject({ code: 'tooManyRooms', status: 429 });
    // Private rooms do not crowd the list, but count towards the creation rate (6 per minute).
    await online.createRoom({ nickname: 'Ana 4', private: true });
    await online.createRoom({ nickname: 'Ana 5', private: true });
    const error = await online.createRoom({ nickname: 'Ana 6', private: true }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'rateLimited', status: 429 });
    expect((error as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThan(0);
  });

  it('accepts error reports from the page', async () => {
    const res = await fetch(`${base}/api/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ kind: 'error', message: 'x'.repeat(20_000) }),
    });
    expect(res.status).toBe(204);
    expect((await fetch(`${base}/api/client-error`)).status).toBe(405);
  });

  it('closes lobby sockets that send junk', async () => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/lobby');
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    for (let i = 0; i < 40; i++) ws.send('hello');
    expect(await closed).toBe(4008);
  });
});
