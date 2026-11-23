/**
 * Painted castles: `art/castles/<hero>/{keep,tower1,tower2,wall,ruins}.(png|jpg|webp)`
 * become the pieces the client stacks in `public/art/castles/<hero>/`.
 *
 * The paintings come on a flat magenta (#FF00FF) or chroma green (#00FF00)
 * background (picked from the corners) or already transparent. Each tower and
 * wall is cut into three bands: the crown (roof, parapet), the shaft (the
 * straight middle, made seamless so it can repeat to any height) and the base.
 * The bands are found from the silhouette: the shaft is the run of rows whose
 * width matches the median width of the middle of the picture. They can be
 * overridden in `art/castles/slices.json` as fractions of the trimmed height:
 * `{ "mariscal/keep": { "crown": 0.3, "base": 0.78 } }`.
 *
 * Writes `<piece>-crown.webp`, `<piece>-shaft.webp`, `<piece>-base.webp` (or
 * `ruins.webp`) and `castles/manifest.json`, which lists what exists.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const STACKED = { keep: 420, tower1: 300, tower2: 300, tower: 300, wall: 360 };
const RUINS_WIDTH = 640;

async function mtime(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return -1;
  }
}

/** Keys out a flat magenta or green background (whichever the corners show), with a soft edge and no fringe. */
function keyOut(data, info) {
  const { width, height } = info;
  const at = (x, y) => (y * width + x) * 4;
  const corners = [at(2, 2), at(width - 3, 2), at(2, height - 3), at(width - 3, height - 3)];
  const transparent = corners.every((i) => data[i + 3] < 16);
  if (transparent) return;
  const mag = corners.filter((i) => Math.min(data[i], data[i + 2]) - data[i + 1] > 80).length;
  const grn = corners.filter((i) => data[i + 1] - Math.max(data[i], data[i + 2]) > 80).length;
  if (!mag && !grn) return;
  const magenta = mag >= grn;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = magenta ? Math.min(r, b) - g : g - Math.max(r, b);
    if (key <= 36) continue;
    const alpha = Math.max(0, Math.min(1, (140 - key) / 104));
    data[i + 3] = Math.round(alpha * data[i + 3]);
    // Spill: pull the key colour out of the soft edge.
    if (magenta) {
      data[i] = Math.min(r, g + 12);
      data[i + 2] = Math.min(b, g + 12);
    } else {
      data[i + 1] = Math.min(g, Math.max(r, b) + 16);
    }
  }
}

/** Opaque span of every row: [left, right] or null. */
function spans(data, width, height) {
  const out = [];
  for (let y = 0; y < height; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 128) {
        if (l < 0) l = x;
        r = x;
      }
    }
    let n = 0;
    for (let x = l; x >= 0 && x <= r; x++) if (data[(y * width + x) * 4 + 3] > 128) n++;
    out.push(l < 0 ? null : [l, r, n / (r - l + 1)]);
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Crown end and base start (rows) of a stacked piece. */
function findBands(rows, height, override) {
  const mid0 = Math.floor(height * 0.4);
  const mid1 = Math.ceil(height * 0.62);
  const mids = rows.slice(mid0, mid1).filter(Boolean);
  const width = median(mids.map(([l, r]) => r - l + 1));
  const left = median(mids.map(([l]) => l));
  const fits = (row) => row && row[2] > 0.9 && Math.abs(row[1] - row[0] + 1 - width) <= width * 0.05 && Math.abs(row[0] - left) <= width * 0.05;
  // Walk out from the middle while rows match, forgiving short runs that do not (mortar, a sill).
  const slack = Math.max(2, Math.round(height * 0.02));
  const walk = (from, step, stop) => {
    let edge = from;
    let miss = 0;
    for (let y = from + step; y !== stop; y += step) {
      if (fits(rows[y])) {
        edge = y;
        miss = 0;
      } else if (++miss > slack) break;
    }
    return edge;
  };
  let crown = walk(mid0, -1, -1);
  let base = walk(mid1, 1, height);
  // The shaft must start and end on clean rows: skip past any stray detail (scaffolding, a banner tip) near its ends.
  const clean = (from, to) => {
    for (let y = Math.min(from, to); y <= Math.max(from, to); y++) if (!fits(rows[y])) return false;
    return true;
  };
  while (crown < mid0 && !clean(crown, crown + slack * 2)) crown++;
  while (base > mid1 && !clean(base - slack * 2, base)) base--;
  if (override?.crown !== undefined) crown = Math.round(override.crown * height);
  if (override?.base !== undefined) base = Math.round(override.base * height);
  return { crown, base, shaftLeft: left, shaftWidth: width, fixed: override?.crown !== undefined && override?.base !== undefined };
}

/**
 * The straight part of a tower often still has windows, string courses or a
 * balcony, and repeating those shows. Only the plainest stretch repeats: a
 * band about as tall as the shaft is wide where every row looks like the
 * median row (brightness, colour, no glowing windows). Everything above it
 * is the crown and everything below it the base.
 */
function plainBand(data, width, b, share = 0.7) {
  const x0 = Math.round(b.shaftLeft + b.shaftWidth * 0.1);
  const x1 = Math.round(b.shaftLeft + b.shaftWidth * 0.9);
  const feats = [];
  for (let y = b.crown; y < b.base; y++) {
    let lum = 0;
    let sat = 0;
    const ls = [];
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const bl = data[i + 2];
      const l = 0.3 * r + 0.59 * g + 0.11 * bl;
      lum += l;
      sat += Math.max(r, g, bl) - Math.min(r, g, bl);
      ls.push(l);
    }
    ls.sort((a, c) => a - c);
    const n = x1 - x0;
    feats.push([lum / n, sat / n, ls[Math.floor(n * 0.95)], ls[Math.floor(n * 0.05)]]);
  }
  const len = Math.min(feats.length, Math.max(24, Math.round(b.shaftWidth * share)));
  if (feats.length <= len) return {};
  const score = feats.map(() => 0);
  for (let k = 0; k < 4; k++) {
    const col = feats.map((f) => f[k]);
    const med = median(col);
    const mad = median(col.map((v) => Math.abs(v - med))) || 1;
    col.forEach((v, i) => (score[i] += Math.min(6, Math.abs(v - med) / mad)));
  }
  // Rows near a string course or a window score high; a small pull toward the middle breaks ties.
  const mid = (feats.length - len) / 2;
  let best = 0;
  let bestScore = Infinity;
  let sum = score.slice(0, len).reduce((a, c) => a + c, 0);
  for (let y = 0; y + len <= feats.length; y++) {
    if (y > 0) sum += score[y + len - 1] - score[y - 1];
    const total = sum / len + (Math.abs(y - mid) / feats.length) * 0.6;
    if (total < bestScore) {
      bestScore = total;
      best = y;
    }
  }
  return { crown: b.crown + best, base: b.crown + best + len };
}

/** Cross-fades the bottom of a vertical tile into its top so it repeats without a seam. */
function seamless(data, width, height) {
  const band = Math.max(2, Math.round(height * 0.14));
  const outH = height - band;
  const out = Buffer.alloc(width * outH * 4);
  data.copy(out, 0, 0, width * outH * 4);
  for (let y = 0; y < band; y++) {
    const t = (y + 0.5) / band;
    const k = t * t * (3 - 2 * t);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        const tail = data[((outH + y) * width + x) * 4 + c];
        const head = data[(y * width + x) * 4 + c];
        out[(y * width + x) * 4 + c] = Math.round(tail * (1 - k) + head * k);
      }
    }
  }
  return { data: out, height: outH };
}

/**
 * Light the painting gives off itself: windows, braziers, crystals, potions.
 * Bright, strongly coloured pixels are kept (sunlit stone is bright but not
 * saturated enough), blurred a little into a glow the game adds on top and
 * makes flicker. Returns null when a band has no light of its own.
 */
async function glowOf(buf, width, height) {
  // Brightness of the neighbourhood: a lit window stands out from the stone around it.
  const lumBuf = Buffer.alloc(width * height);
  for (let i = 0, j = 0; i < buf.length; i += 4, j++) lumBuf[j] = Math.round(0.3 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2]);
  const around = await sharp(lumBuf, { raw: { width, height, channels: 1 } }).blur(Math.max(3, width / 40)).raw().toBuffer();
  const out = Buffer.alloc(buf.length);
  let lit = 0;
  for (let i = 0, j = 0; i < buf.length; i += 4, j++) {
    if (buf[i + 3] < 128) continue;
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const lum = lumBuf[j];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const pop = lum - around[j];
    const k =
      Math.min(1, Math.max(0, (pop - 22) / 34)) *
      Math.min(1, Math.max(0, (sat - 80) / 60)) *
      Math.min(1, Math.max(0, (lum - 100) / 60));
    if (k <= 0) continue;
    lit++;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = Math.round(k * 255);
  }
  if (lit < 12) return null;
  return sharp(out, { raw: { width, height, channels: 4 } }).blur(2).raw().toBuffer();
}

const webp = (data, width, height, file) => sharp(data, { raw: { width, height, channels: 4 } }).webp({ quality: 86, alphaQuality: 92 }).toFile(file);

async function load(input, width) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyOut(data, info);
  // Trim to the silhouette, then scale to the working width.
  return sharp(data, { raw: info })
    .trim({ threshold: 1 })
    .resize({ width, withoutEnlargement: true, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function stacked(input, outDir, piece, override) {
  const { data, info } = await load(input, STACKED[piece]);
  const { width, height } = info;
  const rows = spans(data, width, height);
  const b = findBands(rows, height, override);
  // A wall is wide: a short band keeps its string courses out of the repeat.
  if (!b.fixed) Object.assign(b, plainBand(data, width, b, piece === 'wall' ? 0.2 : 0.7));
  const slice = (y0, y1) => {
    const buf = Buffer.alloc(width * (y1 - y0) * 4);
    data.copy(buf, 0, y0 * width * 4, y1 * width * 4);
    return buf;
  };
  // Nothing but the shaft itself repeats: stray bits beside it (a scaffold, a rope) are cleared.
  const band = slice(b.crown, b.base);
  const keepL = b.shaftLeft - 2;
  const keepR = b.shaftLeft + b.shaftWidth + 1;
  for (let y = 0; y < b.base - b.crown; y++) {
    for (let x = 0; x < width; x++) if (x < keepL || x > keepR) band[(y * width + x) * 4 + 3] = 0;
  }
  const shaft = seamless(band, width, b.base - b.crown);
  const crownGlow = await glowOf(slice(0, b.crown), width, b.crown);
  const baseGlow = await glowOf(slice(b.base, height), width, height - b.base);
  if (crownGlow) await webp(crownGlow, width, b.crown, join(outDir, `${piece}-crown-glow.webp`));
  if (baseGlow) await webp(baseGlow, width, height - b.base, join(outDir, `${piece}-base-glow.webp`));
  await webp(slice(0, b.crown), width, b.crown, join(outDir, `${piece}-crown.webp`));
  await webp(shaft.data, width, shaft.height, join(outDir, `${piece}-shaft.webp`));
  await webp(slice(b.base, height), width, height - b.base, join(outDir, `${piece}-base.webp`));
  // Apex: where the flag flies. A bare flagpole (a thin upright with nothing beside it for a good
  // stretch) wins over a taller spire tip; without one, the highest opaque pixel.
  const top = rows.findIndex(Boolean);
  const opaque = (x, y) => x >= 0 && x < width && y >= 0 && y < height && data[(y * width + x) * 4 + 3] > 128;
  const run = Math.max(8, Math.round(b.crown * 0.12));
  const side = Math.max(5, Math.round(width * 0.025));
  let apex = rows[top] ? { x: (rows[top][0] + rows[top][1]) / 2, y: top } : { x: width / 2, y: 0 };
  // The longest thin upright in the crown (a spire's finial is short before the roof widens).
  let pole = null;
  for (let x = 0; x < width; x++) {
    let y0 = -1;
    for (let y = 0; y < b.crown; y++) if (opaque(x, y)) { y0 = y; break; }
    if (y0 < 0) continue;
    let len = 0;
    for (let y = y0; y < b.crown; y++, len++) {
      if (!opaque(x, y) && !opaque(x - 1, y) && !opaque(x + 1, y)) break;
      let clear = true;
      for (let d = side; d < side * 2 && clear; d++) if (opaque(x - d, y) || opaque(x + d, y)) clear = false;
      if (!clear) break;
    }
    if (len >= run && (!pole || len > pole.len)) pole = { x, y: y0, len };
  }
  if (pole) apex = { x: pole.x, y: pole.y };
  if (override?.flag) apex = { x: override.flag[0] * width, y: override.flag[1] * height };
  return { glow: { crown: !!crownGlow, base: !!baseGlow }, width, crown: b.crown, shaft: shaft.height, base: height - b.base, shaftLeft: b.shaftLeft, shaftWidth: b.shaftWidth, apex };
}

async function ruins(input, outDir) {
  const { data, info } = await load(input, RUINS_WIDTH);
  await webp(data, info.width, info.height, join(outDir, 'ruins.webp'));
  return { width: info.width, height: info.height };
}

export async function buildCastles(source, target) {
  const root = join(source, 'castles');
  const heroes = await readdir(root, { withFileTypes: true }).catch(() => []);
  const slices = JSON.parse(await readFile(join(root, 'slices.json'), 'utf8').catch(() => '{}'));
  const manifestPath = join(target, 'castles', 'manifest.json');
  const old = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));
  const manifest = {};
  let built = 0;
  for (const dir of heroes) {
    if (!dir.isDirectory()) continue;
    const hero = dir.name;
    const files = await readdir(join(root, hero));
    const outDir = join(target, 'castles', hero);
    await mkdir(outDir, { recursive: true });
    for (const file of files) {
      const m = /^(keep|tower1|tower2|tower|wall|ruins)\.(png|jpe?g|webp)$/i.exec(file);
      if (!m) continue;
      const piece = m[1].toLowerCase();
      const input = join(root, hero, file);
      const probe = join(outDir, piece === 'ruins' ? 'ruins.webp' : `${piece}-shaft.webp`);
      const stale = Math.max(await mtime(input), await mtime(join(root, 'slices.json')));
      manifest[hero] ??= {};
      if (old[hero]?.[piece] && (await mtime(probe)) >= stale) {
        manifest[hero][piece] = old[hero][piece];
        continue;
      }
      manifest[hero][piece] = piece === 'ruins' ? await ruins(input, outDir) : await stacked(input, outDir, piece, slices[`${hero}/${piece}`]);
      built++;
    }
  }
  await mkdir(join(target, 'castles'), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1));
  return built;
}
