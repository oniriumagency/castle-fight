/**
 * What each hero says in a speech bubble when something happens in a match.
 * Each line is [Spanish, English]. The voices follow the campaign's story:
 * Mary builds, Idris endures, Barnaby experiments, Nell steals, Ysolde
 * looks down on everyone and Aldric gives orders. Campaign captains speak
 * with their kingdom's hero's lines, so no line names its speaker.
 */

export type ReactionKind =
  /** The match begins. */
  | 'start'
  /** The speaker hired workers. */
  | 'workers'
  /** The speaker raised a lot of Wall in one play. */
  | 'buildWall'
  /** The speaker raised a lot of Castle in one play. */
  | 'buildKeep'
  /** The speaker dealt a heavy blow. */
  | 'hitDealt'
  /** The speaker took a heavy blow. */
  | 'hitTaken'
  /** The speaker played a Combo. */
  | 'combo'
  /** The speaker fired their ultimate. */
  | 'ultimate'
  /** The speaker's Powder Keg (or another die) blew up in their face. */
  | 'backfire'
  /** The speaker's Castle is close to winning. */
  | 'nearVictory'
  /** A rival hired workers. */
  | 'rivalWorkers'
  /** A rival raised a lot of Wall. */
  | 'rivalWall'
  /** A rival raised a lot of Castle. */
  | 'rivalKeep'
  /** A rival played a Combo. */
  | 'rivalCombo'
  /** A rival fired their ultimate. */
  | 'rivalUltimate'
  /** A rival's Castle is close to winning. */
  | 'rivalNearVictory'
  /** The speaker was set on fire. */
  | 'burned'
  /** The speaker was frozen. */
  | 'frozen'
  /** The speaker was rusted. */
  | 'rusted'
  /** Someone stole the speaker's resources or workers. */
  | 'robbed'
  /** A rival's card made the speaker discard. */
  | 'discarded'
  /** The speaker's Wall fell to 0. */
  | 'wallDown'
  /** The speaker's Castle is in danger. */
  | 'keepLow'
  /** The speaker's Shield stopped a hit. */
  | 'shieldBlock'
  /** A battle event began. */
  | 'battleEvent'
  /** The Twilight Fury rose. */
  | 'twilight';

type Lines = Partial<Record<ReactionKind, [string, string][]>>;

const arquitecta: Lines = {
  start: [
    ['Buenos cimientos, buena partida. Empecemos.', 'Good foundations, good game. Let us begin.'],
    ['Primero los planos. Luego, la piedra.', 'Plans first. Then the stone.'],
    ['Hoy se construye. Y se derriba lo que estorbe.', 'Today we build. And knock down whatever is in the way.'],
  ],
  workers: [
    ['Más manos, más piedra. Así se levanta un reino.', 'More hands, more stone. That is how a kingdom rises.'],
    ['Bienvenidos a la obra. El casco va por mi cuenta.', 'Welcome to the site. Helmets are on me.'],
    ['Una buena cuadrilla vale más que cien espadas.', 'A good crew is worth more than a hundred swords.'],
  ],
  buildWall: [
    ['Hilada a hilada. Nadie pasa.', 'Course by course. No one gets through.'],
    ['Esa muralla lleva mi firma en cada piedra.', 'That wall has my signature on every stone.'],
    ['Plomada, nivel y paciencia. Mira qué belleza.', 'Plumb line, level and patience. Look at that beauty.'],
  ],
  buildKeep: [
    ['Un piso más. Desde aquí ya se ve tu derrota.', 'One more floor. I can see your defeat from up here.'],
    ['El torreón sube. Los cimientos aguantan: lo calculé.', 'The keep rises. The foundations hold: I did the maths.'],
    ['Más alto, más firme, más mío.', 'Taller, sturdier, more mine.'],
  ],
  hitDealt: [
    ['Demolición controlada. Bueno, casi controlada.', 'Controlled demolition. Well, mostly controlled.'],
    ['Esa piedra estaba mal asentada. Te hice un favor.', 'That stone was badly set. I did you a favour.'],
    ['Eso no era un muro de carga, ¿verdad? Ahora ya no.', 'That was not load-bearing, was it? Not anymore.'],
  ],
  hitTaken: [
    ['¡Mis andamios! Tardé tres días en montarlos.', 'My scaffolding! It took me three days to put up.'],
    ['Grietas. Odio las grietas.', 'Cracks. I hate cracks.'],
    ['Apunto el daño. La factura va a tu nombre.', 'I am noting the damage. The bill has your name on it.'],
    ['Eso se repara. Tu orgullo, cuando acabe, no.', 'That can be repaired. Your pride, when I am done, cannot.'],
  ],
  combo: [
    ['Todo encaja, como un arco bien hecho.', 'Everything fits, like a well-made arch.'],
    ['Una pieza sostiene a la otra. Eso es arquitectura.', 'One piece holds up the next. That is architecture.'],
    ['¿Ves? Planificar tiene premio.', 'See? Planning pays off.'],
  ],
  ultimate: [
    ['Hora de enseñarte lo que es una obra maestra.', 'Time to show you what a masterpiece looks like.'],
    ['Que tiemblen los andamios: esto es arquitectura de verdad.', 'Let the scaffolding shake: this is real architecture.'],
    ['Esto estaba en los planos desde el principio.', 'This was in the blueprints from the start.'],
  ],
  backfire: [
    ['Eso... no estaba en los planos.', 'That... was not in the blueprints.'],
    ['Error de cálculo. Lo corrijo y aquí no ha pasado nada.', 'Miscalculation. I will fix it and nothing happened here.'],
    ['¡La pólvora no es material de construcción!', 'Gunpowder is not a building material!'],
  ],
  nearVictory: [
    ['Ya casi toco las nubes. Ríndete con elegancia.', 'I can almost touch the clouds. Surrender gracefully.'],
    ['Solo falta la última piedra.', 'Only the last stone is missing.'],
    ['Ve preparando la placa de inauguración.', 'Start preparing the opening plaque.'],
  ],
  rivalWorkers: [
    ['¿Contratas? Espero que sepan qué es una plomada.', 'Hiring? I hope they know what a plumb line is.'],
    ['Más obreros no te hacen mejor arquitecto.', 'More workers do not make you a better architect.'],
    ['Si se cansan de ti, en mi obra siempre hay sitio.', 'If they get tired of you, my site is always hiring.'],
  ],
  rivalWall: [
    ['Bonita muralla. Lástima de cimientos.', 'Nice wall. Shame about the foundations.'],
    ['Esa argamasa está demasiado aguada. Se nota desde aquí.', 'That mortar is too watery. I can tell from here.'],
    ['Muy alta y muy torcida. Eso se cae solo.', 'Very tall and very crooked. That will fall on its own.'],
  ],
  rivalKeep: [
    ['¿Quién te diseñó eso? Lo pregunto para no contratarlo nunca.', 'Who designed that for you? I ask so I never hire them.'],
    ['Eh, sin copiarme los planos.', 'Hey, no copying my blueprints.'],
    ['Construyes alto. Ya veremos si construyes bien.', 'You build tall. We shall see if you build well.'],
  ],
  rivalCombo: [
    ['Vaya, eso estaba bien pensado. No te acostumbres.', 'Well, that was well thought out. Do not get used to it.'],
    ['Ingenioso. Ahora verás uno de verdad.', 'Clever. Now watch a real one.'],
    ['Hasta un reloj parado acierta dos veces al día.', 'Even a stopped clock is right twice a day.'],
  ],
  rivalUltimate: [
    ['¡Sujetad los andamios, que viene fuerte!', 'Hold the scaffolding, here it comes!'],
    ['Mucho ruido. Veremos cuánto aguanta mi piedra.', 'Lots of noise. We shall see how long my stone holds.'],
    ['¿Ese es todo tu poder? He visto terremotos peores.', 'Is that all your power? I have seen worse earthquakes.'],
    ['Lo apunto. Y luego lo reconstruyo todo, más alto.', 'Noted. And then I rebuild it all, taller.'],
  ],
  rivalNearVictory: [
    ['Está demasiado alto... Hay que derribarlo ya.', 'It is too tall... It has to come down now.'],
    ['No mires abajo. Te espera una buena caída.', 'Do not look down. A long fall awaits.'],
    ['Todavía no has puesto la última piedra.', 'You have not laid the last stone yet.'],
  ],
  burned: [
    ['¡Fuego en la obra! ¡Cubos, rápido!', 'Fire on the site! Buckets, now!'],
    ['La piedra no arde. Las vigas sí, por desgracia.', 'Stone does not burn. The beams do, sadly.'],
    ['Debí construir con más granito y menos madera.', 'I should have built with more granite and less timber.'],
  ],
  frozen: [
    ['Con este frío no fragua ni la argamasa.', 'In this cold not even mortar sets.'],
    ['Que alguien encienda un brasero en la cantera.', 'Someone light a brazier in the quarry.'],
    ['Obra parada por helada. Qué maravilla.', 'Work stopped by frost. Wonderful.'],
  ],
  rusted: [
    ['¿Óxido en mis herramientas? Esto es personal.', 'Rust on my tools? This is personal.'],
    ['Paletas oxidadas, cinceles mellados... Qué desastre.', 'Rusty trowels, chipped chisels... What a mess.'],
    ['Nota mental: aceitar las bisagras.', 'Mental note: oil the hinges.'],
  ],
  robbed: [
    ['¡Eso era material de obra, no un regalo!', 'That was building material, not a gift!'],
    ['Me acaban de vaciar el almacén. Qué descaro.', 'They just emptied my storehouse. The nerve.'],
    ['Lo devolverás. Piedra por piedra.', 'You will give it back. Stone by stone.'],
  ],
  discarded: [
    ['¡Mis planos! Ahí iba la torre norte.', 'My blueprints! The north tower was on those.'],
    ['No pasa nada. Me sé los cálculos de memoria.', 'No matter. I know the calculations by heart.'],
    ['Eso no se tira, ¡eso se archiva!', 'You do not throw that away, you file it!'],
  ],
  wallDown: [
    ['La muralla ha caído. El torreón sigue en pie.', 'The wall is down. The keep still stands.'],
    ['Vale. Reconstruir es lo que mejor se me da.', 'Fine. Rebuilding is what I do best.'],
    ['Sin muralla... Bueno, al menos ahora entra más luz.', 'No wall... Well, at least more light gets in now.'],
  ],
  keepLow: [
    ['Aguanta, viejo torreón. Aguanta un poco más.', 'Hold on, old keep. Hold on a little longer.'],
    ['He reconstruido desde menos. Créeme.', 'I have rebuilt from less. Believe me.'],
    ['Los cimientos siguen ahí. Con eso me basta.', 'The foundations are still there. That is enough for me.'],
  ],
  shieldBlock: [
    ['Ni una grieta. Así se protege una obra.', 'Not a crack. That is how you protect a building.'],
    ['Rebotó. Buena ingeniería.', 'It bounced off. Good engineering.'],
    ['Ese golpe lo calculé antes que tú.', 'I calculated that blow before you did.'],
  ],
  battleEvent: [
    ['Cambia el clima, cambian los planos.', 'The weather changes, the plans change.'],
    ['Imprevistos de obra. Siempre los hay.', 'Surprises on site. There are always some.'],
    ['Bien. Yo me adapto. Tú, no tanto.', 'Fine. I adapt. You, not so much.'],
  ],
  twilight: [
    ['El Ocaso... Que aguanten los muros.', 'The Twilight... May the walls hold.'],
    ['Ese cielo rojo no me gusta nada.', 'I do not like that red sky one bit.'],
    ['Construimos para esto. Para resistir.', 'This is what we built for. To endure.'],
  ],
};

const guardian: Lines = {
  start: [
    ['Mi muralla está lista. ¿Y la tuya?', 'My wall is ready. Is yours?'],
    ['Lucha con honor. Yo haré lo mismo.', 'Fight with honour. I will do the same.'],
    ['Nadie cruza. Esa es mi única regla.', 'No one crosses. That is my only rule.'],
  ],
  workers: [
    ['Más guardias para la muralla. Bien.', 'More guards for the wall. Good.'],
    ['Cada mano que se une es un juramento más.', 'Every hand that joins is one more oath.'],
    ['Que coman bien. Mañana hay guardia.', 'Feed them well. Tomorrow there is a watch.'],
  ],
  buildWall: [
    ['Piedra sobre piedra. Así se cumple un juramento.', 'Stone upon stone. That is how an oath is kept.'],
    ['Más alta. Más gruesa. Más paciente.', 'Taller. Thicker. More patient.'],
    ['Esta muralla no cae. Esta tampoco.', 'This wall does not fall. Nor does this one.'],
  ],
  buildKeep: [
    ['El torreón crece tras la muralla, como debe ser.', 'The keep grows behind the wall, as it should.'],
    ['Firme y alto. Como mis votos.', 'Firm and tall. Like my vows.'],
    ['Que lo vean desde todo el valle.', 'Let the whole valley see it.'],
  ],
  hitDealt: [
    ['No me gusta golpear. Pero sé hacerlo.', 'I do not like to strike. But I know how.'],
    ['Eso fue por cada piedra que me debes.', 'That was for every stone you owe me.'],
    ['Un escudo también sirve para empujar.', 'A shield is good for pushing too.'],
  ],
  hitTaken: [
    ['He recibido golpes peores. Todos los días.', 'I have taken worse blows. Every day.'],
    ['Lo noto. No lo muestro.', 'I feel it. I do not show it.'],
    ['Golpea otra vez. Te estaré esperando.', 'Strike again. I will be waiting.'],
    ['Ha dolido. Seguiré aquí igualmente.', 'That hurt. I will still be here.'],
  ],
  combo: [
    ['Disciplina. Cada carta en su sitio.', 'Discipline. Every card in its place.'],
    ['Así se defiende un reino: todos juntos.', 'That is how a kingdom is defended: all together.'],
    ['Formación cerrada. Ni una grieta.', 'Closed formation. Not one gap.'],
  ],
  ultimate: [
    ['¡Por el Pacto! ¡Por el valle! ¡Firmes!', 'For the Pact! For the valley! Hold!'],
    ['Ahora sabrás por qué nunca he caído.', 'Now you will learn why I have never fallen.'],
    ['Mi juramento se hace piedra.', 'My oath turns to stone.'],
  ],
  backfire: [
    ['Por eso no confío en la pólvora.', 'This is why I do not trust gunpowder.'],
    ['Merecido. Nunca debí apostar.', 'Deserved. I should never have gambled.'],
    ['Que esto no salga de aquí.', 'Let this not leave the room.'],
  ],
  nearVictory: [
    ['Ya casi. La guardia alta hasta el final.', 'Almost there. Guard up until the end.'],
    ['La torre roza el cielo. Ríndete con honor.', 'The tower brushes the sky. Yield with honour.'],
    ['Un último esfuerzo y habrá paz.', 'One last effort and there will be peace.'],
  ],
  rivalWorkers: [
    ['Más manos no levantan mejores muros.', 'More hands do not raise better walls.'],
    ['Trátalos bien. Se lo merecen.', 'Treat them well. They deserve it.'],
    ['Contrata a los que quieras. Mi muralla no cuenta cabezas.', 'Hire as many as you like. My wall does not count heads.'],
  ],
  rivalWall: [
    ['Una buena muralla. Casi digna de respeto.', 'A good wall. Almost worthy of respect.'],
    ['Ahora entiendes lo que es proteger algo.', 'Now you understand what it means to protect something.'],
    ['Muros contra muros. Esto será largo.', 'Walls against walls. This will be long.'],
  ],
  rivalKeep: [
    ['Alto, sí. Pero ¿quién lo defiende?', 'Tall, yes. But who defends it?'],
    ['Un torreón sin muralla es una invitación.', 'A keep without a wall is an invitation.'],
    ['No subas tan deprisa. Las caídas duelen.', 'Do not climb so fast. Falls hurt.'],
  ],
  rivalCombo: [
    ['Bien encadenado. Lo reconozco.', 'Well chained. I admit it.'],
    ['Astuto. Pero la astucia no derriba murallas.', 'Cunning. But cunning does not bring down walls.'],
    ['Lo vi venir. Tarde, pero lo vi.', 'I saw it coming. Late, but I saw it.'],
  ],
  rivalUltimate: [
    ['Escudos arriba. Ahí viene.', 'Shields up. Here it comes.'],
    ['Toda tu fuerza de una vez. Yo tengo paciencia.', 'All your strength at once. I have patience.'],
    ['Resistiré. Siempre resisto.', 'I will hold. I always hold.'],
  ],
  rivalNearVictory: [
    ['Esa torre no debe terminarse. A las armas.', 'That tower must not be finished. To arms.'],
    ['Casi tocas el cielo. Yo tengo los pies en el suelo.', 'You almost touch the sky. My feet are on the ground.'],
    ['Aún no. Aún estoy aquí.', 'Not yet. I am still here.'],
  ],
  burned: [
    ['¡Agua a las almenas! ¡Ahora!', 'Water to the battlements! Now!'],
    ['El fuego pasa. La piedra se queda.', 'Fire passes. Stone remains.'],
    ['Ya he visto arder mis estandartes. Los volví a coser.', 'I have seen my banners burn before. I sewed them again.'],
  ],
  frozen: [
    ['El frío no me asusta. He hecho guardia en inviernos peores.', 'The cold does not scare me. I have kept watch through worse winters.'],
    ['Mis hombres tiritan. Yo no.', 'My men shiver. I do not.'],
    ['Hielo en las canteras. Esperaremos.', 'Ice in the quarries. We will wait.'],
  ],
  rusted: [
    ['Un escudo oxidado sigue siendo un escudo.', 'A rusty shield is still a shield.'],
    ['Arena y aceite. Mañana brillará otra vez.', 'Sand and oil. Tomorrow it will shine again.'],
    ['El óxido es paciente. Yo más.', 'Rust is patient. I am more so.'],
  ],
  robbed: [
    ['¿Robarle a un guardián? No tienes vergüenza.', 'Robbing a warden? You have no shame.'],
    ['Lo que se toma sin honor se pierde sin gloria.', 'What is taken without honour is lost without glory.'],
    ['Recuperaré cada pieza. Lo juro.', 'I will recover every piece. I swear it.'],
  ],
  discarded: [
    ['Mis órdenes, al fuego. Improvisaremos.', 'My orders, into the fire. We will improvise.'],
    ['No necesito papeles para defender una puerta.', 'I need no papers to defend a gate.'],
    ['Truco sucio. Pero sigo aquí.', 'A dirty trick. But I am still here.'],
  ],
  wallDown: [
    ['Mi muralla... Nunca había... No. Reconstruid. Ya.', 'My wall... It has never... No. Rebuild. Now.'],
    ['Un muro caído no es un juramento roto.', 'A fallen wall is not a broken oath.'],
    ['Ahora me defiendo yo. Sin piedra.', 'Now I defend myself. Without stone.'],
  ],
  keepLow: [
    ['Sigo en pie. Mientras lo esté, no pasarás.', 'I still stand. While I do, you shall not pass.'],
    ['Caer no entra en mi juramento.', 'Falling is not part of my oath.'],
    ['Un paso atrás. Ni uno más.', 'One step back. Not one more.'],
  ],
  shieldBlock: [
    ['No.', 'No.'],
    ['Mi escudo ha hablado.', 'My shield has spoken.'],
    ['Para eso está un guardián.', 'That is what a warden is for.'],
  ],
  battleEvent: [
    ['El cielo cambia. La guardia no.', 'The sky changes. The watch does not.'],
    ['Venga lo que venga, lo resistiremos.', 'Whatever comes, we will endure.'],
    ['Atentos. Esto lo cambia todo.', 'Stay alert. This changes everything.'],
  ],
  twilight: [
    ['El Ocaso. Lo que juré contener.', 'The Twilight. What I swore to hold back.'],
    ['Hasta mis piedras tiemblan.', 'Even my stones tremble.'],
    ['Que nadie abandone su puesto.', 'Let no one leave their post.'],
  ],
};

const alquimista: Lines = {
  start: [
    ['¡Bata puesta, gafas limpias! Comienza el experimento.', 'Lab coat on, goggles clean! The experiment begins.'],
    ['Hipótesis: hoy gano yo. Vamos a comprobarlo.', 'Hypothesis: I win today. Let us test it.'],
    ['Por favor, no toques nada que burbujee.', 'Please do not touch anything that bubbles.'],
  ],
  workers: [
    ['¡Más ayudantes! Necesito a alguien que sujete el frasco que explota.', 'More assistants! I need someone to hold the exploding flask.'],
    ['Bienvenidos al laboratorio. Las cejas vuelven a crecer, tranquilos.', 'Welcome to the lab. Eyebrows grow back, do not worry.'],
    ['¡Más manos, más mezclas, más magia!', 'More hands, more mixtures, more magic!'],
  ],
  buildWall: [
    ['Muralla reforzada con mi argamasa especial. Casi nunca explota.', 'Wall reinforced with my special mortar. It almost never explodes.'],
    ['¡Ladrillos de vidrio fundido! Brillan de noche.', 'Bricks of molten glass! They glow at night.'],
    ['¡Mira qué grosor! Necesitaré una regla más grande.', 'Look at that thickness! I will need a bigger ruler.'],
  ],
  buildKeep: [
    ['¡Otro piso para el laboratorio! Con ventilación, esta vez.', 'Another floor for the lab! With ventilation, this time.'],
    ['El torreón crece. Como el moho de mi cuarto frasco.', 'The keep is growing. Like the mould in my fourth flask.'],
    ['¡Resultados excelentes! Anoto: crecer funciona.', 'Excellent results! Noted: growing works.'],
  ],
  hitDealt: [
    ['¡Bum! Perdón. ¡Bum otra vez!', 'Boom! Sorry. Boom again!'],
    ['Reacción exotérmica confirmada. ¡Qué bonito!', 'Exothermic reaction confirmed. How lovely!'],
    ['Por la ciencia. Lo siento. Bueno, no tanto.', 'For science. Sorry. Well, not that sorry.'],
  ],
  hitTaken: [
    ['¡Mis probetas! ¡Esas estaban calibradas!', 'My test tubes! Those were calibrated!'],
    ['¡Cuidado con el estante! Ahí guardo lo que no tiene nombre.', 'Mind the shelf! That is where I keep the things with no name.'],
    ['Ay, ay, ay. Eso va a dejar un cráter muy interesante.', 'Oh dear. That is going to leave a very interesting crater.'],
    ['¡Mi alambique de cobre! ¿Sabes cuánto cuesta calibrarlo?', 'My copper still! Do you know how much it costs to calibrate?'],
  ],
  combo: [
    ['¡Reacción en cadena! ¡Justo como en mis notas!', 'Chain reaction! Exactly like in my notes!'],
    ['Un poco de esto, una pizca de aquello... ¡Eureka!', 'A bit of this, a pinch of that... Eureka!'],
    ['¡Catalizador perfecto! Que alguien lo apunte.', 'Perfect catalyst! Someone write that down.'],
  ],
  ultimate: [
    ['¡Tres gotas de esto y el mundo cambia de color!', 'Three drops of this and the world changes colour!'],
    ['¡Atrás todos! ¡No sé exactamente qué va a pasar!', 'Stand back, everyone! I do not know exactly what will happen!'],
    ['¡Oro, plomo, caos! Todo a la vez.', 'Gold, lead, chaos! All at once.'],
  ],
  backfire: [
    ['¡Ups! Resultado negativo. También cuenta.', 'Oops! Negative result. It still counts.'],
    ['Mis cejas... Otra vez.', 'My eyebrows... Again.'],
    ['No era el resultado esperado. ¡Pero menudo resultado!', 'Not the expected result. But what a result!'],
  ],
  nearVictory: [
    ['¡La fórmula casi está completa! Un ingrediente más.', 'The formula is nearly complete! One more ingredient.'],
    ['Predigo mi victoria con un noventa y siete por ciento de confianza.', 'I predict my victory with ninety-seven percent confidence.'],
    ['¡Ya casi! Que alguien vaya enfriando el champán. Bueno, el ácido.', 'Almost there! Someone chill the champagne. Well, the acid.'],
  ],
  rivalWorkers: [
    ['¿Contratando? Yo les ofrezco el doble y gafas protectoras.', 'Hiring? I will offer them double and safety goggles.'],
    ['Interesante. ¿Les has explicado lo de las explosiones?', 'Interesting. Did you tell them about the explosions?'],
    ['Anoto: el sujeto acumula personal. Sospechoso.', 'Noted: the subject is stockpiling staff. Suspicious.'],
  ],
  rivalWall: [
    ['¡Qué muralla! ¿A qué temperatura se derretirá?', 'What a wall! I wonder at what temperature it melts.'],
    ['Piedra, piedra y más piedra. ¡Qué aburrido!', 'Stone, stone and more stone. How boring!'],
    ['Fascinante. Ahora tendré que hacer un ácido más fuerte.', 'Fascinating. Now I will have to make a stronger acid.'],
  ],
  rivalKeep: [
    ['¡Qué alto! Perfecto para probar la gravedad.', 'So tall! Perfect for testing gravity.'],
    ['Si sigue creciendo, tendré que sacar el frasco grande.', 'If it keeps growing, I will have to bring out the big flask.'],
    ['Hipótesis: cuanto más alto, más bonito explota.', 'Hypothesis: the taller it is, the prettier it explodes.'],
  ],
  rivalCombo: [
    ['¡Oye, esa combinación es mía! ¿Me espías el cuaderno?', 'Hey, that combination is mine! Are you peeking at my notebook?'],
    ['Ooh. Elegante. Lo voy a plagiar.', 'Ooh. Elegant. I am going to plagiarise that.'],
    ['Reacción impresionante. Lástima que sea en mi contra.', 'Impressive reaction. Shame it is against me.'],
  ],
  rivalUltimate: [
    ['¡Fascinante! ¡Y aterrador! Pero sobre todo, ¡fascinante!', 'Fascinating! And terrifying! But mostly fascinating!'],
    ['¡Que alguien tome medidas! ¡Y luego que corra!', 'Someone take measurements! And then run!'],
    ['Eso... no sale en ninguno de mis libros.', 'That... is not in any of my books.'],
  ],
  rivalNearVictory: [
    ['¡Ese torreón se está saliendo de mi gráfica!', 'That keep is going off my chart!'],
    ['Cálculo rápido: o actúo ya, o pierdo. Actúo.', 'Quick calculation: either I act now or I lose. Acting.'],
    ['Necesito una explosión grande. Muy grande. Enorme.', 'I need a big explosion. Very big. Enormous.'],
  ],
  burned: [
    ['¡Ay, no! ¡Mis componentes no pueden calentarse!', 'Oh no! My components cannot get hot!'],
    ['¡El fuego, lejos del azufre! ¡LEJOS DEL AZUFRE!', 'Keep the fire away from the sulphur! AWAY FROM THE SULPHUR!'],
    ['La temperatura sube... ¡y yo sin apuntarlo!', 'The temperature is rising... and I am not writing it down!'],
    ['¡Si se calienta el frasco azul, salimos todos volando!', 'If the blue flask heats up, we all go flying!'],
  ],
  frozen: [
    ['¡Mis soluciones se cristalizan! ¡Qué bonito! ¡Qué horror!', 'My solutions are crystallising! How lovely! How horrible!'],
    ['A esta temperatura no reacciona nada. ¡Ni yo!', 'At this temperature nothing reacts. Not even me!'],
    ['¿Quién me ha metido el laboratorio en la nevera?', 'Who put my lab in the icebox?'],
  ],
  rusted: [
    ['¡Óxido! Oxidación pura. Te lo explicaría, pero estoy enfadado.', 'Rust! Pure oxidation. I would explain it, but I am angry.'],
    ['Mis alambiques de cobre... ¡Verdes! ¡Todos verdes!', 'My copper stills... Green! All green!'],
    ['Hierro, más oxígeno, más tú: un mal día.', 'Iron, plus oxygen, plus you: a bad day.'],
  ],
  robbed: [
    ['¡Eso no se toca! ¡Ni yo sé lo que lleva!', 'Do not touch that! Even I do not know what is in it!'],
    ['¡Ladrón! Ojalá te hayas llevado el frasco que pica.', 'Thief! I hope you took the itchy flask.'],
    ['Me has robado reactivos. Que conste que algunos son venenosos.', 'You stole my reagents. For the record, some are poisonous.'],
  ],
  discarded: [
    ['¡Mis notas! ¡Diez años de investigación a la basura!', 'My notes! Ten years of research in the bin!'],
    ['Tranquilos, tengo copias. Creo. Tal vez.', 'Relax, I have copies. I think. Maybe.'],
    ['¡Esa era la receta de la piedra filosofal! Bueno, de una sopa.', 'That was the recipe for the philosopher’s stone! Well, for a soup.'],
  ],
  wallDown: [
    ['¡Muralla evaporada! Anoto: mezclé mal la argamasa.', 'Wall evaporated! Noted: I mixed the mortar wrong.'],
    ['Sin muralla. Ahora el laboratorio tiene vistas.', 'No wall. Now the lab has a view.'],
    ['¡Necesito más piedra! ¡Y más frascos! ¡Y un plan!', 'I need more stone! And more flasks! And a plan!'],
  ],
  keepLow: [
    ['¡Que nadie toque el estante de arriba! ¡Ni respiréis!', 'Nobody touch the top shelf! Do not even breathe!'],
    ['Situación crítica. Me encanta. No, en serio, me aterra.', 'Critical situation. I love it. No, seriously, I am terrified.'],
    ['Último recurso: mezclarlo todo y rezar.', 'Last resort: mix everything and pray.'],
  ],
  shieldBlock: [
    ['¡Repelido! Mi gel protector funciona.', 'Repelled! My protective gel works.'],
    ['¡Ja! Escudo de mercurio. Patente en trámite.', 'Ha! Mercury shield. Patent pending.'],
    ['Rebotó. ¡Quiero volver a ver la trayectoria!', 'It bounced. I want to see the trajectory again!'],
  ],
  battleEvent: [
    ['¡Variables nuevas! ¡Me encantan las variables!', 'New variables! I love variables!'],
    ['¡El experimento se complica! ¡Qué emoción!', 'The experiment gets complicated! How exciting!'],
    ['Esto no estaba en mi modelo. Rehaciendo el modelo...', 'That was not in my model. Redoing the model...'],
  ],
  twilight: [
    ['Ese cielo rojo no es química. Y eso me asusta.', 'That red sky is not chemistry. And that scares me.'],
    ['Anoto: el Ocaso existe. Anoto: tengo miedo.', 'Noted: the Twilight is real. Noted: I am scared.'],
    ['¡Un frasco vacío, rápido! Quiero una muestra.', 'An empty flask, quick! I want a sample.'],
  ],
};

const saboteadora: Lines = {
  start: [
    ['No te preocupes, no he tocado tu mazo. Mucho.', 'Do not worry, I have not touched your deck. Much.'],
    ['¿Empezamos? Yo ya llevo un rato.', 'Shall we start? I have been at it for a while.'],
    ['Cuenta tus cartas ahora. Luego no te van a salir las cuentas.', 'Count your cards now. Later they will not add up.'],
  ],
  workers: [
    ['Chicos nuevos en la banda. Les enseñaré a abrir cerraduras.', 'New kids in the crew. I will teach them to pick locks.'],
    ['Más manos. Más bolsillos.', 'More hands. More pockets.'],
    ['Los contraté baratos. Bueno, se los quité a alguien.', 'I hired them cheap. Well, I took them from someone.'],
  ],
  buildWall: [
    ['No es para protegerme. Es para que no veas mis planes.', 'It is not to protect me. It is so you cannot see my plans.'],
    ['Ladrillos de segunda mano. No preguntes de dónde.', 'Second-hand bricks. Do not ask where from.'],
    ['Una muralla. Para esconder lo que me llevo.', 'A wall. To hide what I take.'],
  ],
  buildKeep: [
    ['Más alto. Para verte mejor los bolsillos.', 'Taller. The better to see your pockets.'],
    ['Mi torre favorita. La hice con tus piedras.', 'My favourite tower. I built it with your stones.'],
    ['Arriba, arriba. Que se vea quién manda.', 'Up, up. Let them see who is in charge.'],
  ],
  hitDealt: [
    ['Uy. ¿Eso era importante?', 'Oops. Was that important?'],
    ['Mecha corta, explosión larga.', 'Short fuse, long explosion.'],
    ['Te avisé. Bueno, no. Pero lo pensé.', 'I warned you. Well, no. But I thought about it.'],
  ],
  hitTaken: [
    ['¡Oye! Eso lo tenía que hacer yo.', 'Hey! I was supposed to do that.'],
    ['Vale, esa me la apunto. Con intereses.', 'Fine, I am writing that one down. With interest.'],
    ['Ay. Ay. Vale. Ya no me caes bien.', 'Ow. Ow. Okay. I do not like you anymore.'],
    ['¿A mí? ¿Con mis propios trucos? Qué falta de respeto.', 'Me? With my own tricks? How disrespectful.'],
  ],
  combo: [
    ['Distraer, desarmar, desaparecer. Mi especialidad.', 'Distract, disarm, disappear. My speciality.'],
    ['¿Lo has visto venir? Claro que no.', 'Did you see that coming? Of course not.'],
    ['Una trampa dentro de otra trampa. Qué orgullo.', 'A trap inside another trap. So proud.'],
  ],
  ultimate: [
    ['¡Encended las mechas! Todas.', 'Light the fuses! All of them.'],
    ['Esto lo guardaba en la manga. Literalmente.', 'I had this up my sleeve. Literally.'],
    ['Tápate los oídos. O no, me da igual.', 'Cover your ears. Or do not, I do not care.'],
  ],
  backfire: [
    ['¡Eso no ha pasado! Nadie ha visto nada.', 'That did not happen! Nobody saw anything.'],
    ['Mecha demasiado corta. Ironías de la vida.', 'Fuse too short. Life is ironic.'],
    ['Ay... Mi flequillo.', 'Ow... My fringe.'],
  ],
  nearVictory: [
    ['Ya casi. Y sin que te dieras cuenta.', 'Almost there. And you did not even notice.'],
    ['¿Oyes eso? Es tu derrota. Y mis bolsillos llenándose.', 'Hear that? It is your defeat. And my pockets filling up.'],
    ['Ve despidiéndote de tu castillo. Le daré buen uso.', 'Say goodbye to your castle. I will put it to good use.'],
  ],
  rivalWorkers: [
    ['Qué buena plantilla. Sería una pena que se vinieran conmigo.', 'What a nice crew. Shame if they came with me.'],
    ['¿Más trabajadores? Me encanta. Más cosas que robar.', 'More workers? Love it. More things to steal.'],
    ['Les pagaré el doble. Con tu dinero.', 'I will pay them double. With your money.'],
  ],
  rivalWall: [
    ['Bonita muralla. Yo voy por debajo.', 'Nice wall. I go under.'],
    ['Las murallas no me paran. Me dan sombra.', 'Walls do not stop me. They give me shade.'],
    ['Cuanto más alta, más ruido hace al caer.', 'The taller it is, the louder it falls.'],
  ],
  rivalKeep: [
    ['Ooh, qué torre. ¿Tiene sótano? Pregunto por nada.', 'Ooh, what a tower. Does it have a basement? Just asking.'],
    ['Altísima. Ideal para dejarle un barril en la base.', 'Very tall. Ideal for leaving a barrel at the base.'],
    ['No le cojas cariño a ese torreón.', 'Do not get attached to that keep.'],
  ],
  rivalCombo: [
    ['Eh, eh, eh. Las trampas las pongo yo.', 'Hey, hey, hey. I am the one who sets traps.'],
    ['¿Quién te ha enseñado eso? Dímelo y lo despido.', 'Who taught you that? Tell me and I will fire them.'],
    ['Vale, esa estuvo buena. No se lo cuentes a nadie.', 'Okay, that was good. Do not tell anyone.'],
  ],
  rivalUltimate: [
    ['Uy. Me escondo un momentito.', 'Oops. I will just hide for a second.'],
    ['¡Eso es trampa! Y de trampas yo sé.', 'That is cheating! And I know cheating.'],
    ['Mucho brillo. Poco sigilo.', 'Lots of shine. Little stealth.'],
  ],
  rivalNearVictory: [
    ['Ese castillo está muy alto. Necesito un barril más grande.', 'That castle is too tall. I need a bigger barrel.'],
    ['No cantes victoria. Todavía me quedan cerillas.', 'Do not celebrate yet. I still have matches.'],
    ['Vale. Plan B. ¿Cuál era el plan B?', 'Okay. Plan B. What was plan B?'],
  ],
  burned: [
    ['¡Fuego! ¡Que alguien aparte los barriles! ¡YA!', 'Fire! Someone move the barrels! NOW!'],
    ['Siempre jugando con fuego y hoy me quemo yo. Qué injusticia.', 'Always playing with fire and today I am the one who gets burned. So unfair.'],
    ['Ese incendio lo tenía que provocar yo.', 'I was supposed to start that fire.'],
  ],
  frozen: [
    ['¡Se me han congelado las mechas! ¿Sabes lo que cuesta encenderlas?', 'My fuses are frozen! Do you know how hard they are to light?'],
    ['Dedos helados, cerraduras imposibles. Genial.', 'Frozen fingers, impossible locks. Great.'],
    ['El hielo es malo para el negocio.', 'Ice is bad for business.'],
  ],
  rusted: [
    ['¡Mis ganzúas! Oxidadas. Esto es un ataque personal.', 'My lockpicks! Rusted. This is a personal attack.'],
    ['Óxido en mis trampas. Ahora chirrían.', 'Rust on my traps. Now they squeak.'],
    ['Una trampa oxidada es una trampa que avisa.', 'A rusty trap is a trap that warns you.'],
  ],
  robbed: [
    ['¿Me robas a MÍ? Qué valor. Casi me caes bien.', 'You rob ME? What nerve. I almost like you.'],
    ['Eso que te llevas ya era robado. Que lo sepas.', 'What you took was already stolen. Just so you know.'],
    ['Aficionado. Te has dejado las huellas.', 'Amateur. You left fingerprints.'],
  ],
  discarded: [
    ['¿Mis cartas? ¡Me costó mucho robarlas!', 'My cards? It took me ages to steal those!'],
    ['No pasa nada. Llevo más en la bota.', 'No problem. I have more in my boot.'],
    ['Me lo estás haciendo a mí. A MÍ.', 'You are doing this to me. To ME.'],
  ],
  wallDown: [
    ['Sin muralla. Bueno, nunca me gustaron las puertas.', 'No wall. Well, I never liked doors.'],
    ['Genial, ahora se me ve todo. Qué vergüenza.', 'Great, now everyone can see everything. How embarrassing.'],
    ['Muralla caída. Pero mis túneles siguen ahí.', 'Wall is down. But my tunnels are still there.'],
  ],
  keepLow: [
    ['Esto no es una retirada. Es una huida estratégica.', 'This is not a retreat. It is a strategic escape.'],
    ['Si me pillan, yo no he estado aquí.', 'If they catch me, I was never here.'],
    ['Me queda un truco. Siempre me queda un truco.', 'I have one trick left. I always have one trick left.'],
  ],
  shieldBlock: [
    ['¡Fallaste! Bueno, te hice fallar.', 'Missed! Well, I made you miss.'],
    ['Escudo robado. Funciona de maravilla.', 'Stolen shield. Works like a charm.'],
    ['Ni me has rozado.', 'You did not even touch me.'],
  ],
  battleEvent: [
    ['¡Caos! Mi clima favorito.', 'Chaos! My favourite weather.'],
    ['Cuando todos miran al cielo, yo miro los bolsillos.', 'When everyone looks at the sky, I look at the pockets.'],
    ['Esto no lo he provocado yo. Esta vez.', 'I did not cause this. This time.'],
  ],
  twilight: [
    ['Vale, ese cielo me da miedo hasta a mí.', 'Okay, that sky scares even me.'],
    ['El Ocaso. No hay bolsillo donde esconderse de eso.', 'The Twilight. There is no pocket to hide from that.'],
    ['Todo lo que brilla se apaga. Mejor me lo llevo antes.', 'Everything that shines goes dark. Better take it first.'],
  ],
};

const hechicera: Lines = {
  start: [
    ['Comencemos. El hielo tiene paciencia. Yo, algo menos.', 'Let us begin. The ice is patient. I am somewhat less so.'],
    ['Te concedo el primer movimiento. Será el último cómodo.', 'I grant you the first move. It will be your last comfortable one.'],
    ['Abrígate. Esto se va a poner frío.', 'Wrap up warm. This is going to get cold.'],
  ],
  workers: [
    ['Más aprendices. Los que sobrevivan, aprenderán.', 'More apprentices. Those who survive will learn.'],
    ['Siervos nuevos para la torre. Que no toquen mis libros.', 'New servants for the tower. Let them not touch my books.'],
    ['El poder necesita manos. Por desgracia.', 'Power needs hands. Unfortunately.'],
  ],
  buildWall: [
    ['Una muralla de escarcha. Bonita y cruel.', 'A wall of frost. Beautiful and cruel.'],
    ['Piedra helada. Tus flechas ni la arañan.', 'Frozen stone. Your arrows cannot even scratch it.'],
    ['Protejo mi torre como protejo mis secretos.', 'I guard my tower as I guard my secrets.'],
  ],
  buildKeep: [
    ['Mi torre sube hacia las estrellas. Ellas me esperan.', 'My tower rises to the stars. They are waiting for me.'],
    ['Más cerca del cielo, más lejos de ti.', 'Closer to the sky, farther from you.'],
    ['Cada piso, un hechizo. Cada hechizo, una amenaza.', 'Each floor, a spell. Each spell, a threat.'],
  ],
  hitDealt: [
    ['Arde. Luego congélate. En ese orden.', 'Burn. Then freeze. In that order.'],
    ['¿Duele? Debería.', 'Does it hurt? It should.'],
    ['He visto arder montañas. Tu muralla no es una montaña.', 'I have seen mountains burn. Your wall is no mountain.'],
  ],
  hitTaken: [
    ['Qué grosero. Lo recordaré.', 'How rude. I will remember that.'],
    ['Una herida más que cobrarte.', 'One more wound to collect from you.'],
    ['Ah. Eso me ha despeinado.', 'Ah. That has mussed my hair.'],
    ['Me has hecho sangrar. Hacía un siglo que nadie se atrevía.', 'You made me bleed. No one has dared in a century.'],
  ],
  combo: [
    ['Fuego y hielo en armonía. Hermoso, ¿verdad?', 'Fire and ice in harmony. Beautiful, is it not?'],
    ['Los hechizos se llaman unos a otros. Escucha.', 'Spells call to one another. Listen.'],
    ['Una nota, dos, tres... y la sinfonía.', 'One note, two, three... and the symphony.'],
  ],
  ultimate: [
    ['Siente el frío que no perdona.', 'Feel the cold that never forgives.'],
    ['Ahora verás arder el hielo.', 'Now you will see the ice burn.'],
    ['Arrodíllate. O congélate de pie. Tú eliges.', 'Kneel. Or freeze standing. Your choice.'],
  ],
  backfire: [
    ['Eso no ha pasado. Quien lo cuente, será estatua.', 'That did not happen. Whoever tells will become a statue.'],
    ['Pólvora. Qué cosa más vulgar.', 'Gunpowder. How vulgar.'],
    ['La magia nunca falla. Las chispas, a veces.', 'Magic never fails. Sparks sometimes do.'],
  ],
  nearVictory: [
    ['Ya casi. Puedes ir arrodillándote.', 'Almost there. You may start kneeling.'],
    ['El invierno llega a su cima. Y tú, a tu final.', 'Winter reaches its peak. And you, your end.'],
    ['Siente cómo baja la temperatura. Es tu final.', 'Feel the temperature drop. That is your end.'],
  ],
  rivalWorkers: [
    ['Más siervos. Más bocas que alimentar en invierno.', 'More servants. More mouths to feed in winter.'],
    ['Contrata a quien quieras. El frío los despedirá.', 'Hire whoever you like. The cold will dismiss them.'],
    ['Qué esfuerzo tan... mortal.', 'Such a... mortal effort.'],
  ],
  rivalWall: [
    ['Más piedra. Qué tierno. La piedra se agrieta cuando hiela.', 'More stone. How sweet. Stone cracks when it freezes.'],
    ['Te escondes detrás de ladrillos. Qué previsible.', 'You hide behind bricks. How predictable.'],
    ['Muy alta. Perfecta para cubrirla de escarcha.', 'Very tall. Perfect for coating in frost.'],
  ],
  rivalKeep: [
    ['Una torre para mirarme de cerca. Qué atrevimiento.', 'A tower to look me in the eye. How bold.'],
    ['Cuanto más subes, más frío hace allá arriba.', 'The higher you climb, the colder it gets up there.'],
    ['Bonita torre. En ruinas quedará preciosa.', 'Pretty tower. It will look lovely in ruins.'],
  ],
  rivalCombo: [
    ['Vaya. Has aprendido a encadenar. Qué orgullo... ajeno.', 'Well. You have learned to chain. How proud... for someone else.'],
    ['Ingenioso. Para ser tú.', 'Clever. For you.'],
    ['Un truco de salón. Yo hago magia.', 'A parlour trick. I do magic.'],
  ],
  rivalUltimate: [
    ['Ah, por fin algo interesante.', 'Ah, finally something interesting.'],
    ['Todo ese poder... Tan mal usado.', 'All that power... So poorly used.'],
    ['Me has hecho fruncir el ceño. Enhorabuena.', 'You made me frown. Congratulations.'],
  ],
  rivalNearVictory: [
    ['Tu torre roza el cielo. El cielo es mío.', 'Your tower brushes the sky. The sky is mine.'],
    ['No tan deprisa. El invierno no ha terminado.', 'Not so fast. Winter is not over.'],
    ['Casi. Casi. Qué palabra tan frágil.', 'Almost. Almost. Such a fragile word.'],
  ],
  burned: [
    ['¿Fuego? ¿A mí? Yo soy el fuego.', 'Fire? On me? I am the fire.'],
    ['Qué atrevimiento, quemar a la que quema.', 'What nerve, burning the one who burns.'],
    ['Mis tapices... Eran del siglo pasado.', 'My tapestries... They were from the last century.'],
  ],
  frozen: [
    ['¿Hielo? ¿Contra mí? Qué adorable.', 'Ice? Against me? How adorable.'],
    ['Me haces cosquillas.', 'That tickles.'],
    ['Te devolveré este frío multiplicado.', 'I will return this cold, multiplied.'],
  ],
  rusted: [
    ['Óxido. La magia de los pobres.', 'Rust. The magic of the poor.'],
    ['Mis cerrojos rechinan. Odio que rechinen.', 'My bolts creak. I hate it when they creak.'],
    ['El tiempo lo oxida todo. Menos mi rencor.', 'Time rusts everything. Except my grudges.'],
  ],
  robbed: [
    ['Devuélvemelo. Ahora. Antes de que se te hielen las manos.', 'Give it back. Now. Before your hands freeze.'],
    ['Le has robado a una hechicera. Reza.', 'You robbed a sorceress. Pray.'],
    ['Lo que me quitas lo cobraré con intereses. Helados.', 'What you take I will collect with interest. Frozen.'],
  ],
  discarded: [
    ['¿Mis grimorios? ¿Al suelo? Inaceptable.', 'My grimoires? On the floor? Unacceptable.'],
    ['Esos hechizos me costaron un siglo.', 'Those spells cost me a century.'],
    ['No importa. Los recuerdo todos. Y a ti también.', 'No matter. I remember them all. And you as well.'],
  ],
  wallDown: [
    ['Mi muralla... No importa. El hielo vuelve a crecer.', 'My wall... It does not matter. Ice grows back.'],
    ['Muy bien. Ahora me ves sin velo.', 'Very well. Now you see me unveiled.'],
    ['Has roto mi muralla. Y mi paciencia.', 'You broke my wall. And my patience.'],
  ],
  keepLow: [
    ['Interesante. Hacía siglos que nadie me arañaba.', 'Interesting. It has been centuries since anyone scratched me.'],
    ['Todo se consume... No, yo no. Todavía no.', 'Everything burns away... No, not me. Not yet.'],
    ['Me estás haciendo enfadar. No te va a gustar.', 'You are making me angry. You will not like it.'],
  ],
  shieldBlock: [
    ['Ni un rasguño. Como era de esperar.', 'Not a scratch. As expected.'],
    ['¿Eso era un ataque? Perdona, no me di cuenta.', 'Was that an attack? Sorry, I did not notice.'],
    ['Mi escudo se aburre.', 'My shield is bored.'],
  ],
  battleEvent: [
    ['Ah, el mundo se agita. Qué entretenido.', 'Ah, the world stirs. How entertaining.'],
    ['Los elementos me obedecen. Este, de momento, no.', 'The elements obey me. This one, for now, does not.'],
    ['Observa y aprende: así cambia el viento.', 'Watch and learn: this is how the wind turns.'],
  ],
  twilight: [
    ['El Ocaso despierta. Hasta mi hielo tiembla.', 'The Twilight wakes. Even my ice trembles.'],
    ['Lo siento en la sangre. Viene a por todos.', 'I feel it in my blood. It is coming for us all.'],
    ['Un fuego más antiguo que el mío. Qué humillante.', 'A fire older than mine. How humiliating.'],
  ],
};

const mariscal: Lines = {
  start: [
    ['¡Tambores! ¡Formación! A la carga.', 'Drums! Formation! Charge.'],
    ['Te daré una lección de estrategia. Gratis.', 'I will give you a lesson in strategy. Free of charge.'],
    ['Firmes. Esto acabará antes del almuerzo.', 'Steady. This will be over before lunch.'],
  ],
  workers: [
    ['¡Reclutas nuevos! Mañana, instrucción a las cinco.', 'New recruits! Drill at five tomorrow.'],
    ['Más brazos para las catapultas.', 'More arms for the catapults.'],
    ['¿Saben marchar? Aprenderán.', 'Can they march? They will learn.'],
  ],
  buildWall: [
    ['Una muralla es solo un sitio desde donde disparar.', 'A wall is just a place to shoot from.'],
    ['Fortificación lista. Ahora, a lo importante: atacar.', 'Fortification ready. Now for what matters: attacking.'],
    ['Ni tus mejores arietes pasarán por ahí.', 'Not even your best rams will get through that.'],
  ],
  buildKeep: [
    ['El cuartel general crece. Mi paciencia, no.', 'Headquarters grows. My patience does not.'],
    ['Un torreón alto para ver mejor el campo de batalla.', 'A tall keep to see the battlefield better.'],
    ['Más alto que tus esperanzas.', 'Taller than your hopes.'],
  ],
  hitDealt: [
    ['¡Brecha abierta! ¡Adelante!', 'Breach open! Forward!'],
    ['¡Mirad cómo vuela esa almena!', 'Look at that battlement fly!'],
    ['Eso, soldado, es un asalto.', 'That, soldier, is an assault.'],
    ['¡Otra andanada! ¡No les dejéis respirar!', 'Another volley! Do not let them breathe!'],
  ],
  hitTaken: [
    ['¡Mantened la posición! Solo es un rasguño.', 'Hold the line! It is only a scratch.'],
    ['Buen golpe. Ahora me toca a mí.', 'Good hit. Now it is my turn.'],
    ['¿Quién estaba de guardia? ¡Que limpie letrinas un mes!', 'Who was on watch? Latrine duty for a month!'],
    ['Eso dolió. A ti te dolerá más.', 'That hurt. It will hurt you more.'],
  ],
  combo: [
    ['Ataque coordinado. Así se gana una guerra.', 'Coordinated attack. That is how a war is won.'],
    ['Flanco izquierdo, flanco derecho... ¡y al centro!', 'Left flank, right flank... and the centre!'],
    ['Disciplina. Cada carta obedece.', 'Discipline. Every card obeys.'],
  ],
  ultimate: [
    ['¡Que suenen los tambores!', 'Sound the drums!'],
    ['¡Todos a la brecha! ¡Sin piedad!', 'Everyone to the breach! No mercy!'],
    ['¡Arietes, catapultas, todo! ¡Ahora!', 'Rams, catapults, everything! Now!'],
  ],
  backfire: [
    ['¡¿Quién ha cargado ese barril?! ¡Al calabozo!', 'Who loaded that barrel?! To the dungeon!'],
    ['Fuego amigo. El peor tipo de fuego.', 'Friendly fire. The worst kind of fire.'],
    ['Esto no consta en el informe. ¿Entendido?', 'This does not go in the report. Understood?'],
  ],
  nearVictory: [
    ['La victoria está a un paso. ¡Marchad!', 'Victory is one step away. March!'],
    ['Ríndete y te concederé una retirada digna.', 'Surrender and I will grant you a dignified retreat.'],
    ['Preparad las banderas. Hoy se celebra.', 'Ready the banners. Today we celebrate.'],
  ],
  rivalWorkers: [
    ['¿Obreros? Yo recluto soldados.', 'Workers? I recruit soldiers.'],
    ['Más gente que se me rendirá. Bien.', 'More people to surrender to me. Good.'],
    ['Contrata a cuantos quieras. No saben sujetar una lanza.', 'Hire as many as you like. They cannot hold a spear.'],
  ],
  rivalWall: [
    ['Construye, construye. Me encanta derribar.', 'Build, build. I love tearing down.'],
    ['Más muralla, más gloria al tumbarla.', 'More wall, more glory when it falls.'],
    ['Esa muralla no aguanta ni dos asaltos.', 'That wall will not last two assaults.'],
  ],
  rivalKeep: [
    ['Desde ahí arriba verás muy bien a mi ejército.', 'From up there you will see my army very well.'],
    ['Torre alta, blanco fácil.', 'Tall tower, easy target.'],
    ['Sube cuanto quieras. Mis catapultas tienen buen alcance.', 'Climb all you want. My catapults have good range.'],
  ],
  rivalCombo: [
    ['Buena maniobra. Para ser un civil.', 'Good manoeuvre. For a civilian.'],
    ['¿Tácticas? ¿Tú? Interesante.', 'Tactics? You? Interesting.'],
    ['Toma nota, sargento. Esa la copiamos.', 'Take note, sergeant. We are copying that one.'],
  ],
  rivalUltimate: [
    ['¡Cubríos! ¡Escudos arriba!', 'Take cover! Shields up!'],
    ['Mucho espectáculo. Las guerras se ganan con disciplina.', 'Lots of spectacle. Wars are won with discipline.'],
    ['Impresionante. Ahora, contraataque.', 'Impressive. Now, counterattack.'],
  ],
  rivalNearVictory: [
    ['¡Toda la artillería a esa torre!', 'All artillery on that tower!'],
    ['Aún no has ganado, civil.', 'You have not won yet, civilian.'],
    ['Sargento, cambio de planes: ataque total.', 'Sergeant, change of plans: all-out attack.'],
  ],
  burned: [
    ['¡Cubos! ¡Haced una cadena! ¡Rápido!', 'Buckets! Form a chain! Quickly!'],
    ['¡Mi estandarte! ¡Ha sobrevivido a tres guerras!', 'My standard! It survived three wars!'],
    ['El fuego no detiene a un ejército. Lo enfada.', 'Fire does not stop an army. It angers it.'],
  ],
  frozen: [
    ['¡Las ballestas se han congelado! ¡Calentadlas con el aliento!', 'The crossbows are frozen! Warm them with your breath!'],
    ['Un buen soldado también marcha sobre hielo.', 'A good soldier marches on ice too.'],
    ['Frío. Detesto las campañas de invierno.', 'Cold. I detest winter campaigns.'],
  ],
  rusted: [
    ['¡Óxido en las espadas! ¿Quién estaba de limpieza?', 'Rust on the swords! Who was on cleaning duty?'],
    ['Una espada oxidada corta igual. Bueno, casi.', 'A rusty sword cuts the same. Well, almost.'],
    ['Mi armadura chirría. Ahora me oirán llegar.', 'My armour creaks. Now they will hear me coming.'],
  ],
  robbed: [
    ['¡Saqueo en la intendencia! ¡Doblad la guardia!', 'Looting in the supply lines! Double the guard!'],
    ['Robarle a un ejército. O valiente o idiota.', 'Robbing an army. Either brave or stupid.'],
    ['Eso eran las raciones de mis hombres.', 'Those were my soldiers’ rations.'],
  ],
  discarded: [
    ['¡Mis planes de batalla! ¿Quién los ha tirado?', 'My battle plans! Who threw them out?'],
    ['No necesito mapas. Sé dónde está el enemigo.', 'I do not need maps. I know where the enemy is.'],
    ['Un general improvisa. Toma nota.', 'A general improvises. Take note.'],
  ],
  wallDown: [
    ['¡Ha caído la muralla! ¡Formad con los escudos!', 'The wall is down! Form up with shields!'],
    ['No necesito muros. Necesito soldados.', 'I do not need walls. I need soldiers.'],
    ['Ahora es campo abierto. Como a mí me gusta.', 'Now it is open ground. Just how I like it.'],
  ],
  keepLow: [
    ['¡Que nadie se retire! ¡Nadie!', 'No one retreats! No one!'],
    ['He ganado batallas en peores condiciones. Creo.', 'I have won battles in worse conditions. I think.'],
    ['Esto no es una derrota. Es un repliegue con estilo.', 'This is not a defeat. It is a stylish withdrawal.'],
  ],
  shieldBlock: [
    ['¡Bloqueado! ¡Contraataque!', 'Blocked! Counterattack!'],
    ['Ni un paso atrás.', 'Not one step back.'],
    ['Así se aguanta una carga.', 'That is how you hold a charge.'],
  ],
  battleEvent: [
    ['Cambia el terreno. Reajustad la formación.', 'The ground changes. Adjust the formation.'],
    ['Un buen general aprovecha el clima.', 'A good general uses the weather.'],
    ['¡Atentos! Esto cambia la batalla.', 'Look sharp! This changes the battle.'],
  ],
  twilight: [
    ['El Ocaso. Por esto necesitaba un ejército.', 'The Twilight. This is why I needed an army.'],
    ['Ningún soldado está preparado para eso.', 'No soldier is ready for that.'],
    ['Cerrad filas. Lo que viene no tiene piedad.', 'Close ranks. What is coming has no mercy.'],
  ],
};

export const REACTION_LINES: Record<string, Lines> = { arquitecta, guardian, alquimista, saboteadora, hechicera, mariscal };
