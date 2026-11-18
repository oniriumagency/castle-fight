/**
 * Converts the illustrations in `art/` (1200x896 JPG) into the WebP files the
 * client serves from `public/art/`. A card on screen is at most ~420 px wide,
 * so 720 px covers a 2x display at a fraction of the weight. Files that are
 * already up to date are skipped, so this is cheap to run before every dev
 * server start and build.
 */
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '../../../art');
const target = join(here, '../public/art');
const FOLDERS = ['cards', 'heroes', 'events'];
const WIDTH = 720;

async function mtime(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return -1;
  }
}

let built = 0;
let skipped = 0;
for (const folder of FOLDERS) {
  await mkdir(join(target, folder), { recursive: true });
  for (const file of await readdir(join(source, folder))) {
    if (!/\.(jpe?g|png)$/i.test(file)) continue;
    const input = join(source, folder, file);
    const output = join(target, folder, file.replace(/\.(jpe?g|png)$/i, '.webp'));
    if ((await mtime(output)) >= (await mtime(input))) {
      skipped++;
      continue;
    }
    await sharp(input).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toFile(output);
    built++;
  }
}
console.log(`art: ${built} converted, ${skipped} up to date -> ${relative(process.cwd(), target)}`);
