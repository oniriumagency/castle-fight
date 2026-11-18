/**
 * Calls the player back when the game needs them and the tab is in the
 * background: the tab title blinks and, if the player allowed it, the
 * browser shows a notification. Both stop as soon as the tab is visible again.
 */

let blink: ReturnType<typeof setInterval> | null = null;
let baseTitle = '';
let note: Notification | null = null;

function stop(): void {
  if (blink !== null) {
    clearInterval(blink);
    blink = null;
    document.title = baseTitle;
  }
  note?.close();
  note = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) stop();
  });
  window.addEventListener('focus', stop);
}

/** Ask once for permission to show notifications. Call it from a click (browsers require a gesture). */
export function askNotificationPermission(): void {
  try {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    // Not supported (some mobile browsers): the blinking title still works.
  }
}

/** Get the player's attention if the tab is hidden; does nothing while they are looking. */
export function callAttention(title: string, body: string): void {
  if (!document.hidden) return;
  stop();
  baseTitle = document.title;
  let on = true;
  blink = setInterval(() => {
    on = !on;
    document.title = on ? `🔔 ${title}` : baseTitle;
  }, 900);
  document.title = `🔔 ${title}`;
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      note = new Notification(title, { body, icon: '/favicon.svg', tag: 'cardcraft-castles-turn', renotify: true, requireInteraction: false } as NotificationOptions);
      note.onclick = () => {
        window.focus();
        stop();
      };
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the title still blinks.
  }
}
