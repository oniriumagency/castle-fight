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
  /** One per seat (three in a free-for-all). */
  players: PlayerStats[] = [MatchStats.empty(), MatchStats.empty()];

  static empty(): PlayerStats {
    return { damageDealt: 0, built: 0, cardsPlayed: 0, biggestHit: 0, ultimates: 0 };
  }

  /** Plain data to keep across a page reload. */
  toJSON(): { turns: number; players: PlayerStats[] } {
    return { turns: this.turns, players: this.players };
  }

  /** Restores what `toJSON` saved; ignores anything malformed. */
  restore(data: unknown): boolean {
    const d = data as { turns?: unknown; players?: unknown } | null;
    if (!d || typeof d.turns !== 'number' || !Array.isArray(d.players) || d.players.length < 2 || d.players.length > 4) return false;
    const keys = Object.keys(MatchStats.empty()) as (keyof PlayerStats)[];
    const players = d.players.map((p) => {
      const out = MatchStats.empty();
      for (const k of keys) {
        const v = (p as Record<string, unknown> | null)?.[k];
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
      return out;
    });
    this.turns = d.turns;
    this.players = players;
    return true;
  }

  reset(players = 2): void {
    this.turns = 0;
    this.players = Array.from({ length: players }, () => MatchStats.empty());
  }

  /** A seat's figures, made on first use (a resumed free-for-all may start with two). */
  private at(seat: PlayerId): PlayerStats {
    while (this.players.length <= seat) this.players.push(MatchStats.empty());
    return this.players[seat];
  }

  add(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'turnStarted':
          this.turns = Math.max(this.turns, e.turn);
          break;
        case 'cardPlayed':
          this.at(e.player).cardsPlayed++;
          break;
        case 'damage': {
          const lost = e.wallLoss + e.keepLoss;
          const p = this.at(e.source);
          p.damageDealt += lost;
          p.biggestHit = Math.max(p.biggestHit, lost);
          break;
        }
        case 'built':
          this.at(e.player).built += e.amount;
          break;
        case 'ultimateUsed':
          this.at(e.player).ultimates++;
          break;
      }
    }
  }
}
