/**
 * Where this build runs. `pnpm build:itch` compiles the game for itch.io
 * (mode `itch`, see `.env.itch`): it is served from itch's own domain inside
 * an iframe, talks to the Worker on games.onirium.agency and leaves out what
 * only makes sense on our own site (offline cache, installing the app).
 */
export const ON_ITCH = import.meta.env.MODE === 'itch';

/** Shown inside another site's frame (itch.io), where some browser features are blocked. */
export const EMBEDDED: boolean = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();

/**
 * The page invite links open. On itch the game's own address is a hidden
 * frame that drops `?room=`, so links go to the game on games.onirium.agency,
 * which plays against the same server.
 */
export const INVITE_PAGE: string | undefined = (import.meta.env.VITE_INVITE_URL as string | undefined) || undefined;

/**
 * Copies text, also inside a cross-origin frame where the Clipboard API is
 * often blocked. False if the browser refused both ways.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Blocked by the frame's permissions: fall back to the old copy command.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
