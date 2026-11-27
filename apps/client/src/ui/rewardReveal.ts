import { getCard, RARITY_NAMES, type CardId, type Rarity } from '@cardcraft-castles/engine';
import { h } from '../app/dom';
import { L, t } from '../app/i18n';
import { settings } from '../app/settings';
import { audio } from '../fx/audio';
import { cardBack, cardFace } from './card';
import { attachCardZoom } from './cardZoom';

/**
 * Campaign rewards dealt face down: the player taps each card to claim it.
 * It glows, bursts with light and turns over. The rarer the card, the longer
 * it charges and the bigger the burst, always in its rarity's colour
 * (common warm white, rare blue, epic purple, legendary gold, Divine white and sky blue).
 */

const COLOR: Record<Rarity, string> = { comun: '#fff0d0', rara: '#7fc4ff', epica: '#b06cff', legendaria: '#ffb52e', divina: '#9ff3ff' };
const LIGHT: Record<Rarity, string> = { comun: '#ffffff', rara: '#d8f0ff', epica: '#f0d8ff', legendaria: '#fff2c0', divina: '#ffffff' };

/** How the reveal builds up, by rarity. */
const STYLE: Record<Rarity, { charge: number; sparks: number; reach: number; rays: boolean; flash: number }> = {
  comun: { charge: 260, sparks: 14, reach: 0.9, rays: false, flash: 0 },
  rara: { charge: 480, sparks: 24, reach: 1.25, rays: false, flash: 0 },
  epica: { charge: 760, sparks: 36, reach: 1.6, rays: true, flash: 0.18 },
  legendaria: { charge: 1150, sparks: 56, reach: 2.1, rays: true, flash: 0.42 },
  divina: { charge: 1700, sparks: 84, reach: 2.6, rays: true, flash: 0.6 },
};

const REVEAL_SOUND: Record<Rarity, () => void> = {
  comun: () => audio.play('cardPlay', 0.4),
  rara: () => audio.play('rarityRara', 0.6),
  epica: () => audio.play('rarityEpica'),
  legendaria: () => {
    audio.play('rarityLegendaria');
    audio.duck(0.35, 1800);
  },
  divina: () => {
    audio.play('rarityLegendaria');
    audio.play('conquestBig', 0.7, { delay: 150 });
    audio.duck(0.3, 2600);
  },
};

const calm = (): boolean => settings.get().reducedMotion;

/** Light thrown out of the card as it turns: flash, rings, rays and sparks, over everything and never in the way. */
function burst(slot: HTMLElement, rarity: Rarity): void {
  const r = slot.getBoundingClientRect();
  const s = STYLE[rarity];
  const size = Math.max(r.width, r.height);
  const layer = h('div.reward-burst', {
    class: `r-${rarity}`,
    'aria-hidden': 'true',
    style: `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--rc:${COLOR[rarity]};--rl:${LIGHT[rarity]};--size:${size}px`,
  });
  layer.append(h('span.rb-flash'), h('span.rb-ring'));
  if (rarity !== 'comun') layer.append(h('span.rb-ring.late'));
  if (s.rays) layer.append(h('span.rb-rays'));
  for (let i = 0; i < s.sparks; i++) {
    const a = (i / s.sparks) * Math.PI * 2 + Math.random() * 0.4;
    const d = size * s.reach * (0.45 + Math.random() * 0.55);
    layer.append(
      h('span.rb-spark', {
        style: `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--s:${3 + Math.random() * (rarity === 'legendaria' || rarity === 'divina' ? 6 : 4)}px;--t:${650 + Math.random() * 650}ms;--c:${i % 3 ? COLOR[rarity] : LIGHT[rarity]}`,
      }),
    );
  }
  document.body.append(layer);
  if (s.flash) {
    const flash = h('div.reward-screen-flash', { 'aria-hidden': 'true', style: `--rc:${COLOR[rarity]};--a:${s.flash}` });
    document.body.append(flash);
    setTimeout(() => flash.remove(), 900);
  }
  setTimeout(() => layer.remove(), 2200);
}

export interface RewardReveal {
  el: HTMLElement;
}

/** The face-down rewards. `onDone` runs once every card is turned over. */
export function rewardReveal(ids: readonly CardId[], onDone: () => void): RewardReveal {
  const title = h('h3.reward-title', null, t('campaignClaimTitle'));
  const hint = h('small.campaign-zoom-hint.reward-hint', null, t('campaignClaimHint'));
  let left = ids.length;

  const slots = ids.map((id, i) => {
    const rarity = getCard(id).rarity;
    const face = cardFace(id, { calm: true });
    const slot = h(
      'div.reward-slot',
      {
        class: `r-${rarity}`,
        role: 'button',
        tabindex: 0,
        'aria-label': t('campaignClaimCard'),
        style: `--rc:${COLOR[rarity]};--rl:${LIGHT[rarity]};--i:${i}`,
      },
      h('div.reward-aura', { 'aria-hidden': 'true' }),
      h('div.reward-flip', null, h('div.reward-side.back-side', null, cardBack()), h('div.reward-side.face-side', null, face)),
      h('span.reward-rarity', null, L(RARITY_NAMES[rarity])),
    );
    let state: 'hidden' | 'charging' | 'shown' = 'hidden';

    const reveal = (): void => {
      if (state !== 'hidden') return;
      state = 'charging';
      slot.classList.add('charging');
      slot.removeAttribute('tabindex');
      slot.removeAttribute('role');
      slot.removeAttribute('aria-label');
      audio.play('cardSelect');
      if (rarity === 'epica' || rarity === 'legendaria' || rarity === 'divina') audio.play('uiOpen', 0.5, { delay: 80 });
      const charge = calm() ? 0 : STYLE[rarity].charge;
      setTimeout(() => {
        state = 'shown';
        slot.classList.remove('charging');
        slot.classList.add('revealed');
        REVEAL_SOUND[rarity]();
        audio.play('cardDraw', 0.5, { delay: 40 });
        if (!calm()) {
          burst(slot, rarity);
          if ((rarity === 'legendaria' || rarity === 'divina') && settings.get().screenShake) {
            const box = slot.closest<HTMLElement>('.results-box');
            box?.classList.add('reward-quake');
            setTimeout(() => box?.classList.remove('reward-quake'), 520);
          }
        }
        // Once turned (and the burst has settled), the card reads like any other: hover or tap to zoom.
        setTimeout(() => attachCardZoom(face, id), calm() ? 0 : 900);
        left--;
        if (left === 0) {
          setTimeout(
            () => {
              title.textContent = t('campaignNewCards');
              hint.textContent = t('campaignZoomHint');
              slot.closest('.campaign-summary')?.classList.add('claimed');
              onDone();
            },
            calm() ? 0 : 750,
          );
        }
      }, charge);
    };

    slot.addEventListener('click', reveal);
    slot.addEventListener('keydown', (e) => {
      if (state === 'hidden' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        reveal();
      }
    });
    slot.addEventListener('pointerenter', () => state === 'hidden' && audio.play('cardHover'));
    return slot;
  });

  return { el: h('div.reward-claim', null, title, h('div.campaign-cards.reward-cards', null, slots), hint) };
}
