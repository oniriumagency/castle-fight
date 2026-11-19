import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** `0.1.0+abc1234`: the package version and the commit, shown in player reports. */
function appVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  let commit = process.env.GITHUB_SHA ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'dev';
    }
  }
  return `${version}+${commit.slice(0, 7)}`;
}

/**
 * The game lives under this path on games.onirium.agency; the root is the
 * Onirium games library (apps/library). Everything the client loads goes
 * through `import.meta.env.BASE_URL`, so changing it here is enough.
 */
export const GAME_PATH = '/cardcraft-castles/';

export default defineConfig({
  base: GAME_PATH,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  server: {
    port: 5173,
    // `pnpm dev:server` (wrangler) listens on 8787.
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
  },
});
