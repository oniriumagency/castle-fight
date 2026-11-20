import type { LocalizedText } from '@cardcraft-castles/engine';
import type { IconName } from '../ui/assets';

/**
 * What changed in each update, written for players. The newest release goes
 * first; the main menu opens it once per player (`id` is what is remembered),
 * and the "What's new" button opens it again whenever they like.
 *
 * Card and hero pictures come from the catalog, so their texts and costs are
 * always the current ones; `note` says what changed on each.
 */
export interface ChangelogCard {
  /** A card id or, with `hero: true`, a hero id. */
  id: string;
  hero?: boolean;
  /** Short line under the card, e.g. "Cost 8 → 6". */
  note: LocalizedText;
}

export interface ChangelogSection {
  icon: IconName;
  title: LocalizedText;
  body?: LocalizedText;
  cards?: ChangelogCard[];
  /** Short bullet points (for smaller improvements). */
  points?: { icon: IconName; text: LocalizedText }[];
}

export interface ChangelogRelease {
  /** Stable id; changing it shows the dialog again to everyone. */
  id: string;
  date: LocalizedText;
  title: LocalizedText;
  lead: LocalizedText;
  sections: ChangelogSection[];
}

const cost = (from: number, to: number): LocalizedText => ({ es: `Coste ${from} → ${to}`, en: `Cost ${from} → ${to}` });

export const CHANGELOG: ChangelogRelease[] = [
  {
    id: '2026-11-20',
    date: { es: '20 de noviembre de 2026', en: 'November 20, 2026' },
    title: { es: 'Gremios, observadores y más', en: 'Guilds, spectators and more' },
    lead: {
      es: 'Las cartas de trabajadores por fin merecen la pena, dos héroes se ponen al día y ahora puedes mirar partidas ajenas.',
      en: 'Worker cards are finally worth it, two heroes catch up and you can now watch other people’s games.',
    },
    sections: [
      {
        icon: 'worker',
        title: { es: 'Cartas de trabajadores: invierte sin perder el turno', en: 'Worker cards: invest without losing your turn' },
        body: {
          es: 'Antes, contratar un trabajador te costaba todo el turno y tardaba muchas rondas en compensar. Ahora estas cartas son más baratas y, además, <b>te dejan jugar otra carta en el mismo turno</b>. Consigue tu trabajador y ataca o construye a la vez.',
          en: 'Hiring a worker used to cost your whole turn and took many rounds to pay off. Now these cards are cheaper and <b>let you play another card in the same turn</b>. Get your worker and still attack or build.',
        },
        cards: [
          { id: 'gremio-de-canteros', note: cost(8, 6) },
          { id: 'leva-de-herreros', note: cost(8, 6) },
          { id: 'circulo-de-estudio', note: cost(8, 6) },
          { id: 'fragua-del-gremio', note: cost(8, 6) },
          { id: 'aula-de-arcanistas', note: cost(8, 6) },
          { id: 'maestro-de-obras', note: cost(10, 9) },
          { id: 'gremios-unidos', note: cost(12, 10) },
        ],
      },
      {
        icon: 'hero',
        title: { es: 'Héroes más igualados', en: 'Better balanced heroes' },
        body: {
          es: 'La Arquitecta se había quedado atrás y el Mariscal lo notaba frente a rivales con más recursos. Ahora los seis héroes ganan casi lo mismo.',
          en: 'The Architect had fallen behind, and the Marshal struggled against richer opponents. Now all six heroes win about equally often.',
        },
        cards: [
          { id: 'arquitecta', hero: true, note: { es: 'Su definitiva da también +1 Cantero', en: 'Her ultimate also gives +1 Mason' } },
          { id: 'mariscal', hero: true, note: { es: 'Definitiva: 10 → 13 de daño', en: 'Ultimate: 10 → 13 damage' } },
        ],
      },
      {
        icon: 'eye',
        title: { es: 'Nuevo: modo observador', en: 'New: spectator mode' },
        body: {
          es: '¿La sala está llena? Pulsa <b>Observar</b> en la lista de salas, o abre el enlace de invitación, y mira la partida en directo sin ver las cartas de nadie. En <b>Todos contra todos</b>, si tu castillo cae, sigues viendo el final.',
          en: 'Room full? Tap <b>Watch</b> in the room list, or open the invite link, and follow the game live without seeing anyone’s cards. In <b>Free-for-all</b>, if your castle falls you keep watching until the end.',
        },
      },
      {
        icon: 'enchant',
        title: { es: 'Mejoras', en: 'Improvements' },
        points: [
          {
            icon: 'sword',
            text: {
              es: 'Las cartas de ataque muestran cada bonificación de daño por separado: la del héroe, la de tus encantamientos y la de la Furia del Ocaso.',
              en: 'Attack cards show each damage bonus separately: your hero’s, your enchantments’ and the Twilight Fury’s.',
            },
          },
          {
            icon: 'burn',
            text: {
              es: 'En el dado del Barril de Pólvora, el 1 es ahora una calavera roja: se ve venir el desastre.',
              en: 'On the Powder Keg die, the 1 is now a red skull, so you can see disaster coming.',
            },
          },
          {
            icon: 'scroll',
            text: {
              es: 'La pantalla de victoria y derrota cabe entera, sin desplazarse, en cualquier pantalla.',
              en: 'The victory and defeat screen now fits on any screen without scrolling.',
            },
          },
          {
            icon: 'sunset',
            text: {
              es: 'Los eventos de batalla y la Furia del Ocaso se anuncian más limpios, sin caja alrededor de la carta.',
              en: 'Battle events and the Twilight Fury are announced more cleanly, without a box around the card.',
            },
          },
          {
            icon: 'menu',
            text: {
              es: 'Móvil en horizontal: el mazo y las cartas jugadas pasan a la barra de arriba, y los textos de las cartas se leen mejor.',
              en: 'Phones in landscape: the deck and played cards move to the top bar, and card texts are easier to read.',
            },
          },
        ],
      },
    ],
  },
];

const SEEN_KEY = 'cardcraft-castles:changelog-seen';

/** The newest release, if this player has not seen it yet. */
export function unseenRelease(): ChangelogRelease | null {
  const latest = CHANGELOG[0];
  if (!latest) return null;
  try {
    return localStorage.getItem(SEEN_KEY) === latest.id ? null : latest;
  } catch {
    // Without storage, never pop it up uninvited (it would come back on every visit).
    return null;
  }
}

export function markChangelogSeen(): void {
  const latest = CHANGELOG[0];
  if (!latest) return;
  try {
    localStorage.setItem(SEEN_KEY, latest.id);
  } catch {
    // Private mode or blocked storage: nothing to remember.
  }
}
