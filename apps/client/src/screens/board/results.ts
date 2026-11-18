import { getHero, type PlayerId, type PlayerView } from '@cardcraft-castles/engine';
import { h } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { audio } from '../../fx/audio';
import type { MatchSession, Presence } from '../../game/session';
import type { MatchStats } from '../../game/stats';
import { artUrl } from '../../ui/assets';
import { heroCss } from '../../ui/theme';

export interface ResultsOptions {
  host: HTMLElement;
  session: MatchSession;
  view: PlayerView;
  stats: MatchStats;
  seatSide: (seat: PlayerId) => 0 | 1;
  name: (seat: PlayerId) => string;
  onExit: () => void;
  getPresence: () => Presence | null;
}

/** End of game: victory or defeat banner, why it ended, match statistics and what next. */
export function showResults(o: ResultsOptions): void {
  const result = o.view.result!;
  const winner = result.winner;
  const shared = o.session.kind === 'local';
  let outcome: 'victory' | 'defeat' | 'draw';
  if (winner === null) outcome = 'draw';
  else if (shared) outcome = 'victory';
  else outcome = o.session.isLocal(winner) ? 'victory' : 'defeat';

  const title = winner === null ? t('draw') : shared ? t('winsTitle', { who: o.name(winner) }) : t(outcome);
  const loser = winner === null ? null : ((1 - winner) as PlayerId);
  const reason = (() => {
    switch (result.reason) {
      case 'keepBuilt':
        return winner !== null ? t('reasonKeepBuilt', { who: o.name(winner) }) : '';
      case 'keepDestroyed':
        return loser !== null ? t('reasonKeepDestroyed', { who: o.name(loser) }) : '';
      case 'concede':
        return loser !== null ? t('reasonConcede', { who: o.name(loser) }) : '';
      case 'turnLimit':
        return t('reasonTurnLimit');
    }
  })();

  const seats: PlayerId[] = o.seatSide(0) === 0 ? [0, 1] : [1, 0];
  const row = (label: string, value: (seat: PlayerId) => number | string): HTMLElement =>
    h('tr', null, h('td', null, String(value(seats[0]))), h('th', { scope: 'row' }, label), h('td', null, String(value(seats[1]))));

  const rematchBtn = h('button.btn.primary.big', { type: 'button' }, t('rematch'));
  const rematchNote = h('p.rematch-note');
  rematchBtn.addEventListener('click', () => {
    audio.play('uiClick');
    o.session.rematch();
    if (o.session.kind === 'online') {
      rematchBtn.disabled = true;
      rematchNote.textContent = t('waitingOpponent', { who: o.name(seats[1]) });
    }
  });

  const hideBtn = h('button.btn.ghost', { type: 'button' }, t('viewBoard'));
  const box = h(
    'div.results-box.panel',
    { class: outcome },
    h('div.results-crest', null, h('h1', null, title), h('p', null, reason)),
    h(
      'div.results-heroes',
      null,
      seats.map((seat) =>
        h(
          'div.results-hero',
          { class: seat === winner ? 'winner' : '', style: `--hero:${heroCss(o.view.players[seat].hero)}` },
          h('img', { src: artUrl(getHero(o.view.players[seat].hero).art), alt: '' }),
          h('strong', null, o.name(seat)),
          h('small', null, L(getHero(o.view.players[seat].hero).name)),
        ),
      ),
    ),
    h(
      'table.results-stats',
      null,
      h(
        'tbody',
        null,
        row(t('statTurns'), () => o.stats.turns || o.view.turn),
        row(t('statDamage'), (s) => o.stats.players[s].damageDealt),
        row(t('statBuilt'), (s) => o.stats.players[s].built),
        row(t('statBest'), (s) => o.stats.players[s].biggestHit),
        row(t('statCards'), (s) => o.stats.players[s].cardsPlayed),
        row(t('statUltimates'), (s) => o.stats.players[s].ultimates),
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

  // Online: show when the opponent wants a rematch.
  if (o.session.kind === 'online') {
    const timer = setInterval(() => {
      if (!wrap.isConnected) return clearInterval(timer);
      const presence = o.getPresence();
      const opp = presence?.seats[seats[1]];
      if (opp?.left) {
        rematchBtn.disabled = true;
        rematchNote.textContent = t('connectionLost');
      } else if (opp?.wantsRematch && !rematchBtn.disabled) {
        rematchNote.textContent = `${o.name(seats[1])}: ${t('rematch')}?`;
      }
    }, 500);
  }
}
