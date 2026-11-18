import {
  DEFAULT_RULES,
  RESOURCES,
  getBattleEvent,
  getCard,
  getHero,
  other,
  type GameEvent,
  type PlayerId,
  type PlayerPublicState,
  type PlayerView,
  type VisibleCard,
} from '@cardcraft-castles/engine';
import type { PlayerAction } from '@cardcraft-castles/protocol';
import { h, html, toast } from '../../app/dom';
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
import { cardBack, cardFace, eventCard, heroCard } from '../../ui/card';
import { heroColor, skyFor } from '../../ui/theme';
import { openHowToPlay } from '../howToPlay';
import { openSettings } from '../settingsModal';
import { Hand, blockReason, inspectPanel } from './hand';
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
  private deadline: number | null = null;
  private lastTick = -1;
  private curtainFor: PlayerId | null = null;
  private stats = new MatchStats();
  private unsubscribe: () => void = () => {};
  private unsubscribeSettings: () => void = () => {};
  private raf = 0;
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
      panel.onInspect = (cardId) => this.inspectCard(cardId);
      panel.onInspectHero = (heroId) => this.inspectHero(heroId);
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
    this.field.setBanners([heroColor(this.session.seats[this.seatOfSide(0)].hero), heroColor(this.session.seats[this.seatOfSide(1)].hero)]);
    this.layout();
    this.unsubscribe = this.session.subscribe((e) => this.onSession(e));
    window.addEventListener('keydown', this.onKey);
    this.unsubscribeSettings = settings.subscribe((next, prev) => {
      if (next.locale !== prev.locale) this.relocalize();
    });
    const loop = (): void => {
      this.tickTimer();
      this.tickPresence();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  unmount(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.unsubscribeSettings();
    cancelAnimationFrame(this.raf);
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
    const short = hgt < 520;
    // Hand cards: as big as the screen allows without eating the castles.
    const cardW = Math.round(Math.max(78, Math.min(w * 0.115, hgt * (short ? 0.24 : 0.2), 176)));
    this.el.style.setProperty('--card-w', `${cardW}px`);
    this.el.classList.toggle('short', short);
    this.el.classList.toggle('narrow', w < 760);

    const left = this.panels[0].el.getBoundingClientRect();
    const right = this.panels[1].el.getBoundingClientRect();
    const top = this.el.querySelector('.topbar')!.getBoundingClientRect();
    const portrait = hgt > w;
    // Visible part of the resting hand (see --peek-f in board.css), plus room for the castle plaques.
    const peek = short ? 0.34 : 0.3;
    const handTop = hgt - 6 - cardW * 1.4 * (1 - peek);
    const plaqueRoom = short ? 34 : 46;
    const fieldLeft = portrait ? 0 : left.right;
    const fieldRight = portrait ? w : right.left;
    const fieldTop = portrait ? Math.max(top.bottom, left.bottom) : top.bottom;
    const rect = { left: fieldLeft, top: fieldTop, width: Math.max(200, fieldRight - fieldLeft), height: Math.max(120, (handTop - plaqueRoom - fieldTop) / 0.94) };
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
        await this.animate(update);
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
      });
      this.plaques[side].update(p.keep, p.wall);
    }
    fx.auras(
      this.fxContext(),
      this.shown.map((p) => ({ burn: p.burn, frozen: RESOURCES.some((r) => p.frost[r] > 0), keep: p.keep, keepStart: view.rules.keepStart })),
    );

    // Hand of the player looking at the screen.
    const handSeat = this.handSeat ?? view.viewer;
    this.hand.el.classList.toggle('concealed', !this.curtain.hidden || handSeat !== view.viewer);
    this.hand.render(this.handModel, { view, seat: handSeat, canAct });

    // Opponent's hand: backs, or faces when revealed.
    const opp = this.shown[other(handSeat)];
    const oppCards = opp.hand;
    if (this.oppHand.childElementCount !== oppCards.length || this.oppHand.dataset.key !== JSON.stringify(oppCards)) {
      this.oppHand.dataset.key = JSON.stringify(oppCards);
      this.oppHand.replaceChildren(
        ...oppCards.map((c) => {
          const el = c.cardId ? cardFace(c.cardId, { calm: true }) : cardBack();
          el.dataset.uid = String(c.uid);
          if (c.cardId) el.addEventListener('click', () => this.inspectCard(c.cardId!));
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
    this.stats.add(events);
    for (const e of events) {
      const line = describeEvent(e, (seat) => this.name(seat));
      if (line) this.log(line, e.type);
    }

    const starting = events.some((e) => e.type === 'gameStarted');
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

  /** Jump to a view without replaying its events (game start, resume). */
  private async snapTo(view: PlayerView, starting: boolean): Promise<void> {
    if (starting) {
      this.stats.reset();
      this.stats.add(this.queue.length ? [] : []);
      this.resultsShown = false;
      this.layer.replaceChildren();
      this.curtainFor = null;
      this.logList.replaceChildren();
      // Castle scale and progress bars follow this match's rules.
      this.field.setMaxPoints(view.rules.keepWin);
      for (const plaque of this.plaques) plaque.setKeepWin(view.rules.keepWin);
      this.field.setBanners([heroColor(view.players[this.seatOfSide(0)].hero), heroColor(view.players[this.seatOfSide(1)].hero)]);
      void this.field.setMood(skyFor(view.activeEvent?.id ?? null), 400);
    }
    this.view = view;
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
        this.showBanner(e.extraTurn ? t('extraTurn') : title, t('turnN', { n: e.turn }));
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
        const from = this.takeFromHand(e.player, e.uid);
        if (e.player === this.handSeat) this.handModel = this.handModel.filter((c) => c.uid !== e.uid);
        this.render();
        fx.cardLaunched();
        await this.showPlayed(e.cardId, from, e.combo);
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
        const from = this.takeFromHand(e.player, e.uid);
        if (e.player === this.handSeat) this.handModel = this.handModel.filter((c) => c.uid !== e.uid);
        this.render();
        audio.play('cardDiscard');
        await this.flyToDiscard(e.cardId, from);
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
          p.shield = Math.max(0, p.shield - 1);
          this.field.setShield(this.sideOf(e.target), p.shield);
        } else {
          p.wall = Math.max(0, p.wall - e.wallLoss);
          p.keep = Math.max(0, p.keep - e.keepLoss);
        }
        await fx.damage(e, ctx, this.heights(e.target));
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
        await fx.wallsSwapped(e.walls, [shown[0].keep, shown[1].keep], ctx);
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
          fx.ultimateReady(e.player, ctx, this.session.isLocal(e.player));
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
  private async showPlayed(cardId: string, from: DOMRect, combo: boolean): Promise<void> {
    this.clearPlayed();
    const card = cardFace(cardId, { className: 'played' });
    if (combo) card.append(h('span.combo-tag', null, t('comboReady')));
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
    card
      .animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.9 }], {
        duration: 380 * animScale(),
        easing: 'cubic-bezier(.4,0,.6,1)',
        fill: 'forwards',
      })
      .finished.catch(() => undefined)
      .then(() => {
        card.remove();
        if (id) this.setDiscardTop(id);
      });
  }

  private setDiscardTop(cardId: string | null): void {
    const top = cardId ? cardFace(cardId, { calm: true }) : cardBack();
    const count = this.discardPile.querySelector('.pile-count');
    this.discardPile.replaceChildren(top, count ?? h('span.pile-count'));
  }

  private async flyToDiscard(cardId: string | null, from: DOMRect, existing?: HTMLElement): Promise<void> {
    const card = existing ?? (cardId ? cardFace(cardId, { calm: true }) : cardBack());
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
    if (cardId) this.setDiscardTop(cardId);
  }

  private async showEventReveal(eventId: string): Promise<void> {
    const card = eventCard(eventId, { className: 'event-reveal' });
    const box = h('div.event-reveal-box', null, h('div.event-reveal-title', null, L({ es: 'Evento de batalla', en: 'Battle event' })), card);
    this.stage.appendChild(box);
    const anim = box.animate(
      [
        { transform: 'scale(0.6) rotate(-6deg)', opacity: 0 },
        { transform: 'scale(1.05) rotate(1deg)', opacity: 1, offset: 0.6 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 600 * animScale(), easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    await anim.finished.catch(() => undefined);
    await wait(1500);
    await box.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.9)' }], { duration: 300 * animScale(), fill: 'forwards' }).finished.catch(() => undefined);
    box.remove();
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
    this.render();
    this.session.act(action);
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

  private tryDiscard(uid: number): void {
    const ctx = this.hand.context;
    if (!ctx || !this.canAct()) return;
    this.act({ type: 'discard', player: ctx.seat, uid });
  }

  private onSelect(uid: number | null): void {
    this.closeInspect?.();
    if (uid === null) return;
    const ctx = this.hand.context;
    const cardId = this.hand.cardIdOf(uid);
    if (!ctx || !cardId) return;
    const reason = blockReason(ctx, cardId);
    const big = cardFace(cardId, { tilt: true, cost: undefined });
    big.classList.toggle('combo', !reason && this.hand.elementOf(uid)?.classList.contains('combo') === true);
    const costEl = this.hand.elementOf(uid)?.querySelector('.cost');
    if (costEl) big.querySelector('.cost')?.replaceWith(costEl.cloneNode(true));
    this.openInspect(
      big,
      L(getCard(cardId).text),
      {
        play: () => this.tryPlay(uid),
        discard: () => this.tryDiscard(uid),
        reason,
        canAct: ctx.canAct,
      },
      () => this.hand.select(null),
    );
  }

  private openInspect(card: HTMLElement, text: string, actions?: Parameters<typeof inspectPanel>[0]['actions'], onClose?: () => void): void {
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
  }

  private inspectCard(cardId: string): void {
    audio.play('cardSelect');
    this.openInspect(cardFace(cardId, { tilt: true }), L(getCard(cardId).text));
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
    if (e.key === 'Escape') {
      if (this.closeInspect) this.closeInspect();
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
    const titleKey = pending.kind === 'frostResource' ? 'chooseFrost' : pending.kind === 'discardFromHand' ? 'chooseDiscard' : 'chooseEnchantment';
    const choose = (option: string): void => {
      audio.play('uiClick');
      close();
      this.act({ type: 'choose', player: view.viewer, option });
    };
    const options = pending.options.map((option) => {
      if (pending.kind === 'frostResource') {
        const opp = view.players[other(view.viewer)];
        const res = option as (typeof RESOURCES)[number];
        const row = this.panels[this.sideOf(other(view.viewer))].resourceRow(res).cloneNode(true) as HTMLElement;
        return h('button.choice-option.res-option', { type: 'button', onclick: () => choose(option), title: `${opp.resources[res]}` }, row);
      }
      if (pending.kind === 'discardFromHand') {
        const card = pending.revealed?.find((c) => String(c.uid) === option);
        const face = card ? cardFace(card.cardId, { calm: true }) : cardBack();
        return h('button.choice-option.card-option', { type: 'button', onclick: () => choose(option) }, face);
      }
      return h('button.choice-option.card-option', { type: 'button', onclick: () => choose(option) }, cardFace(option, { calm: true }));
    });
    const box = h('div.choice-box.panel', null, h('h2', null, t(titleKey)), h('div.choice-options', { class: `kind-${pending.kind}` }, options));
    const wrap = h('div.choice', null, box);
    this.layer.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const close = (): void => wrap.remove();
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
