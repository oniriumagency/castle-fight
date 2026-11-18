import { settings } from '../app/settings';
import { MusicPlayer, type MusicTrack } from './sound/music';
import { idle, renderRecipe } from './sound/render';
import { RECIPES, WARM_ORDER, type Cue } from './sound/sfx';
import { impulseResponse, Synth } from './sound/synth';

export type { Cue } from './sound/sfx';
export type { MusicTrack } from './sound/music';

/**
 * Every sound goes through here: `audio.play(cue)` for effects and
 * `audio.music(track)` for the score. The effects are synthesized in the
 * browser (see `sound/`); the music is streamed from `public/music/`.
 * Nothing is built until the first tap or key press (browsers require it),
 * and then the most common effects are rendered a few at a time in idle
 * moments.
 *
 *   sfx ──┬──────────────► master ─► limiter ─► speakers
 *         └─► reverb ──────┘   ▲
 *   music ─► duck ─────────────┘
 */

const INTENSITY_BUCKETS = [0.2, 0.55, 0.9];
const MAX_VOICES = 28;

export interface PlayOptions {
  /** -1 (left) .. 1 (right): which castle the sound comes from. */
  pan?: number;
  /** Delay in ms. */
  delay?: number;
  /** Volume multiplier. */
  gain?: number;
}

function normalize(buffer: AudioBuffer, level: number): void {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak < 1e-4) return;
  const k = level / peak;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private player: MusicPlayer | null = null;
  private bank = new Map<string, Promise<AudioBuffer | null>>();
  private lastPlayed = new Map<Cue, number>();
  private voices = 0;
  private wantedTrack: MusicTrack = null;
  private tension = 0;
  private warmed = false;

  constructor() {
    // Browsers only allow audio after a user gesture.
    const unlock = (): void => {
      const ctx = this.ensure();
      if (ctx && ctx.state !== 'running' && document.visibilityState === 'visible') {
        void ctx.resume();
        // iOS needs a sound started inside the gesture to wake the output.
        const silent = ctx.createBufferSource();
        silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        silent.connect(ctx.destination);
        silent.start();
      }
      this.player?.unlock();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    // iOS only counts the end of a touch as a gesture that may start media.
    window.addEventListener('touchend', unlock, { passive: true });
    window.addEventListener('click', unlock);
    // No music in a background tab, and no battery spent on it.
    document.addEventListener('visibilitychange', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      if (document.visibilityState === 'hidden') {
        this.player?.hide();
        void ctx.suspend();
      } else void ctx.resume().then(() => this.player?.show());
    });
    settings.subscribe(() => this.applyVolumes());
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      // Mix with whatever else the phone is playing instead of stopping it.
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'ambient';
    } catch {
      // Not supported: the default session is fine.
    }
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulseResponse(ctx);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;

    this.sfx.connect(this.master);
    this.musicBus.connect(this.duckGain).connect(this.master);
    this.reverb.connect(reverbReturn).connect(this.master);
    this.master.connect(limiter).connect(ctx.destination);
    this.applyVolumes();

    this.player = new MusicPlayer(ctx, this.musicBus);
    this.player.setTension(this.tension);
    if (this.wantedTrack) this.player.play(this.wantedTrack);
    void this.warm();
    return ctx;
  }

  private applyVolumes(): void {
    const s = settings.get();
    const now = this.ctx?.currentTime ?? 0;
    const set = (node: GainNode | null, value: number): void => {
      node?.gain.setTargetAtTime(value, now, 0.05);
    };
    set(this.master, s.muted ? 0 : s.masterVolume);
    set(this.sfx, s.sfxVolume * 0.9);
    set(this.musicBus, s.musicVolume * 1.5);
  }

  /** Renders the common effects without blocking frames. */
  private async warm(): Promise<void> {
    if (this.warmed) return;
    this.warmed = true;
    for (const cue of WARM_ORDER) {
      if (RECIPES[cue].scaled) for (const k of INTENSITY_BUCKETS) void this.buffer(cue, k);
      else void this.buffer(cue, 0.5);
      await idle();
    }
  }

  private buffer(cue: Cue, intensity: number): Promise<AudioBuffer | null> {
    const recipe = RECIPES[cue];
    const k = recipe.scaled ? INTENSITY_BUCKETS.reduce((a, b) => (Math.abs(b - intensity) < Math.abs(a - intensity) ? b : a)) : 0.5;
    const key = recipe.scaled ? `${cue}@${k}` : cue;
    let pending = this.bank.get(key);
    if (!pending) {
      pending = renderRecipe(recipe.len, this.ctx!.sampleRate, (s) => recipe.fn(s, k)).then((buffer) => {
        if (buffer && recipe.level && !recipe.scaled) normalize(buffer, recipe.level);
        return buffer;
      });
      this.bank.set(key, pending);
    }
    return pending;
  }

  /** Plays a sound effect. `intensity` (0..1) picks how hard hits and builds sound. */
  play(cue: Cue, intensity = 0.5, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.sfx || settings.get().muted) return;
    // Do not stack the same cue within a few milliseconds (bursts of events).
    const now = performance.now();
    if (now - (this.lastPlayed.get(cue) ?? 0) < 35) return;
    this.lastPlayed.set(cue, now);
    if (this.voices >= MAX_VOICES) return;
    const recipe = RECIPES[cue];
    const requested = ctx.currentTime;
    void this.buffer(cue, intensity).then((buffer) => {
      // A sound that took too long to render would arrive late: drop it.
      const late = ctx.currentTime - requested;
      if (late > 0.25) return;
      this.voices++;
      const out = ctx.createGain();
      out.gain.value = (opts.gain ?? 1) * (recipe.scaled ? 0.55 + intensity * 0.5 : 1);
      let node: AudioNode = out;
      if (opts.pan && ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
        out.connect(panner);
        node = panner;
      }
      node.connect(this.sfx!);
      if (recipe.verb && this.reverb) {
        const send = ctx.createGain();
        send.gain.value = recipe.verb;
        node.connect(send).connect(this.reverb);
      }
      const at = ctx.currentTime + (opts.delay ?? 0) / 1000;
      const release = (): void => {
        this.voices = Math.max(0, this.voices - 1);
        out.disconnect();
      };
      if (buffer) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        if (recipe.vary) src.playbackRate.value = 1 + (Math.random() - 0.5) * 2 * recipe.vary;
        src.connect(out);
        src.onended = release;
        src.start(at);
      } else {
        // No offline rendering in this browser: synthesize it live.
        recipe.fn(new Synth(ctx, out, at), intensity);
        setTimeout(release, (recipe.len + 0.2) * 1000 + (opts.delay ?? 0));
      }
    });
  }

  /** Switches the music track (crossfade). */
  music(track: MusicTrack): void {
    this.wantedTrack = track;
    this.player?.play(track);
  }

  /** 0..1: how close the game is to ending. Fades in the battle's tension layer. */
  setTension(value: number): void {
    this.tension = Math.max(0, Math.min(1, value));
    this.player?.setTension(this.tension);
  }

  /** Lowers the music for a moment so a big effect can be heard. */
  duck(depth = 0.45, ms = 1200): void {
    const g = this.duckGain;
    if (!g || !this.ctx) return;
    const now = this.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(depth, now, 0.04);
    g.gain.setTargetAtTime(1, now + ms / 1000, 0.4);
  }

  get track(): MusicTrack {
    return this.wantedTrack;
  }

  get tensionLevel(): number {
    return this.tension;
  }
}

export const audio = new AudioBus();
