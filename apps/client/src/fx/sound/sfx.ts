import { mtof, Synth } from './synth';

/**
 * Every sound effect in the game, synthesized from scratch. Each recipe is
 * rendered once into a buffer (offline) the first time it is needed and
 * then replayed, so a burst of hits costs no more than playing samples.
 *
 * `len` is the rendered length in seconds, `verb` how much of it goes to the
 * hall reverb, `vary` the random pitch spread per play (0 for tonal cues so
 * they stay in tune with the music), `scaled` renders three intensities, and
 * `level` is the peak each render is normalized to, so cues stay balanced.
 */

export type Cue =
  // Interface
  | 'uiHover' | 'uiClick' | 'uiBack' | 'uiOpen' | 'error' | 'emote' | 'notify'
  // Cards
  | 'cardHover' | 'cardDraw' | 'cardSelect' | 'cardDiscard' | 'shuffle' | 'cardPlay'
  | 'playConstruccion' | 'playAsalto' | 'playArcano'
  | 'rarityRara' | 'rarityEpica' | 'rarityLegendaria' | 'combo'
  // Castle and attacks
  | 'build' | 'buildBig' | 'launch' | 'launchArcane' | 'hit' | 'hitBig' | 'pierce' | 'blocked' | 'crumble' | 'keepFall' | 'wallSwap'
  // Statuses and economy
  | 'burn' | 'frost' | 'shield' | 'cleanse' | 'enchant' | 'drawbridge' | 'reveal' | 'extraTurn'
  | 'resource' | 'resourceLoss' | 'worker' | 'workerLoss'
  // Heroes
  | 'ultimateReady' | 'ultimate'
  | 'ultArquitecta' | 'ultMariscal' | 'ultHechicera' | 'ultAlquimista' | 'ultSaboteadora' | 'ultGuardian'
  // Battle events
  | 'event' | 'eventTormenta' | 'eventTerremoto' | 'eventEclipse' | 'eventMercado' | 'eventCosecha' | 'eventTregua' | 'thunder'
  // Turn and game
  | 'yourTurn' | 'theirTurn' | 'tick' | 'tickUrgent' | 'timeUp' | 'victory' | 'defeat';

export interface Recipe {
  len: number;
  /** Peak level the render is normalized to (scaled cues keep their own dynamics). */
  level?: number;
  verb?: number;
  vary?: number;
  scaled?: boolean;
  fn: (s: Synth, k: number) => void;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A block of stone set down: thump, gravel and grit. */
function stoneThud(s: Synth, delay: number, k: number): void {
  s.thump(110 + Math.random() * 20, 160 + k * 120, { gain: 0.32 + k * 0.25, drop: 0.55, delay });
  s.noise(110 + k * 90, { color: 'brown', gain: 0.35 + k * 0.2, delay, filter: { freq: 500 + k * 300, to: 180 } });
  s.noise(45, { color: 'pink', gain: 0.07 + k * 0.05, delay, filter: { type: 'bandpass', freq: 2200, q: 1.2 } });
}

/** Little stones bouncing after an impact. */
function debris(s: Synth, from: number, span: number, n: number, gain: number): void {
  for (let i = 0; i < n; i++) {
    const at = from + (span * (i + Math.random())) / n;
    const fade = 1 - i / (n + 2);
    s.noise(14 + Math.random() * 30, {
      color: 'pink',
      gain: gain * fade * (0.5 + Math.random() * 0.6),
      delay: at,
      filter: { type: 'bandpass', freq: 1300 + Math.random() * 2800, q: 2.5 },
    });
  }
}

/** Air moving: a filtered noise sweep. */
function whoosh(s: Synth, ms: number, from: number, to: number, gain: number, delay = 0, pan = 0): void {
  s.noise(ms, { color: 'pink', gain, delay, shape: 'swell', filter: { type: 'bandpass', freq: from, to, q: 1.1 }, pan });
}

/** A glassy bell (two-operator FM). */
function bell(s: Synth, midi: number, ms: number, gain: number, delay = 0, ratio = 3.5, index = 2): void {
  s.fm(mtof(midi), ms, { ratio, index, indexTo: 0.1, gain, delay });
  s.tone(mtof(midi) * 2, ms * 0.5, { gain: gain * 0.25, delay });
}

/** A short brass stab or horn note (filtered saws with a bright attack). */
function horn(s: Synth, midi: number, ms: number, gain: number, delay = 0, bright = 1): void {
  const f = mtof(midi);
  for (const detune of [-7, 6]) {
    s.tone(f, ms, {
      type: 'sawtooth',
      gain: gain * 0.5,
      delay,
      attack: 30,
      shape: 'hold',
      release: Math.min(260, ms * 0.4),
      detune,
      vibrato: { depth: 9, rate: 5.2, delay: 220 },
      filter: { type: 'lowpass', freq: 500 * bright + f, to: 1400 * bright + f * 2, q: 0.9 },
    });
  }
}

/** Sustained string chord (pads under stingers). */
function strings(s: Synth, notes: number[], ms: number, gain: number, delay = 0, bright = 1): void {
  for (const n of notes) {
    for (const detune of [-8, 8]) {
      s.tone(mtof(n), ms, {
        type: 'sawtooth',
        gain: gain * 0.5,
        delay,
        attack: Math.min(400, ms * 0.3),
        shape: 'hold',
        release: Math.min(600, ms * 0.4),
        detune,
        vibrato: { depth: 7, rate: 5, delay: 300 },
        filter: { freq: 900 * bright, q: 0.6 },
      });
    }
  }
}

function crash(s: Synth, ms: number, gain: number, delay = 0): void {
  s.noise(ms, { color: 'white', gain, delay, filter: { type: 'highpass', freq: 4500 }, filter2: { type: 'peaking', freq: 7000, q: 1, gain: 4 } });
  s.noise(ms * 0.5, { color: 'white', gain: gain * 0.6, delay, filter: { type: 'bandpass', freq: 3200, q: 0.8 } });
}

function crackle(s: Synth, from: number, span: number, n: number, gain: number): void {
  for (let i = 0; i < n; i++) {
    s.noise(3 + Math.random() * 9, { color: 'white', gain: gain * (0.3 + Math.random()), delay: from + Math.random() * span, filter: { type: 'highpass', freq: 2500 + Math.random() * 3000 } });
  }
}

function sparkle(s: Synth, from: number, span: number, n: number, gain: number, lo = 84, hi = 100): void {
  const scale = [0, 2, 3, 5, 7, 9, 10];
  for (let i = 0; i < n; i++) {
    const deg = Math.floor(Math.random() * 14);
    const midi = Math.min(hi, lo + Math.floor(deg / 7) * 12 + scale[deg % 7]);
    s.fm(mtof(midi), 260 + Math.random() * 300, { ratio: 2.01, index: 1, gain: gain * (0.5 + Math.random() * 0.5), delay: from + (span * i) / n + Math.random() * 20 });
  }
}

function boom(s: Synth, freq: number, ms: number, gain: number, delay = 0): void {
  s.tone(freq, ms, { gain, to: freq * 0.5, delay, attack: 3 });
  s.noise(ms * 0.8, { color: 'brown', gain: gain * 0.9, delay, filter: { freq: 380, to: 60 } });
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const RECIPES: Record<Cue, Recipe> = {
  // --- Interface -----------------------------------------------------------
  uiHover: {
    len: 0.08,
    level: 0.1,
    vary: 0.04,
    fn: (s) => {
      s.tone(1900, 28, { type: 'triangle', gain: 0.025 });
      s.noise(22, { gain: 0.02, filter: { type: 'highpass', freq: 6000 } });
    },
  },
  uiClick: {
    len: 0.25,
    level: 0.2,
    vary: 0.02,
    fn: (s) => {
      s.thump(420, 40, { gain: 0.12, drop: 0.6 });
      s.fm(1180, 160, { ratio: 2.01, index: 1.1, gain: 0.05, delay: 8 });
      s.noise(18, { gain: 0.05, filter: { type: 'bandpass', freq: 3500, q: 2 } });
    },
  },
  uiBack: {
    len: 0.22,
    level: 0.18,
    vary: 0.02,
    fn: (s) => {
      s.tone(720, 90, { type: 'triangle', gain: 0.06, to: 430 });
      s.noise(16, { gain: 0.04, filter: { type: 'bandpass', freq: 2500, q: 2 } });
    },
  },
  uiOpen: {
    len: 0.4,
    level: 0.16,
    verb: 0.2,
    fn: (s) => {
      whoosh(s, 240, 700, 2600, 0.08);
      s.fm(mtof(81), 260, { ratio: 2, index: 0.8, gain: 0.03, delay: 90 });
    },
  },
  error: {
    len: 0.3,
    level: 0.22,
    fn: (s) => {
      s.tone(196, 90, { type: 'square', gain: 0.07, filter: { freq: 900 } });
      s.tone(156, 120, { type: 'square', gain: 0.07, delay: 100, filter: { freq: 800 } });
    },
  },
  emote: {
    len: 0.35,
    level: 0.2,
    verb: 0.2,
    fn: (s) => {
      s.tone(880, 120, { type: 'triangle', gain: 0.06, to: 1320, glide: 80 });
      bell(s, 93, 220, 0.025, 70, 2);
    },
  },
  notify: {
    len: 0.9,
    level: 0.22,
    verb: 0.3,
    fn: (s) => {
      bell(s, 84, 600, 0.05, 0, 2);
      bell(s, 91, 700, 0.045, 110, 2);
    },
  },

  // --- Cards ---------------------------------------------------------------
  cardHover: {
    len: 0.07,
    level: 0.08,
    vary: 0.08,
    fn: (s) => s.noise(45, { gain: 0.035, filter: { type: 'bandpass', freq: 4500, q: 1.2 } }),
  },
  cardDraw: {
    len: 0.24,
    level: 0.2,
    vary: 0.08,
    fn: (s) => {
      s.noise(150, { color: 'pink', gain: 0.13, shape: 'swell', filter: { type: 'bandpass', freq: 1500, to: 4200, q: 0.9 } });
      s.noise(25, { gain: 0.05, delay: 125, filter: { type: 'highpass', freq: 6000 } });
    },
  },
  cardSelect: {
    len: 0.12,
    level: 0.16,
    vary: 0.05,
    fn: (s) => {
      s.noise(70, { gain: 0.08, filter: { type: 'bandpass', freq: 2500, to: 5000, q: 1 } });
      s.tone(1320, 60, { gain: 0.015 });
    },
  },
  cardDiscard: {
    len: 0.35,
    level: 0.22,
    vary: 0.06,
    fn: (s) => {
      s.noise(220, { color: 'pink', gain: 0.13, shape: 'swell', filter: { type: 'bandpass', freq: 3000, to: 700, q: 0.9 } });
      s.thump(180, 80, { gain: 0.07, delay: 200 });
    },
  },
  shuffle: {
    len: 0.6,
    level: 0.2,
    fn: (s) => {
      for (let i = 0; i < 16; i++) {
        s.noise(10 + Math.random() * 8, { gain: 0.05 + Math.random() * 0.03, delay: i * 27 + Math.random() * 8, filter: { type: 'bandpass', freq: 2800 + Math.random() * 1600, q: 1.6 } });
      }
      s.noise(120, { color: 'pink', gain: 0.06, delay: 440, filter: { type: 'bandpass', freq: 1200, q: 1 } });
    },
  },
  cardPlay: {
    len: 0.45,
    level: 0.3,
    verb: 0.15,
    vary: 0.04,
    fn: (s) => {
      whoosh(s, 320, 450, 3200, 0.2);
      s.tone(110, 260, { gain: 0.05, to: 220 });
    },
  },
  playConstruccion: {
    len: 1.1,
    level: 0.45,
    verb: 0.25,
    vary: 0.02,
    fn: (s) => {
      // Mallet on chisel: two strikes and the ring of the iron.
      s.thump(150, 120, { gain: 0.3, drop: 0.6, click: 0.08 });
      s.noise(60, { color: 'pink', gain: 0.12, filter: { type: 'bandpass', freq: 1800, q: 1.4 } });
      s.fm(mtof(84), 600, { ratio: 2.76, index: 2.2, indexTo: 0.05, gain: 0.05 });
      s.thump(160, 100, { gain: 0.18, drop: 0.6, delay: 150 });
      s.fm(mtof(84), 500, { ratio: 2.76, index: 1.5, indexTo: 0.05, gain: 0.03, delay: 150 });
      s.noise(260, { color: 'brown', gain: 0.12, delay: 20, filter: { freq: 600 } });
    },
  },
  playAsalto: {
    len: 1,
    level: 0.5,
    verb: 0.3,
    vary: 0.01,
    fn: (s) => {
      // Blade drawn, a war drum and a short horn stab.
      s.noise(280, { gain: 0.08, shape: 'swell', filter: { type: 'bandpass', freq: 3500, to: 7500, q: 2 } });
      s.fm(mtof(91), 500, { ratio: 1.41, index: 2.5, indexTo: 0.1, gain: 0.03, delay: 240 });
      s.thump(72, 360, { gain: 0.45, drop: 0.55, delay: 60, click: 0.06 });
      horn(s, 50, 380, 0.07, 90, 1.1);
      horn(s, 57, 380, 0.05, 90, 1.1);
    },
  },
  playArcano: {
    len: 1.1,
    level: 0.38,
    verb: 0.45,
    fn: (s) => {
      [74, 78, 81, 85, 88].forEach((m, i) => s.fm(mtof(m), 520, { ratio: 2, index: 1.2, indexTo: 0.05, gain: 0.04, delay: i * 45 }));
      s.noise(450, { gain: 0.04, shape: 'swell', filter: { type: 'highpass', freq: 5000 } });
      s.tone(98, 420, { gain: 0.06, to: 196 });
    },
  },
  rarityRara: {
    len: 1.1,
    level: 0.3,
    verb: 0.4,
    fn: (s) => {
      bell(s, 91, 900, 0.04, 0, 3);
      bell(s, 96, 900, 0.03, 70, 3);
    },
  },
  rarityEpica: {
    len: 1.5,
    level: 0.38,
    verb: 0.5,
    fn: (s) => {
      // A choir-like swell: saws through two vowel formants.
      for (const n of [62, 69, 74, 77]) {
        for (const formant of [720, 1180]) {
          s.tone(mtof(n), 1100, { type: 'sawtooth', gain: 0.02, attack: 350, shape: 'hold', release: 450, detune: Math.random() * 14 - 7, vibrato: { depth: 10, rate: 5.3 }, filter: { type: 'bandpass', freq: formant, q: 5 } });
        }
      }
      sparkle(s, 200, 700, 7, 0.025);
    },
  },
  rarityLegendaria: {
    len: 2.6,
    level: 0.7,
    verb: 0.55,
    fn: (s) => {
      boom(s, 55, 1100, 0.45);
      crash(s, 1400, 0.06, 0);
      strings(s, [50, 57, 62, 66, 69], 1900, 0.05, 0, 1.6);
      horn(s, 62, 1400, 0.05, 40, 1.4);
      horn(s, 66, 1400, 0.04, 40, 1.4);
      horn(s, 69, 1400, 0.04, 40, 1.4);
      sparkle(s, 250, 1200, 12, 0.025, 86, 103);
    },
  },
  combo: {
    len: 0.7,
    level: 0.3,
    verb: 0.35,
    fn: (s) => {
      s.tone(mtof(81), 140, { type: 'triangle', gain: 0.05 });
      s.tone(mtof(88), 300, { type: 'triangle', gain: 0.05, delay: 90 });
      bell(s, 93, 500, 0.03, 160, 2);
    },
  },

  // --- Castle and attacks ----------------------------------------------------
  build: {
    len: 0.8,
    verb: 0.2,
    vary: 0.04,
    scaled: true,
    fn: (s, k) => {
      stoneThud(s, 0, k);
      stoneThud(s, 170, k * 0.7);
      s.fm(mtof(88), 260, { ratio: 2.76, index: 1.4, indexTo: 0.05, gain: 0.025, delay: 260 });
      debris(s, 40, 300, 4, 0.04);
    },
  },
  buildBig: {
    len: 1.4,
    level: 0.7,
    verb: 0.3,
    vary: 0.02,
    fn: (s) => {
      s.noise(650, { color: 'brown', gain: 0.25, shape: 'swell', filter: { freq: 200, to: 900 } });
      stoneThud(s, 0, 0.8);
      stoneThud(s, 180, 0.7);
      stoneThud(s, 360, 0.9);
      bell(s, 74, 700, 0.03, 420, 2);
      bell(s, 81, 700, 0.025, 470, 2);
    },
  },
  launch: {
    len: 0.7,
    level: 0.4,
    verb: 0.15,
    vary: 0.06,
    fn: (s) => {
      // Catapult: rope creak, the arm hitting its stop, the stone flying off.
      s.noise(180, { color: 'pink', gain: 0.06, filter: { type: 'bandpass', freq: 320, to: 420, q: 6 } });
      s.thump(210, 70, { gain: 0.22, drop: 0.7, delay: 150, click: 0.05 });
      whoosh(s, 420, 380, 1700, 0.14, 160);
    },
  },
  launchArcane: {
    len: 0.6,
    level: 0.35,
    verb: 0.35,
    vary: 0.03,
    fn: (s) => {
      s.tone(220, 300, { type: 'sawtooth', gain: 0.06, to: 880, filter: { type: 'bandpass', freq: 400, to: 3200, q: 3 } });
      s.tone(1760, 220, { gain: 0.025, to: 3520 });
      s.noise(300, { gain: 0.05, shape: 'swell', filter: { type: 'highpass', freq: 4000 } });
    },
  },
  hit: {
    len: 1.2,
    verb: 0.2,
    vary: 0.06,
    scaled: true,
    fn: (s, k) => {
      s.thump(85, 300 + k * 260, { gain: 0.45 + k * 0.3, drop: 0.5 });
      s.noise(380 + k * 400, { color: 'brown', gain: 0.38 + k * 0.3, filter: { freq: 900 + k * 500, to: 160 } });
      s.noise(40, { gain: 0.1 + k * 0.1, filter: { type: 'highpass', freq: 2500 } });
      debris(s, 60, 400 + k * 450, 5 + Math.round(k * 9), 0.06);
    },
  },
  hitBig: {
    len: 2.2,
    level: 0.95,
    verb: 0.3,
    vary: 0.04,
    fn: (s) => {
      boom(s, 48, 1300, 0.6);
      s.thump(90, 600, { gain: 0.6, drop: 0.45, click: 0.15 });
      s.noise(900, { color: 'brown', gain: 0.6, filter: { freq: 1500, to: 120 } });
      s.noise(60, { gain: 0.2, filter: { type: 'highpass', freq: 2000 } });
      debris(s, 80, 1400, 18, 0.07);
      s.noise(1200, { color: 'brown', gain: 0.25, delay: 300, shape: 'swell', filter: { freq: 160 } });
    },
  },
  pierce: {
    len: 1,
    level: 0.6,
    verb: 0.35,
    vary: 0.04,
    fn: (s) => {
      s.tone(1500, 180, { type: 'sawtooth', gain: 0.07, to: 180, filter: { type: 'bandpass', freq: 2500, to: 500, q: 2 } });
      s.noise(160, { gain: 0.12, filter: { type: 'bandpass', freq: 5000, to: 900, q: 1.2 } });
      for (let i = 0; i < 7; i++) s.fm(2400 + Math.random() * 3000, 200 + Math.random() * 300, { ratio: 2.4, index: 1.5, gain: 0.02, delay: 30 + i * 22 });
      s.thump(120, 260, { gain: 0.25, drop: 0.5, delay: 20 });
    },
  },
  blocked: {
    len: 1.1,
    level: 0.5,
    verb: 0.4,
    fn: (s) => {
      s.fm(1250, 800, { ratio: 1.5, index: 1.6, indexTo: 0.05, gain: 0.07 });
      s.fm(1875, 600, { ratio: 1.5, index: 1, indexTo: 0.05, gain: 0.04, delay: 10 });
      s.tone(625, 700, { gain: 0.04, attack: 10, vibrato: { depth: 20, rate: 9, delay: 50 } });
      s.noise(60, { gain: 0.1, filter: { type: 'highpass', freq: 5000 } });
      s.thump(140, 120, { gain: 0.12 });
    },
  },
  crumble: {
    len: 1.3,
    level: 0.55,
    verb: 0.2,
    vary: 0.05,
    fn: (s) => {
      s.noise(950, { color: 'brown', gain: 0.35, filter: { freq: 700, to: 140 } });
      debris(s, 30, 900, 12, 0.06);
      s.thump(70, 400, { gain: 0.25 });
    },
  },
  keepFall: {
    len: 3,
    level: 0.95,
    verb: 0.35,
    fn: (s) => {
      boom(s, 40, 1800, 0.65);
      s.noise(2400, { color: 'brown', gain: 0.5, filter: { freq: 900, to: 90 } });
      debris(s, 100, 2200, 26, 0.07);
      stoneThud(s, 400, 1);
      stoneThud(s, 900, 0.8);
      stoneThud(s, 1300, 0.6);
    },
  },
  wallSwap: {
    len: 1.2,
    level: 0.4,
    verb: 0.45,
    fn: (s) => {
      whoosh(s, 700, 400, 2600, 0.1, 0, -0.7);
      whoosh(s, 700, 2600, 400, 0.1, 0, 0.7);
      [74, 77, 81, 86].forEach((m, i) => s.fm(mtof(m), 500, { ratio: 2, index: 1, gain: 0.03, delay: 300 + i * 70 }));
    },
  },

  // --- Statuses and economy ----------------------------------------------------
  burn: {
    len: 1.2,
    level: 0.4,
    verb: 0.15,
    vary: 0.05,
    fn: (s) => {
      s.noise(300, { color: 'pink', gain: 0.18, shape: 'swell', filter: { type: 'bandpass', freq: 500, to: 1800, q: 0.8 } });
      s.noise(900, { color: 'brown', gain: 0.22, delay: 120, filter: { freq: 450 } });
      crackle(s, 120, 900, 16, 0.1);
    },
  },
  frost: {
    len: 1.1,
    level: 0.35,
    verb: 0.45,
    vary: 0.02,
    fn: (s) => {
      for (let i = 0; i < 9; i++) s.fm(2000 + Math.random() * 2800, 260, { ratio: 2.4, index: 1.4, gain: 0.025, delay: i * 32 });
      s.noise(50, { gain: 0.1, filter: { type: 'highpass', freq: 4000 } });
      s.noise(750, { gain: 0.05, shape: 'swell', filter: { type: 'bandpass', freq: 3000, q: 1.5 } });
    },
  },
  shield: {
    len: 1.3,
    level: 0.4,
    verb: 0.45,
    fn: (s) => {
      s.tone(262, 900, { gain: 0.06, attack: 90, shape: 'hold', release: 400, vibrato: { depth: 6, rate: 6 } });
      s.tone(392, 900, { gain: 0.045, attack: 120, shape: 'hold', release: 400 });
      bell(s, 84, 900, 0.035, 60, 2);
      s.noise(500, { gain: 0.04, shape: 'swell', filter: { type: 'highpass', freq: 3500 } });
    },
  },
  cleanse: {
    len: 1.2,
    level: 0.35,
    verb: 0.5,
    fn: (s) => {
      [72, 76, 79, 84, 88].forEach((m, i) => bell(s, m, 700, 0.03, i * 60, 2, 1));
      s.noise(700, { gain: 0.04, shape: 'swell', filter: { type: 'highpass', freq: 3000 } });
    },
  },
  enchant: {
    len: 1,
    level: 0.32,
    verb: 0.5,
    fn: (s) => {
      [74, 77, 81, 84, 86].forEach((m, i) => s.fm(mtof(m), 480, { ratio: 2, index: 1.3, indexTo: 0.05, gain: 0.035, delay: i * 50 }));
      s.tone(147, 600, { gain: 0.04, attack: 120 });
    },
  },
  drawbridge: {
    len: 0.9,
    level: 0.45,
    verb: 0.2,
    fn: (s) => {
      for (let i = 0; i < 11; i++) s.fm(900 + Math.random() * 500, 60, { ratio: 1.41, index: 2, gain: 0.03, delay: i * 40 });
      s.thump(110, 300, { gain: 0.35, delay: 500, click: 0.08 });
      s.noise(200, { color: 'brown', gain: 0.18, delay: 500, filter: { freq: 500 } });
    },
  },
  reveal: {
    len: 0.9,
    level: 0.3,
    verb: 0.5,
    fn: (s) => {
      s.noise(600, { gain: 0.06, shape: 'swell', filter: { type: 'bandpass', freq: 1200, q: 6 } });
      s.tone(880, 650, { gain: 0.025, attack: 120, vibrato: { depth: 30, rate: 7, delay: 0 } });
      s.tone(1318, 650, { gain: 0.015, attack: 160 });
    },
  },
  extraTurn: {
    len: 1.2,
    level: 0.35,
    verb: 0.45,
    fn: (s) => {
      s.noise(500, { gain: 0.05, shape: 'swell', filter: { type: 'bandpass', freq: 2000, to: 6000, q: 1 } });
      bell(s, 86, 800, 0.05, 450, 2);
      bell(s, 93, 800, 0.04, 560, 2);
    },
  },
  resource: {
    len: 0.35,
    level: 0.16,
    verb: 0.2,
    vary: 0.03,
    fn: (s) => {
      s.fm(2093, 180, { ratio: 1.41, index: 1.2, gain: 0.04 });
      s.fm(2637, 160, { ratio: 1.41, index: 1, gain: 0.025, delay: 55 });
    },
  },
  resourceLoss: {
    len: 0.3,
    level: 0.14,
    vary: 0.03,
    fn: (s) => s.tone(660, 160, { type: 'triangle', gain: 0.04, to: 420 }),
  },
  worker: {
    len: 0.45,
    level: 0.22,
    verb: 0.15,
    vary: 0.03,
    fn: (s) => {
      s.thump(420, 45, { gain: 0.12 });
      s.fm(mtof(88), 160, { ratio: 2.76, index: 1, gain: 0.025 });
      s.thump(460, 45, { gain: 0.12, delay: 120 });
      s.fm(mtof(91), 220, { ratio: 2.76, index: 1, gain: 0.03, delay: 120 });
    },
  },
  workerLoss: {
    len: 0.45,
    level: 0.18,
    vary: 0.03,
    fn: (s) => {
      s.tone(392, 120, { type: 'triangle', gain: 0.05 });
      s.tone(294, 200, { type: 'triangle', gain: 0.05, delay: 110 });
    },
  },

  // --- Heroes --------------------------------------------------------------------
  ultimateReady: {
    len: 1.4,
    level: 0.35,
    verb: 0.5,
    fn: (s) => {
      [62, 69, 74, 78].forEach((m, i) => s.tone(mtof(m), 900, { type: 'triangle', gain: 0.03, attack: 200, delay: i * 90, shape: 'hold', release: 300 }));
      bell(s, 90, 700, 0.04, 450, 2);
      sparkle(s, 300, 500, 5, 0.02, 88, 100);
    },
  },
  ultimate: {
    len: 2.6,
    level: 0.85,
    verb: 0.5,
    fn: (s) => {
      s.noise(900, { color: 'pink', gain: 0.18, shape: 'swell', filter: { type: 'bandpass', freq: 200, to: 4200, q: 1 } });
      boom(s, 50, 1400, 0.55, 820);
      crash(s, 1500, 0.08, 820);
      strings(s, [50, 57, 62, 65, 69], 1700, 0.045, 0, 1.4);
    },
  },
  ultArquitecta: {
    len: 1.8,
    level: 0.6,
    verb: 0.35,
    fn: (s) => {
      s.noise(800, { color: 'brown', gain: 0.25, shape: 'swell', filter: { freq: 150, to: 700 } });
      stoneThud(s, 820, 1);
      stoneThud(s, 1000, 0.8);
      s.fm(mtof(81), 900, { ratio: 2.76, index: 2.5, indexTo: 0.05, gain: 0.05, delay: 830 });
    },
  },
  ultMariscal: {
    len: 2.2,
    level: 0.6,
    verb: 0.5,
    fn: (s) => {
      // A war horn, a fifth on top, and drums.
      for (const detune of [-6, 6]) {
        s.tone(mtof(45), 1500, { type: 'sawtooth', gain: 0.05, to: mtof(50), glide: 180, attack: 60, shape: 'hold', release: 400, detune, vibrato: { depth: 10, rate: 5, delay: 400 }, filter: { freq: 700, to: 1300, q: 1 } });
      }
      horn(s, 57, 1200, 0.05, 300, 1.2);
      s.thump(68, 400, { gain: 0.4, delay: 820 });
      s.thump(68, 400, { gain: 0.35, delay: 1020 });
    },
  },
  ultHechicera: {
    len: 2,
    level: 0.55,
    verb: 0.6,
    fn: (s) => {
      const notes = [98, 93, 89, 86, 81, 77, 74, 69, 65, 62];
      notes.forEach((m, i) => s.fm(mtof(m), 600, { ratio: 2, index: 1.6, indexTo: 0.05, gain: 0.03, delay: i * 70 }));
      s.noise(900, { gain: 0.06, shape: 'swell', filter: { type: 'bandpass', freq: 6000, to: 1200, q: 1.2 } });
    },
  },
  ultAlquimista: {
    len: 1.8,
    level: 0.5,
    verb: 0.35,
    fn: (s) => {
      for (let i = 0; i < 16; i++) {
        const f = 280 + Math.random() * 700;
        s.tone(f, 40, { gain: 0.04, to: f * 1.8, delay: i * 50 + Math.random() * 30 });
      }
      s.noise(900, { gain: 0.04, shape: 'swell', filter: { type: 'highpass', freq: 6000 } });
      s.fm(2637, 600, { ratio: 1.41, index: 2, gain: 0.04, delay: 850 });
      s.fm(3520, 500, { ratio: 1.41, index: 2, gain: 0.03, delay: 900 });
    },
  },
  ultSaboteadora: {
    len: 2.2,
    level: 0.7,
    verb: 0.3,
    fn: (s) => {
      s.noise(780, { gain: 0.07, shape: 'hold', release: 30, filter: { type: 'bandpass', freq: 5000, q: 2 } });
      crackle(s, 0, 760, 18, 0.05);
      boom(s, 55, 1300, 0.6, 800);
      s.noise(1000, { color: 'brown', gain: 0.45, delay: 800, filter: { freq: 2000, to: 150 } });
      debris(s, 900, 1000, 12, 0.06);
    },
  },
  ultGuardian: {
    len: 3,
    level: 0.55,
    verb: 0.6,
    fn: (s) => {
      s.fm(98, 2800, { ratio: 1.4, index: 4, indexTo: 0.2, gain: 0.16 });
      s.fm(196, 2200, { ratio: 2.76, index: 2, indexTo: 0.1, gain: 0.06 });
      s.tone(196, 2400, { gain: 0.05, attack: 400, shape: 'hold', release: 900 });
    },
  },

  // --- Battle events -----------------------------------------------------------------
  event: {
    len: 2.4,
    level: 0.6,
    verb: 0.5,
    fn: (s) => {
      s.fm(110, 2300, { ratio: 1.414, index: 3, indexTo: 0.1, gain: 0.16 });
      s.thump(60, 500, { gain: 0.4 });
    },
  },
  eventTormenta: {
    len: 3,
    level: 0.8,
    verb: 0.4,
    fn: (s) => {
      s.noise(90, { gain: 0.3, filter: { type: 'highpass', freq: 1800 } });
      s.noise(2700, { color: 'brown', gain: 0.7, filter: { freq: 1400, to: 70 } });
      s.noise(1300, { color: 'brown', gain: 0.4, delay: 600, filter: { freq: 500, to: 80 } });
      s.noise(2400, { color: 'pink', gain: 0.06, delay: 300, shape: 'swell', filter: { type: 'highpass', freq: 2500 } });
    },
  },
  thunder: {
    len: 2.4,
    level: 0.55,
    verb: 0.4,
    vary: 0.12,
    fn: (s) => {
      s.noise(60, { gain: 0.18, filter: { type: 'highpass', freq: 1800 } });
      s.noise(2200, { color: 'brown', gain: 0.45, filter: { freq: 1000, to: 60 } });
    },
  },
  eventTerremoto: {
    len: 3,
    level: 0.7,
    verb: 0.2,
    fn: (s) => {
      s.noise(2800, { color: 'brown', gain: 0.9, shape: 'swell', filter: { freq: 130 } });
      s.tone(34, 2600, { gain: 0.35, attack: 300, shape: 'hold', release: 800, vibrato: { depth: 60, rate: 7, delay: 0 } });
      debris(s, 300, 2300, 22, 0.06);
    },
  },
  eventEclipse: {
    len: 3,
    level: 0.5,
    verb: 0.6,
    fn: (s) => {
      s.tone(147, 2700, { gain: 0.07, attack: 900, shape: 'hold', release: 1000 });
      s.tone(155.6, 2700, { gain: 0.06, attack: 900, shape: 'hold', release: 1000 });
      s.tone(1175, 2400, { gain: 0.012, attack: 1400, shape: 'swell', vibrato: { depth: 25, rate: 3, delay: 0 } });
      s.fm(73, 2800, { ratio: 1.414, index: 3, indexTo: 0.1, gain: 0.1 });
    },
  },
  eventMercado: {
    len: 2,
    level: 0.45,
    verb: 0.35,
    fn: (s) => {
      for (let i = 0; i < 12; i++) s.fm(3000 + Math.random() * 3000, 120 + Math.random() * 120, { ratio: 1.41, index: 2.2, gain: 0.025, delay: Math.random() * 600 });
      [79, 83, 86, 91].forEach((m, i) => bell(s, m, 700, 0.04, 400 + i * 160, 2));
      s.noise(1600, { color: 'pink', gain: 0.03, shape: 'swell', filter: { type: 'bandpass', freq: 500, q: 1.5 } });
    },
  },
  eventCosecha: {
    len: 2.4,
    level: 0.45,
    verb: 0.45,
    fn: (s) => {
      s.noise(2000, { color: 'pink', gain: 0.05, shape: 'swell', filter: { type: 'bandpass', freq: 500, to: 900, q: 1 } });
      [67, 69, 74, 76, 79].forEach((m, i) => s.tone(mtof(m), 600, { type: 'triangle', gain: 0.04, delay: 300 + i * 150 }));
      s.thump(90, 300, { gain: 0.25, delay: 300 });
    },
  },
  eventTregua: {
    len: 3,
    level: 0.4,
    verb: 0.65,
    fn: (s) => {
      [86, 81, 79, 74].forEach((m, i) => bell(s, m, 1200, 0.04, i * 380, 2, 1.2));
      s.noise(2600, { gain: 0.035, shape: 'swell', filter: { type: 'highpass', freq: 3000 } });
    },
  },

  // --- Turn and game -----------------------------------------------------------------
  yourTurn: {
    len: 1.1,
    level: 0.32,
    verb: 0.45,
    fn: (s) => {
      horn(s, 62, 200, 0.045, 0, 1.2);
      horn(s, 69, 520, 0.05, 190, 1.2);
      bell(s, 86, 700, 0.025, 190, 2);
    },
  },
  theirTurn: {
    len: 0.9,
    level: 0.2,
    verb: 0.4,
    fn: (s) => s.fm(294, 800, { ratio: 2, index: 1.4, indexTo: 0.05, gain: 0.04 }),
  },
  tick: {
    len: 0.08,
    level: 0.2,
    fn: (s) => {
      s.noise(14, { gain: 0.12, filter: { type: 'bandpass', freq: 3000, q: 3 } });
      s.tone(1600, 12, { type: 'square', gain: 0.015 });
    },
  },
  tickUrgent: {
    len: 0.2,
    level: 0.26,
    fn: (s) => {
      s.noise(14, { gain: 0.14, filter: { type: 'bandpass', freq: 3400, q: 3 } });
      s.tone(2093, 60, { type: 'triangle', gain: 0.04 });
      s.tone(2093, 60, { type: 'triangle', gain: 0.03, delay: 90 });
    },
  },
  timeUp: {
    len: 1.2,
    level: 0.4,
    verb: 0.35,
    fn: (s) => {
      s.fm(147, 1000, { ratio: 1.414, index: 2.5, indexTo: 0.1, gain: 0.12 });
      s.tone(110, 400, { type: 'square', gain: 0.03, filter: { freq: 600 } });
    },
  },
  victory: {
    len: 2.4,
    level: 0.55,
    verb: 0.45,
    fn: (s) => {
      // Fireworks over the castle.
      for (let i = 0; i < 4; i++) {
        const at = i * 420 + Math.random() * 100;
        s.thump(160, 120, { gain: 0.18, delay: at });
        crackle(s, at + 60, 500, 14, 0.06);
        s.noise(400, { gain: 0.05, delay: at, filter: { type: 'highpass', freq: 3000 } });
      }
      sparkle(s, 200, 1600, 10, 0.02, 86, 103);
    },
  },
  defeat: {
    len: 3,
    level: 0.6,
    verb: 0.5,
    fn: (s) => {
      s.noise(2000, { color: 'brown', gain: 0.4, filter: { freq: 600, to: 80 } });
      debris(s, 100, 1500, 14, 0.05);
      s.fm(73, 2800, { ratio: 1.414, index: 3, indexTo: 0.1, gain: 0.14, delay: 300 });
    },
  },
};

/** Cues worth rendering ahead of time, most urgent first. */
export const WARM_ORDER: Cue[] = [
  'uiClick', 'uiHover', 'uiBack', 'cardHover', 'cardSelect', 'cardDraw', 'cardPlay', 'cardDiscard',
  'yourTurn', 'theirTurn', 'resource', 'build', 'launch', 'hit', 'playConstruccion', 'playAsalto', 'playArcano',
  'tick', 'tickUrgent', 'worker', 'enchant', 'burn', 'frost', 'shield', 'blocked', 'pierce', 'launchArcane',
  'hitBig', 'rarityRara', 'rarityEpica', 'rarityLegendaria', 'combo', 'ultimateReady', 'error', 'uiOpen',
];
