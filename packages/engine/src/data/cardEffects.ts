import type { CardId, EffectOp } from '../types';

/**
 * What every card does, keyed by the card id used in `design/cards.json`.
 * Names, texts, costs, schools and rarities live in that JSON file; this table
 * only holds the mechanics. The catalog refuses to load if the two disagree on
 * the set of ids.
 */
export const CARD_EFFECTS: Record<CardId, EffectOp[]> = {
  // ----- Construcción ------------------------------------------------------
  'hilada-de-piedra': [{ op: 'wall', amount: 5 }],
  parapeto: [{ op: 'wall', amount: 10 }],
  'bastida-de-granito': [{ op: 'wall', amount: 20 }],
  cimientos: [{ op: 'keep', amount: 7 }],
  'andamio-real': [{ op: 'keep', amount: 17 }],
  'gremio-de-canteros': [{ op: 'gainWorker', worker: 'piedra', amount: 1 }],
  'cantera-abierta': [{ op: 'gainResource', resource: 'piedra', amount: 4 }],
  almenas: [
    { op: 'wall', amount: 7 },
    { op: 'keep', amount: 5 },
  ],
  puntales: [{ op: 'wall', amount: 3, comboBonus: 8 }],
  'reparaciones-de-urgencia': [
    {
      op: 'if',
      cond: { kind: 'selfKeepBelow', value: 35 },
      then: [{ op: 'keep', amount: 15 }],
      else: [{ op: 'keep', amount: 7 }],
    },
  ],
  'fragua-del-gremio': [{ op: 'gainWorker', worker: 'acero', amount: 1 }],
  'aula-de-arcanistas': [{ op: 'gainWorker', worker: 'mana', amount: 1 }],
  'torre-vigia': [{ op: 'keep', amount: 12 }, { op: 'revealHand' }],
  contrafuertes: [{ op: 'enchant', charges: 4, modifiers: { wallDamageReduction: 3 } }],
  'fortaleza-viva': [
    { op: 'enchant', turns: 5, modifiers: { onTurnStart: [{ op: 'keep', amount: 5 }] } },
  ],
  'puente-levadizo': [{ op: 'wall', amount: 8 }, { op: 'drawbridge' }],
  'maestro-de-obras': [
    { op: 'gainWorker', worker: 'piedra', amount: 1 },
    { op: 'wall', amount: 10 },
  ],
  'bastion-ciclopeo': [{ op: 'wall', amount: 37 }],
  'aguja-celeste': [{ op: 'keep', amount: 33 }],
  'gremios-unidos': [
    { op: 'gainWorker', worker: 'piedra', amount: 1 },
    { op: 'gainWorker', worker: 'acero', amount: 1 },
    { op: 'gainWorker', worker: 'mana', amount: 1 },
  ],
  'ciudadela-eterna': [{ op: 'keep', amount: 33 }, { op: 'wall', amount: 25 }, { op: 'cleanse' }],
  'escombros-utiles': [
    { op: 'discardOwn', count: 3, upTo: true },
    { op: 'wall', amount: 0, perDiscard: 4 },
  ],
  'planos-revisados': [
    { op: 'discardOwn', count: 1 },
    { op: 'draw', count: 2 },
    { op: 'extraPlay' },
  ],
  'sillares-reciclados': [
    { op: 'discardOwn', count: 3, upTo: true },
    { op: 'keep', amount: 0, perDiscard: 4 },
  ],

  // ----- Asalto ------------------------------------------------------------
  escaramuza: [{ op: 'damage', amount: 5 }],
  'carga-de-lanceros': [{ op: 'damage', amount: 13 }],
  'doble-salva': [{ op: 'damage', amount: 5, times: 2 }],
  'saetas-negras': [{ op: 'damage', amount: 10, kind: 'piercing' }],
  'ariete-de-hierro': [{ op: 'damage', amount: 10, wallMultiplier: 2 }],
  'leva-de-herreros': [{ op: 'gainWorker', worker: 'acero', amount: 1 }],
  'saqueo-nocturno': [{ op: 'stealResource', amount: 5 }],
  'carga-de-caballeria': [{ op: 'damage', amount: 22 }],
  hostigamiento: [{ op: 'damage', amount: 7, comboBonus: 8 }],
  zapadores: [{ op: 'damage', amount: 13, kind: 'wallOnly' }],
  catapulta: [{ op: 'damage', amount: 25 }],
  'balista-de-asedio': [{ op: 'damage', amount: 15, kind: 'piercing' }],
  'espia-en-la-corte': [{ op: 'peekAndDiscard' }],
  sabotaje: [{ op: 'destroyEnchantment' }, { op: 'damage', amount: 8 }],
  'estandarte-de-guerra': [{ op: 'enchant', charges: 4, modifiers: { attackBonus: 3 } }],
  emboscada: [
    {
      op: 'if',
      cond: { kind: 'opponentPlayedSchoolLastTurn', school: 'construccion' },
      then: [{ op: 'damage', amount: 20 }],
      else: [{ op: 'damage', amount: 10 }],
    },
  ],
  'trabuquete-colosal': [{ op: 'damage', amount: 37 }],
  motin: [{ op: 'loseWorker' }],
  'torre-de-asedio': [
    { op: 'damage', amount: 17, kind: 'piercing' },
    { op: 'damage', amount: 10, kind: 'wallOnly' },
  ],
  'hueste-imparable': [
    { op: 'damage', amount: 27 },
    { op: 'damage', amount: 13, kind: 'piercing' },
  ],
  'tierra-quemada': [
    { op: 'discardOwn', count: 3, upTo: true },
    { op: 'damage', amount: 0, perDiscard: 4 },
  ],
  'relevo-de-tropas': [
    { op: 'damage', amount: 5 },
    { op: 'discardOwn', count: 1 },
    { op: 'draw', count: 1 },
    { op: 'extraPlay' },
  ],
  'todo-o-nada': [
    { op: 'discardOwn', count: 'hand' },
    { op: 'damage', amount: 0, perDiscard: 6, perDiscardAll: 4 },
  ],

  // ----- Arcano ------------------------------------------------------------
  'chispa-arcana': [{ op: 'damage', amount: 5, kind: 'piercing' }],
  'lluvia-de-ascuas': [{ op: 'burn', turns: 4 }],
  'egida-lunar': [{ op: 'shield', charges: 1 }],
  'aliento-de-escarcha': [{ op: 'frost', scope: 'choice', turns: 2 }],
  'circulo-de-estudio': [{ op: 'gainWorker', worker: 'mana', amount: 1 }],
  transmutacion: [
    { op: 'gainResource', resource: 'piedra', amount: 3 },
    { op: 'gainResource', resource: 'acero', amount: 3 },
  ],
  'ojo-del-augur': [{ op: 'redrawHand' }, { op: 'extraPlay' }],
  'brote-de-cristal': [{ op: 'keep', amount: 10 }],
  drenaje: [{ op: 'drainResources', amount: 3 }],
  purificacion: [{ op: 'cleanse' }, { op: 'keep', amount: 5 }],
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
    { op: 'damage', amount: 10, kind: 'piercing' },
    { op: 'damage', amount: 10, kind: 'wallOnly' },
  ],
  disipar: [{ op: 'destroyEnchantment' }, { op: 'gainResource', resource: 'mana', amount: 2 }],
  'tormenta-de-ceniza': [
    { op: 'damage', amount: 15 },
    { op: 'burn', turns: 4 },
  ],
  'prision-de-hielo': [
    { op: 'frost', scope: 'all', turns: 1 },
    { op: 'discardRandom', count: 1 },
  ],
  'reloj-de-arena': [{ op: 'extraTurn' }],
  'cometa-del-ocaso': [
    { op: 'damage', amount: 17, kind: 'wallOnly' },
    { op: 'damage', amount: 17, kind: 'piercing' },
  ],
  'ofrenda-arcana': [
    { op: 'discardOwn', count: 2 },
    { op: 'draw', count: 1 },
    { op: 'extraPlay' },
  ],
  'grimorio-en-llamas': [
    { op: 'discardOwn', count: 3, upTo: true },
    { op: 'damage', amount: 0, perDiscard: 4, kind: 'piercing' },
  ],
  'quema-de-pergaminos': [
    { op: 'discardRandom', count: 2 },
    { op: 'damage', amount: 6, kind: 'piercing' },
  ],
};
