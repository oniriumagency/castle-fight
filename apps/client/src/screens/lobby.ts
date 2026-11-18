import { DEFAULT_TIMINGS, ROOM_SIZES, TURN_SECONDS_OPTIONS, UNLIMITED_TURN, type LobbyStats, type RoomSummary } from '@cardcraft-castles/protocol';
import type { LobbyConnection } from '@cardcraft-castles/protocol/client';
import { DEFAULT_RULES } from '@cardcraft-castles/engine';
import { h, html, toast } from '../app/dom';
import { t } from '../app/i18n';
import type { Screen } from '../app/router';
import { settings } from '../app/settings';
import { battlefield } from '../app/stage';
import { audio } from '../fx/audio';
import { online } from '../net/online';
import { iconSvg } from '../ui/assets';
import { flow } from './flow';
import { openTwilightInfo } from '../game/twilight';

/** Nickname for online play; asks for one if it is empty. */
export function requireNickname(input: HTMLInputElement): string | null {
  const value = input.value.trim().slice(0, 20);
  if (!value) {
    input.focus();
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 500);
    toast(t('nicknamePlaceholder'), 'warn');
    audio.play('error');
    return null;
  }
  settings.set({ nickname: value });
  return value;
}

const TURN_KEY = 'cardcraft-castles:turn-seconds';

function turnLabel(seconds: number): string {
  return seconds === UNLIMITED_TURN ? `∞ ${t('noTimeLimit').toLowerCase()}` : t('secondsShort', { n: seconds });
}

function storedTurnSeconds(): number {
  try {
    const raw = localStorage.getItem(TURN_KEY);
    const value = raw === null || raw === '' ? NaN : Number(raw);
    if ((TURN_SECONDS_OPTIONS as readonly number[]).includes(value)) return value;
  } catch {
    // Storage blocked.
  }
  return DEFAULT_TIMINGS.turnSeconds;
}

/** Live list of open rooms, with create and quick join. */
export function lobbyScreen(): Screen {
  let connection: LobbyConnection | null = null;
  let rooms: readonly RoomSummary[] = [];
  let stats: LobbyStats | null = null;
  let state: 'connecting' | 'online' | 'offline' = 'connecting';
  let busy = false;

  const el = h('div.lobby-screen');
  const list = h('div.room-list', { role: 'list', 'aria-live': 'polite' });
  const statsLine = h('p.lobby-stats');
  const nickname = h('input', { type: 'text', maxlength: 20, placeholder: t('nicknamePlaceholder'), value: settings.get().nickname });
  const roomName = h('input', { type: 'text', maxlength: 32, placeholder: t('roomNameDefault', { name: settings.get().nickname || '…' }) });
  const privateToggle = h('input', { type: 'checkbox' });
  // Twilight Fury: on by default every time; the host can turn it off for this room.
  const twilightToggle = h('input', { type: 'checkbox', checked: true });
  let turnSeconds = storedTurnSeconds();
  let roomSize = 2;
  const sizePicker = h('div.segmented.size-picker', { role: 'group', 'aria-label': t('roomSize') });
  const renderSizePicker = (): void => {
    sizePicker.replaceChildren(
      ...ROOM_SIZES.map((size) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(size === roomSize),
            onclick: () => {
              audio.play('uiClick');
              roomSize = size;
              renderSizePicker();
            },
          },
          size === 2 ? t('sizeDuel') : t('sizeFfa'),
        ),
      ),
    );
  };
  renderSizePicker();
  const turnPicker = h('div.segmented.turn-picker', { role: 'group', 'aria-label': t('turnTime') });
  const renderTurnPicker = (): void => {
    turnPicker.replaceChildren(
      ...TURN_SECONDS_OPTIONS.map((seconds) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(seconds === turnSeconds),
            'aria-label': seconds === UNLIMITED_TURN ? t('noTimeLimit') : t('secondsLong', { n: seconds }),
            title: seconds === UNLIMITED_TURN ? t('noTimeLimit') : t('secondsLong', { n: seconds }),
            onclick: () => {
              audio.play('uiClick');
              turnSeconds = seconds;
              try {
                localStorage.setItem(TURN_KEY, String(seconds));
              } catch {
                // Not critical.
              }
              renderTurnPicker();
            },
          },
          seconds === UNLIMITED_TURN ? h('span.inf', null, '∞') : t('secondsShort', { n: seconds }),
        ),
      ),
    );
  };
  renderTurnPicker();

  const statusText = (status: RoomSummary['status']): string =>
    status === 'waiting' ? t('roomWaiting') : status === 'playing' ? t('roomPlaying') : t('roomFinished');

  const renderList = (): void => {
    if (state === 'offline') {
      list.replaceChildren(
        h(
          'div.lobby-empty.offline',
          null,
          h('p', null, t('lobbyOffline')),
          h(
            'div.row',
            null,
            h('button.btn', { type: 'button', onclick: () => (audio.play('uiClick'), reconnect()) }, t('retry')),
            h('button.btn', { type: 'button', onclick: () => (audio.play('uiClick'), flow.heroSelect('ai')) }, t('playAi')),
          ),
        ),
      );
      return;
    }
    if (state === 'connecting') {
      list.replaceChildren(h('div.lobby-empty', null, h('span.spinner'), t('lobbyConnecting')));
      return;
    }
    if (rooms.length === 0) {
      list.replaceChildren(h('div.lobby-empty', null, t('lobbyEmpty')));
      return;
    }
    list.replaceChildren(
      ...rooms.map((room) =>
        h(
          'div.room',
          { role: 'listitem', class: `status-${room.status}` },
          h(
            'div.room-info',
            null,
            h('strong', null, room.name),
            h('small', null, t('hostedBy', { host: room.host }), ' · ', html(iconSvg('clock')), ' ', turnLabel(room.turnSeconds ?? DEFAULT_TIMINGS.turnSeconds), ...(room.twilight !== false ? [' · ', html(iconSvg('sunset')), ' ', t('twilightTag')] : [])),
          ),
          h('span.room-status', null, statusText(room.status)),
          h('span.room-players', null, html(iconSvg('users')), t('players', { n: room.players, max: room.size ?? 2 })),
          h(
            'button.btn.primary',
            {
              type: 'button',
              disabled: room.status !== 'waiting' || room.players >= (room.size ?? 2),
              onclick: () => {
                if (!requireNickname(nickname)) return;
                audio.play('uiClick');
                flow.heroSelect('online', room.id);
              },
            },
            room.status === 'waiting' && room.players < (room.size ?? 2) ? t('join') : t('watchFull'),
          ),
        ),
      ),
    );
  };

  const renderStats = (): void => {
    statsLine.textContent = stats
      ? `${stats.online} online · ${stats.waiting} ${t('roomWaiting').toLowerCase()} · ${stats.playing} ${t('roomPlaying').toLowerCase()}`
      : '';
  };

  const connect = (): void => {
    connection = online.connectLobby();
    connection.on('rooms', (next) => {
      rooms = next;
      state = 'online';
      renderList();
    });
    connection.on('stats', (next) => {
      stats = next;
      state = 'online';
      renderStats();
      renderList();
    });
    connection.on('status', (status) => {
      if (status === 'open') state = 'online';
      else if (status === 'reconnecting' && state !== 'online') state = 'offline';
      else if (status === 'closed') state = 'offline';
      renderList();
    });
  };

  const reconnect = (): void => {
    connection?.close();
    state = 'connecting';
    renderList();
    connect();
  };

  const create = async (): Promise<void> => {
    const nick = requireNickname(nickname);
    if (!nick || busy) return;
    busy = true;
    audio.play('uiClick');
    try {
      const room = await online.createRoom({
        nickname: nick,
        name: roomName.value.trim() || undefined,
        private: privateToggle.checked,
        turnSeconds,
        size: roomSize,
        twilight: twilightToggle.checked,
      });
      flow.heroSelect('online', room.id);
    } catch (error) {
      toast(t('serverError', { message: (error as Error).message }), 'warn', 4000);
      audio.play('error');
    } finally {
      busy = false;
    }
  };

  const quickJoin = async (): Promise<void> => {
    const nick = requireNickname(nickname);
    if (!nick || busy) return;
    busy = true;
    audio.play('uiClick');
    try {
      const { room } = await online.quickJoin({ nickname: nick });
      flow.heroSelect('online', room.id);
    } catch (error) {
      toast(t('serverError', { message: (error as Error).message }), 'warn', 4000);
      audio.play('error');
    } finally {
      busy = false;
    }
  };

  el.append(
    h(
      'header.screen-head',
      null,
      h('button.btn.icon-only', { type: 'button', 'aria-label': t('back'), onclick: () => (audio.play('uiBack'), flow.menu()) }, html(iconSvg('arrow'))),
      h('h1', null, t('playOnline')),
    ),
    h(
      'div.lobby-body',
      null,
      h(
        'section.lobby-rooms.panel',
        null,
        h('div.lobby-rooms-head', null, h('h2', null, t('lobbyTitle')), statsLine),
        list,
      ),
      h(
        'aside.lobby-side.panel',
        null,
        h('label.field', null, t('nickname'), nickname),
        h('button.btn.primary.big', { type: 'button', onclick: () => void quickJoin() }, html(iconSvg('sword')), t('quickJoin')),
        h('div.ornament', null, t('createRoom')),
        h('label.field', null, t('roomName'), roomName),
        h('div.field', null, h('span', null, t('roomSize')), sizePicker),
        h('div.field', null, h('span', null, t('turnTime')), turnPicker),
        h(
          'div.twilight-row',
          null,
          h(
            'label.check.twilight-toggle',
            null,
            twilightToggle,
            h('span', null, html(iconSvg('sunset')), ' ', t('twilightName'), h('small', null, t('twilightToggleHint', { start: DEFAULT_RULES.twilightTurn }))),
          ),
          h(
            'button.help-btn',
            {
              type: 'button',
              'aria-label': t('twilightHelp'),
              title: t('twilightHelp'),
              onclick: () => openTwilightInfo(DEFAULT_RULES),
            },
            '?',
          ),
        ),
        h('label.check', null, privateToggle, h('span', null, t('privateRoom'))),
        h('button.btn.big', { type: 'button', onclick: () => void create() }, t('createRoom')),
      ),
    ),
  );

  return {
    el,
    mount() {
      audio.music('menu');
      battlefield().layout();
      renderList();
      connect();
    },
    unmount() {
      connection?.close();
    },
    resize() {
      requestAnimationFrame(() => battlefield().layout());
    },
  };
}
