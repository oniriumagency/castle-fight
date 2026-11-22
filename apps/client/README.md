# Cliente web

Vite + TypeScript + PixiJS 8. Sin framework de interfaz: las pantallas son DOM con CSS y el campo de batalla es un lienzo de Pixi detrás de ellas.

```sh
pnpm dev:client     # http://localhost:5173/cardcraft-castles/ (con pnpm dev:server para jugar en línea)
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

## Historial y némesis

`game/record.ts` guarda en el navegador (`cardcraft-castles:record`) las victorias, derrotas y empates en línea y contra la IA, y el marcador contra cada rival en línea. Al sentarse, el SDK envía un id público y aleatorio del navegador (`OnlineClient.playerId`, distinto del `clientId` privado de partida rápida); el servidor lo reparte en `SeatInfo.pid`, así que el marcador sigue al rival aunque cambie de apodo. Los clientes que no envían id se cuentan por apodo. Cada partida se cuenta una sola vez (`<sala>:<partida>`), aunque se recargue la página en la pantalla de resultados.

La pantalla de resultados enseña el marcador contra ese rival, y **Mi historial** en el menú los totales, la lista de rivales y el némesis: el rival con quien más has jugado, desde 3 partidas (si hay empate, el que más te ha ganado). Las partidas a dos en el mismo dispositivo no cuentan.

El tablero no sabe de dónde viene la partida: recibe de la sesión una vista (`getPlayerView`) y la lista de eventos (`redactEvents`), anima los eventos uno a uno y al final se ajusta a la vista. Las cifras (Torreón para ganar, Torreón y Muralla iniciales) salen siempre de `view.rules`.

## Sonido, música y efectos visuales

Los efectos de sonido y visuales son originales y se generan en el navegador: no hay archivos de sonido ni sprites de efectos de terceros. La música son tres pistas elegidas por el equipo, en `public/music/`.

**Sonido** (`src/fx/sound/`)

- `synth.ts`: un sintetizador pequeño (osciladores, ruido blanco, rosa y marrón, FM, filtros y envolventes) que funciona en contextos de audio en vivo y sin conexión, y la respuesta al impulso de la reverb de sala.
- `sfx.ts`: más de 80 efectos, cada uno una receta: botones, cartas, un sonido por escuela (Construcción, Asalto, Arcano), uno por rareza, construir, lanzar, impactos según el daño, perforante, escudo, quemadura, escarcha, encantamientos, definitivas con un sello distinto por héroe, un sonido por evento de batalla, reloj de turno, victoria y derrota, la caída de la Furia del Ocaso, la campaña (elegir territorio, conquista, fanfarria de castillo, pasar página del cómic, avisos del tutorial) y una voz inventada por héroe (y otra para los capitanes) que suena con sus burbujas y en los diálogos. Cada receta se renderiza una vez a un búfer (`OfflineAudioContext`) la primera vez que hace falta, se normaliza a su nivel y luego solo se reproduce, con una pequeña variación de tono en cada golpe.
- `music.ts`: la banda sonora. En el menú y el mapa de la campaña alternan *Village Consort* y *Folk Round*; en la partida, *Lord of the Land* y *Pippin the Hunchback* (sube un poco de volumen cuando el final está cerca); desde que cae la Furia del Ocaso, *Heavy Interlude* y *Epic Boss Battle* (entra con un fundido cruzado de 3 s); en la batalla final de la campaña, contra los héroes poseídos, *Burnt Spirit* toda la partida; *Celtic Morning* en la victoria y *To the Fallen* en la derrota. Cuando un momento tiene dos piezas, suenan una tras otra y cada vez que vuelve empieza por la otra. Son MP3 a 96 kbps que se reproducen en streaming con dos elementos `<audio>` conectados al bus de música, así que no se descodifican enteros en memoria, funcionan los volúmenes y la atenuación, y cambiar de pista hace un fundido cruzado. Para cambiar una pista basta con sustituir el MP3 y ajustar su nivel en `TRACKS`; si es nueva, añade su atribución en `screens/credits.ts` (Ajustes → Créditos y Opciones de la campaña → Créditos).
- `src/fx/audio.ts`: la API (`audio.play(cue, intensidad, { pan })`, `audio.music(track)`, `audio.setTension(0..1)`, `audio.duck()`), buses de efectos y música, reverb y limitador. Nada se crea hasta el primer toque o tecla; después se preparan los efectos más usados en momentos libres, sin bloquear fotogramas. La música y los sonidos siguen sonando si cambias de pestaña o de ventana (en móvil el sistema puede pausarlos en segundo plano; al volver se reanudan). En móvil se mezcla con lo que esté sonando en lugar de pararlo.

**Efectos visuales**

- `src/fx/director.ts`: un método por momento del juego (`cardLanded`, `damage`, `built`, `status`, `ultimate`, `battleEvent`, `gameOver`…). Elige el proyectil según la carta (piedras de catapulta, flechas, cargas por el suelo, rayos, bolas de fuego, cometa), el impacto según el daño, y mantiene las auras de los castillos (llamas con Quemadura, hielo con Escarcha, humo cuando el Torreón está a punto de caer).
- `src/scene/battlefield.ts`: partículas recicladas con tope (chispas estiradas, humo, llamas, cristales, escombros), anillos de onda, destellos, rayos de luz, relámpagos, fuegos artificiales, retroceso y tinte de los castillos al recibir golpes y una sacudida suave por "trauma".
- Calidad de efectos (`src/app/quality.ts`): en `Auto` empieza en alta salvo en dispositivos modestos y baja sola si los fotogramas van lentos. En baja hay la mitad de partículas, sin rayos ni humo, y el lienzo usa menos resolución.
- Definitiva lista (`screens/board/ultimateMode.ts`): resplandor dorado en los bordes de toda la pantalla con chispas y rayos, y a la derecha de la mano un botón con el rostro del héroe (ojos brillantes, aura y relámpagos dorados) que la activa. El retrato del panel solo muestra la carga con su anillo dorado. Las posiciones de los ojos de cada retrato están en `EYES`.
- Definitiva usada: todos los jugadores ven "¡(Jugador) ha usado su definitiva!" (quien la lanza lee "¡Has usado tu definitiva!") sobre la carta del héroe, con rayos, anillos y un destello del color del héroe (`showUltimateUsedCall` en `board.ts`). Su castillo brilla unos 3 s (`Castle.radiate`, un `ColorMatrixFilter` que aclara y tiñe las piedras) con oleadas de luz alrededor (`castleGlow` en `fx/director.ts`).
- Cartas legendarias: "¡Legendaria!" sobre la carta, más rayos y partículas, y si la carta refuerza un castillo (Torreón, Muralla o Escudo) lo envuelve en fuego sagrado dorado y naranja.
- Las cartas brillan según su rareza y al caer en la mesa dejan un destello del color de su escuela (`styles/card.css`, `.play-burst` en `styles/board.css`).

Ajustes: volumen general, música y efectos, silenciar todo (también con la tecla M), calidad de efectos, sacudida de pantalla y movimiento reducido. El botón del altavoz (menú y partida) abre ahí mismo un panel con los tres volúmenes y Silenciar todo (`ui/muteButton.ts`).

## Jugar sin conexión

En las compilaciones (no en `pnpm dev`) un service worker guarda el juego en el dispositivo, así que la campaña, la IA y dos jugadores funcionan sin internet. `sw/plugin.ts` escribe `dist/sw.js` a partir de `sw/sw.js` con la lista de archivos y un hash del contenido de cada uno; `src/app/offline.ts` lo registra.

- Antes de activarse guarda la página, el código, los estilos, las fuentes (woff2), los iconos y todas las ilustraciones, incluido el cómic (unos 9 MB). La música (unos 15 MB) se guarda justo después, en segundo plano, y si se corta sigue en la siguiente visita. Las peticiones por rangos de `<audio>` se responden desde el archivo guardado.
- Cada despliegue es una versión nueva de la caché: solo se descargan los archivos cuyo hash cambió, el resto se copia de la versión anterior, que después se borra. La página se pide primero a la red (con 4 s de margen), así que con conexión siempre llega la última versión; sin conexión sale la guardada. El juego instalado busca una versión nueva al volver al frente, como mucho una vez por hora.
- La API en línea (`api/`) nunca pasa por la caché.

## Controles

Tocar o hacer clic en una carta la muestra en grande con Jugar y Descartar. En ordenador también se puede arrastrar hacia arriba para jugar o al montón de descartes, hacer doble clic, o usar teclas: 1 a 6 eligen carta, Intro juega, Supr descarta, U usa la definitiva y Esc cierra.
