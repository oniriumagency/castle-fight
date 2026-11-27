import { DurableObject } from 'cloudflare:workers';
import { PING, PONG, RANKED_RULES, type RankedRoomInfo, type RankedServerMessage } from '@cardcraft-castles/protocol';
import { timingsFrom, type Env } from './env';
import { newRoomId } from './lobby';
import { completeClose } from './room';
import { RankedCore, type MatchRow, type ProfileRow, type QueueSocketState, type RankedHost, type RankedStore } from './rankedCore';

/** What each queue socket remembers across hibernation. */
interface Attachment extends QueueSocketState {
  closed?: boolean;
}

interface ProfileSql extends Record<string, SqlStorageValue> {
  id: string;
  secret_hash: string;
  nickname: string;
  tag: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  season: number;
  season_games: number;
  peak: number;
  created_at: number;
  last_at: number;
  cooldown_until: number;
}

interface MatchSql extends Record<string, SqlStorageValue> {
  id: string;
  room_id: string;
  a: string;
  b: string;
  rated: number;
  created_at: number;
  state: string;
  result: string | null;
}

function toProfile(row: ProfileSql): ProfileRow {
  return {
    id: row.id,
    secretHash: row.secret_hash,
    nickname: row.nickname,
    tag: row.tag,
    rating: row.rating,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    season: row.season,
    seasonGames: row.season_games,
    peak: row.peak,
    createdAt: row.created_at,
    lastAt: row.last_at,
    cooldownUntil: row.cooldown_until,
  };
}

function toMatch(row: MatchSql): MatchRow {
  return {
    id: row.id,
    roomId: row.room_id,
    a: row.a,
    b: row.b,
    rated: row.rated === 1,
    createdAt: row.created_at,
    state: row.state as MatchRow['state'],
    result: row.result ? (JSON.parse(row.result) as MatchRow['result']) : null,
  };
}

/** Profiles and matches in the Durable Object's SQLite. Reads are free; each game writes three rows. */
export class SqlRankedStore implements RankedStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      tag TEXT NOT NULL,
      rating INTEGER NOT NULL,
      games INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      season INTEGER NOT NULL,
      season_games INTEGER NOT NULL,
      peak INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_at INTEGER NOT NULL,
      cooldown_until INTEGER NOT NULL
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS profiles_season ON profiles (season, rating)');
    sql.exec(`CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      a TEXT NOT NULL,
      b TEXT NOT NULL,
      rated INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      state TEXT NOT NULL,
      result TEXT
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS matches_a ON matches (a, created_at)');
    sql.exec('CREATE INDEX IF NOT EXISTS matches_b ON matches (b, created_at)');
  }

  profileBySecret(secretHash: string): ProfileRow | null {
    const rows = this.sql.exec<ProfileSql>('SELECT * FROM profiles WHERE secret_hash = ?', secretHash).toArray();
    return rows[0] ? toProfile(rows[0]) : null;
  }

  profile(id: string): ProfileRow | null {
    const rows = this.sql.exec<ProfileSql>('SELECT * FROM profiles WHERE id = ?', id).toArray();
    return rows[0] ? toProfile(rows[0]) : null;
  }

  saveProfile(p: ProfileRow): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO profiles (id, secret_hash, nickname, tag, rating, games, wins, losses, season, season_games, peak, created_at, last_at, cooldown_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id, p.secretHash, p.nickname, p.tag, p.rating, p.games, p.wins, p.losses, p.season, p.seasonGames, p.peak, p.createdAt, p.lastAt, p.cooldownUntil,
    );
  }

  match(id: string): MatchRow | null {
    const rows = this.sql.exec<MatchSql>('SELECT * FROM matches WHERE id = ?', id).toArray();
    return rows[0] ? toMatch(rows[0]) : null;
  }

  saveMatch(m: MatchRow): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO matches (id, room_id, a, b, rated, created_at, state, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      m.id, m.roomId, m.a, m.b, m.rated ? 1 : 0, m.createdAt, m.state, m.result ? JSON.stringify(m.result) : null,
    );
  }

  openMatchOf(profileId: string, since: number): MatchRow | null {
    const rows = this.sql
      .exec<MatchSql>(
        `SELECT * FROM matches WHERE state = 'open' AND created_at > ? AND (a = ? OR b = ?) ORDER BY created_at DESC LIMIT 1`,
        since, profileId, profileId,
      )
      .toArray();
    return rows[0] ? toMatch(rows[0]) : null;
  }

  pairGames(a: string, b: string, since: number): number {
    return this.sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM matches WHERE state = 'scored' AND rated = 1 AND created_at > ? AND ((a = ? AND b = ?) OR (a = ? AND b = ?))`,
        since, a, b, b, a,
      )
      .one().n;
  }

  top(season: number, limit: number): ProfileRow[] {
    return this.sql
      .exec<ProfileSql>('SELECT * FROM profiles WHERE season = ? AND season_games > 0 ORDER BY rating DESC, last_at ASC LIMIT ?', season, limit)
      .toArray()
      .map(toProfile);
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The single ranked queue: profiles, searching and challenges over one
 * WebSocket per player, and the scoring of ranked rooms. Sockets hibernate;
 * the alarm only rings while someone searches, at the moments their window
 * widens or challenges open.
 */
export class Ranked extends DurableObject<Env> {
  private readonly core: RankedCore<WebSocket>;
  private closing: WebSocket | null = null;
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    const host: RankedHost<WebSocket> = {
      now: () => Date.now(),
      sockets: () =>
        this.ctx.getWebSockets().filter((ws) => ws !== this.closing && ws.readyState === WebSocket.OPEN && !this.attachment(ws).closed),
      state: (ws) => this.attachment(ws),
      setState: (ws, state) => ws.serializeAttachment({ ...this.attachment(ws), ...state } satisfies Attachment),
      send: (ws, message: RankedServerMessage) => {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          // Closing.
        }
      },
      close: (ws, code, reason) => {
        try {
          ws.serializeAttachment({ ...this.attachment(ws), closed: true, search: null, outgoing: null } satisfies Attachment);
          ws.close(code, reason);
        } catch {
          // Already closed.
        }
      },
      hash: sha256,
      randomIndex: (n) => crypto.getRandomValues(new Uint32Array(1))[0]! % n,
      roomId: newRoomId,
      createRoom: async (room) => {
        // Ranked games all run on the standard clock (tests may shorten it with TURN_SECONDS).
        const base = timingsFrom(this.env);
        await this.env.ROOM.get(this.env.ROOM.idFromName(room.roomId)).create({
          id: room.roomId,
          name: `${room.names[0]} vs ${room.names[1]}`,
          host: room.names[0]!,
          private: true,
          timings: this.env.TURN_SECONDS ? base : { ...base, turnSeconds: RANKED_RULES.turnSeconds },
          size: 2,
          twilight: RANKED_RULES.twilight,
          ranked: { matchId: room.matchId, rated: room.rated, names: room.names, tickets: room.tickets },
        });
      },
      limits: env.RATE_LIMITS !== 'off',
    };
    this.core = new RankedCore(new SqlRankedStore(ctx.storage.sql), host);
    void ctx.blockConcurrencyWhile(async () => {
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  // RPC from ranked rooms -----------------------------------------------------

  async report(matchId: string, winner: number | null): Promise<RankedRoomInfo | null> {
    return this.core.report(matchId, winner);
  }

  async abort(matchId: string, absentSeats: number[]): Promise<void> {
    this.core.abort(matchId, absentSeats);
  }

  // Queue socket ---------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      ip: request.headers.get('cf-connecting-ip') ?? 'local',
      ready: false,
      profileId: null,
      search: null,
      outgoing: null,
    } satisfies Attachment);
    this.core.connected(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.core.receive(ws, typeof message === 'string' ? message : '');
    await this.arm();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    completeClose(ws, code, reason);
    await this.dropped(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    await this.core.tick();
    await this.arm();
  }

  private async dropped(ws: WebSocket): Promise<void> {
    this.closing = ws;
    try {
      this.core.disconnected(ws);
    } finally {
      this.closing = null;
    }
    await this.arm();
  }

  private attachment(ws: WebSocket): Attachment {
    const value = ws.deserializeAttachment() as Partial<Attachment> | null;
    return {
      ip: value?.ip ?? 'local',
      ready: value?.ready ?? false,
      profileId: value?.profileId ?? null,
      search: value?.search ?? null,
      outgoing: value?.outgoing ?? null,
      ...(value?.closed ? { closed: true } : {}),
    };
  }

  /** Ring when the core next needs to look at the queue; nothing while nobody searches. */
  private async arm(): Promise<void> {
    const wake = this.core.nextWake();
    if (wake === this.alarmAt) return;
    if (wake !== null && this.alarmAt !== null && this.alarmAt > Date.now() && this.alarmAt <= wake) return;
    this.alarmAt = wake;
    if (wake === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(wake);
  }
}

