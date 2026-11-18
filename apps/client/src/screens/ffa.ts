import { chooseAction } from '@cardcraft-castles/ai';
import {
  HEROES,
  RESOURCES,
  RESOURCE_NAMES,
  TERMS,
  applyAction,
  cardNeedsTarget,
  choosesTargets,
  createGame,
  effectiveCost,
  effectsNeedTarget,
  getBattleEvent,
  getCard,
  getHero,
  getPlayerView,
  isUltimateReady,
  leaderOf,
  playBlocker,
  redactEvents,
  ultimateThreshold,
  type Action,
  type GameEvent,
  type GameState,
  type HeroId,
  type PlayerId,
  type PlayerPublicState,
  type PlayerView,
  type Rules,
} from '@cardcraft-castles/engine';
import { h, toast } from '../app/dom';
import { L, locale, t } from '../app/i18n';
import type { Screen } from '../app/router';
import { audio } from '../fx/audio';
import { describeEvent } from '../game/describe';
import { twilightLine, twilightStatus } from '../game/twilight';
import type { OnlineSession } from '../net/online';
import { cardFace } from '../ui/card';
import { flow, nickname } from './flow';

/**
 * Free-for-all prototype: you against two AIs, on a plain DOM board. It is a
 * test bench for the 3-player rules, not the final board: the painted
 * battlefield still shows two castles, so this screen covers it.
 */

const tx = (es: string, en: string): string => (locale() === 'es' ? es : en);

interface Variant {
  id: string;
  name: () => string;
  hint: () => string;
  rules: Partial<Rules>;
}

const VARIANTS: Variant[] = [
  {
    id: 'all60',
    name: () => tx('Golpea a todos (×0,6)', 'Hit everyone (×0.6)'),
    hint: () =>
      tx(
        'Cada carta de daño, robo o estado afecta a los dos rivales, al 60 %.',
        'Every damage, steal or status card affects both rivals, at 60%.',
      ),
    rules: { multiTargeting: 'all', multiAllScale: 0.6 },
  },
  {
    id: 'all60Leader',
    name: () => tx('Golpea a todos + castigo al líder', 'Hit everyone + leader penalty'),
    hint: () =>
      tx('Como el anterior, y el Castillo más alto recibe +2 por ataque.', 'As above, and the tallest Castle takes +2 per attack.'),
    rules: { multiTargeting: 'all', multiAllScale: 0.6, leaderExtraDamage: 2 },
  },
  {
    id: 'chooseLeader',
    name: () => tx('Eliges rival + castigo al líder', 'Pick a rival + leader penalty'),
    hint: () =>
      tx(
        'Cada carta apunta a un rival. El líder recibe +2 y quien derriba un castillo gana 5 de cada recurso.',
        'Each card targets one rival. The leader takes +2 and whoever knocks a castle down gains 5 of each resource.',
      ),
    rules: { multiTargeting: 'choose', leaderExtraDamage: 2, eliminationBounty: 5 },
  },
];

const AI_DELAY = 750;

function randomHeroes(mine: HeroId): HeroId[] {
  const pool = HEROES.map((x) => x.id).filter((id) => id !== mine);
  pool.sort(() => Math.random() - 0.5);
  return [mine, pool[0]!, pool[1]!];
}

function randomSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(3))).join('-');
}

/**
 * The free-for-all board. Without a session it is the local prototype (you
 * against two AIs); with an online session it shows that room's game.
 */
export function ffaScreen(session?: OnlineSession): Screen {
  const el = h('div.ffa-screen');
  const net = session ?? null;
  /** The seat this device plays. */
  let ME: PlayerId = net ? net.seat : 0;
  /** What is on screen: the view of `ME`. */
  let current: PlayerView | null = null;
  let deadline: number | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let offSession = (): void => {};
  let variant = VARIANTS[0]!;
  let hero: HeroId = HEROES[0]!.id;
  let state: GameState | null = null;
  let names: string[] = [];
  let log: string[] = [];
  let discardMode = false;
  /** A card (or the ultimate) waiting for its target, in `choose` mode. */
  let aiming: { kind: 'play'; uid: number } | { kind: 'ultimate' } | null = null;
  let aiTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  const setup = (): void => {
    const variantList = h(
      'div.ffa-variants',
      null,
      VARIANTS.map((v) =>
        h(
          'label.ffa-variant',
          null,
          h('input', {
            type: 'radio',
            name: 'ffa-variant',
            checked: v === variant,
            onchange: () => (variant = v),
          }),
          h('span', null, h('strong', null, v.name()), h('small', null, v.hint())),
        ),
      ),
    );
    const heroSelect = h(
      'select.ffa-select',
      { onchange: (e: Event) => (hero = (e.target as HTMLSelectElement).value) },
      HEROES.map((x) => h('option', { value: x.id, selected: x.id === hero }, L(x.name))),
    );
    el.replaceChildren(
      h(
        'div.ffa-setup.panel',
        null,
        h('h2', null, tx('Todos contra todos', 'Free-for-all')),
        h(
          'p.ffa-note',
          null,
          tx(
            'Prototipo: tú contra dos IA (nivel Normal). Gana el último que quede en pie o el primero que complete su Castillo.',
            'Prototype: you against two AIs (Normal level). The last one standing, or the first to complete their Castle, wins.',
          ),
        ),
        h('div.field', null, tx('Regla de objetivo', 'Targeting rule'), variantList),
        h('label.field', null, tx('Tu héroe', 'Your hero'), heroSelect),
        h(
          'div.ffa-actions',
          null,
          h('button.btn', { type: 'button', onclick: () => flow.menu() }, tx('Volver', 'Back')),
          h('button.btn.primary', { type: 'button', onclick: () => start() }, tx('Empezar', 'Start')),
        ),
      ),
    );
  };

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  const start = (): void => {
    audio.play('uiClick');
    const heroes = randomHeroes(hero);
    const created = createGame({ seed: randomSeed(), heroes, rules: variant.rules });
    state = created.state;
    current = getPlayerView(state, ME);
    names = heroes.map((id, i) =>
      i === ME ? nickname(tx('Tú', 'You')) : `${tx('IA', 'AI')} ${i} · ${L(getHero(id).name)}`,
    );
    log = [];
    discardMode = false;
    aiming = null;
    record(created.events);
    render();
    schedule();
  };

  const mover = (s: { pending: { player: PlayerId } | null; active: PlayerId }): PlayerId => s.pending?.player ?? s.active;

  /** Seat names for an online room: nickname and hero. */
  const onlineNames = (view: PlayerView): string[] =>
    view.players.map((p, i) => {
      const nick = net?.room?.seats[i]?.nickname ?? `${tx('Jugador', 'Player')} ${i + 1}`;
      return i === ME ? `${nick} (${tx('tú', 'you')})` : `${nick} · ${L(getHero(p.hero).name)}`;
    });

  const record = (events: GameEvent[]): void => {
    // Local events are redacted here; the server already redacts online ones.
    for (const e of net ? events : redactEvents(events, ME)) {
      let line: string | null;
      if (e.type === 'playerEliminated') {
        line = tx(`¡Cae el castillo de ${names[e.player]}!`, `${names[e.player]}'s castle falls!`);
      } else if (e.type === 'gameOver') {
        line =
          e.winner === null
            ? tx('Empate.', 'Draw.')
            : tx(`${names[e.winner]} gana la partida.`, `${names[e.winner]} wins the game.`);
      } else {
        line = describeEvent(e, (seat) => names[seat] ?? '?');
      }
      if (line) log.push(line);
    }
    log = log.slice(-40);
  };

  const act = (action: Action): void => {
    if (closed) return;
    if (net) {
      if (action.type !== 'timeout') net.act(action);
      return;
    }
    if (!state) return;
    const result = applyAction(state, action);
    if (!result.ok) return;
    state = result.state;
    current = getPlayerView(state, ME);
    record(result.events);
    if (result.events.some((e) => e.type === 'damage' && !e.blocked)) audio.play('uiClick');
    render();
    schedule();
  };

  const schedule = (): void => {
    if (net || aiTimer || !state || state.phase === 'finished' || mover(state) === ME) return;
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (closed || !state || state.phase === 'finished' || mover(state) === ME) return;
      act(chooseAction(state, 'normal'));
    }, AI_DELAY);
  };

  // ---------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------

  const meter = (label: string, value: number, max: number, cls: string): HTMLElement =>
    h(
      `div.ffa-meter.${cls}`,
      null,
      h('span.ffa-meter-label', null, label),
      h('span.ffa-meter-bar', null, h('i', { style: `width:${Math.min(100, (value / max) * 100)}%` })),
      h('b', null, String(value)),
    );

  const castlePanel = (view: PlayerView, seat: PlayerId): HTMLElement => {
    const p: PlayerPublicState = view.players[seat]!;
    const s = view;
    const leader = leaderOf(view);
    const targetable = aiming !== null && seat !== ME && !p.eliminated;
    const statuses: string[] = [];
    if (p.burn) statuses.push(`🔥 ${L(TERMS.burn)} ${p.burn}`);
    const frozen = RESOURCES.filter((r) => p.frost[r] > 0);
    if (frozen.length) statuses.push(`❄ ${frozen.map((r) => L(RESOURCE_NAMES[r])).join(', ')}`);
    if (p.shield) statuses.push(`🛡 ${L(TERMS.shield)} ${p.shield}`);
    for (const e of p.enchantments) statuses.push(`✦ ${L(getCard(e.cardId).name)} (${e.turnsLeft})`);
    if (p.handRevealed) statuses.push(tx('Mano revelada', 'Hand revealed'));

    return h(
      'section.ffa-castle.panel',
      {
        class: [
          seat === ME ? 'me' : 'rival',
          s.active === seat && s.phase !== 'finished' ? 'active' : '',
          p.eliminated ? 'out' : '',
          targetable ? 'targetable' : '',
        ].join(' '),
        onclick: targetable ? () => aimAt(seat) : null,
      },
      h(
        'header',
        null,
        h('strong', null, names[seat]),
        seat === ME ? h('small', null, L(getHero(p.hero).name)) : null,
        leader === seat ? h('span.ffa-tag.lead', null, tx('Líder', 'Leader')) : null,
        p.eliminated ? h('span.ffa-tag.out', null, tx('Derribado', 'Fallen')) : null,
        targetable ? h('span.ffa-tag.aim', null, tx('Apuntar aquí', 'Target')) : null,
      ),
      meter(L(TERMS.keep), p.keep, s.rules.keepWin, 'keep'),
      meter(L(TERMS.wall), p.wall, Math.max(60, p.wall), 'wall'),
      h(
        'div.ffa-res',
        null,
        RESOURCES.map((r) =>
          h('span', { class: `res-${r}` }, `${L(RESOURCE_NAMES[r])} ${p.resources[r]} `, h('small', null, `+${p.workers[r]}`)),
        ),
      ),
      h(
        'div.ffa-status',
        null,
        `${L(TERMS.ultimate)} ${p.ultimateCharge}/${ultimateThreshold(view, seat)}`,
        seat !== ME ? ` · ${tx('Cartas', 'Cards')} ${p.hand.length}` : '',
        statuses.length ? ` · ${statuses.join(' · ')}` : '',
      ),
    );
  };

  const aimAt = (target: PlayerId): void => {
    const a = aiming;
    aiming = null;
    if (!a) return;
    act(a.kind === 'play' ? { type: 'play', player: ME, uid: a.uid, target } : { type: 'ultimate', player: ME, target });
  };

  const needsAim = (view: PlayerView, needs: boolean): boolean =>
    needs && choosesTargets(view) && view.players.filter((p, i) => i !== ME && !p.eliminated).length > 1;

  const onCard = (view: PlayerView, uid: number, cardId: string): void => {
    if (mover(view) !== ME) return;
    // "Discard a card of your own" choices can be answered by tapping the card.
    if (view.pending?.kind === 'discardOwn' && view.pending.options.includes(String(uid))) {
      act({ type: 'choose', player: ME, option: String(uid) });
      return;
    }
    if (view.phase !== 'action') return;
    if (discardMode) {
      discardMode = false;
      act({ type: 'discard', player: ME, uid });
      return;
    }
    if (playBlocker(view, ME, cardId)) return;
    if (needsAim(view, cardNeedsTarget(cardId))) {
      aiming = { kind: 'play', uid };
      render();
      return;
    }
    act({ type: 'play', player: ME, uid });
  };

  const onUltimate = (view: PlayerView): void => {
    if (mover(view) !== ME) return;
    if (needsAim(view, effectsNeedTarget(getHero(view.players[ME]!.hero).ultimate))) {
      aiming = { kind: 'ultimate' };
      render();
      return;
    }
    act({ type: 'ultimate', player: ME });
  };

  const choicePanel = (view: PlayerView): HTMLElement | null => {
    const pending = view.pending;
    if (!pending || pending.player !== ME) return null;
    const label = (option: string): string => {
      switch (pending.kind) {
        case 'frostResource':
          return L(RESOURCE_NAMES[option as keyof typeof RESOURCE_NAMES]);
        case 'destroyEnchantment':
          return L(getCard(option).name);
        case 'discardFromHand': {
          const card = pending.revealed?.find((c) => String(c.uid) === option);
          return card ? L(getCard(card.cardId).name) : option;
        }
        case 'discardOwn': {
          if (option === 'done') return tx('Terminar', 'Done');
          const card = view.players[ME]!.hand.find((c) => String(c.uid) === option);
          return card?.cardId ? L(getCard(card.cardId).name) : option;
        }
      }
    };
    const title = {
      frostResource: tx('¿Qué recurso congelas?', 'Which resource do you freeze?'),
      destroyEnchantment: tx('¿Qué encantamiento destruyes?', 'Which enchantment do you destroy?'),
      discardFromHand: tx('¿Qué carta le descartas?', 'Which card do they discard?'),
      discardOwn: tx('¿Qué carta descartas?', 'Which card do you discard?'),
    }[pending.kind];
    return h(
      'div.ffa-choice.panel',
      null,
      h('strong', null, title),
      h(
        'div',
        null,
        pending.options.map((o) =>
          h('button.btn', { type: 'button', onclick: () => act({ type: 'choose', player: ME, option: o }) }, label(o)),
        ),
      ),
    );
  };

  const render = (): void => {
    if (!current) return;
    const view = current;
    const myTurn = mover(view) === ME && view.phase !== 'finished';
    const me = view.players[ME]!;

    const event = getBattleEvent(view.activeEvent?.id ?? view.upcomingEvent.id);
    const eventLine = view.activeEvent
      ? tx(`Evento en curso: ${L(event.name)} (${view.activeEvent.turnsLeft})`, `Running event: ${L(event.name)} (${view.activeEvent.turnsLeft})`)
      : tx(`Próximo evento en el turno ${view.upcomingEvent.turn}: ${L(event.name)}`, `Next event on turn ${view.upcomingEvent.turn}: ${L(event.name)}`);
    const fury = view.phase === 'finished' ? null : twilightStatus(view);
    const furyLine = fury ? ` · ${t('twilightName')}: ${twilightLine(fury)}` : '';

    const status = view.result
      ? view.result.winner === ME
        ? tx('¡Has ganado!', 'You win!')
        : view.result.winner === null
          ? tx('Empate', 'Draw')
          : tx(`Gana ${names[view.result.winner]}`, `${names[view.result.winner]} wins`)
      : me.eliminated
        ? tx(`Tu castillo ha caído. Turno de ${names[view.active]}…`, `Your castle fell. ${names[view.active]}'s turn…`)
        : aiming
        ? tx('Elige a qué rival apuntas', 'Pick the rival to target')
        : myTurn
          ? discardMode
            ? tx('Toca una carta para descartarla', 'Tap a card to discard it')
            : tx('Tu turno: juega una carta', 'Your turn: play a card')
          : tx(`Turno de ${names[view.active]}…`, `${names[view.active]}'s turn…`);

    const hand = h(
      'div.ffa-hand',
      null,
      me.hand.map((c) => {
        if (!c.cardId) return null;
        const blocked = !!playBlocker(view, ME, c.cardId);
        const face = cardFace(c.cardId, {
          cost: effectiveCost(view, ME, c.cardId),
          calm: true,
          className:
            myTurn && view.phase === 'action' && !discardMode
              ? blocked
                ? 'blocked'
                : 'playable'
              : view.pending?.kind === 'discardOwn' && view.pending.player === ME && view.pending.options.includes(String(c.uid))
                ? 'playable'
                : '',
        });
        face.addEventListener('click', () => onCard(view, c.uid, c.cardId!));
        return face;
      }),
    );

    const controls = view.result
      ? h(
          'div.ffa-controls',
          null,
          ...(net ? onlineEndButtons() : [
            h('button.btn.primary', { type: 'button', onclick: () => start() }, tx('Otra partida', 'Play again')),
            h('button.btn', { type: 'button', onclick: () => ((state = null), (current = null), setup()) }, tx('Cambiar regla', 'Change rule')),
            h('button.btn', { type: 'button', onclick: () => flow.menu() }, tx('Menú', 'Menu')),
          ]),
        )
      : h(
          'div.ffa-controls',
          null,
          h(
            'button.btn',
            {
              type: 'button',
              disabled: !myTurn || view.phase !== 'action',
              class: discardMode ? 'primary' : '',
              onclick: () => {
                discardMode = !discardMode;
                aiming = null;
                render();
              },
            },
            discardMode ? tx('Cancelar descarte', 'Cancel discard') : tx('Descartar', 'Discard'),
          ),
          h(
            'button.btn',
            {
              type: 'button',
              disabled: !myTurn || view.phase !== 'action' || !isUltimateReady(view, ME),
              onclick: () => onUltimate(view),
            },
            L(TERMS.ultimate),
          ),
          aiming
            ? h('button.btn', { type: 'button', onclick: () => ((aiming = null), render()) }, tx('Cancelar', 'Cancel'))
            : null,
          h('button.btn.ghost', { type: 'button', onclick: () => act({ type: 'concede', player: ME }) }, tx('Rendirse', 'Concede')),
          net ? h('button.btn.ghost', { type: 'button', onclick: () => leaveOnline() }, tx('Salir', 'Leave')) : null,
        );

    el.replaceChildren(
      // Rivals in turn order after you: the next to play on the left.
      h('div.ffa-rivals', null, view.players.map((_, k) => (ME + 1 + k) % view.players.length).filter((s) => s !== ME).map((s) => castlePanel(view, s))),
      h(
        'div.ffa-middle',
        null,
        h('div.ffa-turn', null, h('strong', null, status), net ? h('span.ffa-clock', null, clockText()) : null, h('small', null, `${net ? '' : `${variant.name()} · `}${eventLine}${furyLine}`)),
        choicePanel(view),
        h('ol.ffa-log.panel', null, log.slice(-8).map((line) => h('li', null, line))),
      ),
      castlePanel(view, ME),
      controls,
      hand,
    );
  };

  // ---------------------------------------------------------------------------
  // Online
  // ---------------------------------------------------------------------------

  const clockText = (): string => {
    if (deadline === null) return tx('Sin límite de tiempo', 'No time limit');
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return tx(`${left} s de turno`, `${left} s left`);
  };

  const onlineEndButtons = (): HTMLElement[] => {
    const room = net!.room;
    const mine = room?.seats[ME]?.rematch ?? false;
    const gone = room?.seats.some((seatInfo, i) => i !== ME && (!seatInfo || seatInfo.left)) ?? true;
    const waiting = room?.seats.filter((seatInfo, i) => i !== ME && seatInfo?.rematch).length ?? 0;
    return [
      h(
        'button.btn.primary',
        { type: 'button', disabled: mine || gone, onclick: () => (audio.play('uiClick'), net!.rematch()) },
        gone
          ? tx('Alguien se ha ido', 'Someone left')
          : mine
            ? tx(`Revancha pedida (${waiting + 1}/${room?.seats.length ?? 3})`, `Rematch asked (${waiting + 1}/${room?.seats.length ?? 3})`)
            : tx(`Revancha (${waiting}/${room?.seats.length ?? 3})`, `Rematch (${waiting}/${room?.seats.length ?? 3})`),
      ),
      h('button.btn', { type: 'button', onclick: () => leaveOnline() }, tx('Salir al lobby', 'Back to lobby')),
    ];
  };

  const leaveOnline = (): void => {
    audio.play('uiBack');
    net?.leave();
    flow.lobby();
  };

  const startOnline = (s: OnlineSession): void => {
    offSession = s.subscribe((event) => {
      switch (event.type) {
        case 'state': {
          const fresh = !current || event.view.seq < current.seq || event.view.turn < current.turn;
          if (fresh) log = [];
          ME = event.view.viewer;
          current = event.view;
          deadline = event.deadline;
          names = onlineNames(event.view);
          record(event.events);
          aiming = null;
          if (mover(event.view) !== ME) discardMode = false;
          render();
          break;
        }
        case 'clock':
          deadline = event.deadline;
          break;
        case 'presence':
          if (current) {
            names = onlineNames(current);
            render();
          }
          break;
        case 'error':
          toast(event.message, 'warn');
          break;
        case 'status':
          if (event.status === 'closed') {
            toast(event.message || tx('Se cerró la sala', 'The room closed'), 'warn', 4000);
            flow.lobby();
          }
          break;
        default:
          break;
      }
    });
    // Only the clock line changes every second.
    tickTimer = setInterval(() => {
      const clock = el.querySelector('.ffa-clock');
      if (clock) clock.textContent = clockText();
    }, 1000);
  };

  return {
    el,
    mount() {
      audio.music('menu');
      if (net) startOnline(net);
      else setup();
    },
    unmount() {
      closed = true;
      offSession();
      if (aiTimer) clearTimeout(aiTimer);
      if (tickTimer) clearInterval(tickTimer);
    },
    relocalize() {
      if (current) render();
      else if (!net) setup();
    },
  };
}
