/**
 * Ranked play end to end: a real local Worker (workerd) with the ranked queue,
 * its SQLite profiles and a ranked room, driven through the client SDK.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';
import { OnlineClient, type Emitter, type KeyValueStorage, type WebSocketLike } from '@cardcraft-castles/protocol/client';
import { RANKED_SECRET_KEY } from '@cardcraft-castles/protocol';

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

function memory(): KeyValueStorage {
  const items = new Map<string, string>();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) };
}

function client(base: string, storage: KeyValueStorage = memory()) {
  const online = new OnlineClient({
    baseUrl: base,
    storage,
    heartbeatMs: 60_000,
    createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
  });
  return { online, storage };
}

function next<E extends object, K extends keyof E>(emitter: Emitter<E>, type: K, test?: (payload: E[K]) => boolean): Promise<E[K]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${String(type)}`)), 10_000);
  });
  return Promise.race([emitter.once(type, test), timeout]).finally(() => clearTimeout(timer));
}

describe('ranked play', () => {
  let worker: Worker;
  let base: string;

  beforeAll(async () => {
    worker = await unstable_startWorker({
      config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      bindings: { RATE_LIMITS: { type: 'plain_text', value: 'off' } },
      dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, watch: false, persist: false, logLevel: 'error' },
    } as Parameters<typeof unstable_startWorker>[0]);
    await worker.ready;
    base = (await worker.url).origin;
  });

  afterAll(async () => {
    await worker?.dispose();
  });

  it('matches two searchers, seats them by ticket and scores the game', async () => {
    const a = client(base);
    const b = client(base);
    const qa = a.online.connectRanked();
    const qb = b.online.connectRanked();
    expect(await next(qa, 'profile')).toBeNull();
    await next(qb, 'profile');

    const matchedA = next(qa, 'matched');
    const matchedB = next(qb, 'matched');
    qa.search('Ana', 'arquitecta');
    const profileA = await next(qa, 'profile', (p) => p !== null);
    expect(profileA).toMatchObject({ nickname: 'Ana', rating: 1000 });
    expect(a.storage.getItem(RANKED_SECRET_KEY)).toMatch(/^[A-Z2-9]{24}$/);
    qb.search('Bea', 'mariscal');
    const [ma, mb] = await Promise.all([matchedA, matchedB]);
    expect(ma.roomId).toBe(mb.roomId);
    expect(ma.stakes).toEqual({ win: 24, loss: -24 });

    const roomA = a.online.joinRoom(ma.roomId, { nickname: 'whatever', hero: 'arquitecta', ticket: ma.ticket });
    const roomB = b.online.joinRoom(mb.roomId, { nickname: 'whatever', hero: 'mariscal', ticket: mb.ticket });
    await Promise.all([next(roomA, 'state'), next(roomB, 'state')]);
    expect(roomA.room!.seats.map((s) => s!.nickname.split('#')[0])).toEqual(['Ana', 'Bea']);
    expect(roomA.room!.ranked).toEqual({ rated: true, result: null });

    const scored = next(roomB, 'room', (room) => !!room.ranked?.result);
    const refreshed = next(qb, 'profile', (p) => !!p && p.games === 1);
    roomA.concede();
    const room = await scored;
    expect(room.ranked!.result![roomB.seat!]).toEqual({ before: 1000, after: 1024, delta: 24 });
    expect(await refreshed).toMatchObject({ rating: 1024, wins: 1 });

    // The same profile from another device, with the recovery code.
    const other = client(base);
    const qc = other.online.connectRanked();
    await next(qc, 'profile');
    expect(qc.useRecoveryCode(qa.recoveryCode!)).toBe(true);
    expect(await next(qc, 'profile', (p) => p !== null)).toMatchObject({ id: profileA!.id, rating: 976 });

    qb.requestTop();
    const top = await next(qb, 'top');
    expect(top.players.map((p: { nickname: string }) => p.nickname)).toEqual(['Bea', 'Ana']);

    roomA.close();
    roomB.close();
    qa.close();
    qb.close();
    qc.close();
  });
});
