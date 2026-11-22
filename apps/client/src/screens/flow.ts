import { tutorial } from '../game/tutorial';
import { HEROES, type HeroId } from '@cardcraft-castles/engine';
import { INVITE_PARAM } from '@cardcraft-castles/protocol';
import { toast } from '../app/dom';
import { t } from '../app/i18n';
import { setScreenName } from '../app/reportContext';
import { show } from '../app/router';
import { settings } from '../app/settings';
import type { Difficulty } from '../game/ai';
import { loadCampaign, startCampaign } from '../game/campaignStore';
import { LocalSession, type CampaignBattle } from '../game/localSession';
import type { MatchSession, Seat } from '../game/session';
import type { BattleOutcome } from '@cardcraft-castles/campaign';
import { campaignScreen } from './campaign/map';
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
    // The menu opens once the first enemy hero falls in the campaign.
    if (!tutorial.menuOpen()) return flow.firstRun();
    setRoomInUrl(null);
    setScreenName('menu');
    show(menuScreen());
  },

  lobby(): void {
    setRoomInUrl(null);
    setScreenName('lobby');
    show(lobbyScreen());
  },

  heroSelect(mode: HeroSelectMode, roomId?: string): void {
    setRoomInUrl(mode === 'online' && roomId ? roomId : null);
    setScreenName(`heroSelect (${mode})`);
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

  /** Free-for-all against two AIs: pick a hero and a level first. */
  ffa(): void {
    flow.heroSelect('ffa');
  },

  /** You against two AIs with random heroes, on the full board. */
  startFfa(hero: HeroId, difficulty: Difficulty): void {
    setRoomInUrl(null);
    const level = t(difficulty);
    const first = randomHero(hero);
    const second = randomHero(first);
    const session = new LocalSession({
      kind: 'ai',
      difficulty,
      seats: [
        { nickname: nickname(t('you')), hero },
        { nickname: t('ffaAiName', { n: 1, level }), hero: first, isAi: true },
        { nickname: t('ffaAiName', { n: 2, level }), hero: second, isAi: true },
      ],
    });
    flow.board(session);
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

  /** The campaign map (or its start screen), with the scenes that follow `outcome` when coming back from a battle. */
  campaign(outcome: BattleOutcome | null = null, retry = false): void {
    setRoomInUrl(null);
    setScreenName('campaign');
    show(campaignScreen(outcome, retry));
  },

  /** First start of the game: a new campaign (normal difficulty), its opening comic and the guide. */
  firstRun(): void {
    if (!loadCampaign()) startCampaign('normal');
    flow.campaign();
  },

  startCampaignBattle(battle: CampaignBattle, rivals: Seat[]): void {
    setRoomInUrl(null);
    const session = new LocalSession({
      kind: 'ai',
      difficulty: 'normal',
      campaign: battle,
      seats: [{ nickname: nickname(t('you')), hero: battle.setup.heroes[0]! }, ...rivals],
    });
    flow.board(session);
  },

  board(session: MatchSession): void {
    setScreenName('board');
    show(boardScreen(session));
  },
};
