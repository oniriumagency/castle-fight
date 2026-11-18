/** A fake platform for `RoomCore`: sockets that record what they get, and a clock the test moves. */
import { legalActions, type PlayerId } from '@cardcraft-castles/engine';
import {
  DEFAULT_TIMINGS,
  PROTOCOL_VERSION,
  type HeroChoice,
  type RoomClientMessage,
  type RoomServerMessage,
  type RoomTimings,
} from '@cardcraft-castles/protocol';
import { RoomCore, newRoomRecord, type RoomHost } from '../src/roomCore';

type MessageOf<T extends RoomServerMessage['type']> = Extract<RoomServerMessage, { type: T }>;

export class FakeSocket {
  seat: PlayerId | null = null;
  open = true;
  closedWith: { code: number; reason: string } | null = null;
  readonly received: RoomServerMessage[] = [];

  constructor(readonly name: string) {}

  all<T extends RoomServerMessage['type']>(type: T): MessageOf<T>[] {
    return this.received.filter((m): m is MessageOf<T> => m.type === type);
  }

  last<T extends RoomServerMessage['type']>(type: T): MessageOf<T> | undefined {
    return this.all(type).at(-1);
  }

  clear(): void {
    this.received.length = 0;
  }
}

export class FakeHost implements RoomHost<FakeSocket> {
  time = 1_700_000_000_000;
  readonly list: FakeSocket[] = [];
  private counter = 0;
  /** Raw JSON of everything sent, to look for leaks. */
  readonly wire: string[] = [];

  now = (): number => this.time;
  sockets = (): FakeSocket[] => this.list.filter((s) => s.open);
  seatOf = (socket: FakeSocket): PlayerId | null => socket.seat;
  setSeat = (socket: FakeSocket, seat: PlayerId | null): void => {
    socket.seat = seat;
  };
  send = (socket: FakeSocket, message: RoomServerMessage): void => {
    const text = JSON.stringify(message);
    this.wire.push(text);
    socket.received.push(JSON.parse(text) as RoomServerMessage);
  };
  close = (socket: FakeSocket, code: number, reason: string): void => {
    socket.open = false;
    socket.closedWith = { code, reason };
  };
  randomToken = (): string => `token-${String(++this.counter).padStart(16, '0')}`;
  randomSeed = (): string => `seed-${++this.counter}`;
  randomIndex = (n: number): number => (this.counter++ * 7) % n;
}

export function makeRoom(options: { timings?: Partial<RoomTimings>; private?: boolean } = {}) {
  const host = new FakeHost();
  const record = newRoomRecord(
    {
      id: 'abcdefgh',
      name: 'Sala de prueba',
      host: 'Ana',
      private: options.private ?? false,
      timings: { ...DEFAULT_TIMINGS, ...options.timings },
    },
    host.time,
  );
  const core = new RoomCore(record, host);
  let sockets = 0;

  const room = {
    host,
    core,
    record,
    connect(name = `socket-${++sockets}`): FakeSocket {
      const socket = new FakeSocket(name);
      host.list.push(socket);
      core.connected(socket);
      return socket;
    },
    send(socket: FakeSocket, message: RoomClientMessage | Record<string, unknown>): void {
      core.receive(socket, JSON.stringify(message));
    },
    join(socket: FakeSocket, nickname: string, hero: HeroChoice = 'arquitecta'): void {
      room.send(socket, { type: 'join', v: PROTOCOL_VERSION, nickname, hero });
    },
    /** The socket drops (closed from the other side). */
    drop(socket: FakeSocket): void {
      socket.open = false;
      core.disconnected(socket);
    },
    advance(ms: number): void {
      host.time += ms;
      core.tick();
    },
    /** Two players seated and a game running. */
    start(heroes: [HeroChoice, HeroChoice] = ['arquitecta', 'mariscal']) {
      const a = room.connect('ana');
      const b = room.connect('bea');
      room.join(a, 'Ana', heroes[0]);
      room.join(b, 'Bea', heroes[1]);
      return { a, b };
    },
    /** Socket of the player to move. */
    active(a: FakeSocket, b: FakeSocket): FakeSocket {
      return record.game!.active === a.seat ? a : b;
    },
    /** The player to move makes some legal move, as their client would compute it. */
    move(a: FakeSocket, b: FakeSocket): void {
      const socket = room.active(a, b);
      const view = socket.last('state')!.view;
      const actions = legalActions(view);
      const action = actions.find((x) => x.type === 'play') ?? actions[0]!;
      room.send(socket, { type: 'action', action });
    },
  };
  return room;
}
