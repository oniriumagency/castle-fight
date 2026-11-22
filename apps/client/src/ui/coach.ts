import { h } from '../app/dom';
import { t } from '../app/i18n';
import { audio } from '../fx/audio';
import { faceImg } from './assets';

/**
 * The guide of the tutorial: darkens the screen except one element, points at
 * it with an arrow and a hand (a finger on touch screens, the mouse cursor on
 * computers) and shows a short line from Mary beside it.
 *
 * A step waits for the player to act on the element (`until`), or for a tap on
 * "Next" when it only explains something. Every step has "Skip tutorial".
 */
export interface CoachStep {
  /** What to light up; null darkens nothing and centres the bubble. Looked up again every frame (screens rebuild). */
  target?: (() => Element | null) | null;
  text: string;
  /** The hand: a tap on the target, or a drag from it to `dragTo`. */
  gesture?: 'tap' | 'drag' | null;
  dragTo?: () => Element | null;
  /** Resolves when the player has done what the step asks; without it the bubble has a "Next" button. */
  until?: (done: () => void) => (() => void) | void;
  /** Lets touches reach the rest of the screen too (the dark is only a hint). */
  passThrough?: boolean;
  /** Extra room around the target, in pixels. */
  pad?: number;
}

const finePointer = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const HAND_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 22V9a3 3 0 0 1 6 0v11l1-.2V7a3 3 0 0 1 6 0v13l1 .2V10a3 3 0 0 1 6 0v14l1 .3V16a3 3 0 0 1 6 0v14c0 8-5 15-14 15h-2c-5 0-8-2-11-6l-8-10a3 3 0 0 1 4.5-4L18 29z" fill="#fff6e0" stroke="#2a1606" stroke-width="2" stroke-linejoin="round"/></svg>';
const CURSOR_SVG =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 3l20 13-9 2 5 10-4 2-5-10-7 6z" fill="#fff6e0" stroke="#2a1606" stroke-width="2" stroke-linejoin="round"/></svg>';

export interface Coach {
  /** Shows one step; resolves when it is done (or false when the player skipped the tutorial). */
  show(step: CoachStep): Promise<boolean>;
  close(): void;
  readonly skipped: boolean;
}

export function createCoach(onSkip?: () => void): Coach {
  const shades = [0, 1, 2, 3].map(() => h('div.coach-shade'));
  const ring = h('div.coach-ring');
  const hand = h('div.coach-hand');
  hand.innerHTML = finePointer() ? CURSOR_SVG : HAND_SVG;
  hand.classList.toggle('cursor', finePointer());
  const text = h('p.coach-text');
  const next = h('button.btn.primary.coach-next', { type: 'button' }, t('dialogueNext'));
  const skip = h('button.coach-skip', { type: 'button' }, t('tutorialSkip'));
  const bubble = h(
    'div.coach-bubble.panel',
    { role: 'dialog', 'aria-live': 'polite' },
    h('div.coach-face', null, faceImg('heroes/arquitecta.jpg')),
    h('div.coach-body', null, text, h('div.coach-actions', null, skip, next)),
  );
  const layer = h('div.coach-layer', null, ...shades, ring, hand, bubble);
  let frame = 0;
  let current: { step: CoachStep; finish: (ok: boolean) => void; cleanup?: (() => void) | void } | null = null;
  let skipped = false;

  const place = (): void => {
    if (!current) return;
    const { step } = current;
    // A card opened large or a dialog on top: step aside until it closes.
    const covered = !!document.querySelector('.inspect, .modal-backdrop, .dialogue-layer');
    layer.classList.toggle('covered', covered);
    if (covered) return;
    const el = step.target?.() ?? null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let r: { left: number; top: number; right: number; bottom: number } | null = null;
    if (el) {
      const b = el.getBoundingClientRect();
      const pad = step.pad ?? 8;
      if (b.width || b.height) r = { left: b.left - pad, top: b.top - pad, right: b.right + pad, bottom: b.bottom + pad };
    }
    layer.classList.toggle('pass', !!step.passThrough || !r);
    if (r) {
      const [top, bottom, left, right] = shades;
      Object.assign(top!.style, { left: '0', top: '0', width: `${vw}px`, height: `${Math.max(0, r.top)}px` });
      Object.assign(bottom!.style, { left: '0', top: `${r.bottom}px`, width: `${vw}px`, height: `${Math.max(0, vh - r.bottom)}px` });
      Object.assign(left!.style, { left: '0', top: `${r.top}px`, width: `${Math.max(0, r.left)}px`, height: `${r.bottom - r.top}px` });
      Object.assign(right!.style, { left: `${r.right}px`, top: `${r.top}px`, width: `${Math.max(0, vw - r.right)}px`, height: `${r.bottom - r.top}px` });
      Object.assign(ring.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    } else {
      shades.forEach((s, i) => Object.assign(s.style, i === 0 ? { left: '0', top: '0', width: `${vw}px`, height: `${vh}px` } : { width: '0', height: '0' }));
      ring.style.display = 'none';
    }

    // The hand: on the target, or travelling to where the card goes.
    if (r && step.gesture) {
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      hand.style.display = 'block';
      hand.style.setProperty('--x0', `${cx}px`);
      hand.style.setProperty('--y0', `${cy}px`);
      const to = step.gesture === 'drag' ? step.dragTo?.()?.getBoundingClientRect() : null;
      hand.style.setProperty('--x1', `${to ? to.left + to.width / 2 : cx}px`);
      hand.style.setProperty('--y1', `${to ? to.top + to.height / 2 : cy}px`);
      hand.dataset.gesture = to ? 'drag' : 'tap';
    } else hand.style.display = 'none';

    // The bubble: beside the target where there is room, else centred.
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    let x = (vw - bw) / 2;
    let y = (vh - bh) / 2;
    if (r) {
      const below = vh - r.bottom;
      const above = r.top;
      if (below >= bh + 16) y = r.bottom + 12;
      else if (above >= bh + 16) y = r.top - bh - 12;
      else {
        // No room above or below: to the side.
        y = Math.min(Math.max(8, (r.top + r.bottom) / 2 - bh / 2), vh - bh - 8);
        x = r.right + 12 + bw <= vw - 8 ? r.right + 12 : Math.max(8, r.left - 12 - bw);
      }
      if (below >= bh + 16 || above >= bh + 16) x = Math.min(Math.max(8, (r.left + r.right) / 2 - bw / 2), vw - bw - 8);
    }
    bubble.style.left = `${Math.round(x)}px`;
    bubble.style.top = `${Math.round(y)}px`;
  };

  const loop = (): void => {
    place();
    frame = requestAnimationFrame(loop);
  };

  const end = (ok: boolean): void => {
    if (!current) return;
    const c = current;
    current = null;
    c.cleanup?.();
    c.finish(ok);
  };

  next.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.play('uiClick');
    end(true);
  });
  skip.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.play('uiBack');
    skipped = true;
    end(false);
    coach.close();
    onSkip?.();
  });
  // A tap on the dark does nothing (it only keeps the player on the step).
  shades.forEach((s) => s.addEventListener('click', (e) => e.stopPropagation()));

  const coach: Coach = {
    get skipped() {
      return skipped;
    },
    show(step) {
      if (skipped) return Promise.resolve(false);
      end(true);
      if (!layer.isConnected) {
        document.body.appendChild(layer);
        requestAnimationFrame(() => layer.classList.add('in'));
        loop();
      }
      text.textContent = step.text;
      next.style.display = step.until ? 'none' : '';
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
      return new Promise<boolean>((resolve) => {
        current = { step, finish: resolve };
        if (step.until) current.cleanup = step.until(() => end(true));
        place();
      });
    },
    close() {
      end(!skipped);
      cancelAnimationFrame(frame);
      layer.remove();
      layer.classList.remove('in');
    },
  };
  return coach;
}

/** Waits for a click (or tap) on whatever element `find` returns at that moment. */
export function clickOn(find: () => Element | null): (done: () => void) => () => void {
  return (done) => {
    const onClick = (e: Event): void => {
      const el = find();
      if (el && e.target instanceof Node && el.contains(e.target)) done();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  };
}
