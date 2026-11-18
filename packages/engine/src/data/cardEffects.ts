import type { CardId, EffectOp } from '../types';

/**
 * What every card does, keyed by the card id used in `design/cards.json`.
 * Names, texts, costs, schools and rarities live in that JSON file; this table
 * only holds the mechanics. The catalog refuses to load if the two disagree on
 * the set of ids.
 */
export const CARD_EFFECTS: Record<CardId, EffectOp[]> = {
  // ----- Construcción ------------------------------------------------------
  'hilada-de-piedra': [{ op: 'wall', amount: 3 }],
  parapeto: [{ op: 'wall', amount: 6 }],
  'bastida-de-granito': [{ op: 'wall', amount: 12 }],
  cimientos: [{ op: 'keep', amount: 3 }],
  'andamio-real': [{ op: 'keep', amount: 8 }],
  'gremio-de-canteros': [{ op: 'gainWorker', worker: 'piedra', amount: 1 }],
  'cantera-abierta': [{ op: 'gainResource', resource: 'piedra', amount: 4 }],
  almenas: [
    { op: 'wall', amount: 4 },
    { op: 'keep', amount: 2 },
  ],
  puntales: [{ op: 'wall', amount: 2, comboBonus: 5 }],
  'reparaciones-de-urgencia': [
    {
      op: 'if',
      cond: { kind: 'selfKeepBelow', value: 20 },
      then: [{ op: 'keep', amount: 7 }],
      else: [{ op: 'keep', amount: 3 }],
    },
  ],
  'fragua-del-gremio': [{ op: 'gainWorker', worker: 'acero', amount: 1 }],
  'aula-de-arcanistas': [{ op: 'gainWorker', worker: 'mana', amount: 1 }],
  'torre-vigia': [{ op: 'keep', amount: 5 }, { op: 'revealHand' }],
  contrafuertes: [{ op: 'enchant', turns: 4, modifiers: { wallDamageReduction: 2 } }],
  'fortaleza-viva': [
    { op: 'enchant', turns: 5, modifiers: { onTurnStart: [{ op: 'keep', amount: 2 }] } },
  ],
  'puente-levadizo': [{ op: 'wall', amount: 4 }, { op: 'drawbridge' }],
  'maestro-de-obras': [
    { op: 'gainWorker', worker: 'piedra', amount: 1 },
    { op: 'wall', amount: 6 },
  ],
  'bastion-ciclopeo': [{ op: 'wall', amount: 22 }],
  'aguja-celeste': [{ op: 'keep', amount: 16 }],
  'ciudadela-eterna': [{ op: 'keep', amount: 15 }, { op: 'wall', amount: 15 }, { op: 'cleanse' }],

  // ----- Asalto ------------------------------------------------------------
  escaramuza: [{ op: 'damage', amount: 2 }],
  'carga-de-lanceros': [{ op: 'damage', amount: 6 }],
  'doble-salva': [{ op: 'damage', amount: 2, times: 2 }],
  'saetas-negras': [{ op: 'damage', amount: 4, kind: 'piercing' }],
  'ariete-de-hierro': [{ op: 'damage', amount: 5, wallMultiplier: 2 }],
  'leva-de-herreros': [{ op: 'gainWorker', worker: 'acero', amount: 1 }],
  'saqueo-nocturno': [{ op: 'stealResource', amount: 4 }],
  'carga-de-caballeria': [{ op: 'damage', amount: 10 }],
  hostigamiento: [{ op: 'damage', amount: 3, comboBonus: 4 }],
  zapadores: [{ op: 'damage', amount: 6, kind: 'wallOnly' }],
  catapulta: [{ op: 'damage', amount: 12 }],
  'balista-de-asedio': [{ op: 'damage', amount: 7, kind: 'piercing' }],
  'espia-en-la-corte': [{ op: 'peekAndDiscard' }],
  sabotaje: [{ op: 'destroyEnchantment' }, { op: 'damage', amount: 3 }],
  'estandarte-de-guerra': [{ op: 'enchant', turns: 4, modifiers: { attackBonus: 2 } }],
  emboscada: [
    {
      op: 'if',
      cond: { kind: 'opponentPlayedSchoolLastTurn', school: 'construccion' },
      then: [{ op: 'damage', amount: 10 }],
      else: [{ op: 'damage', amount: 5 }],
    },
  ],
  'trabuquete-colosal': [{ op: 'damage', amount: 20 }],
  motin: [{ op: 'loseWorker' }],
  'torre-de-asedio': [
    { op: 'damage', amount: 8, kind: 'piercing' },
    { op: 'damage', amount: 4, kind: 'wallOnly' },
  ],
  'hueste-imparable': [
    { op: 'damage', amount: 16 },
    { op: 'damage', amount: 8, kind: 'piercing' },
  ],

  // ----- Arcano ------------------------------------------------------------
  'chispa-arcana': [{ op: 'damage', amount: 2, kind: 'piercing' }],
  'lluvia-de-ascuas': [{ op: 'burn', turns: 3 }],
  'egida-lunar': [{ op: 'shield', charges: 1 }],
  'aliento-de-escarcha': [{ op: 'frost', scope: 'choice', turns: 2 }],
  'circulo-de-estudio': [{ op: 'gainWorker', worker: 'mana', amount: 1 }],
  transmutacion: [
    { op: 'gainResource', resource: 'piedra', amount: 3 },
    { op: 'gainResource', resource: 'acero', amount: 3 },
  ],
  'ojo-del-augur': [{ op: 'redrawHand' }, { op: 'extraPlay' }],
  'brote-de-cristal': [{ op: 'keep', amount: 5 }],
  drenaje: [{ op: 'drainResources', amount: 3 }],
  purificacion: [{ op: 'cleanse' }, { op: 'keep', amount: 2 }],
  'trueque-de-destinos': [{ op: 'swapWalls' }],
  espejismo: [{ op: 'copyLast' }],
  'maldicion-de-oxido': [
    {
      op: 'enchant',
      turns: 3,
      modifiers: { opponentCostIncrease: { school: 'asalto', amount: 2 } },
    },
  ],
  'manantial-de-mana': [
    {
      op: 'enchant',
      turns: 4,
      modifiers: { onTurnStart: [{ op: 'gainResource', resource: 'all', amount: 2 }] },
    },
  ],
  'rayo-bifurcado': [
    { op: 'damage', amount: 5, kind: 'piercing' },
    { op: 'damage', amount: 5, kind: 'wallOnly' },
  ],
  disipar: [{ op: 'destroyEnchantment' }, { op: 'gainResource', resource: 'mana', amount: 2 }],
  'tormenta-de-ceniza': [
    { op: 'damage', amount: 6 },
    { op: 'burn', turns: 4 },
  ],
  'prision-de-hielo': [
    { op: 'frost', scope: 'all', turns: 1 },
    { op: 'discardRandom', count: 1 },
  ],
  'reloj-de-arena': [{ op: 'extraTurn' }],
  'cometa-del-ocaso': [
    { op: 'damage', amount: 10, kind: 'wallOnly' },
    { op: 'damage', amount: 10, kind: 'piercing' },
  ],
};
