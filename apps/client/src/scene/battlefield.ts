import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { DEFAULT_RULES, type PlayerId } from '@cardcraft-castles/engine';
import { settings } from '../app/settings';
import { DEFAULT_SKY, type SkyMood } from '../ui/theme';
import { Castle } from './castle';
import {
  KEEP_STONE,
  WALL_STONE,
  cloudTexture,
  glowTexture,
  gradientTexture,
  particleTexture,
  rubbleTexture,
  seededRandom,
  stoneTexture,
  towerShadeTexture,
} from './textures';
import { Tweens, ease } from './tween';

/**
 * The painted battlefield behind the interface: sky, clouds, mountains,
 * ground and the two castles, plus a small particle system for debris,
 * sparks, magic and weather. The board drives it; the later VFX pass can
 * add to `fxLayer` and the helpers here.
 */

export interface FieldRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  life: number;
  maxLife: number;
  spin: number;
  fade: boolean;
  shrink: boolean;
}

export interface BurstOptions {
  count?: number;
  color?: number | number[];
  speed?: number;
  /** Radians; default all around. */
  angle?: number;
  spread?: number;
  gravity?: number;
  size?: number;
  life?: number;
  texture?: 'glow' | 'rubble';
  blend?: 'add' | 'normal';
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export class Battlefield {
  readonly tweens: Tweens;
  readonly castles: [Castle, Castle];
  /** Layer above the castles for effects. */
  readonly fxLayer = new Container();

  private readonly world = new Container();
  private readonly skyA = new Sprite();
  private readonly skyB = new Sprite();
  private readonly sun: Sprite;
  private readonly clouds: Sprite[] = [];
  private readonly far = new Graphics();
  private readonly mid = new Graphics();
  private readonly near = new Graphics();
  private readonly ground = new Graphics();
  private readonly weather = new Container();
  private readonly particles: Particle[] = [];
  private readonly glowTex: Texture;
  private readonly rubbleTex: Texture;
  private readonly flashOverlay = new Graphics();
  private mood: SkyMood = DEFAULT_SKY;
  private tint = { far: DEFAULT_SKY.far, mid: DEFAULT_SKY.near, near: DEFAULT_SKY.near, ground: DEFAULT_SKY.ground };
  private width = 0;
  private height = 0;
  private groundY = 0;
  /** Keep height that fills the field: the winning Keep of the current rules. */
  private maxPoints = DEFAULT_RULES.keepWin;
  private lastRect: FieldRect | undefined;
  private shakePower = 0;
  private weatherTimer = 0;
  private castleTargets: [{ keep: number; wall: number }, { keep: number; wall: number }] = [
    { keep: 30, wall: 10 },
    { keep: 30, wall: 10 },
  ];

  constructor(private readonly app: Application) {
    this.tweens = new Tweens(app.ticker);
    this.glowTex = particleTexture();
    this.rubbleTex = rubbleTexture();
    this.sun = new Sprite(glowTexture('255,214,150', 256));
    this.sun.anchor.set(0.5);
    this.sun.blendMode = 'add';
    for (let i = 0; i < 5; i++) {
      const cloud = new Sprite(cloudTexture(100 + i));
      cloud.anchor.set(0.5);
      cloud.alpha = 0.35 + (i % 3) * 0.12;
      this.clouds.push(cloud);
    }
    const textures = { keepStone: stoneTexture(KEEP_STONE), wallStone: stoneTexture(WALL_STONE), shade: towerShadeTexture() };
    // Each castle is drawn in its hero's style; the menu shows two contrasting ones.
    this.castles = [new Castle(1, textures, 0xc8963e, 'arquitecta'), new Castle(-1, textures, 0xa8322d, 'mariscal')];

    this.world.addChild(this.skyA, this.skyB, this.sun, ...this.clouds, this.far, this.mid, this.near, this.ground);
    this.world.addChild(this.castles[0], this.castles[1], this.fxLayer, this.weather);
    app.stage.addChild(this.world, this.flashOverlay);
    this.applySky(DEFAULT_SKY, this.skyA);
    this.skyB.alpha = 0;

    app.ticker.add((t) => this.update(t.deltaMS));
  }

  /** Lays out the scene. `field` is the free area between the HUD panels (CSS px). */
  /** Scales the castles so a winning Keep fills the field. */
  setMaxPoints(points: number): void {
    if (points === this.maxPoints) return;
    this.maxPoints = points;
    this.layout(this.lastRect);
  }

  layout(field?: FieldRect): void {
    this.width = this.app.screen.width;
    this.height = this.app.screen.height;
    if (field) this.lastRect = field;
    const rect = field ?? { left: 0, top: this.height * 0.12, width: this.width, height: this.height * 0.62 };
    this.groundY = rect.top + rect.height * 0.94;

    for (const sky of [this.skyA, this.skyB]) {
      sky.width = this.width;
      sky.height = this.groundY + 4;
    }
    this.sun.position.set(this.width * 0.5, this.groundY - rect.height * 0.32);
    this.sun.scale.set(Math.max(this.width, this.height) / 256 * 0.9);
    this.clouds.forEach((cloud, i) => {
      cloud.position.set(((i * 0.23 + 0.1) % 1) * this.width, rect.top + rect.height * (0.08 + (i % 3) * 0.1));
      cloud.scale.set((this.width / 512) * (0.5 + (i % 2) * 0.25));
    });
    this.drawLandscape();

    // The castles fit a winning Keep in the field, leaving room for the roof.
    const sideRoom = Math.min(rect.width * 0.23, 260);
    const keepWidth = Math.max(34, Math.min(rect.width * 0.075, 96));
    const unit = Math.max(1.2, (rect.height * 0.94 - keepWidth * 2.2) / this.maxPoints);
    const common = { groundY: this.groundY, unit, keepWidth, wallWidth: keepWidth * 0.42, gap: keepWidth * 0.55, maxPoints: this.maxPoints * 1.1 };
    this.castles[0].setLayout({ ...common, x: rect.left + sideRoom * 0.75 });
    this.castles[1].setLayout({ ...common, x: rect.left + rect.width - sideRoom * 0.75 });

    this.flashOverlay.clear().rect(0, 0, this.width, this.height).fill({ color: 0xffffff });
    this.flashOverlay.alpha = 0;
  }

  private drawLandscape(): void {
    const w = this.width;
    const gy = this.groundY;
    const ridge = (g: Graphics, seed: number, base: number, amp: number, roughness: number): void => {
      const r = seededRandom(seed);
      const points: number[] = [0, this.height];
      const steps = 28;
      let y = base;
      for (let i = 0; i <= steps; i++) {
        y = base - amp * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.7 + seed))) - (r() - 0.5) * amp * roughness;
        points.push((w * i) / steps, y);
      }
      points.push(w, this.height);
      g.clear().poly(points).fill({ color: 0xffffff });
    };
    ridge(this.far, 3, gy - this.height * 0.06, this.height * 0.2, 0.5);
    ridge(this.mid, 9, gy - this.height * 0.02, this.height * 0.1, 0.6);
    ridge(this.near, 17, gy + 2, this.height * 0.035, 0.8);
    this.far.alpha = 0.75;
    this.mid.alpha = 0.9;
    const g = this.ground.clear();
    g.rect(0, gy, w, this.height - gy).fill({ color: 0xffffff });
    this.applyTints();
  }

  private applyTints(): void {
    this.far.tint = this.tint.far;
    this.mid.tint = lerpColor(this.tint.far, this.tint.near, 0.55);
    this.near.tint = this.tint.near;
    this.ground.tint = this.tint.ground;
  }

  private applySky(mood: SkyMood, sprite: Sprite): void {
    sprite.texture = gradientTexture([
      [0, mood.top],
      [0.55, mood.middle],
      [1, mood.horizon],
    ]);
    sprite.width = this.width || this.app.screen.width;
    sprite.height = (this.groundY || this.app.screen.height * 0.7) + 4;
  }

  /** Cross-fades the sky, land colours and weather to a new mood (battle events). */
  setMood(mood: SkyMood, ms = 1600): Promise<void> {
    if (mood === this.mood) return Promise.resolve();
    const from = { ...this.tint };
    const to = { far: mood.far, mid: mood.near, near: mood.near, ground: mood.ground };
    this.mood = mood;
    this.applySky(mood, this.skyB);
    this.skyB.alpha = 0;
    const sunFrom = this.sun.alpha;
    this.sun.texture = glowTexture(mood.sun, 256);
    return this.tweens
      .run(ms, (t) => {
        this.skyB.alpha = t;
        this.sun.alpha = sunFrom + (mood.sunAlpha - sunFrom) * t;
        this.tint = {
          far: lerpColor(from.far, to.far, t),
          mid: lerpColor(from.mid, to.mid, t),
          near: lerpColor(from.near, to.near, t),
          ground: lerpColor(from.ground, to.ground, t),
        };
        this.applyTints();
      }, ease.inOutCubic)
      .then(() => {
        this.applySky(mood, this.skyA);
        this.skyB.alpha = 0;
      });
  }

  setBanners(colors: [number, number]): void {
    this.castles[0].setBanner(colors[0]);
    this.castles[1].setBanner(colors[1]);
  }

  /** Draws each castle in its hero's style (towers, roofs, stone) with the hero's banner colour. */
  setHeroes(heroes: [string, string]): void {
    this.castles[0].setHero(heroes[0]);
    this.castles[1].setHero(heroes[1]);
  }

  /** Scene tops of every standing tower of a castle, Keep first (screen CSS px). */
  towerTops(player: PlayerId): { x: number; y: number; width: number }[] {
    return this.castles[player].towerTops().map((t) => ({ ...t, x: t.x + this.world.x, y: t.y + this.world.y }));
  }

  /** Jump straight to these heights (new game, resume, layout). */
  setCastles(values: [{ keep: number; wall: number }, { keep: number; wall: number }]): void {
    this.castleTargets = [{ ...values[0] }, { ...values[1] }];
    this.castles.forEach((c, i) => c.setHeights(values[i].keep, values[i].wall));
  }

  /** Grow or shrink one castle smoothly. */
  animateCastle(player: PlayerId, keep: number, wall: number, ms = 700): Promise<void> {
    const castle = this.castles[player];
    const from = { keep: castle.keep, wall: castle.wall };
    this.castleTargets[player] = { keep, wall };
    const growing = keep >= from.keep && wall >= from.wall;
    return this.tweens.run(
      ms,
      (t) => castle.setHeights(from.keep + (keep - from.keep) * t, from.wall + (wall - from.wall) * t),
      growing ? ease.outBack : ease.outCubic,
    );
  }

  setShield(player: PlayerId, charges: number): void {
    this.castles[player].setShield(charges);
  }

  /** Screen position (CSS px) of a castle part. */
  anchor(player: PlayerId, target: 'keep' | 'wall' | 'base'): { x: number; y: number } {
    const p = this.castles[player].anchor(target);
    return { x: p.x + this.world.x, y: p.y + this.world.y };
  }

  shake(power = 8): void {
    if (!settings.get().screenShake || settings.get().reducedMotion) return;
    this.shakePower = Math.max(this.shakePower, power);
  }

  flash(color = 0xffffff, alpha = 0.35, ms = 260): void {
    if (settings.get().reducedMotion) return;
    this.flashOverlay.tint = color;
    this.flashOverlay.alpha = alpha;
    void this.tweens.to(this.flashOverlay, { alpha: 0 }, ms);
  }

  burst(x: number, y: number, opts: BurstOptions = {}): void {
    const count = Math.round((opts.count ?? 16) * (settings.get().reducedMotion ? 0.4 : 1));
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color ?? 0xffd27a];
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite(opts.texture === 'rubble' ? this.rubbleTex : this.glowTex);
      sprite.anchor.set(0.5);
      sprite.position.set(x, y);
      sprite.tint = colors[i % colors.length];
      sprite.blendMode = opts.blend ?? (opts.texture === 'rubble' ? 'normal' : 'add');
      const size = (opts.size ?? 10) * (0.6 + Math.random() * 0.8);
      sprite.width = sprite.height = size;
      const angle = (opts.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2);
      const speed = (opts.speed ?? 4) * (0.4 + Math.random() * 0.9);
      const life = (opts.life ?? 900) * (0.6 + Math.random() * 0.6);
      this.fxLayer.addChild(sprite);
      this.particles.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: opts.gravity ?? 0.12,
        drag: 0.985,
        life,
        maxLife: life,
        spin: (Math.random() - 0.5) * 0.2,
        fade: true,
        shrink: opts.texture !== 'rubble',
      });
    }
  }

  /** A glowing missile that arcs from one castle to the other. Resolves on impact. */
  projectile(from: { x: number; y: number }, to: { x: number; y: number }, color = 0xffb35a, ms = 520): Promise<void> {
    const head = new Sprite(this.glowTex);
    head.anchor.set(0.5);
    head.tint = color;
    head.blendMode = 'add';
    head.width = head.height = 30;
    this.fxLayer.addChild(head);
    const lift = Math.min(260, Math.abs(to.x - from.x) * 0.35);
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - lift;
    let trail = 0;
    return this.tweens
      .run(
        ms,
        (t) => {
          const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
          const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cy + t * t * to.y;
          head.position.set(x, y);
          if (++trail % 2 === 0) this.burst(x, y, { count: 2, color, speed: 0.6, gravity: 0, size: 14, life: 380 });
        },
        ease.inCubic,
      )
      .then(() => head.destroy());
  }

  private update(dt: number): void {
    const step = dt / 16.67;
    const calm = settings.get().reducedMotion;
    for (const castle of this.castles) castle.tick(dt, calm);
    // Clouds drift.
    for (const [i, cloud] of this.clouds.entries()) {
      cloud.x += (0.06 + i * 0.02) * step;
      if (cloud.x - cloud.width / 2 > this.width) cloud.x = -cloud.width / 2;
    }
    // Particles.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity * step;
      p.sprite.x += p.vx * step;
      p.sprite.y += p.vy * step;
      p.sprite.rotation += p.spin * step;
      if (p.sprite.y > this.groundY + 6 && p.gravity > 0) {
        p.sprite.y = this.groundY + 6;
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
      const k = p.life / p.maxLife;
      if (p.fade) p.sprite.alpha = Math.min(1, k * 1.6);
      if (p.shrink) p.sprite.scale.set(p.sprite.scale.x * (0.995 - (1 - k) * 0.004));
    }
    this.updateWeather(dt);
    // Camera shake.
    if (this.shakePower > 0.2) {
      this.world.position.set((Math.random() - 0.5) * this.shakePower, (Math.random() - 0.5) * this.shakePower);
      this.shakePower *= 0.88;
    } else if (this.world.x || this.world.y) {
      this.world.position.set(0, 0);
      this.shakePower = 0;
    }
  }

  private updateWeather(dt: number): void {
    const kind = this.mood.weather;
    if (kind === 'none' || settings.get().reducedMotion) return;
    this.weatherTimer += dt;
    const every = kind === 'rain' ? 14 : kind === 'snow' ? 60 : 120;
    while (this.weatherTimer > every) {
      this.weatherTimer -= every;
      const x = Math.random() * this.width;
      switch (kind) {
        case 'rain':
          this.burst(x, -10, { count: 1, color: 0x9fb4d8, speed: 14, angle: Math.PI / 2 + 0.15, spread: 0.05, gravity: 0.3, size: 5, life: 1400, blend: 'normal' });
          break;
        case 'snow':
          this.burst(x, -10, { count: 1, color: 0xffffff, speed: 1.2, angle: Math.PI / 2, spread: 0.6, gravity: 0.005, size: 7, life: 9000, blend: 'normal' });
          break;
        case 'embers':
          this.burst(x, this.groundY, { count: 1, color: 0xc77dff, speed: 1, angle: -Math.PI / 2, spread: 0.6, gravity: -0.004, size: 9, life: 4000 });
          break;
        case 'leaves':
          this.burst(x, -10, { count: 1, color: [0xe0a040, 0xc06a2a, 0xd8c060], speed: 1.4, angle: Math.PI / 2 + 0.4, spread: 0.6, gravity: 0.006, size: 8, life: 8000, blend: 'normal' });
          break;
        case 'dust':
          this.burst(x, this.groundY - Math.random() * 30, { count: 1, color: 0xc8a070, speed: 0.8, angle: 0, spread: 0.6, gravity: -0.002, size: 22, life: 3000, blend: 'normal' });
          break;
      }
    }
  }
}
