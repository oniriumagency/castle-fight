import type { EffectOp, HeroId, HeroPassive } from '../types';

/** Passive and ultimate of every hero, keyed by the id in `design/cards.json`. */
export const HERO_EFFECTS: Record<HeroId, { passive: HeroPassive; ultimate: EffectOp[] }> = {
  arquitecta: {
    passive: { costReduction: { school: 'construccion', amount: 1 } },
    ultimate: [
      { op: 'keep', amount: 10 },
      { op: 'wall', amount: 10 },
    ],
  },
  mariscal: {
    passive: { attackBonus: 1 },
    ultimate: [{ op: 'damage', amount: 15 }],
  },
  hechicera: {
    passive: { statusDurationBonus: 1 },
    ultimate: [
      { op: 'burn', turns: 3 },
      { op: 'frost', scope: 'all', turns: 1 },
    ],
  },
  alquimista: {
    passive: { randomResourcePerTurn: 1 },
    ultimate: [{ op: 'gainResource', resource: 'all', amount: 8 }],
  },
  saboteadora: {
    passive: { stealOnDiscard: 1 },
    ultimate: [{ op: 'stealWorker' }],
  },
  guardian: {
    passive: { startingWallBonus: 8 },
    ultimate: [
      { op: 'shield', charges: 2 },
      { op: 'wall', amount: 8 },
    ],
  },
};
