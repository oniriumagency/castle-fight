import { clear, h } from './dom';
import { audio } from '../fx/audio';
import { closeX } from '../ui/closeX';

/** A full-screen view: menu, lobby, hero select, board, results. */
export interface Screen {
  el: HTMLElement;
  /** Called after the element is in the document. */
  mount?(): void;
  /** Called before the element is removed. */
  unmount?(): void;
  /** Window size changed. */
  resize?(): void;
  /** Interface language changed: rebuild texts. */
  relocalize?(): void;
}

let current: Screen | null = null;
const host = (): HTMLElement => document.getElementById('screen')!;

/** Cross-fades to another screen. */
export function show(next: Screen): void {
  const previous = current;
  current = next;
  if (previous) {
    previous.unmount?.();
    const old = previous.el;
    old.classList.remove('in');
    old.style.pointerEvents = 'none';
    setTimeout(() => old.remove(), 380);
  } else {
    clear(host());
  }
  next.el.classList.add('screen');
  host().appendChild(next.el);
  next.mount?.();
  requestAnimationFrame(() => requestAnimationFrame(() => next.el.classList.add('in')));
}

export function currentScreen(): Screen | null {
  return current;
}

window.addEventListener('resize', () => current?.resize?.());

/** Modal dialog in the overlay layer. Resolves when it closes. */
export function modal(build: (close: () => void) => HTMLElement, opts: { dismissable?: boolean } = {}): () => void {
  const overlay = document.getElementById('overlay')!;
  const box = build(() => close());
  // Every dialog that can be dismissed gets the red X in its corner.
  if (opts.dismissable !== false) box.append(closeX(() => close()));
  const backdrop = h('div.modal-backdrop', { role: 'dialog', 'aria-modal': 'true' }, box);
  let closed = false;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && opts.dismissable !== false) close();
  };
  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    backdrop.classList.remove('in');
    setTimeout(() => backdrop.remove(), 260);
  }
  if (opts.dismissable !== false) {
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close();
    });
  }
  window.addEventListener('keydown', onKey, true);
  overlay.appendChild(backdrop);
  audio.play('uiOpen');
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('in')));
  const focusable = box.querySelector<HTMLElement>('button, input');
  focusable?.focus({ preventScroll: true });
  return close;
}
