import {
  RESOURCE_NAMES,
  costResource,
  effectiveCost,
  getCard,
  isComboActive,
  playBlocker,
  type PlayerId,
  type PlayerView,
  type VisibleCard,
} from '@cardcraft-castles/engine';
import { h, html } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { audio } from '../../fx/audio';
import { cardBack, cardFace, glossaryFor } from '../../ui/card';

export interface HandContext {
  view: PlayerView;
  /** Seat whose hand this is. */
  seat: PlayerId;
  /** The player may play or discard now. */
  canAct: boolean;
}

interface Slot {
  uid: number;
  cardId: string | null;
  el: HTMLElement;
}

/** Why a card cannot be played now, in words, or null if it can. */
export function blockReason(ctx: HandContext, cardId: string): string | null {
  if (!ctx.canAct) return t('blockedNotYourTurn');
  const blocker = playBlocker(ctx.view, ctx.seat, cardId);
  if (!blocker) return null;
  if (blocker.code === 'cannotAfford') {
    return t('blockedCannotAfford', { resource: L(RESOURCE_NAMES[costResource(cardId)]), cost: effectiveCost(ctx.view, ctx.seat, cardId) });
  }
  if (blocker.code === 'schoolBanned') return t('blockedSchoolBanned');
  if (blocker.code === 'nothingToCopy') return t('blockedNothingToCopy');
  return blocker.message;
}

/**
 * The local player's hand: a fan of cards that can be inspected, played or
 * discarded by tap, drag or keyboard. Cards are keyed by `uid`, so a
 * re-render keeps existing elements and lets them glide to their new slot.
 */
export class Hand {
  readonly el = h('div.hand', { role: 'list' });
  private slots: Slot[] = [];
  private ctx: HandContext | null = null;
  private selected: number | null = null;
  private drag: { uid: number; el: HTMLElement; startX: number; startY: number; dx: number; dy: number; active: boolean; pointer: number } | null = null;
  /** Where new cards fly in from (the deck), in CSS px. */
  deckPoint = { x: 0, y: 0 };
  /** Drop target for discards. */
  discardTarget: HTMLElement | null = null;
  /**
   * fan: overlapping arc (desktop). row: flat row, little or no overlap
   * (phones in landscape). scroll: a row wider than the screen that scrolls
   * sideways (phones in portrait), so every card is big enough to read.
   */
  mode: 'fan' | 'row' | 'scroll' = 'fan';
  /** Small cards use the compact frame with a readable minimum text size. */
  compact = false;
  /** Where the big hover preview goes (mouse only); null disables it. */
  previewHost: HTMLElement | null = null;
  private preview: { uid: number; el: HTMLElement } | null = null;
  private readonly spacer = h('div.hand-spacer', { 'aria-hidden': 'true' });

  onSelect: (uid: number | null) => void = () => {};
  onPlay: (uid: number) => void = () => {};
  onDiscard: (uid: number) => void = () => {};

  constructor() {
    window.addEventListener('pointermove', (e) => this.dragMove(e));
    window.addEventListener('pointerup', (e) => this.dragEnd(e));
    window.addEventListener('pointercancel', (e) => this.dragEnd(e, true));
  }

  get selectedUid(): number | null {
    return this.selected;
  }

  get context(): HandContext | null {
    return this.ctx;
  }

  cardIdOf(uid: number): string | null {
    return this.slots.find((s) => s.uid === uid)?.cardId ?? null;
  }

  uidAt(index: number): number | null {
    return this.slots[index]?.uid ?? null;
  }

  /** The element of a card in hand (to animate it away). */
  elementOf(uid: number): HTMLElement | null {
    return this.slots.find((s) => s.uid === uid)?.el ?? null;
  }

  /** Takes a card out of the hand without animation (the animator flies it away). */
  detach(uid: number): HTMLElement | null {
    const index = this.slots.findIndex((s) => s.uid === uid);
    if (index < 0) return null;
    const [slot] = this.slots.splice(index, 1);
    this.hidePreview(uid);
    if (this.selected === uid) this.select(null);
    this.layout();
    return slot.el;
  }

  render(cards: readonly VisibleCard[], ctx: HandContext): void {
    this.ctx = ctx;
    const keep = new Map(this.slots.map((s) => [s.uid, s]));
    const next: Slot[] = [];
    for (const card of cards) {
      let slot = keep.get(card.uid);
      if (slot && slot.cardId !== card.cardId) {
        slot.el.remove();
        slot = undefined;
      }
      if (!slot) {
        slot = { uid: card.uid, cardId: card.cardId, el: this.makeCard(card) };
        // New cards start at the deck and glide into place.
        const r = this.el.getBoundingClientRect();
        slot.el.style.transition = 'none';
        slot.el.style.transform = `translate(${this.deckPoint.x - r.left}px, ${this.deckPoint.y - r.top}px) scale(0.4) rotate(-20deg)`;
        slot.el.style.opacity = '0';
        this.el.appendChild(slot.el);
        void slot.el.offsetWidth;
        slot.el.style.transition = '';
        slot.el.style.opacity = '';
      }
      keep.delete(card.uid);
      next.push(slot);
    }
    for (const gone of keep.values()) gone.el.remove();
    this.slots = next;
    if (this.preview && !this.slots.some((s) => s.uid === this.preview!.uid)) this.hidePreview();
    if (this.selected !== null && !this.slots.some((s) => s.uid === this.selected)) this.select(null);
    this.refreshStates();
    this.layout();
  }

  /** Playable / blocked / combo highlights and live costs. */
  refreshStates(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const slot of this.slots) {
      if (!slot.cardId) continue;
      const card = getCard(slot.cardId);
      const reason = blockReason(ctx, slot.cardId);
      const myTurn = ctx.canAct;
      slot.el.classList.toggle('playable', myTurn && !reason);
      slot.el.classList.toggle('blocked', myTurn && !!reason);
      slot.el.classList.toggle('combo', myTurn && !reason && isComboActive(ctx.view, ctx.seat, slot.cardId));
      const cost = effectiveCost(ctx.view, ctx.seat, slot.cardId);
      const costEl = slot.el.querySelector('.cost');
      const span = costEl?.querySelector('span');
      if (span && span.textContent !== String(cost)) span.textContent = String(cost);
      costEl?.classList.toggle('down', cost < card.cost);
      costEl?.classList.toggle('up', cost > card.cost);
    }
  }

  /** Positions the cards in a fan (or a flat row on narrow screens). */
  layout(): void {
    const n = this.slots.length;
    this.el.classList.toggle('scroll', this.mode === 'scroll');
    if (!this.spacer.isConnected) this.el.prepend(this.spacer);
    if (n === 0) return;
    const width = this.el.clientWidth;
    const cardW = parseFloat(getComputedStyle(this.el).getPropertyValue('--card-w')) || 150;
    const flat = this.mode !== 'fan';
    const scroll = this.mode === 'scroll';
    const pad = scroll ? 10 : 0;
    const gap = scroll ? cardW + 8 : Math.min(flat ? cardW + 8 : cardW * 0.94, (width - cardW) / Math.max(1, n - 1));
    const total = gap * (n - 1) + cardW;
    const start = scroll ? Math.max(pad, (width - total) / 2) : (width - total) / 2;
    this.spacer.style.width = scroll ? `${total + pad * 2}px` : '0px';
    const mid = (n - 1) / 2;
    this.slots.forEach((slot, i) => {
      slot.el.classList.toggle('compact', this.compact);
      const x = start + gap * i;
      const off = i - mid;
      const rot = flat ? 0 : off * 3.2;
      const y = flat ? 0 : off * off * 3.2;
      const lifted = slot.uid === this.selected && !scroll ? -cardW * 0.22 : 0;
      slot.el.style.setProperty('--x', `${x}px`);
      slot.el.style.setProperty('--y', `${y + lifted}px`);
      slot.el.style.setProperty('--r', `${rot}deg`);
      slot.el.style.zIndex = String(slot.uid === this.selected ? 50 : 10 + i);
      if (!this.drag || this.drag.uid !== slot.uid || !this.drag.active) slot.el.style.transform = '';
      slot.el.classList.toggle('selected', slot.uid === this.selected);
    });
  }

  /** Big readable copy of the hovered card above the hand (mouse only). */
  private showPreview(uid: number): void {
    const host = this.previewHost;
    const slot = this.slots.find((s) => s.uid === uid);
    if (!host || !slot?.cardId || this.selected !== null) return;
    this.hidePreview();
    const big = cardFace(slot.cardId, { calm: true });
    const costEl = slot.el.querySelector('.cost');
    if (costEl) big.querySelector('.cost')?.replaceWith(costEl.cloneNode(true));
    big.classList.add('hover-preview');
    big.classList.toggle('combo', slot.el.classList.contains('combo'));
    big.classList.toggle('blocked', slot.el.classList.contains('blocked'));
    const r = slot.el.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const handTop = this.el.getBoundingClientRect().top;
    // As large as the inspect view, standing on the hand and kept on screen.
    const w = Math.round(Math.min(300, Math.max(200, (handTop - hostRect.top - 70) / 1.4)));
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    big.style.setProperty('--w', `${w}px`);
    big.style.left = `${x - hostRect.left}px`;
    big.style.top = `${Math.max(64, handTop - w * 1.4 - 12) - hostRect.top}px`;
    host.appendChild(big);
    this.preview = { uid, el: big };
  }

  hidePreview(uid?: number): void {
    if (!this.preview || (uid !== undefined && this.preview.uid !== uid)) return;
    this.preview.el.remove();
    this.preview = null;
  }

  select(uid: number | null): void {
    this.hidePreview();
    if (this.selected === uid) return;
    this.selected = uid;
    if (uid !== null) audio.play('cardSelect');
    this.layout();
    this.onSelect(uid);
  }

  private makeCard(card: VisibleCard): HTMLElement {
    const el = card.cardId ? cardFace(card.cardId, { tilt: true, calm: true }) : cardBack();
    el.classList.add('hand-card');
    el.setAttribute('role', 'listitem');
    el.tabIndex = 0;
    el.dataset.uid = String(card.uid);
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      audio.play('cardHover');
      if (!this.drag?.active) this.showPreview(card.uid);
    });
    el.addEventListener('pointerleave', () => this.hidePreview(card.uid));
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.hidePreview();
      this.drag = { uid: card.uid, el, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, active: false, pointer: e.pointerId };
    });
    el.addEventListener('click', () => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.select(this.selected === card.uid ? null : card.uid);
    });
    el.addEventListener('dblclick', () => this.onPlay(card.uid));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.selected === card.uid) this.onPlay(card.uid);
        else this.select(card.uid);
      }
    });
    return el;
  }

  private suppressClick = false;

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    d.dx = e.clientX - d.startX;
    d.dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(d.dx, d.dy) < 12) return;
      // In a scrolling hand a sideways swipe scrolls; only an upward pull drags.
      if (!this.ctx?.canAct || (this.mode === 'scroll' && Math.abs(d.dx) > Math.abs(d.dy))) {
        this.drag = null;
        return;
      }
      d.active = true;
      this.hidePreview();
      d.el.classList.add('dragging');
      this.el.classList.add('has-drag');
      try {
        d.el.setPointerCapture(e.pointerId);
      } catch {
        // Not critical.
      }
    }
    d.el.style.transform = `translate(calc(var(--x) + ${d.dx}px), calc(var(--y) + ${d.dy}px)) scale(1.08)`;
    const zone = this.dropZone(e.clientX, e.clientY);
    this.el.dataset.drop = zone ?? '';
    this.discardTarget?.classList.toggle('drop-hover', zone === 'discard');
  }

  private dragEnd(e: PointerEvent, cancelled = false): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    if (!d.active) return;
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 50);
    d.el.classList.remove('dragging');
    this.el.classList.remove('has-drag');
    this.discardTarget?.classList.remove('drop-hover');
    this.el.dataset.drop = '';
    const zone = cancelled ? null : this.dropZone(e.clientX, e.clientY);
    d.el.style.transform = '';
    if (zone === 'play') this.onPlay(d.uid);
    else if (zone === 'discard') this.onDiscard(d.uid);
  }

  private dropZone(x: number, y: number): 'play' | 'discard' | null {
    const target = this.discardTarget?.getBoundingClientRect();
    if (target && x >= target.left - 20 && x <= target.right + 20 && y >= target.top - 20 && y <= target.bottom + 20) return 'discard';
    const handTop = this.el.getBoundingClientRect().top;
    return y < handTop - 30 ? 'play' : null;
  }
}

/**
 * Big view of the selected card with Play / Discard and the keyword
 * glossary. Also used to inspect enchantments, heroes and opponent cards
 * (without actions).
 */
export function inspectPanel(opts: {
  card: HTMLElement;
  text: string;
  actions?: { play: () => void; discard: () => void; reason: string | null; canAct: boolean };
  close: () => void;
}): HTMLElement {
  const gloss = glossaryFor(opts.text);
  const a = opts.actions;
  return h(
    'div.inspect',
    { onclick: (e: Event) => e.target === e.currentTarget && opts.close() },
    h(
      'div.inspect-box',
      null,
      h('div.inspect-card', null, opts.card),
      h(
        'div.inspect-side',
        null,
        gloss.length
          ? h(
              'dl.glossary',
              null,
              gloss.flatMap((g) => [h('dt', null, g.word), h('dd', null, g.text)]),
            )
          : null,
        a && a.reason ? h('p.inspect-reason', null, a.reason) : null,
        a
          ? h(
              'div.inspect-actions',
              null,
              h('button.btn.primary.big', { type: 'button', disabled: !!a.reason, onclick: a.play }, t('play')),
              h('button.btn', { type: 'button', disabled: !a.canAct, onclick: a.discard }, t('discard')),
              h('button.btn.ghost', { type: 'button', onclick: opts.close }, t('cancel')),
            )
          : h('div.inspect-actions', null, h('button.btn', { type: 'button', onclick: opts.close }, t('close'))),
        a && a.canAct ? h('p.inspect-hint', null, html(t('dragHint'))) : null,
      ),
    ),
  );
}
