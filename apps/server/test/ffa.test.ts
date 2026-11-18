import { describe, expect, it } from 'vitest';
import { legalActions } from '@cardcraft-castles/engine';
import { makeRoom } from './helpers';
import type { FakeSocket } from './helpers';

/** Three players seated in a free-for-all room. */
function startThree() {
  const room = makeRoom({ size: 3 });
  const sockets = ['Ana', 'Bea', 'Cai'].map((name) => {
    const socket = room.connect(name.toLowerCase());
    room.join(socket, name, 'random');
    return socket;
  });
  return { room, sockets };
}

function mover(room: ReturnType<typeof makeRoom>, sockets: FakeSocket[]): FakeSocket {
  const game = room.record.game!;
  const seat = game.pending?.player ?? game.active;
  return sockets.find((s) => s.seat === seat)!;
}

describe('free-for-all rooms', () => {
  it('waits for the third player and lists the room as 3 seats', () => {
    const room = makeRoom({ size: 3 });
    const a = room.connect();
    const b = room.connect();
    room.join(a, 'Ana');
    room.join(b, 'Bea');
    expect(room.record.status).toBe('waiting');
    expect(room.core.lobbyUpdate()).toMatchObject({ open: true, summary: { players: 2, size: 3 } });
    expect(b.last('room')!.room.seats).toHaveLength(3);
  });

  it('starts a 3-player game when the room fills, each view hiding both rival hands', () => {
    const { room, sockets } = startThree();
    expect(room.record.status).toBe('playing');
    expect(room.record.game!.players).toHaveLength(3);
    expect(room.core.lobbyUpdate()).toMatchObject({ open: false, summary: { status: 'playing', players: 3 } });
    for (const socket of sockets) {
      const { view } = socket.last('state')!;
      expect(view.players).toHaveLength(3);
      view.players.forEach((p, i) => {
        expect(p.hand.every((c) => (c.cardId !== null) === (i === socket.seat))).toBe(true);
      });
    }
  });

  it('a player who leaves is knocked out and the other two play on', () => {
    const { room, sockets } = startThree();
    const quitter = sockets.find((s) => s.seat !== room.record.game!.active)!;
    room.send(quitter, { type: 'leave' });
    expect(room.record.status).toBe('playing');
    expect(room.record.game!.players[quitter.seat ?? 0]!.eliminated).toBe(true);
  });

  it('plays a whole game through the room, then needs all three for a rematch', () => {
    const { room, sockets } = startThree();
    for (let guard = 0; room.record.status === 'playing' && guard < 4000; guard++) {
      const socket = mover(room, sockets);
      const actions = legalActions(socket.last('state')!.view);
      const action = actions.find((x) => x.type === 'play') ?? actions[0]!;
      // Players think between moves (and stay under the per-socket rate limit).
      room.host.time += 1000;
      room.send(socket, { type: 'action', action });
    }
    expect(room.record.status).toBe('finished');
    const winner = room.record.ending!.winner;
    if (winner !== null) expect(room.record.score[winner]).toBe(1);

    room.send(sockets[0]!, { type: 'rematch' });
    room.send(sockets[1]!, { type: 'rematch' });
    expect(room.record.status).toBe('finished');
    room.send(sockets[2]!, { type: 'rematch' });
    expect(room.record.status).toBe('playing');
    expect(room.record.games).toBe(2);
  });
});
