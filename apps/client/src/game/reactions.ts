import type { GameEvent, LocalizedText, PlayerId, PlayerPublicState } from '@cardcraft-castles/engine';
import { CAPTAIN_LINES, CAPTAIN_MOMENT } from './captainLines';
import { REACTION_LINES, type ReactionKind } from './reactionLines';

/**
 * Speech bubbles next to the hero portraits: the heroes react in character to
 * what happens in the match. They never stop the game. This module only
 * decides who says what after each update; the board shows it.
 */

/**
 * How a seat speaks: `rival` (an AI opponent) reacts to everything, `own` (a
 * hero played on this device) only to its big moments, so the board does
 * not fill with the player's own chatter.
 */
export type Voice = 'rival' | 'own' | null;

export interface Reaction {
  seat: PlayerId;
  kind: ReactionKind;
  text: LocalizedText;
  /** Index of the event it reacts to: the bubble shows once that event has played. */
  at: number;
}

interface Candidate {
  seat: PlayerId;
  kind: ReactionKind;
  at: number;
}

/** Wall or Castle grown in one update that counts as "a lot". */
const BIG_WALL = 8;
const BIG_KEEP = 7;
/** Damage taken from one update that counts as a heavy blow. */
const BIG_HIT = 10;
/** Castle at or under which a hero worries. */
const KEEP_LOW = 20;
/** Share of the winning Castle at which a hero feels the win coming. */
const NEAR_WIN = 0.8;

/** Which moment matters most when several happen at once (higher wins). */
const PRIORITY: Record<ReactionKind, number> = {
  rivalUltimate: 100,
  ultimate: 95,
  wallDown: 80,
  keepLow: 78,
  rivalNearVictory: 76,
  nearVictory: 74,
  backfire: 70,
  hitTaken: 66,
  burned: 62,
  frozen: 60,
  rusted: 58,
  robbed: 56,
  discarded: 54,
  rivalCombo: 50,
  combo: 48,
  hitDealt: 44,
  shieldBlock: 42,
  rivalKeep: 38,
  rivalWall: 36,
  buildKeep: 34,
  buildWall: 32,
  rivalWorkers: 30,
  workers: 28,
  twilight: 26,
  battleEvent: 24,
  start: 20,
};

/** Moments that always get a bubble, whatever was said a moment ago. */
const ALWAYS = new Set<ReactionKind>(['rivalUltimate', 'ultimate', 'nearVictory', 'rivalNearVictory']);
/** Moments that break the quiet, though a hero does not repeat them too soon. */
const URGENT = new Set<ReactionKind>(['wallDown', 'keepLow']);

/**
 * How likely a rival is to speak up (the rest: always). Kept low so the
 * bubbles feel like remarks, not a commentary.
 */
const RIVAL_CHANCE: Partial<Record<ReactionKind, number>> = {
  workers: 0.25,
  rivalWorkers: 0.25,
  buildWall: 0.3,
  buildKeep: 0.35,
  rivalWall: 0.35,
  rivalKeep: 0.4,
  hitDealt: 0.35,
  hitTaken: 0.55,
  shieldBlock: 0.35,
  combo: 0.45,
  rivalCombo: 0.55,
  burned: 0.6,
  frozen: 0.6,
  rusted: 0.6,
  robbed: 0.6,
  discarded: 0.6,
  backfire: 0.8,
  battleEvent: 0.35,
  twilight: 0.6,
  start: 0.85,
};

/** What the player's own hero reacts to, and how often. */
const OWN_CHANCE: Partial<Record<ReactionKind, number>> = {
  rivalUltimate: 1,
  ultimate: 0.5,
  combo: 0.2,
  hitDealt: 0.15,
  hitTaken: 0.15,
  wallDown: 0.4,
  keepLow: 0.45,
  nearVictory: 0.5,
  rivalNearVictory: 0.4,
  backfire: 0.5,
  burned: 0.2,
  frozen: 0.2,
  robbed: 0.15,
  twilight: 0.2,
};

/** Quiet time after any bubble; a fallen Wall or a Castle in danger may break it after the shorter one. */
const GAP_MS = 12_000;
const URGENT_GAP_MS = 5_000;
/** Before the same speaker says the same kind of thing again. */
const SAME_KIND_MS = 120_000;
/** A fallen Wall or a Castle in danger again: said again only after this long. */
const URGENT_REPEAT_MS = 150_000;

/** Lines not yet said, per hero and moment, so none repeats until all have been said. */
const bags = new Map<string, number[]>();
let lastBagPick = new Map<string, number>();

/**
 * The line set a speaker uses: a campaign captain's own (`captain:<name>`,
 * grouped by captain moment) or their hero's.
 */
function linesFor(speaker: string, kind: ReactionKind): { key: string; lines: [string, string][] } | null {
  if (speaker.startsWith('captain:')) {
    const name = speaker.slice('captain:'.length);
    const moment = CAPTAIN_MOMENT[kind];
    const lines = moment ? CAPTAIN_LINES[name]?.[moment] : undefined;
    return lines?.length ? { key: `${speaker}:${moment}`, lines } : null;
  }
  const lines = REACTION_LINES[speaker]?.[kind];
  return lines?.length ? { key: `${speaker}:${kind}`, lines } : null;
}

function lineFor(speaker: string, kind: ReactionKind, random: () => number): LocalizedText | null {
  const found = linesFor(speaker, kind);
  if (!found) return null;
  const { key, lines } = found;
  let bag = bags.get(key);
  if (!bag?.length) {
    bag = lines.map((_, i) => i);
    // The first line of a new round is never the last one said.
    const last = lastBagPick.get(key);
    if (bag.length > 1 && last !== undefined) bag = bag.filter((i) => i !== last);
    bags.set(key, bag);
  }
  const index = bag.splice(Math.floor(random() * bag.length), 1)[0]!;
  lastBagPick.set(key, index);
  const [es, en] = lines[index]!;
  return { es, en };
}

/** Test hook: start every hero's lines afresh. */
export function resetReactionLines(): void {
  bags.clear();
  lastBagPick = new Map();
}

const sum = (delta: Partial<Record<string, number>>): number => Object.values(delta).reduce<number>((a, b) => a + (b ?? 0), 0);

/** Who did the update: the player whose card or ultimate it was. */
function actorOf(events: GameEvent[]): PlayerId | null {
  for (const e of events) {
    if (e.type === 'cardPlayed' || e.type === 'ultimateUsed' || e.type === 'cardDiscarded') return e.player;
  }
  return null;
}

/** Every moment worth a bubble in one update, for every seat that could voice it. */
export function moments(events: GameEvent[], before: readonly PlayerPublicState[], after: readonly PlayerPublicState[], keepWin: number): Candidate[] {
  const out: Candidate[] = [];
  const seats = after.map((_, i) => i);
  const alive = (seat: PlayerId): boolean => !after[seat]?.eliminated;
  const add = (seat: PlayerId, kind: ReactionKind, at: number): void => {
    if (alive(seat)) out.push({ seat, kind, at });
  };
  const rivalsOf = (seat: PlayerId): PlayerId[] => seats.filter((s) => s !== seat);
  const actor = actorOf(events);

  const built = new Map<string, { amount: number; at: number }>();
  const taken = new Map<PlayerId, { amount: number; at: number; source: PlayerId }>();
  const once = new Set<string>();
  const first = (key: string): boolean => (once.has(key) ? false : (once.add(key), true));

  events.forEach((e, at) => {
    switch (e.type) {
      case 'gameStarted':
        for (const seat of seats) add(seat, 'start', at);
        break;
      case 'workersChanged':
        if (e.to !== undefined && sum(e.delta) < 0) {
          if (first(`robbed:${e.player}`)) add(e.player, 'robbed', at);
        } else if (sum(e.delta) > 0 && e.from === undefined && e.reason.kind !== 'production' && first(`workers:${e.player}`)) {
          add(e.player, 'workers', at);
          for (const r of rivalsOf(e.player)) add(r, 'rivalWorkers', at);
        }
        break;
      case 'resourcesChanged':
        if (e.to !== undefined && sum(e.delta) < 0 && first(`robbed:${e.player}`)) add(e.player, 'robbed', at);
        break;
      case 'built': {
        const key = `${e.player}:${e.target}`;
        const prev = built.get(key);
        built.set(key, { amount: (prev?.amount ?? 0) + e.amount, at });
        break;
      }
      case 'damage': {
        if (e.blocked && first(`shield:${e.target}`)) add(e.target, 'shieldBlock', at);
        if (e.cause === 'burn') break;
        const prev = taken.get(e.target);
        taken.set(e.target, { amount: (prev?.amount ?? 0) + e.wallLoss + e.keepLoss, at, source: e.source });
        break;
      }
      case 'cardPlayed':
        if (e.combo && first(`combo:${e.player}`)) {
          add(e.player, 'combo', at);
          for (const r of rivalsOf(e.player)) add(r, 'rivalCombo', at);
        }
        break;
      case 'ultimateUsed':
        add(e.player, 'ultimate', at);
        for (const r of rivalsOf(e.player)) add(r, 'rivalUltimate', at);
        break;
      case 'diceRolled':
        if (e.outcome === 'backfire') add(e.player, 'backfire', at);
        break;
      case 'burnApplied':
        if (first(`burn:${e.player}`)) add(e.player, 'burned', at);
        break;
      case 'frostApplied':
        if (first(`frost:${e.player}`)) add(e.player, 'frozen', at);
        break;
      case 'rustApplied':
        if (first(`rust:${e.player}`)) add(e.player, 'rusted', at);
        break;
      case 'cardDiscarded':
        if (e.reason === 'effect' && actor !== null && actor !== e.player && first(`discard:${e.player}`)) add(e.player, 'discarded', at);
        break;
      case 'handRedrawn':
        if (actor !== null && actor !== e.player && first(`discard:${e.player}`)) add(e.player, 'discarded', at);
        break;
      case 'battleEventStarted':
        for (const seat of seats) add(seat, 'battleEvent', at);
        break;
      case 'twilightRose':
        for (const seat of seats) add(seat, 'twilight', at);
        break;
      default:
        break;
    }
  });

  for (const [key, { amount, at }] of built) {
    const [seatText, target] = key.split(':');
    const seat = Number(seatText);
    if (target === 'wall' && amount >= BIG_WALL) {
      add(seat, 'buildWall', at);
      for (const r of rivalsOf(seat)) add(r, 'rivalWall', at);
    }
    if (target === 'keep' && amount >= BIG_KEEP) {
      add(seat, 'buildKeep', at);
      for (const r of rivalsOf(seat)) add(r, 'rivalKeep', at);
    }
  }
  for (const [target, { amount, at, source }] of taken) {
    if (amount < BIG_HIT) continue;
    add(target, 'hitTaken', at);
    if (source !== target) add(source, 'hitDealt', at);
  }

  // Thresholds crossed by the whole update; they show at its last event.
  const end = Math.max(0, events.length - 1);
  for (const seat of seats) {
    const was = before[seat];
    const now = after[seat];
    if (!was || !now) continue;
    if (was.wall > 0 && now.wall === 0) add(seat, 'wallDown', end);
    if (was.keep > KEEP_LOW && now.keep <= KEEP_LOW && now.keep > 0) add(seat, 'keepLow', end);
    const near = Math.ceil(keepWin * NEAR_WIN);
    if (was.keep < near && now.keep >= near && now.keep < keepWin) {
      add(seat, 'nearVictory', end);
      for (const r of rivalsOf(seat)) add(r, 'rivalNearVictory', end);
    }
  }
  return out;
}

/**
 * Picks the bubbles for one update: usually one, two when a rival's ultimate
 * draws an answer. Keeps a little quiet between them.
 */
export class ReactionDirector {
  private lastAt = -Infinity;
  private lastKind = new Map<string, number>();

  constructor(private readonly random: () => number = Math.random) {}

  reset(): void {
    this.lastAt = -Infinity;
    this.lastKind.clear();
  }

  /** Keeps the heroes quiet until `until` (and the usual gap after it), e.g. while they trade opening lines. */
  hush(until: number): void {
    this.lastAt = Math.max(this.lastAt, until);
  }

  pick(
    events: GameEvent[],
    before: readonly PlayerPublicState[],
    after: readonly PlayerPublicState[],
    keepWin: number,
    voiceOf: (seat: PlayerId) => Voice,
    now: number,
    /** Whose lines a seat speaks: a hero id or `captain:<name>`. Defaults to the seat's hero. */
    speakerOf: (seat: PlayerId) => string | undefined = (seat) => after[seat]?.hero,
  ): Reaction[] {
    const all = moments(events, before, after, keepWin).filter((c) => voiceOf(c.seat) !== null);
    // Rivals first, then the strongest moment.
    all.sort((a, b) => PRIORITY[b.kind] + (voiceOf(b.seat) === 'rival' ? 5 : 0) - (PRIORITY[a.kind] + (voiceOf(a.seat) === 'rival' ? 5 : 0)));
    const out: Reaction[] = [];
    const spoke = new Set<PlayerId>();
    const quiet = now - this.lastAt < GAP_MS;
    const hush = now - this.lastAt < URGENT_GAP_MS;
    for (const c of all) {
      if (spoke.has(c.seat)) continue;
      const voice = voiceOf(c.seat)!;
      const always = ALWAYS.has(c.kind);
      // A second bubble in the same update only answers an ultimate.
      if (out.length >= 1 && !(c.kind === 'rivalUltimate' || out[0]!.kind === 'rivalUltimate')) break;
      if (out.length >= 2) break;
      if (!always && !URGENT.has(c.kind) && (quiet || out.length > 0)) continue;
      if (!always && URGENT.has(c.kind) && hush) continue;
      if (!always && out.length > 0) continue;
      const kindKey = `${c.seat}:${c.kind}`;
      const repeat = URGENT.has(c.kind) ? URGENT_REPEAT_MS : SAME_KIND_MS;
      if (!always && now - (this.lastKind.get(kindKey) ?? -Infinity) < repeat) continue;
      const chance = voice === 'own' ? (OWN_CHANCE[c.kind] ?? 0) : (RIVAL_CHANCE[c.kind] ?? 1);
      if (chance < 1 && this.random() >= chance) continue;
      const speaker = speakerOf(c.seat);
      const text = speaker ? lineFor(speaker, c.kind, this.random) : null;
      if (!text) continue;
      out.push({ seat: c.seat, kind: c.kind, text, at: c.at });
      spoke.add(c.seat);
      this.lastKind.set(kindKey, now);
    }
    // Only one hero greets at the start: the rival when there is one.
    if (out.length && out[0]!.kind === 'start') out.splice(1);
    if (out.length) this.lastAt = now;
    return out;
  }
}
