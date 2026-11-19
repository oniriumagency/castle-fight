import {
  DEFAULT_RULES,
  SCHOOL_NAMES,
  TERMS,
  getBattleEvent,
  getCard,
  getHero,
  type BattleEventId,
  type CardId,
  type EffectOp,
  type HeroId,
  type LocalizedText,
} from '@cardcraft-castles/engine';
import { escapeHtml, h, html } from '../app/dom';
import { L, locale } from '../app/i18n';
import { settings } from '../app/settings';
import { SCHOOL_EMBLEM, artUrl, emblemSvg, iconSvg, watchArt } from './assets';

/**
 * Card faces drawn in DOM/CSS, following the approved frame design: metal
 * trim by rarity, body colour by school, arched illustration, name plate,
 * school line, parchment rules box, cost shield with the resource
 * icon, rarity gem and a holographic sheen on rare and better cards.
 */

/** Words that are bold in rules text, with the explanation shown when a card is inspected. */
const GLOSSARY: { words: LocalizedText; text: LocalizedText }[] = [
  {
    words: { es: 'Castillo|Castillos', en: 'Castle|Castles' },
    text: {
      es: `Tu vida. Llega a ${DEFAULT_RULES.keepWin} para ganar; si cae a 0, pierdes.`,
      en: `Your life. Reach ${DEFAULT_RULES.keepWin} to win; if it drops to 0, you lose.`,
    },
  },
  {
    words: { es: 'Muralla|Murallas', en: 'Wall|Walls' },
    text: { es: 'Recibe el daño normal antes que el Castillo.', en: 'Takes normal damage before your Castle.' },
  },
  {
    words: { es: 'perforante', en: 'piercing' },
    text: { es: 'Ignora la Muralla y golpea directamente el Castillo.', en: 'Ignores the Wall and hits the Castle directly.' },
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

/** What a hero's passive adds to the numbers printed on cards. */
export function heroBuffs(heroId: HeroId): { attack: number; status: number } {
  const passive = getHero(heroId).passive;
  return { attack: passive.attackBonus ?? 0, status: passive.statusDurationBonus ?? 0 };
}

/** Attack amounts and Burn/Frost durations among a card's effects, to tell which printed numbers they are. */
/** Players at the table being shown: with 3+, cards read their free-for-all text. */
let tableSize = 2;

/** The board (or the free-for-all hero choice) sets this; card texts follow it. */
export function setTableSize(players: number): void {
  tableSize = players;
}

/** Rules text for the current table: in a free-for-all, "each rival" and the scaled numbers. */
export function rulesOf(def: { text: LocalizedText; textFfa?: LocalizedText }): string {
  return L(tableSize > 2 && def.textFfa ? def.textFfa : def.text);
}

/** An amount that lands on every rival at once in a free-for-all, as the engine scales it. */
function tableAmount(n: number): number {
  return tableSize > 2 ? Math.max(1, Math.round(n * DEFAULT_RULES.multiAllScale)) : n;
}

function effectNumbers(ops: readonly EffectOp[], out = { damage: new Set<number>(), status: new Set<number>() }) {
  for (const op of ops) {
    if (op.op === 'damage') out.damage.add(tableAmount(op.amount));
    else if (op.op === 'burn') out.status.add(tableAmount(op.turns));
    else if (op.op === 'frost') out.status.add(op.turns);
    else if (op.op === 'if') {
      effectNumbers(op.then, out);
      if (op.else) effectNumbers(op.else, out);
    }
  }
  return out;
}

// Markers around a buffed number, put in before escaping and turned into a span after.
const BUFF_OPEN = '\u0001';
const BUFF_CLOSE = '\u0002';

/**
 * Card text with what the player's hero adds to its numbers: "13 damage"
 * becomes "13+2 damage" for the Marshal, "for 4 turns" becomes "for 4+1
 * turns" for the Sorceress. Hits that are not single attacks
 * (per card discarded, Burn ticks) and other modifiers stay as printed.
 */
function buffText(ops: readonly EffectOp[], text: string, heroId: HeroId): string {
  const buffs = heroBuffs(heroId);
  if (!buffs.attack && !buffs.status) return text;
  const numbers = effectNumbers(ops);
  const mark = (n: number, bonus: number): string => `${n}${BUFF_OPEN}+${bonus}${BUFF_CLOSE}`;
  const es = locale() === 'es';
  let out = text;
  if (buffs.attack && numbers.damage.size) {
    const damage = es ? /(?<![+\d])(\d+)(?= de daño(?! menos| por))/g : /(?<![+\d])(\d+)(?= (?:piercing )?damage(?! per| for each))/g;
    out = out.replace(damage, (m) => (numbers.damage.has(Number(m)) ? mark(Number(m), buffs.attack) : m));
  }
  if (buffs.status && numbers.status.size) {
    const turns = es ? /(?<=durante )(\d+) turnos?/g : /(?<=for )(\d+) turns?/g;
    out = out.replace(turns, (m, n: string) => {
      if (!numbers.status.has(Number(n))) return m;
      const plural = es ? 'turnos' : 'turns';
      return `${mark(Number(n), buffs.status)} ${plural}`;
    });
  }
  return out;
}

function buffHtml(html: string): string {
  return html.replace(/\u0001([^\u0002]*)\u0002/g, '<span class="hero-buff">$1</span>');
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
  /** The hero of whoever holds or played the card: numbers its passive improves show with the bonus. */
  hero?: HeroId;
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
      <div class="type">${escapeHtml(L(SCHOOL_NAMES[card.school]))}</div>
      <div class="rules"><span>${opts.hero ? buffHtml(rulesHtml(buffText(card.effects, rulesOf(card), opts.hero))) : rulesHtml(rulesOf(card))}</span></div>
    </div></div>
    <div class="name"><i class="tl"></i><i class="tr"></i><b>${escapeHtml(L(card.name))}</b></div>
    <div class="cost ${costClass}"><span>${cost}</span>${emblemSvg(SCHOOL_EMBLEM[card.school])}</div>
    <div class="gem"></div>
    <div class="holo"></div>`;
  // Cards whose illustration is not painted yet show the school emblem on a school-coloured panel.
  const img = el.querySelector<HTMLImageElement>('.art img');
  if (img) {
    watchArt(img, () => {
      el.classList.add('no-art');
      img.insertAdjacentHTML('afterend', emblemSvg(SCHOOL_EMBLEM[card.school], 'art-emblem'));
    });
  }
  el.setAttribute('aria-label', `${L(card.name)}. ${cost}. ${rulesOf(card)}`);
  fitName(el);
  return el;
}

/** Hero texts read "Passive: … Ultimate: …"; split them for the hero frame. */
export function heroParts(heroId: HeroId): { passive: string; ultimate: string } {
  const text = rulesOf(getHero(heroId));
  const match = /^[^:]+:\s*(.*?)\s*(?:Definitiva|Ultimate):\s*(.*)$/s.exec(text);
  return match ? { passive: match[1], ultimate: match[2] } : { passive: text, ultimate: '' };
}

/** Red tint and an X stamp, for a card that was (or is about to be) thrown away rather than played. */
export function discardOverlay(): HTMLElement {
  return h('span.discard-overlay', { 'aria-hidden': 'true' }, h('b.discard-x', null, html(iconSvg('close'))));
}

export function markDiscarded(el: HTMLElement): HTMLElement {
  el.classList.add('discarded');
  el.append(discardOverlay());
  return el;
}

/**
 * History entries: a card id, with a prefix when the card was discarded
 * (`x:`) or played with its Combo (`c:`) or its condition met (`b:`).
 * Kept as plain strings so saved histories stay readable.
 */
export type Boost = 'combo' | 'boosted' | null;

const DISCARDED_PREFIX = 'x:';
const BOOST_PREFIX: Record<'combo' | 'boosted', string> = { combo: 'c:', boosted: 'b:' };

export function historyEntry(cardId: string, discarded: boolean, boost: Boost = null): string {
  if (discarded) return DISCARDED_PREFIX + cardId;
  return boost ? BOOST_PREFIX[boost] + cardId : cardId;
}

export function parseHistoryEntry(entry: string): { cardId: string; discarded: boolean; boost: Boost } {
  if (entry.startsWith(DISCARDED_PREFIX)) return { cardId: entry.slice(DISCARDED_PREFIX.length), discarded: true, boost: null };
  if (entry.startsWith(BOOST_PREFIX.combo)) return { cardId: entry.slice(2), discarded: false, boost: 'combo' };
  if (entry.startsWith(BOOST_PREFIX.boosted)) return { cardId: entry.slice(2), discarded: false, boost: 'boosted' };
  return { cardId: entry, discarded: false, boost: null };
}

/** The hero's ultimate as HTML, with the numbers its own passive improves (the Marshal's damage). */
export function ultimateHtml(heroId: HeroId): string {
  return buffHtml(rulesHtml(buffText(getHero(heroId).ultimate, heroParts(heroId).ultimate, heroId)));
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
        <p><b>${labels[1]}:</b> ${ultimate ? ultimateHtml(heroId) : ''}</p>
      </div>
    </div></div>
    <div class="name"><i class="tl"></i><i class="tr"></i><b>${escapeHtml(L(hero.name))}</b></div>
    <div class="cost solo">${emblemSvg('hero')}</div>
    <div class="gem"></div>
    <div class="holo"></div>`;
  el.setAttribute('aria-label', `${L(hero.name)}. ${rulesOf(hero)}`);
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

/**
 * The Twilight Fury as a card, in the battle event frame. `name` and `text`
 * come from the interface strings (it is a match rule, not a catalog entry).
 */
export function twilightCard(name: string, kind: string, text: string, opts: CardOptions = {}): HTMLDivElement {
  const el = frame('face s-evento event-card twilight-card', opts);
  el.innerHTML = `
    <div class="trim"><div class="body">
      <div class="art"><img alt="" draggable="false" src="${artUrl('events/ocaso.jpg')}"></div>
      <div class="type">${escapeHtml(kind)}</div>
      <div class="rules"><span>${rulesHtml(text)}</span></div>
    </div></div>
    <div class="name"><i class="tl"></i><i class="tr"></i><b>${escapeHtml(name)}</b></div>
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
