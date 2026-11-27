/** The ranked queue (`RankedCore`) and ranked rooms, with fake sockets, an in-memory store and a fake clock. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMINGS,
  PROTOCOL_VERSION,
  RANKED_RULES,
  formatRecoveryCode,
  parseRecoveryCode,
  ratingChange,
  searchWindow,
  seasonEnd,
  seasonOf,
  stakes,
  tierOf,
  type RankedClientMessage,
  type RankedServerMessage,
} from '@cardcraft-castles/protocol';
import { RankedCore, type MatchRow, type NewRankedRoom, type ProfileRow, type QueueSocketState, type RankedHost, type RankedStore } from '../src/rankedCore';
import { RoomCore, newRoomRecord } from '../src/roomCore';
import { FakeHost, FakeSocket } from './helpers';

type MessageOf<T extends RankedServerMessage['type']> = Extract<RankedServerMessage, { type: T }>;

class Client {
  state: QueueSocketState;
  open = true;
  closedWith: number | null = null;
  readonly received: RankedServerMessage[] = [];
  constructor(ip: string) {
    this.state = { ip, ready: false, profileId: null, search: null, outgoing: null };
  }
  all<T extends RankedServerMessage['type']>(type: T): MessageOf<T>[] {
    return this.received.filter((m): m is MessageOf<T> => m.type === type);
  }
  last<T extends RankedServerMessage['type']>(type: T): MessageOf<T> | undefined {
    return this.all(type).at(-1);
  }
}

class MemoryStore implements RankedStore {
  readonly profiles = new Map<string, ProfileRow>();
  readonly matches = new Map<string, MatchRow>();
  profileBySecret(hash: string) {
    return [...this.profiles.values()].find((p) => p.secretHash === hash) ?? null;
  }
  profile(id: string) {
    return this.profiles.get(id) ?? null;
  }
  saveProfile(row: ProfileRow) {
    this.profiles.set(row.id, { ...row });
  }
  match(id: string) {
    return this.matches.get(id) ?? null;
  }
  saveMatch(row: MatchRow) {
    this.matches.set(row.id, { ...row });
  }
  openMatchOf(id: string, since: number) {
    return [...this.matches.values()].find((m) => m.state === 'open' && m.createdAt > since && (m.a === id || m.b === id)) ?? null;
  }
  pairGames(a: string, b: string, since: number) {
    return [...this.matches.values()].filter(
      (m) => m.state === 'scored' && m.rated && m.createdAt > since && ((m.a === a && m.b === b) || (m.a === b && m.b === a)),
    ).length;
  }
  top(season: number, limit: number) {
    return [...this.profiles.values()]
      .filter((p) => p.season === season && p.seasonGames > 0)
      .sort((x, y) => y.rating - x.rating)
      .slice(0, limit);
  }
}

function makeQueue() {
  const store = new MemoryStore();
  const rooms: NewRankedRoom[] = [];
  const clients: Client[] = [];
  let counter = 0;
  const host: RankedHost<Client> = {
    now: () => queue.time,
    sockets: () => clients.filter((c) => c.open),
    state: (c) => c.state,
    setState: (c, s) => void (c.state = { ...s }),
    send: (c, m) => void c.received.push(JSON.parse(JSON.stringify(m)) as RankedServerMessage),
    close: (c, code) => {
      c.open = false;
      c.closedWith = code;
    },
    hash: async (secret) => `hash:${secret}`,
    randomIndex: (n) => (counter++ * 7919) % n,
    roomId: () => `room${String(++counter).padStart(4, '0')}`,
    createRoom: async (room) => void rooms.push(room),
    limits: true,
  };
  const core = new RankedCore(store, host);
  const queue = {
    time: Date.UTC(2026, 10, 27, 18),
    store,
    rooms,
    core,
    async connect(ip = '1.1.1.1', secret: string | null = null): Promise<Client> {
      const c = new Client(ip);
      clients.push(c);
      core.connected(c);
      await queue.send(c, { type: 'hello', v: PROTOCOL_VERSION, secret });
      return c;
    },
    async send(c: Client, message: RankedClientMessage): Promise<void> {
      await core.receive(c, JSON.stringify(message));
    },
    async search(c: Client, nickname = 'Ana'): Promise<void> {
      await queue.send(c, { type: 'search', nickname, hero: 'arquitecta' });
    },
    async advance(ms: number): Promise<void> {
      queue.time += ms;
      await core.tick();
    },
    /** Give a profile a rating directly. */
    rate(c: Client, rating: number, games = 20): void {
      const row = store.profile(c.state.profileId!)!;
      store.saveProfile({ ...row, rating, games });
    },
    drop(c: Client): void {
      c.open = false;
      core.disconnected(c);
    },
  };
  return queue;
}

describe('rating rules', () => {
  it('moves 16 points between equals and less for the favourite as the gap grows', () => {
    expect(stakes(1000, 1000, 20)).toEqual({ win: 16, loss: -16 });
    expect(stakes(1200, 1000, 20)).toEqual({ win: 8, loss: -24 });
    expect(stakes(1000, 1200, 20)).toEqual({ win: 24, loss: -8 });
    expect(stakes(1400, 1000, 20)).toEqual({ win: 3, loss: -29 });
  });

  it('counts half again while a profile is still calibrating, and a decided game always moves a point', () => {
    expect(stakes(1000, 1000, 0)).toEqual({ win: 24, loss: -24 });
    expect(ratingChange(2000, 1000, 20, 1)).toBe(1);
    expect(ratingChange(1000, 2000, 20, 0)).toBe(-1);
  });

  it('widens the search window every 10 s up to 400', () => {
    expect(searchWindow(0)).toBe(100);
    expect(searchWindow(9_999)).toBe(100);
    expect(searchWindow(10_000)).toBe(150);
    expect(searchWindow(60_000)).toBe(400);
    expect(searchWindow(600_000)).toBe(400);
  });

  it('names leagues and two-month seasons', () => {
    expect(tierOf(899)).toBe('bronze');
    expect(tierOf(1000)).toBe('silver');
    expect(tierOf(1500)).toBe('legend');
    expect(seasonOf(Date.UTC(2026, 10, 27))).toBe(1);
    expect(seasonOf(Date.UTC(2027, 0, 1))).toBe(2);
    expect(seasonEnd(1)).toBe(Date.UTC(2027, 0, 1));
  });

  it('reads recovery codes however they are typed', () => {
    const secret = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    expect(formatRecoveryCode(secret)).toBe('ABCD-EFGH-JKLM-NPQR-STUV-WXYZ');
    expect(parseRecoveryCode(' abcd efgh-jklm npqr stuv wxyz ')).toBe(secret);
    expect(parseRecoveryCode('nope')).toBeNull();
  });
});

describe('ranked queue', () => {
  it('makes a profile on the first search and finds it again with its secret', async () => {
    const q = makeQueue();
    const a = await q.connect();
    expect(a.last('profile')!.profile).toBeNull();
    await q.search(a, 'Magne');
    const made = a.last('profile')!;
    expect(made.secret).toMatch(/^[A-Z2-9]{24}$/);
    expect(made.profile).toMatchObject({ nickname: 'Magne', rating: 1000, games: 0 });
    expect(made.profile!.tag).toMatch(/^\d{4}$/);

    const again = await q.connect('9.9.9.9', made.secret!);
    expect(again.last('profile')!.profile!.id).toBe(made.profile!.id);
    // One connection per profile: the older one is closed.
    expect(a.open).toBe(false);
  });

  it('tells a browser when its code matches no profile', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1', 'ZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(a.last('error')!.code).toBe('unknownProfile');
    expect(a.last('profile')!.profile).toBeNull();
  });

  it('pairs two searchers in reach and hands each a ticket to the same room', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    expect(q.rooms).toHaveLength(1);
    const ma = a.last('matched')!.match;
    const mb = b.last('matched')!.match;
    expect(ma.roomId).toBe(mb.roomId);
    expect(ma.ticket).not.toBe(mb.ticket);
    expect(q.rooms[0]!.tickets).toEqual([ma.ticket, mb.ticket]);
    expect(ma.opponent.nickname).toBe('Bea');
    expect(ma.stakes).toEqual({ win: 24, loss: -24 });
    expect(a.state.search).toBeNull();
  });

  it('waits for the window to reach a distant rating, then pairs', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.send(a, { type: 'cancel' });
    q.rate(a, 1250);
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    expect(q.rooms).toHaveLength(0);
    await q.advance(20_000);
    expect(q.rooms).toHaveLength(0);
    expect(a.last('queue')!.window).toBe(200);
    await q.advance(10_000);
    expect(q.rooms).toHaveLength(1);
  });

  it('never pairs two browsers on the same network automatically', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('1.1.1.1');
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    await q.advance(60_000);
    expect(q.rooms).toHaveLength(0);
  });

  it('opens challenges after 30 s: the challenged player decides, and a challenge across a gap is worth more', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.send(a, { type: 'cancel' });
    q.rate(a, 1500);
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    expect(a.last('queue')!.challengesOpen).toBe(false);
    await q.send(a, { type: 'challenge', target: b.state.profileId! });
    expect(a.last('error')!.code).toBe('notChallengeable');

    await q.advance(30_000);
    const seen = b.last('queue')!;
    expect(seen.challengesOpen).toBe(true);
    const ana = seen.players.find((p) => p.nickname === 'Ana')!;
    // Bea is 500 below (and still calibrating, so half again): a win is worth a lot, a loss costs little.
    expect(ana.stakes).toEqual({ win: 45, loss: -3 });

    await q.send(b, { type: 'challenge', target: a.state.profileId! });
    const challenged = a.last('challenged')!;
    expect(challenged.from.nickname).toBe('Bea');
    expect(challenged.from.stakes).toEqual({ win: 2, loss: -30 });
    await q.send(a, { type: 'answer', from: b.state.profileId!, accept: true });
    expect(q.rooms).toHaveLength(1);
    expect(b.last('matched')!.match.stakes).toEqual({ win: 45, loss: -3 });
  });

  it('lets the challenged player decline, and lapses unanswered challenges', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.send(a, { type: 'cancel' });
    q.rate(a, 1600);
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    await q.advance(30_000);
    await q.send(b, { type: 'challenge', target: a.state.profileId! });
    await q.send(a, { type: 'answer', from: b.state.profileId!, accept: false });
    expect(b.last('challengeEnded')!.reason).toBe('declined');

    await q.send(b, { type: 'challenge', target: a.state.profileId! });
    await q.advance(RANKED_RULES.challengeTtlMs);
    expect(b.last('challengeEnded')!.reason).toBe('expired');
    expect(q.rooms).toHaveLength(0);
  });

  it('refuses challenges across more than 600 points', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.send(a, { type: 'cancel' });
    q.rate(a, 1700);
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    await q.advance(30_000);
    expect(b.last('queue')!.players[0]!.challengeable).toBe(false);
    await q.send(b, { type: 'challenge', target: a.state.profileId! });
    expect(b.last('error')!.code).toBe('notChallengeable');
  });

  it('scores a reported game once, and keeps players out of the queue while their game runs', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    const room = q.rooms[0]!;
    await q.search(a, 'Ana');
    expect(a.last('error')!.code).toBe('busy');

    const info = q.core.report(room.matchId, 1)!;
    expect(info.rated).toBe(true);
    expect(info.result).toEqual([
      { before: 1000, after: 976, delta: -24 },
      { before: 1000, after: 1024, delta: 24 },
    ]);
    expect(q.core.report(room.matchId, 0)).toEqual(info);
    expect(b.last('profile')!.profile).toMatchObject({ rating: 1024, wins: 1, games: 1, seasonGames: 1 });
    expect(a.last('profile')!.profile).toMatchObject({ rating: 976, losses: 1 });
  });

  it('stops rating the same pair after three games a day', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    for (let i = 0; i < 3; i++) {
      await q.search(a, 'Ana');
      await q.search(b, 'Bea');
      q.core.report(q.rooms.at(-1)!.matchId, 0);
      q.time += 60_000;
    }
    expect(q.rooms).toHaveLength(3);
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    await q.advance(60_000);
    // The automatic matching no longer pairs them...
    expect(q.rooms).toHaveLength(3);
    // ...and a challenge between them would not be rated.
    expect(a.last('queue')!.players[0]!.stakes).toBeNull();
  });

  it('keeps whoever did not take their seat out of the queue for a minute', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    q.core.abort(q.rooms[0]!.matchId, [1]);
    await q.search(b, 'Bea');
    expect(b.last('error')!.code).toBe('cooldown');
    await q.search(a, 'Ana');
    expect(a.state.search).not.toBeNull();
    q.time += RANKED_RULES.noShowCooldownMs;
    await q.search(b, 'Bea');
    expect(q.rooms).toHaveLength(2);
  });

  it('lists the season leaderboard', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    const b = await q.connect('2.2.2.2');
    await q.search(a, 'Ana');
    await q.search(b, 'Bea');
    q.core.report(q.rooms[0]!.matchId, 0);
    await q.send(a, { type: 'top' });
    const top = a.last('top')!.leaderboard;
    expect(top.season).toBe(1);
    expect(top.players.map((p) => p.nickname)).toEqual(['Ana', 'Bea']);
  });

  it('pulls ratings halfway back to 1000 when a new season starts', async () => {
    const q = makeQueue();
    const a = await q.connect('1.1.1.1');
    await q.search(a, 'Ana');
    const secret = a.last('profile')!.secret!;
    q.rate(a, 1400);
    q.time = Date.UTC(2027, 0, 2);
    const back = await q.connect('1.1.1.1', secret);
    expect(back.last('profile')!.profile).toMatchObject({ rating: 1200, season: 2, seasonGames: 0 });
  });
});

describe('ranked rooms', () => {
  function rankedRoom() {
    const host = new FakeHost();
    const record = newRoomRecord(
      {
        id: 'abcdefgh',
        name: 'Ana#1234 vs Bea#5678',
        host: 'Ana#1234',
        private: true,
        timings: DEFAULT_TIMINGS,
        ranked: { matchId: 'm1', rated: true, names: ['Ana#1234', 'Bea#5678'], tickets: ['ticket-a-0000000', 'ticket-b-0000000'] },
      },
      host.time,
    );
    const core = new RoomCore(record, host);
    const connect = (name: string) => {
      const s = new FakeSocket(name);
      host.list.push(s);
      core.connected(s);
      return s;
    };
    const join = (s: FakeSocket, ticket?: string) =>
      core.receive(s, JSON.stringify({ type: 'join', v: PROTOCOL_VERSION, nickname: 'Fake', hero: 'arquitecta', ticket }));
    return { host, record, core, connect, join };
  }

  it('seats players by ticket with their ranked names, and turns away anyone else', () => {
    const r = rankedRoom();
    const stranger = r.connect('x');
    r.join(stranger);
    expect(stranger.last('error')!.code).toBe('badTicket');
    const b = r.connect('b');
    r.join(b, 'ticket-b-0000000');
    expect(b.last('welcome')!.seat).toBe(1);
    const a = r.connect('a');
    r.join(a, 'ticket-a-0000000');
    expect(r.record.status).toBe('playing');
    expect(a.last('room')!.room.seats.map((s) => s!.nickname)).toEqual(['Ana#1234', 'Bea#5678']);
    expect(a.last('room')!.room.ranked).toEqual({ rated: true, result: null });
  });

  it('reports the winner once, shows the new ratings and allows no rematch', () => {
    const r = rankedRoom();
    const a = r.connect('a');
    const b = r.connect('b');
    r.join(a, 'ticket-a-0000000');
    r.join(b, 'ticket-b-0000000');
    expect(r.core.pendingRankedReport()).toBeNull();
    r.core.receive(a, JSON.stringify({ type: 'action', action: { type: 'concede' } }));
    expect(r.core.pendingRankedReport()).toEqual({ matchId: 'm1', winner: 1 });
    r.core.rankedScored({ rated: true, result: [{ before: 1000, after: 984, delta: -16 }, { before: 1000, after: 1016, delta: 16 }] });
    expect(r.core.pendingRankedReport()).toBeNull();
    expect(b.last('room')!.room.ranked!.result![1]!.delta).toBe(16);
    r.core.receive(a, JSON.stringify({ type: 'rematch' }));
    expect(a.last('error')!.code).toBe('rematchUnavailable');
  });

  it('gives up when a player does not sit in time, naming the no-show', () => {
    const r = rankedRoom();
    const a = r.connect('a');
    r.join(a, 'ticket-a-0000000');
    r.host.time += RANKED_RULES.joinWithinMs;
    r.core.tick();
    expect(r.core.closed).toBe(true);
    expect(r.record.ranked!.absent).toEqual([1]);
  });

  it('counts walking out before the start as a no-show', () => {
    const r = rankedRoom();
    const a = r.connect('a');
    r.join(a, 'ticket-a-0000000');
    r.core.receive(a, JSON.stringify({ type: 'leave' }));
    expect(r.core.closed).toBe(true);
    expect(r.record.ranked!.absent).toEqual([0]);
  });
});
