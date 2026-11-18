# Cardcraft: Castles

Duelo de cartas 1 contra 1 por turnos, en HTML5 y con multijugador online. Cada jugador levanta su castillo y derriba el del rival: gana quien lleve su Torreón a 100 o deje el del rival en 0.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `design/cards.json` | Reglas base, 60 cartas, 6 héroes y 6 eventos, con textos en español e inglés. |
| `design/art-prompts.md` | Prompts de las 72 ilustraciones. |
| `art/` | Ilustraciones finales (`cards/`, `heroes/`, `events/`), con el nombre de archivo indicado en cada prompt. |
| `packages/engine` | Motor de reglas puro y determinista, sin dependencias. Lo usan el servidor, el cliente, la IA y las simulaciones. [Documentación](packages/engine/README.md). |
| `packages/ai` | IA rival con tres dificultades, que corre en el navegador sin servidor, y simulaciones de equilibrio IA contra IA. [Documentación](packages/ai/README.md). |
| `packages/protocol` | Mensajes entre cliente y servidor y el SDK de cliente tipado (`@cardcraft-castles/protocol/client`) con lobby, salas, reconexión y reloj. [Documentación](packages/protocol/README.md). |
| `apps/client` | Cliente web (Vite + PixiJS). Por ahora es un esqueleto que juega una partida local con el motor. |
| `apps/server` | Servidor autoritativo en Cloudflare Workers (plan gratuito): un Durable Object para el lobby en vivo y uno por sala, con reloj de turno, reconexión, revancha, partida rápida, salas privadas por enlace y límites contra abusos. [Documentación](apps/server/README.md). |

## Puesta en marcha

Hace falta Node 22 o posterior y pnpm 10.

```sh
pnpm install
pnpm test          # tests del motor (uno por carta, héroe y evento), de la IA y del servidor (unitarios y extremo a extremo)
pnpm typecheck
pnpm build         # compila el cliente y empaqueta el servidor
pnpm sim           # 1000 partidas aleatorias con un resumen de equilibrio
pnpm balance       # todos los héroes entre sí, jugados por la IA: héroes, cartas y duración
pnpm ladder        # cuánto gana cada nivel de la IA al anterior
```

Para desarrollar:

```sh
pnpm dev:server    # Worker local en http://localhost:8787
pnpm dev:client    # cliente en http://localhost:5173 (redirige /api al Worker)
pnpm --filter @cardcraft-castles/server smoke   # dos bots se emparejan y juegan una partida contra el Worker local
```

## Cómo encajan las piezas

El cliente nunca decide el resultado de una jugada. Envía la intención (`play`, `discard`, `ultimate`, `choose`), el servidor la aplica con `applyAction` del motor y devuelve a cada jugador su propia vista (`getPlayerView`) junto con la lista de lo que ha pasado (`redactEvents`) para animarlo. La mano y el mazo de cada jugador solo viajan a su dueño. La interfaz habla con el servidor a través del SDK de `@cardcraft-castles/protocol/client`, que se encarga de reconectar y recuperar el asiento.

Las cartas se definen en dos sitios: nombre, texto, coste, escuela y rareza en `design/cards.json`, y la mecánica en `packages/engine/src/data/cardEffects.ts`, con el mismo id. El motor no arranca si falta alguna en cualquiera de los dos lados, y los tests fallan si una carta no tiene su test.

La integración continua (GitHub Actions) comprueba tipos, pasa los tests, compila y ejecuta una simulación en cada pull request.
