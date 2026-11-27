/**
 * What goes with a player's report without them typing it: the game
 * version, the screen and the game being played (mode, heroes, turn), and
 * the browser and device. Nothing that identifies the player beyond the
 * nickname they chose.
 */
import { recentProblems } from './errorReport';
import { logEvent, recentEvents } from './eventLog';
import { settings } from './settings';

export type GameContext = Record<string, string | number | boolean | null>;

let gameContext: (() => GameContext) | null = null;
let screenName = 'menu';

/** The board registers what it knows about the game in play; null when it closes. */
export function setGameContext(provider: (() => GameContext) | null): void {
  gameContext = provider;
}

/** The screen being shown (menu, lobby, heroSelect, board…). */
export function setScreenName(name: string): void {
  screenName = name;
  logEvent(`screen: ${name}`);
}

function browserOf(ua: string): string {
  const names: [RegExp, string][] = [
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
    [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
    [/Version\/(\d+).*Safari\//, 'Safari'],
  ];
  for (const [pattern, name] of names) {
    const match = ua.match(pattern);
    if (match) return `${name} ${match[1]}`;
  }
  return 'Desconocido';
}

function osOf(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Desconocido';
}

/** The server takes at most this much context (REPORT_LIMITS.maxContextBytes is 8192), with room to spare. */
const CONTEXT_BUDGET = 7600;

export function reportContext(): GameContext {
  const base = baseContext();
  // The latest events, as many as fit: the oldest are dropped first.
  const events = recentEvents();
  while (events.length) {
    const withEvents = { ...base, events: events.join('\n') };
    if (new TextEncoder().encode(JSON.stringify(withEvents)).length <= CONTEXT_BUDGET) return withEvents;
    events.shift();
  }
  return base;
}

function baseContext(): GameContext {
  const ua = navigator.userAgent;
  let game: GameContext = {};
  try {
    game = gameContext?.() ?? {};
  } catch {
    // The context must never stop a report.
  }
  const problems = recentProblems();
  return {
    version: __APP_VERSION__,
    screen: screenName,
    ...game,
    nickname: settings.get().nickname.trim() || null,
    locale: settings.get().locale,
    browser: browserOf(ua),
    os: osOf(ua),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    screenSize: `${screen.width}×${screen.height}`,
    pixelRatio: Math.round(window.devicePixelRatio * 100) / 100,
    touch: matchMedia('(hover: none)').matches,
    standalone: matchMedia('(display-mode: standalone)').matches,
    url: location.pathname + location.search,
    userAgent: ua,
    recentErrors: problems.length ? problems.join('\n') : null,
  };
}
