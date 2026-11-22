import type { BattleEventId, CardId, HeroId, LocalizedText, Rules } from '@cardcraft-castles/engine';

/**
 * The campaign map: six kingdoms in a ring around the Crown. The player
 * starts with the Architect's castle (Valdepiedra) and conquers the rest
 * territory by territory, moving only to territories next to ones they own.
 *
 * Each rival kingdom has four territories held by captains (A and B border
 * the neighbouring kingdoms, C and D lie behind them) and the hero's castle
 * at the back, reachable only through C or D. The Crown opens once the five
 * rival castles have fallen.
 */

export type KingdomId = 'valdepiedra' | 'bastion' | 'alambiques' | 'ceniza' | 'escarcha' | 'carmesi';
export type TerritoryKind = 'home' | 'territory' | 'castle' | 'final';
export type TerrainId =
  | 'murallas'
  | 'pantano'
  | 'mina'
  | 'tregua'
  | 'llanura'
  | 'mercado'
  | 'tormenta'
  | 'eclipse'
  | 'cosecha'
  | 'riqueza'
  | 'terremoto'
  | 'ocaso';

export interface Kingdom {
  id: KingdomId;
  hero: HeroId;
  name: LocalizedText;
  /** What its decks lean on, in a few words. */
  theme: LocalizedText;
  /** Centre of the kingdom on the map (viewBox 1000 × 700), for its banner and shading. */
  x: number;
  y: number;
}

export interface Captain {
  name: string;
  /** For the title (Capitán / Capitana) and to match the portrait. */
  female?: boolean;
  /** One line before the battle. */
  line: LocalizedText;
}

export interface Territory {
  id: string;
  kingdom: KingdomId | null;
  kind: TerritoryKind;
  name: LocalizedText;
  x: number;
  y: number;
  terrain: TerrainId | null;
  /** Cards unlocked by conquering it. */
  rewards: CardId[];
  /** Territory battles only. */
  captain?: Captain;
}

export interface Terrain {
  id: TerrainId;
  name: LocalizedText;
  text: LocalizedText;
  rules?: Partial<Rules>;
  firstEvent?: BattleEventId;
}

export const STARTING_HERO: HeroId = 'arquitecta';

/** Simple commons that do one easy-to-read thing each: six per school. */
export const STARTING_CARDS: readonly CardId[] = [
  'hilada-de-piedra',
  'parapeto',
  'cimientos',
  'andamio-real',
  'almenas',
  'cantera-abierta',
  'escaramuza',
  'carga-de-lanceros',
  'doble-salva',
  'saetas-negras',
  'carga-de-caballeria',
  'zapadores',
  'chispa-arcana',
  'lluvia-de-ascuas',
  'egida-lunar',
  'transmutacion',
  'brote-de-cristal',
  'purificacion',
];

export const KINGDOMS: readonly Kingdom[] = [
  { id: 'valdepiedra', hero: 'arquitecta', name: { es: 'Valdepiedra', en: 'Stonevale' }, theme: { es: 'Tu reino', en: 'Your kingdom' }, x: 500, y: 640 },
  { id: 'bastion', hero: 'guardian', name: { es: 'Bastión Azur', en: 'Azure Bastion' }, theme: { es: 'Murallas y defensa', en: 'Walls and defence' }, x: 250, y: 540 },
  { id: 'alambiques', hero: 'alquimista', name: { es: 'Valle de los Alambiques', en: 'Alembic Vale' }, theme: { es: 'Recursos y trabajadores', en: 'Resources and workers' }, x: 750, y: 540 },
  { id: 'ceniza', hero: 'saboteadora', name: { es: 'Hondonada de Ceniza', en: 'Ashen Hollow' }, theme: { es: 'Descarte y robo', en: 'Discard and theft' }, x: 230, y: 240 },
  { id: 'escarcha', hero: 'hechicera', name: { es: 'Cumbres de Escarcha', en: 'Frostpeaks' }, theme: { es: 'Magia y estados', en: 'Magic and statuses' }, x: 770, y: 240 },
  { id: 'carmesi', hero: 'mariscal', name: { es: 'Marca Carmesí', en: 'Crimson March' }, theme: { es: 'Asalto puro', en: 'Pure assault' }, x: 500, y: 115 },
];

export const TERRAINS: readonly Terrain[] = [
  { id: 'murallas', name: { es: 'Murallas altas', en: 'High walls' }, text: { es: 'Las dos Murallas empiezan en 25.', en: 'Both Walls start at 25.' }, rules: { wallStart: 25 } },
  { id: 'pantano', name: { es: 'Ciénaga', en: 'Mire' }, text: { es: 'La Furia del Ocaso llega en la ronda 7.', en: 'The Twilight Fury arrives in round 7.' }, rules: { twilightRound: 7 } },
  { id: 'mina', name: { es: 'Vetas ricas', en: 'Rich seams' }, text: { es: 'Los dos empiezan con 3 trabajadores de cada tipo.', en: 'Both start with 3 workers of each kind.' }, rules: { workerStart: 3 } },
  { id: 'tregua', name: { es: 'Frío de montaña', en: 'Mountain cold' }, text: { es: 'El primer evento es Tregua de Invierno.', en: 'The first event is Winter Truce.' }, firstEvent: 'tregua' },
  { id: 'llanura', name: { es: 'Tierra de batallas', en: 'Battle plains' }, text: { es: 'Hay un evento cada 3 rondas.', en: 'An event every 3 rounds.' }, rules: { eventEveryRounds: 3 } },
  { id: 'mercado', name: { es: 'Ruta comercial', en: 'Trade route' }, text: { es: 'El primer evento es Mercado Ambulante.', en: 'The first event is Travelling Market.' }, firstEvent: 'mercado' },
  { id: 'tormenta', name: { es: 'Costa tormentosa', en: 'Stormy coast' }, text: { es: 'El primer evento es Tormenta.', en: 'The first event is Storm.' }, firstEvent: 'tormenta' },
  { id: 'eclipse', name: { es: 'Cielo arcano', en: 'Arcane sky' }, text: { es: 'El primer evento es Eclipse.', en: 'The first event is Eclipse.' }, firstEvent: 'eclipse' },
  { id: 'cosecha', name: { es: 'Vega fértil', en: 'Fertile meadow' }, text: { es: 'El primer evento es Gran Cosecha.', en: 'The first event is Great Harvest.' }, firstEvent: 'cosecha' },
  { id: 'riqueza', name: { es: 'Tesoro escondido', en: 'Hidden hoard' }, text: { es: 'Los dos empiezan con 12 de cada recurso.', en: 'Both start with 12 of each resource.' }, rules: { resourceStart: 12 } },
  { id: 'terremoto', name: { es: 'Tierra inestable', en: 'Unstable ground' }, text: { es: 'El primer evento es Terremoto.', en: 'The first event is Earthquake.' }, firstEvent: 'terremoto' },
  { id: 'ocaso', name: { es: 'El Ocaso', en: 'The Twilight' }, text: { es: 'La Furia del Ocaso llega en la ronda 4.', en: 'The Twilight Fury arrives in round 4.' }, rules: { twilightRound: 4 } },
];

const T = (
  id: string,
  kingdom: KingdomId | null,
  kind: TerritoryKind,
  es: string,
  en: string,
  x: number,
  y: number,
  terrain: TerrainId | null,
  rewards: CardId[],
  captain?: Captain,
): Territory => ({ id, kingdom, kind, name: { es, en }, x, y, terrain, rewards, ...(captain ? { captain } : {}) });

const cap = (name: string, es: string, en: string): Captain => ({ name, line: { es, en }, ...(FEMALE.has(name) ? { female: true } : {}) });
/** The captains who are women (the rest are men). */
const FEMALE = new Set(['Dama Elowen', 'Capitana Rhoswen', 'Tilda Fennick', 'Ama Cordelia', 'Gilly Ratón', 'Maeve Hollín', 'Aprendiz Liora', 'Maga Seren']);

export const TERRITORIES: readonly Territory[] = [
  T('valdepiedra', 'valdepiedra', 'home', 'Valdepiedra', 'Stonevale', 500, 640, null, []),

  // Azure Bastion (the Warden): walls and defence.
  T('bastion-a', 'bastion', 'territory', 'Vado del Centinela', 'Sentinel Ford', 380, 600, 'murallas', ['puntales', 'reparaciones-de-urgencia'],
    cap('Sir Brannoc', 'Nadie cruza este vado sin permiso del Guardián. Y hoy no lo da.', 'No one crosses this ford without the Warden’s leave. And today he gives none.')),
  T('bastion-b', 'bastion', 'territory', 'Atalaya Gris', 'Grey Watchtower', 240, 420, 'tormenta', ['bastida-de-granito', 'puente-levadizo'],
    cap('Dama Elowen', 'Te vimos venir desde hace tres días. Hemos tenido tiempo de sobra.', 'We saw you coming three days ago. We have had plenty of time.')),
  T('bastion-c', 'bastion', 'territory', 'Desfiladero Azul', 'Azure Gorge', 300, 520, 'terremoto', ['contrafuertes', 'torre-vigia'],
    cap('Sir Tavish', 'Este desfiladero lo defendieron mis abuelos. No seré yo quien lo pierda.', 'My grandparents held this gorge. I will not be the one to lose it.')),
  T('bastion-d', 'bastion', 'territory', 'Cantera del Juramento', 'Oathstone Quarry', 170, 500, 'riqueza', ['fortaleza-viva', 'maestro-de-obras'],
    cap('Capitana Rhoswen', 'De esta cantera salió cada piedra del Bastión. Ninguna será tuya.', 'Every stone of the Bastion came from this quarry. Not one will be yours.')),
  T('bastion-castillo', 'bastion', 'castle', 'Bastión Azur', 'Azure Bastion', 130, 620, null, ['bastion-ciclopeo', 'aguja-celeste', 'ciudadela-eterna']),

  // Alembic Vale (the Alchemist): resources and workers.
  T('alambiques-a', 'alambiques', 'territory', 'Molinos de Cobre', 'Copper Mills', 620, 600, 'cosecha', ['gremio-de-canteros', 'drenaje'],
    cap('Maese Pockett', '¡Alto! El maestro Barnaby dice que eres un experimento. Y a mí me toca medirte.', 'Halt! Master Barnaby says you are an experiment. And I am to take your measurements.')),
  T('alambiques-b', 'alambiques', 'territory', 'Huertos de Salitre', 'Saltpetre Orchards', 760, 420, 'mercado', ['leva-de-herreros', 'saqueo-nocturno'],
    cap('Tilda Fennick', 'Estas manzanas explotan si las pisas. Te lo digo por tu bien.', 'These apples explode if you step on them. I tell you for your own good.')),
  T('alambiques-c', 'alambiques', 'territory', 'Laguna Esmeralda', 'Emerald Lagoon', 700, 520, 'mina', ['circulo-de-estudio', 'fragua-del-gremio'],
    cap('Doctor Grindle', 'El agua es verde por el cobre. Casi siempre.', 'The water is green from the copper. Almost always.')),
  T('alambiques-d', 'alambiques', 'territory', 'Minas Burbujeantes', 'Bubbling Mines', 830, 500, 'riqueza', ['aula-de-arcanistas', 'manantial-de-mana'],
    cap('Ama Cordelia', 'Aquí abajo hay oro para comprar diez ejércitos. Bastará con uno.', 'There is gold down here to buy ten armies. One will do.')),
  T('alambiques-castillo', 'alambiques', 'castle', 'Torre de los Alambiques', 'Tower of Alembics', 870, 620, null, ['gremios-unidos', 'reloj-de-arena']),

  // Ashen Hollow (the Saboteur): discard and theft.
  T('ceniza-a', 'ceniza', 'territory', 'Ciénaga de Hollín', 'Soot Mire', 190, 330, 'pantano', ['escombros-utiles', 'tierra-quemada'],
    cap('Gilly Ratón', '¿Has perdido algo? No. Todavía no.', 'Lost something? No. Not yet.')),
  T('ceniza-b', 'ceniza', 'territory', 'Mercado Negro', 'Black Market', 320, 185, 'mercado', ['ofrenda-arcana', 'ojo-del-augur'],
    cap('Wick Tallow', 'Aquí todo tiene precio. El tuyo acaba de subir.', 'Everything has a price here. Yours just went up.')),
  T('ceniza-c', 'ceniza', 'territory', 'Túneles del Contrabando', 'Smugglers’ Tunnels', 300, 270, 'terremoto', ['planos-revisados', 'relevo-de-tropas', 'sillares-reciclados'],
    cap('Corwin Manolenta', 'Estos túneles tienen mil salidas. Tú no encontrarás ninguna.', 'These tunnels have a thousand ways out. You will find none.')),
  T('ceniza-d', 'ceniza', 'territory', 'Bosque Chamuscado', 'Scorched Wood', 180, 200, 'eclipse', ['grimorio-en-llamas', 'espia-en-la-corte'],
    cap('Maeve Hollín', 'Huele a humo, ¿verdad? Es tu mazo.', 'Smells of smoke, doesn’t it? That’s your deck.')),
  T('ceniza-castillo', 'ceniza', 'castle', 'Guarida de la Mecha', 'The Fuse’s Den', 90, 250, null, ['quema-de-pergaminos', 'todo-o-nada', 'motin']),

  // Frostpeaks (the Sorceress): magic and statuses.
  T('escarcha-a', 'escarcha', 'territory', 'Lago Cristalino', 'Crystal Lake', 810, 330, 'tregua', ['aliento-de-escarcha', 'disipar'],
    cap('Aprendiz Liora', 'La maestra dice que no te tenga miedo. Lo estoy intentando.', 'My mistress says I should not fear you. I am trying.')),
  T('escarcha-b', 'escarcha', 'territory', 'Sendero de Escarcha', 'Frost Trail', 680, 185, 'eclipse', ['maldicion-de-oxido', 'espejismo'],
    cap('Hermano Vane', 'El frío no tiene prisa. Nosotros tampoco.', 'The cold is in no hurry. Neither are we.')),
  T('escarcha-c', 'escarcha', 'territory', 'Ruinas del Augur', 'Augur’s Ruins', 700, 270, 'tormenta', ['rayo-bifurcado', 'trueque-de-destinos'],
    cap('Maga Seren', 'Estas piedras vieron caer a reyes. Tú no eres reina.', 'These stones saw kings fall. You are no queen.')),
  T('escarcha-d', 'escarcha', 'territory', 'Cumbre Helada', 'Frozen Summit', 820, 200, 'tregua', ['prision-de-hielo'],
    cap('Custodio Ithel', 'Pocos llegan tan alto. Menos aún bajan.', 'Few climb this high. Fewer climb down.')),
  T('escarcha-castillo', 'escarcha', 'castle', 'Torre de la Llama Helada', 'Tower of the Frozen Flame', 910, 250, null, ['tormenta-de-ceniza', 'cometa-del-ocaso']),

  // Crimson March (the Marshal): pure assault.
  T('carmesi-a', 'carmesi', 'territory', 'Campo de Lanzas', 'Field of Spears', 415, 118, 'llanura', ['hostigamiento', 'ariete-de-hierro'],
    cap('Sargento Bruck', '¡Formad filas! Que la Arquitecta vea cómo se pelea en la Marca.', 'Form ranks! Let the Architect see how the March fights.')),
  T('carmesi-b', 'carmesi', 'territory', 'Forja Roja', 'Red Forge', 585, 118, 'murallas', ['estandarte-de-guerra', 'emboscada'],
    cap('Capitán Holt', 'Cada espada de esta forja lleva el nombre de un muro que derribó.', 'Every sword from this forge bears the name of a wall it brought down.')),
  T('carmesi-c', 'carmesi', 'territory', 'Llanura de Batalla', 'Battle Plain', 500, 190, 'llanura', ['catapulta', 'balista-de-asedio'],
    cap('Coronel Varga', 'En esta llanura no hay donde esconderse. Ni para ti ni para mí.', 'There is nowhere to hide on this plain. Not for you, not for me.')),
  T('carmesi-d', 'carmesi', 'territory', 'Cuarteles del Norte', 'Northern Barracks', 590, 52, 'tormenta', ['sabotaje', 'barril-de-polvora'],
    cap('Comandante Dresk', 'El Mariscal no se equivoca. Si te dejó llegar aquí, es para terminar contigo él mismo.', 'The Marshal makes no mistakes. If he let you get this far, it is to finish you himself.')),
  T('carmesi-castillo', 'carmesi', 'castle', 'Fortaleza Carmesí', 'Crimson Fortress', 430, 48, null, ['trabuquete-colosal', 'torre-de-asedio', 'hueste-imparable']),

  // The Crown: the final battle, once the five castles have fallen.
  T('corona', null, 'final', 'La Corona', 'The Crown', 500, 380, 'ocaso', []),
];

/** Borders, both ways. */
const EDGES: readonly [string, string][] = [
  // Around the ring.
  ['valdepiedra', 'bastion-a'],
  ['valdepiedra', 'alambiques-a'],
  ['bastion-b', 'ceniza-a'],
  ['alambiques-b', 'escarcha-a'],
  ['ceniza-b', 'carmesi-a'],
  ['escarcha-b', 'carmesi-b'],
  // Inside each rival kingdom: A and B lead to C and D, which guard the castle.
  ...(['bastion', 'alambiques', 'ceniza', 'escarcha', 'carmesi'] as const).flatMap((k): [string, string][] => [
    [`${k}-a`, `${k}-c`],
    [`${k}-b`, `${k}-c`],
    [`${k}-b`, `${k}-d`],
    [`${k}-c`, `${k}-d`],
    [`${k}-c`, `${k}-castillo`],
    [`${k}-d`, `${k}-castillo`],
  ]),
];

const byId = new Map(TERRITORIES.map((t) => [t.id, t]));
const neighbours = new Map<string, string[]>(TERRITORIES.map((t) => [t.id, []]));
for (const [a, b] of EDGES) {
  neighbours.get(a)!.push(b);
  neighbours.get(b)!.push(a);
}

export const BORDERS: readonly (readonly [string, string])[] = EDGES;

export function getTerritory(id: string): Territory {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown territory "${id}"`);
  return t;
}

export function isTerritoryId(id: string): boolean {
  return byId.has(id);
}

export function neighboursOf(id: string): readonly string[] {
  return neighbours.get(id) ?? [];
}

export function getKingdom(id: KingdomId): Kingdom {
  return KINGDOMS.find((k) => k.id === id)!;
}

export function getTerrain(id: TerrainId): Terrain {
  return TERRAINS.find((t) => t.id === id)!;
}

/** The kingdom whose castle the hero defends. */
export function kingdomOfHero(hero: HeroId): Kingdom | null {
  return KINGDOMS.find((k) => k.hero === hero) ?? null;
}

/** Every rival kingdom, in map order. */
export const RIVAL_KINGDOMS: readonly KingdomId[] = ['bastion', 'alambiques', 'ceniza', 'escarcha', 'carmesi'];

/** The two heroes the Twilight takes hold of for the final battle. */
export const FINAL_RIVALS: readonly HeroId[] = ['mariscal', 'hechicera'];
