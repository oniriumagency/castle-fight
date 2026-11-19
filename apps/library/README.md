# Biblioteca de juegos

La portada de <https://games.onirium.agency>: la lista de juegos de Onirium, con los mismos materiales que Cardcraft: Castles (madera, cuero y latón). Es HTML y CSS estáticos, sin framework, en español e inglés (recuerda el idioma elegido y, si no hay, usa el del juego).

```sh
pnpm --filter @cardcraft-castles/client build   # el juego
pnpm --filter @cardcraft-castles/library build  # la biblioteca + el juego en dist/
pnpm --filter @cardcraft-castles/library test
```

`dist/` es lo que publica el Worker (`apps/server`, `--env production`):

| Ruta | Qué es |
| --- | --- |
| `/` | La biblioteca (`index.html`). |
| `/cardcraft-castles/` | El juego, copiado de `apps/client/dist`. |
| Cualquier otra | `404.html`, con un enlace de vuelta. |

## Añadir un juego

Añade una entrada a `games.json`, en el orden en que debe aparecer:

| Campo | Qué es |
| --- | --- |
| `id` | Identificador en minúsculas con guiones. La portada se publica como `covers/<id>.webp`. |
| `title` | Nombre del juego. |
| `url` | Dónde se juega: una ruta de este sitio (`/mi-juego/`) o una dirección `https://` externa. |
| `cover` | Imagen de portada, relativa a la raíz del repositorio (se recorta a 16:10). |
| `tagline`, `description`, `play` | Lema, descripción y texto del botón, cada uno con `es` y `en`. |
| `tags` | Opcional: etiquetas por idioma. |
| `badge` | Opcional: una insignia (como "Beta"); la tarjeta se pinta en verde azulado. |

Si el juego se sirve desde este mismo sitio, añádelo también a `BUNDLED` en `build.mjs` con la carpeta de su compilación, y compílalo con su `base` en esa ruta. `moreComing` muestra al final la tarjeta "Más juegos en camino".

La beta del rediseño apunta a la copia de pruebas (`cardcraft-castles-preview` en workers.dev, ver `.github/workflows/preview.yml` en esa rama). Esa copia no tiene biblioteca: su raíz lleva directamente al juego.
