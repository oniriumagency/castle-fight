/**
 * The site's root since games.onirium.agency became the games library:
 * invite links from before then (`/?room=<id>`) must still reach the game.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

const config = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));

describe('the root of the site', () => {
  let worker: Worker;
  let base: string;

  beforeAll(async () => {
    worker = await unstable_startWorker({
      config,
      dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, watch: false, persist: false, logLevel: 'error' },
    } as Parameters<typeof unstable_startWorker>[0]);
    await worker.ready;
    base = (await worker.url).origin;
  });

  afterAll(async () => {
    await worker?.dispose();
  });

  it('sends old invite links to the game, keeping the room', async () => {
    const response = await fetch(`${base}/?room=abcd2345`, { redirect: 'manual' });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/cardcraft-castles/?room=abcd2345');
  });

  it('goes to the game when the site has no library (development, preview copies)', async () => {
    const response = await fetch(`${base}/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/cardcraft-castles/');
  });

  it('still answers the API', async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
  });
});
