import { DEFAULT_TIMINGS, type RoomTimings } from '@cardcraft-castles/protocol';
import type { Lobby } from './lobby';
import type { Room } from './room';

export interface Env {
  LOBBY: DurableObjectNamespace<Lobby>;
  ROOM: DurableObjectNamespace<Room>;
  /**
   * Optional overrides for local development and tests. Leave them unset in
   * production: the defaults are the real game.
   */
  TURN_SECONDS?: string;
  RECONNECT_SECONDS?: string;
  /** `"off"` disables the per-IP limits on creating rooms (tests run everything from one IP). */
  RATE_LIMITS?: string;
}

function positive(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return value !== undefined && Number.isFinite(number) && number > 0 ? number : fallback;
}

export function timingsFrom(env: Env): RoomTimings {
  const reconnectMs = positive(env.RECONNECT_SECONDS, DEFAULT_TIMINGS.reconnectMs / 1000) * 1000;
  return {
    ...DEFAULT_TIMINGS,
    turnSeconds: positive(env.TURN_SECONDS, DEFAULT_TIMINGS.turnSeconds),
    reconnectMs,
    waitingReconnectMs: Math.min(DEFAULT_TIMINGS.waitingReconnectMs, reconnectMs),
  };
}
