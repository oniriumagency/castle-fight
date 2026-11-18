import { describe, expect, it } from 'vitest';
import type { RoomSummary } from '@cardcraft-castles/protocol';
import { LOBBY_LIMITS, LobbyBook } from '../src/lobbyBook';
import { TokenBucket, WindowLimiter } from '../src/limits';
import type { LobbyRoomUpdate } from '../src/roomCore';

const NOW = 1_700_000_000_000;

function room(id: string, overrides: Partial<RoomSummary> = {}, open = true): LobbyRoomUpdate {
  return {
    open,
    summary: {
      id,
      name: `Sala ${id}`,
      host: 'Ana',
      status: 'waiting',
      players: 1,
      private: false,
      createdAt: NOW,
      turnSeconds: 30,
      ...overrides,
    },
  };
}

describe('LobbyBook', () => {
  it('lists open and playing public rooms, waiting first and newest first', () => {
    const book = new LobbyBook();
    book.update(room('aaaaaaaa', { createdAt: NOW }), NOW);
    book.update(room('bbbbbbbb', { createdAt: NOW + 1 }), NOW);
    book.update(room('cccccccc', { status: 'playing', players: 2, createdAt: NOW + 2 }, false), NOW);
    book.update(room('dddddddd', { private: true }), NOW);
    book.update(room('eeeeeeee', { players: 0 }, false), NOW);
    expect(book.list().map((r) => r.id)).toEqual(['bbbbbbbb', 'aaaaaaaa', 'cccccccc']);
    expect(book.stats(5)).toEqual({ online: 5, waiting: 2, playing: 1 });
  });

  it('tells subscribers only what they can see', () => {
    const book = new LobbyBook();
    expect(book.update(room('aaaaaaaa', { players: 0 }, false), NOW)).toBeNull();
    expect(book.update(room('aaaaaaaa'), NOW)).toMatchObject({ type: 'room', room: { id: 'aaaaaaaa' } });
    expect(book.update(room('aaaaaaaa'), NOW + 1)).toBeNull();
    // The host dropped: no longer joinable.
    expect(book.update(room('aaaaaaaa', {}, false), NOW)).toEqual({ type: 'roomRemoved', id: 'aaaaaaaa' });
    expect(book.update(room('aaaaaaaa', { status: 'playing', players: 2 }, false), NOW)).toMatchObject({
      type: 'room',
      room: { status: 'playing' },
    });
    expect(book.update(room('aaaaaaaa', { status: 'finished', players: 2 }, false), NOW)).toEqual({
      type: 'roomRemoved',
      id: 'aaaaaaaa',
    });
    expect(book.size).toBe(0);
    expect(book.update(room('dddddddd', { private: true }), NOW)).toBeNull();
  });

  it('quick join picks the room that waited longest, never your own, one player at a time', () => {
    const book = new LobbyBook();
    book.update(room('newerroo', { createdAt: NOW + 10 }), NOW, 'client-b');
    book.update(room('olderroo', { createdAt: NOW }), NOW, 'client-a');
    book.update(room('privatee', { private: true, createdAt: NOW - 10 }), NOW, 'client-c');
    // Later updates from the room keep who created it.
    book.update(room('olderroo', { createdAt: NOW }), NOW + 1);

    expect(book.pickOpen('client-a', NOW)?.id).toBe('newerroo');
    expect(book.pickOpen('client-z', NOW)?.id).toBe('olderroo');
    // Both are reserved for a few seconds.
    expect(book.pickOpen('client-z', NOW + 1)).toBeNull();
    expect(book.pickOpen('client-z', NOW + LOBBY_LIMITS.reservationMs)?.id).toBe('olderroo');
  });

  it('drops rooms that stopped reporting', () => {
    const book = new LobbyBook();
    book.update(room('aaaaaaaa'), NOW);
    book.update(room('bbbbbbbb'), NOW + LOBBY_LIMITS.staleMs / 2);
    expect(book.prune(NOW + LOBBY_LIMITS.staleMs)).toEqual([{ type: 'roomRemoved', id: 'aaaaaaaa' }]);
    expect(book.list().map((r) => r.id)).toEqual(['bbbbbbbb']);
  });

  it('survives a save and restore', () => {
    const book = new LobbyBook();
    book.update(room('aaaaaaaa'), NOW, 'client-a');
    const restored = new LobbyBook(JSON.parse(JSON.stringify(book.save())));
    expect(restored.list()).toEqual(book.list());
    expect(restored.pickOpen('client-a', NOW)).toBeNull();
  });
});

describe('rate limiters', () => {
  it('TokenBucket allows a burst and then a steady rate', () => {
    const bucket = new TokenBucket(3, 2, 0);
    expect([bucket.take(0), bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, true, false]);
    expect(bucket.take(499)).toBe(false);
    expect(bucket.take(500)).toBe(true);
  });

  it('WindowLimiter counts per key and says how long to wait', () => {
    const limiter = new WindowLimiter(2, 60_000);
    expect(limiter.hit('1.1.1.1', 0)).toBe(0);
    expect(limiter.hit('1.1.1.1', 10_000)).toBe(0);
    expect(limiter.hit('1.1.1.1', 20_000)).toBe(40_000);
    expect(limiter.hit('2.2.2.2', 20_000)).toBe(0);
    expect(limiter.hit('1.1.1.1', 60_000)).toBe(0);
  });
});
