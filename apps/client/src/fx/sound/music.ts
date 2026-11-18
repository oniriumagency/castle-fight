import type { Instruments } from './instruments';
import { BATTLE, DEFEAT, MENU, VICTORY, type Song } from './songs';
import { rng } from './synth';

export type MusicTrack = 'menu' | 'battle' | 'victory' | 'defeat' | null;

const SONGS: Record<Exclude<MusicTrack, null>, Song> = { menu: MENU, battle: BATTLE, victory: VICTORY, defeat: DEFEAT };

interface Playing {
  track: Exclude<MusicTrack, null>;
  song: Song;
  out: GainNode;
  main: GainNode;
  tension: GainNode;
  nextTime: number;
  /** Sixteenths since the start. */
  index: number;
  stopped: boolean;
}

const LOOKAHEAD = 0.3;
/** How loud the tension layer gets at full tension. */
const TENSION_MIX = 0.5;

/**
 * Plays the procedural score: a lookahead scheduler that asks each part of
 * the current song what to play on every sixteenth note, a little ahead of
 * time. Changing track crossfades; tension fades its layer in and nudges the
 * tempo up.
 */
export class MusicPlayer {
  private playing: Playing | null = null;
  private wanted: MusicTrack = null;
  private tension = 0;
  private timer: number | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly bus: AudioNode,
    private readonly inst: Instruments,
  ) {}

  get track(): MusicTrack {
    return this.wanted;
  }

  play(track: MusicTrack): void {
    if (track === this.wanted && (this.playing || !track)) return;
    this.wanted = track;
    if (!this.inst.ready) {
      // Starts once the instruments are rendered (see `start`).
      void this.inst.prepare().then(() => this.start());
      return;
    }
    this.start();
  }

  setTension(value: number): void {
    this.tension = value;
    const p = this.playing;
    if (p && p.track === 'battle') p.tension.gain.setTargetAtTime(value ** 1.3 * TENSION_MIX, this.ctx.currentTime, 1.2);
  }

  /** Called when the page is shown again: skip what should have played while hidden. */
  resync(): void {
    const p = this.playing;
    if (p && p.nextTime < this.ctx.currentTime) p.nextTime = this.ctx.currentTime + 0.05;
  }

  private start(): void {
    const track = this.wanted;
    if (this.playing?.track === track) return;
    const now = this.ctx.currentTime;
    if (this.playing) {
      const old = this.playing;
      old.stopped = true;
      old.out.gain.cancelScheduledValues(now);
      old.out.gain.setValueAtTime(old.out.gain.value, now);
      old.out.gain.linearRampToValueAtTime(0, now + 1.4);
      setTimeout(() => old.out.disconnect(), 4000);
      this.playing = null;
    }
    if (!track) {
      this.stopTimer();
      return;
    }
    const song = SONGS[track];
    const out = this.ctx.createGain();
    const main = this.ctx.createGain();
    const tension = this.ctx.createGain();
    tension.gain.value = track === 'battle' ? this.tension ** 1.3 * TENSION_MIX : 0;
    main.connect(out);
    tension.connect(out);
    out.connect(this.bus);
    const at = now + 0.12;
    if (song.fadeIn > 0) {
      out.gain.setValueAtTime(0, at);
      out.gain.linearRampToValueAtTime(song.level, at + song.fadeIn);
    } else out.gain.value = song.level;
    this.playing = { track, song, out, main, tension, nextTime: at, index: 0, stopped: false };
    this.startTimer();
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.schedule(), 60);
    this.schedule();
  }

  private stopTimer(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const p = this.playing;
    if (!p || p.stopped || this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    if (p.nextTime < this.ctx.currentTime - 0.2) p.nextTime = this.ctx.currentTime + 0.05;
    while (p.nextTime < horizon) {
      this.playStep(p);
      const bpm = p.song.bpm + ((p.song.bpmTension ?? p.song.bpm) - p.song.bpm) * this.tension;
      p.nextTime += 60 / bpm / 4;
      p.index++;
    }
  }

  private playStep(p: Playing): void {
    const song = p.song;
    const introSteps = (song.intro?.length ?? 0) * 16;
    const intro = p.index < introSteps;
    const local = intro ? p.index : p.index - introSteps;
    const barIndex = Math.floor(local / 16);
    const step = local % 16;
    const bars = intro ? song.intro! : song.loop;
    const bar = barIndex % bars.length;
    const cycle = intro ? 0 : Math.floor(barIndex / bars.length) % song.cycles;
    const bpm = song.bpm + ((song.bpmTension ?? song.bpm) - song.bpm) * this.tension;
    const stepDur = 60 / bpm / 4;
    const ctx = {
      t: p.nextTime,
      step,
      bar,
      cycle,
      intro,
      chord: bars[bar],
      stepDur,
      barDur: stepDur * 16,
      i: this.inst,
      main: p.main,
      tension: p.tension,
      rand: rng(bar * 131 + cycle * 977 + step * 7 + 1),
    };
    for (const part of song.parts) {
      try {
        part(ctx);
      } catch {
        // A part that fails must never stop the music.
      }
    }
  }
}
