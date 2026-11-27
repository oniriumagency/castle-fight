/**
 * Ranked play: the rating, the leagues, the seasons and the messages of the
 * ranked queue (`/api/ranked/ws`).
 *
 * There are no accounts. A ranked profile lives on the server and is reached
 * with a secret the browser keeps (`RANKED_SECRET_KEY`); the same secret is the
 * recovery code a player copies to another device.
 */
import type { HeroChoice } from './index';

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const RANKED_RULES = {
  /** Everyone starts here, and seasons pull ratings halfway back to it. */
  startRating: 1000,
  /** Points at stake between equals are K/2 each way. */
  k: 32,
  /** The first games of a profile move it this much faster, so it finds its level soon. */
  provisionalGames: 10,
  provisionalFactor: 1.5,
  /** Nobody falls below this. */
  floor: 100,
  /** Automatic matching: rating gap allowed when a search starts... */
  windowStart: 100,
  /** ...widened by this much... */
  windowStep: 50,
  /** ...every this many ms... */
  windowEveryMs: 10_000,
  /** ...up to this. */
  windowMax: 400,
  /** After searching this long you see who else is searching and may challenge them. */
  challengeAfterMs: 30_000,
  /** The widest gap a challenge may cross. */
  challengeMaxGap: 600,
  /** A challenge nobody answers lapses after this long. */
  challengeTtlMs: 20_000,
  /** Games between the same two profiles that count, per rolling window. */
  pairGamesPerWindow: 3,
  pairWindowMs: 24 * 60 * 60_000,
  /** Not taking the seat of a match you were given keeps you out of the queue this long. */
  noShowCooldownMs: 60_000,
  /** Both players have this long to sit in a ranked room once it is made. */
  joinWithinMs: 30_000,
  /** Size of the leaderboard. */
  leaderboardSize: 50,
  /** Fixed settings of every ranked game. */
  turnSeconds: 30,
  twilight: true,
} as const;

/** Leagues by rating, lowest first. `min` is the first rating in the league. */
export const RANKED_TIERS = [
  { id: 'bronze', min: 0 },
  { id: 'silver', min: 900 },
  { id: 'gold', min: 1100 },
  { id: 'diamond', min: 1300 },
  { id: 'legend', min: 1500 },
] as const;

export type RankedTier = (typeof RANKED_TIERS)[number]['id'];

export function tierOf(rating: number): RankedTier {
  let tier: RankedTier = RANKED_TIERS[0].id;
  for (const t of RANKED_TIERS) if (rating >= t.min) tier = t.id;
  return tier;
}

/** Chance that a player rated `rating` beats one rated `opponent` (Elo). */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** The K a profile plays with: bigger while it is still provisional. */
export function kFactor(games: number): number {
  return games < RANKED_RULES.provisionalGames ? RANKED_RULES.k * RANKED_RULES.provisionalFactor : RANKED_RULES.k;
}

/**
 * Points a player gains (positive) or loses (negative). `score` is 1 for a
 * win, 0 for a loss and 0.5 for a draw. A decided game always moves at least
 * one point.
 */
export function ratingChange(rating: number, opponent: number, games: number, score: 0 | 0.5 | 1): number {
  const raw = kFactor(games) * (score - expectedScore(rating, opponent));
  const rounded = Math.round(raw);
  if (score === 1) return Math.max(1, rounded);
  if (score === 0) return Math.min(-1, rounded);
  return rounded;
}

/** What a game against `opponent` would be worth: points won if you win, lost if you lose. */
export function stakes(rating: number, opponent: number, games: number): { win: number; loss: number } {
  return { win: ratingChange(rating, opponent, games, 1), loss: ratingChange(rating, opponent, games, 0) };
}

/** Rating gap the automatic matching accepts after searching for `elapsedMs`. */
export function searchWindow(elapsedMs: number): number {
  const steps = Math.max(0, Math.floor(elapsedMs / RANKED_RULES.windowEveryMs));
  return Math.min(RANKED_RULES.windowMax, RANKED_RULES.windowStart + steps * RANKED_RULES.windowStep);
}

// ---------------------------------------------------------------------------
// Seasons: two calendar months each (UTC), the first one November–December 2026.
// ---------------------------------------------------------------------------

const SEASON_ONE = { year: 2026, month: 10 };

export function seasonOf(time: number): number {
  const date = new Date(time);
  const months = (date.getUTCFullYear() - SEASON_ONE.year) * 12 + (date.getUTCMonth() - SEASON_ONE.month);
  return Math.max(1, Math.floor(months / 2) + 1);
}

/** Epoch ms at which `season` ends (the next one starts). */
export function seasonEnd(season: number): number {
  const months = SEASON_ONE.month + season * 2;
  return Date.UTC(SEASON_ONE.year + Math.floor(months / 12), months % 12, 1);
}

/** The rating a profile starts a new season with. */
export function seasonReset(rating: number): number {
  return Math.round((rating + RANKED_RULES.startRating) / 2);
}

// ---------------------------------------------------------------------------
// Profiles and messages
// ---------------------------------------------------------------------------

/** Where the browser keeps the secret of its ranked profile. */
export const RANKED_SECRET_KEY = 'cardcraft-castles:ranked-secret';

/** Secrets (and so recovery codes) are 24 characters of this alphabet, shown in groups of four. */
export const RANKED_SECRET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SECRET_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{24}$/;

/** The secret in a typed or pasted recovery code (spaces, dashes and case are ignored), or null. */
export function parseRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SECRET_PATTERN.test(code) ? code : null;
}

/** A secret as players see it: `ABCD-EFGH-…`. */
export function formatRecoveryCode(secret: string): string {
  return secret.match(/.{1,4}/g)?.join('-') ?? secret;
}

/** Public id of a ranked profile (never the secret). */
export const RANKED_ID_PATTERN = /^[a-z0-9]{12}$/;

/** A ranked player as anyone may see them. */
export interface RankedPlayer {
  id: string;
  nickname: string;
  /** Four digits that tell apart players with the same nickname: `Magne#4821`. */
  tag: string;
  rating: number;
  /** Rated games played, ever (calibration counts these). */
  games: number;
}

export interface RankedProfile extends RankedPlayer {
  wins: number;
  losses: number;
  season: number;
  /** Rated games this season. */
  seasonGames: number;
  /** Highest rating reached this season. */
  peak: number;
  /** Epoch ms until which this profile may not search (it did not show up for a match). */
  cooldownUntil: number | null;
}

/** Someone searching, as another searcher sees them. */
export interface RankedSearcher extends RankedPlayer {
  /** What a game against them is worth to you; null when it would not be rated. */
  stakes: { win: number; loss: number } | null;
  /** You may challenge them (the gap is small enough and you are not already playing each other). */
  challengeable: boolean;
}

export type RankedClientMessage =
  /** First message: the browser's secret, or null if it has no profile yet. `v` is `PROTOCOL_VERSION`. */
  | { type: 'hello'; v: number; secret: string | null }
  /** Start (or restart) searching. A profile is made for you on the first search. */
  | { type: 'search'; nickname: string; hero: HeroChoice }
  | { type: 'cancel' }
  /** Challenge a searcher outside your window (`RankedSearcher.challengeable`). */
  | { type: 'challenge'; target: string }
  /** Answer a challenge you received. */
  | { type: 'answer'; from: string; accept: boolean }
  /** Ask for the leaderboard (`top`). */
  | { type: 'top' };

export interface RankedLeaderboard {
  season: number;
  /** Epoch ms at which the season ends. */
  endsAt: number;
  players: RankedPlayer[];
}

export interface RankedMatch {
  roomId: string;
  /** Proves the seat in that room is yours: send it with `join`. */
  ticket: string;
  opponent: RankedPlayer;
  /** What the game is worth to you; null when it will not be rated (same network, or too many games between you today). */
  stakes: { win: number; loss: number } | null;
}

export type RankedErrorCode =
  | 'badMessage'
  | 'outdated'
  /** The secret matches no profile. The browser should forget it. */
  | 'unknownProfile'
  | 'cooldown'
  | 'busy'
  | 'notSearching'
  | 'notChallengeable'
  | 'rateLimited';

export type RankedServerMessage =
  /** Your profile (null until the first search). `secret` comes only when the profile was just made. */
  | { type: 'profile'; profile: RankedProfile | null; secret?: string; now: number }
  /**
   * Your search: when it started (server clock), the current window, and,
   * once challenges open, everyone else searching. `searching: false` when you are not.
   */
  | {
      type: 'queue';
      searching: boolean;
      since: number | null;
      window: number;
      challengesOpen: boolean;
      players: RankedSearcher[];
      /** Everyone searching right now, you included. */
      count: number;
      now: number;
    }
  /** Someone challenges you. Answer with `answer`. */
  | { type: 'challenged'; from: RankedSearcher; expiresAt: number; now: number }
  /** Your challenge was declined, lapsed, or its target stopped searching. */
  | { type: 'challengeEnded'; target: string; reason: 'declined' | 'expired' | 'gone' }
  /** A challenge you received was withdrawn. */
  | { type: 'challengeWithdrawn'; from: string }
  /** You have a game: join `roomId` with `ticket`. */
  | { type: 'matched'; match: RankedMatch }
  | { type: 'top'; leaderboard: RankedLeaderboard }
  | { type: 'error'; code: RankedErrorCode; message: string };

/** Rating change of one seat in a ranked room, once the game has been scored. */
export interface RankedSeatResult {
  before: number;
  after: number;
  delta: number;
}

/** What a ranked room tells its players about the rating. */
export interface RankedRoomInfo {
  /** The game changes the ratings (false: same network, or too many games between the two today). */
  rated: boolean;
  /** One entry per seat once the game is scored; null before. */
  result: (RankedSeatResult | null)[] | null;
}
