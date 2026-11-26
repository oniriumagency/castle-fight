import {
  DEFAULT_RULES,
  attackBonusParts,
  twilightLevel,
  SCHOOL_NAMES,
  TERMS,
  getBattleEvent,
  getCard,
  getHero,
  heroPassiveFor,
  heroUltimateFor,
  type BattleEventId,
  type Board,
  type CardId,
  type EffectOp,
  type HeroId,
  type LocalizedText,
  type PlayerId,
} from '@cardcraft-castles/engine';
import { escapeHtml, h, html } from '../app/dom';
import { L, locale, t } from '../app/i18n';
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
    text: {
      es: `${DEFAULT_RULES.burnDamage} de daño al inicio de cada turno del jugador quemado.`,
      en: `${DEFAULT_RULES.burnDamage} damage at the start of each of the burned player’s turns.`,
    },
  },
  {
    words: { es: 'Escarcha', en: 'Frost' },
    text: { es: 'El recurso congelado no produce mientras dure.', en: 'The frozen resource does not produce while it lasts.' },
  },
  {
    words: { es: 'Óxido', en: 'Rust' },
    text: {
      es: 'Las cartas de Asalto del jugador oxidado cuestan 2 más durante sus próximos turnos.',
      en: 'The rusted player’s Assault cards cost 2 more during their next turns.',
    },
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

/** Where a bonus to a printed number comes from. Each source is shown as its own "+X". */
export type BuffSource = 'hero' | 'enchantment' | 'twilight' | 'combo';

export interface NumberBuff {
  source: BuffSource;
  amount: number;
  /** Who gives it, for the tooltip and the inspect view ("Estandarte de Guerra (3 more attacks)"). */
  label: string;
  /** The enchantment that gives it. */
  cardId?: CardId;
}

/** What is added to the numbers printed on a card: per attack, to each Castle build, and to Burn/Frost/Rust durations. */
export interface CardBuffs {
  attack: NumberBuff[];
  /** Added to every "+N Castle" (the Twilight Fury). Optional: hero-only buffs have none. */
  build?: NumberBuff[];
  status: NumberBuff[];
  /**
   * The card gets (or got, once played) its Combo: the Combo amount is added
   * to the number it raises as one more "+X" ("7+8 damage").
   */
  combo?: boolean;
}

export type BuffKind = 'attack' | 'build' | 'status' | 'combo';

const NO_BUFFS: CardBuffs = { attack: [], build: [], status: [] };

/** The same bonuses with the card's Combo on (or off). */
export function withCombo(buffs: CardBuffs | null | undefined, combo: boolean): CardBuffs | null {
  if (!combo) return buffs?.combo ? { ...buffs, combo: false } : (buffs ?? null);
  return { ...(buffs ?? NO_BUFFS), combo: true };
}

function heroStatusBuffs(heroId: HeroId): NumberBuff[] {
  const n = heroPassiveFor(heroId, tableSize > 2).statusDurationBonus ?? 0;
  return n ? [{ source: 'hero', amount: n, label: t('buffHero', { name: L(getHero(heroId).name) }) }] : [];
}

/** What a hero's passive adds to the numbers printed on cards (when nothing else is known). */
export function heroBuffs(heroId: HeroId): CardBuffs {
  const attack = heroPassiveFor(heroId, tableSize > 2).attackBonus ?? 0;
  return {
    attack: attack ? [{ source: 'hero', amount: attack, label: t('buffHero', { name: L(getHero(heroId).name) }) }] : [],
    status: heroStatusBuffs(heroId),
  };
}

/**
 * Everything that adds to the numbers on `seat`'s cards right now: the
 * hero's passive, each enchantment on the table and the Twilight Fury, each
 * as its own entry, in the same order the engine adds them.
 */
export function boardBuffs(board: Board, seat: PlayerId, level = twilightLevel(board)): CardBuffs {
  const heroId = board.players[seat]!.hero;
  // The Fury at `level`: a card on stage shows the level it was played at, even if the round moves on after it.
  const parts = attackBonusParts(board, seat).filter((part) => part.source !== 'twilight');
  const furyAttack = level * (board.rules.twilightAttackBonus ?? 0);
  if (furyAttack) parts.push({ source: 'twilight', amount: furyAttack });
  const attack = parts.map((part): NumberBuff => {
    if (part.source === 'hero') return { source: 'hero', amount: part.amount, label: t('buffHero', { name: L(getHero(heroId).name) }) };
    if (part.source === 'twilight') return { source: 'twilight', amount: part.amount, label: t('twilightName') };
    const name = L(getCard(part.cardId!).name);
    const label =
      part.charges === undefined ? name : t(part.charges === 1 ? 'buffAttackLeft' : 'buffAttacksLeft', { name, n: part.charges });
    return { source: 'enchantment', amount: part.amount, label, cardId: part.cardId! };
  });
  // The engine adds the Fury's level times its build bonus to every Castle build.
  const fury = level * (board.rules.twilightBuildBonus ?? 0);
  const build: NumberBuff[] = fury ? [{ source: 'twilight', amount: fury, label: t('twilightName') }] : [];
  return { attack, build, status: heroStatusBuffs(heroId) };
}

/** Changes whenever the buffs shown on a card would. */
export function buffsKey(buffs: CardBuffs | null | undefined): string {
  if (!buffs) return '';
  const parts = [...buffs.attack, ...(buffs.build ?? []), ...buffs.status].map((b) => `${b.source}:${b.amount}:${b.label}`);
  if (buffs.combo) parts.push('combo');
  return parts.join('|');
}

/**
 * The bonuses a card was played with, kept with its history entry so the
 * history, the discard pile and the rival's played card show the same "+X"
 * the hit really had. Labels are rebuilt when read, in the current language.
 */
type SavedBuff = [source: 'h' | 'e' | 't', amount: number, cardId?: string];

export function encodeBuffs(buffs: CardBuffs, heroId: HeroId): string {
  const enc = (list: NumberBuff[] | undefined, cards: (string | undefined)[] = []): SavedBuff[] =>
    (list ?? []).map((b, i) => {
      const src = b.source === 'hero' ? 'h' : b.source === 'enchantment' ? 'e' : 't';
      return cards[i] ? [src, b.amount, cards[i]] : [src, b.amount];
    });
  return JSON.stringify({ h: heroId, a: enc(buffs.attack, buffs.attack.map((b) => b.cardId)), b: enc(buffs.build), s: enc(buffs.status) });
}

export function decodeBuffs(raw: string): CardBuffs | null {
  try {
    const data = JSON.parse(raw) as { h: HeroId; a?: SavedBuff[]; b?: SavedBuff[]; s?: SavedBuff[] };
    const dec = (list: SavedBuff[] | undefined): NumberBuff[] =>
      (list ?? []).map(([src, amount, cardId]): NumberBuff => {
        if (src === 'h') return { source: 'hero', amount, label: t('buffHero', { name: L(getHero(data.h).name) }) };
        if (src === 'e' && cardId) return { source: 'enchantment', amount, label: L(getCard(cardId as CardId).name), cardId: cardId as CardId };
        return { source: 'twilight', amount, label: t('twilightName') };
      });
    return { attack: dec(data.a), build: dec(data.b), status: dec(data.s) };
  } catch {
    return null;
  }
}

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

interface EffectNumbers {
  damage: Set<number>;
  build: Set<number>;
  status: Set<number>;
  /** "4 damage for each card discarded": the bonus is added once to the whole hit, not to each card. */
  perCardDamage: boolean;
  /** "+4 Castle for each": the Twilight Fury adds once to the whole build. */
  perCardBuild: boolean;
  /** Printed number → what the Combo adds to it, for damage, Wall and Castle. */
  comboDamage: Map<number, number>;
  comboWall: Map<number, number>;
  comboKeep: Map<number, number>;
}

/** Attack amounts and Burn/Frost/Rust durations among a card's effects, to tell which printed numbers they are. */
function effectNumbers(
  ops: readonly EffectOp[],
  out: EffectNumbers = {
    damage: new Set(),
    build: new Set(),
    status: new Set(),
    perCardDamage: false,
    perCardBuild: false,
    comboDamage: new Map(),
    comboWall: new Map(),
    comboKeep: new Map(),
  },
): EffectNumbers {
  for (const op of ops) {
    if ((op.op === 'damage' || op.op === 'wall' || op.op === 'keep') && op.comboBonus) {
      if (op.op === 'damage') {
        // Against every rival the engine scales the total, so the Combo adds the difference.
        out.comboDamage.set(tableAmount(op.amount), tableAmount(op.amount + op.comboBonus) - tableAmount(op.amount));
      } else (op.op === 'wall' ? out.comboWall : out.comboKeep).set(op.amount, op.comboBonus);
    }
    if (op.op === 'damage' && op.perDiscard && !op.amount) out.perCardDamage = true;
    else if (op.op === 'damage') out.damage.add(tableAmount(op.amount));
    else if (op.op === 'keep' && op.perDiscard) out.perCardBuild = true;
    else if (op.op === 'keep') out.build.add(op.amount);
    else if (op.op === 'enchant' && op.modifiers?.onTurnStart) effectNumbers(op.modifiers.onTurnStart, out);
    else if (op.op === 'burn') out.status.add(tableAmount(op.turns));
    else if (op.op === 'frost' || op.op === 'rust') out.status.add(op.turns);
    else if (op.op === 'if') {
      effectNumbers(op.then, out);
      if (op.else) effectNumbers(op.else, out);
    } else if (op.op === 'roll') {
      for (const r of op.results) effectNumbers(r.then, out);
    }
  }
  return out;
}

// Markers around a buff after a number ("\u0001a0\u0002" is attack buff 0),
// put in before escaping and turned into a span after.
const BUFF_OPEN = '\u0001';
const BUFF_CLOSE = '\u0002';

/**
 * Card text with what is added to its numbers, each source on its own:
 * "13 damage" becomes "13+2+3 damage" for the Marshal with a War Banner up,
 * "for 4 turns" becomes "for 4+1 turns" for the Sorceress. Amounts per card
 * discarded keep their number and get the bonus once, after them: "4 damage
 * for each (+2 in total)". Burn ticks are not attacks and stay as printed.
 */
function buffText(ops: readonly EffectOp[], text: string, buffs: CardBuffs): string {
  const build = buffs.build ?? [];
  if (!buffs.attack.length && !build.length && !buffs.status.length && !buffs.combo) return text;
  const numbers = effectNumbers(ops);
  const marks = (kind: 'a' | 'b' | 's', list: NumberBuff[]): string => list.map((_, i) => `${BUFF_OPEN}${kind}${i}${BUFF_CLOSE}`).join('');
  // The Combo goes first, as the engine adds it to the printed number before the other bonuses.
  const combo = (map: Map<number, number>, n: number): string => (buffs.combo && map.get(n) ? `${BUFF_OPEN}c${map.get(n)}${BUFF_CLOSE}` : '');
  const es = locale() === 'es';
  let out = text;
  if ((buffs.attack.length && numbers.damage.size) || (buffs.combo && numbers.comboDamage.size)) {
    const damage = es ? /(?<![+\d])(\d+)(?= de daño(?! menos| por))/g : /(?<![+\d])(\d+)(?= (?:piercing )?damage(?! per| for each))/g;
    out = out.replace(damage, (m) => (numbers.damage.has(Number(m)) ? `${m}${combo(numbers.comboDamage, Number(m))}${marks('a', buffs.attack)}` : m));
  }
  if ((build.length && numbers.build.size) || (buffs.combo && numbers.comboKeep.size)) {
    // "+7 Castle", and the stronger "+15 instead" of a conditional build.
    const castle = es ? /(?<=\+)(\d+)(?= (?:Castillo(?! por)|en su lugar))/g : /(?<=\+)(\d+)(?= (?:Castle(?! for each)|instead))/g;
    out = out.replace(castle, (m) => (numbers.build.has(Number(m)) ? `${m}${combo(numbers.comboKeep, Number(m))}${marks('b', build)}` : m));
  }
  if (buffs.combo && numbers.comboWall.size) {
    const wall = es ? /(?<=\+)(\d+)(?= Muralla)/g : /(?<=\+)(\d+)(?= Wall)/g;
    out = out.replace(wall, (m) => `${m}${combo(numbers.comboWall, Number(m))}`);
  }
  // Once the Combo amount is added to the number, its own clause ("Combo: +8 damage.")
  // would read as a second bonus: only the keyword stays.
  if (buffs.combo && out.includes(`${BUFF_OPEN}c`)) {
    out = out.replace(new RegExp(`(${L(TERMS.combo)}): [^.]*\\.`), '$1.');
  }
  // Per card discarded: the bonus goes once, at the end of the sentence that counts the cards.
  const perCard = (list: NumberBuff[], kind: 'a' | 'b', eachRival: boolean): void => {
    const sentence = (es ? /(?:por cada|por 1, 2 o 3 cartas)[^.]*/ : /(?:for each|for 1, 2 or 3 cards)[^.]*/).exec(out);
    if (!sentence) return;
    const at = sentence.index + sentence[0].length;
    const where = eachRival ? (es ? 'a cada uno' : 'to each') : es ? 'al total' : 'in total';
    out = `${out.slice(0, at)} (${marks(kind, list)} ${where})${out.slice(at)}`;
  };
  if (buffs.attack.length && numbers.perCardDamage) perCard(buffs.attack, 'a', tableSize > 2);
  if (build.length && numbers.perCardBuild) perCard(build, 'b', false);
  if (buffs.status.length && numbers.status.size) {
    const turns = es ? /(?<=durante )(\d+) turnos?/g : /(?<=for )(\d+) turns?/g;
    out = out.replace(turns, (m, n: string) => {
      if (!numbers.status.has(Number(n))) return m;
      const plural = es ? 'turnos' : 'turns';
      return `${n}${marks('s', buffs.status)} ${plural}`;
    });
  }
  return out;
}

function buffSpan(b: NumberBuff): string {
  return `<span class="buff ${b.source}-buff" title="${escapeHtml(b.label)}">+${b.amount}</span>`;
}

function comboBuff(amount: number): NumberBuff {
  return { source: 'combo', amount, label: t('buffComboDetail') };
}

function buffHtml(html: string, buffs: CardBuffs): string {
  return html.replace(/\u0001([absc])(\d+)\u0002/g, (_, kind: string, i: string) => {
    if (kind === 'c') return buffSpan(comboBuff(Number(i)));
    const b = (kind === 'a' ? buffs.attack : kind === 'b' ? (buffs.build ?? []) : buffs.status)[Number(i)];
    return b ? buffSpan(b) : '';
  });
}

/** A card's rules text as HTML, with its buffs (if any) marked after the numbers they raise. */
export function rulesInnerHtml(cardId: CardId, buffs?: CardBuffs | null): string {
  const card = getCard(cardId);
  return buffs ? buffHtml(rulesHtml(buffText(card.effects, rulesOf(card), buffs)), buffs) : rulesHtml(rulesOf(card));
}

/** The buffs that raise a number printed on this card, to explain them beside it. */
export function buffsOnCard(cardId: CardId, buffs: CardBuffs | null | undefined): { buff: NumberBuff; kind: BuffKind }[] {
  const card = getCard(cardId);
  return buffsOn(card.effects, rulesOf(card), buffs);
}

/** The same for a hero's ultimate. */
export function buffsOnUltimate(heroId: HeroId, buffs: CardBuffs | null | undefined): { buff: NumberBuff; kind: BuffKind }[] {
  return buffsOn(heroUltimateFor(heroId, tableSize > 2), heroParts(heroId).ultimate, buffs);
}

function buffsOn(ops: readonly EffectOp[], text: string, buffs: CardBuffs | null | undefined): { buff: NumberBuff; kind: BuffKind }[] {
  if (!buffs) return [];
  const found: { buff: NumberBuff; kind: BuffKind }[] = (['attack', 'build', 'status'] as const).flatMap((kind) => {
    const list = buffs[kind] ?? [];
    return list.length && buffText(ops, text, { ...NO_BUFFS, [kind]: list }) !== text ? list.map((buff) => ({ buff, kind })) : [];
  });
  if (buffs.combo) {
    // The Combo amounts the text gets, as they are marked on it.
    const marked = buffText(ops, text, { ...NO_BUFFS, combo: true });
    for (const m of marked.matchAll(/\u0001c(\d+)\u0002/g)) found.unshift({ buff: comboBuff(Number(m[1])), kind: 'combo' as const });
  }
  return found;
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
  /**
   * Everything that adds to the card's numbers right now (hero, enchantments,
   * Twilight Fury), each shown as its own "+X". Takes the place of `hero`.
   */
  buffs?: CardBuffs | null;
  /** The card gets (or was played with) its Combo: the Combo amount shows as a "+X" too. */
  combo?: boolean;
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
  const buffs = withCombo(opts.buffs ?? (opts.hero ? heroBuffs(opts.hero) : null), opts.combo ?? !!opts.buffs?.combo);
  if (buffs) el.dataset.buffs = buffsKey(buffs);
  el.innerHTML = `
    <div class="trim"><div class="body">
      <div class="art"><img alt="" draggable="false" ${opts.lazy ? 'loading="lazy"' : ''} src="${artUrl(card.art)}"></div>
      <div class="type">${escapeHtml(L(SCHOOL_NAMES[card.school]))}</div>
      <div class="rules"><span>${rulesInnerHtml(cardId, buffs)}</span></div>
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
 * (`x:`) or played with its Combo (`c:`) or its condition met (`b:`), and
 * with `>id` after it when it copied another card (Mirage).
 * Kept as plain strings so saved histories stay readable.
 */
export type Boost = 'combo' | 'boosted' | null;

const DISCARDED_PREFIX = 'x:';
const BOOST_PREFIX: Record<'combo' | 'boosted', string> = { combo: 'c:', boosted: 'b:' };

export function historyEntry(cardId: string, discarded: boolean, boost: Boost = null, buffs: string | null = null): string {
  const base = discarded ? DISCARDED_PREFIX + cardId : boost ? BOOST_PREFIX[boost] + cardId : cardId;
  return buffs ? base + BUFFS_SEPARATOR + buffs : base;
}

const COPY_SEPARATOR = '>';
/** Then the bonuses it was played with (`encodeBuffs`). Older entries have none. */
const BUFFS_SEPARATOR = '#';

/** The same entry, noting the card it copied. */
export function withCopiedCard(entry: string, copiedId: string): string {
  const [main = '', buffs] = entry.split(BUFFS_SEPARATOR);
  const copied = main.split(COPY_SEPARATOR)[0] + COPY_SEPARATOR + copiedId;
  return buffs ? copied + BUFFS_SEPARATOR + buffs : copied;
}

export function parseHistoryEntry(full: string): {
  cardId: string;
  discarded: boolean;
  boost: Boost;
  copied: string | null;
  /** The bonuses it was played with; null for entries saved before they were kept. */
  buffs: CardBuffs | null;
} {
  const [main = '', buffs] = full.split(BUFFS_SEPARATOR);
  const [entry = '', copied] = main.split(COPY_SEPARATOR);
  return { ...parseBase(entry), copied: copied || null, buffs: buffs ? decodeBuffs(buffs) : null };
}

function parseBase(entry: string): { cardId: string; discarded: boolean; boost: Boost } {
  if (entry.startsWith(DISCARDED_PREFIX)) return { cardId: entry.slice(DISCARDED_PREFIX.length), discarded: true, boost: null };
  if (entry.startsWith(BOOST_PREFIX.combo)) return { cardId: entry.slice(2), discarded: false, boost: 'combo' };
  if (entry.startsWith(BOOST_PREFIX.boosted)) return { cardId: entry.slice(2), discarded: false, boost: 'boosted' };
  return { cardId: entry, discarded: false, boost: null };
}

/**
 * The hero's ultimate as HTML, with what raises its numbers: during a match
 * `buffs` (passive, enchantments and Twilight Fury, as on cards), otherwise
 * the hero's own passive (the Marshal's damage).
 */
export function ultimateHtml(heroId: HeroId, buffs?: CardBuffs | null): string {
  const shown = buffs ?? heroBuffs(heroId);
  return buffHtml(rulesHtml(buffText(heroUltimateFor(heroId, tableSize > 2), heroParts(heroId).ultimate, shown)), shown);
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
        <p><b>${labels[1]}:</b> ${ultimate ? ultimateHtml(heroId, opts.buffs) : ''}</p>
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

