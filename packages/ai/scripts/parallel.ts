/**
 * Split a simulation across CPU cores. The script forks itself once per
 * core; each child runs one shard and sends its result back.
 */
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';

export interface Shard {
  index: number;
  count: number;
}

export function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Run `work` for every shard, in child processes, and return all results. */
export async function inParallel<T>(script: string, work: (shard: Shard) => T): Promise<T[]> {
  const mine = process.env['SIM_SHARD'];
  if (mine) {
    const [index, count] = mine.split('/').map(Number) as [number, number];
    process.send!(work({ index, count }), () => process.exit(0));
    return new Promise<T[]>(() => {});
  }
  const count = Math.max(1, Math.min(Number(arg('jobs', '0')) || availableParallelism(), 16));
  if (count === 1) return [work({ index: 0, count: 1 })];
  return Promise.all(
    Array.from({ length: count }, (_, index) => {
      return new Promise<T>((resolve, reject) => {
        const child = fork(script, process.argv.slice(2), {
          env: { ...process.env, SIM_SHARD: `${index}/${count}` },
        });
        child.once('message', (message) => {
          resolve(message as T);
          child.disconnect();
        });
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code) reject(new Error(`Shard ${index} exited with code ${code}`));
        });
      });
    }),
  );
}
