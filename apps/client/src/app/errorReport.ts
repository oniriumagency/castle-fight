/**
 * Sends the page's own problems (uncaught errors, rejected promises, a board
 * that stopped answering) to the server, which writes them to the Worker's
 * logs: Cloudflare dashboard → Workers & Pages → cardcraft-castles → Logs,
 * search for "[client]". Nothing is stored, and nothing personal is sent.
 */

const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) || '';
const ENDPOINT = `${serverUrl.replace(/\/+$/, '')}/api/client-error`;
/** At most this many reports per page load, so a loop of errors cannot flood the logs. */
const MAX_REPORTS = 15;

let sent = 0;
const seen = new Set<string>();
const startedAt = Date.now();

function trim(value: unknown, max = 1500): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Report a problem once per page load (same kind and message). `details` must be small and JSON-safe. */
export function reportProblem(kind: string, message: unknown, details?: Record<string, unknown>): void {
  try {
    const text = trim(message);
    const key = `${kind}|${text.slice(0, 200)}`;
    if (seen.has(key) || sent >= MAX_REPORTS) return;
    seen.add(key);
    sent += 1;
    const body = JSON.stringify({
      kind,
      message: text,
      details,
      page: location.pathname + location.search,
      ua: navigator.userAgent,
      visible: document.visibilityState,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      build: import.meta.env.MODE,
    });
    // text/plain needs no CORS preflight; keepalive lets it leave even while the page unloads.
    void fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => undefined);
  } catch {
    // Reporting must never break the game.
  }
}

/** Catch everything the page does not handle itself. Call once at start-up. */
export function initErrorReporting(): void {
  if (import.meta.env.DEV) return;
  window.addEventListener('error', (e) => {
    reportProblem('error', e.error ?? e.message, { source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined });
  });
  window.addEventListener('unhandledrejection', (e) => reportProblem('rejection', e.reason));
}
