import { getHero } from '@cardcraft-castles/engine';
import { h } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { artUrl } from '../../ui/assets';
import { ultimateHtml } from '../../ui/card';

/** Where the eyes are in each hero portrait (px in the 720×538 art). */
const EYES: Record<string, [[number, number], [number, number]]> = {
  alquimista: [[365, 136], [406, 142]],
  arquitecta: [[331, 106], [367, 104]],
  guardian: [[408, 78], [433, 77]],
  hechicera: [[324, 120], [359, 115]],
  mariscal: [[348, 120], [386, 117]],
  saboteadora: [[364, 128], [404, 135]],
};
const ART_W = 720;
const ART_H = 538;
/** The button is this much taller than wide (see `.ult-hero-frame`). */
const FRAME_RATIO = 1.25;
/** Eye distance as a share of the button width. */
const EYE_SPAN = 0.3;

/**
 * The ultimate, ready: a golden energy glow around the whole screen and a
 * button with the hero's face (glowing eyes, crackling aura) next to the
 * hand that fires it. `pulse` is called a few times a second while it shows,
 * for the sparks and lightning drawn on the battlefield.
 */
export class UltimateMode {
  readonly aura = h('div.ult-aura', { 'aria-hidden': 'true' }, h('div.ult-aura-glow'), h('div.ult-aura-rise'), h('div.ult-aura-rise.back'));
  readonly button: HTMLButtonElement;
  onUse: () => void = () => {};
  pulse: () => void = () => {};

  private readonly face: HTMLImageElement;
  private readonly eyes: HTMLElement[];
  private readonly label = h('span.ult-hero-label');
  private heroId = '';
  private effect = '';
  private shown = false;
  private usable = false;
  private timer = 0;

  constructor() {
    this.face = h('img', { alt: '', draggable: 'false' }) as HTMLImageElement;
    this.eyes = [h('span.ult-hero-eye'), h('span.ult-hero-eye')];
    const bolts = `<svg class="ult-hero-bolts" viewBox="0 0 100 125" aria-hidden="true">
      <path class="b1" d="M8 20 L18 34 L11 38 L24 56 L15 59 L27 78"/>
      <path class="b2" d="M92 30 L83 44 L90 48 L78 64 L87 68 L75 88"/>
      <path class="b3" d="M30 4 L40 14 L35 17 L48 26"/>
      <path class="b4" d="M70 120 L62 108 L68 105 L56 96"/>
    </svg>`;
    const frame = h('span.ult-hero-frame', null, h('span.ult-hero-face', null, this.face), ...this.eyes, h('span.ult-hero-shine'));
    frame.insertAdjacentHTML('beforeend', bolts);
    this.button = h('button.ult-hero', { type: 'button', hidden: true }, h('span.ult-hero-flames'), h('span.ult-hero-flames.inner'), frame, this.label) as HTMLButtonElement;
    this.button.addEventListener('click', () => {
      if (this.usable) this.onUse();
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  /** `ready`: the local player's ultimate is charged; `usable`: they may fire it now. */
  update(heroId: string, ready: boolean, usable: boolean): void {
    if (heroId !== this.heroId) this.setHero(heroId);
    const changed = ready !== this.shown;
    this.shown = ready;
    this.usable = usable;
    this.button.hidden = !ready;
    this.button.classList.toggle('usable', usable);
    this.button.disabled = ready && !usable;
    this.aura.classList.toggle('on', ready);
    this.aura.classList.toggle('usable', usable);
    const text = usable ? t('useUltimate') : t('ultimateOnYourTurn');
    if (this.label.textContent !== text) this.label.textContent = text;
    this.button.title = `${t('ultimate')} · ${L(getHero(heroId).name)}: ${this.effect} (U)`;
    this.button.setAttribute('aria-label', `${text}. ${this.effect}`);
    if (changed) {
      if (ready) this.start();
      else this.stop();
    }
  }

  destroy(): void {
    this.stop();
    this.aura.remove();
    this.button.remove();
  }

  private start(): void {
    this.stop();
    this.button.classList.remove('arrive');
    void this.button.offsetWidth;
    this.button.classList.add('arrive');
    this.timer = window.setInterval(() => {
      if (!document.hidden) this.pulse();
    }, 420);
  }

  private stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** Frames the face on the eyes and puts the glows on them. */
  private setHero(heroId: string): void {
    this.heroId = heroId;
    this.face.src = artUrl(getHero(heroId).art);
    const tmp = document.createElement('span');
    tmp.innerHTML = ultimateHtml(heroId);
    this.effect = tmp.textContent ?? '';
    const eyes = EYES[heroId] ?? [[340, 120], [380, 120]];
    const span = Math.max(20, Math.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1]));
    // Image width in button widths, so the eyes sit EYE_SPAN apart.
    const scale = (EYE_SPAN * ART_W) / span;
    const midX = (eyes[0][0] + eyes[1][0]) / 2;
    const midY = (eyes[0][1] + eyes[1][1]) / 2;
    // In % of the button width (x) and height (y).
    const toX = (px: number): number => (px / ART_W) * scale * 100;
    const toY = (py: number): number => ((py / ART_W) * scale * 100) / FRAME_RATIO;
    const left = 50 - toX(midX);
    const top = 40 - toY(midY);
    this.face.style.width = `${scale * 100}%`;
    this.face.style.height = `${((scale * ART_H) / ART_W / FRAME_RATIO) * 100}%`;
    this.face.style.left = `${left}%`;
    this.face.style.top = `${top}%`;
    eyes.forEach(([x, y], i) => {
      this.eyes[i].style.left = `${left + toX(x)}%`;
      this.eyes[i].style.top = `${top + toY(y)}%`;
    });
  }
}
