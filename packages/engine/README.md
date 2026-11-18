# @cardcraft-castles/engine

Motor de reglas de Cardcraft: Castles. Es TypeScript puro, determinista y sin dependencias: el mismo código corre en el servidor (que es la autoridad), en el navegador (previsualizaciones e IA) y en las simulaciones de equilibrio.

- **Puro.** `applyAction` no modifica el estado que recibe: devuelve uno nuevo.
- **Determinista.** Misma semilla y mismas acciones dan siempre la misma partida. El azar sale de un generador con semilla guardado en el estado; nunca se usa `Math.random` ni el reloj.
- **Serializable.** El estado es JSON plano. Se puede guardar con `JSON.stringify`, restaurar con `JSON.parse` y seguir jugando, incluso a mitad de una elección pendiente.
- **Guiado por datos.** Cada carta, héroe y evento es una lista de operaciones (`EffectOp`) indexada por su id. No hay código específico por carta.

## Uso

```ts
import { applyAction, createGame, getPlayerView, legalActions, redactEvents } from '@cardcraft-castles/engine';

// Crear la partida (la semilla debe ser impredecible en partidas online).
let { state, events } = createGame({ seed: 'abc123', heroes: ['arquitecta', 'mariscal'] });

// Qué puede hacer el jugador activo.
const options = legalActions(state);

// Aplicar una jugada. Las jugadas ilegales no cambian nada.
const result = applyAction(state, { type: 'play', player: state.active, uid: state.players[state.active].hand[0].uid });
if (result.ok) {
  state = result.state;
  // A cada cliente, solo lo que puede ver.
  for (const player of [0, 1] as const) {
    send(player, { view: getPlayerView(state, player), events: redactEvents(result.events, player) });
  }
} else {
  console.log(result.error.code); // 'cannotAfford', 'notYourTurn'...
}
```

## API

| Función | Para qué |
| --- | --- |
| `createGame({ seed, heroes, firstPlayer?, rules? })` | Crea la partida y arranca el primer turno. Devuelve `{ state, events }`. |
| `applyAction(state, action)` | Aplica una acción. Devuelve `{ ok: true, state, events }` o `{ ok: false, error }`. |
| `legalActions(board)` | Todas las acciones del jugador que debe mover (sin `concede` ni `timeout`). |
| `getPlayerView(state, viewer)` | El estado sin información oculta, listo para enviar a ese jugador. |
| `redactEvents(events, viewer)` | Los eventos que ese jugador puede ver. |
| `replay(initial, actions)` | Reproduce una partida a partir de su lista de acciones. |
| `effectiveCost(board, player, cardId)` | Coste actual de una carta, con pasivas, encantamientos y eventos aplicados. |
| `playBlocker(board, player, cardId)` | Por qué no se puede jugar una carta ahora (`null` si se puede). Sirve para atenuar cartas en la interfaz. |
| `isComboActive`, `isUltimateReady`, `ultimateThreshold`, `isSchoolBanned`, `attackBonus`, `wallDamageReduction` | Consultas para la interfaz y la IA. |
| `CARDS`, `HEROES`, `BATTLE_EVENTS`, `getCard`, `getHero`, `getBattleEvent` | Catálogo: datos de `design/cards.json` unidos a su mecánica. |
| `TERMS`, `SCHOOL_NAMES`, `RESOURCE_NAMES`, `WORKER_NAMES`, `RARITY_NAMES`, `localize` | Vocabulario del juego en español e inglés. |
| `playGame`, `simulate`, `randomPolicy`, `eagerPolicy` | Partidas automáticas y resumen estadístico. |

Las funciones de consulta aceptan un `Board`, que es la parte pública que comparten `GameState` (servidor) y `PlayerView` (cliente). Así el cliente calcula sus jugadas legales y costes con su propia vista, sin conocer el estado completo.

`@cardcraft-castles/engine/testing` exporta ayudas para montar situaciones concretas en tests (`scenario`, `playCard`, `discardCard`, `choose`, `eventsOf`).

### Acciones

```ts
type Action =
  | { type: 'play'; player; uid }       // jugar la carta `uid` de tu mano
  | { type: 'discard'; player; uid }    // descartarla como acción del turno
  | { type: 'ultimate'; player }        // usar la definitiva del héroe (acción gratuita)
  | { type: 'choose'; player; option }  // responder a `state.pending`
  | { type: 'concede'; player }         // rendirse, en cualquier momento
  | { type: 'timeout' };                // se agotó el reloj. SOLO SERVIDOR
```

Las cartas de una mano se identifican por `uid`, un número que se asigna al robar. No revela nada sobre la carta, así que la vista del rival incluye los `uid` de tus cartas con `cardId: null`, lo que permite animar cada carta boca abajo.

### Elecciones pendientes

Cuatro efectos piden una decisión: qué recurso congelar (Aliento de Escarcha), qué carta descartar tras mirar la mano rival (Espía en la Corte), qué encantamiento destruir (Sabotaje, Disipar) y qué cartas de tu propia mano descartar (`discardOwn`, por ejemplo Ofrenda Arcana o Tierra Quemada). Los descartes propios se eligen de uno en uno; `pending.progress` dice cuántos llevas y cuántos quedan como máximo, y cuando el efecto dice «hasta N» la primera opción es `'done'`, que termina antes. Al jugarlos, `state.phase` pasa a `'choice'` y `state.pending` trae `kind` y `options`. El jugador responde con `{ type: 'choose', option }` y el efecto continúa. Si solo hay una opción válida se toma sola, y si no hay ninguna esa parte del efecto no hace nada. La primera opción de la lista es siempre la que se aplica por defecto si se agota el tiempo.

### Todos contra todos (prototipo de 3 jugadores)

`createGame` acepta 3 héroes. Se juega en círculo y un castillo cuyo Torreón cae a 0 queda eliminado (`playerEliminated`) y deja de jugar. Gana el último en pie o el primero que completa su Torreón. Con 2 jugadores nada cambia.

Las cartas que afectan a «el rival» siguen `rules.multiTargeting`:

- `all` (por defecto): golpean a todos los rivales vivos. Daño, robos, drenajes y turnos de Quemadura se multiplican por `rules.multiAllScale` (0,6), con redondeo y un mínimo de 1. Las elecciones sobre el rival toman su opción por defecto para cada uno. Cuando solo queda un rival, todo vuelve al 100 %.
- `choose`: cada carta apunta a un rival (`target` en `play` y `ultimate`; `legalActions` da una acción por rival).

`rules.leaderExtraDamage` suma daño a cada ataque contra el Torreón más alto y `rules.eliminationBounty` da recursos a quien derriba un castillo. Ambos valen 0 por defecto. `pnpm --filter @cardcraft-castles/ai ffa` compara las variantes con la IA.

### Reloj de turno

El motor no tiene reloj. El servidor programa una alarma de `rules.turnSeconds` (30 s) al empezar cada turno (`state.turn` cambia) y, si salta, aplica `{ type: 'timeout' }`: las elecciones pendientes toman su opción por defecto, si el jugador aún no había jugado, juega la carta más barata que pueda pagar (al azar entre las de igual coste; sus elecciones también toman la opción por defecto), o descarta una al azar si no puede pagar ninguna, y el turno termina. El servidor nunca debe aceptar `timeout` de un cliente.

### Registro de eventos

Cada acción devuelve la lista ordenada de lo que ha pasado (`GameEvent[]`): `cardPlayed`, `damage` (con lo que perdió la Muralla y el Torreón, y si lo bloqueó un Escudo), `built`, `burnApplied`, `enchantmentAdded`, `battleEventStarted`, `turnStarted`, `gameOver` y demás. La interfaz, los efectos visuales y el sonido se montan sobre esta lista; no hace falta comparar estados.

## Reglas precisas

Los números base salen de `design/cards.json` y el resto de `DEFAULT_RULES`. Todos se pueden cambiar por partida con `createGame({ rules })`, pensado para las simulaciones de equilibrio.

**Preparación.** Torreón 50, Muralla 15, 8 de cada recurso, 2 trabajadores de cada tipo y 6 cartas en mano. Quien juega segundo empieza con 5 más de Muralla (`rules.secondPlayerWall`), que compensa la ventaja de mover primero. Cada jugador tiene su propia copia barajada del mazo común: 4 copias de cada carta común, 3 de cada rara, 2 de cada épica y 1 de cada legendaria (226 cartas). Cuando el mazo se agota se baraja el descarte.

**Turno.** Al empezar el turno, en este orden: terminan los efectos «hasta tu próximo turno», salta el evento de batalla si toca, la Quemadura hace su daño, se activan los encantamientos de inicio de turno y los trabajadores producen. Después el jugador juega una carta pagando su coste o descarta una. Al terminar repone la mano hasta 6.

**Daño.** El daño normal golpea la Muralla y el sobrante pasa al Torreón. El perforante va directo al Torreón. El daño «solo a la Muralla» no pasa al Torreón. Cada golpe se resuelve por separado: Doble Salva son dos golpes y Hueste Imparable también.

**Ataques.** Son los golpes de cartas y definitivas. Las bonificaciones (Estandarte de Guerra, pasiva del Mariscal) suman a cada golpe; Contrafuertes resta 3 a cada golpe que alcanza la Muralla; un Escudo bloquea un golpe entero. La Quemadura y los eventos no son ataques.

**Estados.**
- *Quemadura*: 3 de daño normal al inicio del turno del jugador quemado. Los turnos se acumulan hasta 6.
- *Escarcha*: el recurso congelado no produce. Los turnos se acumulan hasta 3 por recurso.
- *Escudo*: cada carga bloquea un golpe. Se acumulan hasta 3 y no caducan.
- Purificación y Ciudadela Eterna quitan Quemadura y Escarcha.

**Encantamientos.** Máximo 2 por jugador. Uno nuevo sustituye al más antiguo, y volver a jugar el mismo reinicia su duración. Un encantamiento de N turnos dura los N turnos siguientes de su dueño (el turno en que se juega no cuenta), así que también cubre N turnos del rival.

**Combo.** Una carta con Combo recibe su bonificación si la última carta que jugaste es de la misma escuela. Descartar rompe la cadena.

**Héroes.** La definitiva se carga con el daño que recibes en Muralla y Torreón (ataques y Quemadura). La primera vez hacen falta 35 puntos y cada uso encarece la siguiente en 15. Usarla es una acción gratuita: después sigues jugando tu carta.

**Eventos de batalla.** Salta uno al inicio de los turnos 9, 17, 25... (cada 8 turnos, contando los de ambos jugadores). El siguiente evento se conoce de antemano (`state.upcomingEvent`), para que la interfaz lo anuncie y los jugadores planeen. Nunca se repite el mismo dos veces seguidas. Eclipse y Tregua duran 2 turnos, uno de cada jugador. Las pérdidas por eventos no cargan la definitiva, ignoran el Escudo y nunca matan: el Terremoto deja el Torreón en 1 como mínimo.

**Furia del Ocaso.** Para que ninguna partida se eternice, a partir del turno 21 (unos 6 minutos de juego) la guerra se recrudece. Al empezar ese turno se anuncia (`twilightRose`) y cada 3 turnos sube un nivel. Por cada nivel: los ataques hacen +3 (como cualquier bonificación de ataque, por golpe), las cartas que levantan el Castillo dan +3, y al empezar su turno el jugador activo pierde 3 de Muralla y 2 de Castillo (como los eventos: no es un ataque, no carga la definitiva, ignora el Escudo y nunca deja el Castillo por debajo de 1). Si al terminar el turno 35 nadie ha ganado, gana el Castillo más alto, luego la Muralla más alta, y si coinciden hay empate (`reason: 'twilight'`). Los números están en `rules.twilight*`; `twilightTurn: 0` la desactiva, y las partidas guardadas antes de que existiera siguen sin ella. Se mide en turnos y no en minutos para que funcione igual con cualquier reloj, sin límite de tiempo y en partidas contra la IA que se retoman horas después. Con la IA en nivel normal, la partida media baja de 35 a 24 turnos y el 10 % más largo pasa de más de 60 turnos a más de 31.

**Final.** Gana quien llega a Torreón 100 o deja el del rival en 0. Si ambas cosas ocurren a la vez gana el jugador activo. Al llegar al turno 200 (solo posible sin la Furia del Ocaso) gana el Torreón más alto, después la Muralla más alta, y si todo coincide hay empate.

### Decisiones tomadas donde el diseño no concretaba

Estas son interpretaciones mías del texto de las cartas. Están cubiertas por tests y son fáciles de cambiar.

| Tema | Decisión |
| --- | --- |
| Espejismo | Copia el efecto de la última carta que jugó el rival, sin su Combo. No se puede jugar si el rival aún no ha jugado ninguna. Tras copiar, esa carta cuenta como la última que jugaste. |
| Ariete de Hierro | Cada punto de daño quita 2 de Muralla; los puntos que sobran al caer la Muralla pasan al Torreón sin duplicar. |
| Ojo del Augur | Descartas la mano boca abajo, robas 6 y puedes jugar o descartar una carta más. |
| Reloj de Arena | Como máximo un turno extra en espera. |
| Motín y definitiva de la Saboteadora | Nadie baja de 1 trabajador por tipo. La Saboteadora gana su trabajador aunque el rival no pueda perderlo. |
| Saqueo Nocturno, Motín | En caso de empate se elige por orden: Piedra, Acero, Maná. |
| Pasiva de la Saboteadora | Solo al descartar voluntariamente, no por agotar el tiempo. |
| Pasiva de la Hechicera | +1 turno a la Quemadura y la Escarcha que aplica. No afecta al Escudo ni a los encantamientos. |
| Eclipse | La mitad del coste, redondeando hacia arriba. |
| Descartes | Los descartes por acción, tiempo o efecto son públicos. El de Ojo del Augur es boca abajo. |
| Mano del rival | Las cartas que te hacen descartar no se reponen hasta el final de tu propio turno. |
| Descartes por carta | Los descartes de tu propia mano por efecto son públicos y no activan la pasiva de la Saboteadora. «Por cada una» cuenta las cartas que descartó ese mismo efecto y se suma en un solo golpe. |

## Simulador

```sh
pnpm sim                                  # 1000 partidas, política "eager"
pnpm sim --games 5000 --seed 7 --policy random
```

`eager` usa la definitiva en cuanto puede, juega una carta al azar de las que puede pagar y solo descarta si no puede jugar ninguna. `random` elige al azar entre todas las acciones legales.

Con jugadores así de torpes las partidas son más largas que entre personas (unos 55 turnos de media con `eager` y 85 con `random`), pero sirven de comprobación rápida: los seis héroes quedan entre el 48 % y el 52 %. El equilibrio de verdad se mide con la IA, que juega con criterio: `pnpm balance` enfrenta a todos los héroes entre sí y `pnpm ladder` compara los niveles de dificultad. Están en [`packages/ai`](../ai/README.md).

## Añadir o cambiar una carta

1. Edita `design/cards.json` (nombre, texto, coste, escuela, rareza).
2. Define su mecánica en `src/data/cardEffects.ts` con el mismo id.
3. Añade su test en `test/cards.test.ts`. Hay un test que falla si falta.

Si el efecto no se puede expresar con las operaciones existentes, añade una nueva a `EffectOp` en `src/types.ts` y su resolución en `src/effects.ts`.
