import { Assets, Container, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { artUrl } from '../ui/assets';
import type { ScaffoldParts, ScaffoldPartsMeta } from './scaffold';

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
  /** The scaffold's planks: top and bottom edge of each, in source px from the crown's top. */
  planks?: [number, number][];
  /** The scaffold cut into its separate timbers. */
  parts?: ScaffoldPartsMeta;
  /** The side the shaft is lit from: -1 left, 1 right, 0 unclear. */
  light?: number;
  /** Rows at the bottom of the crown that are still plain stones, like the shaft (ornaments may climb onto them). */
  plain?: number;
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
  /** The hero's painted banner turned on its side: the cloth its flags fly (rod along the pole, at the left). */
  flag: Texture | null;
  /** The hero's own painted flag on a tall mast, when there is one (it wins over the banner). */
  ownFlag: OwnFlag | null;
}

/** A hero's own flag: the cloth (flying left, its hoist at the right edge) and the mast it flies from. */
export interface OwnFlag {
  cloth: Texture;
  pole: Texture;
  /** The mast's axis across its image, and how far below its tip the cloth's top is (image px). */
  poleAxis: number;
  clothTop: number;
}
interface OwnFlagMeta {
  cloth: [number, number];
  pole: [number, number];
  poleAxis: number;
  clothTop: number;
}

/** Heroes with no plants of their own borrow these for their walls. */
const IVY_DONOR = 'guardian';

type Piece = 'keep' | 'tower1' | 'tower2' | 'tower' | 'wall' | 'scaffold';
type Manifest = Record<string, Partial<Record<Piece, StackedMeta>> & { ruins?: { width: number; height: number }; ornaments?: OrnamentSheet[]; flag?: OwnFlagMeta }>;
interface OrnamentSheet {
  name: string;
  frames: ([number, number, number, number, OrnamentKind, number?] | null)[];
  /** A `-glow` sheet holds the pieces' own lights, at the same frames. */
  glow?: boolean;
  /** A `-flag` image (its size) holds the banner turned on its side. */
  flag?: [number, number] | null;
}

/** A hero's ornament sheets cut into pieces, each with its own light, and the first flag found. */
async function ornamentsOf(hero: string, sheets: OrnamentSheet[]): Promise<{ ornaments: Ornament[]; flag: Texture | null }> {
  const loaded = await Promise.all(
    sheets.map(async (o) => {
      const [t, g, flag] = await Promise.all([
        texture(`castles/${hero}/${o.name}.webp`),
        o.glow ? texture(`castles/${hero}/${o.name}-glow.webp`) : Promise.resolve(null),
        o.flag ? texture(`castles/${hero}/${o.name}-flag.webp`) : Promise.resolve(null),
      ]);
      if (!t) return { list: [] as Ornament[], flag };
      const list = o.frames.flatMap((f) => {
        if (!f) return [];
        const frame = new Rectangle(f[0], f[1], f[2], f[3]);
        return [{ tex: new Texture({ source: t.source, frame }), glow: g ? new Texture({ source: g.source, frame: frame.clone() }) : null, kind: f[4], light: f[5] ?? 0 }];
      });
      return { list, flag };
    }),
  );
  return { ornaments: loaded.flatMap((l) => l.list), flag: loaded.find((l) => l.flag)?.flag ?? null };
}

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
      const { ornaments, flag } = await ornamentsOf(hero, entry.ornaments ?? []);
      // A wall wears only plants: a hero with none painted borrows another's.
      if (ornaments.length && !ornaments.some((o) => o.kind === 'ivy') && m[IVY_DONOR]?.ornaments) {
        const donor = await ornamentsOf(IVY_DONOR, m[IVY_DONOR].ornaments);
        ornaments.push(...donor.ornaments.filter((o) => o.kind === 'ivy'));
      }
      const [keep, tower1, tower2, tower, wall, ruins] = await Promise.all([
        stacked(hero, 'keep', entry.keep),
        stacked(hero, 'tower1', entry.tower1),
        stacked(hero, 'tower2', entry.tower2),
        stacked(hero, 'tower', entry.tower),
        stacked(hero, 'wall', entry.wall),
        entry.ruins ? texture(`castles/${hero}/ruins.webp`) : Promise.resolve(null),
      ]);
      const [cloth, pole] = entry.flag
        ? await Promise.all([texture(`castles/${hero}/flag-cloth.webp`), texture(`castles/${hero}/flag-pole.webp`)])
        : [null, null];
      const ownFlag = cloth && pole && entry.flag ? { cloth, pole, poleAxis: entry.flag.poleAxis, clothTop: entry.flag.clothTop } : null;
      return keep ? { keep, towers: [tower1 ?? tower, tower2 ?? tower], wall, ruins, ornaments, flag, ownFlag } : null;
    });
    sets.set(hero, set);
  }
  return set;
}

/**
 * How an ornament sits on a tower. win, deco: front-facing, on the shaft.
 * hang: hangs from its top (chains, a rack). banner: the hero's banner, hung
 * the same way (and the cloth of its flags). ivy: climbing plants, moss or
 * grass, hung like a banner; the only thing a curtain wall wears.
 * edgeR / edgeL: seen from the side, fixed to a wall on its left / right, so
 * it sticks out of that edge. bal: a balcony set under a window. balD: a
 * balcony with its own door.
 */
export type OrnamentKind = 'win' | 'deco' | 'hang' | 'banner' | 'ivy' | 'edgeR' | 'edgeL' | 'bal' | 'balD';
export interface Ornament {
  tex: Texture;
  /** Its own light (a pane, a flame, a crystal), laid over it and made to flicker; null if it has none. */
  glow: Texture | null;
  kind: OrnamentKind;
  /** The side it was painted lit from: -1 left, 1 right, 0 unclear. */
  light: number;
}

/** How often each kind is picked within its turn (windows and the rest take turns up the shaft). */
const KIND_WEIGHT: Record<OrnamentKind, number> = { win: 3, deco: 1.1, hang: 1, banner: 1, ivy: 0.8, edgeR: 0.8, edgeL: 0.8, bal: 0.9, balD: 0.6 };
/** Kinds that open the tower: a window, or a balcony with one. */
const OPENINGS: readonly OrnamentKind[] = ['win', 'bal', 'balD'];
/** Where a stack stands: a tower wears anything; a curtain wall has no rooms behind it, so only plants. */
export type OrnamentRole = 'tower' | 'wall';

export type ScarKind = 'cracks' | 'holes' | 'scorch';

/** What every painted castle shares: damage decals and the masons' scaffold. */
export type ScenerySheet = 'grass' | 'rocks' | 'trees' | 'farm' | 'farm2';

export interface CastleKit {
  decals: Record<ScarKind, Texture[]>;
  scaffold: StackedPiece | null;
  /** The scaffold's separate timbers, to put it up one board at a time. */
  scaffoldParts: ScaffoldParts | null;
  /** Props planted around the castles, four per sheet, each standing on the bottom of its frame. */
  scenery: Partial<Record<ScenerySheet, Texture[]>>;
}

let kit: Promise<CastleKit | null> | null = null;

/** The shared decals and scaffold (null when none are painted). */
export function castleKit(): Promise<CastleKit | null> {
  kit ??= loadManifest().then(async (m) => {
    const common = (m as unknown as Record<string, { decals?: Record<string, { kind: ScarKind; frames: number[][] }>; scaffold?: StackedMeta }>)._comun;
    if (!common) return { decals: { cracks: [], holes: [], scorch: [] }, scaffold: null, scaffoldParts: null, scenery: {} };
    const decals: Record<ScarKind, Texture[]> = { cracks: [], holes: [], scorch: [] };
    await Promise.all(
      Object.entries(common.decals ?? {}).map(async ([name, sheet]) => {
        const t = await texture(`castles/_comun/${name}.webp`);
        if (!t) return;
        for (const [x, y, w, h] of sheet.frames) decals[sheet.kind]?.push(new Texture({ source: t.source, frame: new Rectangle(x, y, w, h) }));
      }),
    );
    const scaffold = await stacked('_comun', 'scaffold', common.scaffold);
    const partsMeta = common.scaffold?.parts;
    const partsSheet = partsMeta ? await texture('castles/_comun/scaffold-parts.webp') : null;
    const scaffoldParts = partsMeta && partsSheet ? { meta: partsMeta, sheet: partsSheet } : null;
    const props = (m as unknown as Record<string, { props?: Record<string, { frames: number[][] }> }>)._escenario?.props ?? {};
    const scenery: Partial<Record<ScenerySheet, Texture[]>> = {};
    await Promise.all(
      Object.entries(props).map(async ([name, sheet]) => {
        const t = await texture(`castles/_escenario/${name}.webp`);
        if (t) scenery[name as ScenerySheet] = sheet.frames.map(([x, y, w, h]) => new Texture({ source: t.source, frame: new Rectangle(x!, y!, w!, h!) }));
      }),
    );
    return { decals, scaffold, scaffoldParts, scenery };
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
  /** Ornaments on the shaft, one slot at every step of the climb; made when first reached. */
  private ornaments: Ornament[] = [];
  private role: OrnamentRole = 'tower';
  private seed = 0;
  /** Each slot's group, built at a shaft width of 1 and scaled, and the ornament it shows. */
  private readonly slots: ({ root: Container; half: number; pick: Ornament } | null)[] = [];
  private readonly ornamentLayer = new Container();
  /** The ornaments' own lights, each with its own beat so they do not flicker in step. */
  private lights: { sprite: Sprite; beat: number }[] = [];

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
   * Lays these ornaments up the shaft at a steady step, one in every slot,
   * windows taking turns with the rest (seeded, so the same tower always
   * wears the same ones). A wall wears only its plants.
   */
  setOrnaments(ornaments: Ornament[], seed: number, role: OrnamentRole = 'tower'): void {
    this.ornaments = ornaments;
    this.role = role;
    this.seed = seed;
    for (const s of this.slots) s?.root.destroy({ children: true });
    this.slots.length = 0;
    this.lights = [];
  }

  /**
   * The ornaments' lights burn like candles, lanterns and witch-fire: each
   * breathes on its own beat with a quick flutter, and now and then gutters.
   * `phase` is the castle's clock, `level` how brightly they burn (0 out).
   */
  flicker(phase: number, level: number): void {
    for (const l of this.lights) {
      const b = l.beat;
      const breath = Math.sin(phase * (1.3 + b * 0.5) + b * 9) * 0.18;
      const flutter = Math.sin(phase * (7.1 + b * 3) + b * 4) * 0.09 + Math.sin(phase * 13.3 + b * 17) * 0.06;
      // A gust: a brief dip on a slow cycle of its own.
      const gust = Math.max(0, Math.sin(phase * (0.37 + b * 0.2) + b * 31) - 0.9) * 4;
      l.sprite.alpha = Math.max(0, level * (0.95 + breath + flutter - gust * 0.45));
    }
  }

  /** One slot's ornament (and the window behind a bare balcony), sized for a shaft 1 wide. */
  private makeSlot(i: number, r: (n: number) => number): { root: Container; half: number; pick: Ornament } | null {
    const all = this.ornaments;
    const windows = all.filter((o) => o.kind === 'win');
    const usable = all.filter((o) => (this.role === 'wall' ? o.kind === 'ivy' : o.kind !== 'bal' || windows.length));
    // Openings on every other slot, the rest between them; never the same piece twice running.
    const turn = this.role === 'wall' ? usable : usable.filter((o) => OPENINGS.includes(o.kind) === (i % 2 === 0));
    const prev = this.slots[i - 1]?.pick;
    const fresh = (list: Ornament[]): Ornament[] => (list.length > 1 ? list.filter((o) => o !== prev) : list);
    const pool = fresh(turn.length ? turn : usable);
    let total = 0;
    for (const o of pool) total += KIND_WEIGHT[o.kind];
    let pick = r(2) * total;
    const o = pool.find((p) => (pick -= KIND_WEIGHT[p.kind]) < 0) ?? pool[0];
    if (!o) return null;
    const root = new Container();
    // The ornaments were painted lit from either side; one lit against its tower is turned round,
    // so the sun falls on both from the same side.
    const towerLight = this.piece.meta.light ?? 0;
    const turned = (orn: Ornament): boolean => towerLight !== 0 && orn.light !== 0 && orn.light !== towerLight;
    const sprite = (orn: Ornament, width: number, maxH: number): Sprite => {
      const tex = orn.tex;
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      const k = Math.min(width / tex.width, maxH / tex.height);
      sp.scale.set(turned(orn) ? -k : k, k);
      root.addChild(sp);
      if (orn.glow) {
        // Its light, on top: a child, so it is sized, turned and moved with it.
        const g = new Sprite(orn.glow);
        g.anchor.set(0.5);
        g.blendMode = 'add';
        sp.addChild(g);
        this.lights.push({ sprite: g, beat: r(5 + this.lights.length) });
      }
      return sp;
    };
    let top = 0;
    let bottom = 0;
    switch (o.kind) {
      case 'edgeR':
      case 'edgeL': {
        const sp = sprite(o, 0.55, 0.5);
        // The fixing sits on the stones at the edge (the shaft's corner pilasters), the rest sticks
        // out into the air. Turned round, it sticks out of the other edge.
        const side = (o.kind === 'edgeR' ? 1 : -1) * (turned(o) ? -1 : 1);
        sp.x = side * (0.22 + sp.width / 2);
        top = -sp.height / 2;
        bottom = sp.height / 2;
        break;
      }
      case 'bal': {
        const win = windows[Math.floor(r(4) * windows.length)]!;
        const w = sprite(win, 0.42, 0.62);
        const b = sprite(o, 0.82, 0.5);
        w.position.set(0, -w.height * 0.2);
        b.position.set(0, w.y + w.height / 2 + b.height * 0.1);
        top = w.y - w.height / 2;
        bottom = b.y + b.height / 2;
        break;
      }
      default: {
        const [width, maxH] = o.kind === 'win' ? [0.42, 0.62] : o.kind === 'hang' || o.kind === 'banner' || o.kind === 'ivy' ? [0.4, 0.95] : o.kind === 'balD' ? [0.8, 0.8] : [0.46, 0.55];
        const sp = sprite(o, width, maxH);
        top = -sp.height / 2;
        bottom = sp.height / 2;
      }
    }
    // Centre the group on the slot.
    for (const c of root.children) c.y -= (top + bottom) / 2;
    this.ornamentLayer.addChild(root);
    return { root, half: (bottom - top) / 2, pick: o };
  }

  private layoutOrnaments(w: number, h: number, baseH: number, crownH: number): void {
    if (!this.ornaments.length) return;
    const wall = this.role === 'wall';
    // A tower: one slot every 0.9 shaft widths above the base, each filled, up to where the crown's
    // own features begin (its lowest courses are plain stones, like the shaft). A wall: two patches
    // of plants hanging side by side from under its battlements.
    const step = w * 0.9;
    const plain = ((this.piece.meta.plain ?? 0) * w) / this.piece.meta.shaftWidth;
    const top = h + plain - Math.min(crownH * 0.15, w * 0.2);
    const count = wall ? 2 : Math.max(0, Math.floor((top - baseH) / step) + 1);
    for (let i = 0; i < Math.max(count, this.slots.length); i++) {
      const r = (n: number): number => {
        const x = Math.sin((this.seed + 1) * 127.1 + i * 311.7 + n * 74.7) * 43758.5453;
        return x - Math.floor(x);
      };
      if (this.slots[i] === undefined) this.slots[i] = this.makeSlot(i, r);
      const slot = this.slots[i];
      if (!slot) continue;
      const half = slot.half * w;
      const y = wall ? h - half : baseH + step * (i + 0.5);
      slot.root.scale.set(w);
      slot.root.position.set(wall ? (i % 2 ? 0.26 : -0.26) * w : 0, -y);
      // Shown only while the courses it hangs on stand.
      slot.root.visible = (wall || y + half < top) && y - half > baseH * 0.92;
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
