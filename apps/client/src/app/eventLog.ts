/**
 * A short trail of what just happened (screens, buttons pressed, cards played,
 * the end of a game), kept in memory only and sent with a player's report.
 * It explains bugs that leave no error behind, such as a press that hid the
 * results before they were seen. Nothing is sent on its own.
 */

/** Entries kept: the oldest go first. */
const MAX_EVENTS = 60;
const MAX_LENGTH = 140;

const events: string[] = [];
const startedAt = Date.now();

/** Time since the page loaded, as m:ss.t (the report's own time says when that was). */
function stamp(): string {
  const ms = Date.now() - startedAt;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

/** Note something that happened. Never throws. */
export function logEvent(text: string): void {
  try {
    const line = text.replace(/\s+/g, ' ').trim();
    events.push(`${stamp()} ${line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH)}…` : line}`);
    if (events.length > MAX_EVENTS) events.shift();
  } catch {
    // The trail must never break the game.
  }
}

/** The trail, oldest first. */
export function recentEvents(): string[] {
  return [...events];
}

function labelOf(el: Element): string {
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '';
  const text = label.replace(/\s+/g, ' ').trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text || el.className.toString().split(' ')[0] || el.tagName.toLowerCase();
}

/** Presses on buttons and leaving or coming back to the tab. Call once at start-up. */
export function initEventLog(): void {
  logEvent(`page: ${location.pathname}${location.search}`);
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target instanceof Element ? e.target.closest('button, [role="button"], a') : null;
      if (target) logEvent(`click: ${labelOf(target)}${(target as HTMLButtonElement).disabled ? ' (disabled)' : ''}`);
    },
    { capture: true, passive: true },
  );
  document.addEventListener('visibilitychange', () => logEvent(`tab: ${document.visibilityState}`));
}
