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
  /** Which bands give off light of their own (a `-glow` copy exists). */
  glow?: { crown: boolean; base: boolean };
}

export interface StackedPiece {
  meta: StackedMeta;
  crown: Texture;
  shaft: Texture;
  base: Texture;
  crownGlow: Texture | null;
  baseGlow: Texture | null;
}

export interface PaintedCastle {
  keep: StackedPiece;
  /** The back towers, furthest first: each has its own role and look. */
  towers: (StackedPiece | null)[];
  wall: StackedPiece | null;
  ruins: Texture | null;
  /** Windows, banners, lanterns and ivy laid over the plain shafts as they grow. */
  ornaments: Texture[];
}

type Piece = 'keep' | 'tower1' | 'tower2' | 'tower' | 'wall' | 'scaffold';
type Manifest = Record<string, Partial<Record<Piece, StackedMeta>> & { ruins?: { width: number; height: number }; ornaments?: { name: string; frames: number[][] }[] }>;

let foot: Texture | null = null;

/** Dark at the ground, gone a little way up: the shade where stone meets earth. */
function footShade(): Texture {
  if (foot) return foot;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(10,8,6,0)');
  grad.addColorStop(0.6, 'rgba(10,8,6,0.22)');
  grad.addColorStop(1, 'rgba(10,8,6,0.6)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  foot = Texture.from(c);
  return foot;
}

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
  const [crownGlow, baseGlow] = await Promise.all([
    meta.glow?.crown ? texture(`castles/${hero}/${piece}-crown-glow.webp`) : Promise.resolve(null),
    meta.glow?.base ? texture(`castles/${hero}/${piece}-base-glow.webp`) : Promise.resolve(null),
  ]);
  return { meta, crown, shaft, base, crownGlow, baseGlow };
}

/** The painted castle of a hero, or null while it is not painted (needs at least the Keep). */
export function paintedCastle(hero: string | null): Promise<PaintedCastle | null> {
  if (!hero) return Promise.resolve(null);
  let set = sets.get(hero);
  if (!set) {
    set = loadManifest().then(async (m) => {
      const entry = m[hero];
      if (!entry?.keep) return null;
      const sheets = await Promise.all(
        (entry.ornaments ?? []).map(async (o) => {
          const t = await texture(`castles/${hero}/${o.name}.webp`);
          return t ? o.frames.map(([x, y, w, h]) => new Texture({ source: t.source, frame: new Rectangle(x!, y!, w!, h!) })) : [];
        }),
      );
      const [keep, tower1, tower2, tower, wall, ruins] = await Promise.all([
        stacked(hero, 'keep', entry.keep),
        stacked(hero, 'tower1', entry.tower1),
        stacked(hero, 'tower2', entry.tower2),
        stacked(hero, 'tower', entry.tower),
        stacked(hero, 'wall', entry.wall),
        entry.ruins ? texture(`castles/${hero}/ruins.webp`) : Promise.resolve(null),
      ]);
      return keep ? { keep, towers: [tower1 ?? tower, tower2 ?? tower], wall, ruins, ornaments: sheets.flat() } : null;
    });
    sets.set(hero, set);
  }
  return set;
}

export type ScarKind = 'cracks' | 'holes' | 'scorch';

/** What every painted castle shares: damage decals and the masons' scaffold. */
export interface CastleKit {
  decals: Record<ScarKind, Texture[]>;
  scaffold: StackedPiece | null;
}

let kit: Promise<CastleKit | null> | null = null;

/** The shared decals and scaffold (null when none are painted). */
export function castleKit(): Promise<CastleKit | null> {
  kit ??= loadManifest().then(async (m) => {
    const common = (m as unknown as Record<string, { decals?: Record<string, { kind: ScarKind; frames: number[][] }>; scaffold?: StackedMeta }>)._comun;
    if (!common) return null;
    const decals: Record<ScarKind, Texture[]> = { cracks: [], holes: [], scorch: [] };
    await Promise.all(
      Object.entries(common.decals ?? {}).map(async ([name, sheet]) => {
        const t = await texture(`castles/_comun/${name}.webp`);
        if (!t) return;
        for (const [x, y, w, h] of sheet.frames) decals[sheet.kind]?.push(new Texture({ source: t.source, frame: new Rectangle(x, y, w, h) }));
      }),
    );
    const scaffold = await stacked('_comun', 'scaffold', common.scaffold);
    return { decals, scaffold };
  });
  return kit;
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
  /** Shade gathering at the foot, where the stones meet the earth. */
  private readonly foot = new Sprite(footShade());
  /** Windows, fires and crystals, added on top and made to flicker. */
  private readonly crownGlow: Sprite | null;
  private readonly baseGlow: Sprite | null;
  private readonly baseGlowCrop: Texture | null;
  /** The base cropped to its lower part when the body is shorter than it. */
  private readonly baseCrop: Texture;
  private cropKey = -1;
  /** Ornaments on the shaft, one slot per course of the climb; made when first reached. */
  private ornaments: Texture[] = [];
  private seed = 0;
  private readonly slots: (Sprite | null)[] = [];
  private readonly ornamentLayer = new Container();

  constructor(readonly piece: StackedPiece) {
    this.crown = new Sprite(piece.crown);
    this.shaft = new TilingSprite({ texture: piece.shaft, width: 1, height: 1 });
    // `dynamic`: the frame changes as the tower grows, and a Sprite only re-reads the size of a
    // dynamic texture. Without it the base kept the size it had on its first frame (one row when
    // the castle rose from the ground) and the tower floated with no base.
    this.baseCrop = new Texture({ source: piece.base.source, frame: new Rectangle(0, 0, piece.base.width, piece.base.height), dynamic: true });
    this.base = new Sprite(this.baseCrop);
    this.root.addChild(this.shaft, this.base, this.crown, this.foot);
    this.root.addChild(this.ornamentLayer);
    this.crownGlow = piece.crownGlow ? new Sprite(piece.crownGlow) : null;
    this.baseGlowCrop = piece.baseGlow ? new Texture({ source: piece.baseGlow.source, frame: new Rectangle(0, 0, piece.baseGlow.width, piece.baseGlow.height), dynamic: true }) : null;
    this.baseGlow = this.baseGlowCrop ? new Sprite(this.baseGlowCrop) : null;
    for (const g of [this.baseGlow, this.crownGlow]) {
      if (!g) continue;
      g.blendMode = 'add';
      this.root.addChild(g);
    }
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
      if (this.baseGlowCrop) {
        const g = this.baseGlowCrop.frame;
        g.x = 0;
        g.y = 0;
        g.width = m.width;
        g.height = Math.min(rows, this.piece.baseGlow!.height);
        this.baseGlowCrop.updateUvs();
        this.baseGlowCrop.update();
      }
    }
    this.base.visible = h > 0.5;
    this.base.position.set(left, -rows * k);
    this.base.width = W;
    this.base.height = rows * k;

    this.foot.visible = this.base.visible;
    this.foot.width = w * 1.25;
    this.foot.height = Math.min(h, w * 0.4);
    this.foot.position.set(-w * 0.625, -this.foot.height);

    const shaftH = Math.max(0, h - baseH);
    this.shaft.visible = shaftH > 0.5;
    this.shaft.position.set(left, -h);
    this.shaft.width = W;
    this.shaft.height = Math.max(1, shaftH);
    this.shaft.tileScale.set(k);
    // Keep the courses anchored to the base so the stones do not slide as it grows.
    this.shaft.tilePosition.set(0, shaftH);

    if (this.baseGlow) {
      this.baseGlow.visible = this.base.visible;
      this.baseGlow.position.copyFrom(this.base.position);
      this.baseGlow.width = W;
      this.baseGlow.height = rows * k;
    }

    this.layoutOrnaments(w, h, baseH, m.crown * k);

    const crownH = m.crown * k;
    this.crown.visible = crown && h > 0.5;
    this.crown.position.set(left, -h - crownH);
    this.crown.width = W;
    this.crown.height = crownH;

    if (this.crownGlow) {
      this.crownGlow.visible = this.crown.visible;
      this.crownGlow.position.copyFrom(this.crown.position);
      this.crownGlow.width = W;
      this.crownGlow.height = crownH;
    }

    const apexX = (left + m.apex.x * k) * (mirror ? -1 : 1);
    return { crown: crownH, apexY: -(m.crown - m.apex.y) * k, apexX };
  }

  /**
   * Scatters these ornaments up the shaft (seeded, so the same tower always
   * wears the same ones). `density`: share of slots that get one.
   */
  setOrnaments(textures: Texture[], seed: number, density = 0.55): void {
    this.ornaments = textures;
    this.seed = seed;
    this.density = density;
    for (const s of this.slots) s?.destroy();
    this.slots.length = 0;
  }

  private density = 0.55;

  private layoutOrnaments(w: number, h: number, baseH: number, crownH: number): void {
    if (!this.ornaments.length) return;
    // One slot every ~0.95 shaft widths above the base; the top one stays clear of the crown.
    const step = w * 0.95;
    const top = h - Math.min(crownH * 0.15, w * 0.2);
    const count = Math.max(0, Math.floor((h - baseH) / step) + 1);
    for (let i = 0; i < Math.max(count, this.slots.length); i++) {
      const r = (n: number): number => {
        const x = Math.sin((this.seed + 1) * 127.1 + i * 311.7 + n * 74.7) * 43758.5453;
        return x - Math.floor(x);
      };
      const y = baseH + step * (i + 0.5) + (r(1) - 0.5) * step * 0.3;
      let sp = this.slots[i];
      if (sp === undefined) {
        sp = r(0) < this.density ? new Sprite(this.ornaments[Math.floor(r(2) * this.ornaments.length)]!) : null;
        if (sp) {
          sp.anchor.set(0.5);
          this.ornamentLayer.addChild(sp);
        }
        this.slots[i] = sp;
      }
      if (!sp) continue;
      const t = sp.texture;
      // Long things (banners, ivy) hang longer; the rest sit within the shaft.
      const k = Math.min((w * 0.5) / t.width, (w * (t.height > t.width * 1.6 ? 0.95 : 0.55)) / t.height);
      sp.scale.set(k);
      const half = (t.height * k) / 2;
      sp.position.set((r(3) - 0.5) * w * 0.3, -y);
      // Shown only while the courses it hangs on stand.
      sp.visible = y + half < top && y - half > baseH * 0.9;
    }
  }

  /** How bright the painting's own lights burn (0 out, 1 as painted, more for a bloom). */
  setGlow(crown: number, base: number): void {
    if (this.crownGlow) this.crownGlow.alpha = crown;
    if (this.baseGlow) this.baseGlow.alpha = base;
  }

  /** Height of the base band for a shaft `w` wide (scene px). */
  baseHeight(w: number): number {
    return (this.piece.meta.base * w) / this.piece.meta.shaftWidth;
  }

  destroy(): void {
    this.baseCrop.destroy(false);
    this.baseGlowCrop?.destroy(false);
    this.root.destroy({ children: true });
  }
}
