import { h } from './dom';
import { t } from './i18n';
import { EMBEDDED } from './platform';

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

function permission(): NotificationPermission | null {
  try {
    // Browsers refuse to ask for notifications from another site's frame (itch.io).
    if (EMBEDDED) return null;
    return 'Notification' in window ? Notification.permission : null;
  } catch {
    return null;
  }
}

/**
 * The offer to call the player back on their turn, for the online screens:
 * "Shall we let you know when it is your turn?" with a button that opens the
 * browser's own permission prompt. Once allowed it says so; when the browser
 * does not support it, or the player blocked it, it is not shown at all.
 */
export function turnNotificationOffer(): HTMLElement {
  const row = h('div.notify-offer');
  const render = (): void => {
    const state = permission();
    if (state === 'granted') {
      row.hidden = false;
      row.replaceChildren(h('span.notify-on', null, t('notifyOn')));
    } else if (state === 'default') {
      row.hidden = false;
      row.replaceChildren(
        h('span', null, t('notifyAsk')),
        h(
          'button.btn.small',
          {
            type: 'button',
            onclick: async () => {
              try {
                await Notification.requestPermission();
              } catch {
                // Not supported after all: the blinking title still works.
              }
              render();
            },
          },
          t('notifyYes'),
        ),
      );
    } else {
      row.hidden = true;
    }
  };
  render();
  return row;
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
      note = new Notification(title, { body, icon: `${import.meta.env.BASE_URL}favicon.svg`, tag: 'cardcraft-castles-turn', renotify: true, requireInteraction: false } as NotificationOptions);
      note.onclick = () => {
        window.focus();
        stop();
      };
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the title still blinks.
  }
}
