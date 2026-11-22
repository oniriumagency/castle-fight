import { getEnchantmentModifiers, hasCombo, type GameEvent, type PlayerView } from '@cardcraft-castles/engine';
import { t } from '../../app/i18n';
import type { MatchSession } from '../../game/session';
import { tutorial } from '../../game/tutorial';
import { createCoach, type Coach, type CoachStep } from '../../ui/coach';

/**
 * The guide inside a game: the guided first campaign battle (one idea at a
 * time, as the game reaches it: the goal, the Wall, resources, playing a card,
 * Ready, the rival's hit, attacking, reading and discarding, the menu), then
 * one-off tips the first time something happens (a Combo card, a battle event,
 * the Twilight Fury, an enchantment, the ultimate). Returns a function that stops it.
 */
export function startBattleGuide(session: MatchSession, root: HTMLElement, opts: { firstBattle: boolean }): () => void {
  const me = 0;
  let view: PlayerView | null = null;
  let stopped = false;
  type Waiter = { test: (view: PlayerView, events: GameEvent[]) => boolean; resolve: () => void };
  const waiters = new Set<Waiter>();
  const tips: (() => Promise<void>)[] = [];
  let coach: Coach | null = null;
  let busy = false;
  let unsubscribe: () => void = () => {};

  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const q = (selector: string) => (): Element | null => root.querySelector(selector);
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const myTurn = (v: PlayerView): boolean => v.phase === 'action' && v.active === me && !v.pending && !v.result;
  const guiding = (): boolean => opts.firstBattle && !tutorial.done('battle');

  const until = (test: Waiter['test']): Promise<void> =>
    new Promise((resolve) => {
      if (view && test(view, [])) return resolve();
      waiters.add({ test, resolve });
    });

  /** Polls the screen (the board animates before it shows some things). */
  const shown = async (find: () => Element | null, ms = 8000): Promise<boolean> => {
    const visible = (): boolean => {
      const el = find() as HTMLElement | null;
      return !!el && !el.hidden && el.getBoundingClientRect().width > 0;
    };
    for (let waited = 0; waited < ms && !stopped && !visible(); waited += 150) await sleep(150);
    return !stopped && visible();
  };

  const getCoach = (): Coach => {
    coach ??= createCoach(() => {
      tutorial.skipAll();
      stop();
    });
    return coach;
  };

  const step = async (s: CoachStep): Promise<boolean> => (stopped ? false : getCoach().show(s));

  /** A card in the hand: a playable one of that school. */
  const handCard =
    (school: string): (() => Element | null) =>
    () =>
      root.querySelector(`.hand .hand-card.playable.s-${school}`);

  const played = (v: PlayerView, events: GameEvent[]): boolean =>
    events.some((ev) => (ev.type === 'cardPlayed' || ev.type === 'cardDiscarded') && ev.player === me) || !myTurn(v) || v.actionsLeft === 0;

  /** Points at a card to play and waits until the player plays (or discards) one. */
  const playStep = (school: string, text: string): Promise<boolean> =>
    step({
      target: handCard(school),
      text,
      gesture: 'drag',
      dragTo: q('.board-field'),
      passThrough: true,
      until: (done) => void until(played).then(done),
    });

  /** Points at Ready and waits for the turn to pass. */
  const readyStep = async (): Promise<boolean> => {
    if (!view || !myTurn(view) || !(await shown(q('.ready-btn')))) return true;
    return step({ target: q('.ready-btn'), text: t('tutReady'), gesture: 'tap', passThrough: true, until: (done) => void until((v) => !myTurn(v)).then(done) });
  };

  const guided = async (): Promise<void> => {
    // Turn 1: the goal, the Wall, resources, a card, Ready.
    await until(myTurn);
    await sleep(1600);
    if (!(await step({ target: q('.board-field'), text: t('tutGoal', { win: view?.rules.keepWin ?? 100 }), pad: 4 }))) return;
    if (!(await step({ target: q('.plaque-0'), text: t('tutWall') }))) return;
    if (!(await step({ target: q('.side-0 .resources'), text: t('tutResources') }))) return;
    if (view && myTurn(view) && handCard('construccion')()) {
      if (!(await playStep('construccion', t(finePointer ? 'tutPlayMouse' : 'tutPlay')))) return;
    }
    if (!(await readyStep())) return;
    getCoach().close();

    // The rival's turn: if their hit took some of the Wall, show it.
    const wallBefore = view?.players[me]?.wall ?? 0;
    await until(myTurn);
    if ((view?.players[me]?.wall ?? 0) < wallBefore) {
      await sleep(1200);
      if (!(await step({ target: q('.plaque-0'), text: t('tutWallHit') }))) return;
      getCoach().close();
    }

    // The next turns: attack, as soon as there is an Assault card to pay for.
    for (let turn = 0; turn < 3; turn++) {
      if (turn > 0) {
        await until((v) => !myTurn(v));
        await until(myTurn);
      }
      await sleep(1200);
      if (!handCard('asalto')()) continue;
      if (!(await playStep('asalto', t('tutAttack')))) return;
      if (!(await readyStep())) return;
      getCoach().close();
      break;
    }

    // A later turn: reading and discarding, then the menu.
    await until((v) => myTurn(v) && v.actionsLeft > 0 && v.turn >= 5);
    await sleep(1200);
    if (!(await step({ target: q('.hand'), text: t(finePointer ? 'tutReadMouse' : 'tutRead'), passThrough: true, pad: 2 }))) return;
    if (!(await step({ target: q('.hand'), text: t('tutDiscard'), passThrough: true, pad: 2 }))) return;
    if (!(await step({ target: q('.menu-btn'), text: t('tutMenu') }))) return;
    getCoach().close();
    tutorial.mark('battle');
  };

  // ---------------------------------------------------------------------------
  // One-off tips, shown on the player's own turn when nothing else is on screen.
  // ---------------------------------------------------------------------------
  const tip = (id: string, s: CoachStep): void => {
    if (tutorial.tipSeen(id) || tips.length > 4) return;
    tutorial.markTip(id);
    tips.push(async () => {
      if (await shown(s.target ?? (() => null), 3000)) await step(s);
    });
    void drain();
  };

  const drain = async (): Promise<void> => {
    if (busy || guiding()) return;
    busy = true;
    try {
      while (tips.length && !stopped) {
        await until(myTurn);
        await sleep(900);
        await tips.shift()!();
        coach?.close();
      }
    } finally {
      busy = false;
    }
  };

  const queueTips = (v: PlayerView, events: GameEvent[]): void => {
    if (guiding()) return;
    for (const ev of events) {
      if (ev.type === 'battleEventStarted') tip('event', { target: q('.event-chip'), text: t('tutTipEvent') });
      if (ev.type === 'twilightRose' && ev.level === 1) tip('twilight', { target: q('.twilight-chip'), text: t('tutTipTwilight') });
      if (ev.type === 'cardPlayed' && ev.player === me && getEnchantmentModifiers(ev.cardId)) tip('enchant', { target: q('.side-0 .enchants'), text: t('tutTipEnchant') });
    }
    if (!myTurn(v)) return;
    if (v.players[me]?.ultimateReady) tip('ultimate', { target: q('.ult-hero'), text: t('tutTipUltimate'), gesture: 'tap', passThrough: true });
    const combo = v.players[me]?.hand.find((c) => c.cardId && hasCombo(c.cardId));
    if (combo) tip('combo', { target: () => root.querySelector(`.hand .hand-card[data-uid="${combo.uid}"]`), text: t('tutTipCombo'), passThrough: true });
  };

  function stop(): void {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    waiters.clear();
    coach?.close();
  }

  unsubscribe = session.subscribe((e) => {
    if (e.type !== 'state') return;
    view = e.view;
    for (const w of [...waiters]) {
      if (w.test(e.view, e.events)) {
        waiters.delete(w);
        w.resolve();
      }
    }
    if (e.view.result) stop();
    else queueTips(e.view, e.events);
  });

  if (guiding()) {
    void guided()
      .catch((err: unknown) => console.error('[tutorial]', err))
      .then(() => {
        coach?.close();
        void drain();
      });
  }
  return stop;
}
