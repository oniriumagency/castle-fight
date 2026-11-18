/**
 * End-to-end smoke test of the server shell: creates a room, connects two
 * bots over WebSocket and plays a whole game with random legal moves.
 *
 *   pnpm dev            (in another terminal)
 *   pnpm smoke          (or: pnpm smoke http://localhost:8787)
 */
import { HEROES, legalActions } from '@cardcraft-castles/engine';
import { ROUTES, type RoomClientMessage, type RoomServerMessage, type RoomSummary } from '@cardcraft-castles/protocol';

const base = process.argv[2] ?? 'http://localhost:8787';
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

const health = (await (await fetch(base + ROUTES.health)).json()) as { game: string; cards: number };
console.log(`Server: ${health.game}, ${health.cards} cards`);

const created = (await (
  await fetch(base + ROUTES.rooms, { method: 'POST', body: JSON.stringify({ name: 'Smoke test', host: 'bot-0' }) })
).json()) as { room: RoomSummary };
console.log(`Room ${created.room.id} created`);

let stateMessages = 0;
const winner = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('The game did not finish in 60 s')), 60_000);
  for (const bot of [0, 1]) {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + ROUTES.roomSocket(created.room.id));
    const send = (message: RoomClientMessage): void => ws.send(JSON.stringify(message));
    ws.addEventListener('open', () => send({ type: 'join', nickname: `bot-${bot}`, hero: pick(HEROES).id }));
    ws.addEventListener('error', () => reject(new Error(`bot-${bot}: socket error`)));
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as RoomServerMessage;
      if (message.type === 'error') return reject(new Error(`bot-${bot}: ${message.code} ${message.message}`));
      if (message.type !== 'state') return;
      stateMessages += 1;
      const { view } = message;
      if (view.result) {
        clearTimeout(timer);
        ws.close();
        if (bot === 0) {
          const name = view.result.winner === null ? 'nobody' : message.seats[view.result.winner].nickname;
          resolve(`${name} wins by ${view.result.reason} on turn ${view.turn}`);
        }
        return;
      }
      const legal = legalActions(view);
      if (legal.length === 0) return;
      const plays = legal.filter((a) => a.type !== 'discard');
      const action = pick(plays.length > 0 ? plays : legal);
      if (action.type !== 'timeout') send({ type: 'action', action });
    });
  }
});

console.log(`Game over: ${winner} (${stateMessages} state messages)`);
const rooms = (await (await fetch(base + ROUTES.rooms)).json()) as { rooms: RoomSummary[] };
console.log(`Open rooms after the game: ${rooms.rooms.length}`);
