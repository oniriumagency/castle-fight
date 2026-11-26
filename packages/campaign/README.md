# @cardcraft-castles/campaign

El modo Campaña. Todo lo que no es pantalla vive aquí: el mapa, el progreso, los mazos rivales, la dificultad y los textos de la historia. No depende del navegador.

- `src/data.ts`: los 6 reinos, sus 5 territorios (4 feudos y el castillo), la Corona final, los capitanes, los terrenos, las cartas iniciales y las recompensas de cada territorio. Las fronteras son las únicas rutas de ataque.
- `src/progress.ts`: la partida guardada (`CampaignSave`), qué se puede atacar, la colección y el mazo del jugador, el mazo y la dificultad de cada rival, y cómo se arma (`battleSetup`) y se cierra (`settleBattle`) cada batalla. Al perder, el territorio secuestra una copia al azar, que se recupera al conquistarlo.
- `src/dialogues.ts`: prólogo, presentaciones de cada reino, castillos, caídas, despertar de la definitiva, batalla final y epílogo, en español e inglés.

Reglas que solo valen dentro de la campaña: se empieza con la Arquitecta y 18 cartas comunes; los capitanes no tienen pasiva ni definitiva; la definitiva del jugador despierta al tomar el primer castillo; las partidas no cuentan para el récord.

```sh
pnpm --filter @cardcraft-castles/campaign test
pnpm --filter @cardcraft-castles/campaign sim -- --games 40 --difficulty normal
```
