import { Application, Assets, Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { DEFAULT_RULES, type PlayerId } from '@cardcraft-castles/engine';
import { consoleBrowser, density, effectsLow, particleBudget, reportSlowFrames } from '../app/quality';
import { settings } from '../app/settings';
import { artUrl } from '../ui/assets';
import { DEFAULT_SKY, type SkyMood } from '../ui/theme';
import { Castle } from './castle';
import {
  KEEP_STONE,
  WALL_STONE,
  cloudTexture,
  crystalTexture,
  flareTexture,
  flameTexture,
  glowTexture,
  gradientTexture,
  particleTexture,
  raysTexture,
  ringTexture,
  rubbleTexture,
  seededRandom,
  smokeTexture,
  sparkTexture,
  stoneTexture,
  towerShadeTexture,
} from './textures';
import { Tweens, ease } from './tween';

/**
 * The painted battlefield behind the interface: sky, clouds, mountains,
 * ground and the two castles, plus the effects drawn over them: a pooled
 * particle system (debris, sparks, smoke, flames, ice), shockwave rings,
 * light rays, lightning, projectiles, status auras on the castles and a
 * smooth screen shake. `fx/director.ts` decides which effect plays when.
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
  /** Per-frame scale growth (smoke) or shrink (sparks). */
  grow: number;
  baseScale: number;
  /** Growing smoke stops here, so a cloud never covers half the screen. */
  maxScale: number;
  stretch: boolean;
  alpha: number;
  colorFrom: number;
  colorTo: number | null;
  floor: boolean;
}

export type ParticleShape = 'glow' | 'rubble' | 'smoke' | 'spark' | 'crystal' | 'flame';

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
  texture?: ParticleShape;
  blend?: 'add' | 'normal';
  /** Spawn area around the point, in px. */
  area?: { w: number; h: number };
  /** Colour at the end of each particle's life. */
  colorTo?: number;
  /** Scale change per frame: >1 grows (smoke), <1 shrinks. */
  grow?: number;
  drag?: number;
  alpha?: number;
}

export type ProjectileStyle = 'orb' | 'boulder' | 'bolt' | 'fire' | 'arrows' | 'comet' | 'charge' | 'frost';

interface Flash {
  sprite: Sprite;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  alpha: number;
  spin: number;
}

interface Aura {
  burn: number;
  frost: number;
  danger: number;
  timer: number;
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

/**
 * The painted battlefield, in two layers from `art/scenery/` (see
 * design/art-prompts.md):
 * - `sky.jpg`: clouds only. A panorama at least 2.8 times wider than tall is
 *   taken as seamless and drifts endlessly; any other sky covers the screen
 *   with a little room to spare and sways slowly from side to side.
 * - `terrain.png`: mountains, hills and the valley floor with the sky cut out.
 *   Its ground line, where the castles stand, is TERRAIN_GROUND down the image.
 * A single `backdrop.jpg` (sky and land in one) also works. Missing files keep
 * the drawn landscape for that layer.
 */
const SKY = 'scenery/sky.jpg';
const TERRAIN = 'scenery/terrain.png';
const BACKDROP = 'scenery/backdrop.jpg';
const TERRAIN_GROUND = 0.72;
/** The sky is drawn this much wider than the screen, and sways across the extra. */
const SKY_OVERSCAN = 0.12;
/** One full sway, left and back, in milliseconds. */
const SKY_SWAY_MS = 180_000;
/** Endless drift of a seamless sky, in screen pixels per second. */
const SKY_DRIFT = 5;
const SEAMLESS_ASPECT = 2.8;
/**
 * The painted sky sits this far (of its height) above the horizon, so its
 * clouds clear the mountains; below it, its own horizon colour fills down.
 */
const SKY_LIFT = 0.2;
const SKY_HORIZON = 0xbe8364;
/**
 * Over a painted sky, a battle event's own sky gradient is multiplied on top
 * this strongly, so an eclipse, a storm or the dusk of the Twilight Fury
 * still reads at a glance. The default mood leaves the painting alone.
 */
const SKY_WASH = 0.8;

function isDefaultMood(mood: SkyMood): boolean {
  return mood.top === DEFAULT_SKY.top && mood.middle === DEFAULT_SKY.middle;
}

async function loadArt(path: string): Promise<Texture | null> {
  try {
    const texture = await Assets.load<Texture>({ src: artUrl(path), parser: 'loadTextures' });
    return texture?.width ? texture : null;
  } catch {
    return null;
  }
}

function hexColor(css: string): number {
  return parseInt(css.replace('#', ''), 16);
}

/** Per channel, how far `c` is from `base` (lighter or darker), as a tint that leaves `base` unchanged. */
function ratioTint(pairs: [number, number][]): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const k = pairs.reduce((sum, [c, base]) => sum + (((c >> shift) & 255) + 24) / (((base >> shift) & 255) + 24), 0) / pairs.length;
    out |= Math.round(Math.min(1, Math.max(0.3, k)) * 255) << shift;
  }
  return out;
}

function skyTint(mood: SkyMood): number {
  return ratioTint([
    [hexColor(mood.top), hexColor(DEFAULT_SKY.top)],
    [hexColor(mood.middle), hexColor(DEFAULT_SKY.middle)],
  ]);
}

/**
 * Battle events recolour the painted backdrop by how far their land colours
 * are from the default ones: the default mood leaves it as painted.
 */
function paintTint(mood: SkyMood): number {
  return ratioTint([
    [mood.far, DEFAULT_SKY.far],
    [mood.near, DEFAULT_SKY.near],
  ]);
}

export class Battlefield {
  readonly tweens: Tweens;
  /** Every castle the scene can show; only the first `count` are on the field. */
  readonly castles: Castle[];
  /** Castles on the field: two in a duel, three in a free-for-all. */
  private count = 2;
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
  private readonly paintedSky = new Sprite();
  /** A seamless sky, drawn instead of `paintedSky`. */
  private readonly skyTile = new TilingSprite();
  /** Horizon colour under the lifted sky, behind the mountains. */
  private readonly skyFloor = new Graphics();
  /** Holds the gradient skies when they wash over a painted one. */
  private readonly skyWash = new Container();
  private paintedSkyLoaded = false;
  private skySway = { x: 0, room: 0, time: 0 };
  /** The drawn sun glow; a painted sky has its own light, so it is off. */
  private paintedLight = false;
  private readonly painted = new Sprite();
  /** Under the painted land, in case the screen is taller than its foreground. */
  private readonly paintedFloor = new Graphics();
  private paintedTint = { from: 0xffffff, to: 0xffffff, skyFrom: 0xffffff, skyTo: 0xffffff };
  private readonly weather = new Container();
  private readonly particles: Particle[] = [];
  private readonly pool: Sprite[] = [];
  private readonly flashes: Flash[] = [];
  private readonly textures: Record<ParticleShape, Texture>;
  private readonly ringTex: Texture;
  private readonly raysTex: Texture;
  private readonly flareTex: Texture;
  private readonly bolts = new Graphics();
  private readonly flashOverlay = new Graphics();
  private readonly auras: Aura[] = [
    { burn: 0, frost: 0, danger: 0, timer: 0 },
    { burn: 0, frost: 0, danger: 0, timer: 0 },
    { burn: 0, frost: 0, danger: 0, timer: 0 },
  ];
  /** Called for ambient sounds the scene makes on its own (storm thunder). */
  onAmbient: ((kind: 'thunder') => void) | null = null;
  private trauma = 0;
  private shakeTime = 0;
  private slowFrames = 0;
  private lightningTimer = 4000;
  private mood: SkyMood = DEFAULT_SKY;
  private tint = { far: DEFAULT_SKY.far, mid: DEFAULT_SKY.near, near: DEFAULT_SKY.near, ground: DEFAULT_SKY.ground };
  private width = 0;
  private height = 0;
  private groundY = 0;
  /** Keep height that fills the field: the winning Keep of the current rules. */
  private maxPoints = DEFAULT_RULES.keepWin;
  private lastRect: FieldRect | undefined;
  private weatherTimer = 0;
  private castleTargets: { keep: number; wall: number }[] = [
    { keep: 30, wall: 10 },
    { keep: 30, wall: 10 },
    { keep: 30, wall: 10 },
  ];

  constructor(private readonly app: Application) {
    this.tweens = new Tweens(app.ticker);
    this.textures = {
      glow: particleTexture(),
      rubble: rubbleTexture(),
      smoke: smokeTexture(),
      spark: sparkTexture(),
      crystal: crystalTexture(),
      flame: flameTexture(),
    };
    this.ringTex = ringTexture();
    this.raysTex = raysTexture();
    this.flareTex = flareTexture();
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
    // The third castle only stands in a free-for-all: in the middle, facing the player.
    this.castles = [
      new Castle(1, textures, 0xc8963e, 'arquitecta'),
      new Castle(-1, textures, 0xa8322d, 'mariscal'),
      new Castle(-1, textures, 0x3f6fb0, 'guardian'),
    ];
    this.castles[2].visible = false;

    this.painted.visible = false;
    this.paintedSky.visible = false;
    this.skyTile.visible = false;
    this.world.addChild(this.skyA, this.skyB, this.skyFloor, this.paintedSky, this.skyTile, this.paintedFloor, this.painted, this.sun, ...this.clouds, this.far, this.mid, this.near, this.ground);
    this.world.addChild(this.castles[2], this.castles[0], this.castles[1], this.fxLayer, this.bolts, this.weather);
    app.stage.addChild(this.world, this.flashOverlay);
    this.applySky(DEFAULT_SKY, this.skyA);
    this.skyB.alpha = 0;

    app.ticker.add((t) => this.update(t.deltaMS));
    void this.loadBackdrop();
  }

  /** Swaps the drawn sky and land for the painted layers that exist. */
  private async loadBackdrop(): Promise<void> {
    const [sky, terrain] = await Promise.all([loadArt(SKY), loadArt(TERRAIN)]);
    const land = terrain ?? (await loadArt(BACKDROP));
    if (sky) {
      this.paintedSky.texture = sky;
      this.skyTile.texture = sky;
      const seamless = sky.width / sky.height >= SEAMLESS_ASPECT;
      this.paintedSky.visible = !seamless;
      this.skyTile.visible = seamless;
      this.paintedSky.tint = this.skyTile.tint = this.skyFloor.tint = skyTint(this.mood);
      // The gradient skies move above the painting, multiplied, as the events' wash.
      this.paintedSkyLoaded = true;
      this.skyA.blendMode = this.skyB.blendMode = 'multiply';
      this.skyWash.addChild(this.skyA, this.skyB);
      this.world.addChildAt(this.skyWash, this.world.getChildIndex(this.skyTile) + 1);
      this.skyWash.alpha = isDefaultMood(this.mood) ? 0 : SKY_WASH;
      // Painted clouds are in the picture; the drawn ones only drift faintly over it.
      for (const cloud of this.clouds) cloud.alpha *= 0.45;
    }
    if (land) {
      this.painted.texture = land;
      this.painted.visible = true;
      this.painted.tint = this.paintedFloor.tint = paintTint(this.mood);
      for (const layer of [this.far, this.mid, this.near, this.ground]) layer.visible = false;
      // A whole backdrop brings its own sky.
      if (!terrain && !sky) {
        this.skyA.visible = this.skyB.visible = false;
        for (const cloud of this.clouds) cloud.alpha *= 0.45;
      }
    }
    if (sky || (land && !terrain)) {
      this.paintedLight = true;
      this.sun.alpha = this.mood.sunAlpha * this.sunGainFor(this.mood);
    }
    this.layoutBackdrop();
  }

  /**
   * The drawn sun glow is off over a painting, events included: the painting
   * has its own light, and at full strength (Mercado, Cosecha, Terremoto...)
   * the glow washed the middle of the valley out to white. The events still
   * read through the sky wash, the land tint and their weather.
   */
  private sunGainFor(_mood: SkyMood): number {
    return this.paintedLight ? 0 : 1;
  }

  /** Covers the screen with the painting, its ground line on the castles' ground. */
  private layoutBackdrop(): void {
    const skyTex = this.paintedSky.texture;
    this.skyFloor.clear();
    if ((this.skyTile.visible || this.paintedSky.visible) && skyTex.width) {
      const full = this.groundY + 8;
      this.skyFloor.rect(0, full * (1 - SKY_LIFT) - 4, this.width, full * SKY_LIFT + 4).fill({ color: SKY_HORIZON });
    }
    if (this.skyTile.visible && skyTex.width) {
      const h = (this.groundY + 8) * (1 - SKY_LIFT);
      const k = Math.max(h / skyTex.height, this.width / skyTex.width);
      this.skyTile.width = this.width;
      this.skyTile.height = h;
      this.skyTile.tileScale.set(k);
      this.skyTile.tilePosition.y = h - skyTex.height * k;
    }
    if (this.paintedSky.visible && skyTex.width) {
      // The sky covers the screen down to just below the ground line, where
      // the terrain covers it, with its warm bottom glow on the horizon.
      const h = (this.groundY + 8) * (1 - SKY_LIFT);
      const k = Math.max(h / skyTex.height, (this.width * (1 + SKY_OVERSCAN)) / skyTex.width);
      this.paintedSky.scale.set(k);
      const room = skyTex.width * k - this.width;
      this.skySway = { ...this.skySway, x: -room / 2, room };
      this.paintedSky.position.set(this.skySway.x, h - skyTex.height * k);
    }
    const tex = this.painted.texture;
    if (!this.painted.visible || !tex.width) return;
    const groundPx = tex.height * TERRAIN_GROUND;
    // Wide enough for the screen and tall enough to reach the top; a short
    // screen below the ground is filled with the floor colour, not by zooming in.
    const scale = Math.max(this.width / tex.width, this.groundY / groundPx);
    // On a screen taller than the painting below its ground line, the painting
    // moves down (the meadow is flat, so the castles still stand on it) as long
    // as its top stays above the screen; only then is the floor colour needed.
    const y = Math.min(0, Math.max(this.groundY - groundPx * scale, this.height - tex.height * scale));
    const bottom = y + tex.height * scale;
    this.paintedFloor.clear();
    if (bottom < this.height) this.paintedFloor.rect(0, bottom - 2, this.width, this.height - bottom + 2).fill({ color: 0x2c2f1e });
    this.painted.scale.set(scale);
    this.painted.position.set((this.width - tex.width * scale) / 2, y);
  }

  /** Two castles for a duel, three for a free-for-all (the third stands in the middle). */
  setCount(count: number): void {
    const next = Math.max(2, Math.min(3, count));
    if (next === this.count) return;
    this.count = next;
    this.castles[2].visible = next > 2;
    if (next === 2) this.setAura(2, { burn: 0, frost: 0, danger: 0 });
    this.layout(this.lastRect);
  }

  /** Castles on the field. */
  get castleCount(): number {
    return this.count;
  }

  /** Lays out the scene. `field` is the free area between the HUD panels (CSS px). */
  /** Scales the castles so a winning Keep fills the field. */
  setMaxPoints(points: number): void {
    if (points === this.maxPoints) return;
    this.maxPoints = points;
    this.layout(this.lastRect);
  }

  layout(field?: FieldRect): void {
    // The screens lay out on the window's resize event, before Pixi's own
    // (deferred) resize: bring the canvas to the window size first, or the
    // scene would be laid out for the old size.
    this.app.resize();
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
    this.layoutBackdrop();

    // The castles sit in the field between the panels.
    const sideRoom = Math.min(rect.width * 0.23, 260);
    const three = this.count > 2;
    const keepWidth = Math.max(three ? 28 : 34, Math.min(rect.width * (three ? 0.062 : 0.075), three ? 84 : 96));
    // A winning Keep (or Wall) reaches the top edge of the screen, roof beyond
    // it, so every point gained or lost is plainly visible.
    const unit = Math.max(1.2, (this.groundY - 6) / this.maxPoints);
    const common = { groundY: this.groundY, unit, keepWidth, wallWidth: keepWidth * 0.42, gap: keepWidth * 0.55, maxPoints: this.maxPoints * 1.1 };
    this.castles[0].setLayout({ ...common, x: rect.left + sideRoom * 0.75 });
    this.castles[1].setLayout({ ...common, x: rect.left + rect.width - sideRoom * 0.75 });
    // The middle castle sits a little right of centre so its Wall (facing left) stays clear of the others.
    this.castles[2].setLayout({ ...common, x: rect.left + rect.width * 0.56 });

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
    const sunTo = mood.sunAlpha * this.sunGainFor(mood);
    const washFrom = this.skyWash.alpha;
    const washTo = this.paintedSkyLoaded && !isDefaultMood(mood) ? SKY_WASH : 0;
    this.paintedTint = { from: this.painted.tint as number, to: paintTint(mood), skyFrom: this.paintedSky.tint as number, skyTo: skyTint(mood) };
    this.sun.texture = glowTexture(mood.sun, 256);
    return this.tweens
      .run(ms, (t) => {
        this.skyB.alpha = t;
        this.sun.alpha = sunFrom + (sunTo - sunFrom) * t;
        this.skyWash.alpha = washFrom + (washTo - washFrom) * t;
        this.tint = {
          far: lerpColor(from.far, to.far, t),
          mid: lerpColor(from.mid, to.mid, t),
          near: lerpColor(from.near, to.near, t),
          ground: lerpColor(from.ground, to.ground, t),
        };
        this.applyTints();
        this.painted.tint = this.paintedFloor.tint = lerpColor(this.paintedTint.from, this.paintedTint.to, t);
        this.paintedSky.tint = this.skyTile.tint = this.skyFloor.tint = lerpColor(this.paintedTint.skyFrom, this.paintedTint.skyTo, t);
      }, ease.inOutCubic)
      .then(() => {
        this.applySky(mood, this.skyA);
        this.skyB.alpha = 0;
      });
  }

  setBanners(colors: number[]): void {
    colors.forEach((color, i) => this.castles[i]?.setBanner(color));
  }

  /** Draws each castle in its hero's style (towers, roofs, stone) with the hero's banner colour. */
  setHeroes(heroes: string[]): void {
    heroes.forEach((hero, i) => this.castles[i]?.setHero(hero));
  }

  /** Scene tops of every standing tower of a castle, Keep first (screen CSS px). */
  towerTops(player: PlayerId): { x: number; y: number; width: number }[] {
    return this.castles[player].towerTops().map((t) => ({ ...t, x: t.x + this.world.x, y: t.y + this.world.y }));
  }

  /** Jump straight to these heights (new game, resume, layout). */
  setCastles(values: { keep: number; wall: number }[]): void {
    values.forEach((v, i) => {
      this.castleTargets[i] = { ...v };
      this.castles[i]?.setHeights(v.keep, v.wall);
    });
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

  /** Where an attack from `from` meets the Shield dome (screen px), or null without one. */
  domePoint(player: PlayerId, from: PlayerId): { x: number; y: number } | null {
    const d = this.castles[player].dome;
    if (!d) return null;
    // The hit comes from the attacker's side of the dome.
    const dir = from === player ? 0 : this.castles[from]!.x < this.castles[player]!.x ? -1 : 1;
    const a = (dir === 0 ? 90 : 48) * (Math.PI / 180);
    return { x: d.cx + dir * Math.cos(a) * d.rx + this.world.x, y: d.gy - Math.sin(a) * d.ry + this.world.y };
  }

  /** A hit stopped by the dome: it lights up. */
  shieldHit(player: PlayerId): void {
    this.castles[player].flashShield();
  }

  /** The dome breaks into shards (last charge spent). */
  shatterShield(player: PlayerId): void {
    const d = this.castles[player].dome;
    if (!d) return;
    const x = d.cx + this.world.x;
    const gy = d.gy + this.world.y;
    for (let i = 0; i < 14; i++) {
      const t = Math.PI + (Math.random() * 0.9 + 0.05) * Math.PI;
      this.burst(x + Math.cos(t) * d.rx, gy + Math.sin(t) * d.ry, { count: 3, texture: 'crystal', color: [0xaee8ff, 0xd8c8ff, 0xffffff], speed: 3, angle: t, spread: 0.8, gravity: 0.08, size: 12, life: 900 });
    }
    this.flare(x, gy - d.ry * 0.5, 0xaee8ff, d.rx * 2.2, 500, 0.5);
  }

  /** A fallen player's gravestone on their castle: rises with dust, or appears at once (`instant`). */
  setFallen(player: PlayerId, on: boolean, instant = false): void {
    const castle = this.castles[player];
    if (!castle || castle.fallen === on) return;
    castle.setFallen(on, instant);
    if (!on || instant) return;
    const base = this.anchor(player, 'base');
    const w = castle.keepWidth;
    this.burst(base.x, base.y - 4, { count: 16, texture: 'smoke', color: 0x9a8a70, speed: 1.6, angle: -Math.PI / 2, spread: 2.2, gravity: -0.01, size: w * 1.2, life: 1600, alpha: 0.55, area: { w: w * 1.2, h: 6 } });
    this.burst(base.x, base.y - 6, { count: 14, texture: 'rubble', speed: 3, angle: -Math.PI / 2, spread: 1.4, gravity: 0.3, size: 7, life: 900, area: { w: w, h: 4 } });
    this.shake(5);
  }

  setShield(player: PlayerId, charges: number): void {
    this.castles[player].setShield(charges);
  }

  /** Screen position (CSS px) of a castle part. */
  anchor(player: PlayerId, target: 'keep' | 'wall' | 'base'): { x: number; y: number } {
    const p = this.castles[player].anchor(target);
    return { x: p.x + this.world.x, y: p.y + this.world.y };
  }

  /** Adds screen shake; strong hits stack up to a cap and fade smoothly. */
  shake(power = 8): void {
    if (!settings.get().screenShake || settings.get().reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + power / 24);
  }

  flash(color = 0xffffff, alpha = 0.35, ms = 260): void {
    if (settings.get().reducedMotion) alpha *= 0.4;
    this.flashOverlay.tint = color;
    this.flashOverlay.alpha = Math.max(this.flashOverlay.alpha, alpha);
    void this.tweens.to(this.flashOverlay, { alpha: 0 }, ms);
  }

  /** Screen width and height. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private takeSprite(texture: Texture): Sprite | null {
    if (this.particles.length >= particleBudget()) return null;
    const sprite = this.pool.pop() ?? new Sprite();
    sprite.texture = texture;
    sprite.anchor.set(0.5);
    sprite.rotation = 0;
    sprite.alpha = 1;
    sprite.visible = true;
    if (!sprite.parent) this.fxLayer.addChild(sprite);
    return sprite;
  }

  private releaseSprite(sprite: Sprite): void {
    sprite.visible = false;
    this.pool.push(sprite);
  }

  burst(x: number, y: number, opts: BurstOptions = {}): void {
    const count = Math.max(1, Math.round((opts.count ?? 16) * density()));
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color ?? 0xffd27a];
    const shape = opts.texture ?? 'glow';
    const texture = this.textures[shape];
    const additive = shape === 'glow' || shape === 'spark' || shape === 'flame' || shape === 'crystal';
    for (let i = 0; i < count; i++) {
      const sprite = this.takeSprite(texture);
      if (!sprite) return;
      const px = x + (opts.area ? (Math.random() - 0.5) * opts.area.w : 0);
      const py = y + (opts.area ? (Math.random() - 0.5) * opts.area.h : 0);
      sprite.position.set(px, py);
      const color = colors[i % colors.length];
      sprite.tint = color;
      sprite.blendMode = opts.blend ?? (additive ? 'add' : 'normal');
      const size = (opts.size ?? 10) * (0.6 + Math.random() * 0.8);
      const base = size / Math.max(texture.width, texture.height);
      sprite.scale.set(base);
      const angle = (opts.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2);
      const speed = (opts.speed ?? 4) * (0.4 + Math.random() * 0.9);
      const life = (opts.life ?? 900) * (0.6 + Math.random() * 0.6);
      const alpha = opts.alpha ?? 1;
      sprite.alpha = alpha;
      this.particles.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: opts.gravity ?? 0.12,
        drag: opts.drag ?? (shape === 'smoke' ? 0.96 : 0.985),
        life,
        maxLife: life,
        spin: shape === 'spark' ? 0 : (Math.random() - 0.5) * (shape === 'rubble' ? 0.3 : 0.08),
        grow: opts.grow ?? (shape === 'smoke' ? 1.012 : shape === 'rubble' || shape === 'crystal' ? 1 : 0.992),
        baseScale: base,
        maxScale: shape === 'smoke' ? base * (effectsLow() ? 2.2 : 3.5) : Infinity,
        stretch: shape === 'spark' || shape === 'flame',
        alpha,
        colorFrom: color,
        colorTo: opts.colorTo ?? null,
        floor: shape === 'rubble',
      });
      if (shape === 'crystal' || shape === 'rubble') sprite.rotation = Math.random() * Math.PI * 2;
    }
  }

  /** A sprite that scales and fades on its own (rings, flares, rays). */
  private pulse(texture: Texture, x: number, y: number, o: { color: number; from: number; to: number; ms: number; alpha?: number; spin?: number; blend?: 'add' | 'normal' }): void {
    const sprite = this.takeSprite(texture);
    if (!sprite) return;
    sprite.position.set(x, y);
    sprite.tint = o.color;
    sprite.blendMode = o.blend ?? 'add';
    const k = 1 / Math.max(texture.width, texture.height);
    sprite.scale.set(o.from * k);
    sprite.alpha = o.alpha ?? 1;
    this.flashes.push({ sprite, life: o.ms, maxLife: o.ms, from: o.from * k, to: o.to * k, alpha: o.alpha ?? 1, spin: o.spin ?? 0 });
  }

  /** An expanding shockwave ring. */
  ring(x: number, y: number, color = 0xffffff, radius = 140, ms = 600, alpha = 0.9): void {
    this.pulse(this.ringTex, x, y, { color, from: radius * 0.15, to: radius * 2, ms, alpha });
  }

  /** A bright bloom of light. */
  flare(x: number, y: number, color = 0xffe0a0, size = 220, ms = 500, alpha = 1): void {
    this.pulse(this.flareTex, x, y, { color, from: size * 0.6, to: size, ms, alpha });
  }

  /** Slowly turning light rays (legendaries, ultimates, victory). */
  rays(x: number, y: number, color = 0xffd27a, size = 420, ms = 1400, alpha = 0.7): void {
    if (effectsLow()) return this.flare(x, y, color, size * 0.6, ms * 0.6, alpha * 0.8);
    this.pulse(this.raysTex, x, y, { color, from: size * 0.6, to: size, ms, alpha, spin: 0.004 });
  }

  /** A forked bolt of lightning between two points. */
  lightning(from: { x: number; y: number }, to: { x: number; y: number }, color = 0xcfe6ff, ms = 380): void {
    const g = this.bolts;
    const draw = (width: number, alpha: number, c: number): void => {
      const segs = 12;
      let px = from.x;
      let py = from.y;
      g.moveTo(px, py);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const jitter = (1 - Math.abs(t - 0.5) * 2) * 38 + 6;
        const nx = from.x + (to.x - from.x) * t + (i < segs ? (Math.random() - 0.5) * jitter : 0);
        const ny = from.y + (to.y - from.y) * t + (i < segs ? (Math.random() - 0.5) * jitter * 0.4 : 0);
        g.lineTo(nx, ny);
        if (i > 3 && i < segs - 2 && Math.random() < 0.25) {
          g.lineTo(nx + (Math.random() - 0.5) * 70, ny + 30 + Math.random() * 40);
          g.moveTo(nx, ny);
        }
        px = nx;
        py = ny;
      }
      g.stroke({ width, color: c, alpha, cap: 'round', join: 'round' });
    };
    g.clear();
    draw(9, 0.25, color);
    draw(3, 1, 0xffffff);
    g.alpha = 1;
    g.blendMode = 'add';
    void this.tweens.to(g, { alpha: 0 }, ms).then(() => {
      if (g.alpha === 0) g.clear();
    });
    this.flare(to.x, to.y, color, 200, 400);
  }

  /** Brief hit tint and recoil on a castle. */
  hitCastle(player: PlayerId, color = 0xff8a70, power = 1): void {
    this.castles[player].hit(color, power);
  }

  /** A castle shining in a colour for a while (its hero fired the ultimate). */
  radiateCastle(player: PlayerId, color: number, ms = 2800): void {
    this.castles[player].radiate(color, ms);
  }

  /** Persistent effects on a castle: burning, frozen, close to falling. */
  setAura(player: PlayerId, aura: { burn?: number; frost?: number; danger?: number }): void {
    Object.assign(this.auras[player], aura);
    this.castles[player].setFrost(this.auras[player].frost > 0);
  }

  /** A projectile from one castle to the other. Resolves on impact. */
  projectile(from: { x: number; y: number }, to: { x: number; y: number }, color = 0xffb35a, ms = 520, style: ProjectileStyle = 'orb'): Promise<void> {
    if (style === 'arrows') return this.volley(from, to, color, ms);
    if (style === 'charge') return this.charge(from, to, color, ms);
    const comet = style === 'comet';
    const start = comet ? { x: to.x + (from.x < to.x ? -this.width * 0.35 : this.width * 0.35), y: -40 } : from;
    const shape: ParticleShape = style === 'boulder' ? 'rubble' : style === 'frost' ? 'crystal' : 'glow';
    const head = this.takeSprite(this.textures[shape]);
    if (!head) return new Promise((r) => setTimeout(r, ms));
    const headSize = style === 'boulder' ? 26 : comet ? 54 : style === 'fire' ? 38 : 30;
    head.scale.set(headSize / Math.max(head.texture.width, head.texture.height));
    head.tint = style === 'boulder' ? 0xb0a080 : color;
    head.blendMode = style === 'boulder' ? 'normal' : 'add';
    const glow = style === 'boulder' ? null : this.takeSprite(this.textures.glow);
    if (glow) {
      glow.tint = color;
      glow.blendMode = 'add';
      glow.alpha = 0.6;
      glow.scale.set((headSize * 2.2) / 32);
    }
    const lift = comet ? 0 : Math.min(style === 'boulder' ? 320 : style === 'bolt' ? 120 : 260, Math.abs(to.x - start.x) * (style === 'boulder' ? 0.45 : 0.3));
    const cx = (start.x + to.x) / 2;
    const cy = Math.min(start.y, to.y) - lift;
    let frame = 0;
    const trail = (x: number, y: number, dx: number, dy: number): void => {
      frame++;
      const back = Math.atan2(-dy, -dx);
      switch (style) {
        case 'boulder':
          if (frame % 2 === 0) this.burst(x, y, { count: 1, texture: 'smoke', color: 0x9a8a70, speed: 0.3, gravity: -0.01, size: 22, life: 700, alpha: 0.5 });
          break;
        case 'bolt':
          this.burst(x, y, { count: 2, texture: 'spark', color: [color, 0xffffff], speed: 1.2, angle: back, spread: 0.5, gravity: 0, size: 26, life: 260 });
          if (frame % 3 === 0) this.burst(x, y, { count: 1, texture: 'crystal', color, speed: 0.6, gravity: 0, size: 10, life: 500 });
          break;
        case 'frost':
          this.burst(x, y, { count: 1, texture: 'crystal', color: [0xbff3ff, 0xffffff], speed: 0.8, gravity: 0.02, size: 12, life: 600 });
          this.burst(x, y, { count: 1, color, speed: 0.4, gravity: 0, size: 18, life: 300 });
          break;
        case 'fire':
        case 'comet':
          this.burst(x, y, { count: comet ? 3 : 2, texture: 'flame', color: 0xffd060, colorTo: 0xff3a10, speed: 1, angle: back, spread: 0.8, gravity: -0.03, size: comet ? 34 : 24, life: 420 });
          if (frame % 2 === 0) this.burst(x, y, { count: 1, texture: 'smoke', color: 0x2a2220, speed: 0.4, gravity: -0.03, size: comet ? 40 : 26, life: 900, alpha: 0.55 });
          break;
        default:
          if (frame % 2 === 0) this.burst(x, y, { count: 2, color, speed: 0.6, gravity: 0, size: 14, life: 380 });
      }
    };
    let prev = { x: start.x, y: start.y };
    return this.tweens
      .run(
        ms,
        (t) => {
          const x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * cx + t * t * to.x;
          const y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * cy + t * t * to.y;
          head.position.set(x, y);
          glow?.position.set(x, y);
          if (style === 'boulder') head.rotation += 0.25;
          else head.rotation = Math.atan2(y - prev.y, x - prev.x);
          trail(x, y, x - prev.x, y - prev.y);
          prev = { x, y };
        },
        style === 'bolt' ? ease.inOutCubic : ease.inCubic,
      )
      .then(() => {
        this.releaseSprite(head);
        if (glow) this.releaseSprite(glow);
      });
  }

  /** A volley of arrows; resolves when the first lands. */
  private volley(from: { x: number; y: number }, to: { x: number; y: number }, color: number, ms: number): Promise<void> {
    const n = effectsLow() ? 4 : 7;
    const flights: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const arrow = this.takeSprite(this.textures.spark);
      if (!arrow) break;
      arrow.tint = i % 2 ? 0xfff0d0 : color;
      arrow.blendMode = 'add';
      arrow.scale.set(0.9, 0.5);
      const delay = i * 45;
      const spreadX = (Math.random() - 0.5) * 50;
      const spreadY = (Math.random() - 0.5) * 30;
      const target = { x: to.x + spreadX, y: to.y + spreadY };
      const lift = Math.min(260, Math.abs(target.x - from.x) * 0.4);
      const cx = (from.x + target.x) / 2;
      const cy = Math.min(from.y, target.y) - lift;
      arrow.visible = false;
      flights.push(
        new Promise<void>((r) => setTimeout(r, delay))
          .then(() => {
            arrow.visible = true;
            let prev = { x: from.x, y: from.y };
            return this.tweens.run(ms * 0.9, (t) => {
              const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cx + t * t * target.x;
              const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cy + t * t * target.y;
              arrow.position.set(x, y);
              arrow.rotation = Math.atan2(y - prev.y, x - prev.x);
              prev = { x, y };
            }, ease.linear);
          })
          .then(() => {
            this.releaseSprite(arrow);
            this.burst(target.x, target.y, { count: 3, texture: 'spark', color: 0xffe0a0, speed: 3, spread: 1.6, gravity: 0.1, size: 14, life: 300 });
          }),
      );
    }
    return flights.length ? Promise.race(flights) : Promise.resolve();
  }

  /** A charge across the field: a rolling dust cloud with glinting spears. */
  private charge(from: { x: number; y: number }, to: { x: number; y: number }, color: number, ms: number): Promise<void> {
    const y = this.groundY - 6;
    const startX = from.x;
    let frame = 0;
    return this.tweens.run(
      ms * 1.2,
      (t) => {
        const x = startX + (to.x - startX) * t;
        frame++;
        if (frame % 2 === 0) this.burst(x, y - 6, { count: 2, texture: 'smoke', color: 0xb09670, speed: 1.2, angle: -Math.PI / 2, spread: 1.4, gravity: -0.01, size: 40, life: 900, alpha: 0.65, area: { w: 30, h: 10 } });
        if (frame % 3 === 0) this.burst(x, y - 18, { count: 1, texture: 'spark', color: [color, 0xffffff], speed: 2, angle: -Math.PI / 2 + (to.x > startX ? 0.4 : -0.4), spread: 0.3, gravity: 0.05, size: 18, life: 250 });
        if (frame % 4 === 0) this.shake(1.2);
      },
      ease.inCubic,
    );
  }

  /** A rocket that bursts into coloured sparks (victory). */
  firework(x: number, y: number, colors: number[]): void {
    const startY = this.groundY;
    const rocket = this.takeSprite(this.textures.glow);
    if (!rocket) return;
    rocket.tint = 0xfff0c0;
    rocket.blendMode = 'add';
    rocket.scale.set(0.5);
    rocket.position.set(x, startY);
    void this.tweens
      .run(
        700,
        (t) => {
          rocket.position.set(x + Math.sin(t * 6) * 6, startY + (y - startY) * t);
          this.burst(rocket.x, rocket.y, { count: 1, texture: 'spark', color: 0xffd080, speed: 0.6, angle: Math.PI / 2, spread: 0.3, gravity: 0.02, size: 14, life: 300 });
        },
        ease.outCubic,
      )
      .then(() => {
        this.releaseSprite(rocket);
        this.flare(x, y, colors[0], 180, 400, 0.8);
        this.burst(x, y, { count: 44, texture: 'spark', color: colors, speed: 6, gravity: 0.06, drag: 0.96, size: 22, life: 1400, colorTo: 0x402010 });
        this.burst(x, y, { count: 16, color: colors, speed: 3, gravity: 0.04, size: 12, life: 1800 });
      });
  }

  private update(dt: number): void {
    const step = dt / 16.67;
    this.monitorFrames(dt);
    const calm = settings.get().reducedMotion;
    for (const castle of this.castles) castle.tick(dt, calm);
    if (this.skyTile.visible && !calm) {
      const span = this.skyTile.texture.width * this.skyTile.tileScale.x;
      this.skyTile.tilePosition.x = (this.skyTile.tilePosition.x - (SKY_DRIFT * dt) / 1000) % span;
    }
    if (this.paintedSky.visible && !calm) {
      this.skySway.time = (this.skySway.time + dt) % SKY_SWAY_MS;
      const swing = Math.sin((this.skySway.time / SKY_SWAY_MS) * Math.PI * 2) * 0.45;
      this.paintedSky.x = this.skySway.x + swing * this.skySway.room;
    }
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
        this.releaseSprite(p.sprite);
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity * step;
      p.sprite.x += p.vx * step;
      p.sprite.y += p.vy * step;
      if (p.floor && p.sprite.y > this.groundY + 6 && p.gravity > 0) {
        p.sprite.y = this.groundY + 6;
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
      const k = p.life / p.maxLife;
      p.sprite.alpha = p.alpha * Math.min(1, k * 1.6);
      if (p.colorTo !== null) p.sprite.tint = lerpColor(p.colorFrom, p.colorTo, 1 - k);
      if (p.stretch) {
        const speed = Math.hypot(p.vx, p.vy);
        p.sprite.rotation = Math.atan2(p.vy, p.vx);
        p.baseScale *= p.grow;
        p.sprite.scale.set(p.baseScale * Math.min(2.4, 0.7 + speed * 0.2), p.baseScale);
      } else {
        p.sprite.rotation += p.spin * step;
        p.baseScale = Math.min(p.maxScale, p.baseScale * p.grow ** step);
        p.sprite.scale.set(p.baseScale);
      }
    }
    // Rings, flares and rays.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.releaseSprite(f.sprite);
        this.flashes.splice(i, 1);
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      const e = 1 - (1 - t) ** 3;
      f.sprite.scale.set(f.from + (f.to - f.from) * e);
      f.sprite.alpha = f.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      f.sprite.rotation += f.spin * dt;
    }
    this.updateAuras(dt);
    this.updateWeather(dt);
    // Camera shake: smooth noise scaled by trauma squared.
    if (this.trauma > 0.001) {
      this.shakeTime += dt * 0.045;
      const amount = this.trauma * this.trauma * 26;
      const n = (a: number, b: number): number => Math.sin(this.shakeTime * a + b) * 0.6 + Math.sin(this.shakeTime * a * 2.3 + b * 1.7) * 0.4;
      this.world.position.set(n(1.9, 0.3) * amount, n(2.3, 4.1) * amount * 0.8);
      this.trauma = Math.max(0, this.trauma - dt * 0.0016);
    } else if (this.world.x || this.world.y) {
      this.world.position.set(0, 0);
      this.trauma = 0;
    }
  }

  /** Drops to low effects for the visit if frames keep running long. */
  private monitorFrames(dt: number): void {
    if (dt > 26 && dt < 250) this.slowFrames = Math.min(240, this.slowFrames + 1);
    else this.slowFrames = Math.max(0, this.slowFrames - 0.5);
    if (this.slowFrames > 150 && reportSlowFrames()) this.slowFrames = 0;
  }

  /** Flames, frost and danger smoke on the castles. */
  private updateAuras(dt: number): void {
    if (settings.get().reducedMotion) return;
    for (let player = 0; player < this.count; player++) {
      const aura = this.auras[player]!;
      const dome = this.castles[player].dome;
      if (!aura.burn && !aura.danger && !aura.frost && !dome) continue;
      aura.timer += dt;
      if (aura.timer < (effectsLow() ? 140 : 70)) continue;
      aura.timer = 0;
      const castle = this.castles[player];
      if (dome && Math.random() < 0.55) {
        // Arcane motes drift up inside the dome and runes spark on its ring.
        const t = Math.random() * Math.PI * 2;
        const onRing = Math.random() < 0.4;
        const x = dome.cx + this.world.x + (onRing ? Math.cos(t) * dome.rx * 0.98 : (Math.random() - 0.5) * dome.rx * 1.4);
        const y = dome.gy + this.world.y + (onRing ? Math.sin(t) * dome.rx * 0.09 : -Math.random() * dome.ry * 0.5);
        this.burst(x, y, { count: 1, texture: onRing ? 'glow' : 'crystal', color: [0xb48cff, 0x7fd6ff, 0xe4f8ff], speed: onRing ? 0.8 : 0.4, angle: -Math.PI / 2, spread: 0.3, gravity: -0.01, size: onRing ? 9 : 8, life: onRing ? 900 : 2200, alpha: 0.85 });
      }
      if (!aura.burn && !aura.danger && !aura.frost) continue;
      const keep = this.anchor(player, 'keep');
      const wall = this.anchor(player, 'wall');
      const w = castle.keepWidth;
      if (aura.burn) {
        // Flames on every standing tower (the Keep most), sometimes on the Wall.
        const tops = this.towerTops(player);
        const onWall = Math.random() < 0.3 && castle.wall > 2;
        const tower = tops.length && Math.random() < 0.4 ? tops[Math.floor(Math.random() * tops.length)] : null;
        const at = onWall ? wall : tower ? { x: tower.x, y: tower.y + tower.width * 0.4 } : { x: keep.x, y: keep.y + w * 0.6 };
        const spanW = tower && !onWall ? tower.width * 0.8 : w * 0.8;
        this.burst(at.x, at.y, { count: 1, texture: 'flame', color: 0xffe080, colorTo: 0xff3010, speed: 1.2, angle: -Math.PI / 2, spread: 0.4, gravity: -0.05, size: 22 + Math.min(aura.burn, 4) * 4, life: 520, area: { w: spanW, h: 6 } });
        if (Math.random() < 0.5) this.burst(at.x, at.y - 10, { count: 1, color: 0xffa040, speed: 1.6, angle: -Math.PI / 2, spread: 1, gravity: -0.03, size: 6, life: 1200, area: { w: w, h: 10 } });
        if (Math.random() < 0.4 && !effectsLow()) this.burst(at.x, at.y - 24, { count: 1, texture: 'smoke', color: 0x2a2624, speed: 0.8, angle: -Math.PI / 2, spread: 0.5, gravity: -0.02, size: 34, life: 1800, alpha: 0.45 });
      }
      if (aura.frost && Math.random() < 0.5) {
        this.burst(keep.x, keep.y + w * 1.4, { count: 1, texture: 'crystal', color: [0xdff8ff, 0x9fe6ff], speed: 0.3, gravity: 0.01, size: 10, life: 1600, area: { w: w * 1.6, h: w * 2.5 } });
      }
      if (aura.danger && !aura.burn && Math.random() < 0.35 && !effectsLow()) {
        this.burst(keep.x, keep.y + w * 0.4, { count: 1, texture: 'smoke', color: 0x3a3532, speed: 0.6, angle: -Math.PI / 2 + 0.2, spread: 0.4, gravity: -0.015, size: 30, life: 2200, alpha: 0.4 * aura.danger, area: { w: w * 0.6, h: 4 } });
      }
    }
  }

  private updateWeather(dt: number): void {
    const kind = this.mood.weather;
    // Consoles skip the event weather (Terremoto dust, Ocaso embers...): their
    // browser has little to spare, and the tab froze when it arrived.
    if (kind === 'none' || settings.get().reducedMotion || consoleBrowser()) return;
    if (kind === 'rain') {
      // Now and then, lightning over the hills and a roll of thunder.
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5000 + Math.random() * 9000;
        const x = this.width * (0.15 + Math.random() * 0.7);
        this.lightning({ x: x + (Math.random() - 0.5) * 80, y: -10 }, { x, y: this.groundY - this.height * (0.1 + Math.random() * 0.15) }, 0xcfe0ff, 300);
        this.flash(0xdfe8ff, 0.22, 260);
        setTimeout(() => this.onAmbient?.('thunder'), 250 + Math.random() * 600);
      }
    }
    // Half as much weather on low effects. After a long stall (a slow frame,
    // a tab in the background) it does not try to catch up all at once.
    this.weatherTimer = Math.min(this.weatherTimer + dt * (effectsLow() ? 0.5 : 1), 1000);
    const every = kind === 'rain' ? 14 : kind === 'snow' ? 60 : 120;
    while (this.weatherTimer > every) {
      this.weatherTimer -= every;
      const x = Math.random() * this.width;
      switch (kind) {
        case 'rain':
          this.burst(x, -10, { count: 1, texture: 'spark', color: 0x9fb4d8, speed: 14, angle: Math.PI / 2 + 0.15, spread: 0.05, gravity: 0.3, size: 16, life: 1400, blend: 'normal', alpha: 0.6, grow: 1 });
          break;
        case 'snow':
          this.burst(x, -10, { count: 1, texture: 'crystal', color: 0xffffff, speed: 1.2, angle: Math.PI / 2, spread: 0.6, gravity: 0.005, size: 9, life: 9000, blend: 'normal', alpha: 0.85 });
          break;
        case 'embers':
          this.burst(x, this.groundY, { count: 1, color: 0xc77dff, speed: 1, angle: -Math.PI / 2, spread: 0.6, gravity: -0.004, size: 9, life: 4000 });
          break;
        case 'leaves':
          this.burst(x, -10, { count: 1, color: [0xe0a040, 0xc06a2a, 0xd8c060], speed: 1.4, angle: Math.PI / 2 + 0.4, spread: 0.6, gravity: 0.006, size: 8, life: 8000, blend: 'normal' });
          break;
        case 'dust':
          if (effectsLow()) break;
          this.burst(x, this.groundY - Math.random() * 30, { count: 1, texture: 'smoke', color: 0xc8a070, speed: 0.8, angle: 0, spread: 0.6, gravity: -0.002, size: 50, life: 3000, alpha: 0.6, grow: 1.004 });
          break;
      }
    }
  }
}
