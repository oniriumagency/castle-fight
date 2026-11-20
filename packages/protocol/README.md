# @cardcraft-castles/protocol

Tipos de los mensajes entre cliente y servidor (`src/index.ts`), validadores compartidos (`src/validate.ts`) y el SDK de cliente tipado (`src/client.ts`, importable como `@cardcraft-castles/protocol/client`). Funciona en navegadores y en Node 22 o posterior.

## SDK en cinco minutos

```ts
import { OnlineClient, roomIdFromUrl } from '@cardcraft-castles/protocol/client';
import { cleanNickname } from '@cardcraft-castles/protocol';

const online = new OnlineClient(); // mismo origen que la página; o { baseUrl: 'https://…' }

// Lobby en vivo
const lobby = online.connectLobby();
lobby.on('rooms', (rooms) => renderRooms(rooms)); // ya ordenadas: esperando primero, más nuevas primero
lobby.on('stats', ({ online, waiting, playing }) => renderStats(online, waiting, playing));
lobby.on('status', (status) => showBanner(status)); // 'connecting' | 'open' | 'reconnecting' | 'closed'

// Entrar en una sala
const nickname = cleanNickname(input.value) ?? 'Anónimo';
const invited = roomIdFromUrl(location.href); // enlace ?room=abcd2345
const { room } = invited
  ? { room: (await online.getRoom(invited))! } // null si ya no existe
  : await online.quickJoin({ nickname }); // o online.createRoom({ nickname, private: true })

const game = online.joinRoom(room.id, { nickname, hero: 'random' });
game.on('welcome', ({ seat }) => (mySeat = seat));
game.on('room', (info) => renderSeats(info)); // apodos, héroes, conexión, revancha, marcador, final
game.on('state', ({ view, events, resumed }) => (resumed ? draw(view) : animate(events, view)));
game.on('emote', ({ seat, emote, mine }) => showEmote(seat, emote));
game.on('error', ({ code }) => toast(code)); // jugada ilegal, demasiados emotes... la conexión sigue
game.on('closed', ({ reason }) => backToLobby(reason)); // replaced, roomFull, roomNotFound, roomClosed, outdated, left...

// Jugar
game.play(uid);
game.discard(uid);
game.ultimate();
game.choose(option);
game.concede();
game.emote('wellPlayed');
game.rematch('hechicera'); // o sin héroe para repetir
game.leave(); // se va del todo: libera el asiento o abandona la partida

// Reloj y ayudas
game.timeLeft(); // ms que quedan del turno, corregidos por el desfase de reloj con el servidor
game.isMyTurn();
game.legalActions(); // lo que puedes hacer ahora
online.inviteUrl(room.id); // https://tu-juego/?room=abcd2345
```

Todos los emisores tienen también `once(tipo, filtro?)`, que devuelve una promesa con el siguiente evento.

## Observadores

Si la sala está llena (`joinRoom` acaba con `roomFull`), se puede ver la partida sin asiento:

```ts
const watch = online.spectateRoom(room.id);
watch.on('watching', ({ room }) => renderSeats(room));
watch.on('state', ({ view, resumed }) => (resumed ? draw(view) : animate(view))); // view.spectator === true
```

El servidor manda a los observadores una vista sin ninguna mano visible (solo las reveladas por una carta), sin las opciones de las elecciones de nadie y con `viewer: 0`. No pueden jugar, enviar emotes ni pedir revancha. Caben `MAX_SPECTATORS` (8) por sala; `room.spectators` dice cuántos hay.

## Reconexión

Las conexiones se reintentan solas con espera creciente (de 0,4 s a 10 s) y comprueban cada 20 s que siguen vivas. Al volver, la sala recupera el asiento con el token que el servidor dio en `welcome`, guardado en `localStorage`. Recargar la página y llamar otra vez a `joinRoom` con el mismo id también recupera el asiento (`online.hasSeat(id)` dice si lo hay). Tras recuperar, llega un `state` con `resumed: true` y sin eventos: hay que pintar la vista directamente.

El servidor guarda el asiento 60 s (20 s si aún se espera rival). Si se acaba el plazo, el jugador pierde la partida y `room.ending.forfeit.cause` es `'disconnected'`.

## Lo que hay en `room` (`RoomInfo`)

- `status`: `'waiting' | 'playing' | 'finished' | 'closed'`.
- `seats[i]`: `{ nickname, hero, connected, reconnectBy, left, rematch }` o `null`. `reconnectBy` es la hora (ms) a la que pierde si no vuelve, útil para una cuenta atrás.
- `score`: victorias de cada asiento en esta sala; `games`: partidas jugadas.
- `ending`: cómo acabó la última partida, con `forfeit: { seat, cause }` si fue por abandono (`conceded`, `left`, `disconnected`, `inactive`).
- `timings`: segundos por turno, plazo de reconexión y cuántos tiempos agotados seguidos hacen perder.

## Protocolo

Si se habla sin el SDK: primer mensaje `join` (`{ type, v: PROTOCOL_VERSION, nickname, hero }`) o `resume` (`{ type, v, token }`); después `action`, `rematch`, `emote`, `leave` y `sync`. Los códigos de cierre `4000` a `4029` (`CLOSE_CODES`) son definitivos y no se debe reintentar. El texto `"ping"` recibe `"pong"`.
