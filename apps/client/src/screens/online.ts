import type { HeroId } from '@cardcraft-castles/engine';
import type { RoomInfo } from '@cardcraft-castles/protocol';
import { h, html, toast } from '../app/dom';
import { t } from '../app/i18n';
import { show, type Screen } from '../app/router';
import { battlefield } from '../app/stage';
import { audio } from '../fx/audio';
import { OnlineSession, online } from '../net/online';
import { iconSvg } from '../ui/assets';
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

  const offState = connection.on('state', ({ view }) => {
    if (opened) return;
    opened = true;
    cleanup();
    // Free-for-all rooms play on their own board.
    if (view.players.length > 2) flow.ffaOnline(session);
    else flow.board(session);
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
    offClosed();
  };

  show(waitingScreen(session, () => {
    cleanup();
    session.leave();
    flow.lobby();
  }));
}

function waitingScreen(session: OnlineSession, cancel: () => void): Screen {
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

  el.append(
    h(
      'div.waiting-box.panel',
      null,
      h('h1', null, t('waitingTitle')),
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
      h('button.btn', { type: 'button', onclick: () => (audio.play('uiBack'), cancel()) }, t('leaveRoom')),
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
