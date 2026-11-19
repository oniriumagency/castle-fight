/**
 * Builds games.onirium.agency into `dist/`:
 *
 *   dist/                     the library (index.html, 404.html, styles, fonts, covers)
 *   dist/cardcraft-castles/   the game, copied from apps/client/dist
 *
 * The Worker (apps/server, `--env production`) serves this folder as static
 * assets. Build the client first: `pnpm --filter @cardcraft-castles/client build`.
 */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { coverFile, renderIndex, renderNotFound, validate } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const out = join(here, 'dist');
const require = createRequire(import.meta.url);

/** Each game served from this site: its folder in dist/ and where its build is. */
const BUNDLED = [{ path: 'cardcraft-castles', from: join(root, 'apps/client/dist') }];

const FONTS = [
  ['@fontsource/cinzel', 'cinzel-latin-600-normal.woff2'],
  ['@fontsource/cinzel', 'cinzel-latin-700-normal.woff2'],
  ['@fontsource/eb-garamond', 'eb-garamond-latin-400-normal.woff2'],
  ['@fontsource/eb-garamond', 'eb-garamond-latin-400-italic.woff2'],
];

const data = JSON.parse(await readFile(join(here, 'games.json'), 'utf8'));
const problems = validate(data);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

for (const game of BUNDLED) {
  try {
    await stat(join(game.from, 'index.html'));
  } catch {
    console.error(`library: ${game.from} has no build. Run \`pnpm --filter @cardcraft-castles/client build\` first.`);
    process.exit(1);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'covers'), { recursive: true });
await mkdir(join(out, 'fonts'), { recursive: true });

await writeFile(join(out, 'index.html'), renderIndex(data));
await writeFile(join(out, '404.html'), renderNotFound());
await cp(join(here, 'src/styles.css'), join(out, 'styles.css'));
await cp(join(here, 'src/emblem.svg'), join(out, 'emblem.svg'));
for (const [pkg, file] of FONTS) {
  await cp(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file), join(out, 'fonts', file));
}
for (const game of data.games) {
  await sharp(join(root, game.cover))
    .resize({ width: 800, height: 500, fit: 'cover', position: 'attention' })
    .webp({ quality: 78 })
    .toFile(join(out, coverFile(game)));
}
for (const game of BUNDLED) {
  await cp(game.from, join(out, game.path), { recursive: true });
}

console.log(`library: ${data.games.length} games -> ${out}`);
