/**
 * End-to-end smoke test against a running server: two bots meet through
 * quick join, play a whole game with random legal moves through the SDK and
 * check the lobby on the way.
 *
 *   pnpm dev            (in another terminal)
 *   pnpm smoke          (or: pnpm smoke http://localhost:8787)
 */
import { HEROES } from '@cardcraft-castles/engine';
import { OnlineClient, type RoomConnection } from '@cardcraft-castles/protocol/client';

const base = process.argv[2] ?? 'http://localhost:8787';
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

const bots = [0, 1].map(() => new OnlineClient({ baseUrl: base, storage: null }));
const health = await bots[0]!.health();
console.log(`Server: ${health.game}, protocol ${health.protocol}, ${health.cards} cards`);

const lobby = bots[0]!.connectLobby();
lobby.on('stats', (stats) => console.log(`Lobby: ${stats.online} online, ${stats.waiting} waiting, ${stats.playing} playing`));

const first = await bots[0]!.quickJoin({ nickname: 'bot-0' });
console.log(`bot-0 ${first.created ? 'created' : 'found'} room ${first.room.id}`);
const rooms: RoomConnection[] = [bots[0]!.joinRoom(first.room.id, { nickname: 'bot-0', hero: 'random' })];
await new Promise((resolve) => rooms[0]!.on('welcome', resolve));

const second = await bots[1]!.quickJoin({ nickname: 'bot-1' });
console.log(`bot-1 ${second.created ? 'created' : 'found'} room ${second.room.id}`);
rooms.push(bots[1]!.joinRoom(second.room.id, { nickname: 'bot-1', hero: pick(HEROES).id }));

let states = 0;
const summary = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('The game did not finish in 120 s')), 120_000);
  rooms.forEach((room, bot) => {
    room.on('error', (error) => console.warn(`bot-${bot}: ${error.code} ${error.message}`));
    room.on('closed', ({ reason }) => reject(new Error(`bot-${bot} closed: ${reason}`)));
    room.on('state', ({ view }) => {
      states += 1;
      if (view.result) {
        clearTimeout(timer);
        if (bot === 0) {
          const seats = room.room?.seats;
          const name = view.result.winner === null ? 'nobody' : seats?.[view.result.winner]?.nickname;
          resolve(`${name} wins by ${view.result.reason} on turn ${view.turn}`);
        }
        return;
      }
      const legal = room.legalActions();
      if (legal.length === 0) return;
      const plays = legal.filter((a) => a.type !== 'discard');
      // A short pause, like a (very fast) human; the server throttles floods.
      setTimeout(() => room.act(pick(plays.length > 0 ? plays : legal)), 150);
    });
  });
});

console.log(`Game over: ${summary} (${states} state messages)`);
for (const room of rooms) room.leave();
lobby.close();
