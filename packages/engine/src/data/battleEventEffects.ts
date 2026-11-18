import type { BattleEventEffect, BattleEventId } from '../types';

/** What every global battle event does, keyed by the id in `design/cards.json`. */
export const BATTLE_EVENT_EFFECTS: Record<BattleEventId, BattleEventEffect> = {
  tormenta: { kind: 'bothLoseWall', amount: 8 },
  mercado: { kind: 'bothGainResources', amount: 5 },
  eclipse: { kind: 'halfCost', school: 'arcano', turns: 2 },
  terremoto: { kind: 'bothLoseKeep', amount: 7 },
  cosecha: { kind: 'bothGainRandomWorker' },
  tregua: { kind: 'banSchool', school: 'asalto', turns: 2 },
};
