/**
 * Player reports end to end on a local Worker: the game posts a report with
 * a screenshot, and only the right key reads, marks and deletes it.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

const config = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
const KEY = 'test-key-1234567890';

/** The smallest valid PNG (1×1). */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

let worker: Worker;
let base: string;

beforeAll(async () => {
  worker = await unstable_startWorker({
    config,
    bindings: { REPORTS_KEY: { type: 'plain_text', value: KEY } },
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, watch: false, persist: false, logLevel: 'error' },
  } as Parameters<typeof unstable_startWorker>[0]);
  await worker.ready;
  base = (await worker.url).origin;
});

afterAll(async () => {
  await worker?.dispose();
});

function form(fields: Record<string, string>, images: Blob[] = []): FormData {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  for (const image of images) body.append('image', image, 'captura.png');
  return body;
}

const auth = (key = KEY) => ({ authorization: `Bearer ${key}` });

describe('reports', () => {
  it('stores a report with its screenshot and context, readable only with the key', async () => {
    const context = JSON.stringify({ version: '0.1.0+abc', mode: 'ai', hero: 'architect', browser: 'Chrome 140' });
    const sent = await fetch(`${base}/api/reports`, {
      method: 'POST',
      body: form({ kind: 'bug', text: 'La carta no se juega', context }, [new Blob([PNG], { type: 'image/png' })]),
    });
    expect(sent.status).toBe(201);

    expect((await fetch(`${base}/api/reports`)).status).toBe(401);
    expect((await fetch(`${base}/api/reports`, { headers: auth('wrong') })).status).toBe(401);

    const list = (await (await fetch(`${base}/api/reports`, { headers: auth() })).json()) as {
      reports: { id: number; kind: string; text: string; context: Record<string, unknown>; images: number[]; done: boolean }[];
      pending: number;
      total: number;
    };
    expect(list.total).toBe(1);
    expect(list.pending).toBe(1);
    const [report] = list.reports;
    expect(report).toMatchObject({ kind: 'bug', text: 'La carta no se juega', done: false, images: [PNG.length] });
    expect(report.context).toMatchObject({ mode: 'ai', hero: 'architect' });

    const image = await fetch(`${base}/api/reports/${report.id}/images/0`, { headers: auth() });
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);

    const done = await fetch(`${base}/api/reports/${report.id}`, { method: 'PATCH', headers: { ...auth(), 'content-type': 'application/json' }, body: '{"done":true}' });
    expect(done.status).toBe(200);
    const pending = (await (await fetch(`${base}/api/reports?pending=1`, { headers: auth() })).json()) as { reports: unknown[]; pending: number };
    expect(pending.reports).toHaveLength(0);
    expect(pending.pending).toBe(0);

    expect((await fetch(`${base}/api/reports/${report.id}`, { method: 'DELETE', headers: auth() })).status).toBe(200);
    expect((await fetch(`${base}/api/reports/${report.id}/images/0`, { headers: auth() })).status).toBe(404);
  });

  it('turns away empty reports and files that are not images', async () => {
    const empty = await fetch(`${base}/api/reports`, { method: 'POST', body: form({ kind: 'idea', text: '   ' }) });
    expect(empty.status).toBe(400);
    const fake = await fetch(`${base}/api/reports`, {
      method: 'POST',
      body: form({ kind: 'idea', text: 'hola' }, [new Blob(['<script>alert(1)</script>'], { type: 'image/png' })]),
    });
    expect(fake.status).toBe(400);
  });

  it('serves the reading page', async () => {
    const page = await fetch(`${base}/reportes`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Reportes de jugadores');
  });
});
