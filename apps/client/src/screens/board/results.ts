import { getHero, type PlayerId, type PlayerView } from '@cardcraft-castles/engine';
import { callAttention } from '../../app/attention';
import { h, html } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { audio } from '../../fx/audio';
import type { MatchSession, Presence } from '../../game/session';
import { gamesOf, loadRecord, nemesisOf, recordAi, recordOnline, type Outcome } from '../../game/record';
import type { MatchStats } from '../../game/stats';
import { artUrl, iconSvg } from '../../ui/assets';
import { heroCss } from '../../ui/theme';

export interface ResultsOptions {
  host: HTMLElement;
  session: MatchSession;
  view: PlayerView;
  stats: MatchStats;
  /** Seats in screen order: the player first, then the rivals. */
  seatsBySide: PlayerId[];
  /** Free-for-all: the player's castle fell while the rivals play on (the game is not over). */
  fallen?: boolean;
  name: (seat: PlayerId) => string;
  onExit: () => void;
  getPresence: () => Presence | null;
}

/**
 * Adds the game to the player's win/loss record (online and against the AI)
 * and, online, returns the running score against this opponent.
 */
function keepRecord(o: ResultsOptions, opponent: PlayerId, outcome: 'victory' | 'defeat' | 'draw'): HTMLElement | null {
  const result: Outcome = outcome === 'victory' ? 'win' : outcome === 'defeat' ? 'loss' : 'draw';
  if (o.session.kind === 'ai') {
    recordAi(result);
    return null;
  }
  const id = o.session.kind === 'online' ? o.session.gameId?.() : null;
  if (!id) return null;
  const seat = o.session.seats[opponent];
  const rival = recordOnline({ id, outcome: result, rival: { pid: seat.pid ?? null, name: o.name(opponent) } });
  if (!rival) return null;
  const isNemesis = nemesisOf(loadRecord())?.key === rival.key;
  const games = gamesOf(rival);
  return h(
    'div.results-h2h',
    { class: isNemesis ? 'nemesis' : '' },
    isNemesis ? h('span.nemesis-badge', null, html(iconSvg('sword')), t('nemesisBadge')) : null,
    h('span.h2h-label', null, t('headToHead', { who: o.name(opponent) })),
    h(
      'span.h2h-score',
      null,
      h('span.win', null, String(rival.wins)),
      h('span.sep', null, '–'),
      h('span.loss', null, String(rival.losses)),
    ),
    h('small', null, games === 1 ? t('headToHeadFirst') : t('headToHeadGames', { n: games })),
  );
}

/** End of game: victory or defeat banner, why it ended, match statistics and what next. */
export function showResults(o: ResultsOptions): void {
  const result = o.view.result ?? { winner: null, reason: 'keepDestroyed' as const };
  const winner = o.fallen ? null : result.winner;
  const shared = o.session.kind === 'local';
  const seats = o.seatsBySide;
  const multi = seats.length > 2;
  let outcome: 'victory' | 'defeat' | 'draw';
  if (o.fallen) outcome = 'defeat';
  else if (winner === null) outcome = 'draw';
  else if (shared) outcome = 'victory';
  else outcome = o.session.isLocal(winner) ? 'victory' : 'defeat';

  const title = o.fallen ? t('defeat') : winner === null ? t('draw') : shared ? t('winsTitle', { who: o.name(winner) }) : t(outcome);
  const loser = winner === null || multi ? null : seats.find((s) => s !== winner)!;
  const reason = (() => {
    if (o.fallen) return t('reasonYouFell');
    if (multi && winner !== null && result.reason !== 'keepBuilt') return t('reasonLastStanding', { who: o.name(winner) });
    switch (result.reason) {
      case 'keepBuilt':
        return winner !== null ? t('reasonKeepBuilt', { who: o.name(winner) }) : '';
      case 'keepDestroyed':
        return loser !== null ? t('reasonKeepDestroyed', { who: o.name(loser) }) : '';
      case 'concede':
        return loser !== null ? t('reasonConcede', { who: o.name(loser) }) : '';
      case 'turnLimit':
        return t('reasonTurnLimit');
      case 'twilight':
        return t('reasonTwilight');
    }
  })();

  // The win/loss record and head-to-head count duels only.
  const headToHead = multi ? null : keepRecord(o, seats[1], outcome);
  const row = (label: string, value: (seat: PlayerId) => number | string): HTMLElement =>
    multi
      ? h('tr', null, h('th', { scope: 'row' }, label), seats.map((seat) => h('td', null, String(value(seat)))))
      : h('tr', null, h('td', null, String(value(seats[0]))), h('th', { scope: 'row' }, label), h('td', null, String(value(seats[1]))));
  const stat = (seat: PlayerId) => o.stats.players[seat] ?? { damageDealt: 0, built: 0, biggestHit: 0, cardsPlayed: 0, ultimates: 0 };

  const rematchBtn = h('button.btn.primary.big', { type: 'button' }, t('rematch'));
  const rematchNote = h('p.rematch-note');
  rematchBtn.addEventListener('click', () => {
    audio.play('uiClick');
    o.session.rematch();
    if (o.session.kind === 'online') {
      rematchBtn.disabled = true;
      rematchNote.textContent = multi ? t('waitingOthers') : t('waitingOpponent', { who: o.name(seats[1]) });
    }
  });

  const hideBtn = h('button.btn.ghost', { type: 'button' }, t('viewBoard'));
  const box = h(
    'div.results-box.panel',
    { class: `${outcome}${multi ? ' multi' : ''}` },
    h('div.results-crest', null, h('h1', null, title), h('p', null, reason)),
    h(
      'div.results-heroes',
      null,
      seats.map((seat) =>
        h(
          'div.results-hero',
          { class: seat === winner ? 'winner' : o.view.players[seat].eliminated ? 'fallen' : '', style: `--hero:${heroCss(o.view.players[seat].hero)}` },
          h('img', { src: artUrl(getHero(o.view.players[seat].hero).art), alt: '' }),
          h('strong', null, o.name(seat)),
          h('small', null, L(getHero(o.view.players[seat].hero).name)),
        ),
      ),
    ),
    headToHead,
    h(
      'table.results-stats',
      null,
      h(
        'tbody',
        null,
        row(t('statTurns'), () => o.stats.turns || o.view.turn),
        row(t('statDamage'), (s) => stat(s).damageDealt),
        row(t('statBuilt'), (s) => stat(s).built),
        row(t('statBest'), (s) => stat(s).biggestHit),
        row(t('statCards'), (s) => stat(s).cardsPlayed),
        row(t('statUltimates'), (s) => stat(s).ultimates),
      ),
    ),
    rematchNote,
    h(
      'div.results-actions',
      null,
      rematchBtn,
      h('button.btn.big', { type: 'button', onclick: () => (audio.play('uiBack'), o.onExit()) }, o.session.kind === 'online' ? t('back') : t('mainMenu')),
      hideBtn,
    ),
  );
  const wrap = h('div.results', { class: outcome }, box);
  hideBtn.addEventListener('click', () => {
    wrap.classList.toggle('peek');
    hideBtn.textContent = wrap.classList.contains('peek') ? t('back') : t('viewBoard');
  });
  o.host.appendChild(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('in')));

  // Online: when the opponent asks for a rematch, say so loud and clear (even with the board in view or the tab in the background).
  if (o.session.kind === 'online') {
    let announced = false;
    const timer = setInterval(() => {
      if (!wrap.isConnected) return clearInterval(timer);
      const presence = o.getPresence();
      // Free-for-all: everyone else must stay; the first one asking is announced.
      const others = seats.slice(1).map((seat) => ({ seat, p: presence?.seats[seat] ?? null }));
      const asker = others.find((x) => x.p?.wantsRematch);
      const opp = { left: others.some((x) => x.p?.left), wantsRematch: !!asker };
      if (opp.left) {
        rematchBtn.disabled = true;
        rematchBtn.classList.remove('accept');
        rematchNote.classList.remove('request');
        rematchNote.textContent = t('connectionLost');
      } else if (opp.wantsRematch && !rematchBtn.disabled && !announced) {
        announced = true;
        const message = t('rematchRequested', { who: o.name(asker!.seat) });
        rematchNote.replaceChildren(html(iconSvg('sword')), h('span', null, message));
        rematchNote.classList.add('request');
        rematchBtn.textContent = t('acceptRematch');
        rematchBtn.classList.add('accept');
        audio.play('emote');
        callAttention(`⚔ ${message}`, t('acceptRematchHint'));
      } else if (!opp.wantsRematch && announced && !rematchBtn.disabled) {
        // The opponent took it back (left the results): back to the plain button.
        announced = false;
        rematchNote.replaceChildren();
        rematchNote.classList.remove('request');
        rematchBtn.textContent = t('rematch');
        rematchBtn.classList.remove('accept');
      }
    }, 500);
  }
}
