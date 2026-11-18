import { Synth } from './synth';

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

/**
 * Renders a synth recipe into a mono buffer, off the audio thread. Returns
 * null where offline rendering is not available; callers then play the
 * recipe live instead.
 */
export async function renderRecipe(seconds: number, sampleRate: number, fn: (s: Synth) => void): Promise<AudioBuffer | null> {
  const Ctor = offlineCtor();
  if (!Ctor) return null;
  try {
    const length = Math.max(1, Math.ceil(seconds * sampleRate));
    const ctx = new Ctor(1, length, sampleRate);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    fn(new Synth(ctx, out, 0));
    const rendered = ctx.startRendering() as Promise<AudioBuffer> | undefined;
    if (rendered && typeof rendered.then === 'function') return await rendered;
    // Old WebKit: callback form.
    return await new Promise<AudioBuffer>((resolve) => {
      ctx.oncomplete = (e) => resolve(e.renderedBuffer);
    });
  } catch {
    return null;
  }
}

/** Yields to the browser so long preparation never blocks a frame. */
export function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 120 });
    else setTimeout(resolve, 16);
  });
}
