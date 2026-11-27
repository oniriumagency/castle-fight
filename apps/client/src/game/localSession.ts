import {
  HEROES,
  applyAction,
  legalActions,
  createGame,
  getPlayerView,
  redactEvents,
  type GameEvent,
  type GameState,
  type HeroId,
  type PlayerId,
} from '@cardcraft-castles/engine';
import type { PlayerAction } from '@cardcraft-castles/protocol';
import { settings } from '../app/settings';
import type { BattleOutcome, BattleSetup } from '@cardcraft-castles/campaign';
import { chooseAiAction, type Difficulty } from './ai';
import { settleCampaignBattle } from './campaignStore';
import { ownedDivine } from './divineStore';
import { BaseSession, type MatchSession, type Seat, type SessionKind } from './session';

export interface LocalOptions {
  kind: Extract<SessionKind, 'ai' | 'local'>;
  /** Two seats, or three for a free-for-all against two AIs. */
  seats: Seat[];
  /** For `ai`: every seat but 0 is an AI. */
  difficulty?: Difficulty;
  /** A campaign battle: how it is set up and which pending battle it settles. */
  campaign?: CampaignBattle;
}

export interface CampaignBattle {
  /** The id `startBattle` stored, so the result is applied once. */
  id: string;
  setup: BattleSetup;
}

/** The game in progress on this device, kept so it survives a locked phone or a reload. */
interface SavedGame {
  v: 1;
  kind: 'ai' | 'local';
  seats: Seat[];
  difficulty: Difficulty;
  campaign?: CampaignBattle;
  state: GameState;
  viewer: PlayerId;
  savedAt: number;
}

const SAVE_KEY = 'cardcraft-castles:local-game';
const STATS_KEY = 'cardcraft-castles:local-stats';

function readSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SavedGame;
    if (save?.v !== 1 || (save.kind !== 'ai' && save.kind !== 'local') || !save.state || save.state.phase === 'finished') return null;
    // A save from an older version of the rules that no longer reads cleanly is dropped.
    getPlayerView(save.state, 0);
    return save;
  } catch {
    clearSavedGame();
    return null;
  }
}

/** Whether there is an unfinished game on this device to continue. */
export function hasSavedGame(): boolean {
  return readSave() !== null;
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage blocked: nothing was saved either.
  }
}

function randomSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(3))).join('-');
}

/**
 * A game that runs entirely in this browser with the rules engine: against
 * the AI (every seat but 0: one rival, or two in a free-for-all) or between two people sharing the device. It plays the
 * server's role, including the turn clock.
 */
export class LocalSession extends BaseSession implements MatchSession {
  readonly kind: 'ai' | 'local';
  readonly seats: Seat[];
  readonly difficulty: Difficulty;
  readonly campaign: CampaignBattle | null;
  /** Set once a campaign battle is over and its result applied. */
  campaignOutcome: BattleOutcome | null = null;
  private state!: GameState;
  private viewer: PlayerId = 0;
  private deadline: number | null = null;
  private clockTurn = -1;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(options: LocalOptions, saved?: SavedGame) {
    super();
    this.kind = options.kind;
    this.seats = options.seats;
    this.difficulty = options.difficulty ?? 'normal';
    this.campaign = options.campaign ?? null;
    if (saved) {
      this.state = saved.state;
      this.viewer = saved.viewer;
      this.publish([], true);
    } else this.start();
  }

  /** The unfinished game saved on this device, ready to play on from where it was left. */
  static resume(): LocalSession | null {
    const save = readSave();
    if (!save) return null;
    return new LocalSession({ kind: save.kind, seats: save.seats, difficulty: save.difficulty, ...(save.campaign ? { campaign: save.campaign } : {}) }, save);
  }

  statsKey(): string {
    return STATS_KEY;
  }

  private save(): void {
    if (this.state.phase === 'finished') {
      clearSavedGame();
      return;
    }
    const save: SavedGame = {
      v: 1,
      kind: this.kind,
      seats: this.seats,
      difficulty: this.difficulty,
      ...(this.campaign ? { campaign: this.campaign } : {}),
      state: this.state,
      viewer: this.viewer,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {
      // Storage full or blocked: the game still plays, it just won't survive a reload.
    }
  }

  /** Campaign: applies the result once the player has won, lost, or fallen in the final battle. */
  private settleCampaign(): void {
    if (!this.campaign || this.campaignOutcome) return;
    const me = this.state.players[0]!;
    const over = this.state.phase === 'finished' || !!me.eliminated;
    if (!over) return;
    const won = this.state.phase === 'finished' && this.state.result?.winner === 0;
    this.campaignOutcome = settleCampaignBattle(this.campaign.id, won);
  }

  isLocal(seat: PlayerId): boolean {
    return this.kind === 'local' || seat === 0;
  }

  private start(): void {
    this.stopTimers();
    this.deadline = null;
    this.clockTurn = -1;
    const setup = this.campaign?.setup;
    // Against the AI the player brings their Divine cards (the campaign setup already has them).
    // On a shared device nobody does: there is no telling whose they are.
    const divine = !setup && this.kind === 'ai' ? ownedDivine() : [];
    const { state, events } = createGame({
      seed: randomSeed(),
      heroes: this.seats.map((s) => s.hero),
      // The turn ends on "Ready", so the ultimate can still follow the card.
      rules: { ...setup?.rules, manualEndTurn: true },
      ...(setup ? { seats: setup.seats } : divine.length ? { seats: [{ exclusiveCards: divine }] } : {}),
      ...(setup?.firstEvent ? { firstEvent: setup.firstEvent } : {}),
    });
    this.state = state;
    this.publish(events);
  }

  /** Who looks at the screen: always the human against the AI, the player to move on a shared device. */
  private currentViewer(): PlayerId {
    if (this.kind === 'ai') return 0;
    if (this.state.phase === 'finished') return this.viewer;
    return this.state.pending?.player ?? this.state.active;
  }

  private publish(events: GameEvent[], resumed = false): void {
    this.viewer = this.currentViewer();
    this.settleCampaign();
    this.save();
    this.emit({
      type: 'state',
      view: getPlayerView(this.state, this.viewer),
      events: redactEvents(events, this.viewer),
      deadline: this.deadline,
      ...(resumed ? { resumed } : {}),
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
    if (this.kind === 'ai' && mover !== 0) {
      if (this.aiTimer) return;
      // Saying "Ready" once there is nothing else to do needs no thinking.
      const legal = legalActions(this.state);
      const onlyReady = legal.length === 1 && legal[0]!.type === 'endTurn';
      const think = onlyReady ? 250 : 650 + Math.random() * 600;
      const scale = settings.get().animationSpeed === 'fast' ? 0.5 : 1;
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this.closed || this.state.phase === 'finished') return;
        this.apply(chooseAiAction(this.state, this.difficulty, this.campaign?.setup.tier));
      }, think * scale);
      return;
    }
    this.startClock();
  }

  /**
   * The clock runs from the moment the player can act, not while cards are
   * flying. Games against the AI have no clock: they can be paused and picked
   * up hours later.
   */
  private startClock(): void {
    if (this.kind === 'ai' || !settings.get().localTimer || this.state.rules.turnSeconds <= 0 || this.clockTurn === this.state.turn) return;
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

  rematch(heroes?: Partial<Record<PlayerId, HeroId>>): void {
    // A campaign battle is fought again from the map, not with a rematch.
    if (this.campaign) return;
    // A new hero for the seats played on this device; the AI keeps its own.
    this.seats.forEach((seat, i) => {
      const hero = heroes?.[i];
      if (hero && this.isLocal(i)) this.seats[i] = { ...seat, hero };
    });
    // Free-for-all: the AIs keep three different heroes on the board.
    if (this.seats.length > 2) {
      const taken = new Set<HeroId>();
      this.seats.forEach((seat, i) => {
        if (seat.isAi && taken.has(seat.hero)) {
          const free = HEROES.map((h) => h.id).filter((id) => !taken.has(id) && !this.seats.some((s) => s.hero === id));
          if (free.length) this.seats[i] = { ...seat, hero: free[Math.floor(Math.random() * free.length)]! };
        }
        taken.add(this.seats[i]!.hero);
      });
    }
    this.emit({ type: 'rematch', seat: 0 });
    this.start();
  }

  leave(): void {
    this.closed = true;
    this.stopTimers();
    this.listeners.clear();
  }
}
