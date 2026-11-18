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
| `scene/` | Campo de batalla en Pixi: castillos que crecen y se rompen, texturas procedurales, interpolaciones. Cada héroe tiene su propio castillo (`castleStyles.ts`: piedra, tejados, almenas, torres de fondo y un detalle animado); `castle.ts` lo dibuja. La torre del frente mide exactamente el Torreón y la muralla del lado del rival la Muralla; las torres de atrás siguen al Torreón sin superarlo. |
| `game/` | Sesiones de partida: `LocalSession` (IA o dos jugadores en el mismo dispositivo), estadísticas y textos del registro. `ai.ts` es un sustituto hasta que llegue el paquete de IA. |
| `net/` | `OnlineSession`, que adapta el SDK de `@cardcraft-castles/protocol/client` a la misma interfaz que las partidas locales. |
| `screens/` | Menú, lobby, sala de espera, selección de héroe, ajustes, cómo se juega, y el tablero (`board/`). |
| `fx/` | Sonido, música y director de efectos (ver abajo). |

El tablero no sabe de dónde viene la partida: recibe de la sesión una vista (`getPlayerView`) y la lista de eventos (`redactEvents`), anima los eventos uno a uno y al final se ajusta a la vista. Las cifras (Torreón para ganar, Torreón y Muralla iniciales) salen siempre de `view.rules`.

## Sonido, música y efectos visuales

Los efectos de sonido y visuales son originales y se generan en el navegador: no hay archivos de sonido ni sprites de efectos de terceros. La música son tres pistas elegidas por el equipo, en `public/music/`.

**Sonido** (`src/fx/sound/`)

- `synth.ts`: un sintetizador pequeño (osciladores, ruido blanco, rosa y marrón, FM, filtros y envolventes) que funciona en contextos de audio en vivo y sin conexión, y la respuesta al impulso de la reverb de sala.
- `sfx.ts`: más de 60 efectos, cada uno una receta: botones, cartas, un sonido por escuela (Construcción, Asalto, Arcano), uno por rareza, construir, lanzar, impactos según el daño, perforante, escudo, quemadura, escarcha, encantamientos, definitivas con un sello distinto por héroe, un sonido por evento de batalla, reloj de turno, victoria y derrota. Cada receta se renderiza una vez a un búfer (`OfflineAudioContext`) la primera vez que hace falta, se normaliza a su nivel y luego solo se reproduce, con una pequeña variación de tono en cada golpe.
- `music.ts`: la banda sonora. *Celtic Morning* suena en el menú y en la victoria, *Diversity* durante la partida (sube un poco de volumen cuando el final está cerca) y *To the Fallen* en la derrota. Son MP3 de unos 95 kbps (6,6 MB en total) que se reproducen en streaming con dos elementos `<audio>` conectados al bus de música, así que no se descodifican enteros en memoria, funcionan los volúmenes y la atenuación, y cambiar de pista hace un fundido cruzado. Para cambiar una pista basta con sustituir el MP3 y, si hace falta, ajustar su nivel en `TRACKS`.
- `src/fx/audio.ts`: la API (`audio.play(cue, intensidad, { pan })`, `audio.music(track)`, `audio.setTension(0..1)`, `audio.duck()`), buses de efectos y música, reverb y limitador. Nada se crea hasta el primer toque o tecla; después se preparan los efectos más usados en momentos libres, sin bloquear fotogramas. La música y los sonidos siguen sonando si cambias de pestaña o de ventana (en móvil el sistema puede pausarlos en segundo plano; al volver se reanudan). En móvil se mezcla con lo que esté sonando en lugar de pararlo.

**Efectos visuales**

- `src/fx/director.ts`: un método por momento del juego (`cardLanded`, `damage`, `built`, `status`, `ultimate`, `battleEvent`, `gameOver`…). Elige el proyectil según la carta (piedras de catapulta, flechas, cargas por el suelo, rayos, bolas de fuego, cometa), el impacto según el daño, y mantiene las auras de los castillos (llamas con Quemadura, hielo con Escarcha, humo cuando el Torreón está a punto de caer).
- `src/scene/battlefield.ts`: partículas recicladas con tope (chispas estiradas, humo, llamas, cristales, escombros), anillos de onda, destellos, rayos de luz, relámpagos, fuegos artificiales, retroceso y tinte de los castillos al recibir golpes y una sacudida suave por "trauma".
- Calidad de efectos (`src/app/quality.ts`): en `Auto` empieza en alta salvo en dispositivos modestos y baja sola si los fotogramas van lentos. En baja hay la mitad de partículas, sin rayos ni humo, y el lienzo usa menos resolución.
- Las cartas brillan según su rareza y al caer en la mesa dejan un destello del color de su escuela (`styles/card.css`, `.play-burst` en `styles/board.css`).

Ajustes: volumen general, música y efectos, silenciar todo (también con la tecla M o el botón del altavoz), calidad de efectos, sacudida de pantalla y movimiento reducido.

## Controles

Tocar o hacer clic en una carta la muestra en grande con Jugar y Descartar. En ordenador también se puede arrastrar hacia arriba para jugar o al montón de descartes, hacer doble clic, o usar teclas: 1 a 6 eligen carta, Intro juega, Supr descarta, U usa la definitiva y Esc cierra.
