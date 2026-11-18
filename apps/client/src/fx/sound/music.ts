export type MusicTrack = 'menu' | 'battle' | 'victory' | 'defeat' | null;

interface TrackInfo {
  /** File in `public/music/`. */
  file: string;
  /** Mix level, so the three pieces sit at a similar loudness under the effects. */
  gain: number;
  /** Fade-in in seconds. */
  fadeIn: number;
}

const TRACKS: Record<Exclude<MusicTrack, null>, TrackInfo> = {
  menu: { file: 'celtic-morning.mp3', gain: 1, fadeIn: 2 },
  battle: { file: 'diversity.mp3', gain: 0.8, fadeIn: 1.5 },
  victory: { file: 'celtic-morning.mp3', gain: 1, fadeIn: 1 },
  defeat: { file: 'to-the-fallen.mp3', gain: 0.7, fadeIn: 1 },
};

const FADE_OUT = 1.4;
/** At full tension the battle music is this much louder. */
const TENSION_BOOST = 0.25;

const url = (file: string): string => `${import.meta.env.BASE_URL}music/${file}`;

/** A tiny silent WAV, played inside the first tap so iOS lets the elements play later. */
function silentWav(): string {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

interface Deck {
  el: HTMLAudioElement;
  out: GainNode;
  file: string | null;
  /** Bumped on every change, so a pending fade-out pause does not hit a deck in use again. */
  token: number;
}

/**
 * Plays the soundtrack: one MP3 per moment of the game, streamed by two
 * `<audio>` elements (nothing big is decoded into memory, which matters on
 * phones) and routed into the music bus so the volume settings and ducking
 * apply. Changing track crossfades between the two; the menu and victory
 * share a piece, so going from one to the other keeps it playing.
 */
export class MusicPlayer {
  private readonly decks: Deck[];
  private current: Deck | null = null;
  private wanted: MusicTrack = null;
  private tension = 0;
  private unlocked = false;

  constructor(
    private readonly ctx: AudioContext,
    bus: AudioNode,
  ) {
    this.decks = [0, 1].map(() => {
      const el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      const out = ctx.createGain();
      out.gain.value = 0;
      try {
        ctx.createMediaElementSource(el).connect(out);
      } catch {
        // Very old browsers: the element plays on its own, without the mix.
      }
      out.connect(bus);
      return { el, out, file: null, token: 0 };
    });
  }

  get track(): MusicTrack {
    return this.wanted;
  }

  /** Called on every tap or key until it works: lets the elements play outside a tap later (iOS). */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const silence = silentWav();
    for (const deck of this.decks) {
      if (deck.file) continue;
      deck.el.src = silence;
      deck.el
        .play()
        .then(() => {
          if (!deck.file) deck.el.pause();
        })
        .catch(() => {
          this.unlocked = false;
        });
    }
    // A track that the browser refused to start before the first tap.
    this.resume();
  }

  play(track: MusicTrack): void {
    if (track === this.wanted) return;
    this.wanted = track;
    const info = track ? TRACKS[track] : null;
    const now = this.ctx.currentTime;
    const cur = this.current;
    if (info && cur && cur.file === info.file) {
      this.ramp(cur, this.level(), 0.8);
      return;
    }
    if (cur) this.fadeOut(cur);
    this.current = null;
    if (!info) return;
    const deck = this.decks.find((d) => d !== cur) ?? this.decks[0];
    deck.token++;
    deck.file = info.file;
    deck.el.pause();
    deck.el.src = url(info.file);
    deck.out.gain.cancelScheduledValues(now);
    deck.out.gain.setValueAtTime(0, now);
    deck.out.gain.linearRampToValueAtTime(this.level(), now + info.fadeIn);
    this.current = deck;
    void deck.el.play().catch(() => undefined);
  }

  /** 0..1: the battle music swells a little as the end gets close. */
  setTension(value: number): void {
    this.tension = value;
    if (this.current && this.wanted === 'battle') this.ramp(this.current, this.level(), 1.2);
  }

  /** Starts the current track again if the browser paused it (refused autoplay, phone in the background). */
  resume(): void {
    const deck = this.current;
    if (deck && deck.el.paused) void deck.el.play().catch(() => undefined);
  }

  private level(): number {
    if (!this.wanted) return 0;
    const base = TRACKS[this.wanted].gain;
    return this.wanted === 'battle' ? base * (1 + this.tension ** 1.3 * TENSION_BOOST) : base;
  }

  private ramp(deck: Deck, value: number, seconds: number): void {
    const now = this.ctx.currentTime;
    deck.out.gain.cancelScheduledValues(now);
    deck.out.gain.setValueAtTime(deck.out.gain.value, now);
    deck.out.gain.linearRampToValueAtTime(value, now + seconds);
  }

  private fadeOut(deck: Deck): void {
    this.ramp(deck, 0, FADE_OUT);
    const token = ++deck.token;
    window.setTimeout(() => {
      if (deck.token !== token) return;
      deck.el.pause();
      deck.file = null;
    }, FADE_OUT * 1000 + 200);
  }
}
