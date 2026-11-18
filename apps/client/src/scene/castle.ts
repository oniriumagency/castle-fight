import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import type { HeroId } from '@cardcraft-castles/engine';
import { heroColor } from '../ui/theme';
import { castleStyle, footTexture, shadeTexture, styleTextures, type CastleStyle, type ParapetKind, type RoofKind, type WindowKind } from './castleStyles';
import { glowTexture } from './textures';

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
  /** Visual cap so a huge Wall does not leave the screen. */
  maxPoints: number;
}

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
  private key = '';

  constructor(
    readonly shape: TowerShape,
    readonly isKeep: boolean,
    readonly index: number,
    stone: Texture,
  ) {
    this.body = new TilingSprite({ texture: stone, width: 10, height: 10 });
    this.shade = new Sprite(shadeTexture(shape.round));
    this.foot = new Sprite(footTexture());
    this.root.addChild(this.body, this.shade, this.foot, this.details, this.decor, this.top);
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
    this.root.destroy({ children: true });
  }
}

// ---------------------------------------------------------------------------
// The castle
// ---------------------------------------------------------------------------

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
  private readonly wallLayer = new Container();
  private readonly wallBody: TilingSprite;
  private readonly wallShade: Sprite;
  private readonly wallDetails = new Graphics();
  private readonly wallTop = new Graphics();
  private readonly rubble = new Graphics();
  private readonly anim = new Graphics();
  /** Animated pieces that stand behind the Keep (the crane). */
  private readonly animBack = new Graphics();
  private readonly glows = new Container();
  private readonly smoke = new Container();
  private readonly frostCoat = new Graphics();
  readonly shieldBubble = new Graphics();

  private keepTower!: Tower;
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
  private hitLeft = 0;
  private kick = 0;
  private kickPhase = 0;
  private quake = 0;

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
      this.smoke,
      this.backLayer,
      this.animBack,
      this.keepLayer,
      this.cracks,
      this.wallLayer,
      this.rubble,
      this.anim,
      this.glows,
      this.frostCoat,
      this.shieldBubble,
    );
    this.buildTowers();
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
      this.buildTowers();
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
    this.redraw();
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
    this.shieldCharges = charges;
    this.drawShield();
  }

  /** Flash of colour and a small recoil when struck. */
  hit(color: number, power = 1): void {
    this.hitColor = color;
    this.hitLeft = 260;
    this.kick = Math.min(10, 3 + power * 5);
    this.kickPhase = 0;
  }

  /** Ice over the stones while a resource is frozen. */
  setFrost(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    this.drawFrost();
  }

  /** Scene position of the top of the Keep or the Wall (for projectiles and floating numbers). */
  anchor(target: 'keep' | 'wall' | 'base'): { x: number; y: number } {
    const l = this.layoutValue;
    if (!l) return { x: 0, y: 0 };
    if (target === 'base') return { x: l.x, y: l.groundY };
    if (target === 'keep') return { x: l.x, y: l.groundY - this.keepPx() - this.keepTower.crown * 0.6 };
    return { x: this.wallCx(), y: l.groundY - this.wallPx() };
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
      const ch = (shift: number): number => Math.round(255 + (((c >> shift) & 255) - 255) * k) << shift;
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
    if (!calm) this.phase += dt * 0.004;
    this.drawAnim(dt, calm);
    if (this.shieldCharges > 0) {
      this.shieldPulse += dt * 0.003;
      this.shieldBubble.alpha = 0.75 + Math.sin(this.shieldPulse) * 0.2;
    }
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
    this.keepTower = new Tower({ roof: s.keep.roof, parapet: s.keep.parapet, round: !!s.keep.round, pennant: false }, true, -1, tex.keepStone);
    this.keepLayer.addChild(this.keepTower.root);
    // Furthest towers first so nearer ones overlap them.
    const specs = s.towers.map((spec, i) => ({ spec, i })).sort((a, b) => b.spec.offset - a.spec.offset);
    this.towers = specs.map(({ spec, i }) => {
      const t = new Tower({ roof: spec.roof, parapet: spec.parapet, round: !!spec.round, pennant: !!spec.pennant }, false, i, tex.keepStone);
      // Towers further back sit in the haze: a touch darker and bluer.
      const depth = Math.min(1, spec.offset / 1.4);
      t.root.tint = mix(0xffffff, 0x9aa2c0, 0.12 + depth * 0.22);
      (spec.front ? this.keepLayer : this.backLayer).addChild(t.root);
      return t;
    });
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
    return Math.min(this.keepValue, l.maxPoints) * l.unit;
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
      const h = fallen ? stump : Math.max(l.unit * 2, kh * spec.ratio);
      // Damage breaks the furthest towers first.
      const broken = fallen || dmg >= 2 || (dmg === 1 && t.index === 0);
      t.setHeight(h, l.unit, broken, (tw, u) => this.drawTower(tw, u));
    }

    this.drawWall(l);
    this.drawCracks(l, dmg);
    this.drawRubble(l, fallen);
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

  private drawShield(): void {
    const l = this.layoutValue;
    const g = this.shieldBubble.clear();
    if (!l || this.shieldCharges <= 0) return;
    const far = l.x - this.facing * l.keepWidth * 1.6;
    const near = this.wallCx() + this.facing * this.wallW() * 0.6;
    const cx = (far + near) / 2;
    const rx = Math.abs(near - far) / 2 + l.keepWidth * 0.2;
    const top = Math.max(this.keepPx() + l.keepWidth * 1.3, this.wallPx());
    const ry = top + l.unit * 2;
    g.ellipse(cx, l.groundY, rx, ry).fill({ color: 0x7fd6ff, alpha: 0.08 + this.shieldCharges * 0.03 });
    g.ellipse(cx, l.groundY, rx, ry).stroke({ width: 2 + this.shieldCharges, color: 0xaee8ff, alpha: 0.55 });
    g.ellipse(cx - rx * 0.25, l.groundY - ry * 0.55, rx * 0.25, ry * 0.18).fill({ color: 0xffffff, alpha: 0.08 });
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
      g.rect(x, t.topY, t.w, t.h).fill({ color: 0xbfeaff, alpha: 0.22 });
      g.rect(x, t.topY, t.w, 2).fill({ color: 0xffffff, alpha: 0.7 });
      icicles(x, t.w, t.topY, t.isKeep ? 6 : 3);
    }
    const wh = this.wallPx();
    if (wh > 0.5) {
      const ww = this.wallW();
      const wx = this.wallCx() - ww / 2;
      g.rect(wx, l.groundY - wh, ww, wh).fill({ color: 0xbfeaff, alpha: 0.22 });
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

  private drawFlag(g: Graphics, x: number, y: number, len: number, h: number, color: number, pennant: boolean, phase: number): void {
    const dir = this.facing;
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
    for (const sp of this.glowSprites) sp.visible = false;
    if (!l) return;
    const s = this.style;
    const p = this.phase;
    const k = this.keepTower;
    const fallen = !k.root.visible;
    let glowIndex = 0;

    // Keep flag (the Sorceress has her orb instead).
    if (!fallen && !k.broken && s.signature !== 'orb') {
      const poleTop = k.topY + k.apex - k.w * 0.55;
      const poleBase = k.topY + k.apex + (s.keep.roof === 'flat' ? 0 : k.w * 0.1);
      g.rect(k.cx - 1, poleTop, 2, poleBase - poleTop).fill({ color: 0x2a2018 });
      g.circle(k.cx, poleTop, 2.2).fill({ color: 0xe3b656 });
      this.drawFlag(g, k.cx + this.facing, poleTop + 2, k.w * 0.62, k.w * 0.24, this.bannerColor, false, p);
    }
    // Pennants on the back towers.
    for (const t of this.towers) {
      if (!t.shape.pennant || t.broken || t.h < 2) continue;
      const top = t.topY + t.apex;
      const pole = t.w * 0.45;
      g.rect(t.cx - 0.75, top - pole, 1.5, pole).fill({ color: 0x2a2018 });
      this.drawFlag(g, t.cx, top - pole + 1, t.w * 0.7, t.w * 0.2, this.bannerColor, true, p + t.index * 1.7);
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
        this.puffTimer -= dt;
        if (this.puffTimer <= 0) {
          this.puffTimer = 260 + Math.random() * 200;
          const sprite = new Sprite(glow());
          sprite.anchor.set(0.5);
          sprite.tint = Math.random() > 0.5 ? 0x9fd8a8 : 0xb8c8b0;
          this.smoke.addChild(sprite);
          this.puffs.push({ sprite, life: 0, max: 2400 + Math.random() * 800, vx: (Math.random() - 0.2) * 0.01 * -this.facing, vy: -0.025 - Math.random() * 0.01 });
          sprite.position.set(chim.cx, chim.topY + chim.apex);
        }
        this.glowAt(glowIndex++, chim.cx, chim.topY + chim.apex - chim.w * 0.3, chim.w * 2.2, 0x6fffa0, 0.12 + Math.sin(p * 1.7) * 0.04);
        break;
      }
    }

    // Smoke puffs drift up and fade (they keep going even if the chimney falls).
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
