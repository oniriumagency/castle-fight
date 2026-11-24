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

/** A small seeded random, so a rebuild gives the same picture. */
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * A short shaft repeated up a tall tower shows the same stones over and over.
 * Stack several copies into one longer tile and weather each differently:
 * broad patches of grime, damp and sun-bleached stone, wrapping top to bottom
 * so the long tile is still seamless.
 */
function weather(shaft, width, seed) {
  const copies = Math.max(3, Math.ceil((width * 1.8) / shaft.height));
  const H = shaft.height * copies;
  const out = Buffer.alloc(width * H * 4);
  for (let i = 0; i < copies; i++) shaft.data.copy(out, i * shaft.data.length);
  const rand = seeded(seed);
  const blobs = [];
  for (let i = 0; i < copies * 5; i++) {
    blobs.push({
      x: rand() * width,
      y: rand() * H,
      rx: width * (0.12 + rand() * 0.3),
      ry: width * (0.1 + rand() * 0.35),
      // Mostly grime and damp (darker, a touch green or brown), some paler, sunned stone.
      k: rand() < 0.65 ? -(0.04 + rand() * 0.08) : 0.025 + rand() * 0.04,
      tint: rand() < 0.5 ? [0.98, 0.99, 0.97] : [1.02, 0.99, 0.96],
    });
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!out[i + 3]) continue;
      let m = 1;
      const t = [1, 1, 1];
      for (const b of blobs) {
        // Wrap vertically: the tile repeats, so a patch at its bottom continues at its top.
        let dy = Math.abs(y - b.y);
        dy = Math.min(dy, H - dy) / b.ry;
        const dx = (x - b.x) / b.rx;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const f = (1 - d) * (1 - d);
        m += b.k * f;
        if (b.k < 0) for (let c = 0; c < 3; c++) t[c] += (b.tint[c] - 1) * f;
      }
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(out[i + c] * m * t[c])));
    }
  }
  return { data: out, height: H };
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
  const shaft = weather(seamless(band, width, b.base - b.crown), width, input.split(/[\\/]/).slice(-2).join('/'));
  // The side the shaft is lit from, so ornaments can be turned to match it.
  const light = lightSign(lightSide(band, width, 0, 0, width, b.base - b.crown), 6);
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
  return { light, glow: { crown: !!crownGlow, base: !!baseGlow }, width, crown: b.crown, shaft: shaft.height, base: height - b.base, shaftLeft: b.shaftLeft, shaftWidth: b.shaftWidth, apex };
}

/**
 * Damage decals: 2x2 sprite sheets of cracks, holes and scorch painted on
 * magenta, shared by every castle. Cracks and holes keep their dark strokes
 * and let their pale stone fade out, so they sit on any hero's masonry.
 * Writes `_comun/<sheet>.webp` and the trimmed frame of each quadrant.
 */
const DECALS = { props: null, cracks: { dark: 150, range: 90, power: 0.9 }, holes: { dark: 230, range: 120, power: 0.6 }, scorch: null };

async function decalSheet(input, outDir, name, kind, grid = 2, size = 1024) {
  const { data, info } = await sharp(input).resize({ width: size, height: size, fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyOut(data, info);
  const fade = DECALS[kind];
  if (fade) {
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      data[i + 3] = Math.round(data[i + 3] * Math.max(0, Math.min(1, (fade.dark - lum) / fade.range)) ** fade.power);
    }
  }
  const { width, height } = info;
  const frames = [];
  const half = Math.floor(width / grid);
  for (let q = 0; q < grid * grid; q++) {
    const x0 = (q % grid) * half;
    const y0 = Math.floor(q / grid) * half;
    let l = half, r = -1, t = half, b = -1;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        if (data[((y0 + y) * width + x0 + x) * 4 + 3] < 24) continue;
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
    frames.push(r > l && b > t ? [x0 + l, y0 + t, r - l + 1, b - t + 1] : null);
  }
  // Props stand on a strip of painted ground cut flat along the bottom: fade that edge so it melts into the field.
  if (kind === 'props') {
    for (const f of frames) {
      if (!f) continue;
      const [fx, fy, fw, fh] = f;
      const band = Math.max(4, Math.round(fh * 0.1));
      for (let y = fy + fh - band; y < fy + fh; y++) {
        const k = (fy + fh - y) / band;
        for (let x = fx; x < fx + fw; x++) data[(y * width + x) * 4 + 3] = Math.round(data[(y * width + x) * 4 + 3] * k);
      }
    }
  }
  await webp(data, width, height, join(outDir, `${name}.webp`));
  return { kind, frames: grid === 2 ? frames.filter(Boolean) : frames };
}

/**
 * Which side a painted thing is lit from: the mean brightness just inside its
 * right outline minus just inside its left one, row by row (glowing windows
 * and flames left out). Positive: lit from the right. Shape barely matters,
 * since each row is compared with itself.
 */
function lightSide(data, width, x0, y0, w, h) {
  let left = 0;
  let right = 0;
  let nl = 0;
  let nr = 0;
  const lumAt = (i) => 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
  const lit = (i) => {
    const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    return data[i + 3] > 128 && !(sat > 120 && lumAt(i) > 150);
  };
  let minX = w;
  let maxX = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[((y0 + y) * width + x0 + x) * 4 + 3] <= 128) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  const k = Math.max(3, Math.round((maxX - minX) * 0.08));
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * width + x0;
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] <= 128) continue;
      if (l < 0) l = x;
      r = x;
    }
    if (l < 0 || r - l < 3 * k) continue;
    for (let x = l + 1; x < l + k; x++) {
      const i = (row + x) * 4;
      if (lit(i)) (left += lumAt(i)), nl++;
    }
    for (let x = r - k + 1; x < r; x++) {
      const i = (row + x) * 4;
      if (lit(i)) (right += lumAt(i)), nr++;
    }
  }
  if (nl < 30 || nr < 30) return 0;
  return right / nr - left / nl;
}

/** -1 lit from the left, 1 from the right, 0 when the difference is too faint to tell. */
const lightSign = (v, faint = 10) => (Math.abs(v) < faint ? 0 : Math.sign(v));

/** Average colour of the stones of a shaft (glowing windows left out). */
async function stoneColour(file) {
  try {
    const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      for (let c = 0; c < 3; c++) sum[c] += data[i + c];
      n++;
    }
    return n ? sum.map((v) => v / n) : null;
  } catch {
    return null;
  }
}

/** Bump when the ornament treatment changes, so cached sheets are redone. */
const ORNAMENT_VERSION = 4;
/** Ornament sheets are painted far finer than the walls they sit on: shrink them to about the walls' grain. */
const ORNAMENT_SHEET = 576;

/**
 * Wall ornaments, a 3 x 3 sheet painted on magenta. Painted on their own,
 * they come out crisper, more contrasted and more saturated than the castle,
 * with hard dark outlines, and look stuck on. So they are brought to the
 * wall's grain and light: shrunk and softened to the walls' resolution,
 * their darks lifted and colours pulled a little toward the stone (the same
 * air and light falls on both), and each gets a soft shadow on the wall, cast
 * away from its own light. The side each is lit from is recorded, so the
 * game can turn it to match its tower.
 */
async function ornamentSheet(input, outDir, name, kinds, stone) {
  const big = 1152;
  const raw = await sharp(input).resize({ width: big, height: big, fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyOut(raw.data, raw.info);
  const cell = big / 3;
  const light = [];
  for (let q = 0; q < 9; q++) light.push(lightSign(lightSide(raw.data, big, (q % 3) * cell, Math.floor(q / 3) * cell, cell, cell)));

  // Grade: lift the darks, pull toward the stone's colour, ease the saturation. Glowing bits keep their fire.
  const ref = stone ?? [150, 140, 125];
  const refLum = 0.3 * ref[0] + 0.59 * ref[1] + 0.11 * ref[2];
  const d = raw.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const glow = Math.min(1, Math.max(0, (sat - 110) / 50)) * Math.min(1, Math.max(0, (lum - 140) / 60));
    const k = 1 - glow;
    // Contrast eased around the stone's own brightness, so outlines read like paint, not ink.
    const lum2 = refLum + (lum - refLum) * (1 - 0.22 * k);
    const out = [r, g, b].map((c, j) => {
      let v = lum + (c - lum) * (1 - 0.18 * k); // a little less saturated
      v *= lum > 1 ? lum2 / lum : 1;
      v += (ref[j] * (lum2 / Math.max(1, refLum)) - v) * 0.16 * k; // the stone's colour cast
      return v;
    });
    // Darkest strokes lifted toward the stone's shadow tone.
    const floor = refLum * 0.28 * k;
    for (let j = 0; j < 3; j++) d[i + j] = Math.max(0, Math.min(255, Math.round(Math.max(out[j], floor * (ref[j] / Math.max(1, refLum))))));
  }

  // Down to the walls' grain, through a slightly smaller size for a painterly softness (alpha is premultiplied by sharp).
  const size = ORNAMENT_SHEET;
  const soft = await sharp(d, { raw: raw.info }).resize({ width: Math.round(size * 0.8), height: Math.round(size * 0.8), kernel: 'lanczos3' }).raw().toBuffer();
  const img = await sharp(soft, { raw: { width: Math.round(size * 0.8), height: Math.round(size * 0.8), channels: 4 } })
    .resize({ width: size, height: size, kernel: 'cubic' })
    .raw()
    .toBuffer();

  // Shadow cast on the wall, down and away from the ornament's light; none for things sticking out into the air.
  const alpha = Buffer.alloc(size * size);
  for (let i = 0, j = 0; j < alpha.length; i += 4, j++) alpha[j] = img[i + 3];
  const blurred = await sharp(alpha, { raw: { width: size, height: size, channels: 1 } }).blur(size / 220).extractChannel(0).raw().toBuffer();
  const cellPx = size / 3;
  const out = Buffer.alloc(img.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const q = Math.floor(y / cellPx) * 3 + Math.floor(x / cellPx);
      const kind = kinds[q];
      const i = (y * size + x) * 4;
      let sh = 0;
      if (kind !== 'edgeR' && kind !== 'edgeL' && kind !== 'x') {
        const dx = Math.round(-light[q] * size * 0.006);
        const dy = Math.round(size * 0.008);
        const sx = x - dx;
        const sy = y - dy;
        // Stay inside the cell: a neighbour's shadow must not leak in.
        if (sx >= 0 && sy >= 0 && sx < size && sy < size && Math.floor(sy / cellPx) * 3 + Math.floor(sx / cellPx) === q) sh = (blurred[sy * size + sx] / 255) * 0.42;
      }
      const a = img[i + 3] / 255;
      const outA = a + sh * (1 - a);
      if (outA <= 0) continue;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round((img[i + c] * a) / outA);
      out[i + 3] = Math.round(outA * 255);
    }
  }

  const frames = [];
  const cpx = Math.floor(cellPx);
  for (let q = 0; q < 9; q++) {
    const x0 = (q % 3) * cpx;
    const y0 = Math.floor(q / 3) * cpx;
    let l = cpx, r = -1, t = cpx, b = -1;
    for (let y = 0; y < cpx; y++) {
      for (let x = 0; x < cpx; x++) {
        if (out[((y0 + y) * size + x0 + x) * 4 + 3] < 24) continue;
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
    frames.push(r > l && b > t && kinds[q] !== 'x' ? [x0 + l, y0 + t, r - l + 1, b - t + 1, kinds[q] ?? 'deco', light[q]] : null);
  }
  await webp(out, size, size, join(outDir, `${name}.webp`));
  return { name, v: ORNAMENT_VERSION, frames };
}

/**
 * The masons' scaffold shown while a part is built: cut like a tower, with
 * one bay of the lattice (beam to beam) as the shaft so it repeats cleanly.
 */
async function scaffold(input, outDir) {
  const { data, info } = await load(input, 420);
  const { width, height } = info;
  const rows = spans(data, width, height);
  // The posts: the columns opaque down most of the height.
  const cols = new Array(width).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 128) cols[x]++;
  const posts = cols.map((c, x) => (c > height * 0.6 ? x : -1)).filter((x) => x >= 0);
  const left = posts[0];
  const right = posts[posts.length - 1];
  // Beams: rows solid from post to post.
  const solid = [];
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = left; x <= right; x++) if (data[(y * width + x) * 4 + 3] > 128) n++;
    solid.push(n > (right - left + 1) * 0.9);
  }
  const beams = [];
  for (let y = 0; y < height; y++) {
    if (!solid[y]) continue;
    let e = y;
    while (e + 1 < height && solid[e + 1]) e++;
    beams.push(Math.round((y + e) / 2));
    y = e;
  }
  // The bay that starts nearest the middle, with beams below it (the base keeps the ladder).
  let best = null;
  for (let i = 0; i + 2 < beams.length; i++) {
    const d = Math.abs(beams[i] / height - 0.42);
    if (!best || d < best.d) best = { d, a: beams[i], b: beams[i + 1] };
  }
  if (!best) throw new Error('scaffold: no lattice bay found');
  const slice = (y0, y1) => {
    const buf = Buffer.alloc(width * (y1 - y0) * 4);
    data.copy(buf, 0, y0 * width * 4, y1 * width * 4);
    return buf;
  };
  await webp(slice(0, best.a), width, best.a, join(outDir, 'scaffold-crown.webp'));
  await webp(slice(best.a, best.b), width, best.b - best.a, join(outDir, 'scaffold-shaft.webp'));
  await webp(slice(best.b, height), width, height - best.b, join(outDir, 'scaffold-base.webp'));
  const top = rows.findIndex(Boolean);
  return { width, crown: best.a, shaft: best.b - best.a, base: height - best.b, shaftLeft: left, shaftWidth: right - left + 1, apex: { x: (left + right) / 2, y: top } };
}

async function shared(dir, outDir, manifest, old) {
  const files = await readdir(dir).catch(() => []);
  let built = 0;
  await mkdir(outDir, { recursive: true });
  for (const file of files) {
    const m = /^((cracks|holes|scorch)(-[a-z0-9]+)?|scaffold|grass|rocks|trees|farm2?)\.(png|jpe?g|webp)$/i.exec(file);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const input = join(dir, file);
    const probe = join(outDir, name === 'scaffold' ? 'scaffold-shaft.webp' : `${name}.webp`);
    const key = name === 'scaffold' ? 'scaffold' : name;
    // Scenery sheets (grass, rocks, trees, farm): four props each, standing on the bottom of their frame.
    const group = name === 'scaffold' ? null : m[2] ? 'decals' : 'props';
    const into = group ? (manifest[group] ??= {}) : manifest;
    const was = group ? old[group]?.[name] : old.scaffold;
    if (was && (await mtime(probe)) >= (await mtime(input))) {
      into[key] = was;
      continue;
    }
    into[key] = !group ? await scaffold(input, outDir) : await decalSheet(input, outDir, name, group === 'props' ? 'props' : m[2].toLowerCase());
    built++;
  }
  return built;
}

async function ruins(input, outDir) {
  const { data, info } = await load(input, RUINS_WIDTH);
  await webp(data, info.width, info.height, join(outDir, 'ruins.webp'));
  return { width: info.width, height: info.height };
}

export async function buildCastles(source, target) {
  const root = join(source, 'castles');
  const heroes = await readdir(root, { withFileTypes: true }).catch(() => []);
  const ornamentKinds = JSON.parse(await readFile(join(root, 'ornaments.json'), 'utf8').catch(() => '{}'));
  const slices = JSON.parse(await readFile(join(root, 'slices.json'), 'utf8').catch(() => '{}'));
  const manifestPath = join(target, 'castles', 'manifest.json');
  const old = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));
  const manifest = {};
  let built = 0;
  const common = {};
  built += await shared(join(root, '_comun'), join(target, 'castles', '_comun'), common, old._comun ?? {});
  const scenery = {};
  built += await shared(join(root, '_escenario'), join(target, 'castles', '_escenario'), scenery, old._escenario ?? {});
  if (Object.keys(scenery).length) manifest._escenario = scenery;
  if (Object.keys(common).length) manifest._comun = common;
  for (const dir of heroes) {
    if (!dir.isDirectory() || dir.name.startsWith('_')) continue;
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
      if (old[hero]?.[piece] && (piece === 'ruins' || old[hero][piece].light !== undefined) && (await mtime(probe)) >= stale) {
        manifest[hero][piece] = old[hero][piece];
        continue;
      }
      manifest[hero][piece] = piece === 'ruins' ? await ruins(input, outDir) : await stacked(input, outDir, piece, slices[`${hero}/${piece}`]);
      built++;
    }
    // A shaft lit straight on takes the side most of the castle is lit from, so its ornaments agree with the rest.
    const pieces = Object.values(manifest[hero] ?? {}).filter((p) => p && typeof p.light === 'number');
    const most = Math.sign(pieces.reduce((n, p) => n + p.light, 0));
    for (const p of pieces) if (p.light === 0) p.light = most;
    // Wall ornaments: 3 x 3 sheets of windows, banners, lanterns and ivy laid over the shafts,
    // brought to the colour of the hero's stone (so after the pieces, whose shafts give it).
    const stone = await stoneColour(join(outDir, 'keep-shaft.webp'));
    for (const file of files.sort()) {
      const m = /^(ornaments(-[a-z0-9]+)?)\.(png|jpe?g|webp)$/i.exec(file);
      if (!m) continue;
      const name = m[1].toLowerCase();
      const input = join(root, hero, file);
      manifest[hero] ??= {};
      const list = (manifest[hero].ornaments ??= []);
      const was = old[hero]?.ornaments?.find((o) => o.name === name);
      const stale = Math.max(await mtime(input), await mtime(join(root, 'ornaments.json')), await mtime(join(outDir, 'keep-shaft.webp')));
      if (was?.v === ORNAMENT_VERSION && (await mtime(join(outDir, `${name}.webp`))) >= stale) {
        list.push(was);
        continue;
      }
      list.push(await ornamentSheet(input, outDir, name, ornamentKinds[`${hero}/${name}`] ?? [], stone));
      built++;
    }
  }
  await mkdir(join(target, 'castles'), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1));
  return built;
}
