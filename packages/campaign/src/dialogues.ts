import type { HeroId, LocalizedText } from '@cardcraft-castles/engine';
import type { KingdomId } from './data';

/**
 * The campaign's story: who the heroes are and what they say. The texts come
 * from the story document agreed with the team; change them here.
 */

/** Who speaks a line: a hero (with portrait), a captain of a kingdom, or the narrator. */
export type Speaker = { hero: HeroId } | { captain: string; kingdom: KingdomId } | { narrator: true };

export interface Line {
  speaker: Speaker;
  text: LocalizedText;
}

export interface Persona {
  name: string;
  /** What the valley calls them. */
  epithet: LocalizedText;
}

export const PERSONAS: Record<string, Persona> = {
  arquitecta: { name: 'Mary Brickson', epithet: { es: 'la Piedra Angular', en: 'the Cornerstone' } },
  guardian: { name: 'Idris Halloway', epithet: { es: 'el Muro que No Cae', en: 'the Wall That Never Falls' } },
  alquimista: { name: 'Barnaby Quill', epithet: { es: 'el Oro Loco', en: 'Mad Gold' } },
  saboteadora: { name: 'Nell Ashdown', epithet: { es: 'la Mecha Corta', en: 'the Short Fuse' } },
  hechicera: { name: 'Ysolde Vey', epithet: { es: 'la Llama Helada', en: 'the Frozen Flame' } },
  mariscal: { name: 'Aldric Vance', epithet: { es: 'el Rompemurallas', en: 'the Wallbreaker' } },
};

const say = (hero: HeroId, es: string, en: string): Line => ({ speaker: { hero }, text: { es, en } });
const narrate = (es: string, en: string): Line => ({ speaker: { narrator: true }, text: { es, en } });
const MARY = 'arquitecta';

export const PROLOGUE: Line[] = [
  narrate(
    'Hace veinte años murió el rey Aurelio y su corona se rompió en seis brasas. Seis señores las recibieron, y con ellas, el valle.',
    'Twenty years ago King Aurelio died and his crown shattered into six embers. Six lords received them, and with them, the valley.',
  ),
  narrate(
    'Anoche ardió el puente de Valdepiedra. Los seis reinos se acusan entre sí. La tregua ha terminado.',
    'Last night the bridge of Stonevale burned. The six kingdoms blame one another. The truce is over.',
  ),
  say(MARY, 'Si alguien va a reinar este valle, que sea quien sabe construir. Empecemos por los cimientos.', 'If someone is going to rule this valley, let it be someone who knows how to build. Let us start with the foundations.'),
];

/** First encounter: a message from the hero before the battle against their first captain. */
export const INTRO: Record<Exclude<KingdomId, 'valdepiedra'>, Line[]> = {
  bastion: [
    say('guardian', 'Mary Brickson, la Arquitecta. Dicen que tus muros son los más bellos del valle. Los míos no son bellos. Simplemente, nunca han caído.', 'Mary Brickson, the Architect. They say your walls are the finest in the valley. Mine are not fine. They have simply never fallen.'),
    say(MARY, 'Todo muro cae, Idris. Solo hay que saber dónde empujar.', 'Every wall falls, Idris. You only need to know where to push.'),
    say('guardian', 'Entonces empuja. Descubrirás por qué me llaman el Muro que No Cae.', 'Then push. You will learn why they call me the Wall That Never Falls.'),
  ],
  alambiques: [
    say('alquimista', '¡La Arquitecta en persona! ¿Sabías que la piedra, bien calentada, se vuelve vidrio? Me muero por comprobar si contigo pasa lo mismo.', 'The Architect herself! Did you know that stone, heated just right, turns into glass? I am dying to find out whether the same happens to you.'),
    say(MARY, 'Barnaby, ¿eso ha sido una amenaza?', 'Barnaby, was that a threat?'),
    say('alquimista', '¡Ha sido una hipótesis! Por algo me llaman el Oro Loco. Empecemos el experimento.', 'It was a hypothesis! They do not call me Mad Gold for nothing. Let the experiment begin.'),
  ],
  ceniza: [
    say('saboteadora', 'Mary Brickson, ¿verdad? Te esperaba. Bueno, esperaba que cayeras en mi trampa, pero esto también vale.', 'Mary Brickson, right? I was expecting you. Well, I was expecting you to fall into my trap, but this will do.'),
    say(MARY, 'Quemaste mi puente, Nell.', 'You burned my bridge, Nell.'),
    say('saboteadora', 'Ojalá. Si hubiera sido yo, no habría quedado ni el humo. Ven, te enseño por qué me llaman la Mecha Corta.', 'I wish. If it had been me, not even the smoke would be left. Come, let me show you why they call me the Short Fuse.'),
  ],
  escarcha: [
    say('hechicera', 'La Arquitecta. Levantas piedras como si fueran a durar para siempre. Qué tierno. Yo he visto arder montañas.', 'The Architect. You raise stones as if they will last forever. How sweet. I have seen mountains burn.'),
    say(MARY, 'Y yo las he visto volver a levantarse.', 'And I have seen them rise again.'),
    say('hechicera', 'Entonces aprenderás por qué me llaman la Llama Helada: el fuego que no se apaga y el frío que no perdona.', 'Then you will learn why they call me the Frozen Flame: the fire that never dies and the cold that never forgives.'),
  ],
  carmesi: [
    say('mariscal', 'Mary Brickson, también conocida como la Arquitecta. He oído de tus hazañas, pero jamás imaginé que llegarías a mis tierras.', 'Mary Brickson, also known as the Architect. I have heard of your deeds, but I never imagined you would reach my lands.'),
    say(MARY, 'Tampoco yo imaginé que tendría que hacerlo.', 'Nor did I imagine I would have to.'),
    say('mariscal', 'Descubrirás por qué me llaman el Rompemurallas. Y te arrepentirás de haber construido tan alto.', 'You will learn why they call me the Wallbreaker. And you will regret building so high.'),
  ],
};

/** Before the battle for the castle. */
export const CASTLE: Record<Exclude<KingdomId, 'valdepiedra'>, Line[]> = {
  bastion: [say('guardian', 'Has cruzado mis tierras sin quemar una sola granja. Te lo agradezco. No cambiará lo que pase hoy.', 'You crossed my lands without burning a single farm. I thank you. It will not change what happens today.')],
  alambiques: [say('alquimista', '¡Cuidado con los frascos verdes! Bueno, y con los azules. En realidad, con todos.', 'Mind the green flasks! Well, and the blue ones. Actually, all of them.')],
  ceniza: [say('saboteadora', 'Así que has llegado hasta mi puerta. ¿Has contado tus cartas? Porque yo sí.', 'So you made it to my door. Have you counted your cards? Because I have.')],
  escarcha: [say('hechicera', 'Paciencia, Mary. Todo se consume. Solo hay que esperar lo suficiente.', 'Patience, Mary. Everything burns away. You only have to wait long enough.')],
  carmesi: [say('mariscal', 'Veinte años de tregua y este valle no ha levantado ni un ejército. Cuando vuelva el Ocaso nos encontrará divididos. Yo no lo permitiré.', 'Twenty years of truce and this valley has not raised a single army. When the Twilight returns it will find us divided. I will not allow it.')],
};

/** After the castle falls: the hero joins. `marshalBeaten` changes Nell's revelation. */
export function fallLines(kingdom: Exclude<KingdomId, 'valdepiedra'>, marshalBeaten: boolean): Line[] {
  switch (kingdom) {
    case 'bastion':
      return [
        say('guardian', 'Mi muralla cayó, y con ella mi juramento de no servir a nadie. El Pacto es el Pacto. Mi escudo es tuyo, Arquitecta.', 'My wall fell, and with it my oath to serve no one. The Pact is the Pact. My shield is yours, Architect.'),
        say(MARY, 'No quiero tu escudo delante de mí, Idris. Lo quiero a mi lado.', 'I do not want your shield in front of me, Idris. I want it beside me.'),
      ];
    case 'alambiques':
      return [
        say('alquimista', 'Resultado inesperado, ¡pero resultado al fin! Anoto: la Arquitecta no se funde. Me uno a tu causa. Tus muros y mis frascos van a hacer cosas maravillosas.', 'Unexpected result, but a result all the same! Noted: the Architect does not melt. I join your cause. Your walls and my flasks will do wonderful things.'),
      ];
    case 'ceniza':
      return marshalBeaten
        ? [
            say('saboteadora', 'Vale, vale, me rindo. Así que fue el viejo Aldric. Siempre supe que no era tan honrado como su armadura.', 'Fine, fine, I give up. So it was old Aldric. I always knew he was not as honest as his armour.'),
            say('saboteadora', 'Cuenta conmigo. Yo nunca apuesto por quien pierde.', 'Count me in. I never bet on the losing side.'),
          ]
        : [
            say('saboteadora', 'Vale, vale, me rindo. Por ahora. Te diré algo gratis: la noche del puente vi capas rojas junto al río. Pregúntale al Mariscal dónde estaba.', 'Fine, fine, I give up. For now. I will tell you something for free: the night of the bridge I saw red cloaks by the river. Ask the Marshal where he was.'),
            say(MARY, '¿Y por qué me lo cuentas ahora?', 'And why tell me now?'),
            say('saboteadora', 'Porque ahora estoy en tu bando. Y yo nunca apuesto por quien pierde.', 'Because now I am on your side. And I never bet on the losing side.'),
          ];
    case 'escarcha':
      return [
        say('hechicera', 'Mi brasa se apaga ante la tuya. Interesante. Te seguiré, Arquitecta, aunque solo sea para ver cuánto aguantan tus muros cuando llegue el Ocaso.', 'My ember dims before yours. Interesting. I will follow you, Architect, if only to see how long your walls hold when the Twilight comes.'),
      ];
    case 'carmesi':
      return [
        say('mariscal', 'Fui yo. Yo quemé el puente. Necesitaba una guerra que acabara con una sola corona. No pensé que esa corona sería la tuya.', 'It was me. I burned the bridge. I needed a war that would end with a single crown. I did not think that crown would be yours.'),
        say(MARY, 'Una corona no une a nadie, Aldric. Los cimientos sí.', 'A crown unites no one, Aldric. Foundations do.'),
        say('mariscal', 'Entonces construye, Arquitecta. Mi espada es tuya.', 'Then build, Architect. My sword is yours.'),
      ];
  }
}

/** Shown once, right after the first hero is beaten (`hero` is the one who just joined). */
export function awakeningLines(hero: HeroId): Line[] {
  return [
    narrate('La brasa que Mary lleva al cuello, fría desde hace veinte años, empieza a arder.', 'The ember Mary wears at her neck, cold for twenty years, begins to burn.'),
    say(hero, 'Tu brasa ha despertado. Ha sentido a una igual. Ahora sí eres una de nosotros.', 'Your ember has woken. It has felt an equal. Now you truly are one of us.'),
    say(MARY, 'Es como si el castillo entero respondiera a mi voz.', 'It is as if the whole castle answered to my voice.'),
  ];
}

/** The hero's reaction when one of their captains falls. */
/**
 * What the rival hero says when the player takes one of their territories, from
 * the first to the fourth: each one a little less amused than the last.
 */
export const TERRITORY_WON: Record<string, LocalizedText[]> = {
  guardian: [
    { es: 'Un muro menos. Me quedan muchos.', en: 'One wall fewer. I have plenty left.' },
    { es: 'Dos. Mis capitanes juran que eran inexpugnables. Tendré que revisar qué significa esa palabra.', en: 'Two. My captains swore they were impregnable. I will have to check what that word means.' },
    { es: 'Tres torres caídas en mi guardia. Nunca había tenido que escribir tantas cartas a las familias.', en: 'Three towers fallen on my watch. I have never had to write so many letters to families.' },
    { es: 'Basta. Ya no quedan murallas entre tú y mi castillo. Ven, Arquitecta. Te espero en la puerta.', en: 'Enough. There are no walls left between you and my castle. Come, Architect. I will be waiting at the gate.' },
  ],
  alquimista: [
    { es: '¡Fascinante! Perder también es un dato.', en: 'Fascinating! Losing is data too.' },
    { es: 'Dos datos. Empiezan a parecer una tendencia, y no me gusta la tendencia.', en: 'Two data points. They are starting to look like a trend, and I do not like the trend.' },
    { es: '¡Mis huertos! ¡Mis minas! ¿Sabes cuánto cuesta calibrar un alambique de cobre? ¡No lo sabes!', en: 'My orchards! My mines! Do you know how much it costs to calibrate a copper still? You do not!' },
    { es: 'Ya está. Se acabó la ciencia. Ahora es personal. ¡Que alguien me traiga el frasco que no hay que tocar!', en: 'That is it. No more science. Now it is personal. Someone bring me the flask nobody is supposed to touch!' },
  ],
  saboteadora: [
    { es: '¿Ese territorio? Te lo dejé ganar. Seguro.', en: 'That territory? I let you have it. Honestly.' },
    { es: 'Vale, ese no te lo dejé ganar. Pero el próximo sí. Probablemente.', en: 'Fine, I did not let you have that one. But the next one, sure. Probably.' },
    { es: '¿Quién te está pasando mis planos? Dímelo y te perdono. A ti no. A él tampoco.', en: 'Who is passing you my plans? Tell me and I will forgive you. Not you. Not them either.' },
    { es: 'Ya no tiene gracia, Mary. Ni una pizca. Me has dejado sin túneles, sin mercado y sin paciencia.', en: 'It is not funny anymore, Mary. Not one bit. You have left me without tunnels, without a market and without patience.' },
  ],
  hechicera: [
    { es: 'Disfrútalo. El hielo siempre vuelve.', en: 'Enjoy it. The ice always comes back.' },
    { es: 'Otra más. El hielo vuelve, he dicho. Solo que tarda.', en: 'Another one. The ice comes back, I said. It just takes its time.' },
    { es: 'Mis aprendices dicen que ya no hace tanto frío en las cumbres. Diles que se callen.', en: 'My apprentices say it is not so cold on the peaks anymore. Tell them to be quiet.' },
    { es: 'Me has quitado las cumbres una a una. Muy bien. Entonces subiré a buscarte yo misma.', en: 'You have taken the peaks from me one by one. Very well. Then I will come down for you myself.' },
  ],
  mariscal: [
    { es: 'Has ganado una batalla. Las guerras se ganan de otra forma.', en: 'You won a battle. Wars are won another way.' },
    { es: 'Dos batallas. Mis sargentos empiezan a mirar al suelo cuando pasan a mi lado.', en: 'Two battles. My sergeants are starting to look at the ground when they walk past me.' },
    { es: '¡Una cantera con muros no debería ganarle a un ejército! ¿Quién entrena a esta gente? ¡Ah, sí! Yo.', en: 'A quarry with walls should not beat an army! Who trains these people? Ah, right. I do.' },
    { es: 'Suficiente. Que suenen los tambores. Ya no voy a esperar a que llegues a mi fortaleza, Arquitecta.', en: 'Enough. Sound the drums. I will not wait for you to reach my fortress, Architect.' },
  ],
};

/** After their castle falls, a hero who is now an ally comments on the rest of their land being taken. */
export const TERRITORY_WON_ALLY: Record<string, LocalizedText> = {
  guardian: { es: 'Ese capitán no se había enterado de que ya estamos del mismo lado. Ahora lo sabe.', en: 'That captain had not heard we are on the same side now. Now he knows.' },
  alquimista: { es: 'Bien hecho. Aunque podrías haber sido más amable con mis alambiques.', en: 'Well done. Although you could have been gentler with my stills.' },
  saboteadora: { es: 'Mis antiguos chicos. Siempre fueron mejores robando que peleando.', en: 'My old crew. They were always better at stealing than fighting.' },
  hechicera: { es: 'Una cumbre menos que tenga que vigilar. Te lo agradezco, a mi manera.', en: 'One peak fewer for me to watch over. I thank you, in my own way.' },
  mariscal: { es: 'Mis soldados aprenden despacio, pero aprenden. Gracias por la lección.', en: 'My soldiers learn slowly, but they learn. Thank you for the lesson.' },
};

/** What the rival hero says when the player loses; they take turns so the same line does not come back every time. */
export const DEFEAT: Record<string, LocalizedText[]> = {
  guardian: [
    { es: 'Vuelve cuando quieras, Arquitecta. Mis muros te esperarán.', en: 'Come back whenever you like, Architect. My walls will be waiting.' },
    { es: 'No hay vergüenza en caer ante una muralla. Hay vergüenza en no volver a intentarlo.', en: 'There is no shame in falling before a wall. The shame is in not trying again.' },
    { es: 'Mis capitanes te han tomado cariño. Dicen que eres la mejor práctica que han tenido.', en: 'My captains have grown fond of you. They say you are the best practice they have ever had.' },
    { es: 'Descansa. Repara. Vuelve. Así se construye todo, ¿no es lo que dices tú?', en: 'Rest. Repair. Return. That is how everything is built, is it not what you always say?' },
  ],
  alquimista: [
    { es: 'Hipótesis confirmada. ¿Repetimos para estar seguros?', en: 'Hypothesis confirmed. Shall we repeat it to be sure?' },
    { es: '¡Excelente! Anoto el resultado en la columna de "ya lo sabía".', en: 'Excellent! I am writing the result in the "I knew it" column.' },
    { es: 'No te desanimes. El noventa y nueve por ciento de mis experimentos también explotan.', en: 'Do not lose heart. Ninety-nine percent of my experiments blow up too.' },
    { es: 'Interesante. Muy interesante. Vuelve, que todavía me faltan muestras.', en: 'Interesting. Very interesting. Come back, I still need more samples.' },
  ],
  saboteadora: [
    { es: '¿Otra vez? Ya te estoy echando de menos.', en: 'Again? I miss you already.' },
    { es: 'Me quedo con esta carta de recuerdo. Tranquila, la cuidaré. Más o menos.', en: 'I will keep this card as a souvenir. Relax, I will look after it. More or less.' },
    { es: 'Deberías revisar tus bolsillos antes de irte. Lo digo por experiencia.', en: 'You should check your pockets before you leave. Speaking from experience.' },
    { es: 'Así se hace, Mary: primero te distraigo y luego te desarmo. Toma nota.', en: 'That is how it is done, Mary: first I distract you, then I disarm you. Take notes.' },
  ],
  hechicera: [
    { es: 'Ya te lo dije: todo se consume.', en: 'I told you: everything burns away.' },
    { es: 'El frío no tiene prisa. Tú tampoco deberías tenerla.', en: 'The cold is in no hurry. Neither should you be.' },
    { es: 'Tus muros son de piedra. La piedra se agrieta cuando hiela.', en: 'Your walls are made of stone. Stone cracks when it freezes.' },
    { es: 'Vuelve cuando hayas aprendido a escuchar el viento.', en: 'Come back when you have learned to listen to the wind.' },
  ],
  mariscal: [
    { es: 'Los muros bonitos caen igual que los feos.', en: 'Pretty walls fall just like ugly ones.' },
    { es: 'Retírate y reagrupa. Es lo que yo haría. Aunque yo no habría perdido.', en: 'Fall back and regroup. That is what I would do. Although I would not have lost.' },
    { es: 'La disciplina gana guerras, Arquitecta. El talento solo gana aplausos.', en: 'Discipline wins wars, Architect. Talent only wins applause.' },
    { es: 'Otra vez a la cantera. Mis soldados ya te reconocen por el polvo.', en: 'Back to the quarry. My soldiers already recognise you by the dust.' },
  ],
};

/** Mary sends an ally into battle in her place. */
export const SEND_OFF: Record<string, LocalizedText> = {
  guardian: { es: 'Idris, sus muros son tuyos. Enséñales cómo se defiende el valle.', en: 'Idris, their walls are yours. Show them how the valley is defended.' },
  alquimista: { es: 'Barnaby, tu turno. Intenta no volar nada nuestro.', en: 'Barnaby, your turn. Try not to blow up anything of ours.' },
  saboteadora: { es: 'Nell, haz lo que mejor sabes hacer.', en: 'Nell, do what you do best.' },
  hechicera: { es: 'Ysolde, que sientan el frío.', en: 'Ysolde, let them feel the cold.' },
  mariscal: { es: 'Aldric, esta vez la guerra es por algo. Gánala.', en: 'Aldric, this time the war is for something. Win it.' },
};

export const FINAL_INTRO: Line[] = [
  narrate('Las seis brasas están juntas por primera vez desde la muerte del rey. El cielo se oscurece sobre la Corona.', 'The six embers are together for the first time since the king died. The sky darkens over the Crown.'),
  say('hechicera', '¿Lo sentís? Las brasas tiemblan.', 'Do you feel it? The embers are trembling.'),
  say('mariscal', 'Es él. Es lo que rompió la corona. Por esto quemé el puente.', 'It is him. It is what broke the crown. This is why I burned the bridge.'),
  narrate('Una sombra roja cae sobre Aldric e Ysolde. Sus ojos se apagan. El Ocaso habla por sus bocas.', 'A red shadow falls over Aldric and Ysolde. Their eyes go dark. The Twilight speaks through them.'),
  say(MARY, 'Entonces por esto lo construimos todo. Aguantad, os sacaré de ahí.', 'Then this is what we built it all for. Hold on, I will get you out.'),
];

export const EPILOGUE: Line[] = [
  narrate('El Ocaso se retira más allá de las montañas. Las seis brasas se funden de nuevo en una corona.', 'The Twilight withdraws beyond the mountains. The six embers fuse into a crown once more.'),
  say('saboteadora', 'Bueno, ¿y ahora quién se la pone?', 'So, who gets to wear it?'),
  say('guardian', 'El Pacto es claro. Quien levantó el torreón más alto.', 'The Pact is clear. Whoever raised the highest keep.'),
  say(MARY, 'Nadie. La dejaremos en la Corona, donde todos puedan verla. Mañana empezamos a reconstruir el puente.', 'No one. We will leave it at the Crown, where everyone can see it. Tomorrow we start rebuilding the bridge.'),
  say('alquimista', '¡Yo me encargo de la argamasa! Tengo una fórmula que casi nunca explota.', 'I will handle the mortar! I have a formula that almost never explodes.'),
];

/** Short tips woven into the first battles. */
export const TIPS: LocalizedText[] = [
  { es: 'Consejo: la Muralla recibe los golpes antes que el Castillo. Mantenla alta y tu Castillo no sufrirá.', en: 'Tip: the Wall takes hits before the Castle. Keep it high and your Castle will not suffer.' },
  { es: 'Consejo: los trabajadores producen recursos al empezar cada turno. Una carta que da un trabajador te sigue pagando toda la partida.', en: 'Tip: workers produce resources at the start of each turn. A card that gives you a worker keeps paying for the whole game.' },
  { es: 'Consejo: si no puedes jugar nada útil, descarta una carta para robar otra. Recuerda: gana quien lleve su Castillo a 100 o derribe el del rival.', en: 'Tip: if you cannot play anything useful, discard a card to draw another. Remember: you win by raising your Castle to 100 or razing your rival’s.' },
];
