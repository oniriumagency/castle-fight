import { idle, renderRecipe } from './render';
import { mtof, noiseBuffer, type Synth } from './synth';

/**
 * The orchestra for the procedural score. Sustained instruments (strings,
 * brass, flute, bells, bass) are synthesized live, a handful of oscillators
 * per note. The harp is a Karplus-Strong plucked string and the percussion
 * is rendered once into buffers, so both are just sample playback.
 */

export type Drum = 'taiko' | 'frame' | 'snare' | 'shaker' | 'hat' | 'crash' | 'timpani' | 'gong';

const DRUMS: Record<Drum, { len: number; fn: (s: Synth) => void }> = {
  taiko: {
    len: 0.9,
    fn: (s) => {
      s.tone(64, 800, { gain: 0.9, to: 44, glide: 500, attack: 2 });
      s.tone(128, 160, { gain: 0.2, to: 80, attack: 2 });
      s.noise(200, { color: 'brown', gain: 0.6, filter: { freq: 500, to: 150 } });
      s.noise(30, { color: 'pink', gain: 0.15, filter: { type: 'bandpass', freq: 1200, q: 1 } });
    },
  },
  frame: {
    len: 0.5,
    fn: (s) => {
      s.tone(118, 340, { gain: 0.55, to: 92, glide: 200, attack: 2 });
      s.noise(80, { color: 'pink', gain: 0.18, filter: { type: 'bandpass', freq: 900, q: 1 } });
    },
  },
  snare: {
    len: 0.35,
    fn: (s) => {
      s.tone(196, 110, { gain: 0.3, to: 150, attack: 1 });
      s.noise(200, { gain: 0.32, filter: { type: 'bandpass', freq: 2600, q: 0.7 } });
      s.noise(90, { gain: 0.12, filter: { type: 'highpass', freq: 5500 } });
    },
  },
  shaker: {
    len: 0.12,
    fn: (s) => s.noise(70, { gain: 0.22, attack: 12, filter: { type: 'bandpass', freq: 6500, q: 1.3 } }),
  },
  hat: {
    len: 0.08,
    fn: (s) => s.noise(40, { gain: 0.16, filter: { type: 'highpass', freq: 8000 } }),
  },
  crash: {
    len: 2.2,
    fn: (s) => {
      s.noise(2100, { gain: 0.22, filter: { type: 'highpass', freq: 4200 }, filter2: { type: 'peaking', freq: 7500, q: 1, gain: 5 } });
      s.noise(800, { gain: 0.1, filter: { type: 'bandpass', freq: 3000, q: 0.8 } });
    },
  },
  timpani: {
    // Tuned to D2; played at other pitches through the playback rate.
    len: 1.8,
    fn: (s) => {
      const f = mtof(38);
      s.tone(f, 1700, { gain: 0.7, to: f * 0.985, attack: 3 });
      s.tone(f * 1.5, 1100, { gain: 0.18, attack: 3 });
      s.tone(f * 2, 800, { gain: 0.1, attack: 3 });
      s.noise(90, { color: 'brown', gain: 0.35, filter: { freq: 400 } });
    },
  },
  gong: {
    len: 3,
    fn: (s) => {
      s.fm(mtof(38), 2900, { ratio: 1.414, index: 3, indexTo: 0.15, gain: 0.35 });
      s.fm(mtof(50), 2000, { ratio: 2.76, index: 1.5, indexTo: 0.1, gain: 0.08 });
    },
  },
};

interface PluckSample {
  buffer: AudioBuffer;
  freq: number;
  midi: number;
}

/** A plucked string by Karplus-Strong, tuned exactly by measuring its loop length. */
function karplus(ctx: BaseAudioContext, midi: number, sampleRate: number, seconds: number): PluckSample {
  const target = mtof(midi);
  const period = Math.max(2, Math.round(sampleRate / target - 0.5));
  const freq = sampleRate / (period + 0.5);
  const length = Math.floor(sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const out = buffer.getChannelData(0);
  const line = new Float32Array(period + 1);
  // A soft pluck: noise smoothed by a one-pole filter.
  let lp = 0;
  for (let i = 0; i <= period; i++) {
    lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
    line[i] = lp;
  }
  const t60 = Math.max(1.2, 3.4 - (midi - 43) * 0.035);
  const loss = Math.pow(10, -3 / (t60 * freq));
  let idx = 0;
  let peak = 0;
  for (let n = 0; n < length; n++) {
    const a = line[idx];
    const b = line[(idx + 1) % (period + 1)];
    const y = a;
    line[idx] = loss * 0.5 * (a + b);
    idx = (idx + 1) % (period + 1);
    out[n] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  // Soften the attack click and normalize.
  const attack = Math.floor(sampleRate * 0.002);
  for (let n = 0; n < length; n++) out[n] = (out[n] / (peak || 1)) * (n < attack ? n / attack : 1);
  return { buffer, freq, midi };
}

export class Instruments {
  private drums = new Map<Drum, AudioBuffer>();
  private plucks: PluckSample[] = [];
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  ready = false;

  constructor(private readonly ctx: AudioContext) {
    // One shared vibrato for every sustained note.
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 5.1;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 7;
    this.lfo.connect(this.lfoGain);
    this.lfo.start();
  }

  /** Renders the percussion and harp samples, yielding between each. */
  async prepare(): Promise<void> {
    if (this.ready) return;
    const rate = this.ctx.sampleRate;
    for (const [name, drum] of Object.entries(DRUMS) as [Drum, (typeof DRUMS)[Drum]][]) {
      const buffer = await renderRecipe(drum.len, rate, drum.fn);
      if (buffer) this.drums.set(name, buffer);
      await idle();
    }
    // Harp samples every four semitones; playback rate covers the gaps.
    const pluckRate = Math.max(22050, Math.round(rate / 2));
    for (let midi = 40; midi <= 96; midi += 4) {
      this.plucks.push(karplus(this.ctx, midi, pluckRate, midi < 60 ? 3 : 2.2));
      if (midi % 12 === 0) await idle();
    }
    this.ready = true;
  }

  drum(name: Drum, out: AudioNode, t: number, vel: number, rate = 1, pan = 0): void {
    const buffer = this.drums.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vel;
    src.connect(g);
    this.route(g, out, pan);
    src.start(t);
  }

  /** Timpani at any pitch (the sample is a D2). */
  timpani(out: AudioNode, t: number, midi: number, vel: number): void {
    this.drum('timpani', out, t, vel, 2 ** ((midi - 38) / 12));
  }

  pluck(out: AudioNode, t: number, midi: number, vel: number, pan = 0): void {
    if (!this.plucks.length) return;
    let best = this.plucks[0];
    for (const p of this.plucks) if (Math.abs(p.midi - midi) < Math.abs(best.midi - midi)) best = p;
    const src = this.ctx.createBufferSource();
    src.buffer = best.buffer;
    src.playbackRate.value = mtof(midi) / best.freq;
    const g = this.ctx.createGain();
    g.gain.value = vel * 0.22;
    const f = this.ctx.createBiquadFilter();
    f.frequency.value = 1800 + vel * 3000;
    src.connect(f).connect(g);
    this.route(g, out, pan);
    src.start(t);
  }

  strings(out: AudioNode, t: number, midi: number, dur: number, vel: number, o: { attack?: number; release?: number; bright?: number; pan?: number } = {}): void {
    const ctx = this.ctx;
    const f = mtof(midi);
    const attack = o.attack ?? 0.25;
    const release = o.release ?? 0.5;
    const filter = ctx.createBiquadFilter();
    filter.frequency.value = Math.min(9000, (500 + (o.bright ?? 1) * 1100) * (0.6 + vel * 0.6) + f);
    filter.Q.value = 0.5;
    const g = ctx.createGain();
    const peak = vel * 0.05;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur));
    g.gain.setTargetAtTime(0, t + Math.max(attack, dur), release / 3);
    const end = t + Math.max(attack, dur) + release * 1.6;
    for (const detune of [-9, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = detune;
      this.lfoGain.connect(osc.detune);
      osc.connect(filter);
      osc.start(t);
      osc.stop(end);
      osc.onended = () => this.lfoGain.disconnect(osc.detune);
    }
    filter.connect(g);
    this.route(g, out, o.pan ?? 0);
  }

  brass(out: AudioNode, t: number, midi: number, dur: number, vel: number, pan = 0): void {
    const ctx = this.ctx;
    const f = mtof(midi);
    const filter = ctx.createBiquadFilter();
    const open = 700 + vel * 2600 + f;
    filter.frequency.setValueAtTime(250 + f, t);
    filter.frequency.linearRampToValueAtTime(open, t + 0.07);
    filter.frequency.setTargetAtTime(open * 0.6, t + 0.07, 0.2);
    filter.Q.value = 1.1;
    const g = ctx.createGain();
    const peak = vel * 0.055;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.035);
    g.gain.setTargetAtTime(peak * 0.75, t + 0.05, 0.15);
    g.gain.setValueAtTime(peak * 0.75, t + Math.max(0.06, dur));
    g.gain.setTargetAtTime(0, t + Math.max(0.06, dur), 0.08);
    const end = t + Math.max(0.06, dur) + 0.5;
    for (const detune of [-6, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.985, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(end);
    }
    filter.connect(g);
    this.route(g, out, pan);
  }

  flute(out: AudioNode, t: number, midi: number, dur: number, vel: number, pan = 0): void {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    const peak = vel * 0.07;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.06);
    g.gain.setValueAtTime(peak * 0.9, t + Math.max(0.07, dur));
    g.gain.setTargetAtTime(0, t + Math.max(0.07, dur), 0.07);
    const end = t + Math.max(0.07, dur) + 0.45;
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    this.lfoGain.connect(osc.detune);
    osc.onended = () => this.lfoGain.disconnect(osc.detune);
    const over = ctx.createOscillator();
    over.type = 'triangle';
    over.frequency.value = f * 2;
    const overGain = ctx.createGain();
    overGain.gain.value = 0.12;
    osc.connect(g);
    over.connect(overGain).connect(g);
    osc.start(t);
    over.start(t);
    osc.stop(end);
    over.stop(end);
    this.route(g, out, pan);
  }

  bell(out: AudioNode, t: number, midi: number, vel: number, dur = 2.4, pan = 0): void {
    const ctx = this.ctx;
    const f = mtof(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * 1.6, t);
    depth.gain.exponentialRampToValueAtTime(f * 0.05, t + dur);
    mod.connect(depth).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.06, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
    this.route(g, out, pan);
  }

  bass(out: AudioNode, t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const f = mtof(midi);
    const filter = ctx.createBiquadFilter();
    filter.frequency.setValueAtTime(300 + vel * 700, t);
    filter.frequency.setTargetAtTime(220 + vel * 200, t + 0.02, 0.12);
    const g = ctx.createGain();
    const peak = vel * 0.16;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.setTargetAtTime(peak * 0.7, t + 0.02, 0.2);
    g.gain.setValueAtTime(peak * 0.7, t + Math.max(0.03, dur));
    g.gain.setTargetAtTime(0, t + Math.max(0.03, dur), 0.06);
    const end = t + Math.max(0.03, dur) + 0.4;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.frequency.value = f;
    saw.connect(filter);
    sub.connect(filter);
    filter.connect(g);
    saw.start(t);
    sub.start(t);
    saw.stop(end);
    sub.stop(end);
    this.route(g, out, 0);
  }

  /** Breathy wind for the quiet tracks. */
  wind(out: AudioNode, t: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 'brown');
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.linearRampToValueAtTime(700, t + dur / 2);
    f.frequency.linearRampToValueAtTime(350, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.25, t + dur / 2);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g);
    this.route(g, out, 0);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private route(node: AudioNode, out: AudioNode, pan: number): void {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p).connect(out);
    } else node.connect(out);
  }
}
