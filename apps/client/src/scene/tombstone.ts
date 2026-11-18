import type { Graphics } from 'pixi.js';
import type { CastleStyle, Signature } from './castleStyles';

/**
 * The gravestone that rises on a fallen castle. Each hero has its own: the
 * stone of their castle, a headstone shape and an emblem in their metal,
 * with their banner draped over it. Drawn around (0, 0) = bottom centre,
 * `w` wide and about 1.4 `w` tall.
 */

function mix(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s;
  return ch(16) | ch(8) | ch(0);
}

type Shape = 'slab' | 'gothic' | 'arch' | 'cross' | 'shield';

/** Headstone shape and emblem for each castle's signature detail (one per hero). */
const SHAPE: Record<Signature, Shape> = {
  crane: 'slab',
  braziers: 'gothic',
  orb: 'arch',
  smoke: 'arch',
  lanterns: 'cross',
  shield: 'shield',
};

/** Outline of the headstone, as a polygon (bottom centre at 0, 0). */
function outline(shape: Shape, w: number, h: number): number[] {
  const x = w / 2;
  const pts: number[] = [];
  const arc = (cx: number, cy: number, r: number, from: number, to: number, steps = 14): void => {
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  switch (shape) {
    case 'slab': {
      // A builder's block: square shoulders, a bevelled top.
      const b = w * 0.16;
      pts.push(-x, 0, -x, -h + b, -x + b, -h, x - b, -h, x, -h + b, x, 0);
      break;
    }
    case 'gothic':
      // A pointed soldier's stone.
      pts.push(-x, 0, -x, -h * 0.66);
      pts.push(-x * 0.55, -h * 0.88, 0, -h, x * 0.55, -h * 0.88);
      pts.push(x, -h * 0.66, x, 0);
      break;
    case 'arch':
      pts.push(-x, 0);
      arc(0, -h + x, x, Math.PI, Math.PI * 2);
      pts.push(x, 0);
      break;
    case 'cross': {
      // A thieves' cross: a narrow shaft with short arms.
      const s = w * 0.2;
      const arm = -h * 0.72;
      pts.push(-s, 0, -s, arm + s, -x, arm + s, -x, arm - s, -s, arm - s, -s, -h, s, -h, s, arm - s, x, arm - s, x, arm + s, s, arm + s, s, 0);
      break;
    }
    case 'shield':
      pts.push(-x, -h * 0.25, -x, -h, x, -h, x, -h * 0.25);
      arc(0, -h * 0.25, x, 0, Math.PI / 2, 7);
      pts.push(0, 0);
      arc(0, -h * 0.25, x, Math.PI / 2, Math.PI, 7);
      break;
  }
  return pts;
}

/** The hero's mark carved and inlaid in metal, centred on (cx, cy), about `s` across. */
function emblem(g: Graphics, sig: Signature, cx: number, cy: number, s: number, color: number, line: number): void {
  const stroke = { color, width: Math.max(1.5, s * 0.11), cap: 'round' as const, join: 'round' as const };
  switch (sig) {
    case 'crane': {
      // Set square and compass.
      g.poly([cx - s * 0.45, cy + s * 0.4, cx - s * 0.45, cy - s * 0.35, cx + s * 0.3, cy + s * 0.4]).stroke(stroke);
      g.moveTo(cx + s * 0.1, cy - s * 0.5).lineTo(cx - s * 0.1, cy + s * 0.45).stroke(stroke);
      g.moveTo(cx + s * 0.1, cy - s * 0.5).lineTo(cx + s * 0.4, cy + s * 0.45).stroke(stroke);
      g.circle(cx + s * 0.1, cy - s * 0.5, s * 0.08).fill({ color });
      break;
    }
    case 'braziers':
      // Crossed swords.
      for (const d of [-1, 1]) {
        g.moveTo(cx - d * s * 0.45, cy + s * 0.45).lineTo(cx + d * s * 0.42, cy - s * 0.45).stroke(stroke);
        g.moveTo(cx - d * s * 0.5, cy + s * 0.18).lineTo(cx - d * s * 0.2, cy + s * 0.5).stroke(stroke);
      }
      break;
    case 'orb': {
      // Crescent and star.
      g.circle(cx - s * 0.08, cy, s * 0.42).fill({ color });
      g.circle(cx + s * 0.08, cy - s * 0.06, s * 0.36).fill({ color: line });
      const star: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.08 : s * 0.2;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        star.push(cx + s * 0.22 + Math.cos(a) * r, cy - s * 0.02 + Math.sin(a) * r);
      }
      g.poly(star).fill({ color });
      break;
    }
    case 'smoke':
      // A round-bottomed flask.
      g.circle(cx, cy + s * 0.18, s * 0.3).stroke(stroke);
      g.moveTo(cx - s * 0.1, cy - s * 0.1).lineTo(cx - s * 0.1, cy - s * 0.42).stroke(stroke);
      g.moveTo(cx + s * 0.1, cy - s * 0.1).lineTo(cx + s * 0.1, cy - s * 0.42).stroke(stroke);
      g.moveTo(cx - s * 0.18, cy - s * 0.44).lineTo(cx + s * 0.18, cy - s * 0.44).stroke(stroke);
      g.circle(cx, cy + s * 0.22, s * 0.17).fill({ color, alpha: 0.75 });
      break;
    case 'lanterns':
      // A dagger, point down.
      g.poly([cx - s * 0.07, cy - s * 0.18, cx + s * 0.07, cy - s * 0.18, cx, cy + s * 0.5]).fill({ color });
      g.moveTo(cx - s * 0.24, cy - s * 0.2).lineTo(cx + s * 0.24, cy - s * 0.2).stroke(stroke);
      g.moveTo(cx, cy - s * 0.22).lineTo(cx, cy - s * 0.45).stroke(stroke);
      g.circle(cx, cy - s * 0.5, s * 0.06).fill({ color });
      break;
    case 'shield':
      // A small shield with a cross.
      g.poly([cx - s * 0.32, cy - s * 0.4, cx + s * 0.32, cy - s * 0.4, cx + s * 0.32, cy, cx, cy + s * 0.45, cx - s * 0.32, cy]).stroke(stroke);
      g.moveTo(cx, cy - s * 0.3).lineTo(cx, cy + s * 0.28).stroke(stroke);
      g.moveTo(cx - s * 0.2, cy - s * 0.1).lineTo(cx + s * 0.2, cy - s * 0.1).stroke(stroke);
      break;
  }
}

export function drawTombstone(g: Graphics, style: CastleStyle, banner: number, w: number): void {
  g.clear();
  const shape = SHAPE[style.signature];
  const h = w * (shape === 'cross' ? 1.55 : 1.35);
  const [r, gr, b] = style.keepStone.base;
  const stoneColor = mix((r << 16) | (gr << 8) | b, 0x8a8a90, 0.25);
  const dark = mix(stoneColor, 0x000000, 0.45);
  const face = outline(shape, w, h);

  // Shadow, plinth and the stone itself.
  g.ellipse(0, 2, w * 0.85, w * 0.14).fill({ color: 0x000000, alpha: 0.35 });
  g.roundRect(-w * 0.62, -w * 0.12, w * 1.24, w * 0.16, 2).fill({ color: dark });
  g.poly(face).fill({ color: stoneColor });
  g.poly(face).stroke({ color: dark, width: Math.max(1.5, w * 0.045), join: 'round' });
  // Light from the upper left, moss at the foot.
  const lit = outline(shape, w * 0.84, h * 0.92).map((v, i) => (i % 2 ? v - h * 0.03 : v - w * 0.04));
  g.poly(lit).fill({ color: mix(stoneColor, 0xffffff, 0.18), alpha: 0.45 });
  for (let i = 0; i < 7; i++) {
    const mx = (i / 6 - 0.5) * w * 0.9;
    g.ellipse(mx, -w * 0.12, w * (0.08 + (i % 3) * 0.03), w * 0.05).fill({ color: i % 2 ? 0x5f7a3a : 0x47602c, alpha: 0.9 });
  }

  // The hero's emblem and two lines of worn epitaph.
  const emblemY = shape === 'cross' ? -h * 0.72 : shape === 'shield' ? -h * 0.66 : -h * 0.62;
  const emblemS = shape === 'cross' ? w * 0.34 : w * 0.5;
  emblem(g, style.signature, 0, emblemY, emblemS, style.metal, stoneColor);
  if (shape !== 'cross') {
    for (const [y, span] of [[-h * 0.36, 0.5], [-h * 0.27, 0.36]] as const) {
      g.moveTo(-w * span * 0.5, y).lineTo(w * span * 0.5, y).stroke({ color: dark, width: Math.max(1, w * 0.04), cap: 'round' });
    }
  }

  // The hero's banner draped over the left shoulder, its two tails hanging down the side.
  const x = w / 2;
  const sy = shape === 'cross' ? -h * 0.72 : shape === 'gothic' ? -h * 0.62 : shape === 'arch' ? -h + x * 0.55 : -h * 0.86;
  const sx = shape === 'cross' ? -x : shape === 'arch' ? -x * 0.82 : -x;
  const band = w * 0.13;
  const shade = mix(banner, 0x000000, 0.3);
  g.poly([sx - band * 0.4, sy + band, sx + w * 0.3, sy - band * 1.1, sx + w * 0.36, sy - band * 0.1, sx + band * 0.4, sy + band * 1.9]).fill({ color: banner });
  for (const [dx, len, color] of [[-band * 0.35, h * 0.34, banner], [band * 0.5, h * 0.26, shade]] as const) {
    const top = sy + band * 0.9;
    const bx = sx + dx;
    g.poly([bx - band * 0.45, top, bx + band * 0.45, top, bx + band * 0.5, top + len, bx, top + len - band * 0.6, bx - band * 0.5, top + len]).fill({ color });
  }
}
