import { describe, expect, it } from 'vitest';
import { BATTLE_EVENTS, CARDS, DEFAULT_RULES, HEROES, applyAction, createGame, getPlayerView, legalActions, playGame, randomPolicy, eagerPolicy } from '../src/index';
import { mustApply, setHand } from '../src/testing';
import type { EffectOp, GameState, Rules } from '../src/types';

/** A 3-player game on turn 1, player 0 to move, everyone level and rich. */
function threeWay(rules: Partial<Rules> = {}): GameState {
  const { state } = createGame({
    seed: 3,
    heroes: ['guardian', 'guardian', 'guardian'],
    firstPlayer: 0,
    rules: { secondPlayerWall: 0, multiSeatWall: 0, ...rules },
  });
  for (const p of state.players) {
    p.resources = { piedra: 50, acero: 50, mana: 50 };
    p.wall = state.rules.wallStart;
  }
  state.actionsLeft = 2;
  return state;
}

describe('three players', () => {
  it('deals three hands and plays in a circle', () => {
    const { state } = createGame({ seed: 1, heroes: ['mariscal', 'mariscal', 'mariscal'], firstPlayer: 1 });
    expect(state.players).toHaveLength(3);
    expect(state.players.every((p) => p.hand.length === state.rules.handSize)).toBe(true);
    // Later seats get a taller Wall for the lost tempo.
    const step = state.rules.multiSeatWall;
    expect(step).toBe(3);
    expect(state.players[2]!.wall - state.players[1]!.wall).toBe(step);
    expect(state.players[0]!.wall - state.players[1]!.wall).toBe(2 * step);

    let s = state;
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(s.active);
      s = mustApply(s, { type: 'discard', player: s.active, uid: s.players[s.active]!.hand[0]!.uid }).state;
    }
    expect(order).toEqual([1, 2, 0, 1, 2, 0]);
  });

  it('in "all" mode an attack hits every rival, scaled', () => {
    const state = threeWay({ multiTargeting: 'all', multiAllScale: 0.6 });
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const keep = state.rules.keepStart;
    const after = mustApply(state, { type: 'play', player: 0, uid: state.players[0]!.hand[0]!.uid }).state;
    expect(after.players[1]!.keep).toBe(keep - 6);
    expect(after.players[2]!.keep).toBe(keep - 6);
    expect(after.players[0]!.keep).toBe(keep);
  });

  it('"Todo o Nada" deals a whole amount per discarded card to every rival', () => {
    const state = threeWay();
    setHand(state, 0, ['todo-o-nada', 'escaramuza', 'parapeto', 'catapulta', 'cimientos']);
    const op = CARDS.find((c) => c.id === 'todo-o-nada')!.effects.find((o) => o.op === 'damage');
    const per = op?.op === 'damage' ? op.perDiscardAll! : 0;
    expect(Number.isInteger(per) && per > 0).toBe(true);
    const { events } = mustApply(state, { type: 'play', player: 0, uid: state.players[0]!.hand[0]!.uid });
    for (const rival of [1, 2]) {
      const hits = events.filter((e) => e.type === 'damage' && e.target === rival);
      expect(hits).toHaveLength(1);
      const hit = hits[0]!;
      if (hit.type === 'damage') expect(hit.wallLoss + hit.keepLoss).toBe(4 * per);
    }
  });

  it('in "choose" mode an attack hits only the chosen rival, and legal actions offer each target', () => {
    const state = threeWay({ multiTargeting: 'choose' });
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const plays = legalActions(state).filter((a) => a.type === 'play');
    expect(plays.map((a) => (a.type === 'play' ? a.target : null)).sort()).toEqual([1, 1, 2, 2]);

    const uid = state.players[0]!.hand[0]!.uid;
    const after = mustApply(state, { type: 'play', player: 0, uid, target: 2 }).state;
    expect(after.players[2]!.keep).toBe(state.rules.keepStart - 10);
    expect(after.players[1]!.keep).toBe(state.rules.keepStart);

    const bad = applyAction(state, { type: 'play', player: 0, uid, target: 0 });
    expect(bad.ok).toBe(false);
  });

  it('the leader takes extra damage when the rule is on', () => {
    const state = threeWay({ multiTargeting: 'choose', leaderExtraDamage: 2 });
    state.players[1]!.keep = state.rules.keepStart + 5;
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const uid = state.players[0]!.hand[0]!.uid;
    const after = mustApply(state, { type: 'play', player: 0, uid, target: 1 }).state;
    expect(after.players[1]!.keep).toBe(state.rules.keepStart + 5 - 12);
  });

  it('a fallen castle is eliminated, skipped in turn order, and the last one standing wins', () => {
    const state = threeWay({ multiTargeting: 'choose', eliminationBounty: 5 });
    state.players[1]!.keep = 5;
    state.players[1]!.wall = 0;
    setHand(state, 0, ['saetas-negras', 'saetas-negras']);
    const { state: after, events } = mustApply(state, {
      type: 'play',
      player: 0,
      uid: state.players[0]!.hand[0]!.uid,
      target: 1,
    });
    expect(after.players[1]!.eliminated).toBe(true);
    expect(after.phase).not.toBe('finished');
    expect(events).toContainEqual({ type: 'playerEliminated', player: 1, by: 0 });
    expect(after.players[0]!.resources.piedra).toBeGreaterThanOrEqual(state.players[0]!.resources.piedra + 5);

    // Finish player 0's turn: the next turn belongs to player 2, not the fallen player 1.
    const next = mustApply(after, { type: 'discard', player: 0, uid: after.players[0]!.hand[0]!.uid }).state;
    expect(next.active).toBe(2);
    expect(applyAction(next, { type: 'concede', player: 1 }).ok).toBe(false);

    // Player 2 concedes: player 0 is the last castle standing.
    const end = mustApply(next, { type: 'concede', player: 2 }).state;
    expect(end.result).toEqual({ winner: 0, reason: 'concede' });
  });

  it('views show every castle and hide rival hands', () => {
    const state = threeWay();
    expect(state.rules.multiTargeting).toBe('all');
    const view = getPlayerView(state, 1);
    expect(view.players).toHaveLength(3);
    expect(view.players[1]!.hand.every((c) => c.cardId !== null)).toBe(true);
    expect(view.players[0]!.hand.every((c) => c.cardId === null)).toBe(true);
    expect(view.players[2]!.hand.every((c) => c.cardId === null)).toBe(true);
  });

  for (const multiTargeting of ['all', 'choose'] as const) {
    it(`random playouts finish cleanly in "${multiTargeting}" mode`, () => {
      for (let i = 0; i < 40; i++) {
        const result = playGame({
          seed: `ffa-${multiTargeting}-${i}`,
          heroes: ['guardian', 'arquitecta', 'mariscal'],
          rules: { multiTargeting, leaderExtraDamage: 2, eliminationBounty: 5 },
          policy: i % 2 ? randomPolicy : eagerPolicy,
          onStep: (s) => {
            for (const p of s.players) {
              expect(p.keep).toBeGreaterThanOrEqual(0);
              expect(p.wall).toBeGreaterThanOrEqual(0);
            }
            if (s.phase !== 'finished') expect(s.players[s.active]!.eliminated).toBeFalsy();
          },
        });
        expect(result.reason).not.toBe('maxActions');
      }
    });
  }
});

describe('free-for-all rules text', () => {
  const flat = (ops: readonly EffectOp[]): EffectOp[] => ops.flatMap((o) => (o.op === 'if' ? [o, ...flat(o.then), ...flat(o.else ?? [])] : [o]));
  const scaled = (n: number): number => Math.max(1, Math.round(n * DEFAULT_RULES.multiAllScale));

  it('every card that reaches the rivals has a 3-player text with the scaled numbers', () => {
    for (const card of CARDS) {
      const ops = flat(card.effects);
      const rival = ops.some((o) => ['damage', 'stealResource', 'drainResources', 'burn', 'loseWorker', 'stealWorker', 'frost', 'revealHand', 'peekAndDiscard', 'discardRandom', 'swapWalls', 'destroyEnchantment', 'copyLast'].includes(o.op));
      if (!rival) continue;
      expect(card.textFfa, card.id).toBeDefined();
      for (const op of ops) {
        if (op.op === 'damage' && op.amount > 0 && !op.perDiscard) {
          expect(card.textFfa!.es, card.id).toContain(`${scaled(op.amount)} de daño`);
          expect(card.textFfa!.en, card.id).toMatch(new RegExp(`\\b${scaled(op.amount)} (piercing )?damage`));
        }
        if (op.op === 'stealResource' || op.op === 'drainResources') expect(card.textFfa!.es, card.id).toContain(String(scaled(op.amount)));
        if (op.op === 'burn') expect(card.textFfa!.es, card.id).toContain(`${scaled(op.turns)} turnos`);
      }
    }
  });
});

describe('printed numbers', () => {
  it('no card, hero or event text shows a decimal number', () => {
    const texts: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') texts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) Object.entries(v).forEach(([k, x]) => k !== 'art' && walk(x));
    };
    walk([CARDS.map((c) => [c.name, c.text, c.textFfa]), HEROES, BATTLE_EVENTS]);
    expect(texts.length).toBeGreaterThan(100);
    for (const t of texts) expect(t).not.toMatch(/\d[.,]\d/);
  });

  it('every per-card amount against all rivals is a whole number printed on the card', () => {
    for (const card of CARDS) {
      for (const op of card.effects) {
        if (op.op !== 'damage' || op.perDiscardAll === undefined) continue;
        expect(Number.isInteger(op.perDiscardAll), card.id).toBe(true);
        expect(card.textFfa!.es, card.id).toContain(`${op.perDiscardAll} de daño`);
        expect(card.textFfa!.en, card.id).toContain(`${op.perDiscardAll} damage`);
      }
    }
  });
});

