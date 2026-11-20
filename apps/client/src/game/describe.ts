import {
  RESOURCES,
  RESOURCE_NAMES,
  TERMS,
  WORKER_NAMES,
  getBattleEvent,
  getCard,
  getHero,
  type BattleEventId,
  type ChangeReason,
  type GameEvent,
  type HeroId,
  type PlayerId,
  type ResourceMap,
} from '@cardcraft-castles/engine';
import { L, t } from '../app/i18n';
import { comboBonusText } from './combo';

/** One line of the game log for an event, or null for events not worth a line. */
export function describeEvent(event: GameEvent, name: (seat: PlayerId) => string): string | null {
  const card = (id: string): string => L(getCard(id).name);
  switch (event.type) {
    case 'turnStarted':
      return t('logTurn', { n: event.turn, who: name(event.player) });
    case 'cardPlayed':
      return event.combo && comboBonusText(event.cardId)
        ? t('logPlayedCombo', { who: name(event.player), card: card(event.cardId), bonus: comboBonusText(event.cardId) })
        : t('logPlayed', { who: name(event.player), card: card(event.cardId) });
    case 'diceRolled': {
      const key = event.outcome === 'hit' ? 'logRollHit' : event.outcome === 'backfire' ? 'logRollBackfire' : 'logRollMiss';
      return t(key, { who: name(event.player), roll: event.roll, card: card(event.cardId) });
    }
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
    case 'twilightRose':
      return t('logTwilight', { level: event.level });
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
    case 'playerEliminated':
      return t('logEliminated', { who: name(event.player) });
    case 'gameOver':
      return t('logGameOver');
    case 'resourcesChanged':
    case 'workersChanged': {
      // A steal is one line, written from the victim's loss; the thief's gain is skipped.
      if (event.from !== undefined) return null;
      const workers = event.type === 'workersChanged';
      const src = reasonText(event.reason);
      if (event.to !== undefined) {
        const what = amounts(event.delta, workers, false);
        return t('logStole', { who: name(event.to), what, victim: name(event.player) }) + src;
      }
      return t('logChanged', { who: name(event.player), what: amounts(event.delta, workers, true) }) + src;
    }
    case 'handRedrawn':
      return t('logRedrawn', { who: name(event.player), n: event.count });
    case 'burnApplied':
      return t('logBurnApplied', { who: name(event.player), n: event.turns });
    case 'frostApplied':
      return t('logFrostApplied', { who: name(event.player), res: L(RESOURCE_NAMES[event.resource]), n: event.turns });
    case 'shieldGained':
      return t('logShield', { who: name(event.player), n: event.total });
    case 'statusesCleansed':
      return t('logCleansed', { who: name(event.player) });
    case 'handRevealed':
      return t('logHandRevealed', { who: name(event.player) });
    case 'extraPlayGranted':
      return t('logExtraPlay', { who: name(event.player) });
    default:
      return null;
  }
}

/** "+3 Stone, +3 Steel" or, without signs, "3 Stone"; workers read "+1 Mason", "2 Smiths". */
function amounts(delta: Partial<ResourceMap>, workers: boolean, signed: boolean): string {
  const parts: string[] = [];
  for (const res of RESOURCES) {
    const d = delta[res] ?? 0;
    if (!d) continue;
    const n = Math.abs(d);
    const label = workers ? L(WORKER_NAMES[res]) + (n > 1 ? 's' : '') : L(RESOURCE_NAMES[res]);
    parts.push(`${signed ? (d > 0 ? '+' : '−') : ''}${n} ${label}`);
  }
  return parts.join(', ');
}

/** Where a change came from, when the line before it does not already say so. */
function reasonText(reason: ChangeReason): string {
  switch (reason.kind) {
    case 'hero':
      return ` (${L(getHero(reason.id as HeroId).name)})`;
    case 'enchantment':
      return ` (${L(getCard(reason.id).name)})`;
    case 'battleEvent':
      return ` (${L(getBattleEvent(reason.id as BattleEventId).name)})`;
    case 'twilight':
      return ` (${t('twilightName')})`;
    case 'bounty':
      return ` (${t('logBounty')})`;
    default:
      // Cards and ultimates are named by the line that played them.
      return '';
  }
}
