import type { Lobby } from './lobby';
import type { Room } from './room';

export interface Env {
  LOBBY: DurableObjectNamespace<Lobby>;
  ROOM: DurableObjectNamespace<Room>;
}
