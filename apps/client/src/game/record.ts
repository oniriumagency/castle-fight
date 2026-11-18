/**
 * The player's win/loss record, kept in this browser: totals online and
 * against the AI, and a head-to-head count per online opponent.
 *
 * Opponents are told apart by the public id their browser sends when it takes
 * a seat (`SeatInfo.pid`), so the count follows them if they change nickname.
 * Old clients that send no id fall back to their nickname.
 */

export interface Tally {
  wins: number;
  losses: number;
  draws: number;
}

export interface RivalRecord extends Tally {
  /** Key in `PlayerRecord.rivals`: `pid:<id>` or `name:<nickname>`. */
  key: string;
  /** Latest nickname seen for them. */
  name: string;
  /** Epoch ms of the last game against them. */
  last: number;
}

export interface PlayerRecord {
  online: Tally;
  ai: Tally;
  rivals: Record<string, RivalRecord>;
  /** Online games already counted (`<room>:<game>`), so a page reload does not count one twice. */
  counted: string[];
}

export type Outcome = 'win' | 'loss' | 'draw';

const KEY = 'cardcraft-castles:record';
const COUNTED_MAX = 60;
const RIVALS_MAX = 200;
/** Games against someone before they can be your nemesis. */
export const NEMESIS_MIN_GAMES = 3;

const tally = (): Tally => ({ wins: 0, losses: 0, draws: 0 });

export function emptyRecord(): PlayerRecord {
  return { online: tally(), ai: tally(), rivals: {}, counted: [] };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function cleanTally(raw: unknown): Tally {
  const t = (raw ?? {}) as Record<string, unknown>;
  return { wins: count(t.wins), losses: count(t.losses), draws: count(t.draws) };
}

/** Rebuilds a record from stored data, dropping anything malformed. */
export function parseRecord(raw: unknown): PlayerRecord {
  const d = (raw ?? {}) as Record<string, unknown>;
  const out = emptyRecord();
  out.online = cleanTally(d.online);
  out.ai = cleanTally(d.ai);
  if (d.rivals && typeof d.rivals === 'object') {
    for (const [key, value] of Object.entries(d.rivals as Record<string, unknown>)) {
      const r = (value ?? {}) as Record<string, unknown>;
      if (typeof r.name !== 'string') continue;
      out.rivals[key] = { key, name: r.name, last: count(r.last), ...cleanTally(r) };
    }
  }
  if (Array.isArray(d.counted)) out.counted = d.counted.filter((k): k is string => typeof k === 'string').slice(-COUNTED_MAX);
  return out;
}

export function loadRecord(): PlayerRecord {
  try {
    return parseRecord(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return emptyRecord();
  }
}

function saveRecord(record: PlayerRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked: the record just isn't kept.
  }
}

function bump(t: Tally, outcome: Outcome): void {
  if (outcome === 'win') t.wins++;
  else if (outcome === 'loss') t.losses++;
  else t.draws++;
}

export function rivalKey(pid: string | null, name: string): string {
  return pid ? `pid:${pid}` : `name:${name.toLowerCase()}`;
}

export const gamesOf = (t: Tally): number => t.wins + t.losses + t.draws;

/** Adds one game to a record (pure; `recordOnline` loads and saves around it). */
export function addOnline(
  record: PlayerRecord,
  game: { id: string; outcome: Outcome; rival: { pid: string | null; name: string } },
  now = Date.now(),
): RivalRecord | null {
  const key = rivalKey(game.rival.pid, game.rival.name);
  if (record.counted.includes(game.id)) return record.rivals[key] ?? null;
  record.counted = [...record.counted, game.id].slice(-COUNTED_MAX);
  bump(record.online, game.outcome);
  const rival = record.rivals[key] ?? { key, name: game.rival.name, last: now, ...tally() };
  rival.name = game.rival.name;
  rival.last = now;
  bump(rival, game.outcome);
  record.rivals[key] = rival;
  // Keep the store small: forget the opponents not seen for the longest time.
  const keys = Object.keys(record.rivals);
  if (keys.length > RIVALS_MAX) {
    keys
      .sort((a, b) => record.rivals[a].last - record.rivals[b].last)
      .slice(0, keys.length - RIVALS_MAX)
      .forEach((k) => delete record.rivals[k]);
  }
  return rival;
}

/** Counts a finished online game (once per game id) and returns the head-to-head with that opponent. */
export function recordOnline(game: { id: string; outcome: Outcome; rival: { pid: string | null; name: string } }): RivalRecord | null {
  const record = loadRecord();
  const rival = addOnline(record, game);
  saveRecord(record);
  return rival;
}

/** Counts a finished game against the AI. */
export function recordAi(outcome: Outcome): void {
  const record = loadRecord();
  bump(record.ai, outcome);
  saveRecord(record);
}

/** Opponents, most played first (then most recent). */
export function rivalsByGames(record: PlayerRecord): RivalRecord[] {
  return Object.values(record.rivals).sort((a, b) => gamesOf(b) - gamesOf(a) || b.last - a.last);
}

/**
 * Your nemesis: the opponent you have played most (at least
 * `NEMESIS_MIN_GAMES` games); on a tie, the one who beat you more often.
 */
export function nemesisOf(record: PlayerRecord): RivalRecord | null {
  let best: RivalRecord | null = null;
  for (const r of Object.values(record.rivals)) {
    if (gamesOf(r) < NEMESIS_MIN_GAMES) continue;
    if (!best || gamesOf(r) > gamesOf(best) || (gamesOf(r) === gamesOf(best) && (r.losses - r.wins > best.losses - best.wins || (r.losses - r.wins === best.losses - best.wins && r.last > best.last)))) {
      best = r;
    }
  }
  return best;
}

export function resetRecord(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
