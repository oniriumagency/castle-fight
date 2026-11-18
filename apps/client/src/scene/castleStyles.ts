import { Texture } from 'pixi.js';
import { stoneTexture, type StoneStyle } from './textures';

/**
 * The look of each hero's castle: stone, roofs, parapets, the towers that
 * stand behind the Keep and one signature detail. The renderer in
 * `castle.ts` reads this; adding a hero only means adding an entry here.
 *
 * Every castle reads the same way: the tall front tower is the Keep, the
 * curtain wall on the enemy side is the Wall, and the towers behind the
 * Keep grow and fall with it so it always stays the tallest.
 */

export type RoofKind = 'cone' | 'spire' | 'lowcone' | 'dome' | 'onion' | 'shingle' | 'flat';
export type ParapetKind = 'merlons' | 'machicolated' | 'swallow' | 'hoarding' | 'cornice' | 'round';
export type WallTop = 'merlons' | 'swallow' | 'palisade' | 'crystal' | 'rail' | 'shieldwall';
export type WindowKind = 'arch' | 'slit' | 'round' | 'lancet' | 'square';
export type Signature = 'crane' | 'braziers' | 'orb' | 'smoke' | 'lanterns' | 'shield';

export interface TowerSpec {
  /** Centre offset from the Keep, in Keep widths, away from the enemy (positive = further back). */
  offset: number;
  /** Width in Keep widths. */
  width: number;
  /** Height as a share of the Keep's height. */
  ratio: number;
  roof: RoofKind;
  parapet: ParapetKind;
  round?: boolean;
  /** Draw it in front of the Keep instead of behind. */
  front?: boolean;
  /** Small pennant on top. */
  pennant?: boolean;
}

export interface CastleStyle {
  id: string;
  keepStone: StoneStyle;
  wallStone: StoneStyle;
  /** Light stone of parapets and cornices. */
  trim: number;
  trimShade: number;
  roof: number;
  roofShade: number;
  /** Finials, rings and fittings. */
  metal: number;
  window: number;
  windowCore: number;
  windowKind: WindowKind;
  keep: { roof: RoofKind; parapet: ParapetKind; round?: boolean };
  towers: TowerSpec[];
  wall: WallTop;
  /** Wall width in Keep widths. */
  wallWidth: number;
  signature: Signature;
  /** Mound under the castle. */
  ground: [number, number, number];
  wood: number;
}

const stone = (base: [number, number, number], mortar: string, seed: number, brickW: number, brickH: number, variance = 24): StoneStyle => ({
  base,
  variance,
  mortar,
  seed,
  brickW,
  brickH,
});

export const CASTLE_STYLES: Record<string, CastleStyle> = {
  /** Pale sandstone, tall amber roofs, a builder's crane: a castle always under construction. */
  arquitecta: {
    id: 'arquitecta',
    keepStone: stone([226, 206, 166], '#7a6649', 7, 34, 15, 20),
    wallStone: stone([196, 178, 142], '#5f4f3a', 11, 40, 17, 20),
    trim: 0xf3e6c6,
    trimShade: 0x9c8664,
    roof: 0xc8812e,
    roofShade: 0x6e3c14,
    metal: 0xe3b656,
    window: 0xffc56a,
    windowCore: 0xff8a3a,
    windowKind: 'arch',
    keep: { roof: 'cone', parapet: 'machicolated' },
    towers: [
      { offset: 1.32, width: 0.46, ratio: 0.44, roof: 'cone', parapet: 'cornice', pennant: true },
      { offset: 0.78, width: 0.62, ratio: 0.7, roof: 'cone', parapet: 'merlons' },
    ],
    wall: 'merlons',
    wallWidth: 0.78,
    signature: 'crane',
    ground: [0x3a3426, 0x5a5038, 0x75684a],
    wood: 0x7a5232,
  },
  /** Dark granite, flat war-like battlements, long crimson banners and fire braziers. */
  mariscal: {
    id: 'mariscal',
    keepStone: stone([118, 110, 106], '#2b2624', 21, 44, 19, 22),
    wallStone: stone([98, 92, 90], '#221e1c', 23, 48, 20, 20),
    trim: 0x9a918a,
    trimShade: 0x3a3330,
    roof: 0x3d3a40,
    roofShade: 0x17151a,
    metal: 0xc9a050,
    window: 0xff9a40,
    windowCore: 0xd8461c,
    windowKind: 'slit',
    keep: { roof: 'flat', parapet: 'swallow' },
    towers: [
      { offset: 1.3, width: 0.5, ratio: 0.5, roof: 'lowcone', parapet: 'merlons', pennant: true },
      { offset: 0.8, width: 0.66, ratio: 0.74, roof: 'flat', parapet: 'machicolated' },
    ],
    wall: 'swallow',
    wallWidth: 0.86,
    signature: 'braziers',
    ground: [0x2a2420, 0x433a32, 0x574b40],
    wood: 0x4a3324,
  },
  /** Slender slate-blue towers with needle spires, glowing cyan windows and a floating orb. */
  hechicera: {
    id: 'hechicera',
    keepStone: stone([128, 134, 170], '#2a2c46', 31, 30, 16, 22),
    wallStone: stone([104, 108, 142], '#20223a', 33, 36, 17, 20),
    trim: 0xc4cae8,
    trimShade: 0x4a4f78,
    roof: 0x34388f,
    roofShade: 0x14163e,
    metal: 0x8ff0ff,
    window: 0x8ff0ff,
    windowCore: 0x3fb8ff,
    windowKind: 'lancet',
    keep: { roof: 'spire', parapet: 'cornice', round: true },
    towers: [
      { offset: 1.25, width: 0.4, ratio: 0.56, roof: 'spire', parapet: 'cornice', round: true },
      { offset: 0.72, width: 0.5, ratio: 0.78, roof: 'spire', parapet: 'cornice', round: true, pennant: true },
    ],
    wall: 'crystal',
    wallWidth: 0.74,
    signature: 'orb',
    ground: [0x262640, 0x3c3c5c, 0x4e4e72],
    wood: 0x3a2e48,
  },
  /** Red brick and green copper domes, brass pipes and a chimney puffing green smoke. */
  alquimista: {
    id: 'alquimista',
    keepStone: stone([170, 108, 82], '#4a3328', 41, 26, 12, 26),
    wallStone: stone([150, 98, 76], '#3e2a22', 43, 30, 13, 24),
    trim: 0xe0cfa6,
    trimShade: 0x8a7656,
    roof: 0x3f9a7a,
    roofShade: 0x1d5040,
    metal: 0xe3b656,
    window: 0x9dff9a,
    windowCore: 0x2fd27a,
    windowKind: 'round',
    keep: { roof: 'onion', parapet: 'cornice' },
    towers: [
      { offset: 1.3, width: 0.36, ratio: 0.62, roof: 'flat', parapet: 'cornice' },
      { offset: 0.78, width: 0.64, ratio: 0.66, roof: 'dome', parapet: 'round', round: true, pennant: true },
    ],
    wall: 'rail',
    wallWidth: 0.78,
    signature: 'smoke',
    ground: [0x2c3022, 0x46503a, 0x5a6648],
    wood: 0x6b4a2e,
  },
  /** Rough dark stone patched with timber, wooden hoardings, crooked shingle roofs and lanterns. */
  saboteadora: {
    id: 'saboteadora',
    keepStone: stone([104, 94, 90], '#221c1c', 51, 38, 17, 30),
    wallStone: stone([88, 80, 78], '#1c1818', 53, 42, 18, 28),
    trim: 0x8e8278,
    trimShade: 0x2e2826,
    roof: 0x5b2f6e,
    roofShade: 0x26122e,
    metal: 0xff8a2a,
    window: 0xffa040,
    windowCore: 0xe0561c,
    windowKind: 'square',
    keep: { roof: 'shingle', parapet: 'hoarding' },
    towers: [
      { offset: 1.28, width: 0.44, ratio: 0.5, roof: 'shingle', parapet: 'hoarding' },
      { offset: 0.76, width: 0.58, ratio: 0.72, roof: 'shingle', parapet: 'hoarding', pennant: true },
    ],
    wall: 'palisade',
    wallWidth: 0.8,
    signature: 'lanterns',
    ground: [0x241e1e, 0x3a302e, 0x4c403c],
    wood: 0x6b4a2e,
  },
  /** White limestone, massive round towers with low steel-blue roofs and a great tower shield. */
  guardian: {
    id: 'guardian',
    keepStone: stone([214, 216, 216], '#5c6268', 61, 46, 20, 18),
    wallStone: stone([188, 192, 194], '#4c5258', 63, 50, 22, 18),
    trim: 0xf2f5f6,
    trimShade: 0x8a949c,
    roof: 0x2c5e8a,
    roofShade: 0x112a44,
    metal: 0xdfe8f0,
    window: 0xffd890,
    windowCore: 0xffa040,
    windowKind: 'arch',
    keep: { roof: 'lowcone', parapet: 'round', round: true },
    towers: [
      { offset: 1.3, width: 0.56, ratio: 0.46, roof: 'lowcone', parapet: 'round', round: true, pennant: true },
      { offset: 0.8, width: 0.72, ratio: 0.66, roof: 'lowcone', parapet: 'round', round: true },
    ],
    wall: 'shieldwall',
    wallWidth: 0.9,
    signature: 'shield',
    ground: [0x2e3436, 0x4a5256, 0x606a6e],
    wood: 0x5a4632,
  },
};

export function castleStyle(hero: string | null | undefined): CastleStyle {
  return (hero && CASTLE_STYLES[hero]) || CASTLE_STYLES.arquitecta;
}

export interface StyleTextures {
  keepStone: Texture;
  wallStone: Texture;
}

const textureCache = new Map<string, StyleTextures>();

/** Stone textures of a style, painted once and shared by both castles. */
export function styleTextures(style: CastleStyle): StyleTextures {
  let t = textureCache.get(style.id);
  if (!t) {
    t = { keepStone: stoneTexture(style.keepStone), wallStone: stoneTexture(style.wallStone) };
    textureCache.set(style.id, t);
  }
  return t;
}

let flatShade: Texture | null = null;
let roundShade: Texture | null = null;

/**
 * Horizontal shading stretched over a tower: lit from the upper left. Round
 * towers get a cylinder (dark on both edges, a soft highlight off-centre).
 */
export function shadeTexture(round: boolean): Texture {
  if (round && roundShade) return roundShade;
  if (!round && flatShade) return flatShade;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  if (round) {
    grad.addColorStop(0, 'rgba(10,8,20,0.45)');
    grad.addColorStop(0.18, 'rgba(10,8,20,0.08)');
    grad.addColorStop(0.32, 'rgba(255,244,220,0.16)');
    grad.addColorStop(0.5, 'rgba(255,244,220,0.02)');
    grad.addColorStop(0.78, 'rgba(10,8,20,0.22)');
    grad.addColorStop(1, 'rgba(10,8,20,0.66)');
  } else {
    grad.addColorStop(0, 'rgba(255,240,210,0.12)');
    grad.addColorStop(0.16, 'rgba(255,240,210,0.0)');
    grad.addColorStop(0.62, 'rgba(10,8,20,0.10)');
    grad.addColorStop(1, 'rgba(10,8,20,0.55)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  const tex = Texture.from(c);
  if (round) roundShade = tex;
  else flatShade = tex;
  return tex;
}

/** Fades the foot of the towers into the mound and darkens their top edge. */
let footShade: Texture | null = null;
export function footTexture(): Texture {
  if (footShade) return footShade;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  footShade = Texture.from(c);
  return footShade;
}
