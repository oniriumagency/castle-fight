import {
  DEFAULT_RULES,
  RARITY_NAMES,
  SCHOOL_NAMES,
  TERMS,
  getBattleEvent,
  getCard,
  getHero,
  type BattleEventId,
  type CardId,
  type HeroId,
  type LocalizedText,
} from '@cardcraft-castles/engine';
import { escapeHtml, h } from '../app/dom';
import { L, locale } from '../app/i18n';
import { settings } from '../app/settings';
import { SCHOOL_EMBLEM, artUrl, emblemSvg } from './assets';

/**
 * Card faces drawn in DOM/CSS, following the approved frame design: metal
 * trim by rarity, body colour by school, arched illustration, name plate,
 * school · rarity line, parchment rules box, cost shield with the resource
 * icon, rarity gem and a holographic sheen on rare and better cards.
 */

/** Words that are bold in rules text, with the explanation shown when a card is inspected. */
const GLOSSARY: { words: LocalizedText; text: LocalizedText }[] = [
  {
    words: { es: 'Torreón|Torreones', en: 'Keep|Keeps' },
    text: {
      es: `Tu vida. Llega a ${DEFAULT_RULES.keepWin} para ganar; si cae a 0, pierdes.`,
      en: `Your life. Reach ${DEFAULT_RULES.keepWin} to win; if it drops to 0, you lose.`,
    },
  },
  {
    words: { es: 'Muralla|Murallas', en: 'Wall|Walls' },
    text: { es: 'Recibe el daño normal antes que el Torreón.', en: 'Takes normal damage before your Keep.' },
  },
  {
    words: { es: 'perforante', en: 'piercing' },
    text: { es: 'Ignora la Muralla y golpea directamente el Torreón.', en: 'Ignores the Wall and hits the Keep directly.' },
  },
  {
    words: { es: 'Encantamiento', en: 'Enchantment' },
    text: {
      es: 'Se queda en mesa los turnos indicados. Máximo 2 por jugador: uno nuevo sustituye al más antiguo.',
      en: 'Stays on the table for the turns shown. Up to 2 per player: a new one replaces the oldest.',
    },
  },
  {
    words: { es: 'Escudo', en: 'Shield' },
    text: { es: 'Cada carga bloquea un ataque entero. No caduca.', en: 'Each charge blocks one whole attack. It does not expire.' },
  },
  {
    words: { es: 'Quemadura', en: 'Burn' },
    text: { es: '2 de daño al inicio de cada turno del jugador quemado.', en: '2 damage at the start of each of the burned player’s turns.' },
  },
  {
    words: { es: 'Escarcha', en: 'Frost' },
    text: { es: 'El recurso congelado no produce mientras dure.', en: 'The frozen resource does not produce while it lasts.' },
  },
  {
    words: { es: 'Combo', en: 'Combo' },
    text: {
      es: 'Bonificación si la última carta que jugaste es de la misma escuela. Descartar rompe la cadena.',
      en: 'Bonus if the last card you played is from the same school. Discarding breaks the chain.',
    },
  },
  {
    words: { es: 'Pasiva', en: 'Passive' },
    text: { es: 'Siempre activa durante la partida.', en: 'Always active during the game.' },
  },
  {
    words: { es: 'Definitiva', en: 'Ultimate' },
    text: {
      es: 'Se carga con el daño que recibes. Usarla no gasta tu jugada del turno.',
      en: 'Charges with the damage you take. Using it does not spend your play.',
    },
  },
];

function keywordPattern(): RegExp {
  const words = GLOSSARY.flatMap((g) => L(g.words).split('|'));
  return new RegExp(`(${words.join('|')})`, 'g');
}

/** Rules text as HTML with keywords in bold. */
export function rulesHtml(text: string): string {
  const combo = L(TERMS.combo);
  return (
    escapeHtml(text)
      .replace(keywordPattern(), (word) => (word === combo ? `<b class="kw-combo">${word}</b>` : `<b>${word}</b>`))
      // The conditional sentence ("If ..., stronger effect."), lit up when the condition holds.
      .replace(/(?<=^|\. )((?:Si|If) [^.]*\.)/g, '<span class="kw-cond">$1</span>')
  );
}

/** Explanations for the keywords a text uses, for the inspect view. */
export function glossaryFor(text: string): { word: string; text: string }[] {
  const found: { word: string; text: string }[] = [];
  for (const entry of GLOSSARY) {
    const words = L(entry.words).split('|');
    const hit = words.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(text) || text.includes(w));
    if (hit) found.push({ word: words[0], text: L(entry.text) });
  }
  return found;
}

export interface CardOptions {
  /** Effective cost now; highlighted when it differs from the printed cost. */
  cost?: number;
  /** Extra classes (`playable`, `blocked`, `combo`...). */
  className?: string;
  /** Interactive 3D tilt and moving sheen under the pointer. */
  tilt?: boolean;
  /** Lazy-load the image (cards far down a list). */
  lazy?: boolean;
  /** No pulsing ember glow on legendaries (small or many cards on screen). */
  calm?: boolean;
}

function frame(classes: string, opts: CardOptions): HTMLDivElement {
  const ember = !opts.calm && !settings.get().reducedMotion ? ' ember' : '';
  const el = h('div', { class: `card ${classes}${ember} ${opts.className ?? ''}` });
  if (opts.tilt && !settings.get().reducedMotion) addTilt(el);
  return el;
}

export function cardFace(cardId: CardId, opts: CardOptions = {}): HTMLDivElement {
  const card = getCard(cardId);
  const el = frame(`face s-${card.school} r-${card.rarity}`, opts);
  el.dataset.cardId = cardId;
  const cost = opts.cost ?? card.cost;
  const costClass = cost < card.cost ? 'down' : cost > card.cost ? 'up' : '';
  el.innerHTML = `
    <div class="trim"><div class="body">
      <div class="art"><img alt="" draggable="false" ${opts.lazy ? 'loading="lazy"' : ''} src="${artUrl(card.art)}"></div>
      <div class="type">${escapeHtml(L(SCHOOL_NAMES[card.school]))} · ${escapeHtml(L(RARITY_NAMES[card.rarity]))}</div>
      <div class="rules"><span>${rulesHtml(L(card.text))}</span></div>
    </div></div>
    <div class="name"><i class="tl"></i><i class="tr"></i><b>${escapeHtml(L(card.name))}</b></div>
    <div class="cost ${costClass}"><span>${cost}</span>${emblemSvg(SCHOOL_EMBLEM[card.school])}</div>
    <div class="gem"></div>
    <div class="holo"></div>`;
  // Cards whose illustration is not painted yet show a plain school-coloured panel.
  el.querySelector('.art img')?.addEventListener('error', () => el.classList.add('no-art'), { once: true });
  el.setAttribute('aria-label', `${L(card.name)}. ${cost}. ${L(card.text)}`);
  fitName(el);
  return el;
}

/** Hero texts read "Passive: … Ultimate: …"; split them for the hero frame. */
export function heroParts(heroId: HeroId): { passive: string; ultimate: string } {
  const text = L(getHero(heroId).text);
  const match = /^[^:]+:\s*(.*?)\s*(?:Definitiva|Ultimate):\s*(.*)$/s.exec(text);
  return match ? { passive: match[1], ultimate: match[2] } : { passive: text, ultimate: '' };
}

export function heroCard(heroId: HeroId, opts: CardOptions = {}): HTMLDivElement {
  const hero = getHero(heroId);
  const el = frame('face s-heroe hero-card', opts);
  el.dataset.heroId = heroId;
  const { passive, ultimate } = heroParts(heroId);
  const labels = locale() === 'es' ? ['Pasiva', 'Definitiva'] : ['Passive', 'Ultimate'];
  el.innerHTML = `
    <div class="trim"><div class="body">
      <div class="art"><img alt="" draggable="false" src="${artUrl(hero.art)}"></div>
      <div class="type">${locale() === 'es' ? 'Héroe' : 'Hero'}</div>
      <div class="rules hero-rules">
        <p><b>${labels[0]}:</b> ${rulesHtml(passive)}</p>
        <p><b>${labels[1]}:</b> ${rulesHtml(ultimate)}</p>
      </div>
    </div></div>
    <div class="name"><i class="tl"></i><i class="tr"></i><b>${escapeHtml(L(hero.name))}</b></div>
    <div class="cost solo">${emblemSvg('hero')}</div>
    <div class="gem"></div>
    <div class="holo"></div>`;
  el.setAttribute('aria-label', `${L(hero.name)}. ${L(hero.text)}`);
  fitName(el);
  return el;
}

export function eventCard(eventId: BattleEventId, opts: CardOptions = {}): HTMLDivElement {
  const ev = getBattleEvent(eventId);
  const el = frame('face s-evento event-card', opts);
  el.innerHTML = `
    <div class="trim"><div class="body">
      <div class="art"><img alt="" draggable="false" src="${artUrl(ev.art)}"></div>
      <div class="type">${locale() === 'es' ? 'Evento de batalla' : 'Battle event'}</div>
      <div class="rules"><span>${rulesHtml(L(ev.text))}</span></div>
    </div></div>
    <div class="name"><i class="tl"></i><i class="tr"></i><b>${escapeHtml(L(ev.name))}</b></div>
    <div class="holo"></div>`;
  fitName(el);
  return el;
}

const EMBLEM = `<svg class="emblem" viewBox="0 0 120 150" fill="none" stroke="#e3b656" stroke-width="2.5" stroke-linejoin="round"><path d="M60 4l52 71-52 71L8 75z"/><path d="M60 22l38 53-38 53-38-53z" stroke-width="1.2"/><path d="M42 104V62h-5V46h8v6h7v-6h16v6h7v-6h8v16h-5v42z" fill="#e3b656" fill-opacity=".18"/><path d="M54 104V88a6 6 0 0112 0v16"/><path d="M60 46V30l12 5-12 5"/></svg>`;

export function cardBack(opts: CardOptions = {}): HTMLDivElement {
  const el = frame('back', { ...opts, calm: true });
  el.innerHTML = `<div class="trim"><div class="body"><div class="inner"></div>${EMBLEM}</div></div><div class="holo"></div>`;
  return el;
}

/** Long names get a smaller font so they stay on one line; long rules text too (in compact cards). */
function fitName(el: HTMLElement): void {
  const name = el.querySelector('.name b')?.textContent ?? '';
  if (name.length > 20) el.classList.add('long-name');
  else if (name.length > 15) el.classList.add('mid-name');
  const rules = el.querySelector('.rules')?.textContent?.trim() ?? '';
  if (rules.length > 95) el.classList.add('long-rules');
  else if (rules.length > 60) el.classList.add('mid-rules');
}

/** Tilt and sheen that follow the pointer, as in the frame preview. */
export function addTilt(el: HTMLElement): void {
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
    el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
    el.style.setProperty('--hx', `${100 - x * 100}%`);
  });
  el.addEventListener('pointerleave', () => {
    el.style.removeProperty('--ry');
    el.style.removeProperty('--rx');
    el.style.removeProperty('--hx');
  });
}
