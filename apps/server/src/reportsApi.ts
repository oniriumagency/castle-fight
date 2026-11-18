/**
 * HTTP side of the player reports:
 *
 *   POST   /api/reports                     the game sends a report (form data)
 *   GET    /api/reports?before=&pending=1    list, newest first          (key)
 *   GET    /api/reports/:id/images/:n        one screenshot              (key)
 *   PATCH  /api/reports/:id  {"done":true}   mark as dealt with          (key)
 *   DELETE /api/reports/:id                  delete                      (key)
 *   GET    /reportes                         the page to read them
 *
 * The key travels in the `authorization: Bearer <key>` header, never in the URL.
 */
import type { Env } from './env';
import { parseObject, readReportForm, type Reports, type ReportsResult } from './reports';
import { REPORTS_PAGE } from './reportsPage';

const PAGE_SIZE = 30;
const MAX_KEY_LENGTH = 200;

function noStore(extra: Record<string, string> = {}): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: noStore(headers) });
}

function failure(status: number, message: string, retryAfterMs?: number): Response {
  const headers: Record<string, string> = {};
  if (retryAfterMs) headers['retry-after'] = String(Math.ceil(retryAfterMs / 1000));
  return json({ error: { message, ...(retryAfterMs ? { retryAfterMs } : {}) } }, status, headers);
}

function fromResult<T>(result: ReportsResult<T>): Response | null {
  return result.ok ? null : failure(result.status, result.message, result.retryAfterMs);
}

function keyOf(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1].slice(0, MAX_KEY_LENGTH) : '';
}

export async function handleReports(request: Request, env: Env, path: string, ip: string): Promise<Response> {
  const reports: DurableObjectStub<Reports> = env.REPORTS.get(env.REPORTS.idFromName('reports'));

  if (path === '/reportes') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'Method not allowed');
    return new Response(REPORTS_PAGE, {
      headers: noStore({
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
        'referrer-policy': 'no-referrer',
      }),
    });
  }

  if (path === '/api/reports' && request.method === 'POST') {
    const form = await readReportForm(request);
    if (!form.ok) return failure(form.status, form.message);
    const added = await reports.add(form.report, ip);
    return fromResult(added) ?? json({ ok: true }, 201);
  }

  // Everything else is for the reader only.
  const key = keyOf(request);
  if (!key) return failure(401, 'Missing key');
  const allowed = fromResult(await reports.checkKey(key, ip));
  if (allowed) return allowed;

  if (path === '/api/reports') {
    if (request.method !== 'GET') return failure(405, 'Method not allowed');
    const url = new URL(request.url);
    const before = Number(url.searchParams.get('before'));
    const list = await reports.list({
      before: Number.isInteger(before) && before > 0 ? before : null,
      limit: PAGE_SIZE,
      pendingOnly: url.searchParams.get('pending') === '1',
    });
    return json({
      reports: list.reports.map((report) => ({ ...report, context: parseObject(report.context) })),
      total: list.total,
      pending: list.pending,
      pageSize: PAGE_SIZE,
    });
  }

  const image = path.match(/^\/api\/reports\/(\d+)\/images\/(\d+)$/);
  if (image) {
    if (request.method !== 'GET') return failure(405, 'Method not allowed');
    const found = await reports.image(Number(image[1]), Number(image[2]));
    if (!found) return failure(404, 'No such image');
    return new Response(found.data, { headers: noStore({ 'content-type': found.type, 'x-content-type-options': 'nosniff' }) });
  }

  const one = path.match(/^\/api\/reports\/(\d+)$/);
  if (one) {
    const id = Number(one[1]);
    if (request.method === 'DELETE') return (await reports.remove(id)) ? json({ ok: true }) : failure(404, 'No such report');
    if (request.method === 'PATCH') {
      const body = (await request.json().catch(() => null)) as { done?: unknown } | null;
      if (!body || typeof body.done !== 'boolean') return failure(400, 'Expected {"done": true|false}');
      return (await reports.setDone(id, body.done)) ? json({ ok: true }) : failure(404, 'No such report');
    }
    return failure(405, 'Method not allowed');
  }

  return failure(404, 'Not found');
}
