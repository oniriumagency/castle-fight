# Cardcraft: Castles

Duelo de cartas 1 contra 1 por turnos, en HTML5 y con multijugador online. Cada jugador levanta su castillo y derriba el del rival: gana quien lleve su Torreón a 100 o deje el del rival en 0.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `design/cards.json` | Reglas base, 71 cartas, 6 héroes y 6 eventos, con textos en español e inglés. |
| `design/art-prompts.md` | Prompts de las 83 ilustraciones. |
| `art/` | Ilustraciones finales (`cards/`, `heroes/`, `events/`, `castles/`), con el nombre de archivo indicado en cada prompt. |
| `packages/engine` | Motor de reglas puro y determinista, sin dependencias. Lo usan el servidor, el cliente, la IA y las simulaciones. [Documentación](packages/engine/README.md). |
| `packages/ai` | IA rival con tres dificultades, que corre en el navegador sin servidor, y simulaciones de equilibrio IA contra IA. [Documentación](packages/ai/README.md). |
| `packages/campaign` | Modo Campaña: mapa de reinos y territorios, progreso guardado, mazos rivales, dificultad y diálogos. [Documentación](packages/campaign/README.md). |
| `packages/protocol` | Mensajes entre cliente y servidor y el SDK de cliente tipado (`@cardcraft-castles/protocol/client`) con lobby, salas, reconexión y reloj. [Documentación](packages/protocol/README.md). |
| `apps/client` | Cliente web (Vite + PixiJS): menú, lobby online, selección de héroe, tablero animado y resultados, en escritorio y móvil, en español e inglés. Se juega contra la IA, a dos jugadores en el mismo dispositivo o en línea. [Documentación](apps/client/README.md). |
| `apps/library` | Portada de games.onirium.agency: la biblioteca de juegos de Onirium. Se genera desde `games.json` y junta la biblioteca y el juego en una sola carpeta para publicar. [Documentación](apps/library/README.md). |
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
pnpm dev:client    # cliente en http://localhost:5173/cardcraft-castles/ (redirige /api al Worker)
pnpm --filter @cardcraft-castles/server smoke   # dos bots se emparejan y juegan una partida contra el Worker local
```

## Despliegue

<https://games.onirium.agency> es la biblioteca de juegos de Onirium y el juego está en <https://games.onirium.agency/cardcraft-castles/>, en el plan gratuito de Cloudflare. Es un solo Worker (`cardcraft-castles`) que sirve como archivos estáticos la biblioteca y el cliente compilado (`apps/library/dist`) y atiende `/api/*` con el servidor, así que la página, la API y los WebSockets comparten origen.

Los enlaces de sala de antes de la biblioteca (`https://games.onirium.agency/?room=<id>`) siguen funcionando: el Worker los redirige a `/cardcraft-castles/?room=<id>`. Como el dominio no cambia, los jugadores conservan su apodo, ajustes, historial y asientos guardados.

Cada push a `main` lo publica el flujo [Deploy](.github/workflows/deploy.yml): comprueba tipos y tests, compila el cliente y la biblioteca, ejecuta `wrangler deploy --env production` y, al terminar, dos bots juegan una partida entera en una sala privada contra el servidor publicado. También se puede lanzar a mano desde la pestaña Actions.

Necesita dos secretos en el repositorio (Settings → Secrets and variables → Actions):

| Secreto | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token de API creado con la plantilla "Edit Cloudflare Workers", limitado a la cuenta y a la zona `onirium.agency`. |
| `CLOUDFLARE_ACCOUNT_ID` | El Account ID de la cuenta de Cloudflare. |

### Versión de pruebas (preview)

Para probar cambios grandes sin tocar el juego publicado, el flujo [Preview](.github/workflows/preview.yml) publica la rama en un Worker aparte, `cardcraft-castles-preview`, en su dirección de `workers.dev` (sale al final del registro del flujo y en su resumen). Tiene sus propias salas y sus propios reportes, y usa los mismos dos secretos. Se publica en cada push a las ramas que lista el flujo (y a `preview/**`), y nunca toca games.onirium.agency.

### Reportes y sugerencias de los jugadores

El botón de abajo a la izquierda (en todas las pantallas) abre un formulario para enviar errores, sugerencias o comentarios con hasta tres capturas. Junto al texto se guarda la versión del juego, la pantalla, el modo, los héroes, el turno y el navegador. Se guardan en un Durable Object (`Reports`, con SQLite) del mismo Worker, así que no hace falta crear nada más en Cloudflare; se conservan los 500 más recientes.

Se leen en <https://games.onirium.agency/reportes> con una clave. La clave es el secreto `REPORTS_KEY` del Worker: Cloudflare → Workers & Pages → `cardcraft-castles` → Settings → Variables and Secrets → Add, tipo *Secret*, nombre `REPORTS_KEY`. Los despliegues no la borran. Sin ella, la página avisa de que falta.

El dominio está en `apps/server/wrangler.jsonc` (`env.production.routes`). Es un dominio personalizado del Worker: Cloudflare crea el registro DNS y el certificado al publicar, y la zona tiene que estar en la misma cuenta. No hace falta ningún túnel.

Para publicar desde tu máquina, con Wrangler ya autenticado (`wrangler login`), usa `pnpm run deploy`. Sin el `run`, `pnpm deploy` es otra orden de pnpm.

## Cómo encajan las piezas

El cliente nunca decide el resultado de una jugada. Envía la intención (`play`, `discard`, `ultimate`, `choose`), el servidor la aplica con `applyAction` del motor y devuelve a cada jugador su propia vista (`getPlayerView`) junto con la lista de lo que ha pasado (`redactEvents`) para animarlo. La mano y el mazo de cada jugador solo viajan a su dueño. La interfaz habla con el servidor a través del SDK de `@cardcraft-castles/protocol/client`, que se encarga de reconectar y recuperar el asiento.

Las cartas se definen en dos sitios: nombre, texto, coste, escuela y rareza en `design/cards.json`, y la mecánica en `packages/engine/src/data/cardEffects.ts`, con el mismo id. El motor no arranca si falta alguna en cualquiera de los dos lados, y los tests fallan si una carta no tiene su test.

La integración continua (GitHub Actions) comprueba tipos, pasa los tests, compila y ejecuta una simulación en cada pull request.
