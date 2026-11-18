/**
 * Player reports: bugs, suggestions and comments sent from the game's
 * feedback button, with up to three screenshots each. One `Reports` Durable
 * Object keeps them in its SQLite storage (no extra Cloudflare product to
 * set up), and only someone with the `REPORTS_KEY` secret can read them, at
 * `/reportes`.
 */
import { DurableObject } from 'cloudflare:workers';
import { REPORT_IMAGE_TYPES, REPORT_KINDS, REPORT_LIMITS, type ReportKind } from '@cardcraft-castles/protocol';
import type { Env } from './env';
import { WindowLimiter } from './limits';

export const REPORT_RATE_LIMITS = {
  /** Reports one IP may send in ten minutes. */
  perTenMinutes: 5,
  /** Reports one IP may send in a day. */
  perDay: 30,
  /** Wrong keys one IP may try in ten minutes before it has to wait. */
  badKeysPerTenMinutes: 10,
} as const;

export interface ReportImageInput {
  type: string;
  data: ArrayBuffer;
}

export interface NewReport {
  kind: ReportKind;
  text: string;
  /** JSON, already size-checked. */
  context: string;
  country: string | null;
  images: ReportImageInput[];
}

export interface StoredReport {
  id: number;
  created: number;
  kind: ReportKind;
  text: string;
  /** JSON object (kept as text so it crosses the RPC boundary as is). */
  context: string;
  country: string | null;
  /** Byte size of each screenshot, in order. */
  images: number[];
  done: boolean;
}

export type ReportsResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string; retryAfterMs?: number };

const TEN_MINUTES = 10 * 60_000;
const DAY = 24 * 60 * 60_000;

export class Reports extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly shortLimit = new WindowLimiter(REPORT_RATE_LIMITS.perTenMinutes, TEN_MINUTES);
  private readonly dayLimit = new WindowLimiter(REPORT_RATE_LIMITS.perDay, DAY);
  private readonly badKeys = new WindowLimiter(REPORT_RATE_LIMITS.badKeysPerTenMinutes, TEN_MINUTES);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      context TEXT NOT NULL,
      country TEXT,
      images TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS report_images (
      report INTEGER NOT NULL,
      n INTEGER NOT NULL,
      type TEXT NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (report, n)
    )`);
  }

  async add(report: NewReport, ip: string): Promise<ReportsResult<{ id: number }>> {
    const now = Date.now();
    const wait = Math.max(this.shortLimit.hit(ip, now), this.dayLimit.hit(ip, now));
    if (wait > 0) return { ok: false, status: 429, message: 'Too many reports, try again later', retryAfterMs: wait };
    const sizes = report.images.map((image) => image.data.byteLength);
    const id = this.ctx.storage.transactionSync(() => {
      const row = this.sql
        .exec<{ id: number }>(
          'INSERT INTO reports (created, kind, text, context, country, images) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
          now,
          report.kind,
          report.text,
          report.context,
          report.country,
          JSON.stringify(sizes),
        )
        .one();
      report.images.forEach((image, n) => {
        this.sql.exec('INSERT INTO report_images (report, n, type, data) VALUES (?, ?, ?, ?)', row.id, n, image.type, image.data);
      });
      // Keep the newest ones only.
      const old = this.sql
        .exec<{ id: number }>('SELECT id FROM reports ORDER BY id DESC LIMIT -1 OFFSET ?', REPORT_LIMITS.maxStored)
        .toArray()
        .map((r) => r.id);
      for (const oldId of old) this.deleteRow(oldId);
      return row.id;
    });
    return { ok: true, value: { id } };
  }

  /** Whether `key` is the reader's key. Wrong keys are counted per IP. */
  async checkKey(key: string, ip: string): Promise<ReportsResult<true>> {
    const secret = this.env.REPORTS_KEY;
    if (!secret) return { ok: false, status: 503, message: 'REPORTS_KEY is not set' };
    if (await sameSecret(key, secret)) return { ok: true, value: true };
    const wait = this.badKeys.hit(ip, Date.now());
    if (wait > 0) return { ok: false, status: 429, message: 'Too many wrong keys, wait a few minutes', retryAfterMs: wait };
    return { ok: false, status: 401, message: 'Wrong key' };
  }

  async list(options: { before: number | null; limit: number; pendingOnly: boolean }): Promise<{ reports: StoredReport[]; pending: number; total: number }> {
    const where: string[] = [];
    const args: (number | string)[] = [];
    if (options.before !== null) {
      where.push('id < ?');
      args.push(options.before);
    }
    if (options.pendingOnly) where.push('done = 0');
    const rows = this.sql
      .exec<{ id: number; created: number; kind: string; text: string; context: string; country: string | null; images: string; done: number }>(
        `SELECT id, created, kind, text, context, country, images, done FROM reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
        ...args,
        options.limit,
      )
      .toArray();
    const counts = this.sql.exec<{ total: number; pending: number }>('SELECT COUNT(*) AS total, COALESCE(SUM(done = 0), 0) AS pending FROM reports').one();
    return {
      total: counts.total,
      pending: counts.pending,
      reports: rows.map((r) => ({
        id: r.id,
        created: r.created,
        kind: (REPORT_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ReportKind) : 'other',
        text: r.text,
        context: r.context,
        country: r.country,
        images: parseSizes(r.images),
        done: r.done !== 0,
      })),
    };
  }

  async image(id: number, n: number): Promise<{ type: string; data: ArrayBuffer } | null> {
    const row = this.sql.exec<{ type: string; data: ArrayBuffer }>('SELECT type, data FROM report_images WHERE report = ? AND n = ?', id, n).toArray()[0];
    return row ? { type: row.type, data: row.data } : null;
  }

  async setDone(id: number, done: boolean): Promise<boolean> {
    return this.sql.exec('UPDATE reports SET done = ? WHERE id = ?', done ? 1 : 0, id).rowsWritten > 0;
  }

  async remove(id: number): Promise<boolean> {
    return this.ctx.storage.transactionSync(() => this.deleteRow(id));
  }

  private deleteRow(id: number): boolean {
    this.sql.exec('DELETE FROM report_images WHERE report = ?', id);
    return this.sql.exec('DELETE FROM reports WHERE id = ?', id).rowsWritten > 0;
  }
}

/** Compares two secrets in constant time (by their hashes, so the lengths do not leak either). */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(given)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export function parseObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseSizes(text: string): number[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Reading a report sent by the game
// ---------------------------------------------------------------------------

/** Checks the first bytes, so only real images are kept whatever the browser claimed. */
function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** Turns the form the game posts into a report, or says what is wrong with it. */
export async function readReportForm(request: Request): Promise<{ ok: true; report: NewReport } | { ok: false; status: number; message: string }> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > REPORT_LIMITS.maxBodyBytes) return { ok: false, status: 413, message: 'The report is too big' };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, status: 400, message: 'Expected a form' };
  }
  const kindValue = form.get('kind');
  const kind: ReportKind = typeof kindValue === 'string' && (REPORT_KINDS as readonly string[]).includes(kindValue) ? (kindValue as ReportKind) : 'other';
  const textValue = form.get('text');
  const text = (typeof textValue === 'string' ? textValue : '').replace(/\r\n?/g, '\n').trim();
  if (text.length > REPORT_LIMITS.maxText) return { ok: false, status: 400, message: 'The message is too long' };

  const contextValue = form.get('context');
  let context = '{}';
  if (typeof contextValue === 'string' && contextValue.length <= REPORT_LIMITS.maxContextBytes) {
    const parsed = parseObject(contextValue);
    context = JSON.stringify(parsed);
  }

  const files = form.getAll('image').filter((f): f is File => typeof f !== 'string');
  if (files.length > REPORT_LIMITS.maxImages) return { ok: false, status: 400, message: 'Too many images' };
  const images: ReportImageInput[] = [];
  for (const file of files) {
    if (file.size > REPORT_LIMITS.maxImageBytes) return { ok: false, status: 413, message: 'An image is too big' };
    const data = await file.arrayBuffer();
    const type = sniffImage(new Uint8Array(data, 0, Math.min(16, data.byteLength)));
    if (!type || !(REPORT_IMAGE_TYPES as readonly string[]).includes(type)) return { ok: false, status: 400, message: 'Only JPEG, PNG or WebP images' };
    images.push({ type, data });
  }
  if (!text && images.length === 0) return { ok: false, status: 400, message: 'Write something or attach a screenshot' };

  return { ok: true, report: { kind, text, context, country: request.headers.get('cf-ipcountry'), images } };
}
