import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Writes `dist/sw.js` (from `sw/sw.js`) with the list of files to keep for
 * playing offline and a hash of each one, so a new deploy only downloads what
 * changed. See `src/app/offline.ts` for the registration.
 */

/** Saved after the rest, in the background: large, and the game starts without it. */
const LATER = /^music\//;
/** Never saved ahead: the worker itself, and fallbacks modern browsers do not ask for. */
const SKIP = /^sw\.js$|\.woff$|\.map$/;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}

export function offlineCache(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'cardcraft-offline-cache',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      const outDir = join(config.root, config.build.outDir);
      const core: [string, string][] = [];
      const later: [string, string][] = [];
      for (const path of (await files(outDir)).sort()) {
        const rel = relative(outDir, path).split(sep).join('/');
        if (SKIP.test(rel)) continue;
        const rev = createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 12);
        // The page is asked for (and saved) by the folder's own address.
        const entry: [string, string] = [rel === 'index.html' ? './' : rel, rev];
        (LATER.test(rel) ? later : core).push(entry);
      }
      const template = await readFile(join(config.root, 'sw/sw.js'), 'utf8');
      // A change to the worker itself also starts a new cache.
      const version = createHash('sha256').update(JSON.stringify([core, later, template])).digest('hex').slice(0, 12);
      const sw = template
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__CORE__', JSON.stringify(core))
        .replace('__LATER__', JSON.stringify(later));
      await writeFile(join(outDir, 'sw.js'), sw);
      config.logger.info(`sw.js: version ${version}, ${core.length} files now and ${later.length} in the background`);
    },
  };
}
