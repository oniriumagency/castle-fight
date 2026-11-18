# Cliente web

Vite + TypeScript + PixiJS 8. Sin framework de interfaz: las pantallas son DOM con CSS y el campo de batalla es un lienzo de Pixi detrás de ellas.

```sh
pnpm dev:client     # http://localhost:5173 (con pnpm dev:server para jugar en línea)
pnpm --filter @cardcraft-castles/client build
```

`dev` y `build` ejecutan antes `scripts/build-art.mjs`, que convierte las ilustraciones de `art/` (JPG 1200×896) a WebP de 720 px en `public/art/` (ignorado por git). Solo reconvierte las que han cambiado.

## Capas

| Capa | Qué contiene |
| --- | --- |
| `#stage` | Lienzo de Pixi: cielo, nubes, montañas, los dos castillos, clima y partículas (`src/scene`). |
| `#screen` | La pantalla actual (menú, lobby, héroes, tablero), con fundido entre pantallas (`src/app/router.ts`). |
| `#overlay` | Ventanas modales y avisos. |

## Estructura de `src`

| Carpeta | Qué es |
| --- | --- |
| `app/` | Arranque, textos es/en (`i18n.ts`), ajustes guardados en el navegador, utilidades DOM y enrutador. |
| `ui/` | Cartas dibujadas en CSS según el marco aprobado (`card.ts`, `styles/card.css`), iconos y emblemas, colores por héroe y cielos por evento. |
| `scene/` | Campo de batalla en Pixi: castillos que crecen y se rompen, texturas procedurales, interpolaciones. |
| `game/` | Sesiones de partida: `LocalSession` (IA o dos jugadores en el mismo dispositivo), estadísticas y textos del registro. `ai.ts` es un sustituto hasta que llegue el paquete de IA. |
| `net/` | `OnlineSession`, que adapta el SDK de `@cardcraft-castles/protocol/client` a la misma interfaz que las partidas locales. |
| `screens/` | Menú, lobby, sala de espera, selección de héroe, ajustes, cómo se juega, y el tablero (`board/`). |
| `fx/` | Ganchos de efectos y sonido (ver abajo). |

El tablero no sabe de dónde viene la partida: recibe de la sesión una vista (`getPlayerView`) y la lista de eventos (`redactEvents`), anima los eventos uno a uno y al final se ajusta a la vista. Las cifras (Torreón para ganar, Torreón y Muralla iniciales) salen siempre de `view.rules`.

## Ganchos para efectos, sonido y música

- `src/fx/director.ts`: un método por momento del juego (`damage`, `built`, `structureLost`, `status`, `ultimate`, `battleEvent`, `gameOver`…). El tablero los llama al animar cada evento; ahí se pueden añadir o cambiar partículas, destellos y sacudidas sin tocar el tablero.
- `src/fx/audio.ts`: `audio.play(cue)` con una lista cerrada de señales (`cardPlay`, `hit`, `hitBig`, `build`, `ultimateReady`, `yourTurn`, `victory`…). Ahora suenan sonidos sintetizados de prueba; para poner sonidos reales basta con cargar archivos por señal. `audio.music(track)` y `audio.setTension(0..1)` ya se llaman en cada pantalla y según lo cerca que esté el final, pero aún no suenan.
- Volúmenes, velocidad de animación, sacudida de pantalla y movimiento reducido salen de `app/settings.ts`.

## Controles

Tocar o hacer clic en una carta la muestra en grande con Jugar y Descartar. En ordenador también se puede arrastrar hacia arriba para jugar o al montón de descartes, hacer doble clic, o usar teclas: 1 a 6 eligen carta, Intro juega, Supr descarta, U usa la definitiva y Esc cierra.
