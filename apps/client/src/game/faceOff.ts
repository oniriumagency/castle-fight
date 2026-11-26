import { CASTLE, INTRO, type KingdomId } from '@cardcraft-castles/campaign';
import type { HeroId, LocalizedText, PlayerId } from '@cardcraft-castles/engine';
import { REACTION_LINES } from './reactionLines';

/**
 * The heroes' face-off: a short exchange of speech bubbles when a match
 * begins, outside the campaign. Each line is said by a seat's hero, one
 * after another, and never stops the game.
 *
 * When Mary (the Architect) faces a hero she meets in the campaign, they
 * trade the campaign's own words. Any other pair greets with each hero's
 * opening lines.
 */

export interface FaceOffLine {
  seat: PlayerId;
  text: LocalizedText;
}

const MARY: HeroId = 'arquitecta';

/** The campaign kingdom whose lord is each hero. */
const KINGDOM_OF: Partial<Record<HeroId, Exclude<KingdomId, 'valdepiedra'>>> = {
  guardian: 'bastion',
  alquimista: 'alambiques',
  saboteadora: 'ceniza',
  hechicera: 'escarcha',
  mariscal: 'carmesi',
};

/**
 * Campaign lines that also fit outside the campaign. The first encounter
 * drops its last line (it sends Mary to the hero's captains); the castle
 * line is used where it does not speak of the campaign's journey.
 */
const CASTLE_FITS = new Set<Exclude<KingdomId, 'valdepiedra'>>(['alambiques', 'ceniza', 'escarcha', 'carmesi']);

/** The scripted exchanges for a hero and Mary: every line by the hero ('hero') or Mary ('mary'). */
function scripts(hero: HeroId): { who: 'hero' | 'mary'; text: LocalizedText }[][] {
  const kingdom = KINGDOM_OF[hero];
  if (!kingdom) return [];
  const out: { who: 'hero' | 'mary'; text: LocalizedText }[][] = [];
  const intro = INTRO[kingdom].slice(0, -1).map((line) => ({ who: 'hero' in line.speaker && line.speaker.hero === MARY ? ('mary' as const) : ('hero' as const), text: line.text }));
  if (intro.length) out.push(intro);
  if (CASTLE_FITS.has(kingdom)) {
    for (const line of CASTLE[kingdom]) out.push([{ who: 'hero', text: line.text }]);
  }
  return out;
}

/** A hero's opening line, other than `not`. */
function openingLine(hero: HeroId, random: () => number, not?: LocalizedText): LocalizedText | null {
  const lines = (REACTION_LINES[hero]?.start ?? []).filter(([es]) => es !== not?.es);
  if (!lines.length) return null;
  const [es, en] = lines[Math.floor(random() * lines.length)]!;
  return { es, en };
}

/**
 * What the heroes say as they face each other. `heroes` has one entry per
 * seat; `first` is the seat that speaks first when nothing else decides it
 * (the rival, in a game against the AI).
 */
export function faceOff(heroes: readonly (HeroId | undefined)[], random: () => number = Math.random, first?: PlayerId): FaceOffLine[] {
  const seats = heroes.map((_, i) => i).filter((s) => heroes[s]);
  if (seats.length < 2) return [];
  const order = [...seats];
  // Random order, then the preferred opener up front.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  if (first !== undefined && order.includes(first)) order.splice(0, 0, ...order.splice(order.indexOf(first), 1));

  const out: FaceOffLine[] = [];
  const spoke = new Set<PlayerId>();

  // Mary against a hero she meets in the campaign: their own words, most of the time.
  const mary = order.find((s) => heroes[s] === MARY);
  const lord = order.find((s) => s !== mary && heroes[s] !== MARY && KINGDOM_OF[heroes[s]!]);
  if (mary !== undefined && lord !== undefined && random() < 0.75) {
    const options = scripts(heroes[lord]!);
    // The full exchange is the favourite; the castle line now and then.
    const pick = options.length > 1 && random() < 0.3 ? options[1 + Math.floor(random() * (options.length - 1))]! : options[0];
    if (pick) {
      for (const line of pick) out.push({ seat: line.who === 'mary' ? mary : lord, text: line.text });
      spoke.add(lord);
      // A single line from the hero gets Mary's answer.
      if (pick.length === 1) {
        const answer = openingLine(MARY, random);
        if (answer) out.push({ seat: mary, text: answer });
      }
      spoke.add(mary);
    }
  }

  // Everyone who has not spoken yet greets in turn.
  let last: LocalizedText | undefined;
  for (const seat of order) {
    if (spoke.has(seat)) continue;
    const text = openingLine(heroes[seat]!, random, last);
    if (!text) continue;
    out.push({ seat, text });
    last = text;
  }
  return out;
}

/** A small seeded random, so both players of an online game see the same face-off. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
