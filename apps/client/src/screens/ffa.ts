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
import { h } from '../app/dom';
import { L, locale } from '../app/i18n';
import type { Screen } from '../app/router';
import { audio } from '../fx/audio';
import { describeEvent } from '../game/describe';
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
      tx('Como el anterior, y el Torreón más alto recibe +2 por ataque.', 'As above, and the tallest Keep takes +2 per attack.'),
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

const ME: PlayerId = 0;
const AI_DELAY = 750;

function randomHeroes(mine: HeroId): HeroId[] {
  const pool = HEROES.map((x) => x.id).filter((id) => id !== mine);
  pool.sort(() => Math.random() - 0.5);
  return [mine, pool[0]!, pool[1]!];
}

function randomSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(3))).join('-');
}

export function ffaScreen(): Screen {
  const el = h('div.ffa-screen');
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
            'Prototipo: tú contra dos IA (nivel Normal). Gana el último castillo en pie o el primero que complete su Torreón.',
            'Prototype: you against two AIs (Normal level). The last castle standing, or the first to complete its Keep, wins.',
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

  const mover = (s: GameState): PlayerId => s.pending?.player ?? s.active;

  const record = (events: GameEvent[]): void => {
    for (const e of redactEvents(events, ME)) {
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
    if (!state || closed) return;
    const result = applyAction(state, action);
    if (!result.ok) return;
    state = result.state;
    record(result.events);
    if (result.events.some((e) => e.type === 'damage' && !e.blocked)) audio.play('uiClick');
    render();
    schedule();
  };

  const schedule = (): void => {
    if (aiTimer || !state || state.phase === 'finished' || mover(state) === ME) return;
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
    const s = state!;
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
    if (!state || mover(state) !== ME || state.phase !== 'action') return;
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
    if (!state || mover(state) !== ME) return;
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
    if (!state) return;
    const view = getPlayerView(state, ME);
    const myTurn = mover(state) === ME && state.phase !== 'finished';
    const me = view.players[ME]!;

    const event = getBattleEvent(view.activeEvent?.id ?? view.upcomingEvent.id);
    const eventLine = view.activeEvent
      ? tx(`Evento en curso: ${L(event.name)} (${view.activeEvent.turnsLeft})`, `Running event: ${L(event.name)} (${view.activeEvent.turnsLeft})`)
      : tx(`Próximo evento en el turno ${view.upcomingEvent.turn}: ${L(event.name)}`, `Next event on turn ${view.upcomingEvent.turn}: ${L(event.name)}`);

    const status = state.result
      ? state.result.winner === ME
        ? tx('¡Has ganado!', 'You win!')
        : state.result.winner === null
          ? tx('Empate', 'Draw')
          : tx(`Gana ${names[state.result.winner]}`, `${names[state.result.winner]} wins`)
      : me.eliminated
        ? tx(`Tu castillo ha caído. Turno de ${names[state.active]}…`, `Your castle fell. ${names[state.active]}'s turn…`)
        : aiming
        ? tx('Elige a qué rival apuntas', 'Pick the rival to target')
        : myTurn
          ? discardMode
            ? tx('Toca una carta para descartarla', 'Tap a card to discard it')
            : tx('Tu turno: juega una carta', 'Your turn: play a card')
          : tx(`Turno de ${names[state.active]}…`, `${names[state.active]}'s turn…`);

    const hand = h(
      'div.ffa-hand',
      null,
      me.hand.map((c) => {
        if (!c.cardId) return null;
        const blocked = !!playBlocker(view, ME, c.cardId);
        const face = cardFace(c.cardId, {
          cost: effectiveCost(view, ME, c.cardId),
          calm: true,
          className: myTurn && !discardMode ? (blocked ? 'blocked' : 'playable') : '',
        });
        face.addEventListener('click', () => onCard(view, c.uid, c.cardId!));
        return face;
      }),
    );

    const controls = state.result
      ? h(
          'div.ffa-controls',
          null,
          h('button.btn.primary', { type: 'button', onclick: () => start() }, tx('Otra partida', 'Play again')),
          h('button.btn', { type: 'button', onclick: () => (state = null, setup()) }, tx('Cambiar regla', 'Change rule')),
          h('button.btn', { type: 'button', onclick: () => flow.menu() }, tx('Menú', 'Menu')),
        )
      : h(
          'div.ffa-controls',
          null,
          h(
            'button.btn',
            {
              type: 'button',
              disabled: !myTurn || state.phase !== 'action',
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
              disabled: !myTurn || state.phase !== 'action' || !isUltimateReady(view, ME),
              onclick: () => onUltimate(view),
            },
            L(TERMS.ultimate),
          ),
          aiming
            ? h('button.btn', { type: 'button', onclick: () => ((aiming = null), render()) }, tx('Cancelar', 'Cancel'))
            : null,
          h('button.btn.ghost', { type: 'button', onclick: () => act({ type: 'concede', player: ME }) }, tx('Rendirse', 'Concede')),
        );

    el.replaceChildren(
      h('div.ffa-rivals', null, castlePanel(view, 1), castlePanel(view, 2)),
      h(
        'div.ffa-middle',
        null,
        h('div.ffa-turn', null, h('strong', null, status), h('small', null, `${variant.name()} · ${eventLine}`)),
        choicePanel(view),
        h('ol.ffa-log.panel', null, log.slice(-8).map((line) => h('li', null, line))),
      ),
      castlePanel(view, ME),
      controls,
      hand,
    );
  };

  return {
    el,
    mount() {
      audio.music('menu');
      setup();
    },
    unmount() {
      closed = true;
      if (aiTimer) clearTimeout(aiTimer);
    },
    relocalize() {
      if (state) render();
      else setup();
    },
  };
}
