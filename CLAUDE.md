# Cardcraft: Castles

## Publicar

- Producción: cada push a `main` publica games.onirium.agency (el juego en `/cardcraft-castles/`) con [Deploy](.github/workflows/deploy.yml).
- La beta (`https://cardcraft-castles-preview.oniriumagency.workers.dev`, Worker `cardcraft-castles-preview`) se publica con [Preview](.github/workflows/preview.yml).
- **Regla: todo lo que se publica va también a la beta.** Preview corre en cada push a `main`, así la beta siempre está al día con producción. No quites `main` de sus ramas. Si algún día falla o no corre, lánzalo a mano sobre `main` después de publicar.
- Para probar algo solo en la beta, súbelo a una rama `preview/<nombre>`: queda ahí hasta el siguiente push a `main`.
- La beta ya no tiene enlace desde games.onirium.agency, pero hay gente con la dirección.
