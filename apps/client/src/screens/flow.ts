import { HEROES, type HeroId } from '@cardcraft-castles/engine';
import { t } from '../app/i18n';
import { show } from '../app/router';
import { settings } from '../app/settings';
import type { Difficulty } from '../game/ai';
import { LocalSession } from '../game/localSession';
import type { MatchSession } from '../game/session';
import { boardScreen } from './board/board';
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

/** Navigation between screens. Screens call these instead of importing each other. */
export const flow = {
  menu(): void {
    show(menuScreen());
  },

  lobby(): void {
    show(lobbyScreen());
  },

  heroSelect(mode: HeroSelectMode, roomId?: string): void {
    show(heroSelectScreen(mode, roomId));
  },

  startAi(hero: HeroId, opponent: HeroId | 'random', difficulty: Difficulty): void {
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
    const session = new LocalSession({
      kind: 'local',
      seats: [
        { nickname: nickname(t('player1')), hero: heroes[0] },
        { nickname: t('player2'), hero: heroes[1] },
      ],
    });
    flow.board(session);
  },

  board(session: MatchSession): void {
    show(boardScreen(session));
  },
};
