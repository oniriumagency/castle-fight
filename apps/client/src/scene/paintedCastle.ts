import { Assets, Container, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { artUrl } from '../ui/assets';

/**
 * Painted castles: each hero's Keep, back tower, Wall and ruins painted like
 * a card illustration, cut by `scripts/build-castles.mjs` into a crown, a
 * shaft that repeats and a base, so a tower can stand at any height. A hero
 * without paintings keeps the castle drawn in `castle.ts`.
 */

export interface StackedMeta {
  /** Width of every band, in source px. */
  width: number;
  crown: number;
  shaft: number;
  base: number;
  shaftLeft: number;
  shaftWidth: number;
  /** Highest point (flagpole tip or spire), in source px from the crown's top-left. */
  apex: { x: number; y: number };
}

export interface StackedPiece {
  meta: StackedMeta;
  crown: Texture;
  shaft: Texture;
  base: Texture;
}

export interface PaintedCastle {
  keep: StackedPiece;
  /** The back towers, furthest first: each has its own role and look. */
  towers: (StackedPiece | null)[];
  wall: StackedPiece | null;
  ruins: Texture | null;
}

type Piece = 'keep' | 'tower1' | 'tower2' | 'tower' | 'wall';
type Manifest = Record<string, Partial<Record<Piece, StackedMeta>> & { ruins?: { width: number; height: number } }>;

let manifest: Promise<Manifest> | null = null;
const sets = new Map<string, Promise<PaintedCastle | null>>();

function loadManifest(): Promise<Manifest> {
  manifest ??= fetch(`${import.meta.env.BASE_URL}art/castles/manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : {}))
    .catch(() => ({}));
  return manifest;
}

async function texture(path: string): Promise<Texture | null> {
  try {
    const t = await Assets.load<Texture>({ src: artUrl(path), parser: 'loadTextures' });
    return t?.width ? t : null;
  } catch {
    return null;
  }
}

async function stacked(hero: string, piece: Piece, meta: StackedMeta | undefined): Promise<StackedPiece | null> {
  if (!meta) return null;
  const [crown, shaft, base] = await Promise.all(['crown', 'shaft', 'base'].map((band) => texture(`castles/${hero}/${piece}-${band}.webp`)));
  if (!crown || !shaft || !base) return null;
  return { meta, crown, shaft, base };
}

/** The painted castle of a hero, or null while it is not painted (needs at least the Keep). */
export function paintedCastle(hero: string | null): Promise<PaintedCastle | null> {
  if (!hero) return Promise.resolve(null);
  let set = sets.get(hero);
  if (!set) {
    set = loadManifest().then(async (m) => {
      const entry = m[hero];
      if (!entry?.keep) return null;
      const [keep, tower1, tower2, tower, wall, ruins] = await Promise.all([
        stacked(hero, 'keep', entry.keep),
        stacked(hero, 'tower1', entry.tower1),
        stacked(hero, 'tower2', entry.tower2),
        stacked(hero, 'tower', entry.tower),
        stacked(hero, 'wall', entry.wall),
        entry.ruins ? texture(`castles/${hero}/ruins.webp`) : Promise.resolve(null),
      ]);
      return keep ? { keep, towers: [tower1 ?? tower, tower2 ?? tower], wall, ruins } : null;
    });
    sets.set(hero, set);
  }
  return set;
}

/** Where the crown of a laid-out stack ends up, relative to the top of its body. */
export interface StackFit {
  /** Height of the crown above the body top (scene px). */
  crown: number;
  /** Apex offset from the body top (negative: above) and from the centre. */
  apexY: number;
  apexX: number;
}

/**
 * A painted tower or wall: the base at the ground, the shaft repeated up to
 * the body's height, the crown on top. Its body is exactly `h` tall, like the
 * drawn towers, so values and anchors do not change.
 */
export class Stack {
  readonly root = new Container();
  private readonly crown: Sprite;
  private readonly shaft: TilingSprite;
  private readonly base: Sprite;
  /** The base cropped to its lower part when the body is shorter than it. */
  private readonly baseCrop: Texture;
  private cropKey = -1;

  constructor(readonly piece: StackedPiece) {
    this.crown = new Sprite(piece.crown);
    this.shaft = new TilingSprite({ texture: piece.shaft, width: 1, height: 1 });
    this.baseCrop = new Texture({ source: piece.base.source, frame: new Rectangle(0, 0, piece.base.width, piece.base.height) });
    this.base = new Sprite(this.baseCrop);
    this.root.addChild(this.shaft, this.base, this.crown);
  }

  /**
   * Stands the stack at `cx` on `groundY` with a body `h` tall, scaled so the
   * shaft is `w` wide. `mirror` flips it (the right-hand castle, lit toward the middle).
   */
  layout(cx: number, groundY: number, w: number, h: number, mirror: boolean, crown: boolean): StackFit {
    const m = this.piece.meta;
    const k = w / m.shaftWidth;
    const W = m.width * k;
    // Local x: 0 is the shaft's centre.
    const left = -(m.shaftLeft + m.shaftWidth / 2) * k;
    this.root.position.set(cx, groundY);
    this.root.scale.set(mirror ? -1 : 1, 1);

    const baseH = m.base * k;
    const shown = Math.min(baseH, Math.max(0, h));
    // A body shorter than the base shows the base's top, sunk into the ground,
    // so it still meets the crown cleanly (windows and door are never cut in half from above).
    const rows = Math.max(1, Math.round(shown / k));
    if (rows !== this.cropKey) {
      this.cropKey = rows;
      const f = this.baseCrop.frame;
      f.x = 0;
      f.y = 0;
      f.width = m.width;
      f.height = rows;
      this.baseCrop.updateUvs();
      this.baseCrop.update();
    }
    this.base.visible = h > 0.5;
    this.base.position.set(left, -rows * k);
    this.base.width = W;
    this.base.height = rows * k;

    const shaftH = Math.max(0, h - baseH);
    this.shaft.visible = shaftH > 0.5;
    this.shaft.position.set(left, -h);
    this.shaft.width = W;
    this.shaft.height = Math.max(1, shaftH);
    this.shaft.tileScale.set(k);
    // Keep the courses anchored to the base so the stones do not slide as it grows.
    this.shaft.tilePosition.set(0, shaftH);

    const crownH = m.crown * k;
    this.crown.visible = crown && h > 0.5;
    this.crown.position.set(left, -h - crownH);
    this.crown.width = W;
    this.crown.height = crownH;

    const apexX = (left + m.apex.x * k) * (mirror ? -1 : 1);
    return { crown: crownH, apexY: -(m.crown - m.apex.y) * k, apexX };
  }

  /** Height of the base band for a shaft `w` wide (scene px). */
  baseHeight(w: number): number {
    return (this.piece.meta.base * w) / this.piece.meta.shaftWidth;
  }

  destroy(): void {
    this.baseCrop.destroy(false);
    this.root.destroy({ children: true });
  }
}
