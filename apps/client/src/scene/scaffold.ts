import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";

/**
 * The masons' scaffold, put up one timber at a time: the posts are lowered
 * into place, each cross brace swings up on its peg, each plank slides in on
 * top, then the ladder is leaned on and the crane and bucket set on the
 * platform. It comes down the same way, from the top.
 *
 * `scripts/build-castles.mjs` cuts the painting into its timbers (one sheet,
 * `scaffold-parts.webp`) and lists them by band: from the top of the picture,
 * then from each plank's top edge down to the next. One band of the lattice
 * repeats to reach any height, like the shaft of a tower.
 */

export type PartKind = "post" | "brace" | "beam" | "extra" | "ladder";

export interface ScaffoldPartsMeta {
  /** Size of the source picture (px). */
  width: number;
  height: number;
  /** Centre of the lattice (source x): the scaffold stands on it. */
  centerX: number;
  /** Width between the outer edges of the posts (source px). */
  shaftWidth: number;
  /** Each band's top and bottom row (source px), from the top. */
  bands: [number, number][];
  /** The band that repeats. */
  shaftBand: number;
  /** Each part: band, kind, side (-1 left, 1 right, 0 none), place in the source (x, y, w, h), place in the sheet (x, y). */
  pieces: [
    number,
    PartKind,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ][];
}

export interface ScaffoldParts {
  meta: ScaffoldPartsMeta;
  sheet: Texture;
}

interface Part {
  kind: PartKind;
  side: number;
  /** Which band of the picture, and which band of this scaffold (counted from the ground). */
  band: number;
  slot: number;
  sprite: Sprite;
  /** Where it is in the picture (source px). */
  src: { x: number; y: number; w: number; h: number };
  /** Where it rests (local px, before mirroring) and how big it is. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0: not there, 1: in place. */
  p: number;
  /** Where it is heading (0 or 1) and when it sets off (ms on the rig's clock). */
  to: number;
  start: number;
  /** Foundations go in before the posts. */
  ground: boolean;
}

/** How long one timber takes to go up or come down (ms). */
const PART_MS = 300;
/** At most this long between one timber and the next (ms). */
const STAGGER_MS = 70;
/** All the timbers of a scaffold set off within about this long (ms). */
const RAISE_SPREAD_MS = 1100;

const KIND_ORDER: Record<PartKind, number> = {
  post: 0,
  brace: 1,
  beam: 2,
  ladder: 3,
  extra: 4,
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeBack = (t: number) => {
  const c = 1.5;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
const bounce = (t: number) => {
  if (t < 0.6) return (t / 0.6) ** 2;
  const u = (t - 0.8) / 0.2;
  return 1 - 0.08 * (1 - u * u);
};

export class ScaffoldRig {
  readonly root = new Container();
  private readonly body = new Container();
  private readonly clip = new Graphics();
  private parts: Part[] = [];
  /** Bands of this scaffold, from the ground up (indices into the picture's bands). */
  private clock = 0;
  private speed = 1;
  private key = "";
  /** Scale up the scaffold (source px to scene px). */
  private ky = 1;
  /** Each time a plank is laid (or lifted off): where (parent px) and how wide. */
  onPlank: ((x: number, y: number, w: number, up: boolean) => void) | null =
    null;

  constructor(private readonly kit: ScaffoldParts) {
    this.root.addChild(this.body, this.clip);
  }

  /** True while any timber is up (or on its way). */
  get standing(): boolean {
    return this.parts.some((p) => p.p > 0 || p.to > 0);
  }

  /** True once every timber is in place. */
  get up(): boolean {
    return this.parts.length > 0 && this.parts.every((p) => p.p >= 1);
  }

  /**
   * Stands the scaffold at `cx` on `groundY`, `w` wide across the posts, its
   * very top `top` above the ground. A scaffold taller than the picture gets
   * more bands of lattice; a shorter one is sunk into the ground.
   */
  layout(
    cx: number,
    groundY: number,
    w: number,
    top: number,
    mirror: boolean,
  ): void {
    const m = this.kit.meta;
    const k = w / m.shaftWidth;
    const band = (i: number) => m.bands[i]![1] - m.bands[i]![0];
    const want = top / k;
    // Everything but the repeating band, then as many of it as reach closest to the top.
    const rest = m.height - band(m.shaftBand);
    const crown = m.bands
      .slice(0, m.shaftBand)
      .reduce((s, _, i) => s + band(i), 0);
    let repeats = 0;
    let sink = 0;
    if (want >= rest)
      repeats = Math.max(0, Math.round((want - rest) / band(m.shaftBand)));
    else sink = rest - Math.max(want, crown);
    const natural = rest + repeats * band(m.shaftBand);
    // Stretched a touch so the top lands where it should.
    const ky = sink > 0 ? k : top / natural;
    this.ky = ky;
    this.root.position.set(cx, groundY);
    this.root.scale.set(mirror ? -1 : 1, 1);

    // Bands from the ground up: the base, the repeats, then the crown.
    const slots: number[] = [];
    for (let i = m.bands.length - 1; i > m.shaftBand; i--) slots.push(i);
    for (let r = 0; r < repeats; r++) slots.push(m.shaftBand);
    for (let i = m.shaftBand - 1; i >= 0; i--) slots.push(i);
    const key = `${slots.join(",")}`;
    if (key !== this.key) this.rebuild(slots, key);

    // Where each slot's band starts (source px above the ground, before stretching).
    const bottomOf: number[] = [];
    let cursor = -sink;
    for (const b of slots) {
      bottomOf.push(cursor);
      cursor += band(b);
    }
    for (const part of this.parts) {
      const [, bottom] = m.bands[part.band]!;
      const above = bottomOf[part.slot]!;
      const src = part.src;
      // Source y (from the band's bottom) to local y (up is negative).
      const yTop = -(above + (bottom - src.y)) * ky;
      part.x = (src.x - m.centerX) * k;
      part.y = yTop;
      part.w = src.w * k;
      part.h = src.h * ky;
    }
    // Sunk into the ground: what is below it is cut off.
    if (sink > 0) {
      this.clip
        .clear()
        .rect(-w * 4, -cursor * ky - w * 4, w * 8, cursor * ky + w * 4)
        .fill(0xffffff);
      this.body.mask = this.clip;
    } else {
      this.body.mask = null;
    }
    this.draw();
  }

  /** Makes the timbers for these bands, keeping those already standing where the bands are the same. */
  private rebuild(slots: number[], key: string): void {
    const m = this.kit.meta;
    const was = new Map<string, number>();
    // The same band keeps its name as the scaffold grows: the base and crown by band, the repeats by count.
    const name = (band: number, slot: number) =>
      band === m.shaftBand ? `r${slot}` : `b${band}`;
    for (const p of this.parts)
      was.set(`${name(p.band, p.slot)}:${p.kind}:${p.side}`, p.p);
    for (const p of this.parts) p.sprite.destroy();
    this.parts = [];
    this.key = key;
    slots.forEach((band, slot) => {
      for (const [b, kind, side, x, y, w, h, ax, ay] of m.pieces) {
        if (b !== band) continue;
        const sprite = new Sprite(
          new Texture({
            source: this.kit.sheet.source,
            frame: new Rectangle(ax, ay, w, h),
          }),
        );
        const p = was.get(`${name(band, slot)}:${kind}:${side}`) ?? 0;
        this.parts.push({
          kind,
          side,
          band,
          slot,
          sprite,
          src: { x, y, w, h },
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          p,
          to: p >= 1 ? 1 : 0,
          start: 0,
          ground: kind === "extra" && y + h >= m.height - 30,
        });
      }
    });
    // Drawn back to front: posts, braces, planks, then the ladder and the rest.
    const z = [...this.parts].sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.slot - b.slot,
    );
    this.body.removeChildren();
    for (const p of z) this.body.addChild(p.sprite);
  }

  /** The order they go up in: band by band from the ground, foundations, posts, braces, the plank, then the rest. */
  private upOrder(): Part[] {
    const rank = (p: Part) =>
      p.ground
        ? -1
        : KIND_ORDER[p.kind] +
          (p.kind === "brace" ? (p.side + 1) * 0.25 : 0) +
          (p.kind === "post" ? (p.side + 1) * 0.25 : 0);
    return [...this.parts].sort((a, b) => a.slot - b.slot || rank(a) - rank(b));
  }

  /** Puts it up (what is missing of it). Returns how long that takes (ms). `speed` scales it. */
  raise(speed = 1): number {
    this.speed = speed;
    const todo = this.upOrder().filter((p) => p.p < 1 && this.shown(p));
    if (!todo.length) return 0;
    const step = Math.min(STAGGER_MS, RAISE_SPREAD_MS / todo.length) * speed;
    todo.forEach((p, i) => {
      p.to = 1;
      p.start = this.clock + i * step;
    });
    return (
      (todo.length - 1) * step +
      PART_MS * speed * (1 - Math.min(...todo.map((p) => p.p)))
    );
  }

  /** Takes it down from the top. Returns how long that takes (ms). */
  lower(): number {
    const todo = this.upOrder()
      .reverse()
      .filter((p) => p.p > 0 || p.to > 0);
    if (!todo.length) return 0;
    const step =
      Math.min(STAGGER_MS, RAISE_SPREAD_MS / todo.length) * this.speed * 0.6;
    todo.forEach((p, i) => {
      p.to = 0;
      p.start = this.clock + i * step;
    });
    return (todo.length - 1) * step + PART_MS * this.speed;
  }

  /** A timber sunk out of sight (a short scaffold) is never put up. */
  private shown(p: Part): boolean {
    return this.body.mask ? p.y < 0 : true;
  }

  tick(dt: number): void {
    if (!this.parts.length) return;
    this.clock += dt;
    const ms = PART_MS * this.speed;
    let moved = false;
    for (const p of this.parts) {
      if (p.p === p.to || this.clock < p.start) continue;
      const was = p.p;
      p.p =
        p.to > p.p ? Math.min(1, p.p + dt / ms) : Math.max(0, p.p - dt / ms);
      moved = true;
      if (p.kind === "beam" && ((was < 1 && p.p >= 1) || (was >= 1 && p.p < 1)))
        this.plank(p, p.p >= 1);
    }
    if (moved) this.draw();
  }

  private plank(p: Part, up: boolean): void {
    if (!this.onPlank) return;
    const sx = this.root.scale.x;
    this.onPlank(
      this.root.x + (p.x + p.w / 2) * sx,
      this.root.y + p.y + p.h / 2,
      p.w,
      up,
    );
  }

  /** Places every timber as far along as it has got. */
  private draw(): void {
    const bay =
      (this.kit.meta.bands[this.kit.meta.shaftBand]![1] -
        this.kit.meta.bands[this.kit.meta.shaftBand]![0]) *
      this.ky;
    for (const p of this.parts) {
      const s = p.sprite;
      s.visible = p.p > 0.001;
      if (!s.visible) continue;
      const t = p.p;
      s.width = p.w;
      s.height = p.h;
      s.alpha = Math.min(1, t * 3.5);
      s.rotation = 0;
      switch (p.kind) {
        case "post": {
          // Lowered on a rope from above until it stands on the one below.
          s.anchor.set(0.5, 1);
          s.position.set(
            p.x + p.w / 2,
            p.y + p.h - (1 - easeOut(t)) * bay * 0.7,
          );
          break;
        }
        case "brace": {
          // Hung on its peg at the top, then swung up into place.
          const left = p.side < 0;
          s.anchor.set(left ? 0 : 1, 0);
          s.position.set(left ? p.x : p.x + p.w, p.y);
          s.rotation = (left ? 1 : -1) * 0.95 * (1 - easeBack(t));
          break;
        }
        case "beam": {
          // Slid in across the posts from one side, alternating, and dropped onto them.
          const from = p.slot % 2 ? 1 : -1;
          const e = easeOut(t);
          s.anchor.set(0.5, 0.5);
          s.position.set(
            p.x + p.w / 2 + from * (1 - e) * p.w * 0.9,
            p.y +
              p.h / 2 -
              Math.sin(Math.min(1, t * 1.2) * Math.PI) * p.h * 0.6,
          );
          break;
        }
        case "ladder": {
          // Leaned in against the scaffold from its foot.
          s.anchor.set(0.5, 1);
          s.position.set(p.x + p.w / 2, p.y + p.h);
          s.rotation = -0.5 * (1 - easeOut(t));
          break;
        }
        default: {
          // Set down from above with a little bump; the foundations come up out of the dust.
          s.anchor.set(0.5, 1);
          const lift = p.ground
            ? 0
            : (1 - bounce(t)) * Math.min(bay * 0.35, p.h * 0.5);
          s.position.set(p.x + p.w / 2, p.y + p.h - lift);
          if (p.ground) s.scale.y *= 0.4 + 0.6 * easeOut(t);
        }
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
