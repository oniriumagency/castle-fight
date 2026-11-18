import {
  RESOURCES,
  RESOURCE_NAMES,
  TERMS,
  WORKER_NAMES,
  enchantmentLife,
  getCard,
  getHero,
  type PlayerPublicState,
  type Resource,
} from '@cardcraft-castles/engine';
import { h, html } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { artUrl, emblemSvg, iconSvg, type EmblemName } from '../../ui/assets';
import { discardOverlay, parseHistoryEntry, ultimateHtml } from '../../ui/card';
import { heroCss } from '../../ui/theme';

const RESOURCE_EMBLEM: Record<Resource, EmblemName> = { piedra: 'piedra', acero: 'acero', mana: 'mana' };

export interface SideInfo {
  nickname: string;
  isAi?: boolean;
  /** This player is to move. */
  active: boolean;
  /** The ultimate can be used from this device right now. */
  canUltimate: boolean;
  /** This seat is played from this device. */
  mine: boolean;
}

/**
 * One player's panel: hero portrait with the ultimate ring, resources with
 * their workers, statuses and enchantments. Built once; `update` only
 * touches what changed so it can run on every animation step.
 */
export class SidePanel {
  readonly el: HTMLElement;
  readonly portrait: HTMLButtonElement;
  private readonly ring: SVGCircleElement;
  private readonly name: HTMLElement;
  private readonly heroName: HTMLElement;
  private readonly heroImg: HTMLImageElement;
  private readonly rows = new Map<Resource, { row: HTMLElement; amount: HTMLElement; workers: HTMLElement; frost: HTMLElement }>();
  private readonly statuses: HTMLElement;
  private readonly enchantments: HTMLElement;
  private readonly piles: HTMLElement;
  private readonly presence: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly history: HTMLElement;
  private historyKey = '';
  private heroId = '';
  private lastKey = '';
  onInspect: (cardId: string) => void = () => {};
  onInspectHero: (heroId: string) => void = () => {};
  /** The mouse is on a card of the history: show it large next to `anchor` (null: hide). */
  onPreview: (cardId: string | null, anchor?: DOMRect) => void = () => {};

  constructor(readonly side: number) {
    const ringRadius = 46;
    const circumference = 2 * Math.PI * ringRadius;
    this.portrait = h('button.portrait', { type: 'button' }) as HTMLButtonElement;
    this.portrait.innerHTML = `
      <svg class="ult-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="track" cx="50" cy="50" r="${ringRadius}"/>
        <circle class="fill" cx="50" cy="50" r="${ringRadius}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"/>
      </svg>
      <img alt="" draggable="false">
      <span class="ult-label"></span>`;
    this.ring = this.portrait.querySelector('circle.fill')!;
    this.ring.dataset.c = String(circumference);
    this.heroImg = this.portrait.querySelector('img')!;
    // The ultimate is fired from the hero button next to the hand; the portrait shows the hero.
    this.portrait.addEventListener('click', () => this.onInspectHero(this.heroId));

    this.history = h('div.played-history', { 'aria-label': t('playedHistory') });

    this.name = h('strong.player-name');
    this.heroName = h('span.hero-name');
    this.statuses = h('div.statuses');
    this.enchantments = h('div.enchants');
    this.piles = h('div.piles-mini');
    this.presence = h('div.presence');
    this.bubble = h('div.emote-bubble', { 'aria-live': 'polite' });

    const resources = h('div.resources');
    for (const res of RESOURCES) {
      const amount = h('span.res-amount');
      const workers = h('span.res-workers');
      const frost = h('span.res-frost');
      const row = h(
        'div.res-row',
        { class: `res-${res}`, 'data-res': res },
        h('span.res-icon', null, html(emblemSvg(RESOURCE_EMBLEM[res]))),
        amount,
        h('span.res-meta', null, workers, frost),
      );
      this.rows.set(res, { row, amount, workers, frost });
      resources.appendChild(row);
    }

    this.el = h(
      'section.side',
      // The middle castle's panel (free-for-all) stands in the right column under the other rival's, so it shares its look.
      { class: side === 2 ? 'side-2 side-1' : `side-${side}` },
      h('div.who', null, this.portrait, h('div.names', null, this.name, this.heroName), this.bubble),
      this.presence,
      resources,
      this.statuses,
      this.enchantments,
      this.piles,
      this.history,
    );
  }

  /** Resource row element, for floating numbers. */
  resourceRow(res: Resource): HTMLElement {
    return this.rows.get(res)!.row;
  }

  update(p: PlayerPublicState, info: SideInfo): void {
    if (p.hero !== this.heroId) {
      this.heroId = p.hero;
      this.heroImg.src = artUrl(getHero(p.hero).art);
      this.el.style.setProperty('--hero', heroCss(p.hero));
    }
    this.name.textContent = info.nickname;
    this.heroName.textContent = L(getHero(p.hero).name);
    this.el.classList.toggle('active', info.active);
    // Free-for-all: a fallen castle stays on the board, greyed out.
    this.el.classList.toggle('eliminated', !!p.eliminated);

    // Ultimate ring.
    const c = Number(this.ring.dataset.c);
    const progress = p.ultimateReady ? 1 : Math.min(1, p.ultimateCharge / Math.max(1, p.ultimateThreshold));
    this.ring.style.strokeDashoffset = String(c * (1 - progress));
    this.portrait.classList.toggle('ready', p.ultimateReady);
    const label = this.portrait.querySelector('.ult-label')!;
    label.textContent = p.ultimateReady ? t('ultimateReady') : `${p.ultimateCharge}/${p.ultimateThreshold}`;
    const progressText = t('ultimateProgress', { charge: p.ultimateCharge, threshold: p.ultimateThreshold });
    const effect = document.createElement('span');
    effect.innerHTML = ultimateHtml(p.hero);
    this.portrait.title = `${p.ultimateReady ? t('ultimateReady') : progressText}\n${t('ultimate')}: ${effect.textContent ?? ''}`;
    this.portrait.setAttribute('aria-label', `${L(getHero(p.hero).name)}. ${this.portrait.title}`);

    for (const res of RESOURCES) {
      const r = this.rows.get(res)!;
      r.amount.textContent = String(p.resources[res]);
      r.workers.innerHTML = `${iconSvg('worker')}+${p.workers[res]}`;
      r.workers.title = `${p.workers[res]} ${L(WORKER_NAMES[res])}: ${t('production', { n: p.workers[res] })}`;
      const frozen = p.frost[res];
      r.row.classList.toggle('frozen', frozen > 0);
      r.frost.innerHTML = frozen > 0 ? `${iconSvg('frost')}${frozen}` : '';
      r.frost.title = frozen > 0 ? t('frozenTurns', { n: frozen }) : '';
      r.row.title = `${L(RESOURCE_NAMES[res])}: ${p.resources[res]}`;
    }

    // Statuses and enchantments change rarely; rebuild only when they do.
    const key = JSON.stringify([p.burn, p.shield, p.drawbridge, p.handRevealed, p.extraTurns, p.enchantments, p.deckCount, p.discardCount]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const chips: HTMLElement[] = [];
    if (p.burn > 0) chips.push(this.chip('burn', String(p.burn), t('burnTurns', { n: p.burn }), 'burn'));
    if (p.shield > 0) chips.push(this.chip('shield', String(p.shield), t('shieldCharges', { n: p.shield }), 'shield'));
    if (p.drawbridge) chips.push(this.chip('drawbridge', '', t('drawbridgeUp'), 'drawbridge'));
    if (p.handRevealed) chips.push(this.chip('eye', '', t('handVisible'), 'revealed'));
    if (p.extraTurns > 0) chips.push(this.chip('combo', `+${p.extraTurns}`, t('extraTurn'), 'extra'));
    this.statuses.replaceChildren(...chips);

    this.enchantments.replaceChildren(
      ...p.enchantments.map((e) => {
        const card = getCard(e.cardId);
        const el = h(
          'button.enchant',
          {
            type: 'button',
            class: `s-${card.school}`,
            'data-card': e.cardId,
            title: `${L(card.name)} · ${e.charges !== undefined ? t('attacksLeft', { n: e.charges }) : t('turnsLeft', { n: e.turnsLeft })}`,
            onclick: () => this.onInspect(e.cardId),
          },
          h('img', { src: artUrl(card.art), alt: L(card.name), draggable: 'false', onerror: hideMissingArt }),
          h('span.enchant-turns', null, String(enchantmentLife(e))),
        );
        return el;
      }),
    );

    this.piles.innerHTML = `<span title="${L(TERMS.deck)}">${iconSvg('book')} ${p.deckCount}</span>`;
  }

  /** The last cards this player played, newest first; the newest is shown larger. */
  /** `entries` are history entries (see `historyEntry`): played or discarded cards, newest first. */
  setHistory(entries: readonly string[]): void {
    const key = entries.join('|');
    if (key === this.historyKey) return;
    this.historyKey = key;
    this.onPreview(null);
    this.history.replaceChildren(
      ...entries.map((entry, i) => {
        const { cardId, discarded } = parseHistoryEntry(entry);
        const card = getCard(cardId);
        const name = discarded ? `${L(card.name)} (${t('discardedStamp')})` : L(card.name);
        const el = h(
          'button.hist-card',
          {
            type: 'button',
            class: `s-${card.school} r-${card.rarity}${i === 0 ? ' newest' : ''}${discarded ? ' discarded' : ''}`,
            title: name,
            'aria-label': `${name}: ${L(card.text)}`,
            onclick: () => {
              this.onPreview(null);
              this.onInspect(entry);
            },
          },
          h('img', { src: artUrl(card.art), alt: '', draggable: 'false', onerror: hideMissingArt }),
          h('span.hist-cost', null, String(card.cost)),
          discarded ? discardOverlay() : null,
        );
        el.addEventListener('pointerenter', (e) => {
          if (e.pointerType === 'mouse') this.onPreview(entry, el.getBoundingClientRect());
        });
        el.addEventListener('pointerleave', () => this.onPreview(null));
        return el;
      }),
    );
    this.history.hidden = entries.length === 0;
  }

  /** Online presence: a dropped opponent shows a countdown. */
  setPresence(text: string | null): void {
    this.presence.textContent = text ?? '';
    this.presence.classList.toggle('show', !!text);
  }

  showEmote(text: string): void {
    this.bubble.textContent = text;
    this.bubble.classList.remove('show');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('show');
  }

  /** Brief highlight on part of the panel (status applied, resource changed...). */
  pulse(selector: string): void {
    const el = this.el.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  private chip(icon: Parameters<typeof iconSvg>[0], text: string, title: string, cls: string): HTMLElement {
    return h('span.status-chip', { class: cls, title, 'aria-label': title }, html(iconSvg(icon)), text);
  }
}

/** Keep and Wall numbers under a castle, with progress toward the winning Keep. */
export class CastlePlaque {
  readonly el: HTMLElement;
  private readonly keep: HTMLElement;
  private readonly wall: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly name: HTMLElement;

  constructor(side: number, private keepWin: number) {
    this.name = h('span.plaque-name');
    this.keep = h('span.plaque-num');
    this.wall = h('span.plaque-num');
    this.bar = h('span.plaque-bar-fill');
    this.el = h(
      'div.plaque',
      { class: `plaque-${side}` },
      this.name,
      h('span.plaque-item.keep', { title: L(TERMS.keep) }, html(iconSvg('keep')), this.keep),
      h('span.plaque-item.wall', { title: L(TERMS.wall) }, html(iconSvg('wall')), this.wall),
      h('span.plaque-bar', null, this.bar),
    );
  }

  setKeepWin(keepWin: number): void {
    this.keepWin = keepWin;
  }

  /** The player's gametag, above the numbers; it lights up on their turn. */
  setName(name: string, active: boolean): void {
    if (this.name.textContent !== name) {
      this.name.textContent = name;
      this.name.title = name;
    }
    this.el.classList.toggle('active', active);
  }

  update(keep: number, wall: number): void {
    this.keep.textContent = String(Math.round(keep));
    this.wall.textContent = String(Math.round(wall));
    this.bar.style.width = `${Math.max(0, Math.min(100, (keep / this.keepWin) * 100))}%`;
    this.el.classList.toggle('danger', keep <= this.keepWin * 0.12);
    this.el.classList.toggle('near-win', keep >= this.keepWin * 0.85);
  }

  place(x: number, y: number): void {
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}

/** A card whose illustration is not painted yet leaves its thumbnail empty instead of showing a broken image. */
function hideMissingArt(e: Event): void {
  (e.target as HTMLElement).style.visibility = 'hidden';
}
