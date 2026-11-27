import { ColorMatrixFilter, Container, Graphics, MeshSimple, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { HeroId } from '@cardcraft-castles/engine';
import { heroColor } from '../ui/theme';
import { castleStyle, footTexture, shadeTexture, styleTextures, type CastleStyle, type ParapetKind, type RoofKind, type WindowKind } from './castleStyles';
import { glowTexture } from './textures';
import { drawTombstone } from './tombstone';
import { ScaffoldRig } from './scaffold';
import { castleKit, paintedCastle, Stack, type CastleKit, type PaintedCastle, type ScarKind, type StackedPiece } from './paintedCastle';

/** Strips a painted flag is cut into along its length, each bent and shaded on its own. */
const FLAG_STRIPS = 14;

/**
 * A flag of painted cloth (the hero's banner turned on its side): a row of
 * textured strips, each set along the wave every frame and shaded by its
 * fold, so the painting itself billows.
 */
class PaintedFlag {
  readonly root = new Container();
  private readonly strips: MeshSimple[] = [];
  /** The mast of a hero's own flag, behind its cloth. */
  readonly pole: Sprite | null;

  /** `hoistRight`: the painting's hoist (the edge on the pole) is its right edge. */
  constructor(
    readonly texture: Texture,
    hoistRight = false,
    pole: Texture | null = null,
  ) {
    this.pole = pole ? new Sprite(pole) : null;
    for (let i = 0; i < FLAG_STRIPS; i++) {
      const u0 = hoistRight ? 1 - i / FLAG_STRIPS : i / FLAG_STRIPS;
      const u1 = hoistRight ? 1 - (i + 1) / FLAG_STRIPS : (i + 1) / FLAG_STRIPS;
      const mesh = new MeshSimple({
        texture,
        vertices: new Float32Array(8),
        uvs: new Float32Array([u0, 0, u1, 0, u1, 1, u0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });
      mesh.autoUpdate = true;
      this.strips.push(mesh);
      this.root.addChild(mesh);
    }
    // The mast in front, over the edge of cloth painted around it.
    if (this.pole) this.root.addChild(this.pole);
  }

  /**
   * Hangs it from a pole at (x, y): `len` long toward `dir`, as tall as the
   * painting's proportions give, tapering to `tip` of that at the far end.
   */
  draw(x: number, y: number, len: number, tip: number, phase: number, dir: number): void {
    const h = (len * this.texture.height) / this.texture.width;
    // The cloth hangs still at the rod and billows more toward the free end.
    const wave = (t: number): number => Math.sin(phase * 1.1 - t * 3.4) * h * 0.16 * t + Math.sin(phase * 2.3 - t * 7) * h * 0.04 * t;
    const fold = (t: number): number => Math.cos(phase * 1.1 - t * 3.4) * Math.min(1, t * 3);
    const px = (t: number): number => x + dir * len * t * (1 - Math.abs(Math.sin(phase * 1.1 - t * 3.4)) * 0.05 * t);
    const tall = (t: number): number => h * (1 - (1 - tip) * t);
    // A tapering pennant also droops toward its point.
    const top = (t: number): number => y + wave(t) + (h - tall(t)) * 0.45;
    this.strips.forEach((m, i) => {
      const t0 = i / FLAG_STRIPS;
      const t1 = (i + 1) / FLAG_STRIPS;
      const v = m.vertices;
      v[0] = px(t0);
      v[1] = top(t0);
      v[2] = px(t1);
      v[3] = top(t1);
      v[4] = px(t1);
      v[5] = top(t1) + tall(t1);
      v[6] = px(t0);
      v[7] = top(t0) + tall(t0);
      // Troughs fall into shade; the folds toward the sun keep the painting's own light.
      const k = fold((t0 + t1) / 2);
      m.tint = k >= 0 ? mix(0xeeeeee, 0xffffff, k) : mix(0xeeeeee, 0x3a3046, -k * 0.32);
    });
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * One castle, drawn in the style of its hero (see `castleStyles.ts`).
 *
 * The tall tower in front is the Keep: its stone body is exactly as tall as
 * the Keep value. The curtain wall on the enemy side is the Wall, exactly as
 * tall as the Wall value. The towers behind the Keep are scenery that rises
 * and falls with it (always shorter), so the Keep stays the obvious measure.
 * Everything is procedural so it can grow and crumble smoothly to any height.
 */

/** Kept for compatibility with older callers; each hero's style now brings its own stone. */
export interface CastleTextures {
  keepStone: Texture;
  wallStone: Texture;
  shade: Texture;
}

export interface CastleLayout {
  /** Centre of the Keep, in scene pixels. */
  x: number;
  groundY: number;
  /** Pixels per point of Keep or Wall. */
  unit: number;
  keepWidth: number;
  /** Ignored: the Wall's width comes from the hero's style. */
  wallWidth: number;
  /** Ignored: the gap comes from the hero's style. */
  gap: number;
  /** Visual cap so a huge Wall does not leave the screen. The Keep has none: past the winning height it keeps rising, off the top if it must. */
  maxPoints: number;
}

/** How long a castle stays hidden waiting for its painting before the drawn one shows instead. */
const PAINT_WAIT_MS = 8000;

/** The drawn gravestone on a fallen castle; off until there is a painted one. */
const SHOW_GRAVESTONES = false;
/** The wind blows the way the clouds drift (right to left): every flag streams that way, on both castles. */
export const WIND = -1;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const x = (a >> shift) & 255;
    const y = (b >> shift) & 255;
    return Math.round(x + (y - x) * t) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

const darken = (c: number, t: number): number => mix(c, 0x000000, t);
const lighten = (c: number, t: number): number => mix(c, 0xffffff, t);

/** Deterministic noise for scattered details. */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

let glowTex: Texture | null = null;
const glow = (): Texture => (glowTex ??= glowTexture('255,255,255', 64));

// ---------------------------------------------------------------------------
// A tower: stone body, details, parapet and roof
// ---------------------------------------------------------------------------

interface TowerShape {
  roof: RoofKind;
  parapet: ParapetKind;
  round: boolean;
  pennant: boolean;
}

class Tower {
  readonly root = new Container();
  readonly body: TilingSprite;
  readonly shade: Sprite;
  readonly foot: Sprite;
  readonly details = new Graphics();
  readonly top = new Graphics();
  readonly decor = new Graphics();
  /** Centre x and width in scene pixels. */
  cx = 0;
  w = 0;
  h = 0;
  groundY = 0;
  /** Height of the parapet above the body top (for anchors). */
  crown = 0;
  /** Roof apex above the body top (negative y offset), and where a flag pole stands. */
  apex = 0;
  broken = false;
  /** Horizontal offset of the apex from the centre (painted towers: the flagpole). */
  apexX = 0;
  /** The painting this tower is made of, or null when it is drawn. */
  readonly painted: Stack | null;
  /** Painted towers are mirrored on the right-hand castle. */
  mirror = false;
  private key = '';

  constructor(
    readonly shape: TowerShape,
    readonly isKeep: boolean,
    readonly index: number,
    stone: Texture,
    piece: StackedPiece | null = null,
  ) {
    this.body = new TilingSprite({ texture: stone, width: 10, height: 10 });
    this.shade = new Sprite(shadeTexture(shape.round));
    this.foot = new Sprite(footTexture());
    this.painted = piece ? new Stack(piece) : null;
    if (this.painted) {
      this.body.visible = this.shade.visible = this.foot.visible = false;
      this.root.addChild(this.painted.root, this.details, this.decor, this.top);
    } else {
      this.root.addChild(this.body, this.shade, this.foot, this.details, this.decor, this.top);
    }
  }

  get topY(): number {
    return this.groundY - this.h;
  }

  place(cx: number, w: number, groundY: number, brick: number): void {
    this.cx = cx;
    this.w = w;
    this.groundY = groundY;
    this.body.tileScale.set(brick);
    this.key = '';
  }

  /** Moves the body and the crown; redraws details only when the height changes by a whole point. */
  setHeight(h: number, unit: number, broken: boolean, draw: (t: Tower, unit: number) => void): void {
    this.h = h;
    this.broken = broken;
    const x = this.cx - this.w / 2;
    const y = this.groundY - h;
    this.body.position.set(x, y);
    this.body.width = this.w;
    this.body.height = Math.max(1, h);
    // Anchor the courses to the ground so stones do not slide while the tower grows.
    this.body.tilePosition.y = h;
    this.shade.position.set(x, y);
    this.shade.width = this.w;
    this.shade.height = Math.max(1, h);
    const footH = Math.min(h, this.w * 0.5);
    this.foot.position.set(x, this.groundY - footH);
    this.foot.width = this.w;
    this.foot.height = footH;
    this.top.position.set(this.cx, y);
    this.decor.position.set(this.cx, y);
    if (this.painted) {
      const fit = this.painted.layout(this.cx, this.groundY, this.w, h, this.mirror, !broken);
      if (!broken) {
        this.crown = fit.crown;
        this.apex = fit.apexY;
        this.apexX = fit.apexX;
      }
    }
    const key = `${Math.round(h / unit)}|${broken}|${this.w}|${unit}`;
    if (key !== this.key) {
      this.key = key;
      draw(this, unit);
    }
  }

  invalidate(): void {
    this.key = '';
  }

  destroy(): void {
    this.painted?.destroy();
    this.root.destroy({ children: true });
  }
}

// ---------------------------------------------------------------------------
// The castle
// ---------------------------------------------------------------------------

/** A painted wound on the Keep or the Wall, pinned to its stones (it goes when that height is lost or rebuilt). */
interface Scar {
  part: 'keep' | 'wall';
  sprite: Sprite;
  /** Across the body (-0.5..0.5 of its width) and up from the ground (Keep widths). */
  fx: number;
  yk: number;
  /** Width, as a share of the body's width. */
  size: number;
  flip: number;
  age: number;
}

/** Most wounds shown at once on each part (the oldest heal first). */
const MAX_SCARS = { keep: 7, wall: 4 };
/** A scaffold left standing this long comes down by itself (ms). */
const SCAFFOLD_HOLD_MS = 5000;

interface Scaffold {
  rig: ScaffoldRig;
  /** The height it is built to (Keep or Wall points). */
  value: number;
  /** How long it has stood complete (ms). */
  held: number;
  /** Tall enough to bother with. */
  show: boolean;
}

interface Puff {
  sprite: Sprite;
  life: number;
  max: number;
  vx: number;
  vy: number;
}

export class Castle extends Container {
  /** +1: the Wall stands to the right of the Keep (left castle); -1: to the left. */
  readonly facing: 1 | -1;
  private layoutValue: CastleLayout | null = null;
  private keepValue = 30;
  private wallValue = 10;
  private bannerColor: number;
  private style: CastleStyle;
  private hero: string | null = null;

  private readonly mound = new Graphics();
  private readonly backLayer = new Container();
  private readonly keepLayer = new Container();
  private readonly cracks = new Graphics();
  private readonly scarsKeep = new Container();
  private readonly scarsWall = new Container();
  private readonly scaffoldKeep = new Container();
  private readonly scaffoldWall = new Container();
  private readonly wallLayer = new Container();
  private readonly wallBody: TilingSprite;
  private readonly wallShade: Sprite;
  private readonly wallDetails = new Graphics();
  private readonly wallTop = new Graphics();
  private readonly rubble = new Graphics();
  /** The hero's gravestone on a fallen castle. */
  private readonly grave = new Graphics();
  /** 0 to 1 while the gravestone rises; -1 with none. */
  private graveRise = -1;
  private readonly anim = new Graphics();
  /** Animated pieces that stand behind the Keep (the crane). */
  private readonly animBack = new Graphics();
  /** Flags of a painted castle: behind every tower, so the cloth never covers the painting. */
  private readonly flagsBack = new Graphics();
  /** Painted flags (the hero's banner as cloth), behind the towers like the drawn ones; one per pole. */
  private readonly flagLayer = new Container();
  private paintedFlags: PaintedFlag[] = [];
  private readonly glows = new Container();
  private readonly smoke = new Container();
  private readonly frostCoat = new Graphics();
  readonly shieldBubble = new Graphics();
  /** The light band that climbs the shield dome. */
  private readonly shieldSweep = new Graphics();
  /** Shield dome in scene px while a Shield is up (for ambient sparkles). */
  dome: { cx: number; gy: number; rx: number; ry: number } | null = null;
  private shieldRise = 1;
  private shieldFlash = 0;
  private sweepPhase = 0;

  private keepTower!: Tower;
  /** The hero's painted castle once loaded (null: drawn). */
  private painted: PaintedCastle | null = null;
  /** The painting being loaded for the current hero (see `loadPainted`). */
  private paintedLoad: Promise<void> = Promise.resolve();
  private wallStack: Stack | null = null;
  private ruinsSprite: Sprite | null = null;
  /** Soft shadow pooled under a painted castle. */
  private readonly groundShadow = new Sprite(glowTexture('0,0,0', 128));
  private kit: CastleKit | null = null;
  /** Trees and farms behind the castle, grass and rocks before it (added to the scene by the battlefield, so hits and shakes leave them be). */
  readonly sceneryBack = new Container();
  readonly sceneryFront = new Container();
  private scars: Scar[] = [];
  private scaffolds: Partial<Record<'keep' | 'wall', Scaffold>> = {};
  /** Each time a plank of the scaffold is laid or lifted off: where (scene px of the castle) and how wide. */
  onPlank: ((x: number, y: number, w: number, up: boolean) => void) | null = null;
  private towers: Tower[] = [];
  private puffs: Puff[] = [];
  private puffTimer = 0;
  private glowSprites: Sprite[] = [];

  private phase = Math.random() * 10;
  private shieldCharges = 0;
  private shieldPulse = 0;
  private wallKey = '';
  private crackKey = '';
  private frozen = false;
  private hitColor = 0xffffff;
  /** Light of the sky and the battle event on the castle (a multiply tint). */
  private ambient = 0xffffff;
  private hitLeft = 0;
  private kick = 0;
  private kickPhase = 0;
  private quake = 0;
  /** A while of shining light (an ultimate fired from this castle). */
  private radiance: { color: number; left: number; total: number } | null = null;
  private radianceFilter: ColorMatrixFilter | null = null;
  /** Ice over every stone while a resource is frozen: a colour grade of the whole castle, so it
   * follows the painting's own outline (crowns and bases included), not a box over part of it. */
  private frostFilter: ColorMatrixFilter | null = null;

  constructor(facing: 1 | -1, _textures?: CastleTextures, bannerColor = 0xc8963e, hero: string | null = null) {
    super();
    this.facing = facing;
    this.bannerColor = hero ? heroColor(hero as HeroId) : bannerColor;
    this.hero = hero;
    this.style = castleStyle(hero);
    const tex = styleTextures(this.style);
    this.wallBody = new TilingSprite({ texture: tex.wallStone, width: 10, height: 10 });
    this.wallShade = new Sprite(shadeTexture(false));
    this.wallShade.alpha = 0.8;
    this.wallLayer.addChild(this.wallBody, this.wallShade, this.wallDetails, this.wallTop);
    this.glows.blendMode = 'add';
    this.addChild(
      this.mound,
      this.groundShadow,
      this.smoke,
      this.flagsBack,
      this.flagLayer,
      this.backLayer,
      this.animBack,
      this.keepLayer,
      this.cracks,
      this.scarsKeep,
      this.scaffoldKeep,
      this.wallLayer,
      this.scarsWall,
      this.scaffoldWall,
      this.rubble,
      this.grave,
      this.anim,
      this.glows,
      this.frostCoat,
      this.shieldBubble,
      this.shieldSweep,
    );
    this.shieldSweep.blendMode = 'add';
    // The drawn gravestone clashes with the painted ruins: hidden for now (the fallen state still counts).
    this.grave.visible = SHOW_GRAVESTONES;
    this.buildTowers();
    this.loadPainted();
    void castleKit().then((k) => {
      if (this.destroyed) return;
      this.kit = k;
      this.layoutScenery();
    });
  }

  /**
   * Swaps in the hero's painted castle if there is one. While it loads the
   * castle is not shown at all: the drawn castle is only a stand-in for heroes
   * with no painting, and flashing it for a moment before the art arrived read
   * as "the old graphics". If the painting takes too long, the drawn one shows.
   */
  private loadPainted(): void {
    const hero = this.hero;
    this.renderable = false;
    const reveal = (): void => {
      if (hero === this.hero && !this.destroyed) this.renderable = true;
    };
    const late = setTimeout(reveal, PAINT_WAIT_MS);
    this.paintedLoad = paintedCastle(hero)
      .then((set) => {
        if (hero !== this.hero || set === this.painted || this.destroyed) return;
        this.painted = set;
        this.clearScars();
        this.buildTowers();
        if (this.layoutValue) this.setLayout(this.layoutValue);
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(late);
        reveal();
      });
  }

  /** Resolves once the castle shows its final look: painted, or drawn when its hero has no painting. */
  whenPainted(): Promise<void> {
    return this.paintedLoad;
  }

  get keep(): number {
    return this.keepValue;
  }

  get wall(): number {
    return this.wallValue;
  }

  /** Width of the Keep in scene pixels. */
  get keepWidth(): number {
    return this.layoutValue?.keepWidth ?? 40;
  }

  /** Hero whose castle style is shown (null: the default style). */
  get heroId(): string | null {
    return this.hero;
  }

  /** Switches to a hero's castle style and banner colour. */
  setHero(hero: string | null): void {
    const style = castleStyle(hero);
    const color = hero ? heroColor(hero as HeroId) : this.bannerColor;
    if (hero === this.hero && style === this.style && color === this.bannerColor) return;
    this.hero = hero;
    this.bannerColor = color;
    if (style !== this.style) {
      this.style = style;
      const tex = styleTextures(style);
      this.wallBody.texture = tex.wallStone;
      this.painted = null;
      this.buildTowers();
      this.loadPainted();
    } else {
      this.invalidate();
    }
    if (this.layoutValue) this.setLayout(this.layoutValue);
  }

  setBanner(color: number): void {
    if (color === this.bannerColor) return;
    this.bannerColor = color;
    this.invalidate();
    this.redraw();
  }

  setLayout(layout: CastleLayout): void {
    this.layoutValue = layout;
    const l = layout;
    const s = this.style;
    const brick = l.keepWidth / 4.6 / s.keepStone.brickW;
    this.keepTower.place(l.x, l.keepWidth, l.groundY, brick);
    for (const t of this.towers) {
      const spec = s.towers[t.index];
      t.place(l.x - this.facing * spec.offset * l.keepWidth, spec.width * l.keepWidth, l.groundY, brick);
    }
    this.wallBody.tileScale.set((l.keepWidth / 4.6 / s.wallStone.brickW) * 0.95);
    this.invalidate();
    this.drawMound();
    this.layoutScenery();
    this.redraw();
  }

  /**
   * Plants the scenery around a painted castle: a farm and trees behind it on
   * its outer side, hazy with distance, and grass, ferns, rocks and logs along
   * its foot in front. Seeded per side, so it stays put between games.
   */
  private layoutScenery(): void {
    for (const c of [this.sceneryBack, this.sceneryFront]) for (const child of c.removeChildren()) child.destroy();
    const l = this.layoutValue;
    const sc = this.kit?.scenery;
    if (!l || !sc || !this.painted) return;
    const kw = l.keepWidth;
    const f = this.facing;
    const seed = f > 0 ? 17 : 53;
    const r = (n: number): number => hash(seed + n * 1.618);
    const pick = <T,>(list: T[] | undefined, n: number): T | undefined => (list?.length ? list[Math.floor(r(n) * list.length) % list.length] : undefined);
    const plant = (layer: Container, tex: Texture | undefined, x: number, y: number, size: number, byHeight: boolean, haze: number, shadow = false): void => {
      if (!tex) return;
      if (shadow) {
        // A soft shade where it meets the field, so a farm building sits on the grass instead of hovering over it.
        const w = byHeight ? (size / tex.height) * tex.width : size;
        const sh = new Sprite(glowTexture('16,14,10'));
        sh.anchor.set(0.5);
        sh.width = w * 1.05;
        sh.height = w * 0.12;
        sh.position.set(x, y - w * 0.015);
        sh.alpha = 0.55 * (1 - haze * 0.5);
        layer.addChild(sh);
      }
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      const k = byHeight ? size / tex.height : size / tex.width;
      sp.scale.set(r(x) < 0.5 ? -k : k, k);
      sp.position.set(x, y);
      if (haze > 0) sp.tint = mix(0xffffff, 0x9aa2c0, haze);
      layer.addChild(sp);
    };
    const far = l.x - f * kw * 1.75;
    const near = this.wallCx() + f * this.wallW() * 0.6;
    const farms = [...(sc.farm ?? []), ...(sc.farm2 ?? [])];
    // Furthest first, so nearer things overlap them. Out in the field toward the middle, small with
    // distance: a farmstead. Past the castle's outer side: more of it (often off screen on phones).
    const inner = (d: number): number => near + f * kw * d;
    plant(this.sceneryBack, pick(farms, 10), inner(1.6 + r(11) * 0.6), l.groundY - kw * 0.22, kw * (0.62 + r(12) * 0.12), false, 0.48, true);
    plant(this.sceneryBack, pick(farms, 13), inner(2.45 + r(14) * 0.5), l.groundY - kw * 0.2, kw * (0.5 + r(15) * 0.12), false, 0.5, true);
    for (let i = 0; i < 2; i++) plant(this.sceneryBack, pick(farms, 20 + i), far - f * kw * (1 + i * 1.1 + r(22 + i) * 0.3), l.groundY - kw * 0.03, kw * (0.95 + r(24 + i) * 0.3), false, 0.32, true);
    const trees = sc.trees;
    plant(this.sceneryBack, pick(trees, 40), far - f * kw * (0.3 + r(41) * 0.3), l.groundY - kw * 0.06, kw * (2 + r(42) * 0.5), true, 0.18);
    // Between the Keep and the Wall, its crown above the Wall.
    plant(this.sceneryBack, pick(trees, 43), (l.x + this.wallCx()) / 2 + f * kw * 0.1, l.groundY - kw * 0.1, kw * (1.7 + r(45) * 0.4), true, 0.22);
    plant(this.sceneryBack, pick(trees, 46), inner(0.45 + r(47) * 0.3), l.groundY - kw * 0.08, kw * (1.5 + r(48) * 0.4), true, 0.18);
    plant(this.sceneryBack, pick(trees, 49), inner(1.15 + r(50) * 0.3), l.groundY - kw * 0.3, kw * (1.1 + r(51) * 0.3), true, 0.4);
    // In front, along the foot and a little into the field (never over the Keep's door).
    const low = [...(sc.grass ?? []), ...(sc.grass ?? []), ...(sc.rocks ?? [])];
    const from = far - f * kw * 0.5;
    const to = near + f * kw * 1.1;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const x = from + (to - from) * ((i + 0.15 + r(60 + i) * 0.7) / n);
      if (Math.abs(x - l.x) < kw * 0.32) continue;
      plant(this.sceneryFront, pick(low, 70 + i), x, l.groundY + kw * (0.04 + r(80 + i) * 0.14), kw * (0.48 + r(90 + i) * 0.3), false, 0);
    }
  }

  /** Immediate heights (animation is driven from outside by calling this every frame). */
  setHeights(keep: number, wall: number): void {
    const k = Math.max(0, keep);
    const w = Math.max(0, wall);
    // Stones shudder while the castle loses height.
    if (k < this.keepValue - 0.01 || w < this.wallValue - 0.01) this.quake = Math.min(1, this.quake + 0.35);
    this.keepValue = k;
    this.wallValue = w;
    this.redraw();
  }

  setShield(charges: number): void {
    // A new dome rises out of the ground.
    if (this.shieldCharges <= 0 && charges > 0) this.shieldRise = 0;
    this.shieldCharges = charges;
    this.drawShield();
  }

  /**
   * A blow leaves its mark on the painted stones: cracks, a broken hole or
   * scorch, high on the part that was struck. Rebuilding mends them.
   */
  scar(part: 'keep' | 'wall', kind: ScarKind): void {
    const frames = this.kit?.decals[kind];
    const b = this.bodies();
    if (!frames?.length || !this.painted || !b) return;
    const body = b[part];
    const kw = b.groundY - b.keep.top >= 0 ? this.keepWidth : 40;
    const h = b.groundY - body.top;
    const size = (kind === 'holes' ? 0.42 : kind === 'scorch' ? 0.55 : 0.58) * (0.85 + Math.random() * 0.3) * (part === 'wall' ? 0.8 : 1);
    if (h < body.w * size * 0.9) return;
    const sprite = new Sprite(frames[Math.floor(Math.random() * frames.length)]!);
    sprite.anchor.set(0.5);
    sprite.rotation = (Math.random() - 0.5) * 0.6;
    sprite.alpha = 0;
    // Scorch climbs from where it burns; holes and cracks land in the upper half, where blows strike.
    const margin = (body.w * size) / 2;
    const y = margin + (h - margin * 2) * (kind === 'scorch' ? 0.3 + Math.random() * 0.6 : 0.4 + Math.random() * 0.55);
    const scar: Scar = { part, sprite, fx: (Math.random() - 0.5) * 0.4, yk: y / kw, size, flip: Math.random() < 0.5 ? -1 : 1, age: 0 };
    (part === 'keep' ? this.scarsKeep : this.scarsWall).addChild(sprite);
    this.scars.push(scar);
    const mine = this.scars.filter((s) => s.part === part);
    if (mine.length > MAX_SCARS[part]) this.dropScar(mine[0]!);
    this.layoutScars();
  }

  /** Masons at work on a part mend all its wounds. */
  mend(part: 'keep' | 'wall'): void {
    for (const s of this.scars.filter((s) => s.part === part)) this.dropScar(s);
  }

  /**
   * The masons put up their scaffold against a part, one timber at a time from
   * the ground up to the height it is about to reach (`value` points). Returns
   * how long that takes (ms; 0 with no scaffold to show). `speed` scales it.
   */
  raiseScaffold(part: 'keep' | 'wall', value: number, speed = 1): number {
    const kit = this.kit?.scaffoldParts;
    if (!kit || !this.painted || !this.layoutValue) return 0;
    let s = this.scaffolds[part];
    if (!s) {
      const rig = new ScaffoldRig(kit);
      rig.onPlank = (x, y, w, up) => this.onPlank?.(x, y, w, up);
      s = { rig, value, held: 0, show: false };
      (part === 'keep' ? this.scaffoldKeep : this.scaffoldWall).addChild(rig.root);
      this.scaffolds[part] = s;
    }
    s.value = value;
    s.held = 0;
    this.layoutScaffold(part);
    return s.show ? s.rig.raise(speed) : 0;
  }

  /** The masons take their scaffold down, from the top. Returns how long that takes (ms). */
  lowerScaffold(part: 'keep' | 'wall'): number {
    return this.scaffolds[part]?.rig.lower() ?? 0;
  }

  private tickScaffold(part: 'keep' | 'wall', dt: number): void {
    const s = this.scaffolds[part];
    if (!s || !s.rig.standing) return;
    this.layoutScaffold(part);
    s.rig.tick(dt);
    // Left standing too long (nothing took it down): it comes down by itself.
    if (s.rig.up && (s.held += dt) > SCAFFOLD_HOLD_MS) {
      s.held = 0;
      s.rig.lower();
    }
  }

  private layoutScaffold(part: 'keep' | 'wall'): void {
    const s = this.scaffolds[part];
    const b = this.bodies();
    const l = this.layoutValue;
    const crown = this.kit?.scaffold?.meta;
    if (!s || !b || !l) return;
    const body = b[part];
    const w = body.w * (part === 'keep' ? 0.82 : 0.7);
    // Built to the height the part is about to reach, not the one it has now.
    const h = (part === 'keep' ? s.value : Math.min(s.value, l.maxPoints)) * l.unit;
    s.show = h > body.w * 0.3;
    // The crane's platform sits near the top course; the crane and pulley rise above it.
    const above = crown ? ((crown.crown * w) / crown.shaftWidth) * 0.38 : 0;
    s.rig.layout(body.x + this.facing * body.w * 0.12, b.groundY + 2, w, h + above, this.facing < 0);
  }

  private dropScar(s: Scar): void {
    this.scars.splice(this.scars.indexOf(s), 1);
    s.sprite.destroy();
  }

  private clearScars(): void {
    for (const s of this.scars) s.sprite.destroy();
    this.scars = [];
  }

  /** Pins every wound to its part; one whose stones are gone is gone with them. */
  private layoutScars(): void {
    const b = this.bodies();
    if (!b) return;
    const kw = this.keepWidth;
    for (const s of [...this.scars]) {
      const body = b[s.part];
      const y = b.groundY - s.yk * kw;
      const w = body.w * s.size;
      // Lost with the courses that were knocked off.
      if (y - w * 0.3 < body.top) {
        this.dropScar(s);
        continue;
      }
      const tex = s.sprite.texture;
      s.sprite.scale.set((w / tex.width) * s.flip, w / tex.width);
      s.sprite.position.set(body.x + s.fx * body.w, y);
    }
  }

  /** The sky's light on the castle, so it sits in the same dusk, eclipse or storm as the land. */
  setAmbient(color: number): void {
    this.ambient = color;
    this.sceneryBack.tint = this.sceneryFront.tint = color;
    if (this.hitLeft <= 0) this.tint = color;
  }

  /** Flash of colour and a small recoil when struck. */
  hit(color: number, power = 1): void {
    this.hitColor = color;
    this.hitLeft = 260;
    this.kick = Math.min(10, 3 + power * 5);
    this.kickPhase = 0;
  }

  /** The whole castle shines, pulsing in `color`, for `ms` (its hero just fired the ultimate). */
  radiate(color: number, ms = 2800): void {
    this.radiance = { color, left: ms, total: ms };
    this.radianceFilter ??= new ColorMatrixFilter();
    this.applyFilters();
    this.tickRadiance(0);
  }

  /** Brightens the stones and washes them in the colour, with a quick rise, a pulse and a slow fade. */
  private tickRadiance(dt: number): void {
    const r = this.radiance;
    const f = this.radianceFilter;
    if (!r || !f) return;
    r.left -= dt;
    if (r.left <= 0) {
      this.radiance = null;
      this.applyFilters();
      return;
    }
    const t = 1 - r.left / r.total;
    const env = Math.min(1, t / 0.06) * Math.min(1, (1 - t) / 0.4);
    const k = env * (0.78 + 0.22 * Math.sin(t * Math.PI * 9));
    const add = (shift: number): number => (((r.color >> shift) & 255) / 255) * 0.26 * k + 0.03 * k;
    const b = 1 + 0.22 * k;
    f.matrix = [b, 0, 0, 0, add(16), 0, b, 0, 0, add(8), 0, 0, b, 0, add(0), 0, 0, 0, 1, 0];
  }

  /**
   * The castle's player is out: the hero's gravestone rises on the ruins
   * (`instant` for a resumed game or a layout change).
   */
  setFallen(on: boolean, instant = false): void {
    if (!on) {
      this.graveRise = -1;
      this.grave.clear();
      return;
    }
    if (this.graveRise >= 0 && !instant) return;
    this.graveRise = instant ? 1 : 0;
    this.drawGrave();
  }

  get fallen(): boolean {
    return this.graveRise >= 0;
  }

  private drawGrave(): void {
    const l = this.layoutValue;
    if (!l || this.graveRise < 0) return;
    drawTombstone(this.grave, this.style, this.bannerColor, l.keepWidth * 1.15);
    this.grave.position.set(l.x - this.facing * l.keepWidth * 0.12, l.groundY - 1);
    this.placeGrave();
  }

  /** Rises out of the ground with a small overshoot. */
  private placeGrave(): void {
    const t = Math.max(0, Math.min(1, this.graveRise));
    const c = 1.7;
    const e = t >= 1 ? 1 : 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    this.grave.scale.set(0.6 + 0.4 * Math.min(1, t * 1.6), Math.max(0.001, e));
    this.grave.alpha = Math.min(1, t * 3);
  }

  /** Ice over the stones while a resource is frozen. */
  setFrost(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    if (on && !this.frostFilter) {
      this.frostFilter = new ColorMatrixFilter();
      // Cooled and paled toward ice: part of each colour, part of its brightness, a lift of blue-white.
      this.frostFilter.matrix = [0.575, 0.148, 0.028, 0, 0.05, 0.09, 0.727, 0.033, 0, 0.09, 0.105, 0.207, 0.639, 0, 0.15, 0, 0, 0, 1, 0];
    }
    this.applyFilters();
    this.drawFrost();
  }

  /** The castle's colour grades: frost and the radiance of an ultimate, as they are on. */
  private applyFilters(): void {
    const list = [this.frozen ? this.frostFilter : null, this.radiance ? this.radianceFilter : null].filter((f): f is ColorMatrixFilter => !!f);
    this.filters = list.length ? list : [];
  }

  /** Scene position of the top of the Keep or the Wall (for projectiles and floating numbers). */
  anchor(target: 'keep' | 'wall' | 'base'): { x: number; y: number } {
    const l = this.layoutValue;
    if (!l) return { x: 0, y: 0 };
    if (target === 'base') return { x: l.x, y: l.groundY };
    if (target === 'keep') return { x: l.x, y: l.groundY - this.keepPx() - this.keepTower.crown * 0.6 };
    return { x: this.wallCx(), y: l.groundY - this.wallPx() };
  }

  /** Colours of this castle's falling stones: its masonry (a few shades), trim and roof. */
  debrisColors(): number[] {
    const s = this.style;
    const stone = (s.keepStone.base[0] << 16) | (s.keepStone.base[1] << 8) | s.keepStone.base[2];
    return [stone, darken(stone, 0.18), lighten(stone, 0.08), stone, s.trim, s.roof];
  }

  /** Top of the Keep's body and of the Wall in scene px, and their widths (for build and collapse effects). */
  bodies(): { keep: { x: number; top: number; w: number }; wall: { x: number; top: number; w: number }; groundY: number } | null {
    const l = this.layoutValue;
    if (!l) return null;
    return {
      keep: { x: l.x, top: l.groundY - this.keepPx(), w: l.keepWidth },
      wall: { x: this.wallCx(), top: l.groundY - this.wallPx(), w: this.wallW() },
      groundY: l.groundY,
    };
  }

  /** Scene positions of the top of every standing tower, Keep first (for flames, sparks and smoke). */
  towerTops(): { x: number; y: number; width: number }[] {
    if (!this.layoutValue) return [];
    const all = [this.keepTower, ...this.towers].filter((t) => t.h > 1 && t.root.visible);
    return all.map((t) => ({ x: t.cx, y: t.topY - t.crown, width: t.w }));
  }

  /** Called every frame: flags wave, fires flicker, the shield breathes. `calm` freezes ambient motion. */
  tick(dt: number, calm = false): void {
    if (this.hitLeft > 0) {
      this.hitLeft = Math.max(0, this.hitLeft - dt);
      const k = this.hitLeft / 260;
      const c = this.hitColor;
      const a = this.ambient;
      const ch = (shift: number): number => Math.round(((255 + (((c >> shift) & 255) - 255) * k) * ((a >> shift) & 255)) / 255) << shift;
      this.tint = ch(16) | ch(8) | ch(0);
    }
    let x = 0;
    if (this.kick > 0.05) {
      this.kickPhase += dt * 0.05;
      x = -this.facing * this.kick * Math.cos(this.kickPhase);
      this.kick *= 0.86;
    } else {
      this.kick = 0;
    }
    if (this.quake > 0.02 && !calm) {
      x += (Math.random() - 0.5) * this.quake * 2.4;
      this.quake *= 0.9;
    } else {
      this.quake = 0;
    }
    this.x = x;
    this.sceneryBack.visible = this.sceneryFront.visible = this.visible;
    for (const s of this.scars) if (s.age < 1) s.sprite.alpha = s.age = Math.min(1, s.age + dt / 220);
    this.tickScaffold('keep', dt);
    this.tickScaffold('wall', dt);
    if (!calm) this.phase += dt * 0.004;
    this.drawAnim(dt, calm);
    if (this.graveRise >= 0 && this.graveRise < 1) {
      this.graveRise = Math.min(1, this.graveRise + dt / 900);
      this.placeGrave();
    }
    if (this.shieldCharges > 0) this.tickShield(dt, calm);
    if (this.radiance) this.tickRadiance(dt);
  }

  // -------------------------------------------------------------------------
  // Structure
  // -------------------------------------------------------------------------

  private buildTowers(): void {
    this.keepTower?.destroy();
    for (const t of this.towers) t.destroy();
    for (const p of this.puffs) p.sprite.destroy();
    this.puffs = [];
    const s = this.style;
    const tex = styleTextures(s);
    const p = this.painted;
    this.wallStack?.destroy();
    this.wallStack = p?.wall ? new Stack(p.wall) : null;
    if (this.wallStack) this.wallLayer.addChildAt(this.wallStack.root, 0);
    this.ruinsSprite?.destroy();
    this.ruinsSprite = p?.ruins ? new Sprite(p.ruins) : null;
    if (this.ruinsSprite) {
      this.ruinsSprite.anchor.set(0.5, 1);
      this.ruinsSprite.visible = false;
      this.addChildAt(this.ruinsSprite, this.getChildIndex(this.rubble));
    }
    this.keepTower = new Tower({ roof: s.keep.roof, parapet: s.keep.parapet, round: !!s.keep.round, pennant: false }, true, -1, tex.keepStone, p?.keep ?? null);
    this.keepTower.mirror = this.facing < 0;
    this.keepLayer.addChild(this.keepTower.root);
    // Furthest towers first so nearer ones overlap them.
    const specs = s.towers.map((spec, i) => ({ spec, i })).sort((a, b) => b.spec.offset - a.spec.offset);
    this.towers = specs.map(({ spec, i }) => {
      // A painted castle without this back tower uses its Keep, smaller.
      const piece = p ? (p.towers[i] ?? p.keep) : null;
      const t = new Tower({ roof: spec.roof, parapet: spec.parapet, round: !!spec.round, pennant: !!spec.pennant }, false, i, tex.keepStone, piece);
      t.mirror = this.facing < 0;
      // Towers further back sit in the haze: a touch darker and bluer.
      const depth = Math.min(1, spec.offset / 1.4);
      t.root.tint = mix(0xffffff, 0x9aa2c0, 0.12 + depth * 0.22);
      (spec.front ? this.keepLayer : this.backLayer).addChild(t.root);
      return t;
    });
    // Windows, banners and ivy break up the repeating stones of the towers; the Wall wears only plants.
    if (p?.ornaments.length) {
      const seed = this.facing > 0 ? 3 : 11;
      this.keepTower.painted?.setOrnaments(p.ornaments, seed);
      for (const t of this.towers) t.painted?.setOrnaments(p.ornaments, seed + 5 + t.index * 7);
      this.wallStack?.setOrnaments(p.ornaments, seed + 29, 'wall');
    }
    this.invalidate();
  }

  private invalidate(): void {
    this.keepTower.invalidate();
    for (const t of this.towers) t.invalidate();
    this.wallKey = '';
    this.crackKey = '';
  }

  private keepPx(): number {
    const l = this.layoutValue!;
    return Math.max(0, this.keepValue) * l.unit;
  }

  private wallPx(): number {
    const l = this.layoutValue!;
    return Math.min(this.wallValue, l.maxPoints) * l.unit;
  }

  private wallW(): number {
    return this.style.wallWidth * this.layoutValue!.keepWidth;
  }

  private wallCx(): number {
    const l = this.layoutValue!;
    return l.x + this.facing * (l.keepWidth / 2 + l.keepWidth * 0.16 + this.wallW() / 2);
  }

  /** 0 healthy, 1 damaged, 2 crumbling, 3 fallen. */
  private damage(): number {
    const l = this.layoutValue!;
    const win = l.maxPoints / 1.1;
    if (this.keepValue <= 0) return 3;
    if (this.keepValue < win * 0.1) return 2;
    if (this.keepValue < win * 0.2) return 1;
    return 0;
  }

  private drawMound(): void {
    const l = this.layoutValue!;
    const g = this.mound.clear();
    const [dark, mid, light] = this.style.ground;
    const far = l.x - this.facing * l.keepWidth * 1.75;
    const near = this.wallCx() + this.facing * this.wallW() * 0.75;
    const cx = (far + near) / 2;
    const w = Math.abs(near - far);
    // Painted towers stand on their own patch of grass: only a soft contact shadow under them.
    if (this.painted) {
      // Trodden earth and spilled stones under the castle, then a soft shadow cast toward the viewer.
      const kw = l.keepWidth;
      for (let i = 0; i < 18; i++) {
        const x = cx + (hash(i * 3.3 + this.facing) - 0.5) * w * 1.05;
        const y = l.groundY + 3 + (hash(i * 5.1) - 0.3) * kw * 0.12;
        const rx = kw * (0.25 + hash(i * 1.7) * 0.4);
        g.ellipse(x, y, rx, rx * 0.16).fill({ color: i % 3 ? dark : mid, alpha: 0.18 + hash(i * 9.1) * 0.12 });
      }
      this.groundShadow.visible = true;
      this.groundShadow.anchor.set(0.5);
      this.groundShadow.width = w * 1.35;
      this.groundShadow.height = kw * 0.55;
      this.groundShadow.alpha = 0.9;
      this.groundShadow.position.set(cx, l.groundY + kw * 0.05);
      return;
    }
    this.groundShadow.visible = false;
    g.ellipse(cx, l.groundY + 5, w * 0.6, l.keepWidth * 0.3).fill({ color: dark });
    g.ellipse(cx, l.groundY + 2, w * 0.53, l.keepWidth * 0.2).fill({ color: mid });
    g.ellipse(cx - this.facing * w * 0.12, l.groundY, w * 0.36, l.keepWidth * 0.1).fill({ color: light, alpha: 0.7 });
    // A few boulders and tufts at the foot.
    for (let i = 0; i < 9; i++) {
      const x = cx + (hash(i + (this.facing > 0 ? 0 : 50)) - 0.5) * w * 1.05;
      const r = l.keepWidth * (0.035 + hash(i * 3.1) * 0.05);
      g.ellipse(x, l.groundY + 3 + hash(i * 7.7) * 4, r * 1.4, r).fill({ color: i % 2 ? light : dark, alpha: 0.85 });
    }
  }

  private redraw(): void {
    const l = this.layoutValue;
    if (!l) return;
    const dmg = this.damage();
    const fallen = dmg === 3;
    const kh = this.keepPx();

    // The Keep.
    this.keepTower.root.visible = !fallen;
    // The Keep keeps its crown until it falls; damage shows as cracks and scorch.
    if (!fallen) this.keepTower.setHeight(Math.max(kh, l.unit * 1.5), l.unit, false, (t, u) => this.drawTower(t, u));

    // Towers behind it follow the Keep, so the Keep always reads as the tallest.
    for (const t of this.towers) {
      const spec = this.style.towers[t.index];
      const stump = l.keepWidth * (0.35 + t.index * 0.12);
      let h = fallen ? stump : Math.max(l.unit * 2, kh * spec.ratio);
      // A painted back tower is scenery: it never sinks below its own base, so its door and windows stay whole.
      if (t.painted && !fallen) h = Math.max(h, t.painted.baseHeight(t.w) * 1.04);
      // Damage breaks the furthest towers first.
      const broken = fallen || dmg >= 2 || (dmg === 1 && t.index === 0);
      t.setHeight(h, l.unit, broken, (tw, u) => this.drawTower(tw, u));
    }

    this.drawWall(l);
    if (fallen) this.clearScars();
    // A painted castle wears painted wounds, and only those of blows it has taken: none at the start
    // of a game (nor while it rises from the ground), however low it stands.
    if (this.painted && this.kit && !fallen) {
      this.cracks.clear();
      this.crackKey = '';
    } else {
      this.drawCracks(l, dmg);
    }
    this.layoutScars();
    this.drawRubble(l, fallen);
    if (this.graveRise >= 0) this.drawGrave();
    if (this.shieldCharges > 0) this.drawShield();
    if (this.frozen) this.drawFrost();
  }

  // -------------------------------------------------------------------------
  // Tower drawing
  // -------------------------------------------------------------------------

  private drawTower(t: Tower, unit: number): void {
    const s = this.style;
    const w = t.w;
    const h = t.h;
    const g = t.details.clear();
    const top = t.top.clear();
    const decor = t.decor.clear();
    const gy = t.groundY;
    const left = t.cx - w / 2;

    // A painted tower brings its own stone, windows and crown: only a break is drawn.
    if (t.painted) {
      if (t.broken) {
        const crown = this.drawBrokenTop(top, t, unit);
        t.crown = crown.height;
        t.apex = crown.apex;
        t.apexX = 0;
      }
      return;
    }

    // Plinth: a slightly wider base course.
    const plinth = Math.min(h, w * 0.14);
    g.rect(left - w * 0.04, gy - plinth, w * 1.08, plinth).fill({ color: darken(s.trim, 0.25) });
    g.rect(left - w * 0.04, gy - plinth, w * 1.08, Math.max(1, plinth * 0.2)).fill({ color: s.trim, alpha: 0.6 });

    // Crown first: we need its height to keep windows clear of it.
    const crown = t.broken ? this.drawBrokenTop(top, t, unit) : this.drawCrown(top, decor, t);
    t.crown = crown.height;
    t.apex = crown.apex;

    // String courses for square towers, ring bands for round ones.
    const band = Math.max(1.5, w * 0.035);
    const floor = Math.max(unit * 11, w * 0.8);
    for (let y = gy - floor; y > gy - h + w * 0.35; y -= floor) {
      g.rect(left, y, w, band).fill({ color: s.trimShade, alpha: 0.55 });
      g.rect(left, y, w, band * 0.4).fill({ color: s.trim, alpha: 0.35 });
    }

    // Windows.
    const cols = t.isKeep ? (s.windowKind === 'slit' ? [0] : [-0.22, 0.22]) : [0];
    const ww = Math.max(2.5, w * (t.isKeep ? 0.11 : 0.16));
    const step = floor;
    const firstFloor = t.isKeep ? gy - Math.max(unit * 10, w * 0.62) : gy - floor * (0.55 + t.index * 0.2);
    const winH = ww * (s.windowKind === 'slit' ? 2.8 : s.windowKind === 'round' ? 1.3 : 2.2) + band * 2;
    for (let y = firstFloor, row = 0; y - winH > gy - h + w * 0.22; y -= step, row++) {
      for (const off of cols) this.drawWindow(g, s.windowKind, t.cx + off * w, y - band * 2, ww, row);
    }

    if (t.isKeep) this.drawKeepFace(g, t, unit);
  }

  private drawWindow(g: Graphics, kind: WindowKind, cx: number, bottom: number, ww: number, row: number): void {
    const s = this.style;
    const frame = darken(s.trimShade, 0.35);
    const wh = ww * (kind === 'round' ? 1 : kind === 'slit' ? 2.8 : 2.1);
    const x = cx - ww / 2;
    const y = bottom - wh;
    const lit = hash(row * 13.7 + cx) > 0.18;
    const light = lit ? s.window : darken(s.window, 0.7);
    switch (kind) {
      case 'round': {
        const r = ww * 0.62;
        g.circle(cx, y + r, r + Math.max(1.2, ww * 0.18)).fill({ color: s.metal });
        g.circle(cx, y + r, r).fill({ color: light });
        g.circle(cx, y + r * 1.25, r * 0.6).fill({ color: s.windowCore, alpha: 0.5 });
        g.moveTo(cx - r, y + r).lineTo(cx + r, y + r).stroke({ width: 1, color: darken(s.metal, 0.4), alpha: 0.8 });
        return;
      }
      case 'slit': {
        const sw = Math.max(1.6, ww * 0.34);
        g.rect(cx - sw / 2 - 1, y - 1, sw + 2, wh + 2).fill({ color: frame });
        g.rect(cx - sw / 2, y, sw, wh).fill({ color: light, alpha: 0.9 });
        g.rect(cx - ww * 0.42, y + wh * 0.42, ww * 0.84, sw * 0.8).fill({ color: light, alpha: 0.9 });
        return;
      }
      case 'lancet': {
        const pts = [x, bottom, x, y + ww * 0.6, cx, y - ww * 0.15, x + ww, y + ww * 0.6, x + ww, bottom];
        g.poly(pts.map((v, i) => (i % 2 ? v + (i === 5 ? -1.5 : 0) : v + (v < cx ? -1.2 : 1.2)))).fill({ color: frame });
        g.poly(pts).fill({ color: light });
        g.rect(x, bottom - wh * 0.4, ww, wh * 0.4).fill({ color: s.windowCore, alpha: 0.45 });
        return;
      }
      case 'square': {
        g.rect(x - 1.5, y - 1.5, ww + 3, wh + 3).fill({ color: frame });
        g.rect(x, y, ww, wh).fill({ color: light });
        g.rect(x, y + wh * 0.55, ww, wh * 0.45).fill({ color: s.windowCore, alpha: 0.4 });
        // Wooden shutters.
        g.rect(x - ww * 0.55, y, ww * 0.5, wh).fill({ color: s.wood });
        g.moveTo(x - ww * 0.3, y).lineTo(x - ww * 0.3, y + wh).stroke({ width: 1, color: darken(s.wood, 0.4) });
        g.moveTo(cx, y).lineTo(cx, y + wh).stroke({ width: 1, color: frame, alpha: 0.8 });
        return;
      }
      default: {
        g.roundRect(x - 1.5, y - 1.5, ww + 3, wh + 3, ww / 2 + 1).fill({ color: frame });
        g.roundRect(x, y, ww, wh, ww / 2).fill({ color: light });
        g.roundRect(x, y + wh * 0.55, ww, wh * 0.45, 1).fill({ color: s.windowCore, alpha: 0.45 });
        g.moveTo(cx, y + ww * 0.3).lineTo(cx, bottom).stroke({ width: 1, color: frame, alpha: 0.7 });
        // Sill.
        g.rect(x - ww * 0.2, bottom, ww * 1.4, Math.max(1.5, ww * 0.18)).fill({ color: s.trim, alpha: 0.85 });
      }
    }
  }

  /** Door, banners, emblems and fittings on the front of the Keep. */
  private drawKeepFace(g: Graphics, t: Tower, unit: number): void {
    const s = this.style;
    const w = t.w;
    const h = t.h;
    const gy = t.groundY;
    const cx = t.cx;
    const crownGap = t.crown * 0.55 + w * 0.06;

    // Door.
    const dw = w * 0.28;
    const dh = Math.min(h * 0.7, w * 0.44);
    if (dh > unit * 2) {
      const x = cx - dw / 2;
      g.roundRect(x - dw * 0.14, gy - dh - dw * 0.14, dw * 1.28, dh + dw * 0.14, dw * 0.64).fill({ color: s.trim });
      g.roundRect(x, gy - dh, dw, dh, dw / 2).fill({ color: 0x1a120c });
      g.roundRect(x + 1.5, gy - dh + 1.5, dw - 3, dh - 1.5, dw / 2).fill({ color: darken(s.wood, 0.1) });
      for (let i = 1; i < 4; i++) g.moveTo(x + (dw * i) / 4, gy - dh + dw * 0.25).lineTo(x + (dw * i) / 4, gy).stroke({ width: 1, color: darken(s.wood, 0.5), alpha: 0.8 });
      g.rect(x, gy - dh * 0.55, dw, Math.max(1.5, dw * 0.08)).fill({ color: darken(s.metal, 0.3) });
      g.circle(cx + dw * 0.26, gy - dh * 0.4, Math.max(1, dw * 0.06)).fill({ color: s.metal });
      // Steps.
      g.rect(x - dw * 0.2, gy - Math.max(2, unit * 0.6), dw * 1.4, Math.max(2, unit * 0.6)).fill({ color: darken(s.trim, 0.15) });
    }

    // Signature details on the face of the Keep.
    const faceTop = gy - h + crownGap;
    const faceH = h - crownGap - dh - w * 0.1;
    if (s.signature === 'braziers' && faceH > w * 0.3) {
      // Long war banners hanging from the parapet.
      const len = Math.min(faceH, w * 1.7);
      for (const off of [-0.29, 0.29]) {
        const bx = cx + off * w;
        const bw = w * 0.2;
        g.rect(bx - bw / 2 - bw * 0.12, faceTop - bw * 0.1, bw * 1.24, bw * 0.16).fill({ color: s.metal });
        g.poly([bx - bw / 2, faceTop, bx + bw / 2, faceTop, bx + bw / 2, faceTop + len, bx, faceTop + len - bw * 0.45, bx - bw / 2, faceTop + len]).fill({ color: this.bannerColor });
        g.poly([bx + bw * 0.1, faceTop, bx + bw / 2, faceTop, bx + bw / 2, faceTop + len, bx + bw * 0.1, faceTop + len - bw * 0.3]).fill({ color: 0x000000, alpha: 0.22 });
        g.rect(bx - bw / 2, faceTop + bw * 0.3, bw, Math.max(1, bw * 0.08)).fill({ color: s.metal, alpha: 0.9 });
        g.rect(bx - bw / 2, faceTop + len - bw * 1.1, bw, Math.max(1, bw * 0.08)).fill({ color: s.metal, alpha: 0.9 });
      }
    }
    if (s.signature === 'shield' && faceH > w * 0.62) {
      // A great plain tower shield mounted on the Keep.
      const sw = w * 0.42;
      const sh = sw * 1.25;
      const sy = faceTop + w * 0.06;
      const shieldPath = (gr: Graphics, inset: number, color: number): void => {
        const x0 = cx - sw / 2 + inset;
        const x1 = cx + sw / 2 - inset;
        const y0 = sy + inset;
        const y1 = sy + sh - inset;
        gr.moveTo(x0, y0)
          .lineTo(x1, y0)
          .lineTo(x1, y0 + (y1 - y0) * 0.45)
          .quadraticCurveTo(x1, y1 - (y1 - y0) * 0.12, cx, y1)
          .quadraticCurveTo(x0, y1 - (y1 - y0) * 0.12, x0, y0 + (y1 - y0) * 0.45)
          .closePath()
          .fill({ color });
      };
      shieldPath(g, -Math.max(1.5, sw * 0.04), darken(s.trimShade, 0.3));
      shieldPath(g, 0, s.metal);
      shieldPath(g, sw * 0.08, this.bannerColor);
      // A plain chevron and a boss: no symbols.
      const cy = sy + sh * 0.5;
      const cwid = sw * 0.34;
      g.poly([cx - cwid, cy + sw * 0.16, cx, cy - sw * 0.14, cx + cwid, cy + sw * 0.16, cx + cwid, cy + sw * 0.3, cx, cy, cx - cwid, cy + sw * 0.3]).fill({ color: s.metal, alpha: 0.95 });
      g.circle(cx, sy + sh * 0.24, sw * 0.09).fill({ color: lighten(s.metal, 0.4) });
    }
    if (s.signature === 'smoke') {
      // Brass pipes from the laboratory tower into the Keep.
      const lab = this.towers.find((tw) => tw.index === 1);
      if (lab) {
        const py = gy - Math.min(h, lab.h) * 0.55;
        const pr = Math.max(1.5, w * 0.045);
        if (py < gy - dh - pr * 3) {
          const x0 = cx;
          const x1 = lab.cx;
          g.rect(Math.min(x0, x1), py - pr, Math.abs(x1 - x0), pr * 2).fill({ color: darken(s.metal, 0.25) });
          g.rect(Math.min(x0, x1), py - pr, Math.abs(x1 - x0), pr * 0.6).fill({ color: lighten(s.metal, 0.35), alpha: 0.8 });
          const jx = cx - this.facing * w * 0.32;
          g.rect(jx - pr * 1.6, py - pr * 1.6, pr * 3.2, pr * 3.2).fill({ color: s.metal });
          g.circle(jx, py, pr * 0.8).fill({ color: darken(s.metal, 0.4) });
          // A gauge.
          g.circle(jx, py - pr * 4, pr * 2.2).fill({ color: s.metal });
          g.circle(jx, py - pr * 4, pr * 1.6).fill({ color: 0xf6f0d8 });
          g.moveTo(jx, py - pr * 4).lineTo(jx + pr * 1.1, py - pr * 4.9).stroke({ width: 1, color: 0x7a1a10 });
          g.rect(jx - pr * 0.4, py - pr * 2, pr * 0.8, pr * 0.8).fill({ color: s.metal });
        }
      }
    }
    if (s.signature === 'lanterns') {
      // Timber patches nailed over cracked stone.
      for (let i = 0; i < 3; i++) {
        const py = gy - h * (0.25 + i * 0.22);
        if (py < gy - dh - w * 0.2 && py > faceTop + w * 0.2) {
          const px = cx + (i % 2 ? 0.18 : -0.24) * w;
          const pw = w * 0.22;
          const ph = w * 0.12;
          g.rect(px - pw / 2, py, pw, ph).fill({ color: s.wood });
          g.rect(px - pw / 2, py + ph * 0.45, pw, 1).fill({ color: darken(s.wood, 0.5), alpha: 0.7 });
          for (const nx of [-0.38, 0.38]) g.circle(px + nx * pw, py + ph * 0.25, 0.9).fill({ color: 0x1a1410 });
        }
      }
    }
    if (s.signature === 'orb') {
      // Glowing bands around the round sorcery tower.
      for (let y = gy - w * 1.6; y > faceTop + w * 0.3; y -= w * 1.6) {
        g.rect(t.cx - w / 2, y, w, Math.max(1.2, w * 0.025)).fill({ color: s.window, alpha: 0.55 });
      }
    }
    if (s.signature === 'crane' && faceH > w * 0.6) {
      // Wooden scaffolding up one side, as if the Architect is still adding floors.
      const sx = cx + this.facing * w * 0.56;
      const top = Math.max(faceTop, gy - h * 0.62);
      const pole = Math.max(1.2, w * 0.03);
      g.rect(sx - pole / 2, top, pole, gy - top).fill({ color: s.wood });
      g.rect(sx + this.facing * w * 0.12 - pole / 2, top + w * 0.1, pole, gy - top - w * 0.1).fill({ color: darken(s.wood, 0.2) });
      for (let y = gy - w * 0.32; y > top; y -= w * 0.32) {
        g.rect(Math.min(sx, sx + this.facing * w * 0.14) - pole, y, w * 0.14 + pole * 2, pole).fill({ color: lighten(s.wood, 0.15) });
      }
    }
  }

  /** Parapet and roof, relative to the centre of the body top. Returns crown height and roof apex (negative). */
  private drawCrown(g: Graphics, decor: Graphics, t: Tower): { height: number; apex: number } {
    const s = this.style;
    const w = t.w;
    const { roofBase, top } = this.drawParapet(g, t.shape.parapet, w, t.isKeep);
    let apex = top;
    if (t.shape.roof !== 'flat') apex = this.drawRoof(g, t.shape.roof, w, roofBase, t.isKeep);
    // Re-draw the front merlons over the roof eaves.
    if (t.shape.roof !== 'flat' && (t.shape.parapet === 'merlons' || t.shape.parapet === 'swallow' || t.shape.parapet === 'machicolated' || t.shape.parapet === 'round')) {
      this.drawMerlons(g, t.shape.parapet, w, t.isKeep);
    }
    if (t.shape.roof === 'flat' && t.index === 0 && s.signature === 'smoke') {
      // The alchemist's chimney.
      const cw = w * 0.34;
      const ch = w * 0.7;
      g.rect(-cw / 2, top - ch, cw, ch + w * 0.1).fill({ color: darken(s.keepStone.base[0] << 16 | s.keepStone.base[1] << 8 | s.keepStone.base[2], 0.1) });
      g.rect(-cw / 2 - cw * 0.12, top - ch, cw * 1.24, cw * 0.28).fill({ color: s.trim });
      g.rect(cw * 0.15, top - ch + cw * 0.28, cw * 0.35, ch - cw * 0.2).fill({ color: 0x000000, alpha: 0.2 });
      apex = top - ch;
    }
    void decor;
    return { height: -top, apex };
  }

  private drawParapet(g: Graphics, kind: ParapetKind, w: number, isKeep: boolean): { roofBase: number; top: number } {
    const s = this.style;
    const band = w * (isKeep ? 0.2 : 0.18);
    const lip = w * 0.08;
    const trim = s.trim;
    const shade = s.trimShade;
    switch (kind) {
      case 'cornice': {
        const lw = w + lip * 1.2;
        g.rect(-lw / 2, -band * 0.75, lw, band * 0.75).fill({ color: trim });
        g.rect(-lw / 2, -band * 0.2, lw, band * 0.2).fill({ color: shade, alpha: 0.8 });
        g.rect(-lw / 2 - lip * 0.3, -band * 0.95, lw + lip * 0.6, band * 0.25).fill({ color: lighten(trim, 0.1) });
        // Dentils.
        const n = Math.max(4, Math.round(w / 8));
        for (let i = 0; i < n; i++) {
          const x = -lw / 2 + ((i + 0.5) * lw) / n;
          g.rect(x - lw / n / 4, -band * 0.2, lw / n / 2, band * 0.35).fill({ color: shade, alpha: 0.7 });
        }
        return { roofBase: -band * 0.9, top: -band * 0.95 };
      }
      case 'hoarding': {
        // A wooden gallery overhanging the stone, on diagonal braces.
        const hw = w + lip * 3;
        const hh = band * 1.5;
        for (const side of [-1, 1]) {
          g.moveTo(side * (w / 2), band * 0.9)
            .lineTo(side * (hw / 2 - lip * 0.2), -hh * 0.05)
            .stroke({ width: Math.max(1.5, w * 0.04), color: darken(s.wood, 0.2) });
        }
        g.rect(-hw / 2, -hh, hw, hh).fill({ color: s.wood });
        const planks = Math.max(4, Math.round(hw / 6));
        for (let i = 1; i < planks; i++) {
          const x = -hw / 2 + (hw * i) / planks;
          g.moveTo(x, -hh).lineTo(x, 0).stroke({ width: 1, color: darken(s.wood, 0.45), alpha: 0.7 });
        }
        // Arrow slits in the planks.
        for (const x of [-0.25, 0.25]) g.rect(x * hw - 1, -hh * 0.7, 2, hh * 0.45).fill({ color: 0x120c08 });
        g.rect(-hw / 2, -hh, hw, Math.max(1.5, hh * 0.12)).fill({ color: lighten(s.wood, 0.2) });
        g.rect(-hw / 2, -Math.max(1.5, hh * 0.14), hw, Math.max(1.5, hh * 0.14)).fill({ color: 0x000000, alpha: 0.35 });
        return { roofBase: -hh * 0.92, top: -hh };
      }
      default: {
        const machi = kind === 'machicolated';
        const lw = w + lip * (machi ? 2.6 : 2);
        if (machi) {
          // Corbels under a projecting gallery.
          const n = Math.max(4, Math.round(w / 12));
          for (let i = 0; i < n; i++) {
            const x = -lw / 2 + ((i + 0.5) * lw) / n;
            const cw = (lw / n) * 0.55;
            g.poly([x - cw / 2, -band * 0.1, x + cw / 2, -band * 0.1, x + cw * 0.2, band * 0.5, x - cw * 0.2, band * 0.5]).fill({ color: darken(trim, 0.12) });
            g.rect(x + cw / 2, -band * 0.1, (lw / n) * 0.45, band * 0.35).fill({ color: 0x0c0a08, alpha: 0.75 });
          }
        }
        g.rect(-lw / 2, -band, lw, band * (machi ? 0.95 : 1)).fill({ color: trim });
        g.rect(-lw / 2, -band * 0.28, lw, band * 0.28).fill({ color: shade, alpha: 0.55 });
        g.rect(-lw / 2, -band, lw, Math.max(1, band * 0.12)).fill({ color: lighten(trim, 0.2), alpha: 0.8 });
        const mh = this.drawMerlons(g, kind, w, isKeep);
        return { roofBase: -band - mh * 0.45, top: -band - mh };
      }
    }
  }

  /** Merlons along the parapet. Returns their height. */
  private drawMerlons(g: Graphics, kind: ParapetKind, w: number, isKeep: boolean): number {
    const s = this.style;
    const band = w * (isKeep ? 0.2 : 0.18);
    const lip = w * 0.08;
    const lw = w + lip * (kind === 'machicolated' ? 2.6 : 2);
    let n = Math.max(3, Math.round(lw / 13));
    if (n % 2 === 0) n += 1;
    const mw = lw / (n * 2 - 1);
    const mh = Math.min(mw * 1.25, band * 1.1);
    for (let i = 0; i < n; i++) {
      const x = -lw / 2 + i * mw * 2;
      const y = -band - mh;
      if (kind === 'swallow') {
        const notch = mw * 0.45;
        g.poly([x, -band, x, y, x + mw / 2, y + notch, x + mw, y, x + mw, -band]).fill({ color: s.trim });
        g.poly([x + mw * 0.72, -band, x + mw * 0.72, y + notch * 0.5, x + mw, y, x + mw, -band]).fill({ color: 0x000000, alpha: 0.2 });
      } else if (kind === 'round') {
        g.moveTo(x, -band)
          .lineTo(x, y + mw / 2)
          .arc(x + mw / 2, y + mw / 2, mw / 2, Math.PI, Math.PI * 2)
          .lineTo(x + mw, -band)
          .closePath()
          .fill({ color: s.trim });
        g.rect(x + mw * 0.7, y + mw / 2, mw * 0.3, mh - mw / 2).fill({ color: 0x000000, alpha: 0.18 });
      } else {
        g.rect(x, y, mw, mh).fill({ color: s.trim });
        g.rect(x, y, mw, Math.max(1, mh * 0.14)).fill({ color: lighten(s.trim, 0.25), alpha: 0.8 });
        g.rect(x + mw * 0.7, y, mw * 0.3, mh).fill({ color: 0x000000, alpha: 0.18 });
      }
    }
    return mh;
  }

  /** Roof on top of the parapet. Returns the apex y. */
  private drawRoof(g: Graphics, kind: RoofKind, w: number, base: number, isKeep: boolean): number {
    const s = this.style;
    const roof = s.roof;
    const dark = s.roofShade;
    const lines = (half: number, h: number, rows: number): void => {
      for (let i = 1; i < rows; i++) {
        const y = base - (h * i) / rows;
        const hw = half * (1 - i / rows);
        g.moveTo(-hw, y).lineTo(hw, y).stroke({ width: 1, color: dark, alpha: 0.35 });
      }
    };
    const finial = (y: number, size: number): void => {
      g.rect(-0.8, y - size * 1.6, 1.6, size * 1.8).fill({ color: s.metal });
      g.circle(0, y - size * 0.2, size * 0.45).fill({ color: s.metal });
      g.circle(-size * 0.12, y - size * 0.32, size * 0.15).fill({ color: 0xffffff, alpha: 0.6 });
    };
    switch (kind) {
      case 'cone':
      case 'spire':
      case 'lowcone': {
        const half = w * (kind === 'spire' ? 0.44 : kind === 'lowcone' ? 0.66 : 0.58);
        const h = w * (kind === 'spire' ? 1.35 : kind === 'lowcone' ? 0.58 : 1.0);
        const apex = base - h;
        g.poly([-half, base, 0, apex, half, base]).fill({ color: roof });
        // Shaded right side and a light rim on the left.
        g.poly([0, apex, half, base, half * 0.15, base]).fill({ color: dark, alpha: 0.4 });
        g.poly([0, apex, -half, base, -half * 0.8, base]).fill({ color: lighten(roof, 0.35), alpha: 0.35 });
        lines(half, h, kind === 'spire' ? 8 : 6);
        // Vertical seams.
        for (const k of [-0.5, 0.5]) g.moveTo(0, apex).lineTo(k * half, base).stroke({ width: 1, color: dark, alpha: 0.25 });
        // Eave.
        g.rect(-half - 1, base - Math.max(1.5, w * 0.03), half * 2 + 2, Math.max(2, w * 0.05)).fill({ color: darken(roof, 0.35) });
        if (kind === 'spire') {
          // A metal ring partway up.
          const ry = base - h * 0.42;
          const rw = half * 0.58;
          g.rect(-rw, ry, rw * 2, Math.max(1.5, w * 0.05)).fill({ color: s.metal });
          // Small dormer window.
          g.poly([-w * 0.08, base - h * 0.1, 0, base - h * 0.25, w * 0.08, base - h * 0.1]).fill({ color: darken(roof, 0.4) });
          g.rect(-w * 0.04, base - h * 0.17, w * 0.08, h * 0.07).fill({ color: s.window, alpha: 0.9 });
        }
        finial(apex, Math.max(3, w * 0.09));
        return apex - Math.max(3, w * 0.09) * 1.5;
      }
      case 'dome':
      case 'onion': {
        const r = w * (kind === 'onion' ? 0.5 : 0.48);
        const h = w * (kind === 'onion' ? 1.0 : 0.5);
        const apex = base - h;
        if (kind === 'onion') {
          // A drum under the bulb.
          g.rect(-r * 0.78, base - w * 0.12, r * 1.56, w * 0.14).fill({ color: s.trim });
          const b = base - w * 0.1;
          const path = (gr: Graphics, sc: number): Graphics =>
            gr
              .moveTo(-r * 0.8 * sc, b)
              .bezierCurveTo(-r * 1.3 * sc, b - h * 0.4, -r * 0.18 * sc, b - h * 0.62, 0, apex)
              .bezierCurveTo(r * 0.18 * sc, b - h * 0.62, r * 1.3 * sc, b - h * 0.4, r * 0.8 * sc, b)
              .closePath();
          path(g, 1).fill({ color: roof });
          g.moveTo(0, apex)
            .bezierCurveTo(r * 0.18, b - h * 0.62, r * 1.3, b - h * 0.4, r * 0.8, b)
            .lineTo(r * 0.2, b)
            .bezierCurveTo(r * 0.5, b - h * 0.4, r * 0.08, b - h * 0.62, 0, apex)
            .fill({ color: dark, alpha: 0.4 });
          g.moveTo(0, apex)
            .bezierCurveTo(-r * 0.18, b - h * 0.62, -r * 1.3, b - h * 0.4, -r * 0.8, b)
            .lineTo(-r * 0.62, b)
            .bezierCurveTo(-r * 1.0, b - h * 0.4, -r * 0.12, b - h * 0.62, 0, apex)
            .fill({ color: lighten(roof, 0.4), alpha: 0.35 });
          // Brass ribs.
          for (const k of [-0.45, 0, 0.45]) {
            g.moveTo(0, apex).quadraticCurveTo(k * r * 1.6, b - h * 0.45, k * r * 0.9, b).stroke({ width: 1.2, color: s.metal, alpha: 0.75 });
          }
          finial(apex, Math.max(3, w * 0.09));
          return apex - Math.max(3, w * 0.09) * 1.5;
        }
        g.moveTo(-r, base).arc(0, base, r, Math.PI, Math.PI * 2).closePath().fill({ color: roof });
        g.moveTo(0, base - r).arc(0, base, r, Math.PI * 1.5, Math.PI * 2).lineTo(r * 0.2, base).closePath().fill({ color: dark, alpha: 0.35 });
        for (const k of [-0.55, 0, 0.55]) g.moveTo(0, base - r).quadraticCurveTo(k * r * 1.2, base - r * 0.7, k * r, base).stroke({ width: 1, color: s.metal, alpha: 0.6 });
        // Glass lantern on top.
        const lw = r * 0.4;
        g.rect(-lw / 2, base - r - lw * 0.9, lw, lw).fill({ color: s.window, alpha: 0.95 });
        g.rect(-lw / 2 - 1, base - r - lw * 0.9, lw + 2, Math.max(1.5, lw * 0.2)).fill({ color: s.metal });
        g.poly([-lw * 0.65, base - r - lw * 0.9, 0, base - r - lw * 1.6, lw * 0.65, base - r - lw * 0.9]).fill({ color: roof });
        finial(base - r - lw * 1.6, Math.max(2.5, w * 0.07));
        return base - r - lw * 1.6 - Math.max(2.5, w * 0.07) * 1.5;
      }
      case 'shingle': {
        // A steep, slightly crooked shingled roof.
        const half = w * 0.66;
        const h = w * 0.82;
        const lean = w * 0.06 * (isKeep ? 1 : -1);
        const apex = base - h;
        g.poly([-half, base, -w * 0.08 + lean, apex, w * 0.08 + lean, apex, half, base]).fill({ color: roof });
        g.poly([w * 0.08 + lean, apex, half, base, w * 0.1, base]).fill({ color: dark, alpha: 0.4 });
        const rows = 6;
        for (let i = 1; i < rows; i++) {
          const y = base - (h * i) / rows;
          const k = i / rows;
          const xl = -half + (half - w * 0.08 + lean) * k;
          const xr = half - (half - w * 0.08 - lean) * k;
          g.moveTo(xl, y).lineTo(xr, y).stroke({ width: 1, color: dark, alpha: 0.45 });
          // Staggered shingle joints.
          for (let x = xl + (i % 2 ? 3 : 6); x < xr - 2; x += 6) g.moveTo(x, y).lineTo(x, y + h / rows).stroke({ width: 1, color: dark, alpha: 0.2 });
        }
        g.rect(-half - 1, base - 2, half * 2 + 2, 3).fill({ color: darken(roof, 0.4) });
        // Ridge pole sticking out.
        g.rect(-w * 0.14 + lean, apex - 1.5, w * 0.28, 3).fill({ color: s.wood });
        return apex;
      }
      default:
        return base;
    }
  }

  /** A jagged stump where the crown has fallen. */
  private drawBrokenTop(g: Graphics, t: Tower, unit: number): { height: number; apex: number } {
    const w = t.w;
    const s = this.style;
    const pts: number[] = [-w / 2, w * 0.06];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + (w * i) / n;
      const y = -(hash(i + t.index * 7 + (this.facing > 0 ? 0 : 3)) * w * 0.28);
      pts.push(x, y);
    }
    pts.push(w / 2, w * 0.06);
    // Cover the body's flat top with stone-coloured jags, outlined dark.
    const stoneColor = (s.keepStone.base[0] << 16) | (s.keepStone.base[1] << 8) | s.keepStone.base[2];
    g.poly(pts).fill({ color: darken(stoneColor, 0.1) });
    g.poly(pts).stroke({ width: 1.2, color: 0x1a1410, alpha: 0.6 });
    // Scorch below the break.
    g.rect(-w / 2, 0, w, w * 0.3).fill({ color: 0x1a1410, alpha: 0.28 });
    void unit;
    return { height: w * 0.1, apex: -w * 0.28 };
  }

  // -------------------------------------------------------------------------
  // Wall
  // -------------------------------------------------------------------------

  private drawWall(l: CastleLayout): void {
    const s = this.style;
    const wh = this.wallPx();
    const w = this.wallW();
    const cx = this.wallCx();
    const x = cx - w / 2;
    const y = l.groundY - wh;
    const standing = wh > 0.5;
    if (this.wallStack) {
      this.wallBody.visible = this.wallShade.visible = this.wallTop.visible = false;
      this.wallStack.layout(cx, l.groundY, w, wh, this.facing < 0, true);
      const key = `p|${standing}|${w}`;
      if (key === this.wallKey) return;
      this.wallKey = key;
      const g = this.wallDetails.clear();
      this.wallTop.clear();
      // Just the foundation stones when it is down.
      if (!standing) {
        for (let i = 0; i < 7; i++) {
          const sx = x + (w * (i + 0.5)) / 7;
          const r = w * 0.06;
          g.roundRect(sx - r, l.groundY - r * 0.9, r * 2, r * 0.9, 1.5).fill({ color: mix(s.trim, 0x000000, 0.35 + hash(i) * 0.2) });
        }
      }
      return;
    }
    this.wallBody.visible = this.wallShade.visible = this.wallTop.visible = standing;
    this.wallBody.position.set(x, y);
    this.wallBody.width = w;
    this.wallBody.height = Math.max(1, wh);
    this.wallBody.tilePosition.y = wh;
    this.wallShade.position.set(x, y);
    this.wallShade.width = w;
    this.wallShade.height = Math.max(1, wh);
    this.wallTop.position.set(cx, y);

    const key = `${Math.round(wh / l.unit)}|${w}|${l.unit}|${this.bannerColor}`;
    if (key === this.wallKey) return;
    this.wallKey = key;
    const g = this.wallDetails.clear();
    const top = this.wallTop.clear();

    if (!standing) {
      // Just the foundation stones.
      for (let i = 0; i < 7; i++) {
        const sx = x + (w * (i + 0.5)) / 7;
        const r = w * 0.06;
        g.roundRect(sx - r, l.groundY - r * 0.9, r * 2, r * 0.9, 1.5).fill({ color: mix(s.trim, 0x000000, 0.35 + hash(i) * 0.2) });
      }
      return;
    }

    // Buttresses at both ends give the wall depth.
    const bw = Math.max(2, w * 0.1);
    for (const side of [-1, 1]) {
      const bx = side < 0 ? x - bw * 0.4 : x + w - bw * 0.6;
      g.rect(bx, y + Math.min(wh * 0.15, w * 0.08), bw, wh - Math.min(wh * 0.15, w * 0.08)).fill({ color: darken(s.trim, 0.3) });
      g.rect(bx, y + Math.min(wh * 0.15, w * 0.08), bw * 0.35, wh).fill({ color: lighten(s.trim, 0.1), alpha: 0.35 });
    }
    // Gate when there is room for one.
    const gw = w * 0.3;
    const gh = Math.min(wh * 0.6, gw * 1.55);
    if (gh > gw * 1.1) {
      g.roundRect(cx - gw / 2 - gw * 0.12, l.groundY - gh - gw * 0.12, gw * 1.24, gh + gw * 0.12, gw * 0.62).fill({ color: s.trim });
      g.roundRect(cx - gw / 2, l.groundY - gh, gw, gh, gw / 2).fill({ color: 0x120c08 });
      // Portcullis.
      for (let i = 1; i < 4; i++) g.moveTo(cx - gw / 2 + (gw * i) / 4, l.groundY - gh + gw * 0.15).lineTo(cx - gw / 2 + (gw * i) / 4, l.groundY).stroke({ width: 1.2, color: darken(s.metal, 0.45) });
      for (let yy = l.groundY - gh + gw * 0.55; yy < l.groundY; yy += gw * 0.28) g.moveTo(cx - gw / 2 + 1, yy).lineTo(cx + gw / 2 - 1, yy).stroke({ width: 1.2, color: darken(s.metal, 0.45) });
    }
    // Arrow slits higher up.
    for (let yy = l.groundY - Math.max(gh + w * 0.3, w * 0.45); yy > y + w * 0.3; yy -= w * 0.6) {
      for (const off of [-0.3, 0.3]) g.rect(cx + off * w - 1, yy - w * 0.14, 2, w * 0.14).fill({ color: 0x120c08, alpha: 0.85 });
    }

    // Walkway and top, relative to the top centre.
    const lip = Math.max(2, w * 0.04);
    const walk = Math.max(2, w * 0.07);
    const trim = s.trim;
    top.rect(-w / 2 - lip, 0, w + lip * 2, walk).fill({ color: trim });
    top.rect(-w / 2 - lip, walk, w + lip * 2, Math.max(1.5, walk * 0.4)).fill({ color: 0x000000, alpha: 0.3 });
    const lw = w + lip * 2;
    switch (s.wall) {
      case 'palisade': {
        const n = Math.max(5, Math.round(lw / 6));
        const sw = lw / n;
        for (let i = 0; i < n; i++) {
          const sx = -lw / 2 + i * sw;
          const sh = w * (0.2 + hash(i * 2.3) * 0.08);
          top.poly([sx + 0.5, 0, sx + 0.5, -sh, sx + sw / 2, -sh - sw * 0.9, sx + sw - 0.5, -sh, sx + sw - 0.5, 0]).fill({ color: i % 2 ? s.wood : lighten(s.wood, 0.12) });
          top.rect(sx + sw * 0.65, -sh, sw * 0.3, sh).fill({ color: 0x000000, alpha: 0.2 });
        }
        top.rect(-lw / 2, -w * 0.12, lw, 1.5).fill({ color: 0x2a1a10, alpha: 0.8 });
        break;
      }
      case 'rail': {
        const rh = w * 0.18;
        const n = Math.max(4, Math.round(lw / 10));
        for (let i = 0; i <= n; i++) top.rect(-lw / 2 + (lw * i) / n - 0.8, -rh, 1.6, rh).fill({ color: s.metal });
        top.rect(-lw / 2, -rh, lw, Math.max(1.5, w * 0.03)).fill({ color: s.metal });
        top.rect(-lw / 2, -rh * 0.5, lw, 1).fill({ color: darken(s.metal, 0.3) });
        // A pipe running along the wall face.
        const pr = Math.max(1.2, w * 0.03);
        top.rect(-lw / 2, walk + pr * 2, lw, pr * 2).fill({ color: darken(s.metal, 0.2) });
        top.rect(-lw / 2, walk + pr * 2, lw, pr * 0.6).fill({ color: lighten(s.metal, 0.3), alpha: 0.7 });
        break;
      }
      default: {
        let n = Math.max(3, Math.round(lw / 12));
        if (n % 2 === 0) n += 1;
        const mw = lw / (n * 2 - 1);
        const mh = Math.min(mw * 1.2, w * 0.2);
        for (let i = 0; i < n; i++) {
          const mx = -lw / 2 + i * mw * 2;
          if (s.wall === 'swallow') {
            top.poly([mx, 0, mx, -mh, mx + mw / 2, -mh + mw * 0.45, mx + mw, -mh, mx + mw, 0]).fill({ color: trim });
          } else if (s.wall === 'shieldwall') {
            top.moveTo(mx, 0).lineTo(mx, -mh + mw / 2).arc(mx + mw / 2, -mh + mw / 2, mw / 2, Math.PI, Math.PI * 2).lineTo(mx + mw, 0).closePath().fill({ color: trim });
          } else {
            top.rect(mx, -mh, mw, mh).fill({ color: trim });
          }
          top.rect(mx + mw * 0.7, -mh * 0.85, mw * 0.3, mh * 0.85).fill({ color: 0x000000, alpha: 0.18 });
          if (s.wall === 'crystal') {
            // A shard of glowing crystal on every merlon.
            const ch = mw * (1.2 + hash(i * 5.1) * 0.8);
            top.poly([mx + mw * 0.15, -mh, mx + mw * 0.5, -mh - ch, mx + mw * 0.85, -mh]).fill({ color: s.window, alpha: 0.95 });
            top.poly([mx + mw * 0.5, -mh - ch, mx + mw * 0.85, -mh, mx + mw * 0.5, -mh]).fill({ color: s.windowCore, alpha: 0.7 });
          }
        }
        if (s.wall === 'shieldwall' && wh > w * 0.45) {
          // Round shields hung along the face, in the hero's colour.
          const r = w * 0.11;
          for (const off of [-0.3, 0, 0.3]) {
            const sx = off * w;
            const sy = walk + r * 1.6;
            top.circle(sx, sy, r + 1.2).fill({ color: s.metal });
            top.circle(sx, sy, r).fill({ color: this.bannerColor });
            top.circle(sx, sy, r * 0.32).fill({ color: lighten(s.metal, 0.3) });
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Damage
  // -------------------------------------------------------------------------

  private drawCracks(l: CastleLayout, dmg: number): void {
    const t = this.keepTower;
    const key = `${dmg}|${Math.round(t.h / l.unit)}|${t.w}`;
    if (key === this.crackKey) return;
    this.crackKey = key;
    const c = this.cracks.clear();
    if (dmg === 0 || dmg === 3) return;
    const w = t.w;
    const kx = t.cx - w / 2;
    const ky = t.topY;
    const kh = t.h;
    const n = dmg === 2 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      let x = kx + w * (0.12 + hash(i * 3.7 + this.facing) * 0.76);
      let y = ky + kh * (0.05 + hash(i * 9.1) * 0.5);
      c.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        x += (hash(i * 11 + s) - 0.5) * w * 0.14;
        y += l.unit * (1.2 + hash(s * 5 + i) * 2.2);
        c.lineTo(x, Math.min(y, l.groundY));
      }
      c.stroke({ width: 1.6, color: 0x1a1410, alpha: 0.8 });
    }
    // Scorch marks and missing stones.
    for (let i = 0; i < n; i++) {
      const x = kx + w * (0.1 + hash(i * 2.9 + 4) * 0.8);
      const y = ky + kh * (0.1 + hash(i * 6.3 + 1) * 0.7);
      c.ellipse(x, y, w * 0.12, w * 0.08).fill({ color: 0x120c08, alpha: 0.22 });
      if (dmg === 2) c.rect(x - w * 0.05, y - w * 0.025, w * 0.1, w * 0.05).fill({ color: 0x120c08, alpha: 0.7 });
    }
  }

  private drawRubble(l: CastleLayout, fallen: boolean): void {
    const g = this.rubble.clear();
    if (this.ruinsSprite) {
      this.ruinsSprite.visible = fallen;
      if (!fallen) return;
      const w = l.keepWidth * 2.3;
      this.ruinsSprite.width = w;
      this.ruinsSprite.height = (w / this.ruinsSprite.texture.width) * this.ruinsSprite.texture.height;
      this.ruinsSprite.scale.x *= this.facing < 0 ? -1 : 1;
      this.ruinsSprite.position.set(l.x - this.facing * l.keepWidth * 0.1, l.groundY + l.keepWidth * 0.04);
      return;
    }
    if (!fallen) return;
    const s = this.style;
    const stoneColor = (s.keepStone.base[0] << 16) | (s.keepStone.base[1] << 8) | s.keepStone.base[2];
    // The fallen Keep: a heap of its stones, a broken roof and the banner on the ground.
    for (let i = 0; i < 26; i++) {
      const x = l.x + (hash(i * 4.7) - 0.5) * l.keepWidth * 1.5 * (1 - hash(i) * 0.3);
      const hgt = (1 - Math.abs(x - l.x) / (l.keepWidth * 0.8)) * l.keepWidth * 0.35;
      const y = l.groundY - Math.max(0, hgt) * hash(i * 1.3);
      const sz = l.keepWidth * (0.08 + hash(i * 2.1) * 0.1);
      g.roundRect(x - sz / 2, y - sz * 0.7, sz, sz * 0.7, 2).fill({ color: mix(stoneColor, 0x000000, hash(i * 8.8) * 0.4) });
    }
    // Roof shard.
    const r = l.keepWidth * 0.4;
    const rx = l.x + this.facing * l.keepWidth * 0.25;
    g.poly([rx - r, l.groundY - 2, rx - r * 0.1, l.groundY - r * 0.8, rx + r * 0.5, l.groundY - 2]).fill({ color: darken(s.roof, 0.2) });
    // Torn banner.
    g.poly([l.x - r, l.groundY - 3, l.x - r * 0.1, l.groundY - 6, l.x + r * 0.1, l.groundY - 1, l.x - r * 0.8, l.groundY]).fill({ color: darken(this.bannerColor, 0.15) });
  }

  /** Lights the dome up when it stops a hit. */
  flashShield(): void {
    this.shieldFlash = 1;
  }

  /** Breathing glow, the rising dome and the light band climbing it. */
  private tickShield(dt: number, calm: boolean): void {
    const d = this.dome;
    if (!d) return;
    this.shieldPulse += calm ? 0 : dt * 0.0025;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 0.0025);
    if (this.shieldRise < 1) this.shieldRise = calm ? 1 : Math.min(1, this.shieldRise + dt / 520);
    const rise = 1 - (1 - this.shieldRise) ** 3;
    for (const g of [this.shieldBubble, this.shieldSweep]) {
      g.pivot.y = d.gy;
      g.position.y = d.gy;
      g.scale.y = rise;
    }
    this.shieldBubble.alpha = Math.min(1, 0.8 + Math.sin(this.shieldPulse) * 0.12 + this.shieldFlash * 0.4);
    const sw = this.shieldSweep.clear();
    if (calm) return;
    this.sweepPhase = (this.sweepPhase + dt / 2800) % 1;
    // A ring of light climbs the dome, fading near the top; a fainter one follows.
    for (const offset of [0, 0.5]) {
      const h = (this.sweepPhase + offset) % 1;
      const y = d.gy - d.ry * h;
      const hw = d.rx * Math.sqrt(Math.max(0, 1 - h * h));
      if (hw < 4) continue;
      const fade = Math.sin(Math.PI * h) * (offset ? 0.45 : 1);
      const pts: number[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = (i / 24) * Math.PI;
        pts.push(d.cx + Math.cos(t) * hw, y + Math.sin(t) * hw * 0.14);
      }
      sw.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) sw.lineTo(pts[i], pts[i + 1]);
      sw.stroke({ width: 6, color: 0x7fd6ff, alpha: 0.12 * fade });
      sw.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) sw.lineTo(pts[i], pts[i + 1]);
      sw.stroke({ width: 1.6, color: 0xe4f8ff, alpha: 0.55 * fade });
    }
    if (this.shieldFlash > 0) {
      const dome = (sx: number, sy: number): number[] => {
        const pts: number[] = [];
        for (let i = 0; i <= 40; i++) {
          const t = Math.PI + (i / 40) * Math.PI;
          pts.push(d.cx + Math.cos(t) * sx, d.gy + Math.sin(t) * sy);
        }
        return pts;
      };
      sw.poly(dome(d.rx, d.ry)).fill({ color: 0xaee8ff, alpha: 0.18 * this.shieldFlash });
    }
  }

  /**
   * The arcane Shield: a translucent dome rising from the ground over the
   * whole castle, brighter at its rim, with a lattice of hexagons, meridians,
   * a rune circle on the ground and a gloss highlight. More charges, more
   * glow and more runes.
   */
  private drawShield(): void {
    const l = this.layoutValue;
    const g = this.shieldBubble.clear();
    if (!l || this.shieldCharges <= 0) {
      this.dome = null;
      this.shieldSweep.clear();
      return;
    }
    const far = l.x - this.facing * l.keepWidth * 1.7;
    const near = this.wallCx() + this.facing * this.wallW() * 0.9;
    const cx = (far + near) / 2;
    const rx = Math.abs(near - far) / 2 + l.keepWidth * 0.25;
    // Tall enough for the roofs and the flag on top of the Keep.
    const top = Math.max(this.keepPx() + l.keepWidth * 2.25, this.wallPx() + l.unit * 4);
    const ry = Math.max(top + l.unit * 2, rx * 0.8);
    const gy = l.groundY + 1;
    this.dome = { cx, gy, rx, ry };
    const k = Math.min(3, this.shieldCharges);
    const CYAN = 0x7fd6ff;
    const PALE = 0xe4f8ff;
    const VIOLET = 0xb48cff;

    const domePts = (sx: number, sy: number, from = 0, to = 1, n = 48): number[] => {
      const pts: number[] = [];
      for (let i = 0; i <= n; i++) {
        const t = Math.PI + (from + ((to - from) * i) / n) * Math.PI;
        pts.push(cx + Math.cos(t) * sx, gy + Math.sin(t) * sy);
      }
      return pts;
    };
    const path = (pts: number[]): Graphics => {
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      return g;
    };

    // Body, then a fresnel rim: brighter towards the edge.
    g.poly(domePts(rx, ry)).fill({ color: CYAN, alpha: 0.04 + k * 0.015 });
    g.poly(domePts(rx * 0.8, ry * 0.86)).fill({ color: 0x0a1a3a, alpha: 0.05 });
    // A violet haze rising from the rune circle.
    g.poly(domePts(rx * 0.97, ry * 0.32)).fill({ color: VIOLET, alpha: 0.07 + k * 0.02 });
    g.poly(domePts(rx * 0.93, ry * 0.16)).fill({ color: VIOLET, alpha: 0.06 });
    for (const [w, a] of [
      [22, 0.04],
      [12, 0.07],
      [5, 0.16],
    ] as const) {
      path(domePts(rx - w / 2, ry - w / 2)).stroke({ width: w, color: CYAN, alpha: a + k * 0.01 });
    }

    // Hexagon lattice, fading towards the middle so the castle stays clear.
    const hex = Math.max(7, rx / 7);
    const hh = hex * Math.sqrt(3);
    for (let row = 0; row * hex * 1.5 < ry + hex; row++) {
      const y = gy - row * hex * 1.5 - hex * 0.5;
      for (let col = -Math.ceil(rx / hh) - 1; col <= Math.ceil(rx / hh) + 1; col++) {
        const x = cx + col * hh + (row % 2 ? hh / 2 : 0);
        const e = ((x - cx) / rx) ** 2 + ((y - gy) / ry) ** 2;
        if (e > 0.9 || e < 0.35) continue;
        const pts: number[] = [];
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          pts.push(x + Math.cos(a) * hex * 0.92, y + Math.sin(a) * hex * 0.92);
        }
        g.poly(pts).stroke({ width: 1, color: (row + col) % 5 === 0 ? VIOLET : CYAN, alpha: 0.07 + (e - 0.35) * 0.45 });
      }
    }

    // Meridians and parallels give it volume.
    for (const f of [0.66, 0.3]) path(domePts(rx * f, ry)).stroke({ width: 1, color: CYAN, alpha: 0.16 });
    for (const h of [0.38, 0.72]) {
      const y = gy - ry * h;
      const hw = rx * Math.sqrt(1 - h * h);
      const pts: number[] = [];
      for (let i = 0; i <= 32; i++) {
        const t = (i / 32) * Math.PI;
        pts.push(cx + Math.cos(t) * hw, y + Math.sin(t) * hw * 0.14);
      }
      path(pts).stroke({ width: 1.2, color: VIOLET, alpha: 0.35 });
    }

    // Rim.
    path(domePts(rx, ry)).stroke({ width: 1.4 + k * 0.6, color: PALE, alpha: 0.8 });

    // Rune circle on the ground.
    const gry = Math.max(l.unit * 2.2, rx * 0.085);
    g.ellipse(cx, gy, rx * 1.04, gry * 1.15).stroke({ width: 2, color: VIOLET, alpha: 0.55 });
    g.ellipse(cx, gy, rx * 0.92, gry).stroke({ width: 1, color: CYAN, alpha: 0.45 });
    g.ellipse(cx, gy, rx * 0.98, gry * 1.07).fill({ color: VIOLET, alpha: 0.06 });
    const runes = 14 + k * 4;
    for (let i = 0; i < runes; i++) {
      const t = (i / runes) * Math.PI * 2;
      const x = cx + Math.cos(t) * rx * 0.98;
      const y = gy + Math.sin(t) * gry * 1.07;
      const front = Math.sin(t) > 0;
      const r = Math.max(2.2, gry * 0.32);
      const glyph = (i * 7 + 3) % 5;
      g.moveTo(x - r, y).lineTo(x + r, y);
      if (glyph === 0) g.moveTo(x, y - r).lineTo(x, y + r * 0.6);
      else if (glyph === 1) g.moveTo(x - r * 0.6, y - r).lineTo(x + r * 0.6, y + r * 0.6);
      else if (glyph === 2) g.moveTo(x - r * 0.6, y + r * 0.6).lineTo(x, y - r).lineTo(x + r * 0.6, y + r * 0.6);
      else if (glyph === 3) g.moveTo(x, y - r).lineTo(x - r * 0.5, y).lineTo(x, y + r * 0.6);
      else g.moveTo(x + r * 0.5, y - r).lineTo(x - r * 0.5, y + r * 0.6);
      g.stroke({ width: 1.2, color: front ? 0xe0d0ff : VIOLET, alpha: front ? 0.85 : 0.4 });
    }

    // Gloss highlight on the upper left.
    path(domePts(rx * 0.86, ry * 0.9, 0.12, 0.34, 16)).stroke({ width: 3, color: 0xffffff, alpha: 0.28, cap: 'round' });
    path(domePts(rx * 0.86, ry * 0.9, 0.38, 0.42, 4)).stroke({ width: 3, color: 0xffffff, alpha: 0.2, cap: 'round' });
  }

  private drawFrost(): void {
    const l = this.layoutValue;
    const g = this.frostCoat.clear();
    if (!l || !this.frozen) return;
    const icicles = (x0: number, width: number, y: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        const x = x0 + (width * (i + 0.5)) / n;
        const len = l.unit * (1.5 + ((i * 7) % 4));
        g.poly([x - 2.5, y, x + 2.5, y, x, y + len]).fill({ color: 0xeaf9ff, alpha: 0.85 });
      }
    };
    for (const t of [this.keepTower, ...this.towers]) {
      if (!t.root.visible || t.h < 1) continue;
      const x = t.cx - t.w / 2;
      icicles(x, t.w, t.topY, t.isKeep ? 6 : 3);
    }
    const wh = this.wallPx();
    if (wh > 0.5) {
      const ww = this.wallW();
      const wx = this.wallCx() - ww / 2;
      icicles(wx, ww, l.groundY - wh, 4);
    }
  }

  // -------------------------------------------------------------------------
  // Ambient animation: flags, fire, magic, smoke
  // -------------------------------------------------------------------------

  private glowAt(i: number, x: number, y: number, size: number, color: number, alpha: number): void {
    let sp = this.glowSprites[i];
    if (!sp) {
      sp = new Sprite(glow());
      sp.anchor.set(0.5);
      this.glows.addChild(sp);
      this.glowSprites[i] = sp;
    }
    sp.visible = true;
    sp.position.set(x, y);
    sp.width = sp.height = size;
    sp.tint = color;
    sp.alpha = alpha;
  }

  /**
   * A painted-style banner: cloth in strips shaded by its folds (lit where the
   * wave faces the sun, dark in the troughs), gold-trimmed edges, a swallowtail
   * end (or a long pennant) and a soft dark outline, hung from a pole tip.
   */
  private drawCloth(g: Graphics, x: number, y: number, len: number, h: number, color: number, pennant: boolean, phase: number, dir: number): void {
    const steps = 14;
    const wave = (t: number): number => Math.sin(phase * 1.1 - t * 3.4) * h * 0.3 * t + Math.sin(phase * 2.3 - t * 7) * h * 0.06 * t;
    const shade = (t: number): number => Math.cos(phase * 1.1 - t * 3.4);
    // Tip shape: a pennant tapers to a point; a banner ends in a swallowtail notch.
    const height = (t: number): number => (pennant ? h * (1 - t * 0.85) : h * (1 - t * 0.12));
    const top = (t: number): number => y + wave(t) + (pennant ? h * 0.42 * t : 0);
    const px = (t: number): number => x + dir * len * t * (1 - Math.abs(Math.sin(phase * 1.1 - t * 3.4)) * 0.04 * t);
    // Gold hems, or dark ones on a banner that is itself gold, so they always read.
    const lum = (c: number): number => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
    const warm = ((color >> 16) & 255) > (color & 255) + 60 && lum(color) > 110;
    const trim = warm ? darken(color, 0.55) : mix(this.style.metal, 0xffffff, 0.08);
    const dark = darken(color, 0.55);
    const outline: number[] = [];
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const y0 = top(t0);
      const y1 = top(t1);
      const h0 = height(t0);
      const h1 = height(t1);
      const k = shade((t0 + t1) / 2);
      // Lit folds toward the warm sun, troughs cool and dark.
      const cloth = k > 0 ? mix(color, 0xffe2b0, k * 0.3) : mix(color, 0x140c1c, -k * 0.5);
      const notch = !pennant && i === steps - 1;
      if (notch) {
        const mid0 = y0 + h0 / 2;
        g.poly([px(t0), y0, px(t1), y1, px(t0) + dir * len * 0.02, mid0, px(t1), y1 + h1, px(t0), y0 + h0]).fill({ color: cloth });
      } else {
        g.poly([px(t0), y0, px(t1), y1, px(t1), y1 + h1, px(t0), y0 + h0]).fill({ color: cloth });
      }
      // Gold trim along the top and bottom hems (not on a pennant's point).
      if (!pennant || t0 < 0.7) {
        const band0 = h0 * 0.12;
        const band1 = h1 * 0.12;
        const gold = k > 0 ? mix(trim, 0xffffff, k * 0.25) : darken(trim, -k * 0.4);
        g.poly([px(t0), y0, px(t1), y1, px(t1), y1 + band1, px(t0), y0 + band0]).fill({ color: gold, alpha: 0.9 });
        if (!notch) g.poly([px(t0), y0 + h0 - band0, px(t1), y1 + h1 - band1, px(t1), y1 + h1, px(t0), y0 + h0]).fill({ color: gold, alpha: 0.9 });
      }
    }
    for (let i = 0; i <= steps; i++) outline.push(px(i / steps), top(i / steps));
    for (let i = steps; i >= 0; i--) outline.push(px(i / steps), top(i / steps) + height(i / steps));
    g.poly(outline).stroke({ width: Math.max(0.8, h * 0.05), color: dark, alpha: 0.55 });
    // A small finial cap where the cloth meets the pole.
    g.circle(x, y - h * 0.08, Math.max(1.2, h * 0.09)).fill({ color: trim });
  }

  private drawFlag(g: Graphics, x: number, y: number, len: number, h: number, color: number, pennant: boolean, phase: number, dir: number = WIND): void {
    const pts: number[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(x + dir * len * t, y + Math.sin(phase + t * 3) * h * 0.2 * t + (pennant ? (h / 2) * t : 0));
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const bottom = pennant ? h - (h / 2) * t : h * (1 - t * 0.25);
      pts.push(x + dir * len * t, y + bottom + Math.sin(phase + t * 3) * h * 0.2 * t);
    }
    g.poly(pts).fill({ color });
    g.poly(pts).stroke({ width: 1, color: 0xe3b656, alpha: 0.6 });
  }

  private drawAnim(dt: number, calm: boolean): void {
    const l = this.layoutValue;
    const g = this.anim.clear();
    const back = this.animBack.clear();
    const flags = this.flagsBack.clear();
    for (const f of this.paintedFlags) f.root.visible = false;
    let flagIndex = 0;
    // The hero's own banner flies where there is one; drawn cloth otherwise.
    const cloth = (x: number, y: number, len: number, h: number, pennant: boolean, phase: number, dir: number): void => {
      const own = this.painted?.ownFlag;
      if (own) {
        // The hero's own flag: a tall mast standing on the tip of the roof, the cloth flying from its top.
        let f = this.paintedFlags[flagIndex];
        if (!f || f.texture !== own.cloth) {
          f?.destroy();
          f = this.paintedFlags[flagIndex] = new PaintedFlag(own.cloth, true, own.pole);
          this.flagLayer.addChild(f.root);
        }
        flagIndex++;
        f.root.visible = true;
        // The painting's scale comes from its whole mast; only its top part stands above the roof, a
        // third of it, or as much as the cloth needs to hang clear.
        const s = (len * (pennant ? 1.5 : 1.7)) / own.pole.height;
        const pole = f.pole!;
        const shown = Math.min(own.pole.height, Math.round(Math.max(own.pole.height / 3, own.clothTop + own.cloth.height * 1.15)));
        if (pole.texture.height !== shown) {
          const fr = own.pole.frame;
          pole.texture = new Texture({ source: own.pole.source, frame: new Rectangle(fr.x, fr.y, fr.width, shown) });
        }
        const mast = shown * s;
        pole.scale.set(s);
        pole.position.set(x - own.poleAxis * s, y - mast);
        f.draw(x, y - mast + own.clothTop * s, own.cloth.width * s, 1, phase, dir);
        return;
      }
      const tex = this.painted?.flag;
      if (!tex) {
        this.drawCloth(flags, x, y, len, h, this.bannerColor, pennant, phase, dir);
        return;
      }
      let f = this.paintedFlags[flagIndex];
      if (!f || f.texture !== tex) {
        f?.destroy();
        f = this.paintedFlags[flagIndex] = new PaintedFlag(tex);
        this.flagLayer.addChild(f.root);
      }
      flagIndex++;
      f.root.visible = true;
      // The rod sits on the pole, its top finial at the pole's tip.
      f.draw(x - dir * len * 0.04, y - h * 0.35, len, pennant ? 0.55 : 1, phase, dir);
    };
    for (const sp of this.glowSprites) sp.visible = false;
    if (!l) return;
    const s = this.style;
    const p = this.phase;
    const k = this.keepTower;
    const fallen = !k.root.visible;
    let glowIndex = 0;

    const painted = !!k.painted;
    // Ruins smoulder: thin dark smoke and a few embers glowing in the rubble.
    if (fallen) {
      if (!calm) this.emitPuff(dt, l.x + (Math.random() - 0.5) * l.keepWidth * 0.8, l.groundY - l.keepWidth * 0.25, Math.random() > 0.5 ? 0x4a443e : 0x5c544a);
      for (let i = 0; i < 3; i++) {
        const flick = 0.5 + Math.sin(p * (5 + i * 2.3) + i * 4) * 0.3 + Math.sin(p * 13 + i) * 0.2;
        this.glowAt(glowIndex++, l.x + (hash(i * 5.3) - 0.5) * l.keepWidth * 1.2, l.groundY - l.keepWidth * (0.05 + hash(i * 2.2) * 0.15), l.keepWidth * 0.5, 0xff7a2a, 0.35 * flick);
      }
    }
    // A painted Keep has its own flagpole: the flag flies from its tip.
    if (painted && !fallen && !k.broken && s.signature !== 'orb') {
      // A pole off to one side flies its flag outward, clear of the roof.
      const dir = WIND;
      cloth(k.cx + k.apexX, k.topY + k.apex + k.w * 0.04, k.w * 0.8, k.w * 0.3, false, p, dir);
    } else if (painted && !fallen && !k.broken && this.painted?.ownFlag) {
      // The Sorceress's dome carries her telescope at its top: her flag stands on the shoulder of the
      // dome away from it, so it never hides the telescope.
      const side = k.apexX > 0 ? -1 : 1;
      cloth(k.cx + side * k.w * 0.3, k.topY - k.crown * 0.74, k.w * 0.8, k.w * 0.3, false, p, WIND);
    }
    // Keep flag (the Sorceress has her orb instead).
    if (!painted && !fallen && !k.broken && s.signature !== 'orb') {
      const poleTop = k.topY + k.apex - k.w * 0.55;
      const poleBase = k.topY + k.apex + (s.keep.roof === 'flat' ? 0 : k.w * 0.1);
      g.rect(k.cx - 1, poleTop, 2, poleBase - poleTop).fill({ color: 0x2a2018 });
      g.circle(k.cx, poleTop, 2.2).fill({ color: 0xe3b656 });
      this.drawFlag(g, k.cx + this.facing, poleTop + 2, k.w * 0.62, k.w * 0.24, this.bannerColor, false, p);
    }
    // Pennants on the back towers.
    for (const t of this.towers) {
      if (!t.shape.pennant || t.broken || t.h < 2) continue;
      if (t.painted) {
        const dir = WIND;
        cloth(t.cx + t.apexX, t.topY + t.apex + t.w * 0.05, t.w * 0.8, t.w * 0.26, true, p + t.index * 1.7, dir);
        continue;
      }
      const top = t.topY + t.apex;
      const pole = t.w * 0.45;
      g.rect(t.cx - 0.75, top - pole, 1.5, pole).fill({ color: 0x2a2018 });
      this.drawFlag(g, t.cx, top - pole + 1, t.w * 0.7, t.w * 0.2, this.bannerColor, true, p + t.index * 1.7);
    }

    // Painted castles carry their signature in the painting: only its light moves.
    if (painted) {
      // The painting's own lights flicker like candles and fires, and go out as the castle is wrecked.
      const dmg = this.damage();
      const dim = dmg === 0 ? 1 : dmg === 1 ? 0.7 : dmg === 2 ? 0.38 : 0;
      // Each tower on its own beat: a slow breath, a quick flutter and now and then a gust that makes it gutter.
      const candle = (i: number): number =>
        calm ? 1 : 0.85 + Math.sin(p * 1.6 + i * 2.7) * 0.16 + Math.sin(p * 6.3 + i * 2.1) * 0.1 + Math.sin(p * 15.7 + i * 1.3) * 0.07 - Math.max(0, Math.sin(p * 0.43 + i * 5) - 0.9) * 2.5;
      [k, ...this.towers].forEach((t, i) => {
        if (!t.painted) return;
        const lit = (t.broken ? 0.12 : dim) * candle(i);
        t.painted.setGlow(lit * 1.2, lit * 1.05);
        t.painted.flicker(p + i * 3.1, t.broken ? 0.15 : dim);
      });
      this.wallStack?.setGlow(dim * candle(7), dim);
      this.wallStack?.flicker(p + 11, dim);
      if (!fallen && !k.broken) {
        const ax = k.cx + k.apexX;
        const ay = k.topY + k.apex;
        if (s.signature === 'orb') this.glowAt(glowIndex++, ax, ay + k.w * 0.2, k.w * 1.6 * (1 + Math.sin(p * 2.3) * 0.08), s.windowCore, 0.5);
        if (s.signature === 'braziers') {
          for (const side of [-1, 1]) {
            const f = 1 + Math.sin(p * 7 + side * 2) * 0.15 + Math.sin(p * 13 + side) * 0.08;
            this.glowAt(glowIndex++, k.cx + side * k.w * 0.5, k.topY - k.crown * 0.55, k.w * 0.9 * f, 0xff8a30, 0.4);
          }
        }
        // The windows breathe, warm or magical.
        this.glowAt(glowIndex++, k.cx, k.topY + k.h * 0.45, k.w * 1.5, s.windowCore, 0.08 + Math.sin(p * 1.1) * 0.04);
        if (s.signature === 'smoke' && !calm) this.emitPuff(dt, ax, ay);
      }
      this.tickPuffs(dt, l, p);
      return;
    }

    switch (s.signature) {
      case 'crane': {
        // A wooden crane on the Keep's parapet, its load swaying.
        const t = this.towers.find((tw) => tw.index === 1);
        if (!t || t.broken || fallen) break;
        const baseY = k.topY - k.crown * 0.55;
        const mx = k.cx - this.facing * k.w * 0.32;
        const mastH = k.w * 0.9;
        const jib = k.w * 0.95;
        const wood = s.wood;
        const beam = Math.max(1.5, k.w * 0.035);
        const sway = Math.sin(p * 0.6) * 0.12;
        back.rect(mx - beam / 2, baseY - mastH, beam, mastH).fill({ color: wood });
        const jx = mx - this.facing * jib;
        back.moveTo(mx + this.facing * jib * 0.25, baseY - mastH).lineTo(jx, baseY - mastH).stroke({ width: beam, color: lighten(wood, 0.1) });
        back.moveTo(mx, baseY - mastH * 0.6).lineTo(jx * 0.5 + mx * 0.5, baseY - mastH).stroke({ width: beam * 0.7, color: wood });
        back.moveTo(mx, baseY - mastH - k.w * 0.18).lineTo(jx, baseY - mastH).stroke({ width: 1, color: 0x2a2018, alpha: 0.8 });
        back.moveTo(mx, baseY - mastH - k.w * 0.18).lineTo(mx + this.facing * jib * 0.25, baseY - mastH).stroke({ width: 1, color: 0x2a2018, alpha: 0.8 });
        back.rect(mx - beam, baseY - mastH - k.w * 0.18, beam * 2, k.w * 0.18).fill({ color: wood });
        // Rope and stone block.
        const rope = k.w * 0.55;
        const bx = jx + Math.sin(sway) * rope;
        const by = baseY - mastH + Math.cos(sway) * rope;
        back.moveTo(jx, baseY - mastH).lineTo(bx, by).stroke({ width: 1, color: 0x3a2a18 });
        const bs = k.w * 0.16;
        back.rect(bx - bs / 2, by, bs, bs * 0.75).fill({ color: s.trim });
        back.rect(bx - bs / 2, by + bs * 0.55, bs, bs * 0.2).fill({ color: 0x000000, alpha: 0.25 });
        // Counterweight.
        const cwx = mx + this.facing * jib * 0.25;
        back.rect(cwx - bs * 0.4, baseY - mastH, bs * 0.8, bs * 0.7).fill({ color: darken(s.trim, 0.4) });
        break;
      }
      case 'braziers': {
        if (fallen || k.broken) break;
        const y = k.topY - k.crown;
        for (const side of [-1, 1]) {
          const x = k.cx + side * k.w * 0.56;
          const bw = k.w * 0.16;
          g.poly([x - bw / 2, y - bw * 0.5, x + bw / 2, y - bw * 0.5, x + bw * 0.3, y, x - bw * 0.3, y]).fill({ color: 0x2a2420 });
          g.rect(x - bw / 2, y - bw * 0.55, bw, bw * 0.12).fill({ color: s.metal });
          const f = 1 + Math.sin(p * 7 + side * 2) * 0.15 + Math.sin(p * 13 + side) * 0.08;
          const fh = bw * 1.5 * f;
          g.poly([x - bw * 0.42, y - bw * 0.5, x - bw * 0.1, y - bw * 0.5 - fh * 0.7, x + Math.sin(p * 9 + side) * bw * 0.12, y - bw * 0.5 - fh, x + bw * 0.12, y - bw * 0.5 - fh * 0.6, x + bw * 0.42, y - bw * 0.5]).fill({ color: 0xff7a1c });
          g.poly([x - bw * 0.22, y - bw * 0.5, x, y - bw * 0.5 - fh * 0.62, x + bw * 0.22, y - bw * 0.5]).fill({ color: 0xffd060 });
          this.glowAt(glowIndex++, x, y - bw * 0.5 - fh * 0.4, bw * 5 * f, 0xff8a30, 0.55);
        }
        break;
      }
      case 'orb': {
        if (fallen || k.broken) break;
        const ay = k.topY + k.apex;
        const bob = Math.sin(p * 1.4) * k.w * 0.06;
        const oy = ay - k.w * 0.32 + bob;
        const r = k.w * 0.13;
        this.glowAt(glowIndex++, k.cx, oy, r * 9 * (1 + Math.sin(p * 2.3) * 0.08), s.windowCore, 0.6);
        g.circle(k.cx, oy, r).fill({ color: s.window });
        g.circle(k.cx - r * 0.3, oy - r * 0.3, r * 0.35).fill({ color: 0xffffff, alpha: 0.85 });
        // Shards of stone orbiting the orb.
        for (let i = 0; i < 3; i++) {
          const a = p * 0.9 + (i * Math.PI * 2) / 3;
          const sx = k.cx + Math.cos(a) * k.w * 0.42;
          const sy = oy + Math.sin(a) * k.w * 0.12;
          const sz = k.w * 0.06;
          const behind = Math.sin(a) < 0;
          g.poly([sx - sz, sy, sx, sy - sz * 1.3, sx + sz, sy, sx, sy + sz * 0.8]).fill({ color: behind ? darken(s.trim, 0.4) : s.trim, alpha: behind ? 0.7 : 1 });
        }
        // Window glow breathes.
        this.glowAt(glowIndex++, k.cx, k.topY + k.h * 0.5, k.w * 1.6, s.windowCore, 0.12 + Math.sin(p * 1.1) * 0.05);
        break;
      }
      case 'lanterns': {
        if (fallen) break;
        for (const t of [k, ...this.towers]) {
          if (t.broken || t.h < 2) continue;
          const y = t.topY + t.w * 0.08;
          for (const side of [-1, 1]) {
            if (!t.isKeep && side === this.facing) continue;
            const x = t.cx + side * (t.w / 2 + t.w * 0.1);
            const ls = Math.max(2.5, t.w * 0.07);
            g.moveTo(x, y - ls).lineTo(x, y).stroke({ width: 1, color: 0x1a1410 });
            g.rect(x - ls / 2, y, ls, ls * 1.3).fill({ color: 0x2a1c12 });
            const flick = 0.75 + Math.sin(p * 11 + x) * 0.12 + Math.sin(p * 23 + x * 2) * 0.08;
            g.rect(x - ls / 2 + 1, y + 1, ls - 2, ls * 1.3 - 2).fill({ color: s.window, alpha: flick });
            this.glowAt(glowIndex++, x, y + ls * 0.6, ls * 7, s.metal, 0.45 * flick);
          }
        }
        break;
      }
      case 'shield': {
        if (fallen) break;
        // A slow glint sweeping across the Keep.
        const sweep = (p * 0.25) % 3;
        if (sweep < 1) {
          const x = k.cx - k.w / 2 + sweep * k.w;
          this.glowAt(glowIndex++, x, k.topY + Math.min(k.h, k.w) * 0.5, k.w * 0.9, 0xdfefff, 0.35 * Math.sin(sweep * Math.PI));
        }
        break;
      }
      case 'smoke': {
        // Green-tinged smoke from the chimney and glowing round windows.
        const chim = this.towers.find((tw) => tw.index === 0);
        if (!chim || chim.broken || calm) break;
        this.emitPuff(dt, chim.cx, chim.topY + chim.apex);
        this.glowAt(glowIndex++, chim.cx, chim.topY + chim.apex - chim.w * 0.3, chim.w * 2.2, 0x6fffa0, 0.12 + Math.sin(p * 1.7) * 0.04);
        break;
      }
    }

    this.tickPuffs(dt, l, p);
  }

  /** A puff of chimney smoke now and then. */
  private emitPuff(dt: number, x: number, y: number, tint?: number): void {
    this.puffTimer -= dt;
    if (this.puffTimer > 0) return;
    this.puffTimer = 260 + Math.random() * 200;
    const sprite = new Sprite(glow());
    sprite.anchor.set(0.5);
    sprite.tint = tint ?? (Math.random() > 0.5 ? 0x9fd8a8 : 0xb8c8b0);
    this.smoke.addChild(sprite);
    this.puffs.push({ sprite, life: 0, max: 2400 + Math.random() * 800, vx: (Math.random() - 0.2) * 0.01 * -this.facing, vy: -0.025 - Math.random() * 0.01 });
    sprite.position.set(x, y);
  }

  /** Smoke puffs drift up and fade (they keep going even if the chimney falls). */
  private tickPuffs(dt: number, l: CastleLayout, p: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      puff.life += dt;
      if (puff.life >= puff.max) {
        puff.sprite.destroy();
        this.puffs.splice(i, 1);
        continue;
      }
      const t = puff.life / puff.max;
      puff.sprite.x += puff.vx * dt + Math.sin(p * 2 + i) * 0.05;
      puff.sprite.y += puff.vy * dt;
      const size = l.keepWidth * (0.25 + t * 0.9);
      puff.sprite.width = puff.sprite.height = size;
      puff.sprite.alpha = Math.min(1, t * 6) * (1 - t) * 0.75;
    }
  }
}
