import { HEROES, type HeroId } from '@cardcraft-castles/engine';
import { INVITE_PARAM } from '@cardcraft-castles/protocol';
import { toast } from '../app/dom';
import { t } from '../app/i18n';
import { show } from '../app/router';
import { settings } from '../app/settings';
import type { Difficulty } from '../game/ai';
import { LocalSession } from '../game/localSession';
import type { MatchSession } from '../game/session';
import type { OnlineSession } from '../net/online';
import { boardScreen } from './board/board';
import { ffaScreen } from './ffa';
import { heroSelectScreen, type HeroSelectMode } from './heroSelect';
import { lobbyScreen } from './lobby';
import { menuScreen } from './menu';

export function randomHero(except?: HeroId): HeroId {
  const pool = HEROES.map((h) => h.id).filter((id) => id !== except);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function nickname(fallback = t('player1')): string {
  return settings.get().nickname.trim() || fallback;
}

/**
 * Keeps `?room=<id>` in the address bar while the player is in an online
 * room, so reloading the page goes straight back to that room (and seat).
 */
export function setRoomInUrl(roomId: string | null): void {
  const url = new URL(location.href);
  if ((url.searchParams.get(INVITE_PARAM) ?? null) === roomId) return;
  if (roomId) url.searchParams.set(INVITE_PARAM, roomId);
  else url.searchParams.delete(INVITE_PARAM);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Navigation between screens. Screens call these instead of importing each other. */
export const flow = {
  menu(): void {
    setRoomInUrl(null);
    show(menuScreen());
  },

  lobby(): void {
    setRoomInUrl(null);
    show(lobbyScreen());
  },

  heroSelect(mode: HeroSelectMode, roomId?: string): void {
    setRoomInUrl(mode === 'online' && roomId ? roomId : null);
    show(heroSelectScreen(mode, roomId));
  },

  startAi(hero: HeroId, opponent: HeroId | 'random', difficulty: Difficulty): void {
    setRoomInUrl(null);
    const level = t(difficulty);
    const session = new LocalSession({
      kind: 'ai',
      difficulty,
      seats: [
        { nickname: nickname(t('you')), hero },
        { nickname: t('aiName', { level }), hero: opponent === 'random' ? randomHero(hero) : opponent, isAi: true },
      ],
    });
    flow.board(session);
  },

  startLocal(heroes: [HeroId, HeroId]): void {
    setRoomInUrl(null);
    const session = new LocalSession({
      kind: 'local',
      seats: [
        { nickname: nickname(t('player1')), hero: heroes[0] },
        { nickname: t('player2'), hero: heroes[1] },
      ],
    });
    flow.board(session);
  },

  /** Free-for-all prototype: you against two AIs. */
  ffa(): void {
    setRoomInUrl(null);
    show(ffaScreen());
  },

  /** A free-for-all game in an online room. */
  ffaOnline(session: OnlineSession): void {
    show(ffaScreen(session));
  },

  /** Back into the unfinished game saved on this device. False when there is none. */
  resumeLocal(): boolean {
    const session = LocalSession.resume();
    if (!session) return false;
    setRoomInUrl(null);
    flow.board(session);
    toast(t('gameRestored'), 'info', 2600);
    return true;
  },

  board(session: MatchSession): void {
    show(boardScreen(session));
  },
};
