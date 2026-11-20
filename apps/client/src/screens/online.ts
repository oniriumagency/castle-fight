import type { HeroId } from '@cardcraft-castles/engine';
import type { RoomInfo } from '@cardcraft-castles/protocol';
import { turnNotificationOffer } from '../app/attention';
import { h, html, toast } from '../app/dom';
import { t } from '../app/i18n';
import { setScreenName } from '../app/reportContext';
import { modal, show, type Screen } from '../app/router';
import { battlefield } from '../app/stage';
import { audio } from '../fx/audio';
import { OnlineSession, online } from '../net/online';
import { iconSvg } from '../ui/assets';
import { muteButton } from '../ui/muteButton';
import { openHowToPlay } from './howToPlay';
import { openSettings } from './settingsModal';
import { flow, nickname, setRoomInUrl } from './flow';

/**
 * Takes a seat in an online room and waits for the opponent. The board
 * opens with the first game state; if this browser already had a seat there
 * (reload, dropped connection) the SDK resumes it and the board opens at once.
 */
export function joinOnline(roomId: string, hero: HeroId | 'random'): void {
  setRoomInUrl(roomId);
  const connection = online.joinRoom(roomId, { nickname: nickname(), hero });
  const session = new OnlineSession(connection);
  let opened = false;

  const offState = connection.on('state', () => {
    if (opened) return;
    opened = true;
    cleanup();
    // Duels and free-for-all rooms share the board; it sizes itself to the seats.
    flow.board(session);
  });
  const offClosed = connection.on('closed', ({ reason, message }) => {
    if (opened) return;
    cleanup();
    // Someone took the last seat first: watch the game instead.
    if (reason === 'roomFull') {
      toast(t('watchingFullRoom'), 'info', 4000);
      watchOnline(roomId);
      return;
    }
    toast(message || t('connectionLost'), 'warn', 4000);
    audio.play('error');
    flow.lobby();
  });
  const cleanup = (): void => {
    offState();
    offClosed();
  };

  setScreenName('onlineWaiting');
  show(waitingScreen(session, () => {
    cleanup();
    session.leave();
    flow.lobby();
  }));
}

/**
 * Watches a full room's game without a seat. The server sends a spectator's
 * view (no hand, ever), and the board opens in observer mode with it.
 */
export function watchOnline(roomId: string): void {
  setRoomInUrl(roomId);
  const connection = online.spectateRoom(roomId);
  const session = new OnlineSession(connection);
  let opened = false;

  const offState = connection.on('state', () => {
    if (opened) return;
    opened = true;
    cleanup();
    flow.board(session);
  });
  const offError = connection.on('error', ({ code }) => {
    if (code === 'tooManySpectators') toast(t('tooManySpectators'), 'warn', 4000);
  });
  const offClosed = connection.on('closed', ({ message }) => {
    if (opened) return;
    cleanup();
    toast(message || t('connectionLost'), 'warn', 4000);
    audio.play('error');
    flow.lobby();
  });
  const cleanup = (): void => {
    offState();
    offError();
    offClosed();
  };

  // A room still waiting (someone left before it filled): wait for its game.
  setScreenName('onlineWatching');
  show(waitingScreen(session, () => {
    cleanup();
    session.leave();
    flow.lobby();
  }, true));
}

function waitingScreen(session: OnlineSession, cancel: () => void, watching = false): Screen {
  const el = h('div.waiting-screen');
  const seatsBox = h('div.waiting-seats');
  const link = online.inviteUrl(session.connection.roomId);

  const renderSeats = (room: RoomInfo | null): void => {
    const seats = room?.seats ?? [null, null];
    seatsBox.replaceChildren(
      ...seats.map((seat) =>
        h(
          'div.waiting-seat',
          { class: seat ? 'taken' : 'free' },
          h('span.seat-dot'),
          seat ? seat.nickname : t('waitingTitle'),
        ),
      ),
    );
  };

  const leave = (): void => {
    audio.play('uiBack');
    cancel();
  };

  // The same menu and sound controls as on the board, so a long wait can still be set up.
  const openMenu = (): void => {
    audio.play('uiClick');
    modal((close) =>
      h(
        'div.modal.panel.game-menu',
        null,
        h('h2', null, t('menu')),
        h('button.btn.big', { type: 'button', onclick: () => close() }, t('keepWaiting')),
        h('button.btn', { type: 'button', onclick: () => (close(), openSettings()) }, html(iconSvg('gear')), t('settings')),
        h('button.btn', { type: 'button', onclick: () => (close(), openHowToPlay()) }, html(iconSvg('book')), t('howToPlay')),
        h('button.btn.danger', { type: 'button', onclick: () => (close(), leave()) }, t('leaveRoom')),
      ),
    );
  };

  el.append(
    h(
      'div.waiting-tools',
      null,
      h('button.btn.icon-only.menu-btn', { type: 'button', 'aria-label': t('menu'), onclick: openMenu }, html(iconSvg('menu'))),
      muteButton(),
    ),
    h(
      'div.waiting-box.panel',
      null,
      h('h1', null, watching ? t('watchingWaitTitle') : t('waitingTitle')),
      h('div.spinner.big'),
      seatsBox,
      h('p', null, t('waitingHint')),
      h(
        'div.invite',
        null,
        h('input', { type: 'text', readonly: true, value: link, 'aria-label': t('copyLink'), onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: async () => {
              audio.play('uiClick');
              try {
                if (navigator.share && matchMedia('(hover: none)').matches) {
                  await navigator.share({ url: link, title: 'Cardcraft: Castles' });
                } else {
                  await navigator.clipboard.writeText(link);
                  toast(t('copied'));
                }
              } catch {
                // The user closed the share sheet.
              }
            },
          },
          html(iconSvg('link')),
          t('copyLink'),
        ),
      ),
      turnNotificationOffer(),
      h('button.btn', { type: 'button', onclick: leave }, t('leaveRoom')),
    ),
  );

  let off = (): void => {};
  return {
    el,
    mount() {
      battlefield().layout();
      renderSeats(session.room);
      off = session.connection.on('room', (room) => renderSeats(room));
    },
    unmount() {
      off();
    },
  };
}
