import type { Instruments } from './instruments';

/**
 * The score. Four original pieces in D, written as chord progressions plus
 * parts that decide what to play on each sixteenth note. The battle piece
 * has a tension layer that the board fades in as a Keep nears its end.
 */

export interface Chord {
  /** Root as a MIDI note in the third octave (D3 = 50). */
  root: number;
  /** Chord tones in semitones above the root. */
  tones: number[];
}

export interface StepCtx {
  t: number;
  /** Sixteenth within the bar, 0..15. */
  step: number;
  /** Bar within the intro or the loop. */
  bar: number;
  /** How many times the loop has played (0 during the intro). */
  cycle: number;
  intro: boolean;
  chord: Chord;
  stepDur: number;
  barDur: number;
  i: Instruments;
  /** Always-on layer and the tension layer (faded by the game). */
  main: AudioNode;
  tension: AudioNode;
  rand: () => number;
}

export interface Song {
  bpm: number;
  /** Tempo at full tension. */
  bpmTension?: number;
  /** Played once before the loop (stingers). */
  intro?: Chord[];
  loop: Chord[];
  /** Loop variations before the piece repeats itself exactly. */
  cycles: number;
  parts: ((c: StepCtx) => void)[];
  /** Fade-in in seconds (0 for stingers that must hit at once). */
  fadeIn: number;
  /** Overall loudness of the piece. */
  level: number;
}

const MIN = [0, 3, 7];
const MAJ = [0, 4, 7];
const MAJ7 = [0, 4, 7, 11];

const D = (tones = MIN): Chord => ({ root: 50, tones });
const C = (tones = MAJ): Chord => ({ root: 48, tones });
const Bb = (tones = MAJ): Chord => ({ root: 46, tones });
const F = (tones = MAJ): Chord => ({ root: 53, tones });
const G = (tones = MAJ): Chord => ({ root: 55, tones });
const A = (tones = MAJ): Chord => ({ root: 57, tones });
const B = (tones = MIN): Chord => ({ root: 47, tones });
const E = (tones = MIN): Chord => ({ root: 52, tones });

/** Chord tones between `lo` and `hi` (MIDI), ascending. */
export function tonesIn(chord: Chord, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) {
    const rel = (((n - chord.root) % 12) + 12) % 12;
    if (chord.tones.includes(rel)) out.push(n);
  }
  return out;
}

/** The root in the second octave (C2..B2) for bass lines. */
const bassNote = (chord: Chord): number => 36 + (((chord.root % 12) + 12) % 12);

type Melody = [step: number, steps: number, midi: number][][];

function playMelody(c: StepCtx, melody: Melody, play: (midi: number, dur: number) => void, transpose = 0): void {
  for (const [step, steps, midi] of melody[c.bar % melody.length]) {
    if (step === c.step) play(midi + transpose, steps * c.stepDur * 0.92);
  }
}

// ---------------------------------------------------------------------------
// Menu: "Banners at dawn". Calm, D dorian, harp and strings, a flute tune.
// ---------------------------------------------------------------------------

const MENU_MELODY: Melody = [
  [[0, 6, 69], [6, 2, 67], [8, 4, 65], [12, 4, 62]],
  [[0, 4, 64], [4, 4, 67], [8, 6, 72], [14, 2, 71]],
  [[0, 8, 69], [8, 4, 65], [12, 4, 62]],
  [[0, 4, 64], [4, 2, 65], [6, 2, 67], [8, 8, 64]],
  [[0, 6, 74], [6, 2, 72], [8, 4, 69], [12, 4, 65]],
  [[0, 4, 69], [4, 4, 72], [8, 6, 77], [14, 2, 76]],
  [[0, 4, 74], [4, 4, 71], [8, 4, 67], [12, 4, 69]],
  [[0, 4, 69], [4, 4, 73], [8, 8, 76]],
];

const ARP = [0, 1, 2, 3, 4, 3, 2, 1];

export const MENU: Song = {
  bpm: 72,
  loop: [D(), C(), Bb(MAJ7), C(), D(), F(), G(), A()],
  cycles: 4,
  fadeIn: 2.5,
  level: 1.5,
  parts: [
    // Strings pad and cello.
    (c) => {
      if (c.step !== 0) return;
      for (const n of tonesIn(c.chord, 57, 72)) c.i.strings(c.main, c.t, n, c.barDur, 0.32, { attack: 0.9, release: 1.4, bright: 0.45 });
      c.i.strings(c.main, c.t, bassNote(c.chord), c.barDur * 0.95, 0.42, { attack: 0.3, release: 1, bright: 0.35 });
    },
    // Harp.
    (c) => {
      const notes = tonesIn(c.chord, 62, 84);
      if (c.cycle === 2) {
        if (c.step % 4 === 0) c.i.pluck(c.main, c.t, notes[[0, 2, 4, 2][c.step / 4]] ?? notes[0], 0.5, -0.3);
        return;
      }
      if (c.step % 2 !== 0) return;
      const idx = ARP[c.step / 2];
      const vel = (c.cycle % 2 === 1 ? 0.35 : 0.5) + (c.step === 0 ? 0.15 : 0) + c.rand() * 0.08;
      c.i.pluck(c.main, c.t, notes[idx] ?? notes[0], vel, -0.3);
    },
    // Frame drum.
    (c) => {
      if (c.cycle === 0 && c.bar < 2) return;
      if (c.step === 0) c.i.drum('frame', c.main, c.t, 0.42);
      else if (c.step === 10) c.i.drum('frame', c.main, c.t, 0.18);
      else if (c.step === 12) c.i.drum('frame', c.main, c.t, 0.26);
    },
    // Flute tune on the second and fourth pass.
    (c) => {
      if (c.cycle % 2 !== 1) return;
      playMelody(c, MENU_MELODY, (m, dur) => c.i.flute(c.main, c.t, m, dur, 0.55, 0.2));
    },
    // Bells on the third pass.
    (c) => {
      if (c.cycle !== 2 || c.step !== 0 || c.bar % 2 !== 0) return;
      const top = tonesIn(c.chord, 74, 86);
      c.i.bell(c.main, c.t, top[0], 0.5, 2.6, 0.3);
      c.i.bell(c.main, c.t + c.stepDur * 3, top[1] ?? top[0], 0.3, 2.2, 0.35);
    },
  ],
};

// ---------------------------------------------------------------------------
// Battle: "Siege". D minor, string ostinato, taiko, horn theme; tension adds
// shakers, high tremolo, a driving bass and timpani rolls.
// ---------------------------------------------------------------------------

const BATTLE_MELODY: Melody = [
  [[0, 6, 62], [6, 2, 69], [8, 8, 69]],
  [[0, 4, 70], [4, 2, 69], [6, 2, 67], [8, 8, 65]],
  [[0, 6, 72], [6, 2, 69], [8, 4, 65], [12, 4, 69]],
  [[0, 12, 67], [12, 4, 64]],
  [[0, 6, 62], [6, 2, 69], [8, 8, 74]],
  [[0, 4, 74], [4, 2, 72], [6, 2, 70], [8, 8, 77]],
  [[0, 4, 74], [4, 4, 70], [8, 4, 67], [12, 4, 70]],
  [[0, 8, 69], [8, 4, 73], [12, 4, 76]],
];

const OSTINATO = [0, 0, 7, 0, 12, 0, 7, 0];
const TAIKO: Record<number, number> = { 0: 1, 3: 0.35, 6: 0.7, 8: 0.9, 11: 0.35, 14: 0.45 };

export const BATTLE: Song = {
  bpm: 96,
  bpmTension: 112,
  loop: [D(), Bb(), F(), C(), D(), Bb(), G(MIN), A()],
  cycles: 4,
  fadeIn: 1.5,
  level: 1,
  parts: [
    // Low strings ostinato.
    (c) => {
      if (c.step % 2 !== 0) return;
      const k = c.step / 2;
      const accent = k === 0 || k === 3 || k === 6;
      c.i.strings(c.main, c.t, bassNote(c.chord) + 12 + OSTINATO[k], c.stepDur * 1.4, accent ? 0.62 : 0.42, { attack: 0.012, release: 0.14, bright: 1.3, pan: -0.25 });
    },
    // Sustained low pad.
    (c) => {
      if (c.step !== 0) return;
      const b = bassNote(c.chord);
      c.i.strings(c.main, c.t, b, c.barDur, 0.4, { attack: 0.25, release: 0.6, bright: 0.5 });
      c.i.strings(c.main, c.t, b + 7, c.barDur, 0.22, { attack: 0.35, release: 0.6, bright: 0.5 });
    },
    // Taiko.
    (c) => {
      if (c.cycle === 0 && c.bar < 2) {
        if (c.step === 0 || c.step === 8) c.i.drum('taiko', c.main, c.t, 0.7);
        return;
      }
      if ((c.bar === 3 || c.bar === 7) && c.step >= 12) {
        c.i.drum('taiko', c.main, c.t, 0.45 + (c.step - 12) * 0.13, 1.25);
        return;
      }
      const v = TAIKO[c.step];
      if (v) c.i.drum('taiko', c.main, c.t, v * 0.85);
    },
    // Snare.
    (c) => {
      if (c.cycle === 0) return;
      if (c.step === 4 || c.step === 12) c.i.drum('snare', c.main, c.t, 0.3, 1, 0.15);
      else if (c.step === 7 || c.step === 15) c.i.drum('snare', c.main, c.t, 0.1, 1, 0.15);
    },
    // Brass: stabs, then the horn theme.
    (c) => {
      if (c.cycle % 2 === 1) {
        playMelody(c, BATTLE_MELODY, (m, dur) => c.i.brass(c.main, c.t, m, dur, 0.7, 0.15));
        return;
      }
      if (c.step === 0 || c.step === 10) {
        for (const n of tonesIn(c.chord, 55, 67)) c.i.brass(c.main, c.t, n, c.stepDur * 2.2, c.step === 0 ? 0.55 : 0.4, 0.15);
      }
      if (c.cycle === 2) playMelody(c, BATTLE_MELODY, (m, dur) => c.i.strings(c.main, c.t, m + 12, dur, 0.5, { attack: 0.05, release: 0.3, bright: 1.6, pan: 0.25 }));
    },
    // Cymbal at the top of each pass.
    (c) => {
      if (c.cycle > 0 && c.bar === 0 && c.step === 0) c.i.drum('crash', c.main, c.t, 0.45);
    },
    // --- Tension layer ---
    (c) => c.i.drum('shaker', c.tension, c.t, c.step % 4 === 0 ? 0.42 : c.step % 2 === 0 ? 0.3 : 0.2, 1, 0.3),
    (c) => {
      const high = tonesIn(c.chord, 69, 81);
      c.i.strings(c.tension, c.t, high[c.step % 2 === 0 ? 1 : 2] ?? high[0], c.stepDur * 0.9, 0.28, { attack: 0.006, release: 0.05, bright: 1.6, pan: 0.35 });
    },
    (c) => {
      if (c.step % 2 === 0) c.i.bass(c.tension, c.t, bassNote(c.chord), c.stepDur * 1.5, c.step % 8 === 0 ? 0.5 : 0.34);
    },
    (c) => {
      if (c.step === 2 || c.step === 10) c.i.drum('taiko', c.tension, c.t, 0.55, 1.1);
      if (c.bar === 7 && c.step >= 8) c.i.timpani(c.tension, c.t, 45, 0.25 + (c.step - 8) * 0.06);
      if (c.bar === 7 && c.step % 2 === 1 && c.step >= 9) c.i.timpani(c.tension, c.t, 45, 0.2 + (c.step - 8) * 0.05);
    },
  ],
};

// ---------------------------------------------------------------------------
// Victory: a fanfare, then a gentle D major loop.
// ---------------------------------------------------------------------------

const VICTORY_MELODY: Melody = [
  [[0, 6, 74], [6, 2, 76], [8, 8, 78]],
  [[0, 4, 79], [4, 4, 78], [8, 8, 74]],
  [[0, 6, 74], [6, 2, 73], [8, 8, 71]],
  [[0, 4, 69], [4, 4, 73], [8, 8, 76]],
  [[0, 6, 78], [6, 2, 79], [8, 8, 81]],
  [[0, 4, 83], [4, 4, 81], [8, 8, 79]],
  [[0, 4, 79], [4, 4, 78], [8, 8, 76]],
  [[0, 4, 73], [4, 4, 76], [8, 8, 73]],
];

export const VICTORY: Song = {
  bpm: 84,
  intro: [D(MAJ), D(MAJ)],
  loop: [D(MAJ), G(), B(), A(), D(MAJ), G(), E(), A()],
  cycles: 2,
  fadeIn: 0,
  level: 0.9,
  parts: [
    (c) => {
      if (!c.intro) return;
      if (c.bar === 0) {
        if (c.step < 8) c.i.timpani(c.main, c.t, 38, 0.18 + c.step * 0.05);
        const fanfare: Record<number, number> = { 0: 62, 2: 66, 4: 69 };
        if (fanfare[c.step]) {
          c.i.brass(c.main, c.t, fanfare[c.step], c.stepDur * 1.8, 0.75);
          c.i.brass(c.main, c.t, fanfare[c.step] - 12, c.stepDur * 1.8, 0.5);
        }
        if (c.step === 8) {
          c.i.drum('crash', c.main, c.t, 0.6);
          c.i.drum('taiko', c.main, c.t, 0.9);
          for (const n of [62, 66, 69, 74]) c.i.brass(c.main, c.t, n, c.barDur * 1.3, 0.75);
          for (const n of tonesIn(c.chord, 50, 78)) c.i.strings(c.main, c.t, n, c.barDur * 1.4, 0.45, { attack: 0.05, release: 1.4, bright: 1.4 });
        }
      } else {
        const cascade: Record<number, number> = { 0: 86, 2: 81, 4: 78, 6: 74 };
        if (cascade[c.step]) c.i.bell(c.main, c.t, cascade[c.step], 0.5, 2.4, 0.3);
        if (c.step === 0) c.i.timpani(c.main, c.t, 38, 0.35);
      }
    },
    (c) => {
      if (c.intro || c.step !== 0) return;
      for (const n of tonesIn(c.chord, 57, 72)) c.i.strings(c.main, c.t, n, c.barDur, 0.28, { attack: 0.6, release: 1.2, bright: 0.6 });
      c.i.strings(c.main, c.t, bassNote(c.chord), c.barDur * 0.95, 0.38, { attack: 0.2, release: 1, bright: 0.4 });
    },
    (c) => {
      if (c.intro || c.step % 2 !== 0) return;
      const notes = tonesIn(c.chord, 62, 84);
      c.i.pluck(c.main, c.t, notes[ARP[c.step / 2]] ?? notes[0], 0.42 + (c.step === 0 ? 0.15 : 0), -0.3);
    },
    (c) => {
      if (c.intro) return;
      if (c.step === 0) c.i.drum('frame', c.main, c.t, 0.38);
      else if (c.step === 8) c.i.drum('frame', c.main, c.t, 0.22);
    },
    (c) => {
      if (c.intro) return;
      if (c.cycle === 1) playMelody(c, VICTORY_MELODY, (m, dur) => c.i.flute(c.main, c.t, m - 12, dur, 0.55, 0.2));
      else if (c.step === 0 && c.bar % 2 === 0) c.i.bell(c.main, c.t, tonesIn(c.chord, 74, 86)[0], 0.4, 2.4, 0.3);
    },
  ],
};

// ---------------------------------------------------------------------------
// Defeat: a falling line and a gong, then a sparse, cold D minor loop.
// ---------------------------------------------------------------------------

export const DEFEAT: Song = {
  bpm: 60,
  intro: [D(), D()],
  loop: [D(), Bb(), G(MIN), A([0, 5, 7]), D(), Bb(), G(MIN), A()],
  cycles: 2,
  fadeIn: 0,
  level: 1.5,
  parts: [
    (c) => {
      if (!c.intro) return;
      if (c.bar === 0) {
        if (c.step === 0) {
          c.i.drum('gong', c.main, c.t, 0.55);
          c.i.timpani(c.main, c.t, 38, 0.45);
        }
        const line: Record<number, number> = { 0: 62, 4: 60, 8: 58, 12: 57 };
        if (line[c.step]) {
          const dur = c.step === 12 ? c.barDur * 1.2 : c.stepDur * 4;
          c.i.strings(c.main, c.t, line[c.step], dur, 0.5, { attack: 0.15, release: 0.9, bright: 0.6 });
          c.i.strings(c.main, c.t, line[c.step] - 12, dur, 0.4, { attack: 0.15, release: 0.9, bright: 0.5 });
        }
      } else if (c.step === 8) {
        c.i.timpani(c.main, c.t, 38, 0.25);
      }
    },
    (c) => {
      if (c.intro || c.step !== 0) return;
      for (const n of tonesIn(c.chord, 55, 69)) c.i.strings(c.main, c.t, n, c.barDur, 0.26, { attack: 1.2, release: 1.6, bright: 0.3 });
      c.i.strings(c.main, c.t, bassNote(c.chord), c.barDur, 0.34, { attack: 0.6, release: 1.4, bright: 0.25 });
    },
    (c) => {
      if (c.intro || ![0, 6, 12].includes(c.step)) return;
      const notes = tonesIn(c.chord, 62, 81);
      c.i.pluck(c.main, c.t, notes[Math.floor(c.rand() * notes.length)], 0.3, 0.25);
    },
    (c) => {
      if (c.intro) return;
      if (c.step === 0 && c.bar % 4 === 0) c.i.wind(c.main, c.t, c.barDur * 4, 0.5);
      if (c.step === 0 && c.bar % 2 === 0) c.i.timpani(c.main, c.t, 38, 0.18);
      if (c.cycle === 1 && c.bar === 0 && c.step === 0) c.i.bell(c.main, c.t, 74, 0.35, 3, -0.3);
    },
  ],
};
