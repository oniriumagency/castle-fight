# @cardcraft-castles/server

Servidor online de Cardcraft: Castles. Es un Worker de Cloudflare con dos tipos de Durable Object y cabe en el plan gratuito.

- **`Lobby`** (uno solo): la lista de salas públicas, que empuja en vivo a todos los clientes conectados, la creación de salas, la partida rápida y los límites por IP.
- **`Room`** (uno por sala): la partida. Aplica cada jugada con el motor, envía a cada jugador solo su vista, lleva el reloj de turno, guarda los asientos para reconectar y organiza la revancha.

El cliente no habla el protocolo a mano: usa el SDK de [`@cardcraft-castles/protocol/client`](../../packages/protocol/README.md).

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `GET /api/health` | Estado, versión del protocolo y número de cartas. |
| `GET /api/rooms` | Salas públicas listadas (esperando rival o en juego). |
| `POST /api/rooms` | Crea una sala: `{ nickname, name?, private?, turnSeconds?, size?, twilight?, clientId? }`. `twilight: false` quita la Furia del Ocaso; si no se envía, está activa. |
| `GET /api/rooms/:id` | Una sala, pública o privada. Es lo que usa la página de invitación. |
| `POST /api/quick-join` | Devuelve la sala que más lleva esperando rival, o crea una: `{ nickname, clientId? }`. |
| `WS /api/lobby` | Lista en vivo: una instantánea al conectar y después solo los cambios. |
| `WS /api/rooms/:id/ws` | La sala. Mensajes en `packages/protocol/src/index.ts`. |

Los errores HTTP siempre tienen la forma `{ error: { code, message, retryAfterMs? } }`.

## Cómo funciona una sala

1. **Espera.** Alguien crea la sala y se sienta (`join` con apodo y héroe, o `'random'`). La sala aparece en el lobby mientras ese jugador siga conectado.
2. **Partida.** Al sentarse el segundo jugador empieza la partida con una semilla impredecible. Cada jugada pasa por `applyAction`; el servidor usa el asiento del socket, nunca el `player` que diga el cliente. Cada jugador recibe `getPlayerView` y `redactEvents` para su asiento: la mano y el mazo del rival nunca salen del servidor.
3. **Reloj.** Cada turno dura 30 s. Si se agota, el servidor juega `timeout` (el motor juega la carta más barata que el jugador pueda pagar, o descarta una al azar si no puede pagar ninguna). Tres tiempos agotados seguidos del mismo jugador cuentan como abandono. Si la sala tiene la Furia del Ocaso (por defecto), la partida se acelera desde el turno 21 y se decide como muy tarde al acabar el turno 35; el resumen de la sala la anuncia con `twilight`.
4. **Desconexión.** Si un jugador pierde la conexión conserva su asiento 60 s (20 s mientras espera rival). Vuelve con el token secreto que recibió en `welcome`; el SDK lo guarda en `localStorage`, así que también sirve recargar la página. Si se conecta desde otra pestaña, la conexión anterior se cierra con el código `4000`. Si no vuelve a tiempo, pierde la partida.
5. **Final.** `room.ending` explica cómo terminó (`forfeit.cause`: `conceded`, `left`, `disconnected` o `inactive`) y `room.score` suma las victorias de la sala. Si los dos piden revancha empieza otra partida y abre el que perdió.
6. **Cierre.** La sala se borra cuando se van los dos, 15 min después de la última partida, a los 30 min si nadie se une, o a los 2 min si nadie llega a sentarse.

Toda la lógica está en `src/roomCore.ts`, que no depende de Cloudflare y se prueba con sockets y reloj falsos. `src/room.ts` solo la conecta con el Durable Object: guarda el registro, programa la alarma y avisa al lobby.

## Límites contra abusos

| Límite | Valor |
| --- | --- |
| Salas creadas por IP | 6 por minuto |
| Salas públicas esperando rival por IP | 3 a la vez |
| Partidas rápidas por IP | 20 por minuto |
| Conexiones al lobby por IP | 16 |
| Mensajes por conexión de sala | ráfaga de 20, después 5 por segundo |
| Mensajes no válidos o excesivos | al pasar de 10 se cierra la conexión (`4008`) |
| Conexiones por sala | 6 |
| Emotes | uno cada 1,5 s por jugador; no hay chat libre |
| Tamaño | 4 KB por mensaje y 2 KB por petición HTTP |
| Apodos y nombres de sala | se limpian de caracteres invisibles y de control, acentos apilados y espacios, y se cortan a 20 y 32 caracteres |

Los contadores viven en memoria: si el objeto se descarga se reinician, que para frenar inundaciones basta.

## Plan gratuito de Cloudflare

- Solo usa Durable Objects con SQLite, los que incluye el plan gratuito.
- Usa la API de hibernación de WebSockets: entre jugada y jugada el objeto puede salir de memoria sin coste, y los `ping` del cliente los contesta el propio runtime sin despertarlo.
- Cada cambio de una sala es una sola escritura (todo el estado va en un registro). Una partida típica son unas 100 a 200 filas escritas contando la alarma del reloj, así que el límite diario de 100 000 da para cientos de partidas al día. El lobby escribe unas cuatro veces por partida y no usa alarmas para las estadísticas.
- El Worker empaquetado ocupa unos 113 KB (26 KB comprimido).

## Desarrollo y pruebas

```sh
pnpm dev                    # Worker local en http://localhost:8787
pnpm smoke                  # dos bots se emparejan con partida rápida y juegan una partida entera
pnpm test                   # unitarias + extremo a extremo (arrancan un Worker local con workerd)
```

Variables opcionales, pensadas para desarrollo y pruebas (en producción no se definen):

| Variable | Efecto |
| --- | --- |
| `TURN_SECONDS` | Segundos por turno (30). |
| `RECONNECT_SECONDS` | Segundos para volver tras una desconexión (60). |
| `RATE_LIMITS=off` | Desactiva los límites por IP al crear salas (las pruebas lo usan porque todo sale de la misma IP). |

Se pueden poner en `.dev.vars` para `pnpm dev`.

## Despliegue

`wrangler.jsonc` tiene dos niveles. El superior es lo que ejecutan `pnpm dev` y los tests: solo la API. `env.production` es el juego publicado: el mismo Worker, con el cliente compilado (`../client/dist`) como archivos estáticos y el dominio propio. `/api/*` va siempre al Worker (`run_worker_first`) y cualquier otra ruta que no sea un archivo devuelve `index.html`. Así el enlace de invitación y la API comparten origen y el SDK no necesita configuración.

```sh
pnpm --filter @cardcraft-castles/client build
pnpm --filter @cardcraft-castles/server run deploy   # wrangler deploy --env production
pnpm --filter @cardcraft-castles/server smoke https://games.onirium.agency --private
```

Con `--private` los bots de `smoke` se encuentran en una sala privada en vez de usar la partida rápida, para no sentarse en la sala de un jugador real.

Los entornos de Wrangler no heredan los Durable Objects: una clase nueva hay que declararla en los dos niveles (la migración solo en el superior).

Lo normal es no publicar a mano: GitHub Actions lo hace en cada push a `main`. Los secretos que necesita están en el [README principal](../../README.md#despliegue).
