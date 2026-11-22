import type { CardId } from '@cardcraft-castles/engine';
import { h } from '../app/dom';
import { audio } from '../fx/audio';
import { cardFace } from './card';

/** A mouse that can hover (not a finger): there the card grows beside the pointer. */
const canHover = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

let floating: HTMLElement | null = null;

function hideFloating(): void {
  floating?.remove();
  floating = null;
}

/** Hover: a large copy of the card next to the element, kept inside the window. */
function showFloating(anchor: HTMLElement, cardId: CardId): void {
  hideFloating();
  const width = Math.min(250, Math.round(window.innerHeight * 0.62 * (5 / 7)));
  const card = cardFace(cardId);
  card.style.setProperty('--w', `${width}px`);
  floating = h('div.card-zoom-float', { 'aria-hidden': 'true' }, card);
  document.body.appendChild(floating);
  const r = anchor.getBoundingClientRect();
  const height = width * (7 / 5);
  const gap = 12;
  const right = r.right + gap + width <= window.innerWidth - 8;
  const left = right ? r.right + gap : Math.max(8, r.left - gap - width);
  const top = Math.min(Math.max(8, r.top + r.height / 2 - height / 2), window.innerHeight - height - 8);
  floating.style.left = `${left}px`;
  floating.style.top = `${top}px`;
}

/** Tap or click: the card large in the middle of the screen; any tap or Escape closes it. */
export function openCardZoom(cardId: CardId): void {
  hideFloating();
  audio.play('cardSelect');
  const card = cardFace(cardId);
  const layer = h('div.card-zoom-layer', { role: 'dialog', 'aria-modal': 'true' }, card);
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    layer.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  layer.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(layer);
}

/** Lets a small card (or a card's name) be read: it grows on hover and opens large on a click or tap. */
export function attachCardZoom(el: HTMLElement, cardId: CardId): void {
  el.classList.add('zoomable');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('mouseenter', () => canHover() && showFloating(el, cardId));
  el.addEventListener('mouseleave', hideFloating);
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    openCardZoom(cardId);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openCardZoom(cardId);
    }
  });
}
