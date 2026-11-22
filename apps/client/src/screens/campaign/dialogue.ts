import { getHero } from '@cardcraft-castles/engine';
import { PERSONAS, TERRITORIES, getKingdom, type Line } from '@cardcraft-castles/campaign';
import { append, h } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { audio, voiceOf } from '../../fx/audio';
import { artUrl, faceImg } from '../../ui/assets';
import { heroCss } from '../../ui/theme';

/** Where a captain stands guard, found by name. */
function captainPost(name: string): (typeof TERRITORIES)[number] | undefined {
  return TERRITORIES.find((x) => x.captain?.name === name);
}

/** Catalog path of a captain's portrait: one per captain, named after the territory they hold (`captains/bastion-b.jpg`). */
export function captainArt(name: string): string {
  return `captains/${captainPost(name)?.id ?? 'unknown'}.jpg`;
}

/** "Capitán · Bastión Azur", or "Capitana" for a woman. */
export function captainTitle(name: string, kingdom: string): string {
  return t(captainPost(name)?.captain?.female ? 'campaignCaptainaOf' : 'campaignCaptainOf', { kingdom });
}

function portrait(path: string, fallback: string): HTMLImageElement {
  return faceImg(path, fallback);
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
    return { name: s.captain, sub: captainTitle(s.captain, L(kingdom.name)), art: portrait(captainArt(s.captain), heroArt), color: heroCss(kingdom.hero) };
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
    // A comic: its lines carry their own paintings, which fade from one to the next.
    const panels = lines.filter((l) => l.scene).length;
    let shown = '';
    let panelIndex = -1;
    const dots = panels > 1 ? h('div.dialogue-progress', null, ...lines.filter((l) => l.scene).map(() => h('i'))) : null;
    if (panels) {
      layer.classList.add('comic', 'has-scene');
      if (dots) layer.append(dots);
    }
    const showScene = (scene: NonNullable<Line['scene']>): void => {
      if (scene.art === shown) return;
      shown = scene.art;
      panelIndex++;
      dots?.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= panelIndex));
      const img = h('img.dialogue-scene', { alt: '', draggable: 'false' }) as HTMLImageElement;
      const chain = [scene.art, scene.fallback].filter((x): x is string => !!x);
      let step = 0;
      img.addEventListener('error', () => {
        step++;
        if (step < chain.length) img.src = artUrl(chain[step]!);
        else img.remove();
      });
      img.addEventListener('load', () => {
        layer.querySelectorAll('.dialogue-scene.on').forEach((old) => {
          old.classList.remove('on');
          setTimeout(() => old.remove(), 900);
        });
        requestAnimationFrame(() => img.classList.add('on'));
      });
      img.src = artUrl(chain[0]!);
      layer.prepend(img);
    };
    if (backdrop && !panels) {
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
      const line = lines[index]!;
      // A new painting turns the page; otherwise the speaker's voice, or a soft blip for the narrator.
      const sp = line.speaker;
      if (line.scene && line.scene.art !== shown) audio.play('pageTurn');
      else if ('hero' in sp) audio.play(voiceOf(sp.hero), 0.5, { gain: 0.8 });
      else if ('captain' in sp) audio.play(voiceOf(null), 0.5, { gain: 0.8 });
      else audio.play('dialogueBlip');
      if (line.scene) showScene(line.scene);
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
