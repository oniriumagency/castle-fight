import { describe, expect, it } from 'vitest';
import { HEROES } from '@cardcraft-castles/engine';
import { CLOSE_CODES, DEFAULT_TIMINGS, PROTOCOL_VERSION } from '@cardcraft-castles/protocol';
import { ROOM_LIMITS } from '../src/roomCore';
import { makeRoom } from './helpers';

const TURN_MS = DEFAULT_TIMINGS.turnSeconds * 1000;

describe('seating', () => {
  it('sends the room info on connect, before joining', () => {
    const room = makeRoom();
    const socket = room.connect();
    const info = socket.last('room')!.room;
    expect(info.status).toBe('waiting');
    expect(info.seats).toEqual([null, null]);
    expect(info.timings).toEqual(DEFAULT_TIMINGS);
  });

  it('seats the first player, gives them a token and opens the room to the lobby', () => {
    const room = makeRoom();
    const socket = room.connect();
    room.join(socket, '  Ana\u200b  ');
    const welcome = socket.last('welcome')!;
    expect(welcome.seat).toBe(0);
    expect(welcome.token.length).toBeGreaterThanOrEqual(16);
    expect(welcome.room.seats[0]).toMatchObject({ nickname: 'Ana', hero: null, connected: true, left: false });
    expect(room.core.lobbyUpdate()).toMatchObject({ open: true, summary: { status: 'waiting', players: 1 } });
    expect(room.core.takeDirty()).toBe(true);
  });

  it('starts the game when the second player sits, with each view hiding the other hand', () => {
    const room = makeRoom();
    const { a, b } = room.start(['arquitecta', 'random']);
    expect(room.record.status).toBe('playing');
    expect(room.record.games).toBe(1);
    expect(HEROES.map((h) => h.id)).toContain(room.record.seats[1]!.hero);

    for (const [socket, seat] of [
      [a, 0],
      [b, 1],
    ] as const) {
      const { view, events, deadline, resumed } = socket.last('state')!;
      expect(view.viewer).toBe(seat);
      expect(resumed).toBe(false);
      expect(deadline).toBe(room.host.time + TURN_MS);
      expect(view.players[seat].hand.every((c) => c.cardId !== null)).toBe(true);
      expect(view.players[1 - seat]!.hand.every((c) => c.cardId === null)).toBe(true);
      const opponentDraws = events.filter((e) => e.type === 'cardsDrawn' && e.player !== seat);
      expect(opponentDraws.length).toBeGreaterThan(0);
      for (const draw of opponentDraws) {
        if (draw.type === 'cardsDrawn') expect(draw.cards.every((c) => c.cardId === null)).toBe(true);
      }
    }
    // Nothing secret ever goes on the wire.
    for (const text of room.host.wire) {
      expect(text).not.toMatch(/"rng"|"deck"|"discard":\[/);
    }
    expect(room.core.lobbyUpdate()).toMatchObject({ open: false, summary: { status: 'playing', players: 2 } });
  });

  it('refuses a third player and closes their socket', () => {
    const room = makeRoom();
    room.start();
    const c = room.connect();
    room.join(c, 'Carla');
    expect(c.last('error')?.code).toBe('roomFull');
    expect(c.closedWith?.code).toBe(CLOSE_CODES.roomFull);
  });

  it('refuses outdated clients', () => {
    const room = makeRoom();
    const socket = room.connect();
    room.send(socket, { type: 'join', v: PROTOCOL_VERSION - 1, nickname: 'Ana', hero: 'arquitecta' });
    expect(socket.last('error')?.code).toBe('outdated');
    expect(socket.closedWith?.code).toBe(CLOSE_CODES.outdated);
  });

  it('gives a default nickname when the one sent is empty', () => {
    const room = makeRoom();
    const socket = room.connect();
    room.join(socket, '\u200b\u200b ');
    expect(socket.last('welcome')!.room.seats[0]!.nickname).toBe('Jugador 1');
  });

  it('rejects a second join from the same socket', () => {
    const room = makeRoom();
    const socket = room.connect();
    room.join(socket, 'Ana');
    room.join(socket, 'Ana');
    expect(socket.last('error')?.code).toBe('alreadySeated');
  });

  it('limits the number of sockets per room', () => {
    const room = makeRoom();
    const sockets = Array.from({ length: ROOM_LIMITS.maxSockets + 1 }, () => room.connect());
    expect(sockets.at(-1)!.closedWith?.code).toBe(CLOSE_CODES.tooManyConnections);
    expect(sockets[0]!.open).toBe(true);
  });
});

describe('playing', () => {
  it('applies moves for the seat of the socket, whatever player the client claims', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    const waiting = room.record.game!.active === 0 ? b : a;
    const theirSeat = waiting.seat === 0 ? 1 : 0;
    const uid = room.record.game!.players[theirSeat].hand[0]!.uid;
    room.send(waiting, { type: 'action', action: { type: 'discard', uid, player: theirSeat } });
    expect(waiting.last('error')?.code).toBe('notYourTurn');

    const seq = room.record.game!.seq;
    room.move(a, b);
    expect(room.record.game!.seq).toBe(seq + 1);
  });

  it('refuses illegal moves without changing anything', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    const active = room.active(a, b);
    const before = JSON.stringify(room.record.game);
    room.send(active, { type: 'action', action: { type: 'play', uid: 999_999 } });
    expect(active.last('error')?.code).toBe('cardNotInHand');
    expect(JSON.stringify(room.record.game)).toBe(before);
  });

  it('refuses actions from sockets without a seat', () => {
    const room = makeRoom();
    room.start();
    const watcher = room.connect();
    room.send(watcher, { type: 'action', action: { type: 'concede' } });
    expect(watcher.last('error')?.code).toBe('notSeated');
  });

  it('times out the turn with the clock and restarts it for the next one', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    const first = room.record.game!.active;
    expect(room.core.nextWake()).toBe(room.host.time + TURN_MS);

    room.advance(TURN_MS - 1);
    expect(room.record.game!.active).toBe(first);
    room.advance(1);
    expect(room.record.game!.active).not.toBe(first);
    const { events, deadline } = a.last('state')!;
    expect(events.some((e) => e.type === 'timedOut' && e.player === first)).toBe(true);
    expect(deadline).toBe(room.host.time + TURN_MS);
    expect(b.last('state')!.deadline).toBe(deadline);
    expect(room.record.seats[first]!.timeouts).toBe(1);
  });

  it('forfeits a player who lets the clock run out three turns in a row', () => {
    const room = makeRoom();
    const { a } = room.start();
    const sleeper = room.record.game!.active;
    for (let i = 0; i < 2 * DEFAULT_TIMINGS.afkTimeouts - 1; i++) room.advance(TURN_MS);
    expect(room.record.status).toBe('finished');
    expect(room.record.ending).toEqual({
      winner: sleeper === 0 ? 1 : 0,
      reason: 'concede',
      forfeit: { seat: sleeper, cause: 'inactive' },
    });
    expect(a.last('room')!.room.ending?.forfeit?.cause).toBe('inactive');
  });

  it('resets the inactivity count when the player moves', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    const player = room.record.game!.active;
    room.advance(TURN_MS); // player times out
    room.advance(TURN_MS); // opponent times out
    expect(room.record.seats[player]!.timeouts).toBe(1);
    room.move(a, b);
    expect(room.record.seats[player]!.timeouts).toBe(0);
  });

  it('records a concession and the score', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    room.send(a, { type: 'action', action: { type: 'concede' } });
    expect(room.record.status).toBe('finished');
    expect(room.record.ending).toEqual({ winner: 1, reason: 'concede', forfeit: { seat: 0, cause: 'conceded' } });
    expect(room.record.score).toEqual([0, 1]);
    expect(b.last('state')!.view.result).toEqual({ winner: 1, reason: 'concede' });
    expect(room.core.nextWake()).toBe(room.host.time + ROOM_LIMITS.finishedTtlMs);
    expect(room.core.lobbyUpdate().summary.status).toBe('finished');
  });
});

describe('reconnection', () => {
  it('keeps the seat while the player is away and gives it back with the token', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    const token = a.last('welcome')!.token;
    room.drop(a);
    const away = b.last('room')!.room.seats[0]!;
    expect(away.connected).toBe(false);
    expect(away.reconnectBy).toBe(room.host.time + DEFAULT_TIMINGS.reconnectMs);

    room.host.time += 10_000;
    const again = room.connect();
    room.send(again, { type: 'resume', v: PROTOCOL_VERSION, token });
    expect(again.last('welcome')!.seat).toBe(0);
    const state = again.last('state')!;
    expect(state.resumed).toBe(true);
    expect(state.events).toEqual([]);
    expect(state.view.viewer).toBe(0);
    expect(b.last('room')!.room.seats[0]).toMatchObject({ connected: true, reconnectBy: null });
    expect(room.record.seats[0]!.reconnectBy).toBeNull();
  });

  it('never runs out a turn when the room has no time limit', () => {
    const room = makeRoom({ timings: { turnSeconds: 0 } });
    const { a } = room.start();
    expect(a.last('state')!.deadline).toBeNull();
    const turn = room.record.game!.turn;
    room.advance(TURN_MS * 20);
    expect(room.record.status).toBe('playing');
    expect(room.record.game!.turn).toBe(turn);
    expect(room.record.clock).toBeNull();
  });

  it('forfeits a player who does not come back in time', () => {
    const room = makeRoom({ timings: { turnSeconds: 600 } });
    const { a, b } = room.start();
    room.drop(b);
    room.advance(DEFAULT_TIMINGS.reconnectMs - 1);
    expect(room.record.status).toBe('playing');
    room.advance(1);
    expect(room.record.status).toBe('finished');
    expect(room.record.ending?.forfeit).toEqual({ seat: 1, cause: 'disconnected' });
    expect(a.last('state')!.view.result?.winner).toBe(0);
    // Gone for good: no rematch.
    room.send(a, { type: 'rematch' });
    expect(a.last('error')?.code).toBe('rematchUnavailable');
  });

  it('moves the seat to the newest connection and closes the old one', () => {
    const room = makeRoom();
    const { a } = room.start();
    const token = a.last('welcome')!.token;
    const tab = room.connect();
    room.send(tab, { type: 'resume', v: PROTOCOL_VERSION, token });
    expect(a.closedWith?.code).toBe(CLOSE_CODES.replaced);
    expect(a.seat).toBeNull();
    expect(tab.seat).toBe(0);
    // The replaced socket closing does not open a reconnection window.
    room.core.disconnected(a);
    expect(room.record.seats[0]!.reconnectBy).toBeNull();
  });

  it('answers an unknown token with badToken and keeps the socket open', () => {
    const room = makeRoom();
    room.start();
    const socket = room.connect();
    room.send(socket, { type: 'resume', v: PROTOCOL_VERSION, token: 'x'.repeat(32) });
    expect(socket.last('error')?.code).toBe('badToken');
    expect(socket.open).toBe(true);
  });

  it('frees the seat of a host who drops while waiting and closes the empty room', () => {
    const room = makeRoom();
    const a = room.connect();
    room.join(a, 'Ana');
    room.drop(a);
    expect(room.core.lobbyUpdate().open).toBe(false);
    room.advance(DEFAULT_TIMINGS.waitingReconnectMs);
    expect(room.core.closed).toBe(true);
  });

  it('gives a host who dropped while waiting the full window if the game starts', () => {
    const room = makeRoom();
    const a = room.connect();
    room.join(a, 'Ana');
    room.drop(a);
    const b = room.connect();
    room.join(b, 'Bea');
    expect(room.record.status).toBe('playing');
    expect(room.record.seats[0]!.reconnectBy).toBe(room.host.time + DEFAULT_TIMINGS.reconnectMs);
  });

  it('sends a full snapshot on sync', () => {
    const room = makeRoom();
    const { a } = room.start();
    a.clear();
    room.send(a, { type: 'sync' });
    expect(a.received.map((m) => m.type)).toEqual(['room', 'state']);
    expect(a.last('state')!.resumed).toBe(true);
  });
});

describe('leaving and rematch', () => {
  it('closes the room when the only player leaves while waiting', () => {
    const room = makeRoom();
    const a = room.connect();
    const watcher = room.connect();
    room.join(a, 'Ana');
    room.send(a, { type: 'leave' });
    expect(room.core.closed).toBe(true);
    expect(watcher.closedWith?.code).toBe(CLOSE_CODES.roomClosed);
    expect(room.core.nextWake()).toBeNull();
  });

  it('concedes for a player who leaves during the game', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    room.send(b, { type: 'leave' });
    expect(room.record.ending).toEqual({ winner: 0, reason: 'concede', forfeit: { seat: 1, cause: 'left' } });
    expect(a.last('room')!.room.seats[1]!.left).toBe(true);
    room.send(a, { type: 'rematch' });
    expect(a.last('error')?.code).toBe('rematchUnavailable');
  });

  it('starts a rematch when both ask, with new heroes and the loser first', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    room.send(b, { type: 'action', action: { type: 'concede' } });
    room.send(a, { type: 'rematch', hero: 'hechicera' });
    expect(b.last('room')!.room.seats[0]!.rematch).toBe(true);
    expect(room.record.status).toBe('finished');
    room.send(b, { type: 'rematch' });
    expect(room.record.status).toBe('playing');
    expect(room.record.games).toBe(2);
    expect(room.record.score).toEqual([1, 0]);
    expect(room.record.seats[0]!.hero).toBe('hechicera');
    expect(room.record.seats[1]!.hero).toBe('mariscal');
    expect(room.record.game!.active).toBe(1);
    expect(a.last('state')!.events[0]).toMatchObject({ type: 'gameStarted', firstPlayer: 1 });
    expect(room.record.ending).toBeNull();
  });

  it('refuses a rematch while the game is running', () => {
    const room = makeRoom();
    const { a } = room.start();
    room.send(a, { type: 'rematch' });
    expect(a.last('error')?.code).toBe('rematchUnavailable');
  });

  it('closes a finished room once both players have left, or after a while', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    room.send(a, { type: 'action', action: { type: 'concede' } });
    room.send(a, { type: 'leave' });
    expect(room.core.closed).toBe(false);
    room.send(b, { type: 'leave' });
    expect(room.core.closed).toBe(true);

    const other = makeRoom();
    const pair = other.start();
    other.send(pair.a, { type: 'action', action: { type: 'concede' } });
    other.advance(ROOM_LIMITS.finishedTtlMs);
    expect(other.core.closed).toBe(true);
    expect(pair.b.closedWith?.code).toBe(CLOSE_CODES.roomClosed);
  });

  it('closes a room nobody ever joined', () => {
    const room = makeRoom();
    expect(room.core.nextWake()).toBe(room.host.time + ROOM_LIMITS.emptyRoomMs);
    room.advance(ROOM_LIMITS.emptyRoomMs);
    expect(room.core.closed).toBe(true);
  });

  it('closes a room whose host waited too long', () => {
    const room = makeRoom();
    const a = room.connect();
    room.join(a, 'Ana');
    room.advance(ROOM_LIMITS.waitingTtlMs);
    expect(room.core.closed).toBe(true);
    expect(a.closedWith?.code).toBe(CLOSE_CODES.roomClosed);
  });
});

describe('emotes and abuse', () => {
  it('broadcasts emotes with a cooldown', () => {
    const room = makeRoom();
    const { a, b } = room.start();
    room.send(a, { type: 'emote', emote: 'wellPlayed' });
    expect(b.last('emote')).toEqual({ type: 'emote', seat: 0, emote: 'wellPlayed' });
    room.send(a, { type: 'emote', emote: 'wow' });
    expect(a.last('error')?.code).toBe('rateLimited');
    room.host.time += ROOM_LIMITS.emoteCooldownMs;
    room.send(a, { type: 'emote', emote: 'wow' });
    expect(b.last('emote')?.emote).toBe('wow');
  });

  it('rejects malformed messages', () => {
    const room = makeRoom();
    const socket = room.connect();
    room.core.receive(socket, 'not json');
    room.send(socket, { type: 'emote', emote: 'free text' });
    room.send(socket, { type: 'join', v: PROTOCOL_VERSION, nickname: 'Ana', hero: 'nobody' });
    expect(socket.all('error').map((e) => e.code)).toEqual(['badMessage', 'badMessage', 'badMessage']);
  });

  it('throttles floods and closes sockets that keep misbehaving', () => {
    const room = makeRoom();
    const socket = room.connect();
    for (let i = 0; i < ROOM_LIMITS.messageBurst; i++) room.send(socket, { type: 'sync' });
    expect(socket.all('error')).toEqual([]);
    room.send(socket, { type: 'sync' });
    expect(socket.last('error')?.code).toBe('rateLimited');
    room.host.time += 1000;
    room.send(socket, { type: 'sync' });
    expect(socket.all('error')).toHaveLength(1);
    for (let i = 0; i < ROOM_LIMITS.maxStrikes + 5; i++) room.core.receive(socket, '{');
    expect(socket.closedWith?.code).toBe(CLOSE_CODES.abuse);
  });
});

describe('a whole game', () => {
  it('plays to the end with legal moves and keeps both views consistent', () => {
    const room = makeRoom();
    const { a, b } = room.start(['random', 'random']);
    for (let i = 0; i < 2000 && room.record.status === 'playing'; i++) {
      room.move(a, b);
      room.host.time += 500;
      const views = [a.last('state')!.view, b.last('state')!.view];
      expect(views[0]!.seq).toBe(views[1]!.seq);
      expect(views[0]!.players[0].keep).toBe(views[1]!.players[0].keep);
    }
    expect(room.record.status).toBe('finished');
    expect(room.record.ending?.forfeit).toBeNull();
    expect(a.last('state')!.view.result).toEqual(room.record.game!.result);
  });
});
