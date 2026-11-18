import type { GameEvent, PlayerId } from '@cardcraft-castles/engine';

export interface PlayerStats {
  damageDealt: number;
  built: number;
  cardsPlayed: number;
  biggestHit: number;
  ultimates: number;
}

/** Match statistics for the results screen, gathered from the event log. */
export class MatchStats {
  turns = 0;
  players: [PlayerStats, PlayerStats] = [MatchStats.empty(), MatchStats.empty()];

  static empty(): PlayerStats {
    return { damageDealt: 0, built: 0, cardsPlayed: 0, biggestHit: 0, ultimates: 0 };
  }

  reset(): void {
    this.turns = 0;
    this.players = [MatchStats.empty(), MatchStats.empty()];
  }

  add(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'turnStarted':
          this.turns = Math.max(this.turns, e.turn);
          break;
        case 'cardPlayed':
          this.players[e.player].cardsPlayed++;
          break;
        case 'damage': {
          const lost = e.wallLoss + e.keepLoss;
          const p = this.players[e.source as PlayerId];
          p.damageDealt += lost;
          p.biggestHit = Math.max(p.biggestHit, lost);
          break;
        }
        case 'built':
          this.players[e.player].built += e.amount;
          break;
        case 'ultimateUsed':
          this.players[e.player].ultimates++;
          break;
      }
    }
  }
}
