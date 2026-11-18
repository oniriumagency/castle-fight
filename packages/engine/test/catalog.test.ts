import { describe, expect, it } from 'vitest';
import design from '../../../design/cards.json';
import {
  BATTLE_EVENTS,
  CARDS,
  DEFAULT_RULES,
  GAME_TITLE,
  HEROES,
  RESOURCE_NAMES,
  SCHOOL_NAMES,
  SCHOOL_RESOURCE,
  WORKER_NAMES,
  getBattleEvent,
  getCard,
  getEnchantmentModifiers,
  getHero,
  hasCombo,
  isCardId,
  localize,
} from '../src/index';

describe('catalog', () => {
  it('loads everything in design/cards.json', () => {
    expect(CARDS).toHaveLength(60);
    expect(HEROES).toHaveLength(6);
    expect(BATTLE_EVENTS).toHaveLength(6);
    expect(CARDS.map((c) => c.id)).toEqual(design.cards.map((c) => c.id));
    for (const school of ['construccion', 'asalto', 'arcano'] as const) {
      expect(CARDS.filter((c) => c.school === school)).toHaveLength(20);
    }
  });

  it('takes the base rules from the design file', () => {
    expect(DEFAULT_RULES).toMatchObject(design.rules);
  });

  it('every card has effects and texts in both languages', () => {
    for (const card of CARDS) {
      expect(card.effects.length, card.id).toBeGreaterThan(0);
      for (const locale of ['es', 'en'] as const) {
        expect(localize(card.name, locale), card.id).not.toBe('');
        expect(localize(card.text, locale), card.id).not.toBe('');
      }
    }
    for (const entry of [...HEROES, ...BATTLE_EVENTS]) {
      expect(entry.name.es && entry.name.en && entry.text.es && entry.text.en, entry.id).toBeTruthy();
    }
  });

  it('cards that say Combo or Enchantment are built that way', () => {
    for (const card of CARDS) {
      expect(hasCombo(card.id), card.id).toBe(card.text.en.includes('Combo'));
      expect(getEnchantmentModifiers(card.id) !== null, card.id).toBe(card.text.en.startsWith('Enchantment'));
    }
  });

  it('enchantment durations match the card text', () => {
    for (const card of CARDS) {
      const op = card.effects.find((e) => e.op === 'enchant');
      if (op?.op !== 'enchant') continue;
      expect(card.text.en, card.id).toContain(`(${op.turns} turns)`);
    }
  });

  it('looks things up by id', () => {
    expect(getCard('catapulta').name.en).toBe('Catapult');
    expect(getHero('guardian').name.es).toBe('El Guardián');
    expect(getBattleEvent('eclipse').effect).toEqual({ kind: 'halfCost', school: 'arcano', turns: 2 });
    expect(isCardId('catapulta')).toBe(true);
    expect(isCardId('dragon')).toBe(false);
    expect(() => getCard('dragon')).toThrow(/Unknown card/);
  });

  it('names the game vocabulary in Spanish and English', () => {
    expect(GAME_TITLE).toBe('Cardcraft: Castles');
    expect(SCHOOL_RESOURCE).toEqual({ construccion: 'piedra', asalto: 'acero', arcano: 'mana' });
    expect(localize(SCHOOL_NAMES.asalto, 'en')).toBe('Assault');
    expect(localize(RESOURCE_NAMES.mana, 'es')).toBe('Maná');
    expect(localize(WORKER_NAMES.piedra, 'en')).toBe('Mason');
    for (const [school, resource] of Object.entries(design.schools)) {
      expect(SCHOOL_RESOURCE[school as keyof typeof SCHOOL_RESOURCE]).toBe(resource.resource);
    }
  });
});
