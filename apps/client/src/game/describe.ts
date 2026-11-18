import { TERMS, getBattleEvent, getCard, type GameEvent, type PlayerId } from '@cardcraft-castles/engine';
import { L, t } from '../app/i18n';

/** One line of the game log for an event, or null for events not worth a line. */
export function describeEvent(event: GameEvent, name: (seat: PlayerId) => string): string | null {
  const card = (id: string): string => L(getCard(id).name);
  switch (event.type) {
    case 'turnStarted':
      return t('logTurn', { n: event.turn, who: name(event.player) });
    case 'cardPlayed':
      return t(event.combo ? 'logPlayedCombo' : 'logPlayed', { who: name(event.player), card: card(event.cardId) });
    case 'cardCopied':
      return t('logCopied', { who: name(event.player), card: card(event.cardId) });
    case 'cardDiscarded':
      return t(event.reason === 'timeout' ? 'logTimeoutDiscard' : event.reason === 'effect' ? 'logEffectDiscard' : 'logDiscarded', {
        who: name(event.player),
        card: card(event.cardId),
      });
    case 'ultimateUsed':
      return t('logUltimate', { who: name(event.player) });
    case 'damage':
      if (event.blocked) return t('logBlocked', { who: name(event.target) });
      if (event.cause === 'burn') return `${t('logBurn', { who: name(event.target) })} (−${event.wallLoss + event.keepLoss})`;
      return t('logDamage', { who: name(event.target), n: event.wallLoss + event.keepLoss });
    case 'built':
      return t('logBuilt', { who: name(event.player), n: event.amount, target: L(event.target === 'keep' ? TERMS.keep : TERMS.wall) });
    case 'structureLost':
      return t('logLost', { who: name(event.player), n: event.amount, target: L(event.target === 'keep' ? TERMS.keep : TERMS.wall) });
    case 'battleEventStarted':
      return t('logEvent', { event: L(getBattleEvent(event.eventId).name) });
    case 'enchantmentAdded':
      return t('logEnchant', { who: name(event.player), card: card(event.cardId) });
    case 'enchantmentRemoved':
      return t('logEnchantGone', { who: name(event.player), card: card(event.cardId) });
    case 'wallsSwapped':
      return t('logSwap');
    case 'extraTurnGranted':
      return t('logExtraTurn', { who: name(event.player) });
    case 'timedOut':
      return t('logTimedOut', { who: name(event.player) });
    case 'gameOver':
      return t('logGameOver');
    default:
      return null;
  }
}
