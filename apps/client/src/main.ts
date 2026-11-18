/**
 * Cardcraft: Castles client. A PixiJS battlefield behind a DOM interface:
 * menus, lobby, hero select, the game table and results. Games run locally
 * (against the AI or two players on one device) or online through the
 * server SDK.
 */
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

import { toast } from './app/dom';
import { t } from './app/i18n';
import { settings } from './app/settings';
import { initStage } from './app/stage';
import { online, roomIdFromUrl } from './net/online';
import { flow } from './screens/flow';
import { joinOnline } from './screens/online';

function applyDocumentSettings(): void {
  const s = settings.get();
  document.documentElement.lang = s.locale;
  document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
}

async function boot(): Promise<void> {
  applyDocumentSettings();
  settings.subscribe(applyDocumentSettings);
  await initStage();

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
        flow.heroSelect('online', roomId);
        return;
      }
      toast(t('connectionLost'), 'warn', 4000);
    } catch {
      toast(t('lobbyOffline'), 'warn', 5000);
    }
  }
  flow.menu();
}

void boot();
