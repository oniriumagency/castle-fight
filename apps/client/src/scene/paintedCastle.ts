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
  /**
   * Height (source px) of the skirts: the painting just under the crown and just
   * over the base, laid over the ends of the shaft and fading into it so the cuts
   * do not show. Absent on pieces cut without them.
   */
  skirt?: number;
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
  /** Fades from the crown down into the shaft, and from the shaft down into the base. */
  skirtTop: Texture | null;
  skirtBottom: Texture | null;
}

export interface PaintedCastle {
  keep: StackedPiece;
  /** The back towers, furthest first: each has its own role and look. */
  towers: (StackedPiece | null)[];
  wall: StackedPiece | null;
  ruins: Texture | null;
  /** Windows, banners, lanterns and ivy laid over the plain shafts as they grow. */
  ornaments: Ornament[];
}

type Piece = 'keep' | 'tower1' | 'tower2' | 'tower' | 'wall' | 'scaffold';
type Manifest = Record<string, Partial<Record<Piece, StackedMeta>> & { ruins?: { width: number; height: number }; ornaments?: { name: string; frames: ([number, number, number, number, OrnamentKind] | null)[] }[] }>;

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
  const [skirtTop, skirtBottom] = meta.skirt
    ? await Promise.all(['top', 'bottom'].map((end) => texture(`castles/${hero}/${piece}-skirt-${end}.webp`)))
    : [null, null];
  return { meta, crown, shaft, base, crownGlow, baseGlow, skirtTop, skirtBottom };
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
          if (!t) return [];
          return o.frames.flatMap((f) => (f ? [{ tex: new Texture({ source: t.source, frame: new Rectangle(f[0], f[1], f[2], f[3]) }), kind: f[4] }] : []));
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

/**
 * How an ornament sits on a tower. win, deco: front-facing, on the shaft.
 * hang: hangs from its top (banner, ivy). edgeR / edgeL: seen from the side,
 * fixed to a wall on its left / right, so it sticks out of that edge.
 * bal: a balcony set under a window. balD: a balcony with its own door.
 */
export type OrnamentKind = 'win' | 'deco' | 'hang' | 'edgeR' | 'edgeL' | 'bal' | 'balD';
export interface Ornament {
  tex: Texture;
  kind: OrnamentKind;
}

/** How often each kind is picked: mostly windows, with the rest for variety. */
const KIND_WEIGHT: Record<OrnamentKind, number> = { win: 3, deco: 1.1, hang: 1, edgeR: 0.8, edgeL: 0.8, bal: 0.9, balD: 0.6 };

export type ScarKind = 'cracks' | 'holes' | 'scorch';

/** What every painted castle shares: damage decals and the masons' scaffold. */
export type ScenerySheet = 'grass' | 'rocks' | 'trees' | 'farm' | 'farm2';

export interface CastleKit {
  decals: Record<ScarKind, Texture[]>;
  scaffold: StackedPiece | null;
  /** Props planted around the castles, four per sheet, each standing on the bottom of its frame. */
  scenery: Partial<Record<ScenerySheet, Texture[]>>;
}

let kit: Promise<CastleKit | null> | null = null;

/** The shared decals and scaffold (null when none are painted). */
export function castleKit(): Promise<CastleKit | null> {
  kit ??= loadManifest().then(async (m) => {
    const common = (m as unknown as Record<string, { decals?: Record<string, { kind: ScarKind; frames: number[][] }>; scaffold?: StackedMeta }>)._comun;
    if (!common) return { decals: { cracks: [], holes: [], scorch: [] }, scaffold: null, scenery: {} };
    const decals: Record<ScarKind, Texture[]> = { cracks: [], holes: [], scorch: [] };
    await Promise.all(
      Object.entries(common.decals ?? {}).map(async ([name, sheet]) => {
        const t = await texture(`castles/_comun/${name}.webp`);
        if (!t) return;
        for (const [x, y, w, h] of sheet.frames) decals[sheet.kind]?.push(new Texture({ source: t.source, frame: new Rectangle(x, y, w, h) }));
      }),
    );
    const scaffold = await stacked('_comun', 'scaffold', common.scaffold);
    const props = (m as unknown as Record<string, { props?: Record<string, { frames: number[][] }> }>)._escenario?.props ?? {};
    const scenery: Partial<Record<ScenerySheet, Texture[]>> = {};
    await Promise.all(
      Object.entries(props).map(async ([name, sheet]) => {
        const t = await texture(`castles/_escenario/${name}.webp`);
        if (t) scenery[name as ScenerySheet] = sheet.frames.map(([x, y, w, h]) => new Texture({ source: t.source, frame: new Rectangle(x!, y!, w!, h!) }));
      }),
    );
    return { decals, scaffold, scenery };
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
  /** Where the shaft meets the crown and the base: the painting carried over the cut, fading out. */
  private readonly skirtTop: Sprite | null;
  private readonly skirtBottom: Sprite | null;
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
  private ornaments: Ornament[] = [];
  private seed = 0;
  private density = 0.55;
  /** Each slot's group, built at a shaft width of 1 and scaled; null: a bare stretch. */
  private readonly slots: ({ root: Container; half: number } | null)[] = [];
  private readonly ornamentLayer = new Container();

  constructor(readonly piece: StackedPiece) {
    this.crown = new Sprite(piece.crown);
    this.shaft = new TilingSprite({ texture: piece.shaft, width: 1, height: 1 });
    // `dynamic`: the frame changes as the tower grows, and a Sprite only re-reads the size of a
    // dynamic texture. Without it the base kept the size it had on its first frame (one row when
    // the castle rose from the ground) and the tower floated with no base.
    this.baseCrop = new Texture({ source: piece.base.source, frame: new Rectangle(0, 0, piece.base.width, piece.base.height), dynamic: true });
    this.base = new Sprite(this.baseCrop);
    const skirts = piece.skirtTop && piece.skirtBottom;
    this.skirtTop = skirts ? new Sprite(piece.skirtTop!) : null;
    this.skirtBottom = skirts ? new Sprite(piece.skirtBottom!) : null;
    this.root.addChild(this.shaft);
    if (this.skirtTop && this.skirtBottom) this.root.addChild(this.skirtBottom, this.skirtTop);
    this.root.addChild(this.base, this.crown, this.foot);
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

    if (this.skirtTop && this.skirtBottom) {
      // Each skirt as tall as painted, or squeezed to half the shaft when it is short, so both still
      // fade out completely before they meet.
      const sh = Math.min(this.skirtTop.texture.height * k, shaftH / 2);
      for (const s of [this.skirtTop, this.skirtBottom]) {
        s.visible = this.shaft.visible && sh > 0.5;
        s.x = left;
        s.width = W;
        s.height = Math.max(1, sh);
      }
      this.skirtTop.y = -h;
      this.skirtBottom.y = -baseH - sh;
    }

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
  setOrnaments(ornaments: Ornament[], seed: number, density = 0.55): void {
    this.ornaments = ornaments;
    this.seed = seed;
    this.density = density;
    for (const s of this.slots) s?.root.destroy({ children: true });
    this.slots.length = 0;
  }

  /** One slot's ornament (and the window behind a bare balcony), sized for a shaft 1 wide. */
  private makeSlot(r: (n: number) => number): { root: Container; half: number } | null {
    const all = this.ornaments;
    const windows = all.filter((o) => o.kind === 'win');
    const pool = all.filter((o) => o.kind !== 'bal' || windows.length);
    let total = 0;
    for (const o of pool) total += KIND_WEIGHT[o.kind];
    let pick = r(2) * total;
    const o = pool.find((p) => (pick -= KIND_WEIGHT[p.kind]) < 0) ?? pool[0];
    if (!o) return null;
    const root = new Container();
    const sprite = (tex: Texture, width: number, maxH: number): Sprite => {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      const k = Math.min(width / tex.width, maxH / tex.height);
      sp.scale.set(k);
      root.addChild(sp);
      return sp;
    };
    const jitter = (r(3) - 0.5) * 0.2;
    let top = 0;
    let bottom = 0;
    switch (o.kind) {
      case 'edgeR':
      case 'edgeL': {
        const sp = sprite(o.tex, 0.55, 0.5);
        // The fixing overlaps the edge a little; the rest sticks out into the air.
        const side = o.kind === 'edgeR' ? 1 : -1;
        sp.x = side * (0.5 + sp.width * 0.2);
        top = -sp.height / 2;
        bottom = sp.height / 2;
        break;
      }
      case 'bal': {
        const win = windows[Math.floor(r(4) * windows.length)]!;
        const w = sprite(win.tex, 0.42, 0.62);
        const b = sprite(o.tex, 0.82, 0.5);
        w.position.set(jitter, -w.height * 0.2);
        b.position.set(jitter, w.y + w.height / 2 + b.height * 0.1);
        top = w.y - w.height / 2;
        bottom = b.y + b.height / 2;
        break;
      }
      default: {
        const [width, maxH] = o.kind === 'win' ? [0.42, 0.62] : o.kind === 'hang' ? [0.4, 0.95] : o.kind === 'balD' ? [0.8, 0.8] : [0.46, 0.55];
        const sp = sprite(o.tex, width, maxH);
        sp.x = jitter;
        top = -sp.height / 2;
        bottom = sp.height / 2;
      }
    }
    // Centre the group on the slot.
    for (const c of root.children) c.y -= (top + bottom) / 2;
    this.ornamentLayer.addChild(root);
    return { root, half: (bottom - top) / 2 };
  }

  private layoutOrnaments(w: number, h: number, baseH: number, crownH: number): void {
    if (!this.ornaments.length) return;
    // One slot every ~1.15 shaft widths above the base; the top one stays clear of the crown.
    const step = w * 1.15;
    const top = h - Math.min(crownH * 0.15, w * 0.2);
    const count = Math.max(0, Math.floor((h - baseH) / step) + 1);
    for (let i = 0; i < Math.max(count, this.slots.length); i++) {
      const r = (n: number): number => {
        const x = Math.sin((this.seed + 1) * 127.1 + i * 311.7 + n * 74.7) * 43758.5453;
        return x - Math.floor(x);
      };
      if (this.slots[i] === undefined) this.slots[i] = r(0) < this.density ? this.makeSlot(r) : null;
      const slot = this.slots[i];
      if (!slot) continue;
      const y = baseH + step * (i + 0.5) + (r(1) - 0.5) * step * 0.25;
      slot.root.scale.set(w);
      slot.root.position.set(0, -y);
      // Shown only while the courses it hangs on stand.
      const half = slot.half * w;
      slot.root.visible = y + half < top && y - half > baseH * 0.92;
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
