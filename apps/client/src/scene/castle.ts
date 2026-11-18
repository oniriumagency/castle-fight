import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';

/**
 * One castle: a Keep (tower) whose height follows the Keep value and a Wall
 * in front of it whose height follows the Wall value. Everything is drawn
 * procedurally so it can grow and crumble smoothly to any height.
 */

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
  wallWidth: number;
  /** Gap between Keep and Wall. */
  gap: number;
  /** Visual cap so a huge Wall does not leave the screen. */
  maxPoints: number;
}

const STONE_LIGHT = 0xe8dcc0;
const STONE_DARK = 0x3a3128;
const ROOF_DARK = 0x1c1a24;

export class Castle extends Container {
  /** +1: the Wall stands to the right of the Keep (left castle); -1: to the left. */
  readonly facing: 1 | -1;
  private layoutValue: CastleLayout | null = null;
  private keepValue = 30;
  private wallValue = 10;
  private flagPhase = Math.random() * 10;
  private bannerColor: number;

  private readonly mound = new Graphics();
  private readonly keepBody: TilingSprite;
  private readonly keepShade: Sprite;
  private readonly keepDetails = new Graphics();
  private readonly keepTop = new Container();
  private readonly keepCrown = new Graphics();
  private readonly flag = new Graphics();
  private readonly wallBody: TilingSprite;
  private readonly wallShade: Sprite;
  private readonly wallTop = new Graphics();
  private readonly cracks = new Graphics();
  private readonly rubble = new Graphics();
  readonly shieldBubble = new Graphics();
  private readonly frostCoat = new Graphics();
  private frozen = false;
  private hitColor = 0xffffff;
  private hitLeft = 0;
  private kick = 0;
  private kickPhase = 0;
  private shieldCharges = 0;
  private shieldPulse = 0;
  private detailKey = '';

  constructor(facing: 1 | -1, textures: CastleTextures, bannerColor: number) {
    super();
    this.facing = facing;
    this.bannerColor = bannerColor;
    this.keepBody = new TilingSprite({ texture: textures.keepStone, width: 10, height: 10 });
    this.keepShade = new Sprite(textures.shade);
    this.wallBody = new TilingSprite({ texture: textures.wallStone, width: 10, height: 10 });
    this.wallShade = new Sprite(textures.shade);
    this.wallShade.alpha = 0.8;
    this.keepTop.addChild(this.flag, this.keepCrown);
    this.addChild(
      this.mound,
      this.keepBody,
      this.keepShade,
      this.keepDetails,
      this.cracks,
      this.keepTop,
      this.wallBody,
      this.wallShade,
      this.wallTop,
      this.rubble,
      this.frostCoat,
      this.shieldBubble,
    );
  }

  get keep(): number {
    return this.keepValue;
  }

  get wall(): number {
    return this.wallValue;
  }

  setBanner(color: number): void {
    this.bannerColor = color;
    this.detailKey = '';
    this.redraw();
  }

  setLayout(layout: CastleLayout): void {
    this.layoutValue = layout;
    this.detailKey = '';
    this.drawMound();
    this.redraw();
  }

  /** Immediate heights (animation is driven from outside by calling this every frame). */
  setHeights(keep: number, wall: number): void {
    this.keepValue = Math.max(0, keep);
    this.wallValue = Math.max(0, wall);
    this.redraw();
  }

  get keepWidth(): number {
    return this.layoutValue?.keepWidth ?? 40;
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

  setShield(charges: number): void {
    this.shieldCharges = charges;
    this.drawShield();
  }

  /** Scene position of the top of the Keep or the Wall (for projectiles and floating numbers). */
  anchor(target: 'keep' | 'wall' | 'base'): { x: number; y: number } {
    const l = this.layoutValue;
    if (!l) return { x: 0, y: 0 };
    if (target === 'base') return { x: l.x, y: l.groundY };
    if (target === 'keep') return { x: l.x, y: l.groundY - this.keepPx() - l.unit * 3 };
    return { x: this.wallX(), y: l.groundY - this.wallPx() };
  }

  /** Called every frame: the flag waves and the shield breathes. */
  tick(dt: number): void {
    if (this.hitLeft > 0) {
      this.hitLeft = Math.max(0, this.hitLeft - dt);
      const k = this.hitLeft / 260;
      const c = this.hitColor;
      const mix = (shift: number): number => Math.round(255 + (((c >> shift) & 255) - 255) * k) << shift;
      this.tint = mix(16) | mix(8) | mix(0);
    }
    if (this.kick > 0.05) {
      this.kickPhase += dt * 0.05;
      this.x = -this.facing * this.kick * Math.cos(this.kickPhase);
      this.kick *= 0.86;
    } else if (this.x !== 0) {
      this.x = 0;
      this.kick = 0;
    }
    this.flagPhase += dt * 0.004;
    this.drawFlag();
    if (this.shieldCharges > 0) {
      this.shieldPulse += dt * 0.003;
      this.shieldBubble.alpha = 0.75 + Math.sin(this.shieldPulse) * 0.2;
    }
  }

  private keepPx(): number {
    const l = this.layoutValue!;
    return Math.min(this.keepValue, l.maxPoints) * l.unit;
  }

  private wallPx(): number {
    const l = this.layoutValue!;
    return Math.min(this.wallValue, l.maxPoints) * l.unit;
  }

  private wallX(): number {
    const l = this.layoutValue!;
    return l.x + this.facing * (l.keepWidth / 2 + l.gap + l.wallWidth / 2);
  }

  private drawMound(): void {
    const l = this.layoutValue!;
    const g = this.mound.clear();
    const w = l.keepWidth * 1.9 + l.gap + l.wallWidth;
    const cx = l.x + this.facing * (l.gap + l.wallWidth) * 0.45;
    // A rocky rise the castle sits on.
    g.ellipse(cx, l.groundY + 4, w * 0.62, l.unit * 4.5).fill({ color: 0x2b2a22 });
    g.ellipse(cx, l.groundY + 2, w * 0.55, l.unit * 3.2).fill({ color: 0x4a4434 });
    g.ellipse(cx - w * 0.1, l.groundY, w * 0.4, l.unit * 1.6).fill({ color: 0x5c5440, alpha: 0.7 });
  }

  private redraw(): void {
    const l = this.layoutValue;
    if (!l) return;
    const kh = Math.max(this.keepPx(), l.unit * 1.5);
    const kx = l.x - l.keepWidth / 2;
    const ky = l.groundY - kh;
    const brick = l.keepWidth / 4.6 / 34;

    this.keepBody.position.set(kx, ky);
    this.keepBody.width = l.keepWidth;
    this.keepBody.height = kh;
    this.keepBody.tileScale.set(brick);
    // Anchor the courses to the ground so the stones do not slide while the tower grows.
    this.keepBody.tilePosition.y = kh;
    this.keepShade.position.set(kx, ky);
    this.keepShade.width = l.keepWidth;
    this.keepShade.height = kh;
    this.keepTop.position.set(l.x, ky);
    this.keepTop.visible = this.keepValue > 0;

    const wh = this.wallPx();
    const wx = this.wallX() - l.wallWidth / 2;
    const wy = l.groundY - wh;
    this.wallBody.visible = this.wallShade.visible = this.wallTop.visible = wh > 0.5;
    this.wallBody.position.set(wx, wy);
    this.wallBody.width = l.wallWidth;
    this.wallBody.height = Math.max(1, wh);
    this.wallBody.tileScale.set(brick * 0.9);
    this.wallBody.tilePosition.y = wh;
    this.wallShade.position.set(wx, wy);
    this.wallShade.width = l.wallWidth;
    this.wallShade.height = Math.max(1, wh);

    this.drawWallTop(wx, wy, l);
    const key = `${Math.round(kh / l.unit)}|${l.keepWidth}|${this.bannerColor}`;
    if (key !== this.detailKey) {
      this.detailKey = key;
      this.drawKeepCrown(l);
      this.drawKeepDetails(kx, ky, kh, l);
    }
    this.drawRubble(l);
    this.drawShield();
    if (this.frozen) this.drawFrost();
  }

  private drawFrost(): void {
    const l = this.layoutValue;
    const g = this.frostCoat.clear();
    if (!l || !this.frozen) return;
    const kh = Math.max(this.keepPx(), l.unit * 1.5);
    const kx = l.x - l.keepWidth / 2;
    const wh = this.wallPx();
    const wx = this.wallX() - l.wallWidth / 2;
    g.rect(kx, l.groundY - kh, l.keepWidth, kh).fill({ color: 0xbfeaff, alpha: 0.22 });
    if (wh > 0.5) g.rect(wx, l.groundY - wh, l.wallWidth, wh).fill({ color: 0xbfeaff, alpha: 0.22 });
    // Icicles under the parapet and along the wall top.
    const icicles = (x0: number, width: number, y: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        const x = x0 + (width * (i + 0.5)) / n;
        const len = l.unit * (1.5 + ((i * 7) % 4));
        g.poly([x - 2.5, y, x + 2.5, y, x, y + len]).fill({ color: 0xeaf9ff, alpha: 0.85 });
      }
    };
    icicles(kx, l.keepWidth, l.groundY - kh, 6);
    if (wh > 0.5) icicles(wx, l.wallWidth, l.groundY - wh, 3);
    g.rect(kx, l.groundY - kh, l.keepWidth, 2).fill({ color: 0xffffff, alpha: 0.7 });
  }

  private drawKeepCrown(l: CastleLayout): void {
    const g = this.keepCrown.clear();
    const w = l.keepWidth;
    const lip = w * 0.08;
    const band = l.unit * 2.4;
    // Corbelled parapet, wider than the tower.
    g.rect(-w / 2 - lip, -band, w + lip * 2, band).fill({ color: STONE_LIGHT });
    g.rect(-w / 2 - lip, -band * 0.25, w + lip * 2, band * 0.25).fill({ color: 0x000000, alpha: 0.25 });
    for (let i = 0; i < 6; i++) {
      const cx = -w / 2 - lip + ((w + lip * 2) / 6) * (i + 0.5);
      g.rect(cx - w * 0.035, -band * 0.02, w * 0.07, band * 0.45).fill({ color: 0x8a7c62 });
    }
    // Merlons.
    const merlons = 5;
    const mw = (w + lip * 2) / (merlons * 2 - 1);
    for (let i = 0; i < merlons; i++) {
      const mx = -w / 2 - lip + i * mw * 2;
      g.rect(mx, -band - mw * 1.1, mw, mw * 1.1).fill({ color: STONE_LIGHT });
      g.rect(mx + mw * 0.7, -band - mw * 1.1, mw * 0.3, mw * 1.1).fill({ color: 0x000000, alpha: 0.18 });
    }
    // Conical roof behind the merlons, in the hero's colour.
    const roofBase = -band - mw * 0.4;
    const roofH = w * 0.95;
    g.poly([-w * 0.42, roofBase, 0, roofBase - roofH, w * 0.42, roofBase]).fill({ color: this.bannerColor });
    g.poly([0, roofBase - roofH, w * 0.42, roofBase, w * 0.12, roofBase]).fill({ color: ROOF_DARK, alpha: 0.35 });
    // Roof tiles.
    for (let i = 1; i < 5; i++) {
      const y = roofBase - (roofH * i) / 5;
      const half = w * 0.42 * (1 - i / 5);
      g.moveTo(-half, y).lineTo(half, y).stroke({ width: 1, color: 0x000000, alpha: 0.18 });
    }
    // Re-draw the front merlons over the roof base.
    for (let i = 0; i < merlons; i++) {
      const mx = -w / 2 - lip + i * mw * 2;
      g.rect(mx, -band - mw * 1.1, mw, mw * 1.1).fill({ color: STONE_LIGHT });
      g.rect(mx + mw * 0.7, -band - mw * 1.1, mw * 0.3, mw * 1.1).fill({ color: 0x000000, alpha: 0.15 });
    }
    // Flag pole.
    g.rect(-1, roofBase - roofH - w * 0.55, 2, w * 0.58).fill({ color: 0x2a2018 });
    g.circle(0, roofBase - roofH - w * 0.56, 2.2).fill({ color: 0xe3b656 });
    this.flag.position.set(1, roofBase - roofH - w * 0.53);
    this.drawFlag();
  }

  private drawFlag(): void {
    const l = this.layoutValue;
    if (!l) return;
    const g = this.flag.clear();
    const len = l.keepWidth * 0.62;
    const h = l.keepWidth * 0.22;
    const dir = this.facing;
    const pts: number[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(dir * len * t, Math.sin(this.flagPhase + t * 3) * h * 0.18 * t);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const taper = 1 - t * 0.35;
      pts.push(dir * len * t, h * taper + Math.sin(this.flagPhase + t * 3) * h * 0.18 * t);
    }
    g.poly(pts).fill({ color: this.bannerColor });
    g.poly(pts).stroke({ width: 1, color: 0xe3b656, alpha: 0.7 });
  }

  private drawKeepDetails(kx: number, ky: number, kh: number, l: CastleLayout): void {
    const g = this.keepDetails.clear();
    const w = l.keepWidth;
    // Door.
    const dw = w * 0.26;
    const dh = Math.min(kh * 0.8, l.unit * 7);
    if (dh > l.unit * 2) {
      g.roundRect(l.x - dw / 2, l.groundY - dh, dw, dh, dw / 2).fill({ color: 0x1a120c });
      g.roundRect(l.x - dw / 2 + 2, l.groundY - dh + 2, dw - 4, dh - 2, dw / 2).fill({ color: 0x3b2817 });
      g.rect(l.x - 1, l.groundY - dh + dw * 0.4, 2, dh - dw * 0.4).fill({ color: 0x1a120c });
    }
    // Windows every ~11 points, lit warm from inside.
    const step = l.unit * 11;
    for (let y = l.groundY - l.unit * 13; y > ky + l.unit * 4; y -= step) {
      const ww = w * 0.1;
      const wh = ww * 2.2;
      for (const off of [-0.22, 0.22]) {
        const x = l.x + off * w - ww / 2;
        g.roundRect(x - 1, y - wh - 1, ww + 2, wh + 2, ww / 2).fill({ color: STONE_DARK });
        g.roundRect(x, y - wh, ww, wh, ww / 2).fill({ color: 0xffc56a, alpha: 0.85 });
        g.roundRect(x, y - wh * 0.45, ww, wh * 0.45, 1).fill({ color: 0xff8a3a, alpha: 0.45 });
      }
      // String course between floors.
      g.rect(kx, y + l.unit * 1.2, w, Math.max(2, l.unit * 0.45)).fill({ color: 0x000000, alpha: 0.16 });
    }
    // Cracks once the Keep is in danger.
    const c = this.cracks.clear();
    if (this.keepValue > 0 && this.keepValue < l.maxPoints * 0.14) {
      const severity = 1 - this.keepValue / (l.maxPoints * 0.14);
      const n = 2 + Math.round(severity * 4);
      for (let i = 0; i < n; i++) {
        const sx = kx + w * (0.15 + ((i * 37) % 70) / 100);
        let x = sx;
        let y = ky + kh * (0.15 + ((i * 53) % 60) / 100);
        c.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
          x += (((i + s) * 29) % 7) - 3;
          y += l.unit * (1.5 + ((s * 13) % 3));
          c.lineTo(x, Math.min(y, l.groundY));
        }
        c.stroke({ width: 1.5, color: 0x1a1410, alpha: 0.75 });
      }
    }
  }

  private drawWallTop(wx: number, wy: number, l: CastleLayout): void {
    const g = this.wallTop.clear();
    if (this.wallPx() < 0.5) return;
    const w = l.wallWidth;
    const merlons = 3;
    const mw = w / (merlons * 2 - 1);
    const mh = Math.min(mw * 1.1, l.unit * 3);
    for (let i = 0; i < merlons; i++) {
      const mx = wx + i * mw * 2;
      g.rect(mx, wy - mh, mw, mh).fill({ color: 0xa69a88 });
      g.rect(mx + mw * 0.7, wy - mh, mw * 0.3, mh).fill({ color: 0x000000, alpha: 0.2 });
    }
    g.rect(wx - 2, wy, w + 4, Math.max(2, l.unit * 0.6)).fill({ color: 0xbdb19c });
    g.rect(wx - 2, wy + Math.max(2, l.unit * 0.6), w + 4, 2).fill({ color: 0x000000, alpha: 0.25 });
  }

  private drawRubble(l: CastleLayout): void {
    const g = this.rubble.clear();
    if (this.keepValue > 0) return;
    // A fallen Keep: a heap of stones where the tower stood.
    for (let i = 0; i < 18; i++) {
      const x = l.x + (((i * 47) % 100) / 100 - 0.5) * l.keepWidth * 1.4;
      const y = l.groundY - (((i * 31) % 10) / 10) * l.unit * 4;
      const s = l.keepWidth * (0.08 + ((i * 17) % 10) / 100);
      g.roundRect(x - s / 2, y - s / 2, s, s * 0.7, 2).fill({ color: i % 3 ? 0xb8a582 : 0x8a7c62 });
    }
  }

  private drawShield(): void {
    const l = this.layoutValue;
    const g = this.shieldBubble.clear();
    if (!l || this.shieldCharges <= 0) return;
    const top = Math.max(this.keepPx(), this.wallPx()) + l.keepWidth * 1.6;
    const cx = l.x + this.facing * (l.gap + l.wallWidth) * 0.5;
    const rx = l.keepWidth * 1.25 + l.wallWidth;
    const ry = top + l.unit * 2;
    g.ellipse(cx, l.groundY, rx, ry).fill({ color: 0x7fd6ff, alpha: 0.08 + this.shieldCharges * 0.03 });
    g.ellipse(cx, l.groundY, rx, ry).stroke({ width: 2 + this.shieldCharges, color: 0xaee8ff, alpha: 0.55 });
    g.ellipse(cx - rx * 0.25, l.groundY - ry * 0.55, rx * 0.25, ry * 0.18).fill({ color: 0xffffff, alpha: 0.08 });
  }
}
