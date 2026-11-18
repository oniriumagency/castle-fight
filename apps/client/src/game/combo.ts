import { TERMS, getCard, type CardId } from '@cardcraft-castles/engine';
import { h } from '../app/dom';
import { L, t } from '../app/i18n';

/** What a card's Combo adds, e.g. "+8 Muralla" or "+4 de daño". Empty if it has no Combo bonus. */
export function comboBonusText(cardId: string): string {
  const parts: string[] = [];
  for (const op of getCard(cardId as CardId).effects) {
    if (op.op === 'wall' && op.comboBonus) parts.push(`+${op.comboBonus} ${L(TERMS.wall)}`);
    else if (op.op === 'keep' && op.comboBonus) parts.push(`+${op.comboBonus} ${L(TERMS.keep)}`);
    else if (op.op === 'damage' && op.comboBonus) parts.push(t('comboDamage', { n: op.comboBonus }));
  }
  return parts.join(', ');
}

/** The "COMBO: +8 Wall" badge on a card whose Combo is on. */
export function comboTag(cardId: string): HTMLElement {
  const bonus = comboBonusText(cardId);
  return h('span.combo-tag', null, h('b', null, t('comboReady').toUpperCase()), bonus ? ` ${bonus}` : '');
}
