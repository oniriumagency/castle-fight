import type { ReactionKind } from './reactionLines';

/**
 * What each campaign captain says in a speech bubble during their battle.
 * Every captain has a voice of their own, so no two share a line, and none
 * borrows their hero's. Each line is [Spanish, English].
 *
 * Captains have fewer moments than heroes: `build` covers their own Wall,
 * Castle and workers, `rivalBuild` the player's, and `ailment` fire, frost,
 * rust, theft and discards. A moment a captain has no line for passes in
 * silence.
 */
export type CaptainMoment =
  | 'start'
  | 'hitDealt'
  | 'hitTaken'
  | 'wallDown'
  | 'keepLow'
  | 'nearVictory'
  | 'rivalNearVictory'
  | 'rivalUltimate'
  | 'rivalCombo'
  | 'combo'
  | 'build'
  | 'rivalBuild'
  | 'ailment'
  | 'battleEvent';

/** Which captain moment a match moment falls under. */
export const CAPTAIN_MOMENT: Partial<Record<ReactionKind, CaptainMoment>> = {
  start: 'start',
  hitDealt: 'hitDealt',
  hitTaken: 'hitTaken',
  wallDown: 'wallDown',
  keepLow: 'keepLow',
  nearVictory: 'nearVictory',
  rivalNearVictory: 'rivalNearVictory',
  rivalUltimate: 'rivalUltimate',
  rivalCombo: 'rivalCombo',
  combo: 'combo',
  buildWall: 'build',
  buildKeep: 'build',
  workers: 'build',
  rivalWall: 'rivalBuild',
  rivalKeep: 'rivalBuild',
  rivalWorkers: 'rivalBuild',
  burned: 'ailment',
  frozen: 'ailment',
  rusted: 'ailment',
  robbed: 'ailment',
  discarded: 'ailment',
  battleEvent: 'battleEvent',
  twilight: 'battleEvent',
};

type Lines = Partial<Record<CaptainMoment, [string, string][]>>;

export const CAPTAIN_LINES: Record<string, Lines> = {
  // --- Azure Bastion -------------------------------------------------------

  /** A knight of rules and permits: everything needs a stamp. */
  'Sir Brannoc': {
    start: [
      ['¿Nombre? ¿Motivo de la visita? Da igual: denegado.', 'Name? Purpose of visit? Never mind: denied.'],
      ['Este vado tiene normas. La primera: no pasarás.', 'This ford has rules. Rule one: you shall not pass.'],
    ],
    hitDealt: [
      ['Multa por cruzar sin permiso. Pagada en piedra.', 'Fine for crossing without leave. Paid in stone.'],
      ['Eso, por saltarte la cola.', 'That is for jumping the queue.'],
    ],
    hitTaken: [
      ['¡Eso no está autorizado!', 'That is not authorised!'],
      ['Pienso dar parte de esto. Por triplicado.', 'I will be reporting this. In triplicate.'],
    ],
    wallDown: [
      ['Mi muralla... ¡Tenía todos los sellos en regla!', 'My wall... It had every stamp in order!'],
      ['Que conste en acta: la muralla cayó con honor.', 'Let the record show: the wall fell with honour.'],
    ],
    keepLow: [
      ['Solicito refuerzos. Formulario urgente.', 'Requesting reinforcements. Urgent form.'],
      ['No cederé el vado. Ni aunque me lo pidas por escrito.', 'I will not yield the ford. Not even if you ask in writing.'],
    ],
    nearVictory: [
      ['Expediente casi cerrado. Firma aquí tu derrota.', 'File nearly closed. Sign your defeat here.'],
      ['Permiso para ganar: concedido. Por mí.', 'Permission to win: granted. By me.'],
    ],
    rivalNearVictory: [
      ['¡Alto ahí! ¿Quién te ha dado permiso para crecer tanto?', 'Halt! Who gave you leave to grow that tall?'],
      ['Esto es irregular. Muy irregular.', 'This is irregular. Most irregular.'],
    ],
    rivalUltimate: [
      ['¡Eso no figura en el reglamento!', 'That is nowhere in the regulations!'],
      ['¿Un poder así, sin licencia? ¡Escándalo!', 'Power like that, without a licence? Outrageous!'],
    ],
    rivalCombo: [
      ['Muy listo. Te pongo una sanción igualmente.', 'Very clever. I am fining you anyway.'],
      ['Jugadas encadenadas... ¿Eso está permitido?', 'Chained plays... Is that even allowed?'],
    ],
    build: [
      ['Obra aprobada. Sellada. Levantada.', 'Works approved. Stamped. Raised.'],
      ['Ampliación reglamentaria de la muralla.', 'Regulation extension of the wall.'],
    ],
    rivalBuild: [
      ['¿Tienes licencia de obra para eso?', 'Do you have planning permission for that?'],
      ['Esa construcción no consta en mis registros.', 'That building is not in my records.'],
    ],
    ailment: [
      ['¡Esto es un atropello administrativo!', 'This is an administrative outrage!'],
      ['Anotado. Sabotaje, artículo cuarto.', 'Noted. Sabotage, article four.'],
    ],
    battleEvent: [['Cambio de condiciones. Habrá que actualizar el reglamento.', 'Change of conditions. The regulations will need updating.']],
  },

  /** The watchtower's lookout: calm, precise, misses nothing. */
  'Dama Elowen': {
    start: [
      ['Te tengo a la vista desde hace rato. Empecemos.', 'I have had you in sight for a while. Let us begin.'],
      ['Viento del oeste, cielo limpio. Buen día para verte caer.', 'West wind, clear sky. A good day to watch you fall.'],
    ],
    hitDealt: [
      ['Justo donde apunté.', 'Exactly where I aimed.'],
      ['Desde la atalaya se ve todo. Sobre todo tus huecos.', 'From the tower you see everything. Especially your gaps.'],
    ],
    hitTaken: [
      ['No lo vi venir. Y yo lo veo todo.', 'I did not see that coming. And I see everything.'],
      ['Corrijo la distancia. No volverá a pasar.', 'Adjusting for range. It will not happen again.'],
    ],
    wallDown: [
      ['La muralla ha caído. La vista mejora, al menos.', 'The wall is down. The view is better, at least.'],
      ['Sin muralla, pero con buena puntería.', 'No wall, but a good aim.'],
    ],
    keepLow: [
      ['Que enciendan la señal. La atalaya resiste.', 'Light the signal. The tower holds.'],
      ['Me queda una flecha. Me basta con una.', 'I have one arrow left. One is enough.'],
    ],
    nearVictory: [
      ['Ya veo el final desde aquí arriba.', 'I can see the end from up here.'],
      ['Un disparo más y bajo a recoger lo que quede.', 'One more shot and I come down to collect what is left.'],
    ],
    rivalNearVictory: [
      ['Tu torre me tapa el horizonte. No me gusta.', 'Your tower blocks my horizon. I do not like it.'],
      ['Objetivo grande, lento y alto. Ajustando el tiro.', 'Big, slow, tall target. Adjusting my aim.'],
    ],
    rivalUltimate: [
      ['Eso se ha visto desde tres reinos.', 'That was seen from three kingdoms.'],
      ['Señal de alarma. Todas a la vez.', 'Alarm signal. All of them at once.'],
    ],
    rivalCombo: [
      ['Bien calculado. Lo apunto en mi cuaderno de guardia.', 'Well judged. I am noting it in my watch log.'],
      ['Tres movimientos seguidos. Te estaba vigilando, y aun así.', 'Three moves in a row. I was watching you, and still.'],
    ],
    build: [
      ['Más altura, más alcance.', 'More height, more range.'],
      ['Otro piso a la atalaya. Ahora veo hasta tu cocina.', 'Another floor on the tower. Now I can see your kitchen.'],
    ],
    rivalBuild: [
      ['Muro nuevo. Lo tengo marcado.', 'New wall. I have it marked.'],
      ['Construye. Así tendré más donde apuntar.', 'Build away. It gives me more to aim at.'],
    ],
    ailment: [
      ['Me has nublado la vista. Por poco tiempo.', 'You have clouded my sight. Not for long.'],
      ['Un golpe bajo. Lo he visto, que conste.', 'A low blow. I saw it, for the record.'],
    ],
    battleEvent: [['Cambia el cielo. Lo dije hace tres días.', 'The sky is changing. I said so three days ago.']],
  },

  /** Proud of his grandparents, who held this gorge before him. */
  'Sir Tavish': {
    start: [
      ['Por mis abuelos. Y por los suyos.', 'For my grandparents. And for theirs.'],
      ['Mi abuela defendió este paso con una sartén. Yo tengo espada.', 'My grandmother held this pass with a frying pan. I have a sword.'],
    ],
    hitDealt: [
      ['¡Eso, por el abuelo Tobías!', 'That one is for Grandpa Tobias!'],
      ['Golpe de familia. Lo aprendí de niño.', 'A family blow. I learned it as a boy.'],
    ],
    hitTaken: [
      ['Mi abuelo aguantó peores. Creo.', 'My grandfather took worse. I think.'],
      ['Si me viera mi abuela... Me regañaría.', 'If my grandmother saw this... She would scold me.'],
    ],
    wallDown: [
      ['Ese muro lo levantó mi bisabuelo. Qué vergüenza.', 'My great-grandfather raised that wall. How shameful.'],
      ['Cien años en pie, y tú lo tiras en una tarde.', 'A hundred years standing, and you knock it down in an afternoon.'],
    ],
    keepLow: [
      ['No seré yo quien lo pierda. No seré yo.', 'I will not be the one to lose it. I will not.'],
      ['Abuelos, dadme fuerzas.', 'Grandparents, give me strength.'],
    ],
    nearVictory: [
      ['Esta victoria irá al tapiz de la familia.', 'This victory goes on the family tapestry.'],
      ['Ya casi. El desfiladero sigue siendo nuestro.', 'Almost there. The gorge is still ours.'],
    ],
    rivalNearVictory: [
      ['Ni en tiempos del abuelo llegó nadie tan lejos.', 'Not even in Grandpa’s day did anyone get this far.'],
      ['¡Aguantad! ¡Por la familia!', 'Hold! For the family!'],
    ],
    rivalUltimate: [
      ['Esto no sale en ninguna historia de la familia.', 'This is in none of the family stories.'],
      ['Mi abuela no se lo va a creer.', 'My grandmother will not believe this.'],
    ],
    rivalCombo: [
      ['Eso lo hacía mi tío. Y acabó mal.', 'My uncle used to do that. It ended badly.'],
      ['Astuto. A mi abuelo le habrías caído bien.', 'Clever. My grandfather would have liked you.'],
    ],
    build: [
      ['Como lo hacían los de antes: piedra y paciencia.', 'The way the old folk did it: stone and patience.'],
      ['Un muro más para la familia.', 'One more wall for the family.'],
    ],
    rivalBuild: [
      ['Bonito muro. Muy moderno. No durará.', 'Nice wall. Very modern. It will not last.'],
      ['Mi abuelo lo habría hecho más recto.', 'My grandfather would have built it straighter.'],
    ],
    ailment: [
      ['¡Eso es juego sucio! El abuelo nunca lo habría permitido.', 'That is foul play! Grandpa would never have allowed it.'],
      ['Ni en la guerra del abuelo se hacían estas cosas.', 'Not even in Grandpa’s war did they do such things.'],
    ],
    battleEvent: [['Mi abuelo decía que este cielo trae problemas.', 'My grandfather said this sky brings trouble.']],
  },

  /** The quarry boss: rough hands, short temper, loves her stone. */
  'Capitana Rhoswen': {
    start: [
      ['A picar, que la piedra no se corta sola.', 'Get chipping, stone does not cut itself.'],
      ['Mis canteros tienen más callos que tú cartas.', 'My quarrymen have more calluses than you have cards.'],
    ],
    hitDealt: [
      ['¡Pedrada! De las buenas, de esta cantera.', 'Rock to the face! A good one, from this quarry.'],
      ['Eso es granito de primera. Duele, ¿eh?', 'That is first-rate granite. Hurts, eh?'],
    ],
    hitTaken: [
      ['¡Eh! Esa piedra la corté yo.', 'Hey! I cut that stone myself.'],
      ['Golpeas como un cantero borracho. Pero golpeas.', 'You hit like a drunk quarryman. But you hit.'],
    ],
    wallDown: [
      ['Muralla al suelo. Mañana corto otra, más gorda.', 'Wall on the ground. Tomorrow I cut a thicker one.'],
      ['¡Mi piedra! ¡Toda mi piedra!', 'My stone! All my stone!'],
    ],
    keepLow: [
      ['Aún me quedan dos manos y un pico.', 'I still have two hands and a pick.'],
      ['Esto no se acaba hasta que suene la sirena.', 'It is not over until the whistle blows.'],
    ],
    nearVictory: [
      ['Una carretada más y se acabó el turno.', 'One more cartload and the shift is over.'],
      ['Ve recogiendo tus herramientas.', 'Start packing up your tools.'],
    ],
    rivalNearVictory: [
      ['Tanta torre y ni una piedra de mi cantera. Inaceptable.', 'All that tower and not one stone from my quarry. Unacceptable.'],
      ['¡Más piedra! ¡Hay que tumbar eso!', 'More stone! We have to bring that down!'],
    ],
    rivalUltimate: [
      ['¡Al suelo, chicos! ¡Que se viene la ladera!', 'Down, lads! The hillside is coming!'],
      ['Eso ha sonado peor que una voladura.', 'That sounded worse than a blasting.'],
    ],
    rivalCombo: [
      ['Vaya, sabes trabajar en cadena.', 'Well, you know how to work a line.'],
      ['Eso parece trabajo de capataz. No me gusta.', 'That looks like foreman’s work. I do not like it.'],
    ],
    build: [
      ['Bloque, argamasa, bloque. Así de simple.', 'Block, mortar, block. That simple.'],
      ['Más gente al tajo. Hoy se trabaja doble.', 'More hands on the job. Double shift today.'],
    ],
    rivalBuild: [
      ['¿Eso es piedra o pan duro?', 'Is that stone or stale bread?'],
      ['Con esa argamasa no levantas ni un gallinero.', 'With that mortar you could not raise a henhouse.'],
    ],
    ailment: [
      ['¡Eh, a mis herramientas no se las toca!', 'Hey, nobody touches my tools!'],
      ['Me has fastidiado la jornada. Te la cobraré.', 'You ruined my shift. I will make you pay for it.'],
    ],
    battleEvent: [['Con este tiempo no se puede picar. Pero se puede pelear.', 'No chipping in this weather. Fighting, though, is fine.']],
  },

  // --- Alembic Vale ---------------------------------------------------------

  /** Barnaby's assistant: nervous, pedantic, measures everything. */
  'Maese Pockett': {
    start: [
      ['Altura, peso, tamaño de mazo... Anotado. Empecemos.', 'Height, weight, deck size... Noted. Let us begin.'],
      ['Tengo una regla, un cuaderno y muchos nervios.', 'I have a ruler, a notebook and a great many nerves.'],
    ],
    hitDealt: [
      ['¡Impacto de doce punto cuatro! Lo redondeo a mucho.', 'Impact of twelve point four! Rounding up to a lot.'],
      ['Daño medido y confirmado. Muy bonito.', 'Damage measured and confirmed. Very nice.'],
    ],
    hitTaken: [
      ['¡Ay! ¡Se me ha caído la regla!', 'Ow! I dropped my ruler!'],
      ['Medida del golpe: demasiado. Medida de mis nervios: más.', 'Size of the blow: too much. Size of my nerves: more.'],
    ],
    wallDown: [
      ['Muralla: cero. Exactamente cero. Lo he medido dos veces.', 'Wall: zero. Exactly zero. I measured it twice.'],
      ['¡El maestro me va a matar!', 'The master is going to kill me!'],
    ],
    keepLow: [
      ['Los números no me gustan. Ninguno.', 'I do not like the numbers. Any of them.'],
      ['Calculo que me queda poco. Ojalá me equivoque.', 'I calculate I have little left. I hope I am wrong.'],
    ],
    nearVictory: [
      ['¡Noventa y tantos por ciento de victoria! ¡Medido!', 'Ninety-something percent victory! Measured!'],
      ['Si los cálculos no fallan, ganamos. Fallan a veces.', 'If the sums are right, we win. They are wrong sometimes.'],
    ],
    rivalNearVictory: [
      ['¡Tu torre se sale de mi regla!', 'Your tower does not fit on my ruler!'],
      ['Esto no estaba en el informe para el maestro.', 'This was not in the report for the master.'],
    ],
    rivalUltimate: [
      ['¡No tengo unidad para medir eso!', 'I have no unit to measure that!'],
      ['¡Maestro! ¡Maestro, venga a ver esto! ¡Maestro!', 'Master! Master, come and see this! Master!'],
    ],
    rivalCombo: [
      ['Espera, espera, que no me da tiempo a anotarlo.', 'Wait, wait, I cannot write it down fast enough.'],
      ['Tres jugadas en un turno. Lo subrayo dos veces.', 'Three plays in one turn. Underlining it twice.'],
    ],
    build: [
      ['Muro reforzado: tres palmos más. Comprobado.', 'Wall reinforced: three spans more. Checked.'],
      ['Más ayudantes. Por fin alguien que sujete la cinta.', 'More helpers. Finally someone to hold the tape.'],
    ],
    rivalBuild: [
      ['Muralla rival: más alta de lo previsto. Corrijo la tabla.', 'Rival wall: taller than expected. Correcting the chart.'],
      ['Eso está torcido dos grados. Se nota.', 'That is two degrees off true. It shows.'],
    ],
    ailment: [
      ['¡Me has estropeado las mediciones!', 'You have ruined my measurements!'],
      ['Eso no lo tenía previsto. Lo apunto en "imprevistos".', 'I did not foresee that. Filing it under "unforeseen".'],
    ],
    battleEvent: [['Nuevas condiciones. Hay que medirlo todo otra vez.', 'New conditions. Everything must be measured again.']],
  },

  /** The orchard keeper: cheerful, motherly, her apples explode. */
  'Tilda Fennick': {
    start: [
      ['¿Una manzanita antes de empezar? No, mejor no.', 'An apple before we start? No, better not.'],
      ['Pisa con cuidado, cielo. Va en serio.', 'Watch your step, dear. I mean it.'],
    ],
    hitDealt: [
      ['¡Te avisé de las manzanas!', 'I warned you about the apples!'],
      ['¡Huy! Esa estaba madurita.', 'Oops! That one was nice and ripe.'],
    ],
    hitTaken: [
      ['¡Mis árboles! ¡Con lo que me costó podarlos!', 'My trees! After all that pruning!'],
      ['Ay, cielo, eso no se le hace a una agricultora.', 'Oh, dear, you do not do that to a farmer.'],
    ],
    wallDown: [
      ['La cerca del huerto, por los suelos.', 'The orchard fence, flat on the ground.'],
      ['Sin valla, las manzanas se escapan. Y explotan.', 'With no fence, the apples roll off. And explode.'],
    ],
    keepLow: [
      ['Ay, que esto se pone feo.', 'Oh dear, this is getting ugly.'],
      ['Me queda una cesta. La gorda.', 'I have one basket left. The big one.'],
    ],
    nearVictory: [
      ['¡Buena cosecha este año!', 'A good harvest this year!'],
      ['Ya casi, cielo. Siéntate, que te traigo una tila.', 'Nearly there, dear. Sit down, I will bring you a tea.'],
    ],
    rivalNearVictory: [
      ['¡Eso crece más rápido que mis calabazas!', 'That is growing faster than my pumpkins!'],
      ['Habrá que tirarle la cesta entera.', 'I will have to throw the whole basket at it.'],
    ],
    rivalUltimate: [
      ['¡Virgen de las huertas!', 'Saints of the orchards!'],
      ['Eso ha asustado hasta a las gallinas.', 'That frightened even the hens.'],
    ],
    rivalCombo: [
      ['Qué apañado. ¿Te lo enseñó tu madre?', 'How handy. Did your mother teach you that?'],
      ['Una detrás de otra, como las cerezas.', 'One after another, like cherries.'],
    ],
    build: [
      ['Cerca nueva. Que no se escape nada.', 'New fence. Nothing gets out.'],
      ['Más manos para la recogida. ¡Con guantes!', 'More hands for the picking. With gloves!'],
    ],
    rivalBuild: [
      ['Qué murito más mono. Pena que vaya a explotar.', 'What a cute little wall. Shame it will explode.'],
      ['Construyes como mi vecino: alto y sin gracia.', 'You build like my neighbour: tall and graceless.'],
    ],
    ailment: [
      ['¡Mi cosecha! ¡Eso es de mi despensa!', 'My harvest! That was from my pantry!'],
      ['Uy, qué maleducado. Sin postre.', 'Oh, how rude. No pudding for you.'],
    ],
    battleEvent: [['Cambia el tiempo. Mis rodillas ya lo sabían.', 'The weather is turning. My knees knew it already.']],
  },

  /** A doctor whose reassurances are never quite reassuring. */
  'Doctor Grindle': {
    start: [
      ['Tranquilo. Esto no dolerá. Casi nada.', 'Relax. This will not hurt. Hardly at all.'],
      ['Abra bien y diga "derrota".', 'Open wide and say "defeat".'],
    ],
    hitDealt: [
      ['Efecto secundario esperado. Casi siempre.', 'An expected side effect. Almost always.'],
      ['Tómese dos de esas y no me llame mañana.', 'Take two of those and do not call me in the morning.'],
    ],
    hitTaken: [
      ['Uf. Me receto reposo.', 'Oof. I prescribe myself bed rest.'],
      ['Eso dejará marca. Bueno, casi seguro.', 'That will leave a mark. Well, almost certainly.'],
    ],
    wallDown: [
      ['Diagnóstico: muralla fallecida.', 'Diagnosis: wall deceased.'],
      ['No hay pulso en la muralla. Siguiente paciente.', 'No pulse in the wall. Next patient.'],
    ],
    keepLow: [
      ['Pronóstico reservado. Muy reservado.', 'Prognosis guarded. Very guarded.'],
      ['Que alguien traiga mi maletín. El otro maletín.', 'Someone fetch my bag. The other bag.'],
    ],
    nearVictory: [
      ['El tratamiento funciona. Casi siempre funciona.', 'The treatment is working. It almost always works.'],
      ['Le doy el alta en un turno.', 'I am discharging you in one turn.'],
    ],
    rivalNearVictory: [
      ['Esa torre tiene fiebre. Mucha fiebre.', 'That tower is running a fever. A high one.'],
      ['Necesito operar. Ya.', 'I need to operate. Now.'],
    ],
    rivalUltimate: [
      ['Eso... no viene en ningún manual de medicina.', 'That... is in no medical textbook.'],
      ['Me tomo el pulso. Sigue ahí. Casi siempre.', 'Checking my pulse. Still there. Mostly.'],
    ],
    rivalCombo: [
      ['Tratamiento combinado. Muy profesional.', 'Combined treatment. Very professional.'],
      ['Eso es una sobredosis de buenas cartas.', 'That is an overdose of good cards.'],
    ],
    build: [
      ['Un vendaje de piedra. Sostiene casi todo.', 'A stone bandage. It holds almost anything.'],
      ['Más enfermeros. Por si acaso. Siempre hay un acaso.', 'More orderlies. Just in case. There is always a case.'],
    ],
    rivalBuild: [
      ['Esa muralla tiene mala cara.', 'That wall does not look well.'],
      ['Crecimiento anormal. Habrá que extirpar.', 'Abnormal growth. It will have to come out.'],
    ],
    ailment: [
      ['Síntomas preocupantes. Para mí, sobre todo.', 'Worrying symptoms. For me, mostly.'],
      ['Esto no es grave. Casi nunca es grave.', 'This is not serious. It is almost never serious.'],
    ],
    battleEvent: [['Cambio de clima. Malo para los huesos. Y para todo.', 'Change in the weather. Bad for the bones. And everything.']],
  },

  /** The mine owner: rich, bored, buys her way through everything. */
  'Ama Cordelia': {
    start: [
      ['Pon tu precio. Ah, que no te vendes. Qué aburrido.', 'Name your price. Oh, not for sale. How tedious.'],
      ['Con lo que hay en esta mina podría comprarte la derrota.', 'With what is in this mine I could buy your defeat.'],
    ],
    hitDealt: [
      ['Eso lo he pagado yo. Y ha merecido la pena.', 'I paid for that. And it was worth it.'],
      ['El dinero no da la felicidad. Pero da catapultas.', 'Money cannot buy happiness. It buys catapults.'],
    ],
    hitTaken: [
      ['¿Sabes cuánto vale eso que acabas de romper?', 'Do you know what that thing you just broke was worth?'],
      ['Te mandaré la factura. Con recargo.', 'I will send you the bill. With a surcharge.'],
    ],
    wallDown: [
      ['La muralla era de oro. Bueno, pintada.', 'The wall was gold. Well, painted.'],
      ['No importa. Mañana compro otra.', 'No matter. I will buy another tomorrow.'],
    ],
    keepLow: [
      ['¿Aceptas un soborno? Es una pregunta seria.', 'Would you take a bribe? It is a serious question.'],
      ['Esto empieza a salirme caro.', 'This is starting to cost me.'],
    ],
    nearVictory: [
      ['Inversión rentable. Como todas las mías.', 'A profitable investment. Like all of mine.'],
      ['Ya casi. Ve pensando cuánto me debes.', 'Nearly there. Start working out what you owe me.'],
    ],
    rivalNearVictory: [
      ['Te pago lo que quieras por bajar de esa torre.', 'I will pay whatever you like to come down off that tower.'],
      ['Esto ya no es un negocio. Es una ruina.', 'This is no longer business. It is ruin.'],
    ],
    rivalUltimate: [
      ['Eso no se compra con oro. Qué rabia.', 'Gold cannot buy that. How annoying.'],
      ['¡Mi seguro no cubre esto!', 'My insurance does not cover this!'],
    ],
    rivalCombo: [
      ['Qué eficiencia. ¿Buscas trabajo?', 'Such efficiency. Looking for work?'],
      ['Te contrataría. Luego te despediría, claro.', 'I would hire you. Then fire you, naturally.'],
    ],
    build: [
      ['Más mineros. Pagados a tiempo, para variar.', 'More miners. Paid on time, for a change.'],
      ['Una muralla con incrustaciones. Lo barato sale caro.', 'A wall with inlays. Buy cheap, buy twice.'],
    ],
    rivalBuild: [
      ['Qué obra tan humilde. Me enternece.', 'Such humble work. It touches me.'],
      ['Yo esa muralla la habría encargado. Más bonita.', 'I would have commissioned that wall. Prettier.'],
    ],
    ailment: [
      ['¡Eso es mío! Todo lo de aquí es mío.', 'That is mine! Everything here is mine.'],
      ['Llamaré a mis abogados. Tengo once.', 'I will call my lawyers. I have eleven.'],
    ],
    battleEvent: [['Si el mercado cambia, yo cambio con él.', 'When the market shifts, I shift with it.']],
  },

  // --- Ashen Hollow ---------------------------------------------------------

  /** A small, squeaky pickpocket. */
  'Gilly Ratón': {
    start: [
      ['Hola, hola. ¿Qué llevas en los bolsillos? Por nada.', 'Hello, hello. What is in your pockets? Just asking.'],
      ['Soy pequeño, pero tengo los dedos muy largos.', 'I am small, but I have very long fingers.'],
    ],
    hitDealt: [
      ['¡Ji, ji! ¡Pillado!', 'Hee hee! Got you!'],
      ['¡Mordisco de ratón!', 'Mouse bite!'],
    ],
    hitTaken: [
      ['¡Iiih! ¡Eso no se le hace a alguien tan chiquito!', 'Eeek! You do not do that to someone so tiny!'],
      ['Me escondo, me escondo...', 'Hiding, hiding...'],
    ],
    wallDown: [
      ['Mi madriguera... ¡Ya no tiene puerta!', 'My burrow... It has no door anymore!'],
      ['Sin muro. Mejor, así salgo más rápido.', 'No wall. Better, I can get out quicker.'],
    ],
    keepLow: [
      ['¡Ayuda! ¡Señora Nell! ¡Ayuda!', 'Help! Miss Nell! Help!'],
      ['Si me rindo, ¿me dejas quedarme con lo que te quité?', 'If I give up, can I keep what I took from you?'],
    ],
    nearVictory: [
      ['¡Casi! ¡Casi! ¡Me lo llevo todo!', 'Almost! Almost! I am taking it all!'],
      ['La señora Nell va a estar orgullosa.', 'Miss Nell is going to be so proud.'],
    ],
    rivalNearVictory: [
      ['Eso es muy alto para mí. ¡Muy alto!', 'That is too tall for me. Way too tall!'],
      ['Necesito un plan. O un queso. Un plan.', 'I need a plan. Or some cheese. A plan.'],
    ],
    rivalUltimate: [
      ['¡Iiih! ¡A la madriguera!', 'Eeek! Back to the burrow!'],
      ['Se me han puesto los bigotes de punta.', 'My whiskers are standing on end.'],
    ],
    rivalCombo: [
      ['¡Eh! ¡Ese truco era mío! Creo.', 'Hey! That trick was mine! I think.'],
      ['Uy, qué rápido. Más que yo.', 'Ooh, so fast. Faster than me.'],
    ],
    build: [
      ['Madriguera más grande. Con despensa.', 'Bigger burrow. With a pantry.'],
      ['¡Más ratoncitos en la banda!', 'More little mice in the gang!'],
    ],
    rivalBuild: [
      ['Muros altos, agujeros pequeños. Yo quepo.', 'Tall walls, small holes. I fit.'],
      ['¿Más cosas nuevas? ¡Más cosas que coger!', 'More new things? More things to grab!'],
    ],
    ailment: [
      ['¡Oye! ¡Que el ladrón soy yo!', 'Hey! I am the thief here!'],
      ['Snif. Eso era mío. Bueno, era de alguien.', 'Sniff. That was mine. Well, it was someone’s.'],
    ],
    battleEvent: [['Ruido raro. Me escondo por si acaso.', 'Funny noise. Hiding, just in case.']],
  },

  /** A black-market trader: everything has a price. */
  'Wick Tallow': {
    start: [
      ['Bienvenido al mercado. Hoy, todo en oferta. Menos tú.', 'Welcome to the market. Everything on sale today. Except you.'],
      ['Precio de entrada: tu castillo. Precio de salida: lo veremos.', 'Entry fee: your castle. Exit fee: we shall see.'],
    ],
    hitDealt: [
      ['Eso va a la cuenta. Con intereses.', 'That goes on your tab. With interest.'],
      ['Rebajas de muralla. Solo hoy.', 'Wall clearance sale. Today only.'],
    ],
    hitTaken: [
      ['¡Mercancía dañada! ¡Exijo compensación!', 'Damaged goods! I demand compensation!'],
      ['Eso me ha bajado el margen.', 'That has cut into my margin.'],
    ],
    wallDown: [
      ['Muralla liquidada. Por cierre.', 'Wall liquidated. Closing-down sale.'],
      ['Se vende muralla. Usada. Muy usada.', 'Wall for sale. Used. Very used.'],
    ],
    keepLow: [
      ['¿Negociamos? Te hago precio.', 'Shall we negotiate? I will give you a good price.'],
      ['El mercado está muy mal. Muy, muy mal.', 'The market is bad. Very, very bad.'],
    ],
    nearVictory: [
      ['Trato casi cerrado. Ve sacando la bolsa.', 'Deal nearly closed. Get your purse out.'],
      ['Las cuentas cuadran. A mi favor.', 'The books balance. In my favour.'],
    ],
    rivalNearVictory: [
      ['¿Cuánto por no terminar esa torre?', 'How much to not finish that tower?'],
      ['Esa torre está sobrevalorada. Te lo digo yo.', 'That tower is overvalued. Take it from me.'],
    ],
    rivalUltimate: [
      ['¿Eso está a la venta? Pregunto para un amigo.', 'Is that for sale? Asking for a friend.'],
      ['Me acabas de hundir el negocio.', 'You just sank my business.'],
    ],
    rivalCombo: [
      ['Tres por el precio de uno. Ni yo hago esas ofertas.', 'Three for the price of one. Not even I offer deals like that.'],
      ['Buen negocio. Para ti. Por ahora.', 'Good business. For you. For now.'],
    ],
    build: [
      ['Muralla de segunda mano. Como nueva. Más o menos.', 'Second-hand wall. Good as new. More or less.'],
      ['Personal contratado. Sin preguntas.', 'Staff hired. No questions asked.'],
    ],
    rivalBuild: [
      ['¿Cuánto has pagado por eso? Te han timado.', 'How much did you pay for that? You were robbed.'],
      ['Bonita muralla. Te la compro por la mitad.', 'Nice wall. I will buy it off you for half.'],
    ],
    ailment: [
      ['¡Eso es competencia desleal!', 'That is unfair competition!'],
      ['Me has robado a mí. Eso es malo para el negocio. El tuyo.', 'You robbed me. That is bad for business. Yours.'],
    ],
    battleEvent: [['Las cosas cambian. Los precios, siempre suben.', 'Things change. Prices always go up.']],
  },

  /** A lazy, laid-back tunneller who knows every way out. */
  'Corwin Manolenta': {
    start: [
      ['Sin prisa. Los túneles no se van a ningún sitio.', 'No hurry. The tunnels are not going anywhere.'],
      ['Uf, ¿ya hay que pelear? Bueno, venga.', 'Ugh, fighting already? Fine, go on then.'],
    ],
    hitDealt: [
      ['Despacito, pero llega.', 'Slow, but it gets there.'],
      ['Ni me he levantado de la silla.', 'I did not even get out of my chair.'],
    ],
    hitTaken: [
      ['Vale, eso me ha despertado.', 'Okay, that woke me up.'],
      ['¿Por qué tanta prisa? Qué estrés.', 'Why the rush? So stressful.'],
    ],
    wallDown: [
      ['La muralla, al suelo. Tampoco la usaba mucho.', 'The wall is down. I hardly used it anyway.'],
      ['Da igual. Yo vivo bajo tierra.', 'Never mind. I live underground.'],
    ],
    keepLow: [
      ['Me voy por el túnel siete. O el ocho. Ya veré.', 'I will take tunnel seven. Or eight. I will see.'],
      ['Esto pinta mal. Me lo tomo con calma.', 'This looks bad. I will take it easy.'],
    ],
    nearVictory: [
      ['Mira tú. Sin correr y casi gano.', 'Look at that. Never ran, and nearly won.'],
      ['Ya casi. Luego, siesta.', 'Nearly there. Then, a nap.'],
    ],
    rivalNearVictory: [
      ['Vaya, ahora sí tendré que darme prisa.', 'Well, now I really will have to hurry.'],
      ['Esa torre me quita la sombra. Hay que bajarla.', 'That tower is stealing my shade. It has to come down.'],
    ],
    rivalUltimate: [
      ['Eso ha hecho temblar hasta el túnel tres.', 'That shook even tunnel three.'],
      ['Mucho jaleo para un martes.', 'A lot of fuss for a Tuesday.'],
    ],
    rivalCombo: [
      ['Uf, cuánta energía. Me cansas solo de mirarte.', 'Phew, so much energy. Watching you tires me out.'],
      ['Tres jugadas. Yo con una me apaño.', 'Three plays. I make do with one.'],
    ],
    build: [
      ['Un poco de muro. Sin sudar.', 'A bit of wall. No sweat.'],
      ['Que caven otros. Para eso los contraté.', 'Let others dig. That is what I hired them for.'],
    ],
    rivalBuild: [
      ['Construye, construye. Yo paso por debajo.', 'Build away. I will go under.'],
      ['Mucho trabajo, eso. Qué pereza me da.', 'That looks like hard work. Makes me tired.'],
    ],
    ailment: [
      ['Qué falta de respeto. Y qué cansado.', 'How disrespectful. And how tiring.'],
      ['Eso me lo devuelves. Cuando me apetezca reclamarlo.', 'You will give that back. When I feel like asking.'],
    ],
    battleEvent: [['Algo cambia ahí arriba. Aquí abajo, todo igual.', 'Something is changing up there. Down here, same as ever.']],
  },

  /** An arsonist who adores smoke. */
  'Maeve Hollín': {
    start: [
      ['Mmm. ¿Hueles eso? Va a ser un buen día.', 'Mmm. Smell that? It is going to be a good day.'],
      ['Traigo yesca, aceite y muchas ganas.', 'I brought tinder, oil and plenty of enthusiasm.'],
    ],
    hitDealt: [
      ['¡Qué llamas tan bonitas!', 'Such pretty flames!'],
      ['Chisporrotea. Me encanta cuando chisporrotea.', 'It crackles. I love it when it crackles.'],
    ],
    hitTaken: [
      ['¡Eh! ¡Sin apagarme la hoguera!', 'Hey! Do not put out my bonfire!'],
      ['Eso no ha olido a humo. Ha olido a dolor.', 'That did not smell of smoke. It smelled of pain.'],
    ],
    wallDown: [
      ['Sin muralla. Más aire para el fuego.', 'No wall. More air for the fire.'],
      ['Bah, la piedra no arde. No la echaré de menos.', 'Bah, stone does not burn. I will not miss it.'],
    ],
    keepLow: [
      ['Si caigo, caigo ardiendo.', 'If I go down, I go down burning.'],
      ['Me queda una cerilla. Y es la mejor.', 'I have one match left. And it is the best one.'],
    ],
    nearVictory: [
      ['Ya huele a victoria. Y a quemado.', 'I can smell victory. And burning.'],
      ['Casi. Un soplido más.', 'Almost. One more puff.'],
    ],
    rivalNearVictory: [
      ['Tanta madera ahí arriba... Qué tentación.', 'All that timber up there... So tempting.'],
      ['Esa torre necesita un buen incendio.', 'That tower needs a good fire.'],
    ],
    rivalUltimate: [
      ['¡Ooooh! ¡Qué resplandor!', 'Ooooh! What a glow!'],
      ['Eso ha sido casi tan bonito como un incendio.', 'That was almost as pretty as a fire.'],
    ],
    rivalCombo: [
      ['Una chispa, otra chispa... Eso es fuego, querido.', 'One spark, another spark... That is fire, darling.'],
      ['Qué buena mecha has encendido.', 'What a fine fuse you lit.'],
    ],
    build: [
      ['Más leña para la pila. Digo, más muro.', 'More wood for the pile. I mean, more wall.'],
      ['Gente nueva. ¿Alguien trae aceite?', 'New people. Did anyone bring oil?'],
    ],
    rivalBuild: [
      ['¿De madera? Dime que es de madera.', 'Is it wood? Tell me it is wood.'],
      ['Qué bien arderá eso.', 'That will burn so well.'],
    ],
    ailment: [
      ['¡Me has mojado la yesca!', 'You got my tinder wet!'],
      ['El fuego es mío. Que nadie más lo toque.', 'Fire is mine. Nobody else touches it.'],
    ],
    battleEvent: [['El viento cambia. Hacia ti, espero.', 'The wind is shifting. Your way, I hope.']],
  },

  // --- Frostpeaks ----------------------------------------------------------

  /** A nervous apprentice trying hard to be brave. */
  'Aprendiz Liora': {
    start: [
      ['Respira. La maestra dijo que respire. Vale.', 'Breathe. The mistress said to breathe. Okay.'],
      ['¡No te tengo miedo! Un poco. Nada. Un poco.', 'I am not afraid of you! A little. Not at all. A little.'],
    ],
    hitDealt: [
      ['¡Me ha salido! ¡Me ha salido de verdad!', 'It worked! It actually worked!'],
      ['¡Perdón! Bueno, no. ¡Toma!', 'Sorry! Well, no. Take that!'],
    ],
    hitTaken: [
      ['¡Ay! La maestra no me dijo que dolería.', 'Ow! The mistress never said it would hurt.'],
      ['No pasa nada. No pasa nada. Sí pasa.', 'It is fine. It is fine. It is not fine.'],
    ],
    wallDown: [
      ['Mi escudo de hielo... Lo practiqué tanto.', 'My ice shield... I practised it so much.'],
      ['La maestra va a ver esto. Qué vergüenza.', 'The mistress is going to see this. How embarrassing.'],
    ],
    keepLow: [
      ['¿Cuál era el hechizo de emergencia? ¿Cuál era?', 'What was the emergency spell? What was it?'],
      ['Sé valiente, Liora. Sé valiente.', 'Be brave, Liora. Be brave.'],
    ],
    nearVictory: [
      ['¡Voy a ganar! ¡Yo! ¡A ti!', 'I am going to win! Me! Against you!'],
      ['La maestra no se lo va a creer.', 'The mistress will not believe it.'],
    ],
    rivalNearVictory: [
      ['Eso es muy alto. Muy, muy alto.', 'That is very tall. Very, very tall.'],
      ['Necesito un hechizo más grande. No me lo sé.', 'I need a bigger spell. I do not know one.'],
    ],
    rivalUltimate: [
      ['¡Maestra! ¡MAESTRA!', 'Mistress! MISTRESS!'],
      ['Eso no salía en mis libros. Ni en los de la maestra.', 'That was not in my books. Not even in the mistress’s.'],
    ],
    rivalCombo: [
      ['¿Cómo has hecho eso? Enséñame. No. Sí.', 'How did you do that? Teach me. No. Yes.'],
      ['Eso parece de cuarto curso. Yo voy por primero.', 'That looks fourth-year. I am in first.'],
    ],
    build: [
      ['¡Muro de escarcha! Como en clase.', 'Frost wall! Just like in class.'],
      ['Más aprendices. Ya no soy la más nueva.', 'More apprentices. I am not the newest anymore.'],
    ],
    rivalBuild: [
      ['Qué muro tan grande. ¿Cómo lo derribo?', 'What a big wall. How do I knock it down?'],
      ['Tienes muchos ayudantes. Yo solo me tengo a mí.', 'You have lots of helpers. I only have me.'],
    ],
    ailment: [
      ['¡Eso no vale! ¡No lo vimos en clase!', 'That is not fair! We never covered that in class!'],
      ['Me tiemblan las manos. Más de lo normal.', 'My hands are shaking. More than usual.'],
    ],
    battleEvent: [['¿Eso es normal? Nadie me dijo que fuera normal.', 'Is that normal? Nobody told me it was normal.']],
  },

  /** A serene monk who speaks in proverbs. */
  'Hermano Vane': {
    start: [
      ['Que la nieve caiga despacio. Nosotros también.', 'Let the snow fall slowly. So shall we.'],
      ['Comencemos. Sin prisa y sin descanso.', 'Let us begin. Without haste and without rest.'],
    ],
    hitDealt: [
      ['La gota rompe la piedra. Hoy, la gota fui yo.', 'The drop breaks the stone. Today, I was the drop.'],
      ['No es fuerza. Es constancia.', 'It is not strength. It is persistence.'],
    ],
    hitTaken: [
      ['El dolor es un maestro. Un maestro muy pesado.', 'Pain is a teacher. A very tiresome one.'],
      ['Acepto el golpe. No lo olvido.', 'I accept the blow. I do not forget it.'],
    ],
    wallDown: [
      ['El muro cayó. La montaña sigue aquí.', 'The wall fell. The mountain remains.'],
      ['Todo muro es temporal. Algunos, más que otros.', 'Every wall is temporary. Some more than others.'],
    ],
    keepLow: [
      ['Respiro. Escucho. Resisto.', 'I breathe. I listen. I endure.'],
      ['La nieve parece débil hasta que es avalancha.', 'Snow seems weak until it is an avalanche.'],
    ],
    nearVictory: [
      ['La paciencia da su fruto. Uno muy frío.', 'Patience bears fruit. A very cold one.'],
      ['Ya casi. El invierno siempre llega.', 'Almost. Winter always comes.'],
    ],
    rivalNearVictory: [
      ['Quien sube deprisa, baja deprisa.', 'Whoever climbs fast falls fast.'],
      ['Tu torre es alta. Mi paciencia, más.', 'Your tower is tall. My patience, taller.'],
    ],
    rivalUltimate: [
      ['Incluso la montaña tiembla a veces.', 'Even the mountain trembles sometimes.'],
      ['Mucho ruido. El silencio vuelve siempre.', 'Much noise. Silence always returns.'],
    ],
    rivalCombo: [
      ['El río que se une a otros ríos se vuelve torrente.', 'A river that joins other rivers becomes a torrent.'],
      ['Armonía en tus jugadas. La respeto.', 'Harmony in your plays. I respect it.'],
    ],
    build: [
      ['Piedra a piedra, como copo a copo.', 'Stone by stone, as flake by flake.'],
      ['Nuevos hermanos se unen. Bienvenidos al silencio.', 'New brothers join. Welcome to the silence.'],
    ],
    rivalBuild: [
      ['Construyes con prisa. La prisa agrieta.', 'You build in haste. Haste cracks.'],
      ['Muros altos, raíces cortas.', 'Tall walls, short roots.'],
    ],
    ailment: [
      ['Lo que quitas, el invierno lo devuelve.', 'What you take, winter gives back.'],
      ['Una prueba más. El camino está lleno de ellas.', 'One more trial. The path is full of them.'],
    ],
    battleEvent: [['El cielo habla. Escuchemos.', 'The sky is speaking. Let us listen.']],
  },

  /** A haughty scholar of the ruins: history, prophecies and kings. */
  'Maga Seren': {
    start: [
      ['Los libros ya hablan de esta batalla. Tú no sales bien.', 'The books already tell of this battle. You do not come out well.'],
      ['Estas ruinas han visto mil asedios. Este será breve.', 'These ruins have seen a thousand sieges. This one will be short.'],
    ],
    hitDealt: [
      ['Tal y como estaba escrito.', 'Just as it was written.'],
      ['Una nota al pie en tu historia. Una nota dolorosa.', 'A footnote in your story. A painful one.'],
    ],
    hitTaken: [
      ['Eso no figuraba en la profecía.', 'That was not in the prophecy.'],
      ['Tendré que reescribir un capítulo.', 'I shall have to rewrite a chapter.'],
    ],
    wallDown: [
      ['Otra ruina para las ruinas.', 'Another ruin for the ruins.'],
      ['Los muros caen. Los textos permanecen.', 'Walls fall. Texts endure.'],
    ],
    keepLow: [
      ['La historia la escriben los que quedan en pie. Sigo en pie.', 'History is written by those left standing. I am still standing.'],
      ['Esto no termina así. Lo he leído.', 'It does not end like this. I have read it.'],
    ],
    nearVictory: [
      ['Último capítulo. Lo conozco de memoria.', 'Final chapter. I know it by heart.'],
      ['Los augures no se equivocan. Rara vez.', 'The augurs are never wrong. Rarely.'],
    ],
    rivalNearVictory: [
      ['Ninguna crónica habla de ti. Que siga así.', 'No chronicle mentions you. Let it stay that way.'],
      ['Esa torre no está en ningún mapa antiguo.', 'That tower is on no ancient map.'],
    ],
    rivalUltimate: [
      ['Ni los augures vieron eso venir.', 'Not even the augurs saw that coming.'],
      ['Esto merece una crónica. Por desgracia.', 'This deserves a chronicle. Unfortunately.'],
    ],
    rivalCombo: [
      ['Táctica clásica. Ya la usaban hace tres siglos.', 'Classic tactic. They used it three centuries ago.'],
      ['Elegante. Casi digno de un libro.', 'Elegant. Almost worthy of a book.'],
    ],
    build: [
      ['Restauración fiel al original.', 'A restoration faithful to the original.'],
      ['Más estudiosos en las ruinas. Bien.', 'More scholars in the ruins. Good.'],
    ],
    rivalBuild: [
      ['Arquitectura vulgar. Sin estilo ni historia.', 'Vulgar architecture. No style, no history.'],
      ['Eso se derrumbará antes de tener leyenda.', 'That will collapse before it has a legend.'],
    ],
    ailment: [
      ['¿Te atreves con una erudita? Qué falta de cultura.', 'You dare, against a scholar? How uncultured.'],
      ['Anoto la ofensa. En tinta permanente.', 'I am noting the offence. In permanent ink.'],
    ],
    battleEvent: [['Las ruinas ya lo anunciaban. Nadie lee.', 'The ruins foretold this. Nobody reads.']],
  },

  /** The summit's warden: few words, every one ominous. */
  'Custodio Ithel': {
    start: [
      ['Aquí arriba no se oyen los gritos.', 'Up here, no one hears the screams.'],
      ['Bienvenido a la cumbre. Será breve.', 'Welcome to the summit. It will be brief.'],
    ],
    hitDealt: [
      ['Caída larga.', 'Long fall.'],
      ['Uno menos.', 'One fewer.'],
    ],
    hitTaken: [
      ['Hm.', 'Hm.'],
      ['Eso lo recordaré.', 'I will remember that.'],
    ],
    wallDown: [
      ['La muralla baja. Yo no.', 'The wall goes down. I do not.'],
      ['Que caiga. Queda el precipicio.', 'Let it fall. The cliff remains.'],
    ],
    keepLow: [
      ['Todavía no.', 'Not yet.'],
      ['Las cumbres no se rinden.', 'Summits do not surrender.'],
    ],
    nearVictory: [
      ['Casi. Mira abajo.', 'Almost. Look down.'],
      ['El viento ya sopla a mi favor.', 'The wind already blows my way.'],
    ],
    rivalNearVictory: [
      ['Alto. Demasiado alto.', 'High. Too high.'],
      ['Desde más arriba, se cae peor.', 'From higher up, the fall is worse.'],
    ],
    rivalUltimate: [
      ['...', '...'],
      ['Eso ha llegado hasta aquí arriba.', 'That reached all the way up here.'],
    ],
    rivalCombo: [
      ['Bien.', 'Good.'],
      ['Has subido rápido. Bajarás igual.', 'You climbed fast. You will come down the same way.'],
    ],
    build: [
      ['Más roca.', 'More rock.'],
      ['Que suban. Si pueden.', 'Let them climb. If they can.'],
    ],
    rivalBuild: [
      ['Inútil.', 'Useless.'],
      ['La montaña no necesita muros.', 'The mountain needs no walls.'],
    ],
    ailment: [
      ['Lo pagarás en la bajada.', 'You will pay for that on the way down.'],
      ['Insolente.', 'Insolent.'],
    ],
    battleEvent: [['El cielo se mueve. Yo no.', 'The sky moves. I do not.']],
  },

  // --- Crimson March --------------------------------------------------------

  /** A drill sergeant who shouts every sentence. */
  'Sargento Bruck': {
    start: [
      ['¡ATENCIÓN! ¡Hoy se gana o se friega la cocina!', 'ATTENTION! Today we win or we scrub the kitchens!'],
      ['¡En formación! ¡Y sin bostezar!', 'Form up! And no yawning!'],
    ],
    hitDealt: [
      ['¡ESO! ¡Así se golpea, reclutas!', 'THAT! That is how you hit, recruits!'],
      ['¡Otra vez! ¡Más fuerte! ¡MÁS!', 'Again! Harder! HARDER!'],
    ],
    hitTaken: [
      ['¡¿Quién ha dejado pasar eso?! ¡Cien flexiones!', 'Who let that through?! A hundred push-ups!'],
      ['¡No ha dolido! ¡Que nadie diga que ha dolido!', 'That did not hurt! Nobody say it hurt!'],
    ],
    wallDown: [
      ['¡Sin muralla! ¡Escudos al frente! ¡YA!', 'No wall! Shields to the front! NOW!'],
      ['¡Esa muralla estaba mal hecha! ¡Lo dije!', 'That wall was badly built! I said so!'],
    ],
    keepLow: [
      ['¡Nadie se rinde en mi pelotón!', 'Nobody surrenders in my platoon!'],
      ['¡Aguantad! ¡El que caiga, castigado!', 'Hold! Whoever falls is on punishment!'],
    ],
    nearVictory: [
      ['¡Un esfuerzo más, gusanos!', 'One more push, you maggots!'],
      ['¡Ya casi! ¡Que suene la corneta!', 'Nearly there! Sound the bugle!'],
    ],
    rivalNearVictory: [
      ['¡Esa torre! ¡Todos a esa torre!', 'That tower! Everyone to that tower!'],
      ['¡Esto es una vergüenza para la Marca!', 'This is a disgrace to the March!'],
    ],
    rivalUltimate: [
      ['¡CUERPO A TIERRA!', 'HIT THE DIRT!'],
      ['¡Que nadie rompa la formación! ¡NADIE!', 'Nobody break formation! NOBODY!'],
    ],
    rivalCombo: [
      ['¡Eso es disciplina! ¡Odio admitirlo!', 'That is discipline! I hate admitting it!'],
      ['¡Reclutas, tomad nota! ¡Y luego vengadnos!', 'Recruits, take notes! Then avenge us!'],
    ],
    build: [
      ['¡Reclutas nuevos! ¡A correr veinte vueltas!', 'New recruits! Twenty laps, go!'],
      ['¡Esa muralla, recta! ¡He dicho RECTA!', 'That wall, straight! I said STRAIGHT!'],
    ],
    rivalBuild: [
      ['¡Construyen mientras nosotros miramos! ¡Inaceptable!', 'They build while we watch! Unacceptable!'],
      ['¡Ese muro no aguanta ni un estornudo!', 'That wall would not survive a sneeze!'],
    ],
    ailment: [
      ['¡Sabotaje! ¡Doble guardia esta noche!', 'Sabotage! Double watch tonight!'],
      ['¡¿Quién ha perdido el material?! ¡Que dé un paso al frente!', 'Who lost the kit?! Step forward!'],
    ],
    battleEvent: [['¡Cambio de terreno! ¡Nadie se queja!', 'Change of terrain! No complaining!']],
  },

  /** The forge captain: every sword is named after a wall it broke. */
  'Capitán Holt': {
    start: [
      ['La forja está caliente. Tu muralla, aún entera.', 'The forge is hot. Your wall, still whole.'],
      ['Hoy forjo una espada nueva. Llevará tu nombre.', 'Today I forge a new sword. It will bear your name.'],
    ],
    hitDealt: [
      ['Golpe de martillo. Como en el yunque.', 'A hammer blow. Just like on the anvil.'],
      ['Esa grieta ya tiene nombre de espada.', 'That crack already has a sword named after it.'],
    ],
    hitTaken: [
      ['Me has mellado el filo.', 'You have nicked my edge.'],
      ['El acero se templa con golpes. Gracias.', 'Steel is tempered by blows. Thank you.'],
    ],
    wallDown: [
      ['Muralla rota. La fundiré y haré otra.', 'Wall broken. I will melt it down and make another.'],
      ['Sin muralla. Me queda el yunque.', 'No wall. I still have the anvil.'],
    ],
    keepLow: [
      ['Avivad el fuego. Esto no ha terminado.', 'Stoke the fire. This is not over.'],
      ['Me queda una espada sin nombre. Aún.', 'I have one sword left without a name. For now.'],
    ],
    nearVictory: [
      ['Ya veo tu nombre grabado en una hoja.', 'I can already see your name engraved on a blade.'],
      ['Golpe final. Al rojo vivo.', 'Final strike. Red hot.'],
    ],
    rivalNearVictory: [
      ['Esa torre pide a gritos una espada nueva.', 'That tower is begging for a new sword.'],
      ['¡Más carbón! ¡Hay que tumbar eso!', 'More coal! That has to come down!'],
    ],
    rivalUltimate: [
      ['Eso ha sonado como una forja que revienta.', 'That sounded like a forge bursting.'],
      ['Ni mi mejor acero aguanta eso.', 'Not even my best steel withstands that.'],
    ],
    rivalCombo: [
      ['Buen trabajo de herrero: golpe, golpe, golpe.', 'Good smithing: strike, strike, strike.'],
      ['Ritmo de yunque. Lo reconozco.', 'Anvil rhythm. I know it when I hear it.'],
    ],
    build: [
      ['Muro con remaches de hierro. Que pruebe a tirarlo.', 'A wall with iron rivets. Let them try to break it.'],
      ['Más aprendices a la fragua.', 'More apprentices to the forge.'],
    ],
    rivalBuild: [
      ['Más muro. Más nombres para mis espadas.', 'More wall. More names for my swords.'],
      ['Eso no es piedra, es chatarra.', 'That is not stone, it is scrap.'],
    ],
    ailment: [
      ['¡Óxido en mi forja! ¡Eso es un sacrilegio!', 'Rust in my forge! That is sacrilege!'],
      ['Me has enfriado el horno. Mal hecho.', 'You have cooled my furnace. Bad move.'],
    ],
    battleEvent: [['Cambia el viento. El fuego de la forja, también.', 'The wind shifts. So does the forge fire.']],
  },

  /** An honourable tactician: frank, fair and a little tired of war. */
  'Coronel Varga': {
    start: [
      ['Campo abierto, reglas claras. Que gane el mejor.', 'Open field, clear rules. May the best one win.'],
      ['Sin trampas ni escondites. Así me gusta.', 'No tricks, no hiding. That is how I like it.'],
    ],
    hitDealt: [
      ['Limpio y de frente.', 'Clean and head-on.'],
      ['Nada personal. Es la llanura.', 'Nothing personal. It is the plain.'],
    ],
    hitTaken: [
      ['Buen golpe. Lo reconozco.', 'Good hit. I admit it.'],
      ['Me lo merecía. No volverá a pasar.', 'I deserved that. It will not happen again.'],
    ],
    wallDown: [
      ['La muralla ha caído. Ahora, a campo abierto.', 'The wall has fallen. Now, out in the open.'],
      ['Bien jugado. Me quedo sin cobertura.', 'Well played. I am out of cover.'],
    ],
    keepLow: [
      ['Mantengo la posición. Hasta el final.', 'Holding position. To the end.'],
      ['Si he de caer, que sea mirando al frente.', 'If I must fall, let it be facing forward.'],
    ],
    nearVictory: [
      ['Ríndete con honor. Te lo ofrezco una vez.', 'Yield with honour. I offer it once.'],
      ['Se acerca el final. Ha sido una buena batalla.', 'The end draws near. It has been a good battle.'],
    ],
    rivalNearVictory: [
      ['Estás ganando. Justo. Pero aún no.', 'You are winning. Fairly. But not yet.'],
      ['Toca jugársela. A todo o nada.', 'Time to risk it all. All or nothing.'],
    ],
    rivalUltimate: [
      ['Impresionante. De verdad.', 'Impressive. Truly.'],
      ['Esa es la fuerza de una brasa. Lo entiendo.', 'So that is the power of an ember. I understand.'],
    ],
    rivalCombo: [
      ['Maniobra de manual. La aplaudo.', 'Textbook manoeuvre. I applaud it.'],
      ['Bien pensado. Yo habría hecho lo mismo.', 'Well thought out. I would have done the same.'],
    ],
    build: [
      ['Una defensa sencilla. Basta con eso.', 'A simple defence. That is enough.'],
      ['Más tropas a la línea.', 'More troops to the line.'],
    ],
    rivalBuild: [
      ['Fortificas. Es sensato.', 'You fortify. That is sensible.'],
      ['Un buen muro. Igualmente lo cruzaré.', 'A good wall. I will cross it all the same.'],
    ],
    ailment: [
      ['Juego sucio. No lo esperaba de ti.', 'Foul play. I did not expect it of you.'],
      ['Eso no ha sido de frente.', 'That was not head-on.'],
    ],
    battleEvent: [['El terreno cambia. Para los dos por igual.', 'The ground changes. For both of us alike.']],
  },

  /** The Marshal's fanatic: his commander is never wrong. */
  'Comandante Dresk': {
    start: [
      ['El Mariscal me dio una orden: detenerte. La cumpliré.', 'The Marshal gave me one order: stop you. I will carry it out.'],
      ['Por el Mariscal. Siempre por el Mariscal.', 'For the Marshal. Always for the Marshal.'],
    ],
    hitDealt: [
      ['El Mariscal estaría orgulloso.', 'The Marshal would be proud.'],
      ['Ejecutado según el plan del Mariscal.', 'Carried out according to the Marshal’s plan.'],
    ],
    hitTaken: [
      ['Esto también forma parte del plan. Seguro.', 'This is part of the plan too. Surely.'],
      ['El Mariscal lo previó. Él lo prevé todo.', 'The Marshal foresaw this. He foresees everything.'],
    ],
    wallDown: [
      ['La muralla cae. La lealtad, no.', 'The wall falls. Loyalty does not.'],
      ['El Mariscal dijo que esto podía pasar. Creo.', 'The Marshal said this could happen. I believe.'],
    ],
    keepLow: [
      ['No le fallaré. No le fallaré.', 'I will not fail him. I will not fail him.'],
      ['Mariscal, aguanto. Por usted.', 'Marshal, I hold. For you.'],
    ],
    nearVictory: [
      ['Mariscal, la victoria es suya.', 'Marshal, the victory is yours.'],
      ['Tal y como él dijo. Siempre tiene razón.', 'Just as he said. He is always right.'],
    ],
    rivalNearVictory: [
      ['Imposible. El Mariscal dijo que no llegarías.', 'Impossible. The Marshal said you would not get this far.'],
      ['Si fallo, que me perdone el Mariscal.', 'If I fail, may the Marshal forgive me.'],
    ],
    rivalUltimate: [
      ['Eso... no estaba en las órdenes.', 'That... was not in the orders.'],
      ['Ni el Mariscal tiene algo así. Bueno, sí. Seguro que sí.', 'Not even the Marshal has anything like that. Well, he does. Surely he does.'],
    ],
    rivalCombo: [
      ['Astuto. El Mariscal lo habría hecho mejor.', 'Cunning. The Marshal would have done it better.'],
      ['Eso no te salvará de las órdenes del Mariscal.', 'That will not save you from the Marshal’s orders.'],
    ],
    build: [
      ['Cuartel reforzado, según el manual del Mariscal.', 'Barracks reinforced, by the Marshal’s manual.'],
      ['Nuevos soldados juran lealtad. Al Mariscal.', 'New soldiers swear loyalty. To the Marshal.'],
    ],
    rivalBuild: [
      ['Construye. El Mariscal lo derribará todo.', 'Build. The Marshal will tear it all down.'],
      ['Muros contra la Marca. Qué ingenuidad.', 'Walls against the March. How naive.'],
    ],
    ailment: [
      ['Traición. El Mariscal sabrá de esto.', 'Treachery. The Marshal will hear of this.'],
      ['Un contratiempo. Lo informaré al Mariscal.', 'A setback. I will report it to the Marshal.'],
    ],
    battleEvent: [['El Mariscal ya contaba con esto. Seguro.', 'The Marshal was counting on this. Surely.']],
  },
};
