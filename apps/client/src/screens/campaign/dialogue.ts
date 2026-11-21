import { getHero } from '@cardcraft-castles/engine';
import { PERSONAS, getKingdom, type Line } from '@cardcraft-castles/campaign';
import { append, h } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { audio } from '../../fx/audio';
import { artUrl } from '../../ui/assets';
import { heroCss } from '../../ui/theme';

/** Catalog path of a captain's portrait (one per kingdom); the hero's art stands in until it is painted. */
export function captainArt(kingdom: string): string {
  return `captains/${kingdom}.jpg`;
}

function portrait(path: string, fallback: string): HTMLImageElement {
  const img = h('img', { src: artUrl(path), alt: '', draggable: 'false' }) as HTMLImageElement;
  if (path !== fallback) img.addEventListener('error', () => (img.src = artUrl(fallback)), { once: true });
  return img;
}

function speakerOf(line: Line): { name: string; sub: string; art: HTMLImageElement | null; color: string } {
  const s = line.speaker;
  if ('hero' in s) {
    const persona = PERSONAS[s.hero];
    const hero = getHero(s.hero);
    return { name: persona?.name ?? L(hero.name), sub: L(hero.name), art: portrait(hero.art, hero.art), color: heroCss(s.hero) };
  }
  if ('captain' in s) {
    const kingdom = getKingdom(s.kingdom);
    const heroArt = getHero(kingdom.hero).art;
    return { name: s.captain, sub: t('campaignCaptainOf', { kingdom: L(kingdom.name) }), art: portrait(captainArt(s.kingdom), heroArt), color: heroCss(kingdom.hero) };
  }
  return { name: '', sub: '', art: null, color: 'var(--gold)' };
}

/**
 * Plays a short scene over whatever is on screen: one line at a time with the
 * speaker's portrait. A tap, click, Enter or Space moves on; Skip ends it.
 */
/** Story paintings shown behind a scene (`art/campaign/`); a missing one leaves the usual dark backdrop. */
export const SCENE_ART = {
  prologue: 'campaign/prologo.jpg',
  crown: 'campaign/corona.jpg',
  epilogue: 'campaign/epilogo.jpg',
} as const;

/** Board portrait of a hero possessed by the Twilight in the final battle; the hero's own art stands in. */
export function possessedArt(hero: string): string {
  return `heroes/${hero}-ocaso.jpg`;
}

export function playDialogue(lines: readonly Line[], backdrop?: string): Promise<void> {
  if (!lines.length) return Promise.resolve();
  return new Promise((resolve) => {
    const overlay = document.getElementById('overlay')!;
    let index = -1;
    const box = h('div.dialogue-box.panel');
    const skip = h('button.btn.ghost.dialogue-skip', { type: 'button' }, t('dialogueSkip'));
    const layer = h('div.dialogue-layer', { role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite' }, box, skip);
    if (backdrop) {
      const art = h('img.dialogue-scene', { src: artUrl(backdrop), alt: '', draggable: 'false' }) as HTMLImageElement;
      art.addEventListener('load', () => layer.classList.add('has-scene'), { once: true });
      art.addEventListener('error', () => art.remove(), { once: true });
      layer.prepend(art);
    }

    const finish = (): void => {
      window.removeEventListener('keydown', onKey, true);
      layer.classList.remove('in');
      setTimeout(() => layer.remove(), 260);
      resolve();
    };
    const next = (): void => {
      index++;
      if (index >= lines.length) return finish();
      audio.play('uiClick');
      const line = lines[index]!;
      const who = speakerOf(line);
      box.className = `dialogue-box panel${who.art ? '' : ' narrator'}`;
      box.style.setProperty('--hero', who.color);
      box.replaceChildren();
      append(
        box,
        [who.art ? h('div.dialogue-portrait', null, who.art) : null,
        h(
          'div.dialogue-body',
          null,
          who.name ? h('div.dialogue-who', null, h('strong', null, who.name), h('small', null, who.sub)) : null,
          h('p.dialogue-text', null, L(line.text)),
          h('div.dialogue-next', null, index < lines.length - 1 ? `${t('dialogueNext')} ›` : `${t('close')} ›`),
        )],
      );
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
    };
    layer.addEventListener('click', (e) => {
      if (e.target === skip) return;
      next();
    });
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.play('uiBack');
      finish();
    });
    window.addEventListener('keydown', onKey, true);
    overlay.appendChild(layer);
    next();
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('in')));
  });
}
