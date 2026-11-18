import {
  applyAction,
  createGame,
  getPlayerView,
  redactEvents,
  type GameEvent,
  type GameState,
  type PlayerId,
} from '@cardcraft-castles/engine';
import type { PlayerAction } from '@cardcraft-castles/protocol';
import { settings } from '../app/settings';
import { chooseAiAction, type Difficulty } from './ai';
import { BaseSession, type MatchSession, type Seat, type SessionKind } from './session';

export interface LocalOptions {
  kind: Extract<SessionKind, 'ai' | 'local'>;
  seats: [Seat, Seat];
  /** For `ai`: seat 1 is the AI. */
  difficulty?: Difficulty;
}

function randomSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(3))).join('-');
}

/**
 * A game that runs entirely in this browser with the rules engine: against
 * the AI (seat 1) or between two people sharing the device. It plays the
 * server's role, including the turn clock.
 */
export class LocalSession extends BaseSession implements MatchSession {
  readonly kind: 'ai' | 'local';
  readonly seats: [Seat, Seat];
  private readonly difficulty: Difficulty;
  private state!: GameState;
  private viewer: PlayerId = 0;
  private deadline: number | null = null;
  private clockTurn = -1;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: LocalOptions) {
    super();
    this.kind = options.kind;
    this.seats = options.seats;
    this.difficulty = options.difficulty ?? 'normal';
    this.start();
  }

  isLocal(seat: PlayerId): boolean {
    return this.kind === 'local' || seat === 0;
  }

  private start(): void {
    this.stopTimers();
    this.deadline = null;
    this.clockTurn = -1;
    const { state, events } = createGame({ seed: randomSeed(), heroes: [this.seats[0].hero, this.seats[1].hero] });
    this.state = state;
    this.publish(events);
  }

  /** Who looks at the screen: always the human against the AI, the player to move on a shared device. */
  private currentViewer(): PlayerId {
    if (this.kind === 'ai') return 0;
    if (this.state.phase === 'finished') return this.viewer;
    return this.state.pending?.player ?? this.state.active;
  }

  private publish(events: GameEvent[]): void {
    this.viewer = this.currentViewer();
    this.emit({
      type: 'state',
      view: getPlayerView(this.state, this.viewer),
      events: redactEvents(events, this.viewer),
      deadline: this.deadline,
    });
  }

  private apply(action: Parameters<typeof applyAction>[1]): boolean {
    if (this.closed) return false;
    const result = applyAction(this.state, action);
    if (!result.ok) {
      this.emit({ type: 'error', message: result.error.message });
      return false;
    }
    const turnChanged = result.state.turn !== this.state.turn || result.state.phase === 'finished';
    this.state = result.state;
    if (turnChanged) this.clearClock();
    this.publish(result.events);
    return true;
  }

  act(action: PlayerAction): void {
    const mover = this.state.pending?.player ?? this.state.active;
    if (action.type === 'concede') {
      // On a shared device either player may concede; against the AI only the human.
      this.apply({ ...action, player: this.kind === 'ai' ? 0 : mover });
      return;
    }
    if (!this.isLocal(mover) || (this.kind === 'ai' && mover !== 0)) return;
    this.apply({ ...action, player: mover });
  }

  idle(): void {
    if (this.closed || this.state.phase === 'finished') return;
    const mover = this.state.pending?.player ?? this.state.active;
    if (this.kind === 'ai' && mover === 1) {
      if (this.aiTimer) return;
      const think = 650 + Math.random() * 600;
      const scale = settings.get().animationSpeed === 'fast' ? 0.5 : 1;
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this.closed || this.state.phase === 'finished') return;
        this.apply(chooseAiAction(this.state, this.difficulty));
      }, think * scale);
      return;
    }
    this.startClock();
  }

  /** The clock runs from the moment the player can act, not while cards are flying. */
  private startClock(): void {
    if (!settings.get().localTimer || this.clockTurn === this.state.turn) return;
    this.clockTurn = this.state.turn;
    this.deadline = Date.now() + this.state.rules.turnSeconds * 1000;
    this.emit({ type: 'clock', deadline: this.deadline });
    const turn = this.state.turn;
    this.clockTimer = setTimeout(() => {
      this.clockTimer = null;
      if (this.state.turn === turn && this.state.phase !== 'finished') this.apply({ type: 'timeout' });
    }, this.deadline - Date.now());
  }

  private clearClock(): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    if (this.deadline !== null) {
      this.deadline = null;
      this.emit({ type: 'clock', deadline: null });
    }
  }

  private stopTimers(): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.clockTimer = this.aiTimer = null;
  }

  rematch(): void {
    this.emit({ type: 'rematch', seat: 0 });
    this.start();
  }

  leave(): void {
    this.closed = true;
    this.stopTimers();
    this.listeners.clear();
  }
}
