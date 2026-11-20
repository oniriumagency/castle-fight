/**
 * Cardcraft: Castles client. A PixiJS battlefield behind a DOM interface:
 * menus, lobby, hero select, the game table and results. Games run locally
 * (against the AI or two players on one device) or online through the
 * server SDK.
 */
// First: large screens zoom the page before anything measures it.
import './app/uiScale';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/700.css';
import '@fontsource/eb-garamond/500-italic.css';
import '@fontsource/grenze-gotisch/800.css';
import './styles/base.css';
import './styles/card.css';
import './styles/screens.css';
import './styles/board.css';
import './styles/materials.css';

import { toast } from './app/dom';
import { t } from './app/i18n';
import { initErrorReporting } from './app/errorReport';
import { initInstall } from './app/install';
import { initLandscapeOnly } from './app/orientation';
import { settings } from './app/settings';
import { battlefield, initStage } from './app/stage';
import { audio } from './fx/audio';
import { fx } from './fx/director';
import { online, roomIdFromUrl } from './net/online';
import { flow } from './screens/flow';
import { joinOnline, watchOnline } from './screens/online';
import { initFeedback } from './ui/feedback';
import { toggleMute } from './ui/muteButton';

function applyDocumentSettings(): void {
  const s = settings.get();
  document.documentElement.lang = s.locale;
  document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
}

async function boot(): Promise<void> {
  applyDocumentSettings();
  settings.subscribe(applyDocumentSettings);
  initErrorReporting();
  initInstall();
  initLandscapeOnly();
  await initStage();
  initFeedback();
  // Development only: drive effects and sounds from the console.
  if (import.meta.env.DEV) Object.assign(window, { __dev: { fx, audio, field: battlefield() } });
  // M mutes everywhere, except while typing.
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'm') toggleMute();
  });

  // Invite link: open the room straight away.
  const roomId = roomIdFromUrl(location.href);
  if (roomId) {
    try {
      if (online.hasSeat(roomId)) {
        // This browser already plays in that room (reload): take the seat back.
        joinOnline(roomId, 'random');
        return;
      }
      const room = await online.getRoom(roomId);
      if (room) {
        // A full room (or one already playing): watch it as an observer.
        if (room.status !== 'waiting' || room.players >= (room.size ?? 2)) {
          toast(t('watchingFullRoom'), 'info', 4000);
          watchOnline(roomId);
        } else flow.heroSelect('online', roomId);
        return;
      }
      toast(t('connectionLost'), 'warn', 4000);
    } catch {
      toast(t('lobbyOffline'), 'warn', 5000);
    }
  }
  // An unfinished game on this device (phone locked, tab reloaded hours later): straight back into it.
  if (!flow.resumeLocal()) flow.menu();
}

void boot();
