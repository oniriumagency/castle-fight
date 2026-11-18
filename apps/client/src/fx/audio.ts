import { settings } from '../app/settings';

/**
 * Audio hook. Every sound the interface makes goes through `audio.play(cue)`
 * and every music change through `audio.music(track)`, so the sound pass
 * only has to replace what each cue does (samples, Howler, layers) without
 * touching the screens.
 *
 * Until then the cues are short placeholder sounds synthesized with Web
 * Audio, and music is silent.
 */

export type Cue =
  | 'uiHover'
  | 'uiClick'
  | 'uiBack'
  | 'cardDraw'
  | 'cardHover'
  | 'cardSelect'
  | 'cardPlay'
  | 'cardDiscard'
  | 'build'
  | 'hit'
  | 'hitBig'
  | 'pierce'
  | 'blocked'
  | 'burn'
  | 'frost'
  | 'shield'
  | 'enchant'
  | 'resource'
  | 'worker'
  | 'ultimateReady'
  | 'ultimate'
  | 'event'
  | 'yourTurn'
  | 'tick'
  | 'victory'
  | 'defeat'
  | 'error'
  | 'emote';

export type MusicTrack = 'menu' | 'battle' | 'victory' | 'defeat' | null;

class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private currentTrack: MusicTrack = null;
  private tension = 0;
  private lastPlayed = new Map<Cue, number>();

  constructor() {
    // Browsers only allow audio after a user gesture.
    const unlock = (): void => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { once: false });
    settings.subscribe(() => this.applyVolumes());
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.applyVolumes();
    return this.ctx;
  }

  private applyVolumes(): void {
    const s = settings.get();
    if (this.master) this.master.gain.value = s.masterVolume;
    if (this.sfx) this.sfx.gain.value = s.sfxVolume * 0.6;
    if (this.musicGain) this.musicGain.gain.value = s.musicVolume;
  }

  /** Plays a sound effect. `intensity` (0..1) scales big hits. */
  play(cue: Cue, intensity = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.sfx) return;
    // Do not stack the same cue within a few milliseconds (bursts of events).
    const now = performance.now();
    if (now - (this.lastPlayed.get(cue) ?? 0) < 35) return;
    this.lastPlayed.set(cue, now);
    PLACEHOLDERS[cue]?.(new Synth(ctx, this.sfx), intensity);
  }

  /** Switches the music track. Placeholder: no music yet, the hook only records it. */
  music(track: MusicTrack): void {
    this.currentTrack = track;
  }

  /** 0..1: how close the game is to ending. The music pass can layer tension on it. */
  setTension(value: number): void {
    this.tension = Math.max(0, Math.min(1, value));
  }

  get track(): MusicTrack {
    return this.currentTrack;
  }

  get tensionLevel(): number {
    return this.tension;
  }
}

/** Tiny synthesizer for the placeholder cues. */
class Synth {
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  tone(freq: number, ms: number, opts: { type?: OscillatorType; gain?: number; to?: number; delay?: number; attack?: number } = {}): void {
    const t0 = this.ctx.currentTime + (opts.delay ?? 0) / 1000;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + ms / 1000);
    const peak = opts.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 8) / 1000);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(gain).connect(this.out);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.05);
  }

  noise(ms: number, opts: { freq?: number; q?: number; gain?: number; delay?: number; type?: BiquadFilterType; to?: number } = {}): void {
    const t0 = this.ctx.currentTime + (opts.delay ?? 0) / 1000;
    const length = Math.ceil((this.ctx.sampleRate * ms) / 1000);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.type ?? 'lowpass';
    filter.frequency.setValueAtTime(opts.freq ?? 1200, t0);
    if (opts.to) filter.frequency.exponentialRampToValueAtTime(opts.to, t0 + ms / 1000);
    filter.Q.value = opts.q ?? 0.8;
    const gain = this.ctx.createGain();
    gain.gain.value = opts.gain ?? 0.3;
    src.connect(filter).connect(gain).connect(this.out);
    src.start(t0);
  }
}

const PLACEHOLDERS: Partial<Record<Cue, (s: Synth, intensity: number) => void>> = {
  uiHover: (s) => s.tone(880, 50, { gain: 0.03, type: 'triangle' }),
  uiClick: (s) => {
    s.tone(660, 70, { gain: 0.08, type: 'triangle' });
    s.tone(990, 60, { gain: 0.05, type: 'triangle', delay: 30 });
  },
  uiBack: (s) => s.tone(520, 90, { gain: 0.07, type: 'triangle', to: 380 }),
  cardHover: (s) => s.noise(60, { freq: 3000, type: 'highpass', gain: 0.05 }),
  cardDraw: (s) => s.noise(140, { freq: 2400, to: 5200, type: 'bandpass', q: 1.5, gain: 0.12 }),
  cardSelect: (s) => s.noise(90, { freq: 1800, to: 3600, type: 'bandpass', gain: 0.12 }),
  cardPlay: (s) => {
    s.noise(260, { freq: 600, to: 3800, type: 'bandpass', q: 1.2, gain: 0.22 });
    s.tone(330, 200, { gain: 0.05, type: 'triangle', to: 660, delay: 60 });
  },
  cardDiscard: (s) => s.noise(220, { freq: 2600, to: 500, type: 'bandpass', gain: 0.16 }),
  build: (s) => {
    s.tone(140, 160, { gain: 0.25, type: 'triangle', to: 90 });
    s.noise(120, { freq: 500, gain: 0.25, delay: 10 });
    s.tone(180, 140, { gain: 0.18, type: 'triangle', to: 110, delay: 150 });
    s.noise(90, { freq: 600, gain: 0.18, delay: 160 });
  },
  hit: (s, k) => {
    s.noise(260 + k * 200, { freq: 900, to: 180, gain: 0.35 + k * 0.25 });
    s.tone(90, 220, { gain: 0.3 + k * 0.2, to: 45 });
  },
  hitBig: (s) => {
    s.noise(600, { freq: 1200, to: 120, gain: 0.6 });
    s.tone(70, 500, { gain: 0.5, to: 30 });
    s.noise(400, { freq: 300, gain: 0.3, delay: 120 });
  },
  pierce: (s) => {
    s.tone(1400, 160, { gain: 0.1, type: 'sawtooth', to: 300 });
    s.noise(180, { freq: 4000, to: 800, type: 'bandpass', gain: 0.2 });
  },
  blocked: (s) => {
    s.tone(1250, 400, { gain: 0.12, type: 'sine' });
    s.tone(1875, 300, { gain: 0.07, type: 'sine', delay: 10 });
    s.noise(80, { freq: 5000, type: 'highpass', gain: 0.1 });
  },
  burn: (s) => {
    s.noise(500, { freq: 1600, type: 'bandpass', q: 0.6, gain: 0.18 });
    s.noise(300, { freq: 400, gain: 0.12, delay: 120 });
  },
  frost: (s) => {
    for (let i = 0; i < 4; i++) s.tone(1800 + i * 420, 260, { gain: 0.05, type: 'sine', delay: i * 45 });
    s.noise(300, { freq: 6000, type: 'highpass', gain: 0.06 });
  },
  shield: (s) => {
    s.tone(523, 500, { gain: 0.08, type: 'sine', attack: 60 });
    s.tone(784, 500, { gain: 0.06, type: 'sine', attack: 60, delay: 80 });
  },
  enchant: (s) => {
    for (let i = 0; i < 5; i++) s.tone([523, 659, 784, 988, 1175][i], 380, { gain: 0.05, type: 'sine', delay: i * 55 });
  },
  resource: (s) => s.tone(1046, 120, { gain: 0.05, type: 'triangle', to: 1318 }),
  worker: (s) => {
    s.tone(392, 120, { gain: 0.08, type: 'triangle' });
    s.tone(523, 160, { gain: 0.08, type: 'triangle', delay: 90 });
  },
  ultimateReady: (s) => {
    s.tone(659, 220, { gain: 0.07, type: 'triangle' });
    s.tone(988, 320, { gain: 0.07, type: 'triangle', delay: 110 });
  },
  ultimate: (s) => {
    s.tone(196, 900, { gain: 0.15, type: 'sawtooth', to: 392, attack: 200 });
    s.tone(294, 900, { gain: 0.1, type: 'sawtooth', to: 587, attack: 200 });
    s.noise(900, { freq: 400, to: 4000, type: 'bandpass', gain: 0.2 });
  },
  event: (s) => {
    s.tone(110, 1400, { gain: 0.25, type: 'sine', attack: 10 });
    s.tone(165, 1200, { gain: 0.12, type: 'sine', attack: 10 });
    s.tone(220, 900, { gain: 0.08, type: 'triangle', attack: 10 });
  },
  yourTurn: (s) => {
    s.tone(784, 300, { gain: 0.07, type: 'sine' });
    s.tone(1175, 420, { gain: 0.05, type: 'sine', delay: 120 });
  },
  tick: (s) => s.tone(1600, 30, { gain: 0.05, type: 'square' }),
  victory: (s) => {
    [523, 659, 784, 1046].forEach((f, i) => s.tone(f, 700, { gain: 0.1, type: 'triangle', delay: i * 130 }));
  },
  defeat: (s) => {
    [392, 330, 262, 196].forEach((f, i) => s.tone(f, 800, { gain: 0.09, type: 'triangle', delay: i * 180 }));
  },
  error: (s) => s.tone(180, 160, { gain: 0.1, type: 'square', to: 140 }),
  emote: (s) => s.tone(880, 140, { gain: 0.06, type: 'triangle', to: 1320 }),
};

export const audio = new AudioBus();
