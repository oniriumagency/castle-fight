import { Texture } from 'pixi.js';

/**
 * Procedural textures for the battlefield, painted once on 2D canvases:
 * stone courses for keeps and walls, sky gradients, soft cloud puffs and
 * radial glows. Nothing here comes from another game.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Deterministic pseudo-random so textures look the same on every load. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StoneStyle {
  base: [number, number, number];
  variance: number;
  mortar: string;
  seed: number;
  brickW: number;
  brickH: number;
}

export const KEEP_STONE: StoneStyle = { base: [214, 196, 160], variance: 26, mortar: '#6d5f4a', seed: 7, brickW: 34, brickH: 15 };
export const WALL_STONE: StoneStyle = { base: [150, 140, 128], variance: 22, mortar: '#4a433b', seed: 11, brickW: 40, brickH: 17 };

/** Tileable brickwork. Width and height are whole multiples of a brick so it repeats cleanly. */
export function stoneTexture(style: StoneStyle): Texture {
  const cols = 4;
  const rows = 6;
  const w = style.brickW * cols;
  const h = style.brickH * rows;
  const [c, g] = canvas(w, h);
  const r = rand(style.seed);
  g.fillStyle = style.mortar;
  g.fillRect(0, 0, w, h);
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 ? style.brickW / 2 : 0;
    for (let col = -1; col <= cols; col++) {
      const x = col * style.brickW + offset;
      const y = row * style.brickH;
      const v = (r() - 0.5) * style.variance;
      const [cr, cg, cb] = style.base.map((ch) => Math.max(0, Math.min(255, ch + v + (r() - 0.5) * 6)));
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.fillRect(x + 1, y + 1, style.brickW - 2, style.brickH - 2);
      // Light from the upper left: bright top edge, dark bottom edge.
      g.fillStyle = 'rgba(255,255,240,0.18)';
      g.fillRect(x + 1, y + 1, style.brickW - 2, 2);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x + 1, y + style.brickH - 3, style.brickW - 2, 2);
      // Weathering speckles.
      for (let i = 0; i < 10; i++) {
        g.fillStyle = r() > 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
        g.fillRect(x + 2 + r() * (style.brickW - 5), y + 2 + r() * (style.brickH - 5), 1 + r() * 2, 1 + r() * 2);
      }
    }
  }
  const texture = Texture.from(c);
  texture.source.addressMode = 'repeat';
  return texture;
}

/** Vertical shading for a tower: dark edges, lit left side. Stretched over the stone. */
export function towerShadeTexture(): Texture {
  const [c, g] = canvas(64, 4);
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,240,210,0.10)');
  grad.addColorStop(0.18, 'rgba(255,240,210,0.0)');
  grad.addColorStop(0.6, 'rgba(10,8,20,0.10)');
  grad.addColorStop(1, 'rgba(10,8,20,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  return Texture.from(c);
}

/** Top to bottom gradient used for skies. */
export function gradientTexture(stops: [number, string][], height = 256): Texture {
  const [c, g] = canvas(4, height);
  const grad = g.createLinearGradient(0, 0, 0, height);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, height);
  return Texture.from(c);
}

/** Soft round glow (sun, magic, light pools). */
export function glowTexture(color = '255,230,170', size = 128): Texture {
  const [c, g] = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${color},1)`);
  grad.addColorStop(0.35, `rgba(${color},0.45)`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return Texture.from(c);
}

/** A painterly cloud made of overlapping soft puffs. */
export function cloudTexture(seed: number): Texture {
  const w = 512;
  const h = 160;
  const [c, g] = canvas(w, h);
  const r = rand(seed);
  for (let i = 0; i < 22; i++) {
    const x = 60 + r() * (w - 120);
    const y = 60 + r() * 50 - Math.abs(x - w / 2) * 0.08;
    const rad = 30 + r() * 46;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  return Texture.from(c);
}

/** Small square particle with soft edges, tinted at runtime. */
export function particleTexture(): Texture {
  return glowTexture('255,255,255', 32);
}

/** A chunk of rubble for debris. */
export function rubbleTexture(): Texture {
  const [c, g] = canvas(16, 16);
  g.fillStyle = '#b8a582';
  g.beginPath();
  g.moveTo(2, 5);
  g.lineTo(9, 1);
  g.lineTo(15, 6);
  g.lineTo(12, 14);
  g.lineTo(4, 13);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(4, 9, 9, 4);
  return Texture.from(c);
}

export { rand as seededRandom };
