/** A handshake that never finishes is dropped and retried instead of leaving the lobby on "Connecting…". */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineClient, type WebSocketLike } from '@cardcraft-castles/protocol/client';

class StalledSocket implements WebSocketLike {
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

describe('socket handshake timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('gives up on a stalled handshake and opens a new socket', () => {
    vi.useFakeTimers();
    const sockets: StalledSocket[] = [];
    const online = new OnlineClient({
      baseUrl: 'https://example.test',
      storage: null,
      createSocket: () => {
        const s = new StalledSocket();
        sockets.push(s);
        return s;
      },
      fetch: (() => Promise.reject(new Error('unused'))) as never,
    });
    const lobby = online.connectLobby();
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(9_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closed).toBe(false);

    vi.advanceTimersByTime(1_500);
    expect(sockets[0]!.closed).toBe(true);
    expect(lobby.status).toBe('reconnecting');

    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    // A socket that opens in time is kept.
    sockets[1]!.readyState = 1;
    sockets[1]!.onopen?.();
    vi.advanceTimersByTime(15_000);
    expect(sockets[1]!.closed).toBe(false);
    expect(lobby.status).toBe('open');
    lobby.close();
  });
});
