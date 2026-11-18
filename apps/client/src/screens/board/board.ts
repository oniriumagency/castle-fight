import {
  DEFAULT_RULES,
  RESOURCES,
  getBattleEvent,
  getCard,
  getHero,
  other,
  type GameEvent,
  type HeroId,
  type PlayerId,
  type PlayerPublicState,
  type PlayerView,
  type VisibleCard,
} from '@cardcraft-castles/engine';
import type { PlayerAction } from '@cardcraft-castles/protocol';
import { h, html, toast } from '../../app/dom';
import { askNotificationPermission, callAttention } from '../../app/attention';
import { boostTag, comboBonusText } from '../../game/combo';
import { L, t } from '../../app/i18n';
import { modal, type Screen } from '../../app/router';
import { animScale, settings } from '../../app/settings';
import { battlefield } from '../../app/stage';
import { audio } from '../../fx/audio';
import { fx, type FxContext } from '../../fx/director';
import { describeEvent } from '../../game/describe';
import type { MatchSession, Presence, SessionEvent } from '../../game/session';
import { MatchStats } from '../../game/stats';
import { artUrl, iconSvg, preloadArt } from '../../ui/assets';
import { cardBack, cardFace, eventCard, heroCard, historyEntry, markDiscarded, parseHistoryEntry } from '../../ui/card';
import { closeX } from '../../ui/closeX';
import { skyFor } from '../../ui/theme';
import { openHowToPlay } from '../howToPlay';
import { openSettings } from '../settingsModal';
import { Hand, blockReason, inspectPanel, type InspectPanel } from './hand';
import { CastlePlaque, SidePanel } from './hud';
import { showResults } from './results';
import { muteButton } from '../../ui/muteButton';

type StateUpdate = Extract<SessionEvent, { type: 'state' }>;

const EMOTES = ['greetings', 'wellPlayed', 'thanks', 'wow', 'oops', 'threaten'] as const;
const EMOTE_TEXT: Record<(typeof EMOTES)[number], { es: string; en: string }> = {
  greetings: { es: '¡Saludos!', en: 'Greetings!' },
  wellPlayed: { es: '¡Bien jugado!', en: 'Well played!' },
  thanks: { es: '¡Gracias!', en: 'Thanks!' },
  wow: { es: '¡Increíble!', en: 'Wow!' },
  oops: { es: '¡Uy!', en: 'Oops!' },
  threaten: { es: '¡Tu castillo caerá!', en: 'Your castle will fall!' },
};

function clonePlayer(p: PlayerPublicState): PlayerPublicState {
  return structuredClone(p);
}

/** Cards shown in each player's played history. */
const HISTORY_SIZE = 3;

/** One state update's animations may take this long at most; then the board shows the result. */
const MAX_ANIMATION_MS = 20_000;
/** An action unanswered for this long no longer blocks the board. */
const AWAIT_ANSWER_MS = 6000;

const wait = (base: number): Promise<void> => new Promise((r) => setTimeout(r, base * animScale()));

export function boardScreen(session: MatchSession): Screen {
  return new BoardScreen(session);
}

/**
 * The game table. The Pixi battlefield draws the castles behind; this
 * screen lays the interface over it: both players' panels, the hand, the
 * opponent's hand, the piles, the played card, the turn clock and the
 * battle event. Every state from the session is animated event by event,
 * then the screen snaps to the authoritative view.
 */
class BoardScreen implements Screen {
  readonly el: HTMLElement;
  private readonly field = battlefield();
  private readonly panels: [SidePanel, SidePanel] = [new SidePanel(0), new SidePanel(1)];
  private readonly plaques: [CastlePlaque, CastlePlaque];
  private readonly hand = new Hand();
  private readonly oppHand = h('div.opp-hand', { 'aria-label': 'opponent hand' });
  private readonly stage = h('div.play-stage');
  private readonly floaters = h('div.floaters', { 'aria-hidden': 'true' });
  private readonly banner = h('div.turn-banner', { 'aria-live': 'polite' });
  private readonly deckPile = h('div.pile.deck-pile');
  private readonly discardPile = h('div.pile.discard-pile');
  private readonly turnLabel = h('div.turn-label');
  private readonly timer = h('div.timer', { hidden: true });
  private readonly eventChip = h('button.event-chip', { type: 'button' });
  private readonly layer = h('div.inspect-layer');
  private readonly logList = h('ol.log-list');
  private readonly logPanel: HTMLElement;
  private readonly curtain = h('div.curtain', { hidden: true });
  private readonly statusBar = h('div.conn-status', { hidden: true });

  private view: PlayerView | null = null;
  private shown: [PlayerPublicState, PlayerPublicState] | null = null;
  private shownActive: PlayerId = 0;
  private handSeat: PlayerId | null = null;
  private handModel: VisibleCard[] = [];
  private queue: StateUpdate[] = [];
  private busy = false;
  private awaiting = false;
  /** When the last action went out, to notice an answer that never comes. */
  private awaitingSince = 0;
  /** Closes the open choice dialog, if any. */
  private closeChoice: (() => void) | null = null;
  private deadline: number | null = null;
  private lastTick = -1;
  private curtainFor: PlayerId | null = null;
  private stats = new MatchStats();
  private unsubscribe: () => void = () => {};
  private unsubscribeSettings: () => void = () => {};
  private raf = 0;
  private backgroundTimer = 0;
  private playedCard: HTMLElement | null = null;
  private closeInspect: (() => void) | null = null;
  private resultsShown = false;
  private presence: Presence | null = null;
  private destroyed = false;

  constructor(private readonly session: MatchSession) {
    const keepWin = DEFAULT_RULES.keepWin;
    this.plaques = [new CastlePlaque(0, keepWin), new CastlePlaque(1, keepWin)];
    this.logPanel = h('aside.log-panel', { hidden: true }, h('h3', null, t('log')), this.logList);

    const menuBtn = h('button.btn.icon-only.menu-btn', { type: 'button', 'aria-label': t('menu'), onclick: () => this.openMenu() }, html(iconSvg('menu')));
    const logBtn = h(
      'button.btn.icon-only',
      {
        type: 'button',
        'aria-label': t('log'),
        onclick: () => {
          audio.play('uiClick');
          this.logPanel.hidden = !this.logPanel.hidden;
        },
      },
      html(iconSvg('scroll')),
    );
    const emoteBtn = session.emote ? this.emoteButton() : null;

    this.deckPile.append(cardBack(), h('span.pile-count'));
    this.discardPile.append(h('div.pile-empty'), h('span.pile-count'));
    this.hand.discardTarget = this.discardPile;
    // The last card played sits on the discard pile: hover it to read it, click or tap to inspect it.
    this.discardPile.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') this.showPilePreview();
    });
    this.discardPile.addEventListener('pointerleave', () => this.hidePilePreview());
    this.discardPile.addEventListener('click', () => {
      const id = this.discardTopId();
      if (!id) return;
      this.hidePilePreview();
      this.inspectCard(id, this.discardHero, this.discardTopDiscarded);
    });
    this.eventChip.addEventListener('click', () => this.inspectEvent());

    this.el = h(
      'div.board',
      { class: `mode-${session.kind}` },
      h('div.topbar', null, menuBtn, h('div.turn-box', null, this.turnLabel, this.timer), this.eventChip, h('div.top-right', null, emoteBtn, muteButton(), logBtn)),
      this.panels[0].el,
      this.panels[1].el,
      h('div.board-field', null, this.plaques[0].el, this.plaques[1].el, h('div.piles', null, this.deckPile, this.discardPile)),
      this.oppHand,
      this.stage,
      this.hand.el,
      this.floaters,
      this.banner,
      this.statusBar,
      this.logPanel,
      this.layer,
      this.curtain,
    );

    for (const panel of this.panels) {
      panel.onUltimate = () => this.act({ type: 'ultimate', player: this.view?.viewer ?? 0 });
      panel.onInspect = (entry) => {
        const { cardId, discarded } = parseHistoryEntry(entry);
        this.inspectCard(cardId, this.heroOf(this.seatOfSide(panel.side)), discarded);
      };
      panel.onInspectHero = (heroId) => this.inspectHero(heroId);
      panel.onPreview = (cardId, anchor) => {
        if (cardId && anchor) {
          const entry = parseHistoryEntry(cardId);
          this.showCardPreview(entry.cardId, anchor, panel.side === 0 ? 'right' : 'left', this.heroOf(this.seatOfSide(panel.side)), entry.discarded);
        }
        else this.hidePilePreview();
      };
    }
    this.hand.onSelect = (uid) => this.onSelect(uid);
    this.hand.onPlay = (uid) => this.tryPlay(uid);
    this.hand.onDiscard = (uid) => this.tryDiscard(uid);
  }

  // ---------------------------------------------------------------------------
  // Screen lifecycle
  // ---------------------------------------------------------------------------

  mount(): void {
    audio.music('battle');
    void preloadArt([...this.session.seats.map((s) => getHero(s.hero).art)]);
    this.field.setHeroes([this.session.seats[this.seatOfSide(0)].hero, this.session.seats[this.seatOfSide(1)].hero]);
    this.layout();
    this.unsubscribe = this.session.subscribe((e) => this.onSession(e));
    window.addEventListener('keydown', this.onKey);
    // Online, the browser can call the player back when it is their turn: ask on their first click.
    if (this.session.kind === 'online') this.el.addEventListener('pointerdown', askNotificationPermission, { once: true });
    this.unsubscribeSettings = settings.subscribe((next, prev) => {
      if (next.locale !== prev.locale) this.relocalize();
    });
    const loop = (): void => {
      this.tickTimer();
      this.tickPresence();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // No frames in a background tab: keep the turn clock (and its ticks) going.
    this.backgroundTimer = window.setInterval(() => {
      if (!document.hidden) return;
      this.tickTimer();
      this.tickPresence();
      this.watchdog();
    }, 250);
  }

  unmount(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.unsubscribeSettings();
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.backgroundTimer);
    window.removeEventListener('keydown', this.onKey);
    this.closeInspect?.();
    this.session.leave();
    void this.field.setMood(skyFor(null), 600);
    this.field.setShield(0, 0);
    this.field.setShield(1, 0);
    this.field.setAura(0, { burn: 0, frost: 0, danger: 0 });
    this.field.setAura(1, { burn: 0, frost: 0, danger: 0 });
    audio.setTension(0);
  }

  resize(): void {
    requestAnimationFrame(() => this.layout());
  }

  relocalize(): void {
    this.render();
    this.logPanel.querySelector('h3')!.textContent = t('log');
  }

  // ---------------------------------------------------------------------------
  // Seats and sides
  // ---------------------------------------------------------------------------

  /** Seat shown on the left: the local player, or player 1 on a shared device. */
  private get leftSeat(): PlayerId {
    if (this.session.kind === 'local') return 0;
    if (this.session.isLocal(1) && !this.session.isLocal(0)) return 1;
    return 0;
  }

  private sideOf(seat: PlayerId): 0 | 1 {
    return seat === this.leftSeat ? 0 : 1;
  }

  private heroOf(seat: PlayerId): HeroId {
    return this.view?.players[seat].hero ?? this.session.seats[seat].hero;
  }

  private seatOfSide(side: 0 | 1): PlayerId {
    return side === 0 ? this.leftSeat : other(this.leftSeat);
  }

  private name(seat: PlayerId): string {
    return this.session.seats[seat]?.nickname ?? '?';
  }

  private fxContext(): FxContext {
    return {
      field: this.field,
      side: (seat) => this.sideOf(seat),
      float: (text, x, y, kind) => this.float(text, x, y, kind),
    };
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  private layout(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const portrait = hgt > w;
    const short = !portrait && hgt < 520;
    const touch = matchMedia('(hover: none)').matches;
    // Phones get a hand made to be read: no overlap, no part below the edge.
    const phonePortrait = portrait && w < 640;
    let cardW: number;
    let peek: number;
    if (phonePortrait) {
      cardW = Math.min(w * 0.31, hgt * 0.17, 150);
      peek = 0;
      this.hand.mode = 'scroll';
    } else if (short) {
      cardW = Math.min((w - 40) / 6.25, (hgt * 0.4) / 1.4);
      peek = 0.05;
      this.hand.mode = 'row';
    } else {
      cardW = Math.min(w * 0.115, hgt * 0.2, 176);
      if (portrait) cardW = Math.min(w * 0.16, hgt * 0.15, 176);
      // With a mouse the cards rest partly below the edge and rise on hover.
      peek = touch ? 0 : 0.3;
      this.hand.mode = w < 700 || touch ? 'row' : 'fan';
    }
    cardW = Math.round(Math.max(72, cardW));
    this.hand.compact = cardW < 150;
    this.hand.previewHost = touch ? null : this.layer;
    this.el.style.setProperty('--card-w', `${cardW}px`);
    this.el.style.setProperty('--peek-f', String(peek));
    this.el.classList.toggle('short', short);
    this.el.classList.toggle('narrow', w < 760);
    this.el.classList.toggle('phone-portrait', phonePortrait);
    this.el.classList.toggle('touch', touch);

    const left = this.panels[0].el.getBoundingClientRect();
    const right = this.panels[1].el.getBoundingClientRect();
    const top = this.el.querySelector('.topbar')!.getBoundingClientRect();
    // Top of the resting hand, plus room for the castle plaques.
    const handTop = hgt - 6 - cardW * 1.4 * (1 - peek) - (phonePortrait ? 6 : 0);
    const plaqueRoom = short ? 30 : 46;
    const fieldLeft = portrait ? 0 : left.right;
    const fieldRight = portrait ? w : right.left;
    const fieldTop = portrait ? Math.max(top.bottom, left.bottom, right.bottom) : top.bottom;
    const rect = { left: fieldLeft, top: fieldTop, width: Math.max(200, fieldRight - fieldLeft), height: Math.max(90, (handTop - plaqueRoom - fieldTop) / 0.94) };
    this.field.layout(rect);
    const fieldEl = this.el.querySelector<HTMLElement>('.board-field')!;
    Object.assign(fieldEl.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    for (const side of [0, 1] as const) {
      const base = this.field.anchor(side, 'base');
      this.plaques[side].place(base.x - rect.left, base.y - rect.top + 4);
    }
    const deck = this.deckPile.getBoundingClientRect();
    this.hand.deckPoint = { x: deck.left, y: deck.top };
    this.hand.layout();
    if (this.shown) this.field.setCastles(this.castleValues());
  }

  private castleValues(): [{ keep: number; wall: number }, { keep: number; wall: number }] {
    const s = this.shown!;
    const a = s[this.seatOfSide(0)];
    const b = s[this.seatOfSide(1)];
    return [
      { keep: a.keep, wall: a.wall },
      { keep: b.keep, wall: b.wall },
    ];
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  private onSession(e: SessionEvent): void {
    if (this.destroyed) return;
    switch (e.type) {
      case 'state':
        this.awaiting = false;
        if (e.deadline !== undefined) this.deadline = e.deadline;
        this.queue.push(e);
        void this.pump();
        break;
      case 'clock':
        this.deadline = e.deadline;
        this.lastTick = -1;
        break;
      case 'error':
        this.awaiting = false;
        audio.play('error');
        toast(e.message, 'warn');
        this.render();
        break;
      case 'status':
        this.statusBar.hidden = e.status === 'connected';
        this.statusBar.textContent = e.status === 'reconnecting' ? t('reconnecting') : e.message || t('connectionLost');
        if (e.status === 'closed' && !this.resultsShown) this.statusBar.append(h('button.btn', { type: 'button', onclick: () => this.exit() }, t('mainMenu')));
        break;
      case 'emote': {
        const text = EMOTE_TEXT[e.emote as keyof typeof EMOTE_TEXT];
        if (text) {
          this.panels[this.sideOf(e.seat)].showEmote(L(text));
          audio.play('emote');
        }
        break;
      }
      case 'presence':
        this.presence = e.presence;
        break;
      case 'rematch':
        break;
    }
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      while (this.queue.length && !this.destroyed) {
        const update = this.queue.shift()!;
        // An animation that never ends (a paused or throttled tab) must not freeze the board.
        await Promise.race([
          this.animate(update).catch((error: unknown) => console.error('Board animation failed', error)),
          new Promise<void>((resolve) => setTimeout(resolve, MAX_ANIMATION_MS)),
        ]);
        this.view = update.view;
        this.shown = [clonePlayer(update.view.players[0]), clonePlayer(update.view.players[1])];
        this.shownActive = update.view.active;
      }
    } finally {
      this.busy = false;
    }
    if (this.destroyed || !this.view) return;
    this.field.setCastles(this.castleValues());
    this.field.setShield(this.sideOf(0), this.view.players[0].shield);
    this.field.setShield(this.sideOf(1), this.view.players[1].shield);
    this.handSeat = this.view.viewer;
    this.handModel = [...this.view.players[this.view.viewer].hand];
    this.render();
    this.afterSettled();
  }

  /** The board is up to date: results, hot-seat curtain, choices, then tell the session. */
  private afterSettled(): void {
    const view = this.view!;
    const tension = Math.max(...view.players.map((p) => Math.max(p.keep / view.rules.keepWin, 1 - p.keep / view.rules.keepStart)));
    audio.setTension(Math.max(0, Math.min(1, (tension - 0.5) * 2)));

    if (view.phase === 'finished' && view.result) {
      if (!this.resultsShown) {
        this.resultsShown = true;
        const winner = view.result.winner;
        fx.gameOver(winner === null ? null : this.session.kind === 'local' ? true : this.session.isLocal(winner), winner === null ? null : this.sideOf(winner), this.fxContext());
        showResults({
          host: this.layer,
          session: this.session,
          view,
          stats: this.stats,
          seatSide: (seat) => this.sideOf(seat),
          name: (seat) => this.name(seat),
          onExit: () => this.exit(),
          getPresence: () => this.presence,
        });
      }
      return;
    }

    if (this.session.kind === 'local' && this.curtainFor !== view.viewer) {
      this.showCurtain(view.viewer);
      return;
    }
    this.maybeChoose();
    this.session.idle();
  }

  // ---------------------------------------------------------------------------
  // Rendering (instant)
  // ---------------------------------------------------------------------------

  private canAct(): boolean {
    const v = this.view;
    return (
      !!v &&
      !this.busy &&
      !this.awaiting &&
      v.phase === 'action' &&
      v.active === v.viewer &&
      this.session.isLocal(v.viewer) &&
      this.curtain.hidden === true
    );
  }

  private render(): void {
    // The turn moved on (clock, opponent) while the discard picker was open.
    if (this.closeDiscard && !this.canAct()) this.closeDiscard();
    const view = this.view;
    if (!view || !this.shown) {
      this.turnLabel.textContent = '';
      return;
    }
    const canAct = this.canAct();
    for (const seat of [0, 1] as const) {
      const side = this.sideOf(seat);
      const p = this.shown[seat];
      this.panels[side].update(p, {
        nickname: this.name(seat),
        isAi: this.session.seats[seat]?.isAi,
        active: this.shownActive === seat && view.phase !== 'finished',
        canUltimate: canAct && seat === view.viewer && p.ultimateReady,
        mine: this.session.isLocal(seat),
      });
      this.plaques[side].update(p.keep, p.wall);
      this.panels[side].setHistory(this.shownHistory[seat]);
    }
    fx.auras(
      this.fxContext(),
      this.shown.map((p) => ({ burn: p.burn, frozen: RESOURCES.some((r) => p.frost[r] > 0), keep: p.keep, keepStart: view.rules.keepStart })),
    );

    // Hand of the player looking at the screen.
    const handSeat = this.handSeat ?? view.viewer;
    this.hand.el.classList.toggle('concealed', !this.curtain.hidden || handSeat !== view.viewer);
    this.hand.render(this.handModel, { view, seat: handSeat, canAct });
    this.refreshInspect?.();

    // Opponent's hand: backs, or faces when revealed.
    const opp = this.shown[other(handSeat)];
    const oppCards = opp.hand;
    const oppHero = this.heroOf(other(handSeat));
    if (this.oppHand.childElementCount !== oppCards.length || this.oppHand.dataset.key !== JSON.stringify(oppCards)) {
      this.oppHand.dataset.key = JSON.stringify(oppCards);
      if (this.pilePreview && !this.discardPile.matches(':hover')) this.hidePilePreview();
      this.oppHand.replaceChildren(
        ...oppCards.map((c) => {
          const el = c.cardId ? cardFace(c.cardId, { calm: true, hero: oppHero }) : cardBack();
          el.dataset.uid = String(c.uid);
          if (c.cardId) {
            const id = c.cardId;
            el.classList.add('revealed');
            el.addEventListener('click', () => {
              this.hidePilePreview();
              this.inspectCard(id, oppHero);
            });
            el.addEventListener('pointerenter', (e) => {
              if (e.pointerType === 'mouse') this.showCardPreview(id, el.getBoundingClientRect(), 'below', oppHero);
            });
            el.addEventListener('pointerleave', () => this.hidePilePreview());
          }
          return el;
        }),
      );
    }

    // Piles.
    const me = this.shown[handSeat];
    this.deckPile.querySelector('.pile-count')!.textContent = String(me.deckCount);
    this.discardPile.querySelector('.pile-count')!.textContent = String(me.discardCount);

    // Turn label.
    const activeSeat = this.shownActive;
    if (view.phase === 'finished') this.turnLabel.textContent = t('logGameOver');
    else if (this.session.isLocal(activeSeat) && (this.session.kind !== 'local' || activeSeat === view.viewer)) {
      this.turnLabel.textContent = view.extraTurn ? `${t('yourTurn')} · ${t('extraTurn')}` : t('yourTurn');
    } else if (this.session.seats[activeSeat]?.isAi) this.turnLabel.textContent = t('thinking', { who: this.name(activeSeat) });
    else this.turnLabel.textContent = t('theirTurn', { who: this.name(activeSeat) });
    this.turnLabel.append(h('small', null, t('turnN', { n: view.turn })));
    this.el.classList.toggle('my-turn', canAct);

    // Battle event chip.
    this.renderEventChip(view);
  }

  private renderEventChip(view: PlayerView): void {
    const active = view.activeEvent;
    const id = active ? active.id : view.upcomingEvent.id;
    const ev = getBattleEvent(id);
    const turnsAway = view.upcomingEvent.turn - view.turn;
    const sub = active ? t('activeEvent', { n: active.turnsLeft }) : turnsAway <= 1 ? t('upcomingNow') : t('upcomingEvent', { n: turnsAway });
    this.eventChip.classList.toggle('active', !!active);
    this.eventChip.classList.toggle('soon', !active && turnsAway <= 2);
    this.eventChip.replaceChildren(
      h('img', { src: artUrl(ev.art), alt: '' }),
      h('span.event-text', null, h('strong', null, L(ev.name)), h('small', null, sub)),
    );
    this.eventChip.title = `${L(ev.name)}: ${L(ev.text)}`;
  }

  // ---------------------------------------------------------------------------
  // Event animation
  // ---------------------------------------------------------------------------

  private async animate(update: StateUpdate): Promise<void> {
    const events = update.events;
    const starting = events.some((e) => e.type === 'gameStarted');
    if (starting) {
      if (this.session.kind === 'online') callAttention(t('gameStartedNotice'), t('gameStartedNoticeBody'));
      this.stats.reset();
      this.history = [[], []];
    }
    // After a reload the server only sends the current state: pick up the figures saved before it.
    else if (update.resumed) this.loadStats();
    this.stats.add(events);
    for (const e of events) {
      if (e.type === 'cardPlayed' || e.type === 'cardDiscarded') {
        const entry = historyEntry(e.cardId, e.type === 'cardDiscarded');
        this.history[e.player] = [entry, ...this.history[e.player]].slice(0, HISTORY_SIZE);
      }
    }
    if (events.length) this.saveStats();
    for (const e of events) {
      const line = describeEvent(e, (seat) => this.name(seat));
      if (line) this.log(line, e.type);
    }

    if (!this.shown || update.resumed || starting || events.length === 0) {
      await this.snapTo(update.view, starting);
      return;
    }

    // On a shared device the next player's cards must not show while animating.
    if (this.session.kind === 'local' && update.view.viewer !== this.handSeat) {
      this.hand.el.classList.add('concealed');
    }

    for (const e of events) {
      if (this.destroyed) return;
      await this.play(e, update.view);
    }
    await wait(120);
    this.clearPlayed();
  }

  private saveStats(): void {
    const key = this.session.statsKey?.();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(this.stats));
      localStorage.setItem(`${key}:history`, JSON.stringify(this.history));
    } catch {
      // Storage full or blocked: the results just show what this page saw.
    }
  }

  private loadStats(): void {
    const key = this.session.statsKey?.();
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) this.stats.restore(JSON.parse(raw));
      const history = JSON.parse(localStorage.getItem(`${key}:history`) ?? 'null') as unknown;
      if (Array.isArray(history) && history.length === 2 && history.every((h) => Array.isArray(h) && h.every((id) => typeof id === 'string'))) {
        this.history = [history[0].slice(0, HISTORY_SIZE), history[1].slice(0, HISTORY_SIZE)];
      }
    } catch {
      // Nothing usable saved.
    }
  }

  /** Jump to a view without replaying its events (game start, resume). */
  private async snapTo(view: PlayerView, starting: boolean): Promise<void> {
    if (starting) {
      this.resultsShown = false;
      this.closeEvent = null;
      this.closeChoice = null;
      this.layer.replaceChildren();
      this.curtainFor = null;
      this.logList.replaceChildren();
      // Castle scale and progress bars follow this match's rules.
      this.field.setMaxPoints(view.rules.keepWin);
      for (const plaque of this.plaques) plaque.setKeepWin(view.rules.keepWin);
      this.field.setHeroes([view.players[this.seatOfSide(0)].hero, view.players[this.seatOfSide(1)].hero]);
      void this.field.setMood(skyFor(view.activeEvent?.id ?? null), 400);
    }
    if (!starting && this.discardPile.querySelector('.pile-empty')) {
      // Resumed mid-game: show the last card played, by whoever played most recently.
      const lastSeat = view.players[other(view.active)].lastPlayedCard ? other(view.active) : view.active;
      const last = view.players[lastSeat].lastPlayedCard;
      if (last) this.setDiscardTop(last, view.players[lastSeat].hero);
      else if (view.players[view.viewer].discardCount > 0) this.setDiscardTop(null);
    }
    this.view = view;
    // Resumed with nothing saved: at least the last card each player played.
    for (const seat of [0, 1] as const) {
      const last = view.players[seat].lastPlayedCard;
      if (!starting && this.history[seat].length === 0 && last) this.history[seat] = [last];
    }
    this.shownHistory = [this.history[0].slice(), this.history[1].slice()];
    this.shown = [clonePlayer(view.players[0]), clonePlayer(view.players[1])];
    this.shownActive = view.active;
    this.handSeat = view.viewer;
    if (starting) {
      // Castles rise from the ground and the hand is dealt.
      this.field.setCastles([
        { keep: 0, wall: 0 },
        { keep: 0, wall: 0 },
      ]);
      const values = this.castleValues();
      void this.field.animateCastle(0, values[0].keep, values[0].wall, 1100 * animScale());
      void this.field.animateCastle(1, values[1].keep, values[1].wall, 1100 * animScale());
      audio.play('build');
      this.handModel = [];
      this.render();
      const cards = view.players[view.viewer].hand;
      for (const card of cards) {
        this.handModel = [...this.handModel, card];
        this.render();
        audio.play('cardDraw');
        await wait(110);
      }
      this.showBanner(t('turnN', { n: view.turn }), this.session.isLocal(view.active) ? t('yourTurn') : t('theirTurn', { who: this.name(view.active) }));
      await wait(700);
    } else {
      this.field.setCastles(this.castleValues());
      this.handModel = [...view.players[view.viewer].hand];
    }
    this.field.setShield(this.sideOf(0), view.players[0].shield);
    this.field.setShield(this.sideOf(1), view.players[1].shield);
    void this.field.setMood(skyFor(view.activeEvent?.id ?? null), 400);
  }

  private heights(seat: PlayerId): { keep: number; wall: number } {
    const p = this.shown![seat];
    return { keep: p.keep, wall: p.wall };
  }

  private async play(e: GameEvent, next: PlayerView): Promise<void> {
    const shown = this.shown!;
    const ctx = this.fxContext();
    switch (e.type) {
      case 'turnStarted': {
        this.clearPlayed();
        this.shownActive = e.player;
        this.render();
        const mine = this.session.isLocal(e.player);
        fx.turnStarted(mine, this.session.kind === 'local');
        const title = this.session.kind === 'local' ? this.name(e.player) : mine ? t('yourTurn') : t('theirTurn', { who: this.name(e.player) });
        if (mine && this.session.kind !== 'local') callAttention(t('yourTurn'), t('yourTurnNotice', { n: e.turn }));
        this.showBanner(e.extraTurn ? t('extraTurn') : title, t('turnN', { n: e.turn }));
        // Your turn starts with the ultimate charged: say so loudly, once the banner has gone.
        if (mine && shown[e.player].ultimateReady) {
          const seat = e.player;
          setTimeout(() => {
            if (!this.destroyed && this.shownActive === seat && this.shown?.[seat].ultimateReady) this.showUltimateReady(seat);
          }, 1050 * animScale());
        }
        await wait(mine ? 650 : 350);
        break;
      }
      case 'battleEventForecast':
        break;
      case 'battleEventStarted':
        await this.showEventReveal(e.eventId);
        void fx.battleEvent(e.eventId, ctx);
        break;
      case 'battleEventEnded':
        void fx.battleEventEnded(ctx);
        break;
      case 'produced': {
        const p = shown[e.player];
        for (const res of RESOURCES) p.resources[res] += e.gained[res];
        this.render();
        const panel = this.panels[this.sideOf(e.player)];
        for (const res of RESOURCES) {
          if (e.gained[res] > 0) this.floatAt(panel.resourceRow(res), `+${e.gained[res]}`, 'build');
          if (e.frozen.includes(res)) panel.pulse(`.res-${res}`);
        }
        audio.play('resource', 0.5, { pan: this.sideOf(e.player) === 0 ? -0.4 : 0.4 });
        await wait(320);
        break;
      }
      case 'resourcesChanged': {
        const p = shown[e.player];
        const panel = this.panels[this.sideOf(e.player)];
        let gained = false;
        for (const res of RESOURCES) {
          const d = e.delta[res] ?? 0;
          if (!d) continue;
          gained ||= d > 0;
          p.resources[res] = Math.max(0, p.resources[res] + d);
          this.floatAt(panel.resourceRow(res), d > 0 ? `+${d}` : `−${-d}`, d > 0 ? 'build' : 'damage');
        }
        this.render();
        audio.play(gained ? 'resource' : 'resourceLoss', 0.5, { pan: this.sideOf(e.player) === 0 ? -0.4 : 0.4 });
        await wait(260);
        break;
      }
      case 'workersChanged': {
        const p = shown[e.player];
        const panel = this.panels[this.sideOf(e.player)];
        let hired = false;
        for (const res of RESOURCES) {
          const d = e.delta[res] ?? 0;
          if (!d) continue;
          hired ||= d > 0;
          p.workers[res] = Math.max(0, p.workers[res] + d);
          panel.pulse(`.res-${res} .res-workers`);
          this.floatAt(panel.resourceRow(res), `${d > 0 ? '+' : '−'}${Math.abs(d)} ⚒`, d > 0 ? 'build' : 'damage');
        }
        this.render();
        audio.play(hired ? 'worker' : 'workerLoss', 0.5, { pan: this.sideOf(e.player) === 0 ? -0.4 : 0.4 });
        await wait(380);
        break;
      }
      case 'cardPlayed': {
        const p = shown[e.player];
        p.resources[e.resource] = Math.max(0, p.resources[e.resource] - e.cost);
        p.hand = p.hand.filter((c) => c.uid !== e.uid);
        p.lastPlayedCard = e.cardId;
        p.discardCount++;
        this.shownHistory[e.player] = [e.cardId, ...this.shownHistory[e.player]].slice(0, HISTORY_SIZE);
        const from = this.takeFromHand(e.player, e.uid);
        if (e.player === this.handSeat) this.handModel = this.handModel.filter((c) => c.uid !== e.uid);
        this.render();
        fx.cardLaunched();
        await this.showPlayed(e.cardId, from, e.combo, this.heroOf(e.player));
        break;
      }
      case 'cardCopied':
        this.showBanner(L(getCard(e.cardId).name), t('logCopied', { who: this.name(e.player), card: '' }).trim());
        await wait(500);
        break;
      case 'cardDiscarded': {
        const p = shown[e.player];
        p.hand = p.hand.filter((c) => c.uid !== e.uid);
        p.discardCount++;
        this.shownHistory[e.player] = [historyEntry(e.cardId, true), ...this.shownHistory[e.player]].slice(0, HISTORY_SIZE);
        const from = this.takeFromHand(e.player, e.uid);
        if (e.player === this.handSeat) this.handModel = this.handModel.filter((c) => c.uid !== e.uid);
        this.render();
        audio.play('cardDiscard');
        await this.flyToDiscard(e.cardId, from, undefined, this.heroOf(e.player));
        break;
      }
      case 'handRedrawn': {
        const p = shown[e.player];
        p.hand = [];
        if (e.player === this.handSeat) {
          for (const card of this.handModel) {
            const el = this.hand.detach(card.uid);
            if (el) void this.flyToDiscard(null, el.getBoundingClientRect(), el);
          }
          this.handModel = [];
        }
        this.render();
        audio.play('cardDiscard');
        await wait(420);
        break;
      }
      case 'cardsDrawn': {
        const p = shown[e.player];
        p.hand = [...p.hand, ...e.cards];
        p.deckCount = Math.max(0, p.deckCount - e.cards.length);
        if (e.player === this.handSeat) {
          for (const card of e.cards) {
            this.handModel = [...this.handModel, card];
            this.render();
            audio.play('cardDraw');
            await wait(90);
          }
        } else {
          this.render();
          audio.play('cardDraw');
        }
        await wait(160);
        break;
      }
      case 'deckReshuffled':
        if (e.player === this.handSeat) audio.play('shuffle');
        this.deckPile.classList.remove('pulse');
        void this.deckPile.offsetWidth;
        this.deckPile.classList.add('pulse');
        await wait(300);
        break;
      case 'built': {
        const p = shown[e.player];
        p[e.target] += e.amount;
        this.render();
        await fx.built(e.player, e.target, e.amount, ctx, this.heights(e.player));
        break;
      }
      case 'damage': {
        const p = shown[e.target];
        if (e.blocked) {
          // The dome stays up until the hit lands on it (the director lowers it).
          p.shield = Math.max(0, p.shield - 1);
        } else {
          p.wall = Math.max(0, p.wall - e.wallLoss);
          p.keep = Math.max(0, p.keep - e.keepLoss);
        }
        await fx.damage(e, ctx, this.heights(e.target), p.shield);
        this.render();
        break;
      }
      case 'structureLost': {
        const p = shown[e.player];
        p[e.target] = Math.max(0, p[e.target] - e.amount);
        await fx.structureLost(e.player, e.target, e.amount, ctx, this.heights(e.player));
        this.render();
        break;
      }
      case 'wallsSwapped': {
        shown[0].wall = e.walls[0];
        shown[1].wall = e.walls[1];
        await fx.wallsSwapped([e.walls[0]!, e.walls[1]!], [shown[0].keep, shown[1].keep], ctx);
        this.render();
        break;
      }
      case 'burnApplied':
        shown[e.player].burn = e.total;
        this.render();
        this.panels[this.sideOf(e.player)].pulse('.status-chip.burn');
        await fx.status('burn', e.player, ctx);
        break;
      case 'frostApplied':
        shown[e.player].frost[e.resource] = e.total;
        this.render();
        this.panels[this.sideOf(e.player)].pulse(`.res-${e.resource}`);
        await fx.status('frost', e.player, ctx);
        break;
      case 'shieldGained':
        shown[e.player].shield = e.total;
        this.render();
        await fx.status('shield', e.player, ctx, e.total);
        break;
      case 'statusesCleansed':
        shown[e.player].burn = 0;
        for (const res of RESOURCES) shown[e.player].frost[res] = 0;
        this.render();
        await fx.status('cleanse', e.player, ctx);
        break;
      case 'drawbridgeRaised':
      case 'drawbridgeLowered':
        shown[e.player].drawbridge = e.type === 'drawbridgeRaised';
        this.render();
        if (e.type === 'drawbridgeRaised') {
          fx.drawbridge(e.player, ctx);
          await wait(300);
        }
        break;
      case 'handRevealed':
        shown[e.player].handRevealed = true;
        shown[e.player].hand = e.cards.map((c) => ({ uid: c.uid, cardId: c.cardId }));
        this.render();
        fx.reveal(e.player, ctx);
        await wait(400);
        break;
      case 'handHidden':
        shown[e.player].handRevealed = false;
        if (e.player !== this.handSeat) shown[e.player].hand = shown[e.player].hand.map((c) => ({ uid: c.uid, cardId: null }));
        this.render();
        break;
      case 'enchantmentAdded': {
        const p = shown[e.player];
        p.enchantments = [...p.enchantments.filter((x) => x.cardId !== e.cardId), { cardId: e.cardId, turnsLeft: e.turns, fresh: true }];
        this.render();
        fx.enchantment(e.player, ctx);
        this.panels[this.sideOf(e.player)].pulse(`.enchant[data-card="${e.cardId}"]`);
        await wait(450);
        break;
      }
      case 'enchantmentTriggered':
        this.panels[this.sideOf(e.player)].pulse(`.enchant[data-card="${e.cardId}"]`);
        fx.enchantment(e.player, ctx, true);
        await wait(260);
        break;
      case 'enchantmentRemoved': {
        const p = shown[e.player];
        p.enchantments = p.enchantments.filter((x) => x.cardId !== e.cardId);
        this.render();
        await wait(e.reason === 'destroyed' ? 400 : 150);
        break;
      }
      case 'choiceRequested':
      case 'choiceMade':
        break;
      case 'ultimateCharged': {
        const p = shown[e.player];
        const wasReady = p.ultimateReady;
        p.ultimateCharge = e.charge;
        p.ultimateThreshold = e.threshold;
        p.ultimateReady = e.ready;
        this.render();
        if (e.ready && !wasReady) {
          this.panels[this.sideOf(e.player)].pulse('.portrait');
          this.panels[this.sideOf(e.player)].pulse('.ult-btn');
          fx.ultimateReady(e.player, ctx, this.session.isLocal(e.player));
          if (this.session.isLocal(e.player)) toast(t('ultimateReadyToast'), 'info', 4200);
        }
        break;
      }
      case 'ultimateUsed': {
        const p = shown[e.player];
        p.ultimateReady = false;
        p.ultimateCharge = 0;
        p.ultimateUses++;
        this.render();
        await this.showUltimate(e.player, e.heroId);
        await fx.ultimate(e.player, e.heroId, ctx);
        break;
      }
      case 'extraTurnGranted':
        shown[e.player].extraTurns++;
        this.render();
        fx.extraTurn(e.player, ctx);
        this.showBanner(t('extraTurn'), this.name(e.player));
        await wait(500);
        break;
      case 'extraPlayGranted':
        await wait(200);
        break;
      case 'timedOut':
        this.showBanner(t('timeUp'), this.name(e.player));
        fx.timeUp();
        await wait(600);
        break;
      case 'turnEnded':
        if (shown[e.player].extraTurns > 0 && next.active === e.player) shown[e.player].extraTurns--;
        break;
      case 'gameOver':
        this.clearPlayed();
        await wait(700);
        break;
      case 'gameStarted':
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // DOM animations
  // ---------------------------------------------------------------------------

  /** The rect a card leaves from: its element in my hand, or the opponent's hand. */
  private takeFromHand(seat: PlayerId, uid: number): DOMRect {
    if (seat === this.handSeat) {
      const el = this.hand.detach(uid);
      if (el) {
        const rect = el.getBoundingClientRect();
        el.remove();
        return rect;
      }
      return this.hand.el.getBoundingClientRect();
    }
    const back = this.oppHand.querySelector<HTMLElement>(`[data-uid="${uid}"]`) ?? this.oppHand.lastElementChild;
    if (back instanceof HTMLElement) {
      const rect = back.getBoundingClientRect();
      back.style.visibility = 'hidden';
      return rect;
    }
    return this.oppHand.getBoundingClientRect();
  }

  /** The played card flies to the centre, is shown big, and stays until the next one. */
  private async showPlayed(cardId: string, from: DOMRect, combo: boolean, hero?: HeroId): Promise<void> {
    this.clearPlayed();
    const card = cardFace(cardId, { className: 'played', hero });
    if (hero) card.dataset.hero = hero;
    if (combo && comboBonusText(cardId)) {
      card.classList.add('combo', 'boosted');
      card.append(boostTag(cardId, true));
    }
    this.stage.replaceChildren(card);
    this.playedCard = card;
    const target = card.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (target.left + target.width / 2);
    const dy = from.top + from.height / 2 - (target.top + target.height / 2);
    const s = from.width / Math.max(1, target.width);
    const anim = card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.6 },
        { transform: 'translate(0, -6%) scale(1.06)', opacity: 1, offset: 0.7 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 520 * animScale(), easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    await anim.finished.catch(() => undefined);
    const landed = card.getBoundingClientRect();
    this.playBurst(cardId, combo);
    await fx.cardLanded(cardId, { x: landed.left + landed.width / 2, y: landed.top + landed.height / 2 }, combo, this.fxContext());
    await wait(combo ? 520 : 380);
  }

  /** Light behind a card as it lands, in its school and rarity colours. */
  private playBurst(cardId: string, combo: boolean): void {
    const card = getCard(cardId);
    const burst = h('div.play-burst', { class: `s-${card.school} r-${card.rarity}${combo ? ' combo' : ''}`, 'aria-hidden': 'true' });
    this.stage.prepend(burst);
    this.playedCard?.classList.add('landed', `land-${card.rarity}`);
    setTimeout(() => burst.remove(), 2400);
  }

  /** Sends the card on stage to the discard pile. */
  private clearPlayed(): void {
    const card = this.playedCard;
    if (!card) return;
    this.playedCard = null;
    const pile = this.discardPile.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    const dx = pile.left + pile.width / 2 - (r.left + r.width / 2);
    const dy = pile.top + pile.height / 2 - (r.top + r.height / 2);
    const s = pile.width / Math.max(1, r.width);
    const id = card.dataset.cardId;
    const hero = card.dataset.hero as HeroId | undefined;
    card
      .animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.9 }], {
        duration: 380 * animScale(),
        easing: 'cubic-bezier(.4,0,.6,1)',
        fill: 'forwards',
      })
      .finished.catch(() => undefined)
      .then(() => {
        card.remove();
        if (id) this.setDiscardTop(id, hero, false);
      });
  }

  /** Hero of whoever put the top card on the discard pile, for its numbers. */
  private discardHero: HeroId | undefined;
  /** The top card of the pile was discarded, not played. */
  private discardTopDiscarded = false;

  private setDiscardTop(cardId: string | null, hero?: HeroId, discarded = false): void {
    this.hidePilePreview();
    this.discardHero = hero;
    this.discardTopDiscarded = discarded;
    const top = cardId ? cardFace(cardId, { calm: true, hero }) : cardBack();
    if (cardId && discarded) markDiscarded(top);
    const count = this.discardPile.querySelector('.pile-count');
    this.discardPile.replaceChildren(top, count ?? h('span.pile-count'));
    this.discardPile.classList.toggle('has-card', !!cardId);
    if (this.discardPile.matches(':hover')) this.showPilePreview();
  }

  private discardTopId(): string | null {
    return this.discardPile.querySelector<HTMLElement>('.card[data-card-id]')?.dataset.cardId ?? null;
  }

  private pilePreview: HTMLElement | null = null;
  /** Last cards each seat played, newest first; `shownHistory` follows the animation. */
  private history: [string[], string[]] = [[], []];
  private shownHistory: [string[], string[]] = [[], []];

  /** Large copy of the last card played, next to the discard pile, to read what it did. */
  private showPilePreview(): void {
    const id = this.discardTopId();
    if (id) this.showCardPreview(id, this.discardPile.getBoundingClientRect(), 'above', this.discardHero, this.discardTopDiscarded);
    else this.hidePilePreview();
  }

  /**
   * A readable copy of a card next to `anchor` while the mouse is on it (the
   * discard pile, or a revealed card of the rival). Not on touch screens,
   * where a tap opens the inspect view instead.
   */
  private showCardPreview(cardId: string, anchor: DOMRect, prefer: 'above' | 'below' | 'left' | 'right', hero?: HeroId, discarded = false): void {
    this.hidePilePreview();
    if (this.el.classList.contains('touch')) return;
    const big = cardFace(cardId, { calm: true, hero });
    if (discarded) markDiscarded(big);
    big.classList.add('hover-preview', 'pile-preview');
    const host = this.layer.getBoundingClientRect();
    const minTop = host.top + 56;
    const handTop = this.hand.el.getBoundingClientRect().top;
    const bottom = Math.min(window.innerHeight, handTop + 40);
    let w: number;
    let left: number;
    let top: number;
    if (prefer === 'left' || prefer === 'right') {
      // Beside the anchor, as tall as the space allows, kept on screen.
      w = Math.round(Math.min(300, Math.max(190, (window.innerHeight - minTop - 16) / 1.4)));
      const hgt = w * 1.4;
      top = Math.max(minTop, Math.min(anchor.top + anchor.height / 2 - hgt / 2, window.innerHeight - hgt - 8));
      left = prefer === 'right' ? anchor.right + 16 : anchor.left - w - 16;
    } else {
      const room = prefer === 'above' ? anchor.top - minTop - 12 : bottom - anchor.bottom - 12;
      w = Math.round(Math.min(300, Math.max(190, room / 1.4)));
      const hgt = w * 1.4;
      left = anchor.left + anchor.width / 2 - w / 2;
      top = prefer === 'above' ? anchor.top - hgt - 12 : anchor.bottom + 12;
      if ((prefer === 'above' && top < minTop) || (prefer === 'below' && top + hgt > window.innerHeight - 8)) {
        // Not enough room: stand beside the anchor instead.
        top = Math.max(minTop, Math.min(anchor.top + anchor.height / 2 - hgt / 2, window.innerHeight - hgt - 8));
        left = anchor.right + 16;
        if (left + w > window.innerWidth - 8) left = anchor.left - w - 16;
      }
    }
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    big.style.setProperty('--w', `${w}px`);
    big.style.left = `${left - host.left}px`;
    big.style.top = `${top - host.top}px`;
    this.layer.appendChild(big);
    this.pilePreview = big;
  }

  private hidePilePreview(): void {
    this.pilePreview?.remove();
    this.pilePreview = null;
  }

  private async flyToDiscard(cardId: string | null, from: DOMRect, existing?: HTMLElement, hero?: HeroId): Promise<void> {
    const card = existing ?? (cardId ? cardFace(cardId, { calm: true, hero }) : cardBack());
    card.classList.add('flying');
    card.style.setProperty('--w', `${from.width}px`);
    Object.assign(card.style, { left: `${from.left}px`, top: `${from.top}px`, transform: 'none' });
    this.floaters.appendChild(card);
    const pile = this.discardPile.getBoundingClientRect();
    const anim = card.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)' },
        { transform: `translate(${(pile.left - from.left) * 0.5}px, ${(pile.top - from.top) * 0.5 - 40}px) rotate(-8deg)`, offset: 0.5 },
        { transform: `translate(${pile.left - from.left}px, ${pile.top - from.top}px) scale(${pile.width / Math.max(1, from.width)}) rotate(0deg)` },
      ],
      { duration: 480 * animScale(), easing: 'ease-in-out', fill: 'forwards' },
    );
    await anim.finished.catch(() => undefined);
    card.remove();
    if (cardId) this.setDiscardTop(cardId, hero, true);
  }

  /** Dismisses the battle event card left on screen, if any. */
  private closeEvent: (() => void) | null = null;

  /**
   * A new battle event: its card appears in the middle and stays there until
   * the player clicks it or presses Close (or Escape). The game goes on meanwhile.
   */
  private async showEventReveal(eventId: string): Promise<void> {
    this.closeEvent?.();
    const card = eventCard(eventId, { className: 'event-reveal' });
    const box = h(
      'div.event-reveal-box.event-hold',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': L({ es: 'Evento de batalla', en: 'Battle event' }) },
      h('div.event-reveal-title', null, L({ es: 'Evento de batalla', en: 'Battle event' })),
      h('div.x-anchor', null, card, closeX(() => close(), true)),
    );
    // The rest of the screen darkens; a click anywhere outside the card closes it.
    const scrim = h('div.dialog-scrim', null, box);
    const close = (): void => {
      if (this.closeEvent !== close) return;
      this.closeEvent = null;
      scrim.classList.remove('in');
      box
        .animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(0.9)' }], { duration: 250 * animScale(), fill: 'forwards' })
        .finished.catch(() => undefined)
        .then(() => scrim.remove());
    };
    this.closeEvent = close;
    scrim.addEventListener('click', (e) => {
      if (card.contains(e.target as Node)) return;
      audio.play('uiBack');
      close();
    });
    this.layer.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add('in'));
    await box
      .animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.6) rotate(-6deg)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.05) rotate(1deg)', opacity: 1, offset: 0.6 },
          { transform: 'translate(-50%, -50%)', opacity: 1 },
        ],
        { duration: 600 * animScale(), easing: 'cubic-bezier(.2,.8,.2,1)' },
      )
      .finished.catch(() => undefined);
    await wait(700);
  }

  private async showUltimate(seat: PlayerId, heroId: string): Promise<void> {
    const card = heroCard(heroId, { className: 'ultimate-reveal' });
    const box = h('div.ultimate-box', { class: `from-${this.sideOf(seat)}` }, card, h('div.ultimate-title', null, t('ultimate')));
    this.stage.appendChild(box);
    await box
      .animate(
        [
          { transform: `translateX(${this.sideOf(seat) === 0 ? -60 : 60}vw) rotate(${this.sideOf(seat) === 0 ? -12 : 12}deg)`, opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 520 * animScale(), easing: 'cubic-bezier(.2,.8,.2,1)' },
      )
      .finished.catch(() => undefined);
    await wait(700);
    await box.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.15)' }], { duration: 280 * animScale(), fill: 'forwards' }).finished.catch(() => undefined);
    box.remove();
  }

  /** Big centered "Ultimate ready!" with rays, a ring and sparks (does not block the game). */
  private showUltimateReady(seat: PlayerId): void {
    this.stage.parentElement?.querySelector('.ult-ready')?.remove();
    const fxEl = h(
      'div.ult-ready',
      { 'aria-live': 'polite' },
      h('div.ult-ready-rays'),
      h('div.ult-ready-ring'),
      h('div.ult-ready-ring.late'),
      h('strong', { 'data-text': t('ultimateReadyBig') }, t('ultimateReadyBig')),
      h('small', null, t('ultimateReadyHint')),
    );
    this.banner.after(fxEl);
    const r = fxEl.getBoundingClientRect();
    fx.ultimateReadyBanner(seat, this.fxContext(), r.left + r.width / 2, r.top + r.height / 2);
    this.panels[this.sideOf(seat)].pulse('.ult-btn');
    setTimeout(() => fxEl.remove(), 2600);
  }

  private showBanner(title: string, sub = ''): void {
    this.banner.replaceChildren(h('strong', null, title), ...(sub ? [h('small', null, sub)] : []));
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  private float(text: string, x: number, y: number, kind: 'damage' | 'build' | 'blocked' | 'info'): void {
    const el = h('span.floater', { class: kind, style: `left:${x}px;top:${y}px` }, text);
    this.floaters.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  private floatAt(target: Element, text: string, kind: 'damage' | 'build' | 'info'): void {
    const r = target.getBoundingClientRect();
    this.float(text, r.left + r.width * 0.6, r.top + r.height * 0.3, kind);
  }

  private log(line: string, type: string): void {
    this.logList.prepend(h('li', { class: `log-${type}` }, line));
    while (this.logList.childElementCount > 120) this.logList.lastElementChild?.remove();
  }

  // ---------------------------------------------------------------------------
  // Clock and presence
  // ---------------------------------------------------------------------------

  private tickTimer(): void {
    const view = this.view;
    if (!view || this.deadline === null || view.phase === 'finished' || this.busy) {
      if (!this.timer.hidden && (this.deadline === null || view?.phase === 'finished')) this.timer.hidden = true;
      return;
    }
    const total = view.rules.turnSeconds * 1000;
    const left = Math.max(0, this.deadline - Date.now());
    const secs = Math.ceil(left / 1000);
    this.timer.hidden = false;
    this.timer.style.setProperty('--p', String(Math.min(1, left / total)));
    this.timer.classList.toggle('low', secs <= 10);
    if (this.timer.textContent !== String(secs)) this.timer.textContent = String(secs);
    const mine = this.session.isLocal(view.pending?.player ?? view.active);
    if (mine && secs <= 5 && secs > 0 && secs !== this.lastTick) {
      this.lastTick = secs;
      fx.clockTick(secs);
    }
  }

  private tickPresence(): void {
    const presence = this.presence;
    if (!presence) return;
    for (const seat of [0, 1] as const) {
      const s = presence.seats[seat];
      let text: string | null = null;
      if (s && !s.connected && !s.left && s.reconnectBy) {
        const secs = Math.max(0, Math.ceil((s.reconnectBy - Date.now()) / 1000));
        text = `${t('reconnecting')} ${secs}s`;
      }
      this.panels[this.sideOf(seat)].setPresence(text);
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private act(action: PlayerAction): void {
    if (this.awaiting) return;
    if (action.type !== 'concede' && action.type !== 'choose' && !this.canAct()) return;
    this.closeInspect?.();
    this.hand.select(null);
    this.awaiting = action.type !== 'concede';
    this.awaitingSince = Date.now();
    this.render();
    this.session.act(action);
  }

  /**
   * Never leave the player locked out. An action whose answer never came (the
   * connection dropped as it went out) stops blocking the board after a few
   * seconds and the board asks the server for the current state; a choice
   * whose dialog was closed without an answer (the server refused it) opens
   * again. Either one used to leave both players looking at "Wait for your turn".
   */
  private watchdog(): void {
    if (this.destroyed || this.busy) return;
    if (this.awaiting) {
      if (Date.now() - this.awaitingSince < AWAIT_ANSWER_MS) return;
      this.awaiting = false;
      this.session.resync?.();
      this.render();
      return;
    }
    const view = this.view;
    if (!view || this.closeChoice || this.curtain.hidden !== true) return;
    if (view.phase === 'choice' && view.pending?.player === view.viewer && this.session.isLocal(view.viewer)) this.maybeChoose();
  }

  private tryPlay(uid: number): void {
    const ctx = this.hand.context;
    const cardId = this.hand.cardIdOf(uid);
    if (!ctx || !cardId) return;
    const reason = blockReason(ctx, cardId);
    if (reason) {
      audio.play('error');
      toast(reason, 'warn');
      return;
    }
    this.act({ type: 'play', player: ctx.seat, uid });
  }

  /** Open the discard picker with `uid` chosen: the player may add more cards, up to the rules' cap. */
  private tryDiscard(uid: number): void {
    const ctx = this.hand.context;
    if (!ctx || !this.canAct()) return;
    const max = ctx.view.rules.discardMax;
    const hand = this.handModel.filter((c) => c.cardId !== null);
    if (max <= 1 || hand.length <= 1) {
      this.act({ type: 'discard', player: ctx.seat, uid });
      return;
    }
    this.closeDiscard?.();
    this.closeInspect?.();
    this.hand.select(null);
    const picked: number[] = [uid];
    const confirmBtn = h('button.btn.primary', { type: 'button' });
    const hint = h('p.discard-hint');
    const options = hand.map((c) => {
      const btn = h(
        'button.choice-option.card-option.discard-option',
        { type: 'button', 'aria-pressed': 'false' },
        cardFace(c.cardId!, { calm: true, hero: this.hand.context ? this.heroOf(this.hand.context.seat) : undefined }),
        h('span.discard-mark', null, html(iconSvg('close'))),
      );
      btn.addEventListener('click', () => {
        const at = picked.indexOf(c.uid);
        if (at >= 0) picked.splice(at, 1);
        else if (picked.length < max) picked.push(c.uid);
        else {
          audio.play('error');
          return;
        }
        audio.play('cardSelect');
        refresh();
      });
      return { uid: c.uid, btn };
    });
    const refresh = (): void => {
      for (const o of options) {
        const on = picked.includes(o.uid);
        o.btn.classList.toggle('picked', on);
        o.btn.setAttribute('aria-pressed', String(on));
        o.btn.classList.toggle('locked', !on && picked.length >= max);
      }
      confirmBtn.textContent = t('discardN', { n: picked.length });
      (confirmBtn as HTMLButtonElement).disabled = picked.length === 0;
      hint.textContent = t('discardPickHint', { max });
    };
    const box = h(
      'div.choice-box.panel.discard-box',
      null,
      h('h2', null, t('discardPickTitle', { max })),
      hint,
      h('div.choice-options', null, options.map((o) => o.btn)),
      h('div.discard-actions', null, confirmBtn),
      closeX(() => close()),
    );
    const wrap = h('div.choice.discard-picker', null, box);
    const close = (): void => {
      if (this.closeDiscard === close) this.closeDiscard = null;
      wrap.remove();
    };
    const confirm = (): void => {
      if (!picked.length || !this.canAct()) return close();
      close();
      const [first, ...also] = picked;
      this.act(also.length ? { type: 'discard', player: ctx.seat, uid: first!, also } : { type: 'discard', player: ctx.seat, uid: first! });
    };
    this.closeDiscard = close;
    this.discardConfirm = confirm;
    confirmBtn.addEventListener('click', confirm);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close();
    });
    refresh();
    this.layer.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
  }

  private closeDiscard: (() => void) | null = null;
  private discardConfirm: (() => void) | null = null;

  private onSelect(uid: number | null): void {
    this.closeInspect?.();
    if (uid === null) return;
    const ctx = this.hand.context;
    const cardId = this.hand.cardIdOf(uid);
    if (!ctx || !cardId) return;
    const reason = blockReason(ctx, cardId);
    const big = cardFace(cardId, { tilt: true, cost: undefined, hero: this.heroOf(ctx.seat) });
    const handCard = this.hand.elementOf(uid);
    big.classList.toggle('combo', !reason && handCard?.classList.contains('combo') === true);
    big.classList.toggle('boosted', !reason && handCard?.classList.contains('boosted') === true);
    if (big.classList.contains('boosted')) big.append(boostTag(cardId, big.classList.contains('combo')));
    const costEl = this.hand.elementOf(uid)?.querySelector('.cost');
    if (costEl) big.querySelector('.cost')?.replaceWith(costEl.cloneNode(true));
    const panel = this.openInspect(
      big,
      L(getCard(cardId).text),
      {
        play: () => this.tryPlay(uid),
        discard: () => this.tryDiscard(uid),
        reason,
        canAct: ctx.canAct,
      },
      () => {
        if (this.refreshInspect === refresh) this.refreshInspect = null;
        this.hand.select(null);
      },
    );
    // Kept in step with the game while it stays open (for example the rival's turn ends).
    const refresh = (): void => {
      const now = this.hand.context;
      const handCard = this.hand.elementOf(uid);
      if (!now || !handCard) return;
      const blocked = blockReason(now, cardId);
      panel.updateActions(blocked, now.canAct);
      const combo = !blocked && handCard.classList.contains('combo');
      const boosted = !blocked && handCard.classList.contains('boosted');
      if (combo !== big.classList.contains('combo') || boosted !== big.classList.contains('boosted')) {
        big.classList.toggle('combo', combo);
        big.classList.toggle('boosted', boosted);
        big.querySelector('.combo-tag')?.remove();
        if (boosted) big.append(boostTag(cardId, combo));
      }
      const cost = handCard.querySelector('.cost');
      if (cost) big.querySelector('.cost')?.replaceWith(cost.cloneNode(true));
    };
    this.refreshInspect = refresh;
  }

  /** Updates the open hand card view after a state change. */
  private refreshInspect: (() => void) | null = null;

  private openInspect(card: HTMLElement, text: string, actions?: Parameters<typeof inspectPanel>[0]['actions'], onClose?: () => void): InspectPanel {
    this.closeInspect?.();
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      panel.classList.remove('in');
      setTimeout(() => panel.remove(), 200);
      if (this.closeInspect === close) this.closeInspect = null;
      onClose?.();
    };
    const panel = inspectPanel({ card, text, actions, close });
    this.layer.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('in'));
    this.closeInspect = close;
    return panel;
  }

  private inspectCard(cardId: string, hero?: HeroId, discarded = false): void {
    audio.play('cardSelect');
    const face = cardFace(cardId, { tilt: true, hero });
    if (discarded) markDiscarded(face);
    this.openInspect(face, L(getCard(cardId).text));
  }

  private inspectHero(heroId: string): void {
    audio.play('cardSelect');
    this.openInspect(heroCard(heroId, { tilt: true }), L(getHero(heroId).text));
  }

  private inspectEvent(): void {
    const view = this.view;
    if (!view) return;
    const id = view.activeEvent?.id ?? view.upcomingEvent.id;
    audio.play('cardSelect');
    this.openInspect(eventCard(id, { tilt: true }), L(getBattleEvent(id).text));
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || document.querySelector('.modal-backdrop')) return;
    if (this.closeDiscard) {
      if (e.key === 'Escape') this.closeDiscard();
      else if (e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.discardConfirm?.();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (this.closeInspect) this.closeInspect();
      else if (this.closeEvent) this.closeEvent();
      else this.hand.select(null);
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const uid = this.hand.uidAt(Number(e.key) - 1);
      if (uid !== null) this.hand.select(uid);
      return;
    }
    const selected = this.hand.selectedUid;
    if (e.key === 'Enter' && selected !== null) {
      e.preventDefault();
      this.tryPlay(selected);
    } else if ((e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'd') && selected !== null) {
      this.tryDiscard(selected);
    } else if (e.key.toLowerCase() === 'u') {
      const view = this.view;
      if (view && this.canAct() && view.players[view.viewer].ultimateReady) this.act({ type: 'ultimate', player: view.viewer });
    }
  };

  // ---------------------------------------------------------------------------
  // Choices, curtain, menu
  // ---------------------------------------------------------------------------

  private maybeChoose(): void {
    const view = this.view!;
    const pending = view.pending;
    if (view.phase !== 'choice' || !pending || pending.player !== view.viewer || !this.session.isLocal(view.viewer)) return;
    if (!pending.options.length) return;
    // One dialog at a time: a resumed connection replays the same choice.
    this.closeChoice?.();
    const titles = {
      frostResource: t('chooseFrost'),
      discardFromHand: t('chooseDiscard'),
      destroyEnchantment: t('chooseEnchantment'),
      discardOwn: pending.options.includes('done')
        ? t('chooseDiscardOwnUpTo', { n: pending.progress?.left ?? 1 })
        : t('chooseDiscardOwn', { n: pending.progress?.left ?? 1 }),
    } satisfies Record<typeof pending.kind, string>;
    const choose = (option: string): void => {
      audio.play('uiClick');
      close();
      this.act({ type: 'choose', player: view.viewer, option });
    };
    const options = pending.options.map((option) => {
      if (pending.kind === 'discardOwn') {
        if (option === 'done') {
          return h('button.btn.primary.choice-done', { type: 'button', onclick: () => choose(option) }, t('discardDone'));
        }
        const card = view.players[view.viewer].hand.find((c) => String(c.uid) === option);
        const face = card?.cardId ? cardFace(card.cardId, { calm: true, hero: this.heroOf(view.viewer) }) : cardBack();
        return h('button.choice-option.card-option', { type: 'button', onclick: () => choose(option) }, face);
      }
      if (pending.kind === 'frostResource') {
        const opp = view.players[other(view.viewer)];
        const res = option as (typeof RESOURCES)[number];
        const row = this.panels[this.sideOf(other(view.viewer))].resourceRow(res).cloneNode(true) as HTMLElement;
        return h('button.choice-option.res-option', { type: 'button', onclick: () => choose(option), title: `${opp.resources[res]}` }, row);
      }
      if (pending.kind === 'discardFromHand') {
        const card = pending.revealed?.find((c) => String(c.uid) === option);
        const face = card ? cardFace(card.cardId, { calm: true, hero: this.heroOf(other(view.viewer)) }) : cardBack();
        return h('button.choice-option.card-option', { type: 'button', onclick: () => choose(option) }, face);
      }
      return h('button.choice-option.card-option', { type: 'button', onclick: () => choose(option) }, cardFace(option, { calm: true }));
    });
    const box = h('div.choice-box.panel', null, h('h2', null, titles[pending.kind]), h('div.choice-options', { class: `kind-${pending.kind}` }, options));
    const wrap = h('div.choice', null, box);
    this.layer.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const close = (): void => {
      if (this.closeChoice === close) this.closeChoice = null;
      wrap.remove();
    };
    this.closeChoice = close;
  }

  private showCurtain(seat: PlayerId): void {
    this.curtain.hidden = false;
    this.hand.el.classList.add('concealed');
    this.curtain.replaceChildren(
      h(
        'div.curtain-box.panel',
        null,
        h('h2', null, t('passDevice', { who: this.name(seat) })),
        h('p', null, t('passDeviceHint')),
        h(
          'button.btn.primary.big',
          {
            type: 'button',
            onclick: () => {
              audio.play('uiClick');
              this.curtainFor = seat;
              this.curtain.hidden = true;
              this.render();
              this.maybeChoose();
              this.session.idle();
            },
          },
          t('ready'),
        ),
      ),
    );
  }

  private emoteButton(): HTMLElement {
    const menu = h('div.emote-menu', { hidden: true });
    const btn = h(
      'button.btn.icon-only',
      {
        type: 'button',
        'aria-label': t('emotes'),
        onclick: () => {
          audio.play('uiClick');
          menu.hidden = !menu.hidden;
        },
      },
      html(iconSvg('emote')),
    );
    menu.append(
      ...EMOTES.map((id) =>
        h(
          'button.btn',
          {
            type: 'button',
            onclick: () => {
              menu.hidden = true;
              this.session.emote?.(id);
            },
          },
          L(EMOTE_TEXT[id]),
        ),
      ),
    );
    return h('div.emote-wrap', null, btn, menu);
  }

  private openMenu(): void {
    audio.play('uiClick');
    modal((close) =>
      h(
        'div.modal.panel.game-menu',
        null,
        h('h2', null, t('menu')),
        h('button.btn.big', { type: 'button', onclick: () => close() }, t('resume')),
        h('button.btn', { type: 'button', onclick: () => (close(), openSettings()) }, html(iconSvg('gear')), t('settings')),
        h('button.btn', { type: 'button', onclick: () => (close(), openHowToPlay()) }, html(iconSvg('book')), t('howToPlay')),
        this.view?.phase !== 'finished'
          ? h(
              'button.btn.danger',
              {
                type: 'button',
                onclick: () => {
                  close();
                  this.confirmConcede();
                },
              },
              t('concede'),
            )
          : h('button.btn', { type: 'button', onclick: () => (close(), this.exit()) }, t('mainMenu')),
      ),
    );
  }

  private confirmConcede(): void {
    modal((close) =>
      h(
        'div.modal.panel',
        null,
        h('h2', null, t('concedeConfirm')),
        h(
          'div.actions',
          null,
          h('button.btn', { type: 'button', onclick: () => close() }, t('cancel')),
          h(
            'button.btn.danger',
            {
              type: 'button',
              onclick: () => {
                close();
                const view = this.view;
                if (view) this.session.act({ type: 'concede', player: view.viewer });
              },
            },
            t('concede'),
          ),
        ),
      ),
    );
  }

  private exit(): void {
    void import('../flow').then(({ flow }) => (this.session.kind === 'online' ? flow.lobby() : flow.menu()));
  }
}
