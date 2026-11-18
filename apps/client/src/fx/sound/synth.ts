/**
 * A small synthesizer that builds Web Audio graphs on any context, live or
 * offline. Every sound effect and instrument in the game is made with it:
 * there are no audio files, so nothing to download and nothing to license.
 */

export const mtof = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export type NoiseColor = 'white' | 'pink' | 'brown';

const noiseCache = new Map<string, AudioBuffer>();

/** Two seconds of looping noise, shared by every context with the same sample rate. */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const key = `${color}@${ctx.sampleRate}`;
  const cached = noiseCache.get(key);
  if (cached) return cached;
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'white') d[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's economy pink filter.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  noiseCache.set(key, buffer);
  return buffer;
}

export interface FilterSpec {
  type?: BiquadFilterType;
  freq: number;
  /** Frequency at the end of the sound (exponential sweep). */
  to?: number;
  q?: number;
  gain?: number;
}

export interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  /** Ends the sound at this frequency (exponential glide over the duration). */
  to?: number;
  /** Glide time in ms when `to` is set (default: the whole duration). */
  glide?: number;
  delay?: number;
  attack?: number;
  /** Envelope shape after the attack: `exp` decays, `hold` sustains then releases, `swell` rises then fades. */
  shape?: 'exp' | 'hold' | 'lin' | 'swell';
  release?: number;
  detune?: number;
  /** Vibrato depth in cents and rate in Hz. */
  vibrato?: { depth: number; rate: number; delay?: number };
  filter?: FilterSpec;
  pan?: number;
}

export interface NoiseOptions {
  color?: NoiseColor;
  gain?: number;
  delay?: number;
  attack?: number;
  shape?: 'exp' | 'hold' | 'lin' | 'swell';
  release?: number;
  filter?: FilterSpec;
  /** Second filter in series (for narrow bands). */
  filter2?: FilterSpec;
  pan?: number;
}

/** Builds sounds starting at `t0` on `ctx`, into `out`. All times in ms. */
export class Synth {
  constructor(
    readonly ctx: BaseAudioContext,
    readonly out: AudioNode,
    readonly t0: number = ctx.currentTime,
  ) {}

  at(ms = 0): number {
    return this.t0 + ms / 1000;
  }

  private envelope(param: AudioParam, start: number, durS: number, peak: number, attackS: number, shape: string, releaseS: number): number {
    const floor = 0.0001;
    param.setValueAtTime(floor, start);
    if (shape === 'swell') {
      param.linearRampToValueAtTime(peak, start + durS * 0.7);
      param.exponentialRampToValueAtTime(floor, start + durS);
      return start + durS;
    }
    param.linearRampToValueAtTime(peak, start + attackS);
    if (shape === 'hold') {
      param.setValueAtTime(peak, start + Math.max(attackS, durS - releaseS));
      param.exponentialRampToValueAtTime(floor, start + durS);
    } else if (shape === 'lin') {
      param.linearRampToValueAtTime(floor, start + durS);
    } else {
      param.exponentialRampToValueAtTime(floor, start + Math.max(attackS + 0.005, durS));
    }
    return start + durS;
  }

  private filter(input: AudioNode, spec: FilterSpec, start: number, durS: number): AudioNode {
    const f = this.ctx.createBiquadFilter();
    f.type = spec.type ?? 'lowpass';
    f.frequency.setValueAtTime(spec.freq, start);
    if (spec.to) f.frequency.exponentialRampToValueAtTime(spec.to, start + durS);
    f.Q.value = spec.q ?? 0.7;
    if (spec.gain !== undefined) f.gain.value = spec.gain;
    input.connect(f);
    return f;
  }

  private dest(pan?: number): AudioNode {
    if (!pan || !this.ctx.createStereoPanner) return this.out;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.out);
    return p;
  }

  tone(freq: number, ms: number, o: ToneOptions = {}): void {
    const start = this.at(o.delay);
    const durS = ms / 1000;
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, start + (o.glide ?? ms) / 1000);
    if (o.detune) osc.detune.value = o.detune;
    let lfo: OscillatorNode | null = null;
    if (o.vibrato) {
      lfo = this.ctx.createOscillator();
      lfo.frequency.value = o.vibrato.rate;
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, start);
      depth.gain.linearRampToValueAtTime(o.vibrato.depth, start + (o.vibrato.delay ?? 150) / 1000);
      lfo.connect(depth).connect(osc.detune);
      lfo.start(start);
    }
    const gain = this.ctx.createGain();
    const end = this.envelope(gain.gain, start, durS, o.gain ?? 0.2, (o.attack ?? 5) / 1000, o.shape ?? 'exp', (o.release ?? 80) / 1000);
    const src: AudioNode = o.filter ? this.filter(osc, o.filter, start, durS) : osc;
    src.connect(gain).connect(this.dest(o.pan));
    osc.start(start);
    osc.stop(end + 0.02);
    lfo?.stop(end + 0.02);
  }

  noise(ms: number, o: NoiseOptions = {}): void {
    const start = this.at(o.delay);
    const durS = ms / 1000;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx, o.color ?? 'white');
    src.loop = true;
    let node: AudioNode = src;
    if (o.filter) node = this.filter(node, o.filter, start, durS);
    if (o.filter2) node = this.filter(node, o.filter2, start, durS);
    const gain = this.ctx.createGain();
    const end = this.envelope(gain.gain, start, durS, o.gain ?? 0.2, (o.attack ?? 3) / 1000, o.shape ?? 'exp', (o.release ?? 80) / 1000);
    node.connect(gain).connect(this.dest(o.pan));
    src.start(start, Math.random() * 1.5);
    src.stop(end + 0.02);
  }

  /** Two-operator FM: bells, metal, glass. */
  fm(freq: number, ms: number, o: { ratio?: number; index?: number; indexTo?: number; gain?: number; delay?: number; attack?: number; pan?: number; type?: OscillatorType } = {}): void {
    const start = this.at(o.delay);
    const durS = ms / 1000;
    const car = this.ctx.createOscillator();
    car.type = o.type ?? 'sine';
    car.frequency.value = freq;
    const mod = this.ctx.createOscillator();
    mod.frequency.value = freq * (o.ratio ?? 3.5);
    const depth = this.ctx.createGain();
    const index = (o.index ?? 3) * freq;
    depth.gain.setValueAtTime(index, start);
    depth.gain.exponentialRampToValueAtTime(Math.max(1, (o.indexTo ?? 0.2) * freq), start + durS);
    mod.connect(depth).connect(car.frequency);
    const gain = this.ctx.createGain();
    const end = this.envelope(gain.gain, start, durS, o.gain ?? 0.15, (o.attack ?? 2) / 1000, 'exp', 0.05);
    car.connect(gain).connect(this.dest(o.pan));
    car.start(start);
    mod.start(start);
    car.stop(end + 0.02);
    mod.stop(end + 0.02);
  }

  /** A low thump with a pitch drop: drums, impacts, footsteps of stone. */
  thump(freq: number, ms: number, o: { gain?: number; drop?: number; delay?: number; click?: number; pan?: number } = {}): void {
    this.tone(freq, ms, { gain: o.gain ?? 0.5, to: freq * (o.drop ?? 0.45), glide: ms * 0.6, delay: o.delay, attack: 2, pan: o.pan });
    if (o.click) this.noise(30, { gain: o.click, delay: o.delay, filter: { type: 'lowpass', freq: 3000 }, pan: o.pan });
  }
}

/** Seeded random numbers (mulberry32) so procedural music repeats its motifs. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stereo impulse response for the shared hall reverb. */
export function impulseResponse(ctx: BaseAudioContext, seconds = 2.2, decay = 3.2): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Early reflections in the first 80 ms, then a smooth darkening tail.
      const early = i < rate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
      const w = Math.random() * 2 - 1;
      const k = 0.35 + 0.6 * t;
      lp = lp * k + w * (1 - k);
      d[i] = (lp * 1.6 + early) * (1 - t) ** decay;
    }
  }
  return buffer;
}
