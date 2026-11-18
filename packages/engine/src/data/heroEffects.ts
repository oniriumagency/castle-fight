import type { EffectOp, HeroId, HeroPassive } from '../types';

/** Passive and ultimate of every hero, keyed by the id in `design/cards.json`. */
export const HERO_EFFECTS: Record<HeroId, { passive: HeroPassive; ultimate: EffectOp[] }> = {
  arquitecta: {
    passive: { costReduction: { school: 'construccion', amount: 1 } },
    ultimate: [
      { op: 'keep', amount: 8 },
      { op: 'wall', amount: 10 },
    ],
  },
  mariscal: {
    passive: { attackBonus: 2 },
    ultimate: [{ op: 'damage', amount: 10 }],
  },
  hechicera: {
    passive: { statusDurationBonus: 1 },
    ultimate: [
      { op: 'burn', turns: 5 },
      { op: 'frost', scope: 'all', turns: 1 },
      { op: 'damage', amount: 3, kind: 'piercing' },
    ],
  },
  alquimista: {
    passive: { randomResourcePerTurn: 3 },
    ultimate: [
      { op: 'gainResource', resource: 'all', amount: 10 },
      { op: 'keep', amount: 6 },
    ],
  },
  saboteadora: {
    passive: { stealOnDiscard: 4 },
    ultimate: [{ op: 'stealWorker' }, { op: 'damage', amount: 10, kind: 'piercing' }],
  },
  guardian: {
    passive: { startingWallBonus: 7 },
    ultimate: [
      { op: 'shield', charges: 1 },
      { op: 'wall', amount: 10 },
    ],
  },
};
