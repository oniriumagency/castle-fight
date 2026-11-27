import type { HeroId } from '@cardcraft-castles/engine';
import {
  RANKED_RULES,
  tierOf,
  type RankedLeaderboard,
  type RankedPlayer,
  type RankedProfile,
  type RankedSearcher,
  type RankedTier,
} from '@cardcraft-castles/protocol';
import type { RankedConnection, RankedQueueState } from '@cardcraft-castles/protocol/client';
import { copyText } from '../app/platform';
import { h, html, toast } from '../app/dom';
import { locale, t, type StringKey } from '../app/i18n';
import { setScreenName } from '../app/reportContext';
import { modal, show, type Screen } from '../app/router';
import { battlefield } from '../app/stage';
import { audio } from '../fx/audio';
import { online } from '../net/online';
import { iconSvg } from '../ui/assets';
import { muteButton } from '../ui/muteButton';
import { flow, nickname } from './flow';

const TIER_KEYS: Record<RankedTier, StringKey> = {
  bronze: 'tierBronze',
  silver: 'tierSilver',
  gold: 'tierGold',
  diamond: 'tierDiamond',
  legend: 'tierLegend',
};

export function tierName(rating: number): string {
  return t(TIER_KEYS[tierOf(rating)]);
}

export function tierBadge(rating: number): HTMLElement {
  return h('span.tier-badge', { class: `tier-${tierOf(rating)}` }, tierName(rating));
}

function fullName(p: Pick<RankedPlayer, 'nickname' | 'tag'>): HTMLElement {
  return h('span.ranked-name', null, p.nickname, h('small', null, `#${p.tag}`));
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

function stakesText(stakes: RankedSearcher['stakes']): string {
  return stakes ? t('rankedStakes', { win: stakes.win, loss: signed(stakes.loss) }) : t('rankedUnrated');
}

/** The recovery code of this browser's profile, and a field to use one from another device. */
export function openRecoveryCode(connection: RankedConnection): void {
  audio.play('uiClick');
  modal((close) => {
    const code = connection.recoveryCode;
    const input = h('input', { type: 'text', maxlength: 40, autocomplete: 'off', spellcheck: false, placeholder: 'ABCD-EFGH-…' });
    const use = (): void => {
      if (!connection.useRecoveryCode(input.value)) {
        toast(t('rankedCodeInvalid'), 'warn', 4000);
        audio.play('error');
        return;
      }
      const offError = connection.on('error', ({ code: why }) => {
        if (why !== 'unknownProfile') return;
        offError();
        offProfile();
        toast(t('rankedCodeUnknown'), 'warn', 4000);
        audio.play('error');
      });
      const offProfile = connection.on('profile', (profile) => {
        if (!profile) return;
        offError();
        offProfile();
        toast(t('rankedCodeLoaded'), 'info', 3000);
        close();
      });
    };
    return h(
      'div.modal.panel.ranked-code',
      null,
      h('h2', null, t('rankedCode')),
      h('p', null, code ? t('rankedCodeHint') : t('rankedCodeNone')),
      code
        ? h(
            'div.invite',
            null,
            h('code.ranked-code-value', { 'aria-label': t('rankedCode') }, code),
            h(
              'button.btn.primary',
              {
                type: 'button',
                onclick: async () => {
                  audio.play('uiClick');
                  if (await copyText(code)) toast(t('campaignCodeCopied'));
                  else toast(code, 'info', 8000);
                },
              },
              html(iconSvg('link')),
              t('copyCode'),
            ),
          )
        : null,
      h('div.ornament', null, t('rankedUseCode')),
      h('div.invite', null, input, h('button.btn', { type: 'button', onclick: use }, t('rankedUseCodeBtn'))),
    );
  });
}

/**
 * The ranked side of the online screen: your profile and league, the button
 * to search, and the season's leaderboard.
 */
export function rankedPanel(nickInput: HTMLInputElement, requireNickname: (input: HTMLInputElement) => string | null) {
  let connection: RankedConnection | null = null;
  let profile: RankedProfile | null = null;
  let known = false;
  let board: RankedLeaderboard | null = null;
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;

  const card = h('div.ranked-profile');
  const list = h('ol.ranked-board', { 'aria-live': 'polite' });
  const boardHead = h('div.lobby-rooms-head', null, h('h2', null, t('rankedTitle')), h('p.lobby-stats'));
  const searchBtn = h('button.btn.primary.big', { type: 'button' }, html(iconSvg('sword')), t('rankedSearch'));

  const renderCard = (): void => {
    if (!known) {
      card.replaceChildren(h('div.lobby-empty', null, h('span.spinner'), t('rankedConnecting')));
      return;
    }
    if (!profile) {
      card.replaceChildren(h('div.ranked-rating', null, tierBadge(RANKED_RULES.startRating), h('strong', null, String(RANKED_RULES.startRating))), h('p.ranked-note', null, t('rankedNoProfile')));
      return;
    }
    const calibrating = profile.games < RANKED_RULES.provisionalGames;
    const wait = profile.cooldownUntil ? Math.ceil((profile.cooldownUntil - Date.now()) / 1000) : 0;
    card.replaceChildren(
      h('div.ranked-who', null, fullName(profile)),
      h('div.ranked-rating', { class: `tier-${tierOf(profile.rating)}` }, tierBadge(profile.rating), h('strong', null, String(profile.rating))),
      h('p.ranked-note', null, t('rankedRecord', { w: profile.wins, l: profile.losses })),
      calibrating
        ? h('p.ranked-note.calibrating', null, t('rankedCalibrating', { n: profile.games, total: RANKED_RULES.provisionalGames }))
        : h('p.ranked-note', null, t('rankedPeak', { n: profile.peak })),
      ...(wait > 0 ? [h('p.ranked-note.warn', null, t('rankedCooldown', { s: wait }))] : []),
    );
    searchBtn.disabled = wait > 0;
  };

  const renderBoard = (): void => {
    const stats = boardHead.querySelector('.lobby-stats')!;
    if (!board) {
      boardHead.querySelector('h2')!.textContent = t('rankedTitle');
      stats.textContent = '';
      list.replaceChildren();
      return;
    }
    boardHead.querySelector('h2')!.textContent = t('rankedLeaderboard', { n: board.season });
    const date = new Date(board.endsAt - 1).toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
    stats.textContent = t('rankedSeasonEnds', { date });
    if (board.players.length === 0) {
      list.replaceChildren(h('li.lobby-empty', null, t('rankedLeaderboardEmpty')));
      return;
    }
    list.replaceChildren(
      ...board.players.map((p, i) =>
        h(
          'li.ranked-row',
          { class: p.id === profile?.id ? 'me' : '' },
          h('span.ranked-pos', null, String(i + 1)),
          fullName(p),
          tierBadge(p.rating),
          h('strong.ranked-points', null, String(p.rating)),
        ),
      ),
    );
  };

  searchBtn.addEventListener('click', () => {
    if (!requireNickname(nickInput)) return;
    audio.play('uiClick');
    flow.heroSelect('ranked');
  });

  const el = h(
    'div.lobby-body.ranked-body',
    null,
    h('section.lobby-rooms.panel', null, boardHead, list),
    h(
      'aside.lobby-side.panel',
      null,
      h('label.field', null, t('nickname'), nickInput),
      card,
      searchBtn,
      h('p.ranked-note.center', null, t('rankedRules')),
      h('button.btn.ghost', { type: 'button', onclick: () => connection && openRecoveryCode(connection) }, html(iconSvg('link')), t('rankedCode')),
    ),
  );

  return {
    el,
    mount(): void {
      renderCard();
      renderBoard();
      connection = online.connectRanked();
      connection.on('profile', (next) => {
        // The first answer to each hello: ask for the leaderboard too.
        if (!known) connection!.requestTop();
        profile = next;
        known = true;
        renderCard();
        renderBoard();
      });
      connection.on('top', (next) => {
        board = next;
        renderBoard();
      });
      connection.on('status', (status) => {
        if (status === 'reconnecting') known = false;
      });
      cooldownTimer = setInterval(() => {
        if (profile?.cooldownUntil) renderCard();
      }, 1000);
    },
    unmount(): void {
      connection?.close();
      connection = null;
      if (cooldownTimer) clearInterval(cooldownTimer);
    },
  };
}

/** Searching for a ranked game with `hero`: the widening window, who else searches, challenges both ways. */
export function rankedSearch(hero: HeroId | 'random'): void {
  setScreenName('rankedSearch');
  show(rankedSearchScreen(hero));
}

function rankedSearchScreen(hero: HeroId | 'random'): Screen {
  const connection = online.connectRanked();
  let queue: RankedQueueState = connection.queue;
  let sent: string | null = null;
  let matched = false;
  let closeChallenge: (() => void) | null = null;
  const offs: (() => void)[] = [];

  const el = h('div.waiting-screen.ranked-search');
  const clock = h('strong.ranked-clock', null, '0:00');
  const windowLine = h('p.ranked-note');
  const countLine = h('p.ranked-note');
  const others = h('div.ranked-others');

  const render = (): void => {
    windowLine.textContent = t('rankedWindow', { n: queue.window || RANKED_RULES.windowStart });
    countLine.textContent = queue.count > 0 ? t('rankedInQueue', { n: queue.count }) : '';
    if (!queue.challengesOpen) {
      others.replaceChildren(h('p.ranked-note', null, t('rankedWidening')));
      return;
    }
    others.replaceChildren(
      h('div.ornament', null, t('rankedOthers')),
      queue.players.length === 0
        ? h('p.ranked-note', null, t('rankedOthersEmpty'))
        : h(
            'ul.ranked-searchers',
            null,
            ...queue.players.map((p) =>
              h(
                'li.ranked-row',
                null,
                fullName(p),
                tierBadge(p.rating),
                h('strong.ranked-points', null, String(p.rating)),
                h('small.ranked-stakes', { title: p.stakes ? '' : t('rankedUnratedHint') }, stakesText(p.stakes)),
                h(
                  'button.btn.primary',
                  {
                    type: 'button',
                    disabled: !p.challengeable || sent === p.id,
                    onclick: () => {
                      audio.play('uiClick');
                      sent = p.id;
                      connection.challenge(p.id);
                      render();
                    },
                  },
                  !p.challengeable ? t('rankedTooFar') : sent === p.id ? t('rankedChallengeSent') : t('rankedChallenge'),
                ),
              ),
            ),
          ),
    );
  };

  const tick = (): void => {
    const since = queue.since ?? Date.now();
    const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const leave = (): void => {
    audio.play('uiBack');
    connection.cancel();
    flow.lobby('ranked');
  };

  el.append(
    h('div.waiting-tools', null, muteButton()),
    h(
      'div.waiting-box.panel',
      null,
      h('h1', null, t('rankedSearching')),
      h('div.spinner.big'),
      clock,
      windowLine,
      countLine,
      others,
      h('p.ranked-note', null, t('rankedRules')),
      h('button.btn', { type: 'button', onclick: leave }, t('cancel')),
    ),
  );

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    el,
    mount() {
      battlefield().layout();
      render();
      timer = setInterval(tick, 500);
      offs.push(
        connection.on('queue', (next) => {
          queue = next;
          if (sent && !next.players.some((p) => p.id === sent)) sent = null;
          render();
          tick();
        }),
        connection.on('challengeEnded', ({ target, reason }) => {
          if (target !== sent) return;
          sent = null;
          toast(reason === 'declined' ? t('rankedDeclined') : reason === 'expired' ? t('rankedExpired') : t('rankedGone'), 'info', 3000);
          render();
        }),
        connection.on('challenged', ({ from, expiresAt }) => {
          closeChallenge?.();
          audio.play('emote');
          const countdown = h('span.ranked-note');
          const step = setInterval(() => {
            const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
            countdown.textContent = `${left} s`;
            if (left <= 0) closeChallenge?.();
          }, 250);
          const answer = (accept: boolean): void => {
            audio.play(accept ? 'uiClick' : 'uiBack');
            connection.answer(from.id, accept);
            closeChallenge?.();
          };
          const close = modal(
            () =>
              h(
                'div.modal.panel.ranked-challenge',
                null,
                h('h2', null, t('rankedChallenged', { who: from.nickname })),
                h('div.ranked-row', null, fullName(from), tierBadge(from.rating), h('strong.ranked-points', null, String(from.rating))),
                h('p', null, stakesText(from.stakes)),
                countdown,
                h(
                  'div.row',
                  null,
                  h('button.btn.primary.big', { type: 'button', onclick: () => answer(true) }, t('rankedAccept')),
                  h('button.btn', { type: 'button', onclick: () => answer(false) }, t('rankedDecline')),
                ),
              ),
            { dismissable: false },
          );
          closeChallenge = () => {
            clearInterval(step);
            close();
            closeChallenge = null;
          };
        }),
        connection.on('challengeWithdrawn', () => closeChallenge?.()),
        connection.on('error', ({ code, message }) => {
          if (code === 'cooldown' || code === 'busy' || code === 'rateLimited' || code === 'outdated') {
            toast(code === 'busy' ? t('rankedBusy') : code === 'cooldown' ? t('rankedNoShow') : message, 'warn', 4000);
            audio.play('error');
            flow.lobby('ranked');
          }
        }),
        connection.on('matched', (match) => {
          matched = true;
          closeChallenge?.();
          audio.play('mapSelect');
          toast(`${t('rankedFound')} ${match.opponent.nickname}#${match.opponent.tag} · ${stakesText(match.stakes)}`, 'info', 4000);
          void import('./online').then((m) => m.joinOnline(match.roomId, hero, match.ticket));
        }),
      );
      // Sent now if connected, otherwise right after the hello once the socket opens.
      connection.search(nickname(), hero);
    },
    unmount() {
      if (timer) clearInterval(timer);
      closeChallenge?.();
      for (const off of offs) off();
      if (!matched) connection.cancel();
      connection.close();
    },
  };
}
