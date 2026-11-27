/**
 * The ranked queue, independent of Cloudflare: profiles, searching, the
 * widening window, challenges across rating gaps, and scoring the games.
 *
 * `ranked.ts` runs it in a Durable Object with SQLite as the store; the tests
 * run it with an in-memory store, fake sockets and a fake clock.
 */
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  RANKED_ID_PATTERN,
  RANKED_RULES,
  RANKED_SECRET_ALPHABET,
  cleanNickname,
  parseRankedClientMessage,
  ratingChange,
  searchWindow,
  seasonEnd,
  seasonOf,
  seasonReset,
  stakes,
  type HeroChoice,
  type RankedErrorCode,
  type RankedMatch,
  type RankedPlayer,
  type RankedProfile,
  type RankedRoomInfo,
  type RankedSearcher,
  type RankedSeatResult,
  type RankedServerMessage,
} from '@cardcraft-castles/protocol';
import { TokenBucket, WindowLimiter } from './limits';

export const RANKED_LIMITS = {
  /** New profiles one IP may make per hour (each new profile is a fresh 1000). */
  profilesPerHour: 5,
  /** Queue connections per IP. */
  socketsPerIp: 8,
  messageBurst: 10,
  messagesPerSecond: 2,
  maxStrikes: 10,
  /** A match nobody reported for this long no longer keeps its players out of the queue. */
  matchStaleMs: 2 * 60 * 60_000,
} as const;

export interface ProfileRow {
  id: string;
  secretHash: string;
  nickname: string;
  tag: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  season: number;
  seasonGames: number;
  peak: number;
  createdAt: number;
  lastAt: number;
  cooldownUntil: number;
}

export interface MatchRow {
  id: string;
  roomId: string;
  /** Profile in seat 0 and seat 1. */
  a: string;
  b: string;
  rated: boolean;
  createdAt: number;
  /** 'open' until the room reports. */
  state: 'open' | 'scored' | 'aborted';
  /** JSON of the seat results once scored. */
  result: (RankedSeatResult | null)[] | null;
}

/** Where profiles and matches are kept. Synchronous, like SQLite in a Durable Object. */
export interface RankedStore {
  profileBySecret(secretHash: string): ProfileRow | null;
  profile(id: string): ProfileRow | null;
  saveProfile(row: ProfileRow): void;
  match(id: string): MatchRow | null;
  saveMatch(row: MatchRow): void;
  /** Open matches of a profile created after `since`. */
  openMatchOf(profileId: string, since: number): MatchRow | null;
  /** Rated, scored games between the two since `since`. */
  pairGames(a: string, b: string, since: number): number;
  /** Best ratings of the season among profiles that played in it. */
  top(season: number, limit: number): ProfileRow[];
}

/** What a socket of the queue remembers (it survives hibernation in the socket's attachment). */
export interface QueueSocketState {
  ip: string;
  /** Said hello (with or without a profile). */
  ready: boolean;
  profileId: string | null;
  search: { since: number; hero: HeroChoice } | null;
  /** A challenge this socket sent and nobody answered yet. */
  outgoing: { to: string; at: number } | null;
}

export interface NewRankedRoom {
  roomId: string;
  matchId: string;
  rated: boolean;
  /** Per seat. */
  names: string[];
  tickets: string[];
}

export interface RankedHost<S> {
  now(): number;
  sockets(): S[];
  state(socket: S): QueueSocketState;
  setState(socket: S, state: QueueSocketState): void;
  send(socket: S, message: RankedServerMessage): void;
  close(socket: S, code: number, reason: string): void;
  /** SHA-256 (hex) of a secret: only hashes are stored. */
  hash(secret: string): Promise<string>;
  randomIndex(n: number): number;
  /** A fresh, unused room id. */
  roomId(): string;
  /** Make the ranked room. */
  createRoom(room: NewRankedRoom): Promise<void>;
  /** False only in tests that run everything from one IP. */
  readonly limits: boolean;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function displayName(row: Pick<ProfileRow, 'nickname' | 'tag'>): string {
  return `${row.nickname}#${row.tag}`;
}

export class RankedCore<S> {
  private readonly buckets = new Map<S, TokenBucket>();
  private readonly strikes = new Map<S, number>();
  private readonly creates = new WindowLimiter(RANKED_LIMITS.profilesPerHour, 60 * 60_000);

  constructor(
    private readonly store: RankedStore,
    private readonly host: RankedHost<S>,
  ) {}

  // -------------------------------------------------------------------------
  // Sockets
  // -------------------------------------------------------------------------

  /** A socket connected. False when it was turned away. */
  connected(socket: S): boolean {
    const { ip } = this.host.state(socket);
    if (this.host.limits) {
      const same = this.host.sockets().filter((s) => s !== socket && this.host.state(s).ip === ip);
      if (same.length >= RANKED_LIMITS.socketsPerIp) {
        this.host.close(socket, CLOSE_CODES.tooManyConnections, 'Too many ranked connections');
        return false;
      }
    }
    return true;
  }

  async receive(socket: S, text: string): Promise<void> {
    if (!this.allow(socket)) return;
    const message = parseRankedClientMessage(text);
    if (!message) {
      this.strike(socket);
      return this.error(socket, 'badMessage', 'Malformed or unknown message');
    }
    if (message.type !== 'hello' && !this.host.state(socket).ready) {
      return this.error(socket, 'badMessage', 'Say hello first');
    }
    switch (message.type) {
      case 'hello':
        return this.hello(socket, message.v, message.secret);
      case 'search':
        return this.search(socket, message.nickname, message.hero);
      case 'cancel':
        this.stopSearching(socket);
        this.broadcastQueue();
        return;
      case 'challenge':
        return this.challenge(socket, message.target);
      case 'answer':
        return this.answer(socket, message.from, message.accept);
      case 'top':
        return this.host.send(socket, { type: 'top', leaderboard: this.leaderboard() });
    }
  }

  disconnected(socket: S): void {
    this.buckets.delete(socket);
    this.strikes.delete(socket);
    const state = this.host.state(socket);
    if (state.search || state.outgoing) {
      this.withdrawChallenges(socket, state.profileId);
      this.broadcastQueue(socket);
    }
  }

  /** The alarm rang: lapse old challenges, match whoever fits now and refresh everyone's window. */
  async tick(): Promise<void> {
    const now = this.host.now();
    for (const socket of this.host.sockets()) {
      const state = this.host.state(socket);
      if (state.outgoing && now - state.outgoing.at >= RANKED_RULES.challengeTtlMs) {
        const target = state.outgoing.to;
        this.host.setState(socket, { ...state, outgoing: null });
        this.host.send(socket, { type: 'challengeEnded', target, reason: 'expired' });
        const other = this.socketOf(target);
        if (other && state.profileId) this.host.send(other, { type: 'challengeWithdrawn', from: state.profileId });
      }
    }
    await this.matchAll();
    this.broadcastQueue();
  }

  /** When the alarm should ring next: the next widening of anyone's window, challenges opening or lapsing. */
  nextWake(): number | null {
    const now = this.host.now();
    let next: number | null = null;
    const consider = (time: number): void => {
      if (time > now && (next === null || time < next)) next = time;
    };
    for (const socket of this.host.sockets()) {
      const { search, outgoing } = this.host.state(socket);
      if (search) {
        const elapsed = now - search.since;
        if (searchWindow(elapsed) < RANKED_RULES.windowMax) {
          consider(search.since + (Math.floor(elapsed / RANKED_RULES.windowEveryMs) + 1) * RANKED_RULES.windowEveryMs);
        }
        consider(search.since + RANKED_RULES.challengeAfterMs);
      }
      if (outgoing) consider(outgoing.at + RANKED_RULES.challengeTtlMs);
    }
    return next;
  }

  // -------------------------------------------------------------------------
  // From ranked rooms
  // -------------------------------------------------------------------------

  /** A ranked game ended. `winner` is the seat that won, or null for a draw. Idempotent. */
  report(matchId: string, winner: number | null): RankedRoomInfo | null {
    const match = this.store.match(matchId);
    if (!match) return null;
    if (match.state === 'scored') return { rated: match.rated, result: match.result };
    if (match.state === 'aborted') return { rated: false, result: null };
    const now = this.host.now();
    if (!match.rated) {
      this.store.saveMatch({ ...match, state: 'scored', result: null });
      return { rated: false, result: null };
    }
    const a = this.loadProfile(match.a);
    const b = this.loadProfile(match.b);
    if (!a || !b) {
      this.store.saveMatch({ ...match, state: 'scored', result: null });
      return { rated: false, result: null };
    }
    const scoreA: 0 | 0.5 | 1 = winner === null ? 0.5 : winner === 0 ? 1 : 0;
    const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
    const deltaA = ratingChange(a.rating, b.rating, a.games, scoreA);
    const deltaB = ratingChange(b.rating, a.rating, b.games, scoreB);
    const apply = (row: ProfileRow, delta: number, score: number): RankedSeatResult => {
      const after = Math.max(RANKED_RULES.floor, row.rating + delta);
      const updated: ProfileRow = {
        ...row,
        rating: after,
        games: row.games + 1,
        wins: row.wins + (score === 1 ? 1 : 0),
        losses: row.losses + (score === 0 ? 1 : 0),
        seasonGames: row.seasonGames + 1,
        peak: Math.max(row.peak, after),
        lastAt: now,
      };
      this.store.saveProfile(updated);
      return { before: row.rating, after, delta: after - row.rating };
    };
    const result = [apply(a, deltaA, scoreA), apply(b, deltaB, scoreB)];
    this.store.saveMatch({ ...match, state: 'scored', result });
    this.refreshProfiles([match.a, match.b]);
    return { rated: true, result };
  }

  /** A ranked room closed before its game started. Whoever never sat waits a minute before searching again. */
  abort(matchId: string, absentSeats: number[]): void {
    const match = this.store.match(matchId);
    if (!match || match.state !== 'open') return;
    this.store.saveMatch({ ...match, state: 'aborted' });
    const until = this.host.now() + RANKED_RULES.noShowCooldownMs;
    for (const seat of absentSeats) {
      const id = seat === 0 ? match.a : seat === 1 ? match.b : null;
      const row = id ? this.store.profile(id) : null;
      if (row) this.store.saveProfile({ ...row, cooldownUntil: until });
    }
    this.refreshProfiles([match.a, match.b]);
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private async hello(socket: S, version: number, secret: string | null): Promise<void> {
    if (version !== PROTOCOL_VERSION) {
      this.error(socket, 'outdated', `The server speaks protocol ${PROTOCOL_VERSION}: reload the page`);
      this.host.close(socket, CLOSE_CODES.outdated, 'Outdated client');
      return;
    }
    let state = this.host.state(socket);
    // Saying hello again (another code was typed) starts over.
    if (state.search || state.outgoing) this.stopSearching(socket);
    let row: ProfileRow | null = null;
    if (secret !== null) {
      row = this.store.profileBySecret(await this.host.hash(secret));
      if (!row) this.error(socket, 'unknownProfile', 'No ranked profile has that code');
    }
    state = this.host.state(socket);
    this.host.setState(socket, { ...state, ready: true, profileId: row?.id ?? null, search: null, outgoing: null });
    if (row) {
      row = this.loadProfile(row.id);
      // One connection per profile: the newest wins.
      for (const other of this.host.sockets()) {
        if (other !== socket && this.host.state(other).profileId === row!.id) {
          this.stopSearching(other);
          this.host.close(other, CLOSE_CODES.replaced, 'This profile connected from somewhere else');
        }
      }
    }
    this.host.send(socket, { type: 'profile', profile: row ? this.publicProfile(row) : null, now: this.host.now() });
    this.broadcastQueue();
  }

  private async search(socket: S, rawNickname: string, hero: HeroChoice): Promise<void> {
    const now = this.host.now();
    const state = this.host.state(socket);
    const nickname = cleanNickname(rawNickname);
    if (!nickname) return this.error(socket, 'badMessage', 'A nickname is required');
    let row = state.profileId ? this.loadProfile(state.profileId) : null;
    let secret: string | undefined;
    if (!row) {
      if (this.host.limits) {
        const wait = this.creates.hit(state.ip, now);
        if (wait > 0) return this.error(socket, 'rateLimited', 'Too many new ranked profiles from this network; try again later');
      }
      secret = this.randomSecret();
      row = this.newProfile(nickname, await this.host.hash(secret), now);
    } else if (row.nickname !== nickname) {
      row = { ...row, nickname };
      this.store.saveProfile(row);
    }
    if (row.cooldownUntil > now) {
      this.host.setState(socket, { ...this.host.state(socket), profileId: row.id });
      this.host.send(socket, { type: 'profile', profile: this.publicProfile(row), ...(secret ? { secret } : {}), now });
      return this.error(socket, 'cooldown', 'You did not take your last match; wait a moment');
    }
    if (this.store.openMatchOf(row.id, now - RANKED_LIMITS.matchStaleMs)) {
      return this.error(socket, 'busy', 'You already have a ranked game in progress');
    }
    const current = this.host.state(socket);
    this.host.setState(socket, {
      ...current,
      profileId: row.id,
      // Searching again keeps your place (and your window).
      search: { since: current.search?.since ?? now, hero },
    });
    if (secret) this.host.send(socket, { type: 'profile', profile: this.publicProfile(row), secret, now });
    await this.matchAll();
    this.broadcastQueue();
  }

  private challenge(socket: S, target: string): void {
    const now = this.host.now();
    const state = this.host.state(socket);
    if (!state.search || !state.profileId) return this.error(socket, 'notSearching', 'Search first');
    const other = this.socketOf(target);
    const me = this.store.profile(state.profileId);
    const them = other ? this.store.profile(target) : null;
    if (!other || !me || !them || !this.host.state(other).search) {
      return this.error(socket, 'notChallengeable', 'That player is no longer searching');
    }
    if (!this.mayChallenge(socket, other, me, them, now)) {
      return this.error(socket, 'notChallengeable', 'You cannot challenge that player');
    }
    // One challenge at a time: a new one replaces the last.
    if (state.outgoing && state.outgoing.to !== target) {
      const previous = this.socketOf(state.outgoing.to);
      if (previous) this.host.send(previous, { type: 'challengeWithdrawn', from: me.id });
    }
    this.host.setState(socket, { ...state, outgoing: { to: target, at: now } });
    this.host.send(other, {
      type: 'challenged',
      from: this.searcherFor(other, socket, them, me, now),
      expiresAt: now + RANKED_RULES.challengeTtlMs,
      now,
    });
  }

  private async answer(socket: S, from: string, accept: boolean): Promise<void> {
    const now = this.host.now();
    const state = this.host.state(socket);
    const challenger = this.socketOf(from);
    const theirs = challenger ? this.host.state(challenger) : null;
    if (!challenger || !theirs?.outgoing || theirs.outgoing.to !== state.profileId) {
      return this.error(socket, 'notChallengeable', 'That challenge is no longer open');
    }
    if (!accept || !state.search || !theirs.search || now - theirs.outgoing.at >= RANKED_RULES.challengeTtlMs) {
      this.host.setState(challenger, { ...theirs, outgoing: null });
      this.host.send(challenger, { type: 'challengeEnded', target: state.profileId!, reason: accept ? 'expired' : 'declined' });
      return;
    }
    await this.makeMatch(challenger, socket);
    this.broadcastQueue();
  }

  // -------------------------------------------------------------------------
  // Matching
  // -------------------------------------------------------------------------

  /** Pair everyone who fits, whoever has searched longest first, each with the closest rating in reach. */
  private async matchAll(): Promise<void> {
    const now = this.host.now();
    const searching = this.searchers();
    const taken = new Set<S>();
    const pairs: [S, S][] = [];
    for (const [i, a] of searching.entries()) {
      if (taken.has(a.socket)) continue;
      let best: (typeof searching)[number] | null = null;
      for (const b of searching.slice(i + 1)) {
        if (taken.has(b.socket)) continue;
        const gap = Math.abs(a.row.rating - b.row.rating);
        const window = Math.min(searchWindow(now - a.since), searchWindow(now - b.since));
        if (gap > window || !this.fairPair(a.socket, b.socket, a.row, b.row, now)) continue;
        if (!best || gap < Math.abs(a.row.rating - best.row.rating)) best = b;
      }
      if (!best) continue;
      taken.add(a.socket);
      taken.add(best.socket);
      pairs.push([a.socket, best.socket]);
    }
    for (const [a, b] of pairs) await this.makeMatch(a, b);
  }

  /** Make the room for two searchers and send each their ticket. */
  private async makeMatch(a: S, b: S): Promise<void> {
    const now = this.host.now();
    const stateA = this.host.state(a);
    const stateB = this.host.state(b);
    const rowA = stateA.profileId ? this.store.profile(stateA.profileId) : null;
    const rowB = stateB.profileId ? this.store.profile(stateB.profileId) : null;
    if (!rowA || !rowB || !stateA.search || !stateB.search) return;
    const rated = this.ratedPair(a, b, rowA, rowB, now);
    const match: MatchRow = {
      id: this.randomId(16),
      roomId: this.host.roomId(),
      a: rowA.id,
      b: rowB.id,
      rated,
      createdAt: now,
      state: 'open',
      result: null,
    };
    const tickets = [this.randomId(24), this.randomId(24)];
    // Out of the queue before the room is made, so nothing else pairs them meanwhile.
    this.withdrawChallenges(a, rowA.id);
    this.withdrawChallenges(b, rowB.id);
    this.host.setState(a, { ...this.host.state(a), search: null, outgoing: null });
    this.host.setState(b, { ...this.host.state(b), search: null, outgoing: null });
    this.store.saveMatch(match);
    try {
      await this.host.createRoom({
        roomId: match.roomId,
        matchId: match.id,
        rated,
        names: [displayName(rowA), displayName(rowB)],
        tickets,
      });
    } catch (error) {
      console.error('Ranked room failed', error);
      this.store.saveMatch({ ...match, state: 'aborted' });
      // Back in the queue, where they were.
      this.host.setState(a, { ...this.host.state(a), search: stateA.search });
      this.host.setState(b, { ...this.host.state(b), search: stateB.search });
      return;
    }
    const send = (socket: S, me: ProfileRow, them: ProfileRow, ticket: string): void => {
      const value: RankedMatch = {
        roomId: match.roomId,
        ticket,
        opponent: this.player(them),
        stakes: rated ? stakes(me.rating, them.rating, me.games) : null,
      };
      this.host.send(socket, { type: 'matched', match: value });
    };
    send(a, rowA, rowB, tickets[0]!);
    send(b, rowB, rowA, tickets[1]!);
  }

  /** Two searchers the automatic matching may pair: different people, different networks, not too many games today. */
  private fairPair(a: S, b: S, rowA: ProfileRow, rowB: ProfileRow, now: number): boolean {
    return rowA.id !== rowB.id && this.ratedPair(a, b, rowA, rowB, now);
  }

  /** Whether a game between the two changes their ratings. */
  private ratedPair(a: S, b: S, rowA: ProfileRow, rowB: ProfileRow, now: number): boolean {
    if (this.host.limits && this.host.state(a).ip === this.host.state(b).ip) return false;
    return this.store.pairGames(rowA.id, rowB.id, now - RANKED_RULES.pairWindowMs) < RANKED_RULES.pairGamesPerWindow;
  }

  private mayChallenge(socket: S, other: S, me: ProfileRow, them: ProfileRow, now: number): boolean {
    const mine = this.host.state(socket).search;
    if (!mine || me.id === them.id || now - mine.since < RANKED_RULES.challengeAfterMs) return false;
    return Math.abs(me.rating - them.rating) <= RANKED_RULES.challengeMaxGap && !!this.host.state(other).search;
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  /** Tell every connection where the queue stands (`except`: a socket that is closing). */
  private broadcastQueue(except?: S): void {
    const now = this.host.now();
    const searching = this.searchers().filter((s) => s.socket !== except);
    for (const socket of this.host.sockets()) {
      if (socket === except) continue;
      const state = this.host.state(socket);
      if (!state.ready) continue;
      const me = state.profileId ? this.store.profile(state.profileId) : null;
      const open = !!state.search && now - state.search.since >= RANKED_RULES.challengeAfterMs;
      this.host.send(socket, {
        type: 'queue',
        searching: !!state.search,
        since: state.search?.since ?? null,
        window: state.search ? searchWindow(now - state.search.since) : RANKED_RULES.windowStart,
        challengesOpen: open,
        players:
          open && me
            ? searching.filter((s) => s.socket !== socket).map((s) => this.searcherFor(socket, s.socket, me, s.row, now))
            : [],
        count: searching.length,
        now,
      });
    }
  }

  private searcherFor(viewer: S, socket: S, me: ProfileRow, them: ProfileRow, now: number): RankedSearcher {
    return {
      ...this.player(them),
      stakes: this.ratedPair(viewer, socket, me, them, now) ? stakes(me.rating, them.rating, me.games) : null,
      challengeable: Math.abs(me.rating - them.rating) <= RANKED_RULES.challengeMaxGap && me.id !== them.id,
    };
  }

  private leaderboard() {
    const season = seasonOf(this.host.now());
    return {
      season,
      endsAt: seasonEnd(season),
      players: this.store.top(season, RANKED_RULES.leaderboardSize).map((row) => this.player(row)),
    };
  }

  private player(row: ProfileRow): RankedPlayer {
    return { id: row.id, nickname: row.nickname, tag: row.tag, rating: row.rating, games: row.games };
  }

  private publicProfile(row: ProfileRow): RankedProfile {
    return {
      ...this.player(row),
      wins: row.wins,
      losses: row.losses,
      season: row.season,
      seasonGames: row.seasonGames,
      peak: row.peak,
      cooldownUntil: row.cooldownUntil > this.host.now() ? row.cooldownUntil : null,
    };
  }

  /** Send fresh profiles to whoever is connected with them (after a game). */
  private refreshProfiles(ids: string[]): void {
    for (const socket of this.host.sockets()) {
      const id = this.host.state(socket).profileId;
      if (!id || !ids.includes(id)) continue;
      const row = this.store.profile(id);
      if (row) this.host.send(socket, { type: 'profile', profile: this.publicProfile(row), now: this.host.now() });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** A profile, moved into the current season if it was last seen in an older one. */
  private loadProfile(id: string): ProfileRow | null {
    const row = this.store.profile(id);
    if (!row) return null;
    const season = seasonOf(this.host.now());
    if (row.season >= season) return row;
    const rating = seasonReset(row.rating);
    const moved: ProfileRow = { ...row, season, seasonGames: 0, rating, peak: rating };
    this.store.saveProfile(moved);
    return moved;
  }

  private newProfile(nickname: string, secretHash: string, now: number): ProfileRow {
    let id = this.randomId(12);
    while (this.store.profile(id)) id = this.randomId(12);
    const row: ProfileRow = {
      id,
      secretHash,
      nickname,
      tag: String(1000 + this.host.randomIndex(9000)),
      rating: RANKED_RULES.startRating,
      games: 0,
      wins: 0,
      losses: 0,
      season: seasonOf(now),
      seasonGames: 0,
      peak: RANKED_RULES.startRating,
      createdAt: now,
      lastAt: now,
      cooldownUntil: 0,
    };
    this.store.saveProfile(row);
    return row;
  }

  private searchers(): { socket: S; row: ProfileRow; since: number }[] {
    const list: { socket: S; row: ProfileRow; since: number }[] = [];
    for (const socket of this.host.sockets()) {
      const { search, profileId } = this.host.state(socket);
      if (!search || !profileId) continue;
      const row = this.store.profile(profileId);
      if (row) list.push({ socket, row, since: search.since });
    }
    return list.sort((x, y) => x.since - y.since);
  }

  private socketOf(profileId: string): S | null {
    if (!RANKED_ID_PATTERN.test(profileId)) return null;
    return this.host.sockets().find((s) => this.host.state(s).profileId === profileId) ?? null;
  }

  private stopSearching(socket: S): void {
    const state = this.host.state(socket);
    this.withdrawChallenges(socket, state.profileId);
    this.host.setState(socket, { ...this.host.state(socket), search: null, outgoing: null });
  }

  /** Tell the other side of any open challenge to or from `socket` that it is over. */
  private withdrawChallenges(socket: S, profileId: string | null): void {
    const state = this.host.state(socket);
    if (state.outgoing) {
      const target = this.socketOf(state.outgoing.to);
      if (target && profileId) this.host.send(target, { type: 'challengeWithdrawn', from: profileId });
    }
    if (!profileId) return;
    for (const other of this.host.sockets()) {
      if (other === socket) continue;
      const theirs = this.host.state(other);
      if (theirs.outgoing?.to !== profileId) continue;
      this.host.setState(other, { ...theirs, outgoing: null });
      this.host.send(other, { type: 'challengeEnded', target: profileId, reason: 'gone' });
    }
  }

  private randomId(length: number): string {
    return Array.from({ length }, () => ID_ALPHABET[this.host.randomIndex(ID_ALPHABET.length)]).join('');
  }

  private randomSecret(): string {
    return Array.from({ length: 24 }, () => RANKED_SECRET_ALPHABET[this.host.randomIndex(RANKED_SECRET_ALPHABET.length)]).join('');
  }

  private error(socket: S, code: RankedErrorCode, message: string): void {
    this.host.send(socket, { type: 'error', code, message });
  }

  private allow(socket: S): boolean {
    let bucket = this.buckets.get(socket);
    if (!bucket) {
      bucket = new TokenBucket(RANKED_LIMITS.messageBurst, RANKED_LIMITS.messagesPerSecond, this.host.now());
      this.buckets.set(socket, bucket);
    }
    if (bucket.take(this.host.now())) return true;
    this.strike(socket);
    this.error(socket, 'rateLimited', 'Slow down');
    return false;
  }

  private strike(socket: S): void {
    const strikes = (this.strikes.get(socket) ?? 0) + 1;
    this.strikes.set(socket, strikes);
    if (strikes > RANKED_LIMITS.maxStrikes) this.host.close(socket, CLOSE_CODES.abuse, 'Too many invalid messages');
  }
}
