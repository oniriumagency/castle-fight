import type { BattleEventId, GameEvent, HeroId, PlayerId, School } from '@cardcraft-castles/engine';
import { getCard } from '@cardcraft-castles/engine';
import { animScale } from '../app/settings';
import type { Battlefield, ProjectileStyle } from '../scene/battlefield';
import { heroColor, skyFor } from '../ui/theme';
import { audio, type Cue } from './audio';

/**
 * VFX and sound director: what the battlefield and the speakers do for each
 * game event. The board's animator calls these in event order and waits for
 * the returned promise, so making an effect longer or richer only means
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
export const SCHOOL_COLOR: Record<School, number> = { construccion: 0xf0b850, asalto: 0xff6a50, arcano: 0x7fd6f2 };
const RARITY_COLOR = { comun: 0xfff0d0, rara: 0x7fc4ff, epica: 0xb06cff, legendaria: 0xffb52e } as const;
const SCHOOL_CUE: Record<School, Cue> = { construccion: 'playConstruccion', asalto: 'playAsalto', arcano: 'playArcano' };

/** Cards whose attack looks like something specific. */
const CARD_STYLE: Record<string, ProjectileStyle | 'lightning'> = {
  escaramuza: 'arrows',
  'doble-salva': 'arrows',
  'saetas-negras': 'arrows',
  hostigamiento: 'arrows',
  emboscada: 'arrows',
  'balista-de-asedio': 'bolt',
  'carga-de-lanceros': 'charge',
  'carga-de-caballeria': 'charge',
  'hueste-imparable': 'charge',
  'ariete-de-hierro': 'charge',
  zapadores: 'charge',
  catapulta: 'boulder',
  'trabuquete-colosal': 'boulder',
  'torre-de-asedio': 'boulder',
  sabotaje: 'fire',
  'chispa-arcana': 'bolt',
  'rayo-bifurcado': 'lightning',
  'tormenta-de-ceniza': 'fire',
  'cometa-del-ocaso': 'comet',
};

const HERO_CUE: Record<string, Cue> = {
  arquitecta: 'ultArquitecta',
  mariscal: 'ultMariscal',
  hechicera: 'ultHechicera',
  alquimista: 'ultAlquimista',
  saboteadora: 'ultSaboteadora',
  guardian: 'ultGuardian',
};

const EVENT_CUE: Record<string, Cue> = {
  tormenta: 'eventTormenta',
  terremoto: 'eventTerremoto',
  eclipse: 'eventEclipse',
  mercado: 'eventMercado',
  cosecha: 'eventCosecha',
  tregua: 'eventTregua',
};

type Damage = Extract<GameEvent, { type: 'damage' }>;
type Point = { x: number; y: number };

/** The card being resolved, so its attacks can look like it. */
let currentCard: string | null = null;
/** Seat of the last ultimate, for its projectile colour. */
let ultimateHero: HeroId | null = null;

const pan = (ctx: FxContext, seat: PlayerId): number => (ctx.side(seat) === 0 ? -0.55 : 0.55);

function attackStyle(e: Damage): ProjectileStyle | 'lightning' | 'flames' {
  if (e.cause === 'burn') return 'flames';
  if (e.cause === 'ultimate') return 'orb';
  if (currentCard) {
    const special = CARD_STYLE[currentCard];
    if (special) return special;
    try {
      const school = getCard(currentCard).school;
      if (school === 'arcano') return e.kind === 'piercing' ? 'bolt' : 'fire';
    } catch {
      // Unknown card: default below.
    }
  }
  return e.kind === 'piercing' ? 'bolt' : 'boulder';
}

/** Dust, debris, sparks and a shockwave where a hit lands. */
function impact(field: Battlefield, at: Point, lost: number, color: number, style: string): void {
  const big = lost >= 12;
  field.flare(at.x, at.y, color, 140 + lost * 8, 380, 0.8);
  field.ring(at.x, at.y, color, 50 + lost * 5, 520, 0.8);
  field.burst(at.x, at.y, { count: 8 + lost * 1.6, texture: 'rubble', speed: 4 + lost * 0.15, spread: Math.PI * 1.3, gravity: 0.35, size: 10, life: 1400 });
  field.burst(at.x, at.y, { count: 10 + lost, texture: 'spark', color: [0xffe7b0, color], speed: 5 + lost * 0.1, gravity: 0.12, size: 20, life: 520 });
  field.burst(at.x, at.y, { count: 3 + Math.round(lost / 4), texture: 'smoke', color: 0x9c8a72, speed: 1.4, gravity: -0.01, size: 44 + lost * 1.5, life: 1500, alpha: 0.5 });
  if (style === 'bolt' || style === 'lightning') {
    field.burst(at.x, at.y, { count: 12, texture: 'crystal', color: [0xd9a8ff, 0xffffff, color], speed: 4, gravity: 0.05, size: 14, life: 800 });
  }
  if (style === 'fire' || style === 'comet' || style === 'orb') {
    field.burst(at.x, at.y, { count: 14, texture: 'flame', color: 0xffe080, colorTo: 0xff2a00, speed: 3, gravity: -0.05, size: 30, life: 600 });
    field.burst(at.x, at.y, { count: 10, color: 0xffa040, speed: 4, gravity: 0.05, size: 8, life: 1200 });
  }
  if (big) field.burst(at.x, at.y + 40, { count: 8, texture: 'smoke', color: 0x6c5e4c, speed: 2.2, gravity: -0.015, size: 90, life: 2200, alpha: 0.55 });
}

export const fx = {
  /** A new turn: forget the last card. */
  turnStarted(mine: boolean, local: boolean): void {
    currentCard = null;
    audio.play(mine || local ? 'yourTurn' : 'theirTurn');
  },

  /** The card leaves the hand. */
  cardLaunched(): void {
    audio.play('cardPlay');
  },

  /** The card lands big in the middle of the table (`at` in CSS px). */
  cardLanded(cardId: string, at: Point, combo: boolean, ctx: FxContext): Promise<void> {
    currentCard = cardId;
    const card = getCard(cardId);
    const color = SCHOOL_COLOR[card.school];
    const field = ctx.field;
    audio.play(SCHOOL_CUE[card.school]);
    field.flare(at.x, at.y, color, 380, 520, 0.4);
    field.ring(at.x, at.y, color, 150, 600, 0.6);
    field.burst(at.x, at.y, { count: 16, texture: card.school === 'arcano' ? 'crystal' : 'spark', color: [color, 0xffffff], speed: 5, gravity: 0.02, drag: 0.95, size: 16, life: 700, area: { w: 140, h: 200 } });
    if (combo) {
      audio.play('combo', 0.5, { delay: 120 });
      field.ring(at.x, at.y, 0x7ff0ff, 200, 700, 0.8);
    }
    switch (card.rarity) {
      case 'rara':
        audio.play('rarityRara', 0.5, { delay: 60 });
        field.burst(at.x, at.y, { count: 14, texture: 'crystal', color: RARITY_COLOR.rara, speed: 2, gravity: -0.02, size: 12, life: 1100, area: { w: 180, h: 240 } });
        return wait(0);
      case 'epica':
        audio.play('rarityEpica');
        field.ring(at.x, at.y, RARITY_COLOR.epica, 220, 800, 0.8);
        field.burst(at.x, at.y, { count: 30, color: [RARITY_COLOR.epica, 0xe0c0ff], speed: 3, gravity: -0.03, size: 14, life: 1300, area: { w: 200, h: 260 } });
        return wait(150);
      case 'legendaria':
        audio.play('rarityLegendaria');
        audio.duck(0.35, 1800);
        field.rays(at.x, at.y, RARITY_COLOR.legendaria, 720, 1900, 0.5);
        field.flare(at.x, at.y, 0xffe080, 560, 900, 0.55);
        field.flash(0xffc060, 0.28, 600);
        field.ring(at.x, at.y, 0xffd27a, 260, 900, 0.9);
        field.shake(6);
        field.burst(at.x, at.y, { count: 50, texture: 'spark', color: [0xffe066, 0xff9a1f, 0xffffff], speed: 8, gravity: 0.06, drag: 0.95, size: 26, life: 1300 });
        field.burst(at.x, at.y, { count: 30, texture: 'flame', color: 0xffe080, colorTo: 0xff4a00, speed: 1.5, gravity: -0.05, size: 26, life: 1200, area: { w: 220, h: 300 } });
        return wait(450);
      default:
        return wait(0);
    }
  },

  /** `shieldLeft`: Shield charges after this hit (a blocked hit lowers the dome once it lands). */
  async damage(e: Damage, ctx: FxContext, heights: { keep: number; wall: number }, shieldLeft?: number): Promise<void> {
    const field = ctx.field;
    const target = ctx.side(e.target);
    const from = ctx.side(e.source);
    const aimAt = e.kind === 'piercing' || e.wallLoss === 0 ? 'keep' : 'wall';
    const at = (e.blocked && field.domePoint(target, from)) || field.anchor(target, aimAt);
    const style = attackStyle(e);
    const color = e.cause === 'ultimate' && ultimateHero ? heroColor(ultimateHero) | 0x303030 : DAMAGE_COLOR[e.kind];
    const p = pan(ctx, e.target);
    if (style === 'flames') {
      audio.play('burn', 0.5, { pan: p });
      field.burst(at.x, at.y, { count: 18, texture: 'flame', color: 0xffe080, colorTo: 0xff3010, speed: 2.2, gravity: -0.06, size: 26, life: 800, area: { w: 30, h: 10 } });
    } else if (style === 'lightning') {
      audio.play('launchArcane', 0.5, { pan: p });
      await wait(140);
      field.lightning({ x: at.x + (Math.random() - 0.5) * 120, y: -20 }, at, 0xd9b8ff, 420);
      field.flash(0xe8dcff, 0.35, 260);
      audio.play('thunder', 0.5, { pan: p, gain: 0.8 });
    } else {
      const physical = style === 'boulder' || style === 'arrows' || style === 'charge';
      audio.play(physical ? 'launch' : 'launchArcane', 0.5, { pan: pan(ctx, e.source) });
      const flight = style === 'charge' ? 620 : style === 'bolt' ? 380 : style === 'comet' ? 560 : 500;
      await field.projectile(field.anchor(from, style === 'charge' ? 'base' : 'keep'), at, color, ms(flight), style);
    }
    if (e.blocked) {
      audio.play('blocked', 0.5, { pan: p });
      field.shieldHit(target);
      field.ring(at.x, at.y, 0xaee8ff, 120, 600, 1);
      field.ring(at.x, at.y, 0xc9a8ff, 70, 450, 0.8);
      field.flare(at.x, at.y, 0xc9e8ff, 110, 380, 0.5);
      field.burst(at.x, at.y, { count: 26, texture: 'crystal', color: [0xaee8ff, 0xd8c8ff, 0xffffff], speed: 5, gravity: 0, size: 12, life: 650 });
      field.burst(at.x, at.y, { count: 12, texture: 'spark', color: [0xffffff, 0xaee8ff], speed: 6, gravity: 0.05, size: 18, life: 400 });
      if (shieldLeft !== undefined) {
        if (shieldLeft === 0) field.shatterShield(target);
        field.setShield(target, shieldLeft);
      }
      ctx.float('✦', at.x, at.y - 20, 'blocked');
      await wait(380);
      return;
    }
    const lost = e.wallLoss + e.keepLoss;
    const big = lost >= 12;
    const fell = e.keepLoss > 0 && heights.keep <= 0;
    if (style !== 'flames') {
      audio.play(big ? 'hitBig' : e.kind === 'piercing' ? 'pierce' : 'hit', Math.min(1, lost / 14), { pan: p });
      if (e.kind === 'piercing' && big) audio.play('pierce', 0.5, { pan: p, gain: 0.7 });
      impact(field, at, lost, color, style);
      field.shake(Math.min(20, 3 + lost * 0.75));
      field.hitCastle(target, e.kind === 'piercing' ? 0xd0a0ff : 0xff9a7a, Math.min(1.5, lost / 10));
      if (big) {
        field.flash(0xffe0b0, 0.22, 240);
        audio.duck(0.55, 900);
      }
    } else if (lost > 0) {
      field.burst(at.x, at.y, { count: 6 + lost, texture: 'rubble', speed: 3, gravity: 0.35, size: 8, life: 1100 });
      field.hitCastle(target, 0xff7a30, 0.3);
    }
    if (lost > 0) ctx.float(`−${lost}`, at.x, at.y - 10, 'damage');
    if (fell) {
      audio.play('keepFall', 0.5, { pan: p, delay: 200 });
      const base = field.anchor(target, 'base');
      field.burst(base.x, base.y - 20, { count: 12, texture: 'smoke', color: 0x8a7a66, speed: 2.6, spread: Math.PI, gravity: -0.02, size: 80, life: 2600, alpha: 0.5, area: { w: 80, h: 30 } });
      field.burst(base.x, base.y - 60, { count: 40, texture: 'rubble', speed: 5, spread: Math.PI * 1.2, gravity: 0.35, size: 12, life: 1800, area: { w: 60, h: 120 } });
      field.shake(24);
    }
    await field.animateCastle(target, heights.keep, heights.wall, ms(fell ? 900 : 420));
  },

  async structureLost(seat: PlayerId, target: 'keep' | 'wall', amount: number, ctx: FxContext, heights: { keep: number; wall: number }): Promise<void> {
    const side = ctx.side(seat);
    const at = ctx.field.anchor(side, target);
    audio.play('crumble', 0.5, { pan: pan(ctx, seat) });
    ctx.field.burst(at.x, at.y, { count: 8 + amount * 2, texture: 'rubble', speed: 3, gravity: 0.35, size: 9, life: 1300 });
    ctx.field.burst(at.x, at.y + 20, { count: 5, texture: 'smoke', color: 0x8c7a62, speed: 1.2, gravity: -0.01, size: 60, life: 1600, alpha: 0.6, area: { w: 30, h: 60 } });
    ctx.field.hitCastle(side, 0xd0b090, 0.6);
    ctx.float(`−${amount}`, at.x, at.y - 10, 'damage');
    await ctx.field.animateCastle(side, heights.keep, heights.wall, ms(500));
  },

  async built(seat: PlayerId, target: 'keep' | 'wall', amount: number, ctx: FxContext, heights: { keep: number; wall: number }): Promise<void> {
    const field = ctx.field;
    const side = ctx.side(seat);
    const p = pan(ctx, seat);
    if (amount >= 15) audio.play('buildBig', 0.5, { pan: p });
    else audio.play('build', Math.min(1, amount / 14), { pan: p });
    const base = field.anchor(side, 'base');
    const before = field.anchor(side, target);
    const grow = field.animateCastle(side, heights.keep, heights.wall, ms(620 + Math.min(400, amount * 15)));
    // Dust where the masons work, then motes of gold up the new courses.
    const x = target === 'keep' ? base.x : before.x;
    field.burst(x, base.y - 6, { count: 4 + Math.round(amount / 4), texture: 'smoke', color: 0xb8a080, speed: 1.6, spread: Math.PI * 0.8, gravity: -0.01, size: 44, life: 1200, alpha: 0.55, area: { w: 60, h: 8 } });
    await wait(200);
    const at = field.anchor(side, target);
    const span = Math.max(20, before.y - at.y);
    field.burst(at.x, at.y + span / 2, { count: 10 + amount, color: [0xffe7a0, 0xfff4d0], speed: 1, angle: -Math.PI / 2, spread: 0.8, gravity: -0.03, size: 10, life: 1100, area: { w: 50, h: span } });
    field.ring(at.x, at.y, 0xffe7a0, 60 + amount * 2, 600, 0.6);
    field.burst(at.x, at.y, { count: 10, texture: 'spark', color: [0xffe7a0, 0xffffff], speed: 3, gravity: 0.05, size: 16, life: 500 });
    ctx.float(`+${amount}`, at.x, at.y - 18, 'build');
    await grow;
  },

  async wallsSwapped(walls: [number, number], keeps: [number, number], ctx: FxContext): Promise<void> {
    audio.play('wallSwap');
    for (const seat of [0, 1] as const) {
      const at = ctx.field.anchor(ctx.side(seat), 'wall');
      ctx.field.burst(at.x, at.y, { count: 26, texture: 'crystal', color: [0xc77dff, 0x7fdcf5], speed: 3, gravity: 0, size: 14, life: 1000 });
      ctx.field.ring(at.x, at.y, 0xc77dff, 140, 800, 0.8);
    }
    await Promise.all(([0, 1] as const).map((seat) => ctx.field.animateCastle(ctx.side(seat), keeps[seat], walls[seat], ms(800))));
  },

  async status(kind: 'burn' | 'frost' | 'shield' | 'cleanse', seat: PlayerId, ctx: FxContext, shield = 0): Promise<void> {
    const field = ctx.field;
    const side = ctx.side(seat);
    const at = field.anchor(side, 'keep');
    const p = pan(ctx, seat);
    if (kind === 'burn') {
      audio.play('burn', 0.5, { pan: p });
      field.flare(at.x, at.y + 30, 0xff7a20, 200, 500, 0.8);
      field.burst(at.x, at.y + 30, { count: 30, texture: 'flame', color: 0xffe080, colorTo: 0xff2a00, speed: 2.4, gravity: -0.06, size: 28, life: 1000, area: { w: 40, h: 40 } });
      field.burst(at.x, at.y + 30, { count: 20, color: 0xffa040, speed: 3, gravity: -0.03, size: 7, life: 1500 });
    } else if (kind === 'frost') {
      audio.play('frost', 0.5, { pan: p });
      field.ring(at.x, at.y + 30, 0xbff3ff, 160, 700, 0.9);
      field.burst(at.x, at.y + 30, { count: 30, texture: 'crystal', color: [0xbff3ff, 0x7fdcf5, 0xffffff], speed: 3, gravity: 0.03, size: 14, life: 1100 });
      field.hitCastle(side, 0xa0e8ff, 0.2);
    } else if (kind === 'shield') {
      audio.play('shield', 0.5, { pan: p });
      field.setShield(side, shield);
      const base = field.anchor(side, 'base');
      field.ring(at.x, base.y - (base.y - at.y) * 0.5, 0xaee8ff, 220, 800, 0.8);
      field.flare(at.x, at.y, 0xaee8ff, 240, 600, 0.6);
      field.burst(at.x, at.y, { count: 24, texture: 'crystal', color: [0xaee8ff, 0xffffff], speed: 3.5, gravity: 0, size: 11, life: 800 });
    } else {
      audio.play('cleanse', 0.5, { pan: p });
      field.ring(at.x, at.y + 20, 0xfff4c0, 160, 700, 0.8);
      field.burst(at.x, at.y + 60, { count: 30, color: [0xfff4c0, 0xffffff], speed: 1.6, angle: -Math.PI / 2, spread: 0.8, gravity: -0.04, size: 12, life: 1300, area: { w: 60, h: 80 } });
    }
    await wait(420);
  },

  /** Keeps the castles' flames, ice and danger smoke in step with the game. */
  auras(ctx: FxContext, seats: { burn: number; frozen: boolean; keep: number; keepStart: number }[]): void {
    seats.forEach((s, seat) => {
      const danger = s.keep > 0 ? Math.max(0, Math.min(1, 1 - s.keep / Math.max(1, s.keepStart * 0.4))) : 0;
      ctx.field.setAura(ctx.side(seat as PlayerId), { burn: s.burn, frost: s.frozen ? 1 : 0, danger });
    });
  },

  enchantment(seat: PlayerId, ctx: FxContext, triggered = false): void {
    const at = ctx.field.anchor(ctx.side(seat), 'keep');
    audio.play('enchant', 0.5, { pan: pan(ctx, seat), gain: triggered ? 0.55 : 1 });
    ctx.field.burst(at.x, at.y + 40, { count: triggered ? 10 : 24, texture: 'crystal', color: [0xc9a8ff, 0x7fdcf5, 0xffffff], speed: 1.2, angle: -Math.PI / 2, spread: 1.2, gravity: -0.03, size: 11, life: 1200, area: { w: 70, h: 80 } });
    if (!triggered) ctx.field.ring(at.x, at.y + 30, 0xc9a8ff, 120, 700, 0.6);
  },

  drawbridge(seat: PlayerId, ctx: FxContext): void {
    const at = ctx.field.anchor(ctx.side(seat), 'base');
    audio.play('drawbridge', 0.5, { pan: pan(ctx, seat) });
    setTimeout(() => ctx.field.burst(at.x, at.y - 4, { count: 6, texture: 'smoke', color: 0xa89070, speed: 1.4, spread: Math.PI * 0.8, gravity: -0.01, size: 40, life: 1000, alpha: 0.5 }), ms(500));
  },

  reveal(seat: PlayerId, ctx: FxContext): void {
    const at = ctx.field.anchor(ctx.side(seat), 'keep');
    audio.play('reveal');
    ctx.field.flare(at.x, at.y, 0xc9a8ff, 200, 700, 0.5);
  },

  extraTurn(seat: PlayerId, ctx: FxContext): void {
    const at = ctx.field.anchor(ctx.side(seat), 'keep');
    audio.play('extraTurn');
    ctx.field.ring(at.x, at.y, 0x7fdcf5, 180, 900, 0.8);
    ctx.field.burst(at.x, at.y, { count: 20, texture: 'crystal', color: [0x7fdcf5, 0xffffff], speed: 2.5, gravity: 0, size: 12, life: 1100 });
  },

  ultimateReady(seat: PlayerId, ctx: FxContext, mine: boolean): void {
    const at = ctx.field.anchor(ctx.side(seat), 'keep');
    if (mine) audio.play('ultimateReady');
    ctx.field.ring(at.x, at.y, 0xffd27a, 120, 800, 0.7);
    ctx.field.burst(at.x, at.y, { count: 16, color: [0xffe066, 0xffffff], speed: 1.4, angle: -Math.PI / 2, spread: 1.4, gravity: -0.03, size: 10, life: 1200 });
  },

  /** The "Ultimate ready!" call at the start of your turn, centered at (x, y) in CSS px. */
  ultimateReadyBanner(seat: PlayerId, ctx: FxContext, x: number, y: number): void {
    const field = ctx.field;
    audio.play('ultimateReady', 0.8, { gain: 1.3 });
    audio.play('extraTurn', 0.5, { delay: 120, gain: 0.6 });
    field.rays(x, y, 0xffd27a, 520, 1800, 0.55);
    field.flare(x, y, 0xffe0a0, 300, 700, 0.55);
    field.ring(x, y, 0xffd27a, 260, 900, 0.8);
    field.burst(x, y, { count: 34, color: [0xffe066, 0xffd27a, 0xffffff], speed: 6, gravity: 0.04, drag: 0.95, size: 14, life: 1300, area: { w: 260, h: 60 } });
    field.burst(x, y, { count: 18, texture: 'glow', color: [0xffe9a8], speed: 1.2, gravity: -0.04, size: 22, life: 1600, area: { w: 380, h: 80 } });
    const at = field.anchor(ctx.side(seat), 'keep');
    field.ring(at.x, at.y, 0xffd27a, 120, 800, 0.7);
  },

  async ultimate(seat: PlayerId, heroId: HeroId, ctx: FxContext): Promise<void> {
    ultimateHero = heroId;
    const field = ctx.field;
    const side = ctx.side(seat);
    const at = field.anchor(side, 'keep');
    const base = field.anchor(side, 'base');
    const color = heroColor(heroId);
    const light = color | 0x404040;
    audio.play('ultimate', 0.5, { pan: pan(ctx, seat) * 0.5 });
    const flavour = HERO_CUE[heroId];
    if (flavour) audio.play(flavour, 0.5, { pan: pan(ctx, seat) * 0.5 });
    audio.duck(0.3, 2200);
    // A pillar of light out of the keep.
    for (let i = 0; i < 5; i++) field.flare(at.x, at.y - i * 80, light, 220 - i * 20, 1000 + i * 120, 0.45);
    field.rays(at.x, at.y, light, 700, 2000, 0.45);
    field.flash(light, 0.32, 600);
    field.burst(at.x, base.y, { count: 40, texture: 'spark', color: [light, 0xffffff, 0xffe066], speed: 7, angle: -Math.PI / 2, spread: 0.7, gravity: 0.02, size: 26, life: 1100, area: { w: 60, h: 10 } });
    await wait(500);
    field.ring(at.x, at.y, light, 300, 900, 1);
    field.ring(base.x, base.y - 10, 0xffffff, 200, 700, 0.6);
    field.shake(10);
    switch (heroId) {
      case 'arquitecta':
        field.burst(base.x, base.y - 6, { count: 12, texture: 'smoke', color: 0xc0a880, speed: 2, spread: Math.PI * 0.8, gravity: -0.01, size: 60, life: 1600, alpha: 0.6 });
        field.burst(at.x, at.y + 60, { count: 40, color: [0xffe7a0, 0xfff4d0], speed: 1.4, angle: -Math.PI / 2, spread: 0.6, gravity: -0.04, size: 12, life: 1500, area: { w: 80, h: 160 } });
        break;
      case 'mariscal':
        field.burst(at.x, at.y, { count: 40, texture: 'spark', color: [0xff6a50, 0xffd080], speed: 9, gravity: 0.1, size: 26, life: 900 });
        break;
      case 'hechicera':
        field.burst(at.x, at.y, { count: 46, texture: 'crystal', color: [0x9f8cff, 0x7fdcf5, 0xffffff], speed: 4, gravity: -0.01, size: 16, life: 1500 });
        break;
      case 'alquimista':
        field.burst(at.x, at.y + 40, { count: 40, color: [0x6fe0a0, 0xc0ffd0], speed: 1.2, angle: -Math.PI / 2, spread: 1.2, gravity: -0.05, size: 16, life: 1600, area: { w: 80, h: 60 } });
        break;
      case 'saboteadora':
        field.burst(at.x, at.y, { count: 14, texture: 'smoke', color: 0x4a2f5e, speed: 2.4, gravity: -0.01, size: 80, life: 1800, alpha: 0.7 });
        break;
      case 'guardian':
        field.ring(at.x, base.y - 80, 0xaee8ff, 340, 1100, 0.9);
        field.burst(at.x, at.y, { count: 30, texture: 'crystal', color: [0xaee8ff, 0xffffff], speed: 3, gravity: 0, size: 14, life: 1300 });
        break;
    }
    await wait(400);
  },

  async battleEvent(eventId: BattleEventId, ctx: FxContext): Promise<void> {
    const field = ctx.field;
    audio.play(EVENT_CUE[eventId] ?? 'event');
    audio.duck(0.45, 2000);
    void field.setMood(skyFor(eventId), ms(1600));
    const { width, height } = field.size;
    const sides = [0, 1] as const;
    switch (eventId) {
      case 'terremoto':
        for (let i = 0; i < 6; i++) setTimeout(() => field.shake(14), i * 220);
        for (const side of sides) {
          const base = field.anchor(side, 'base');
          field.burst(base.x, base.y - 6, { count: 14, texture: 'smoke', color: 0xa08460, speed: 2, spread: Math.PI * 0.9, gravity: -0.01, size: 80, life: 2200, alpha: 0.6, area: { w: 160, h: 10 } });
          const top = field.anchor(side, 'keep');
          field.burst(top.x, top.y + 30, { count: 20, texture: 'rubble', speed: 2, gravity: 0.3, size: 8, life: 1600, area: { w: 60, h: 60 } });
        }
        break;
      case 'tormenta':
        field.flash(0xdfe8ff, 0.5, 300);
        for (const side of sides) {
          const at = field.anchor(side, 'wall');
          setTimeout(() => field.lightning({ x: at.x + (Math.random() - 0.5) * 100, y: -20 }, at, 0xcfe0ff, 420), 200 + side * 350);
        }
        break;
      case 'eclipse':
        field.flash(0x1a0830, 0.55, 1400);
        field.rays(width / 2, height * 0.3, 0xb48cff, 800, 2200, 0.5);
        break;
      case 'mercado':
        field.burst(width / 2, height * 0.35, { count: 50, texture: 'spark', color: [0xffd27a, 0xfff0b0], speed: 5, gravity: 0.08, size: 18, life: 1500, area: { w: width * 0.5, h: 40 } });
        break;
      case 'cosecha':
        field.flare(width / 2, height * 0.4, 0xffcf7a, 600, 1400, 0.5);
        field.burst(width / 2, height * 0.2, { count: 30, texture: 'rubble', color: [0xe0a040, 0xc06a2a, 0xd8c060], speed: 2, angle: Math.PI / 2, spread: 1.4, gravity: 0.03, size: 10, life: 3000, area: { w: width * 0.8, h: 20 } });
        break;
      case 'tregua':
        field.flash(0xf0f6ff, 0.35, 900);
        field.burst(width / 2, height * 0.1, { count: 40, texture: 'crystal', color: 0xffffff, speed: 1, angle: Math.PI / 2, spread: 1, gravity: 0.01, size: 10, life: 4000, area: { w: width, h: 20 } });
        break;
    }
  },

  async battleEventEnded(ctx: FxContext, twilight = 0): Promise<void> {
    await ctx.field.setMood(skyFor(null, twilight), ms(1400));
  },

  /** The Twilight Fury begins or rises: the sky bleeds and the ground shakes. */
  async twilightRose(level: number, ctx: FxContext): Promise<void> {
    const field = ctx.field;
    audio.play('event');
    audio.duck(0.45, 1800);
    void field.setMood(skyFor(null, level), ms(1800));
    field.shake(6 + level * 2);
    await wait(900);
  },

  timeUp(): void {
    audio.play('timeUp');
  },

  /** Ticks in the last seconds of my turn. */
  clockTick(secondsLeft: number): void {
    audio.play(secondsLeft <= 3 ? 'tickUrgent' : 'tick');
  },

  gameOver(winnerIsMe: boolean | null, winnerSide: 0 | 1 | null, ctx: FxContext): void {
    audio.play(winnerIsMe === false ? 'defeat' : 'victory');
    audio.music(winnerIsMe === false ? 'defeat' : 'victory');
    audio.setTension(0);
    const field = ctx.field;
    if (winnerSide === null) return;
    const loser = (1 - winnerSide) as 0 | 1;
    const top = field.anchor(winnerSide, 'keep');
    const colors = [[0xffd27a, 0xffffff], [0xff6a50, 0xffe0a0], [0x7fd6f2, 0xffffff], [0xb06cff, 0xffd0ff]];
    for (let i = 0; i < 6; i++) {
      setTimeout(() => field.firework(top.x + (Math.random() - 0.5) * 260, top.y - 80 - Math.random() * 120, colors[i % colors.length]), 300 + i * 420);
    }
    field.rays(top.x, top.y, 0xffe7a0, 600, 2600, 0.35);
    const base = field.anchor(loser, 'base');
    field.burst(base.x, base.y - 30, { count: 8, texture: 'smoke', color: 0x4a4440, speed: 1.4, angle: -Math.PI / 2, spread: 0.6, gravity: -0.02, size: 60, life: 3200, alpha: 0.4, area: { w: 70, h: 40 } });
  },
};
