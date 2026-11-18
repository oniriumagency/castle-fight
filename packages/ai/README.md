# @cardcraft-castles/ai

La IA rival de Cardcraft: Castles y las simulaciones con las que se equilibra el juego. Es TypeScript puro sobre el motor de reglas: corre en el navegador sin servidor, decide en pocos milisegundos y nunca mira cartas ocultas.

## Uso

```ts
import { chooseAction, DIFFICULTIES, DIFFICULTY_NAMES } from '@cardcraft-castles/ai';

// Una acción para el jugador al que le toca (`state.active`).
const action = chooseAction(state, 'hard');
state = applyAction(state, action).state;
```

`chooseAction` devuelve **una** acción. El turno de la IA puede tener varias (la definitiva, la carta, una elección que pide la carta, un turno extra), así que se llama en bucle mientras le siga tocando:

```ts
while (state.phase !== 'finished' && state.active === aiSeat) {
  const result = applyAction(state, chooseAction(state, level));
  if (!result.ok) throw new Error(result.error.message);
  state = result.state;
  await animate(result.events); // la pausa entre jugadas la pone la interfaz
}
```

| Función | Qué hace |
| --- | --- |
| `chooseAction(state, level, options?)` | La jugada de `state.active`. Del estado solo usa la vista de ese jugador. |
| `chooseActionFromView(view, level, options?)` | Lo mismo a partir de un `PlayerView`, que es lo único que tiene un cliente online. Sirve también para sugerir jugadas a una persona. |
| `explainActions(view, level, options?)` | Todas las opciones con la nota que les pone la IA, de mejor a peor. |
| `aiPolicy(level, options?)` | La IA como `Policy` del motor, para `playGame` y `simulate`. |
| `DIFFICULTIES`, `DIFFICULTY_NAMES`, `DIFFICULTY_DESCRIPTIONS` | Los niveles en orden de menú, con nombre y descripción en español e inglés. |
| `runBalance`, `runLadder`, `mergeBalance` | Torneos IA contra IA (los usan los scripts de abajo). |

La decisión es determinista: la misma posición da siempre la misma jugada. Con `options.seed` se fija la semilla a mano.

## Niveles

| Nivel | Cómo juega | Resultado medido |
| --- | --- | --- |
| `easy` Fácil | Valora mal las jugadas y, una de cada tres veces, juega por impulso una carta cualquiera que pueda pagar. Nunca deja pasar una victoria inmediata. | Gana el 98 % a un jugador aleatorio |
| `normal` Normal | Busca la mejor jugada de su turno con algo de imprecisión. No tiene en cuenta tu respuesta. | Gana el 72 % a Fácil |
| `hard` Difícil | Sin imprecisión, promedia seis repartos posibles de las cartas ocultas y simula tu mejor respuesta a sus cinco mejores opciones antes de decidir. | Gana el 69 % a Normal y el 87 % a Fácil |

Son 1.200 partidas por pareja, con héroes al azar y cada reparto jugado desde los dos asientos (`pnpm ladder --pairs 600 --seed 3`). En un juego con robo de cartas la suerte pesa, así que ningún nivel gana siempre. Una decisión tarda de media 0,2 ms en Fácil y Normal y 2 ms en Difícil.

## Cómo piensa

1. **Solo ve lo que ve un jugador.** Parte de un `PlayerView`. Para poder simular con el motor real rellena lo oculto al azar (`determinize`): la mano del rival y el orden de los mazos. Cada relleno es un «mundo», y promediar varios evita que cuente con cartas que no puede conocer.
2. **Prueba cada jugada con el motor.** Aplica cada opción con `applyAction` y sigue su propio turno hasta el final (definitiva, jugada extra, elecciones). Ninguna carta tiene código propio en la IA: una carta nueva en `cards.json` funciona sin tocar este paquete.
3. **Puntúa la posición resultante** (`evaluate`): Torreón (cada punto vale más cerca de 0 y cerca de la victoria), Muralla (más cuando el Torreón está bajo), recursos, trabajadores según los turnos que quedan, Quemadura, Escarcha, Escudo, encantamientos, carga de la definitiva y el valor de las cartas que conserva en la mano.
4. **En Difícil, mira tu respuesta.** Repite sus mejores opciones jugando también el turno del rival y se queda con la que mejor aguanta.

Los pesos de la evaluación están en `DEFAULT_WEIGHTS` (`src/evaluate.ts`) y los ajustes de cada nivel en `PROFILES` (`src/difficulty.ts`).

## Simulaciones de equilibrio

```sh
pnpm balance                         # todos los héroes entre sí, nivel normal, 60 partidas por pareja
pnpm balance --games 300 --level hard --seed 7
pnpm balance --all                   # la tabla completa de cartas
pnpm balance --rules '{"wallStart":20}'      # probar otra regla sin tocar los datos
pnpm balance --patch prueba.json     # probar otros números de cartas o héroes
pnpm ladder                          # la escalera de niveles
pnpm ladder --a hard --b normal --pairs 500
```

`balance` imprime la duración de las partidas, la ventaja de salir primero, cómo terminan, la tabla de héroes y, para cada carta, cuántas veces se juega, cuántas se descarta y cuánto gana quien la juega. Reparte el trabajo entre los núcleos de la máquina: 10.800 partidas en nivel normal tardan unos 25 segundos con cuatro.

Un parche es un JSON con los números a probar (formato en `scripts/patch.ts`). Solo vale para esa ejecución. Cuando un parche da el resultado buscado, los números se pasan a `design/cards.json` y `packages/engine/src/data`, y se actualiza el test de la carta.

### Estado actual

Con la IA en nivel normal, 10.800 partidas (`pnpm balance --games 300 --seed 33`):

| | |
| --- | --- |
| Duración | Con la Furia del Ocaso (por defecto): 24,5 turnos de media entre los dos jugadores (mediana 25; el 10 % pasa de 33). Sin ella: 35 de media (mediana 30; el 10 % pasa de 64) |
| Quien sale primero gana | 50,4 % |
| Finales | Con la Furia: 91 % derribando el Castillo rival, 9 % construyendo hasta 100. Sin ella: 82 % y 18 % |

| Héroe | Victorias |
| --- | --- |
| El Alquimista | 51,4 % |
| La Arquitecta | 50,9 % |
| El Mariscal | 50,9 % |
| La Hechicera | 49,1 % |
| La Saboteadora | 49,1 % |
| El Guardián | 48,6 % |

En nivel difícil los seis quedan entre el 48 % y el 53 %.

## Pruebas

`pnpm --filter @cardcraft-castles/ai test` comprueba que los tres niveles solo hacen jugadas legales hasta el final de la partida, que la decisión no cambia al cambiar lo que el jugador no ve, que rematan cuando pueden ganar, que resuelven las elecciones de sus cartas, que cada nivel gana al anterior y que el paquete no importa nada de Node.
