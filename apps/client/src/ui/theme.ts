import type { BattleEventId, HeroId } from '@cardcraft-castles/engine';

/** Banner colour of each hero: roofs, flags and the HUD ring. Unknown heroes get gold. */
const HERO_COLORS: Record<string, number> = {
  arquitecta: 0xc8963e,
  mariscal: 0xa8322d,
  hechicera: 0x3b3f9e,
  alquimista: 0x2f7d5b,
  saboteadora: 0x5b2f6e,
  guardian: 0x2c5e8a,
};

export function heroColor(hero: HeroId): number {
  return HERO_COLORS[hero] ?? 0xc8963e;
}

export function heroCss(hero: HeroId): string {
  return `#${heroColor(hero).toString(16).padStart(6, '0')}`;
}

/** Sky mood of the battlefield while a battle event is running (or just fired). */
export interface SkyMood {
  top: string;
  middle: string;
  horizon: string;
  /** Tint of the distant mountains. */
  far: number;
  near: number;
  ground: number;
  sun: string;
  sunAlpha: number;
  weather: 'none' | 'rain' | 'snow' | 'embers' | 'leaves' | 'dust';
}

export const DEFAULT_SKY: SkyMood = {
  top: '#2a2c44',
  middle: '#9a7f7c',
  horizon: '#f4c088',
  far: 0x6a6478,
  near: 0x3b3a4a,
  ground: 0x343a22,
  sun: '255,214,150',
  sunAlpha: 0.9,
  weather: 'none',
};

const EVENT_SKIES: Record<string, Partial<SkyMood>> = {
  tormenta: { top: '#141a26', middle: '#3a4458', horizon: '#6f7c8c', far: 0x2d3544, near: 0x1f2633, sunAlpha: 0, weather: 'rain' },
  eclipse: { top: '#07050f', middle: '#2a1840', horizon: '#7a3b6e', far: 0x2a2140, near: 0x161226, sun: '190,140,255', sunAlpha: 0.6, weather: 'embers' },
  terremoto: { top: '#2a2018', middle: '#7a5a3c', horizon: '#d99a5c', far: 0x5a4636, near: 0x3a2e24, weather: 'dust' },
  mercado: { top: '#2c4a78', middle: '#9cb4d0', horizon: '#ffe0a6', sun: '255,236,180', weather: 'none' },
  cosecha: { top: '#3d4a6b', middle: '#c49a6c', horizon: '#ffcf7a', ground: 0x4a4a22, sun: '255,200,110', weather: 'leaves' },
  tregua: { top: '#2a3448', middle: '#8d9bb0', horizon: '#dfe6ee', far: 0x7c8aa0, near: 0x56647a, ground: 0x6f7a80, sun: '230,240,255', sunAlpha: 0.5, weather: 'snow' },
};

/** Twilight Fury: a blood-red dusk with embers, darker from level 3. */
const TWILIGHT_SKIES: Partial<SkyMood>[] = [
  { top: '#22142a', middle: '#8a3a34', horizon: '#ff8a48', far: 0x6a3a44, near: 0x34202a, ground: 0x2e2a1e, sun: '255,130,70', sunAlpha: 1, weather: 'embers' },
  { top: '#120a16', middle: '#62201f', horizon: '#e4502c', far: 0x4e2632, near: 0x24141c, ground: 0x251f17, sun: '255,90,50', sunAlpha: 0.95, weather: 'embers' },
];

/** Sky for a running battle event, or else for the Twilight Fury level (0: off). */
export function skyFor(eventId: BattleEventId | null, twilight = 0): SkyMood {
  if (eventId) return { ...DEFAULT_SKY, ...(EVENT_SKIES[eventId] ?? {}) };
  if (twilight > 0) return { ...DEFAULT_SKY, ...TWILIGHT_SKIES[twilight >= 3 ? 1 : 0] };
  return DEFAULT_SKY;
}
