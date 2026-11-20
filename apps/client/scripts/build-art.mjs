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
const FOLDERS = ['cards', 'heroes', 'events', 'scenery'];
const WIDTH = 720;
/** The painted battlefield fills the whole screen, so it keeps more pixels. */
const WIDTHS = { scenery: 2560 };
/** The light scenery copies: about 2,400 px of sky and 1,600 px of terrain. */
const LITE_SKY_HEIGHT = 720;
const LITE_WIDTH = 1600;

async function mtime(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * The terrain is painted over a flat magenta (#FF00FF) sky, since image
 * generators do not give transparency: magenta becomes transparent, with a
 * soft edge, and the pink fringe on the hills is removed.
 */
async function cutOutSky(image) {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // How magenta the pixel is: red and blue high, green low.
    const key = Math.min(r, b) - g;
    if (key <= 40) continue;
    const alpha = Math.max(0, Math.min(1, (150 - key) / 110));
    data[i + 3] = Math.round(alpha * 255);
    data[i] = Math.min(r, g + 30);
    data[i + 2] = Math.min(b, g + 30);
  }
  return sharp(data, { raw: info });
}

/**
 * A sky wide enough to drift endlessly (2.8:1 or more, as in battlefield.ts)
 * is made exactly seamless: generated "seamless" images rarely match pixel for
 * pixel, and any mismatch shows as a vertical line when the sky repeats. The
 * last 6% of the width is cut off and cross-faded into the first 6%, so the
 * right edge runs straight into the left one.
 */
async function closeSeam(image) {
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width / height < 2.8) return sharp(data, { raw: info });
  const band = Math.round(width * 0.06);
  const outW = width - band;
  const out = Buffer.alloc(outW * height * channels);
  for (let y = 0; y < height; y++) {
    data.copy(out, y * outW * channels, y * width * channels, (y * width + outW) * channels);
    for (let x = 0; x < band; x++) {
      const t = (x + 0.5) / band;
      // Smoothstep: no visible edge where the fade starts or ends.
      const k = t * t * (3 - 2 * t);
      for (let c = 0; c < channels; c++) {
        const tail = data[(y * width + outW + x) * channels + c];
        const head = data[(y * width + x) * channels + c];
        out[(y * outW + x) * channels + c] = Math.round(tail * (1 - k) + head * k);
      }
    }
  }
  return sharp(out, { raw: { width: outW, height, channels } });
}

let built = 0;
let skipped = 0;
for (const folder of FOLDERS) {
  await mkdir(join(target, folder), { recursive: true });
  // `scenery` is optional: without it the battlefield is drawn.
  const files = await readdir(join(source, folder)).catch(() => []);
  for (const file of files) {
    if (!/\.(jpe?g|png)$/i.test(file)) continue;
    const input = join(source, folder, file);
    // The painted battlefield also gets a light copy (`-lite`) for consoles,
    // phones and low effects: the full sky alone is ~4000 px wide, too much
    // GPU memory for a console browser and over some GPUs' texture limit.
    const variants = folder === 'scenery' ? [false, true] : [false];
    for (const lite of variants) {
      const output = join(target, folder, file.replace(/\.(jpe?g|png)$/i, lite ? '-lite.webp' : '.webp'));
      if ((await mtime(output)) >= (await mtime(input))) {
        skipped++;
        continue;
      }
      // The sky is sized by its height (it fills the screen top to horizon); a
      // seamless panorama can be several screens wide.
      const size =
        folder === 'scenery' && file.startsWith('sky')
          ? { height: lite ? LITE_SKY_HEIGHT : 1200 }
          : { width: lite ? LITE_WIDTH : (WIDTHS[folder] ?? WIDTH) };
      const resized = sharp(input).resize({ ...size, withoutEnlargement: true });
      const image =
        folder === 'scenery' && file.startsWith('terrain')
          ? await cutOutSky(resized)
          : folder === 'scenery' && file.startsWith('sky')
            ? await closeSeam(resized)
            : resized;
      await image.webp({ quality: folder === 'scenery' ? 84 : 80, alphaQuality: 90 }).toFile(output);
      built++;
    }
  }
}
console.log(`art: ${built} converted, ${skipped} up to date -> ${relative(process.cwd(), target)}`);
