import type { BattleEventId, GameEvent, PlayerId } from '@cardcraft-castles/engine';
import { animScale } from '../app/settings';
import type { Battlefield } from '../scene/battlefield';
import { skyFor } from '../ui/theme';
import { audio } from './audio';

/**
 * VFX hook: what the battlefield and the speakers do for each game event.
 * The board's animator calls these in event order and waits for the
 * returned promise, so making an effect longer or richer only means
 * editing this file. Interface changes (numbers, cards, panels) stay in the
 * board; this file only touches the Pixi scene and audio.
 */

export interface FxContext {
  field: Battlefield;
  /** Castle index on screen (0 left, 1 right) for a seat. */
  side(seat: PlayerId): 0 | 1;
  /** Floating text over the scene, in CSS px. */
  float(text: string, x: number, y: number, kind: 'damage' | 'build' | 'blocked' | 'info'): void;
}

const ms = (base: number): number => base * animScale();
const wait = (base: number): Promise<void> => new Promise((r) => setTimeout(r, ms(base)));

const DAMAGE_COLOR = { normal: 0xffa040, piercing: 0xc77dff, wallOnly: 0xffd27a } as const;

type Damage = Extract<GameEvent, { type: 'damage' }>;

export const fx = {
  async damage(e: Damage, ctx: FxContext, heights: { keep: number; wall: number }): Promise<void> {
    const target = ctx.side(e.target);
    const from = ctx.side(e.source);
    const aimAt = e.kind === 'piercing' || e.wallLoss === 0 ? 'keep' : 'wall';
    const impact = ctx.field.anchor(target, aimAt);
    if (e.cause !== 'burn') {
      audio.play('cardPlay', 0.2);
      await ctx.field.projectile(ctx.field.anchor(from, 'keep'), impact, DAMAGE_COLOR[e.kind], ms(480));
    } else {
      ctx.field.burst(impact.x, impact.y, { count: 18, color: [0xff7a20, 0xffc040, 0xff4010], speed: 2.2, gravity: -0.05, size: 16, life: 900 });
      audio.play('burn');
    }
    if (e.blocked) {
      audio.play('blocked');
      ctx.field.burst(impact.x, impact.y, { count: 26, color: [0xaee8ff, 0xffffff], speed: 5, gravity: 0, size: 10, life: 600 });
      ctx.float('✦', impact.x, impact.y - 20, 'blocked');
      await wait(380);
      return;
    }
    const lost = e.wallLoss + e.keepLoss;
    const big = lost >= 12;
    audio.play(big ? 'hitBig' : e.kind === 'piercing' ? 'pierce' : 'hit', Math.min(1, lost / 16));
    ctx.field.shake(Math.min(22, 4 + lost * 0.9));
    if (big) ctx.field.flash(0xffe0b0, 0.25, 220);
    ctx.field.burst(impact.x, impact.y, { count: 10 + lost * 2, texture: 'rubble', speed: 4 + lost * 0.15, spread: Math.PI * 1.2, gravity: 0.35, size: 9, life: 1300 });
    ctx.field.burst(impact.x, impact.y, { count: 14, color: [DAMAGE_COLOR[e.kind], 0xffe7b0], speed: 3, gravity: 0.02, size: 22, life: 500 });
    if (lost > 0) ctx.float(`−${lost}`, impact.x, impact.y - 10, 'damage');
    await ctx.field.animateCastle(target, heights.keep, heights.wall, ms(420));
  },

  async structureLost(seat: PlayerId, target: 'keep' | 'wall', amount: number, ctx: FxContext, heights: { keep: number; wall: number }): Promise<void> {
    const side = ctx.side(seat);
    const at = ctx.field.anchor(side, target);
    ctx.field.burst(at.x, at.y, { count: 8 + amount * 2, texture: 'rubble', speed: 3, gravity: 0.35, size: 8, life: 1200 });
    ctx.float(`−${amount}`, at.x, at.y - 10, 'damage');
    await ctx.field.animateCastle(side, heights.keep, heights.wall, ms(500));
  },

  async built(seat: PlayerId, target: 'keep' | 'wall', amount: number, ctx: FxContext, heights: { keep: number; wall: number }): Promise<void> {
    const side = ctx.side(seat);
    audio.play('build');
    const grow = ctx.field.animateCastle(side, heights.keep, heights.wall, ms(620));
    await wait(200);
    const at = ctx.field.anchor(side, target);
    ctx.field.burst(at.x, at.y, { count: 16, color: [0xffe7a0, 0xfff4d0], speed: 2.4, gravity: 0.04, size: 12, life: 800 });
    ctx.float(`+${amount}`, at.x, at.y - 18, 'build');
    await grow;
  },

  async wallsSwapped(walls: [number, number], keeps: [number, number], ctx: FxContext): Promise<void> {
    audio.play('enchant');
    for (const seat of [0, 1] as const) {
      const at = ctx.field.anchor(ctx.side(seat), 'wall');
      ctx.field.burst(at.x, at.y, { count: 22, color: [0xc77dff, 0x7fdcf5], speed: 3, gravity: 0, size: 14, life: 900 });
    }
    await Promise.all(([0, 1] as const).map((seat) => ctx.field.animateCastle(ctx.side(seat), keeps[seat], walls[seat], ms(800))));
  },

  async status(kind: 'burn' | 'frost' | 'shield' | 'cleanse', seat: PlayerId, ctx: FxContext, shield = 0): Promise<void> {
    const side = ctx.side(seat);
    const at = ctx.field.anchor(side, 'keep');
    if (kind === 'burn') {
      audio.play('burn');
      ctx.field.burst(at.x, at.y + 30, { count: 30, color: [0xff7a20, 0xffc040, 0xff3a10], speed: 2, gravity: -0.06, size: 18, life: 1100 });
    } else if (kind === 'frost') {
      audio.play('frost');
      ctx.field.burst(at.x, at.y + 30, { count: 28, color: [0xbff3ff, 0x7fdcf5, 0xffffff], speed: 2.6, gravity: 0.02, size: 12, life: 1000 });
    } else if (kind === 'shield') {
      audio.play('shield');
      ctx.field.setShield(side, shield);
      ctx.field.burst(at.x, at.y, { count: 20, color: [0xaee8ff, 0xffffff], speed: 3.5, gravity: 0, size: 10, life: 700 });
    } else {
      audio.play('shield');
      ctx.field.burst(at.x, at.y + 20, { count: 24, color: [0xfff4c0, 0xffffff], speed: 2.4, gravity: -0.03, size: 12, life: 900 });
    }
    await wait(420);
  },

  async ultimate(seat: PlayerId, ctx: FxContext): Promise<void> {
    audio.play('ultimate');
    const side = ctx.side(seat);
    const at = ctx.field.anchor(side, 'keep');
    ctx.field.flash(0xffd27a, 0.3, 500);
    ctx.field.burst(at.x, at.y, { count: 60, color: [0xffe066, 0xff9a1f, 0xffffff], speed: 6, gravity: 0, size: 16, life: 1100 });
    await wait(500);
  },

  async battleEvent(eventId: BattleEventId, ctx: FxContext): Promise<void> {
    audio.play('event');
    void ctx.field.setMood(skyFor(eventId), ms(1600));
    if (eventId === 'terremoto') {
      for (let i = 0; i < 4; i++) setTimeout(() => ctx.field.shake(16), i * 180);
    }
    if (eventId === 'tormenta') ctx.field.flash(0xdfe8ff, 0.5, 300);
  },

  async battleEventEnded(ctx: FxContext): Promise<void> {
    await ctx.field.setMood(skyFor(null), ms(1400));
  },

  gameOver(winnerIsMe: boolean | null): void {
    audio.play(winnerIsMe === false ? 'defeat' : 'victory');
    audio.music(winnerIsMe === false ? 'defeat' : 'victory');
  },
};
