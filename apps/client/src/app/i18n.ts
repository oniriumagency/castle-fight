import { localize, type Locale, type LocalizedText } from '@cardcraft-castles/engine';
import { settings } from './settings';

/**
 * Interface texts in Spanish and English. Card, hero, event, school and
 * resource names come from the engine catalog, never from here, so balance
 * changes to `design/cards.json` show up without touching the client.
 */
const STRINGS = {
  // Main menu
  tagline: { es: 'Levanta tu castillo. Derriba el del rival.', en: 'Raise your castle. Bring down theirs.' },
  playAi: { es: 'Jugar contra la IA', en: 'Play vs AI' },
  playAiHint: { es: 'Una partida rápida contra el ordenador', en: 'A quick match against the computer' },
  playOnline: { es: 'Jugar online', en: 'Play online' },
  playOnlineHint: { es: 'Crea una sala o únete a una abierta', en: 'Create a room or join an open one' },
  playLocal: { es: 'Dos jugadores', en: 'Two players' },
  playLocalHint: { es: 'Por turnos en este dispositivo', en: 'Take turns on this device' },
  playFfa: { es: 'Todos contra todos', en: 'Free-for-all' },
  playFfaHint: { es: 'Prototipo: tú contra dos IA', en: 'Prototype: you against two AIs' },
  howToPlay: { es: 'Cómo se juega', en: 'How to play' },
  settings: { es: 'Ajustes', en: 'Settings' },
  nickname: { es: 'Tu apodo', en: 'Your nickname' },
  nicknamePlaceholder: { es: 'Escribe un apodo', en: 'Enter a nickname' },
  back: { es: 'Volver', en: 'Back' },
  close: { es: 'Cerrar', en: 'Close' },
  confirm: { es: 'Confirmar', en: 'Confirm' },
  cancel: { es: 'Cancelar', en: 'Cancel' },
  version: { es: 'Versión preliminar', en: 'Preview build' },

  // Lobby
  lobbyTitle: { es: 'Salas abiertas', en: 'Open rooms' },
  lobbyEmpty: { es: 'No hay salas abiertas. Crea una y comparte el enlace.', en: 'No open rooms. Create one and share the link.' },
  lobbyConnecting: { es: 'Conectando con el servidor…', en: 'Connecting to the server…' },
  lobbyOffline: {
    es: 'No se puede conectar con el servidor de partidas. Mientras tanto puedes jugar contra la IA o a dos jugadores.',
    en: 'Cannot reach the game server. Meanwhile you can play against the AI or two players on this device.',
  },
  retry: { es: 'Reintentar', en: 'Retry' },
  createRoom: { es: 'Crear partida', en: 'Create game' },
  roomName: { es: 'Nombre de la sala', en: 'Room name' },
  roomNameDefault: { es: 'Sala de {name}', en: "{name}'s room" },
  join: { es: 'Unirse', en: 'Join' },
  quickJoin: { es: 'Partida rápida', en: 'Quick match' },
  turnTime: { es: 'Tiempo por turno', en: 'Time per turn' },
  secondsShort: { es: '{n} s', en: '{n}s' },
  secondsLong: { es: '{n} segundos', en: '{n} seconds' },
  noTimeLimit: { es: 'Sin límite', en: 'No limit' },
  playedHistory: { es: 'Últimas cartas jugadas', en: 'Last cards played' },
  privateRoom: { es: 'Privada (solo con enlace)', en: 'Private (link only)' },
  watchFull: { es: 'Llena', en: 'Full' },
  roomWaiting: { es: 'Esperando rival', en: 'Waiting for opponent' },
  roomPlaying: { es: 'En juego', en: 'In progress' },
  roomFinished: { es: 'Terminada', en: 'Finished' },
  hostedBy: { es: 'Anfitrión: {host}', en: 'Host: {host}' },
  players: { es: '{n}/{max}', en: '{n}/{max}' },
  roomSize: { es: 'Jugadores', en: 'Players' },
  sizeDuel: { es: '1 contra 1', en: '1 vs 1' },
  sizeFfa: { es: '3 · Todos contra todos', en: '3 · Free-for-all' },
  waitingTitle: { es: 'Esperando rival', en: 'Waiting for an opponent' },
  waitingHint: { es: 'Comparte este enlace para que alguien se una a tu sala.', en: 'Share this link so someone can join your room.' },
  copyLink: { es: 'Copiar enlace', en: 'Copy link' },
  copied: { es: 'Enlace copiado', en: 'Link copied' },
  leaveRoom: { es: 'Salir de la sala', en: 'Leave room' },
  connectionLost: { es: 'Se perdió la conexión con la partida.', en: 'Lost the connection to the game.' },
  reconnecting: { es: 'Reconectando…', en: 'Reconnecting…' },
  serverError: { es: 'El servidor respondió: {message}', en: 'The server said: {message}' },

  // Hero select
  chooseHero: { es: 'Elige tu héroe', en: 'Choose your hero' },
  chooseHeroFor: { es: '{who}, elige tu héroe', en: '{who}, choose your hero' },
  opponentHero: { es: 'Héroe rival', en: 'Opponent hero' },
  randomHero: { es: 'Al azar', en: 'Random' },
  difficulty: { es: 'Dificultad', en: 'Difficulty' },
  easy: { es: 'Fácil', en: 'Easy' },
  normal: { es: 'Normal', en: 'Normal' },
  hard: { es: 'Difícil', en: 'Hard' },
  startGame: { es: 'Empezar partida', en: 'Start game' },
  passive: { es: 'Pasiva', en: 'Passive' },
  ultimate: { es: 'Definitiva', en: 'Ultimate' },
  player1: { es: 'Jugador 1', en: 'Player 1' },
  player2: { es: 'Jugador 2', en: 'Player 2' },
  aiName: { es: 'IA ({level})', en: 'AI ({level})' },

  // Board
  yourTurn: { es: 'Tu turno', en: 'Your turn' },
  rotateTitle: { es: 'Gira tu móvil', en: 'Turn your phone' },
  rotateHint: { es: 'Cardcraft: Castles se juega en horizontal.', en: 'Cardcraft: Castles is played in landscape.' },
  gameStartedNotice: { es: '¡Empieza la partida!', en: 'The game is starting!' },
  gameStartedNoticeBody: { es: 'Tu rival ya está en la sala de Cardcraft: Castles.', en: 'Your opponent is in the Cardcraft: Castles room.' },
  yourTurnNotice: { es: 'Cardcraft: Castles · Turno {n}. Vuelve a la partida para jugar.', en: 'Cardcraft: Castles · Turn {n}. Come back to the game to play.' },
  theirTurn: { es: 'Turno de {who}', en: "{who}'s turn" },
  extraTurn: { es: 'Turno extra', en: 'Extra turn' },
  turnN: { es: 'Turno {n}', en: 'Turn {n}' },
  play: { es: 'Jugar', en: 'Play' },
  discard: { es: 'Descartar', en: 'Discard' },
  useUltimate: { es: 'Usar definitiva', en: 'Use ultimate' },
  ultimateReady: { es: '¡Definitiva lista!', en: 'Ultimate ready!' },
  ultimateReadyBig: { es: '¡Definitiva lista!', en: 'Ultimate ready!' },
  ultimateReadyHint: { es: 'Úsala con el botón dorado de tu panel', en: 'Use it with the gold button on your panel' },
  ultimateFree: { es: 'No gasta tu jugada', en: 'Does not use up your play' },
  ultimateOnYourTurn: { es: 'Úsala en tu turno', en: 'Use it on your turn' },
  ultimateRivalReady: { es: 'El rival puede usarla', en: 'Your opponent can use it' },
  ultimateCharges: { es: 'Se carga al recibir daño: faltan {n}', en: 'Charges as you take damage: {n} to go' },
  ultimateRivalCharges: { es: 'Se carga con el daño que recibe: faltan {n}', en: 'Charges with the damage it takes: {n} to go' },
  ultimateHow: {
    es: 'Se carga con el daño que recibes. Cuando esté lista, púlsala en tu turno (o la tecla U). No gasta tu jugada.',
    en: 'It charges with the damage you take. When it is ready, press it on your turn (or the U key). It does not use up your play.',
  },
  ultimateReadyToast: {
    es: '¡Tu definitiva está lista! Pulsa el botón dorado de tu panel en tu turno. No gasta tu jugada.',
    en: 'Your ultimate is ready! Press the gold button on your panel on your turn. It does not use up your play.',
  },
  ultimateProgress: { es: 'Definitiva: {charge}/{threshold} de daño recibido', en: 'Ultimate: {charge}/{threshold} damage taken' },
  deck: { es: 'Mazo', en: 'Deck' },
  discardPile: { es: 'Descarte', en: 'Discard' },
  production: { es: '+{n} por turno', en: '+{n} per turn' },
  workersOf: { es: '{n} {worker}', en: '{n} {worker}' },
  frozenTurns: { es: 'Congelado {n} turno(s)', en: 'Frozen for {n} turn(s)' },
  burnTurns: { es: 'Quemadura: {n} turno(s), 2 de daño por turno', en: 'Burn: {n} turn(s), 2 damage per turn' },
  shieldCharges: { es: 'Escudo: bloquea {n} ataque(s)', en: 'Shield: blocks {n} attack(s)' },
  drawbridgeUp: { es: 'Puente levadizo: el daño perforante cuenta como normal', en: 'Drawbridge: piercing damage counts as normal' },
  handVisible: { es: 'Mano revelada', en: 'Hand revealed' },
  turnsLeft: { es: '{n} turno(s)', en: '{n} turn(s)' },
  upcomingEvent: { es: 'En {n} turno(s)', en: 'In {n} turn(s)' },
  upcomingNow: { es: 'Al empezar el próximo turno', en: 'At the start of next turn' },
  activeEvent: { es: 'Activo: {n} turno(s) más', en: 'Active: {n} more turn(s)' },
  comboReady: { es: 'Combo', en: 'Combo' },
  costUp: { es: 'Más cara', en: 'Costs more' },
  costDown: { es: 'Más barata', en: 'Costs less' },
  blockedCannotAfford: { es: 'Te falta {resource}: cuesta {cost}.', en: 'Not enough {resource}: it costs {cost}.' },
  blockedSchoolBanned: { es: 'Un evento prohíbe esta escuela ahora.', en: 'A battle event forbids this school right now.' },
  blockedNothingToCopy: { es: 'El rival aún no ha jugado ninguna carta.', en: 'Your opponent has not played a card yet.' },
  blockedNotYourTurn: { es: 'Espera a tu turno.', en: 'Wait for your turn.' },
  dragHint: { es: 'Arrastra hacia arriba para jugar, o sobre el descarte para descartar', en: 'Drag up to play, or onto the discard pile to discard' },
  waitingOpponent: { es: 'Esperando a {who}…', en: 'Waiting for {who}…' },
  thinking: { es: '{who} está pensando…', en: '{who} is thinking…' },
  menu: { es: 'Menú', en: 'Menu' },
  concede: { es: 'Rendirse', en: 'Concede' },
  concedeConfirm: { es: '¿Seguro que quieres rendirte?', en: 'Are you sure you want to concede?' },
  resume: { es: 'Seguir jugando', en: 'Resume' },
  log: { es: 'Registro', en: 'Log' },
  you: { es: 'Tú', en: 'You' },
  passDevice: { es: 'Pasa el dispositivo a {who}', en: 'Pass the device to {who}' },
  passDeviceHint: { es: 'Tu mano queda oculta hasta que pulses el botón.', en: 'Your hand stays hidden until you press the button.' },
  ready: { es: 'Estoy listo', en: "I'm ready" },
  timeUp: { es: '¡Se acabó el tiempo!', en: "Time's up!" },
  emotes: { es: 'Emotes', en: 'Emotes' },

  // Choices
  chooseFrost: { es: 'Elige el recurso del rival que se congela', en: "Choose the opponent's resource to freeze" },
  discardPickTitle: { es: 'Descarta hasta {max} cartas', en: 'Discard up to {max} cards' },
  discardPickHint: {
    es: 'Toca las cartas que quieres tirar. Descartar usa tu jugada y al final del turno robas hasta completar la mano.',
    en: 'Tap the cards you want to throw away. Discarding uses your play, and at the end of the turn you draw back up to a full hand.',
  },
  discardN: { es: 'Descartar ({n})', en: 'Discard ({n})' },
  chooseDiscard: { es: 'Elige la carta del rival que se descarta', en: "Choose the opponent's card to discard" },
  chooseEnchantment: { es: 'Elige el encantamiento rival que se destruye', en: 'Choose the enemy enchantment to destroy' },
  chooseDiscardOwn: { es: 'Elige una carta de tu mano para descartar (faltan {n})', en: 'Choose a card from your hand to discard ({n} to go)' },
  chooseDiscardOwnUpTo: { es: 'Puedes descartar hasta {n} cartas más', en: 'You may discard up to {n} more cards' },
  discardDone: { es: 'Terminar', en: 'Done' },
  opponentChoosing: { es: '{who} está eligiendo…', en: '{who} is choosing…' },

  // Log lines
  logTurn: { es: 'Turno {n}: {who}', en: 'Turn {n}: {who}' },
  logPlayed: { es: '{who} juega {card}', en: '{who} plays {card}' },
  logPlayedCombo: { es: '{who} juega {card} con Combo ({bonus})', en: '{who} plays {card} with Combo ({bonus})' },
  comboDamage: { es: '{n} de daño', en: '{n} damage' },
  boosted: { es: 'Potenciada', en: 'Boosted' },
  logDiscarded: { es: '{who} descarta {card}', en: '{who} discards {card}' },
  logTimeoutDiscard: { es: '{who} se quedó sin tiempo y descarta {card}', en: '{who} ran out of time and discards {card}' },
  logEffectDiscard: { es: '{who} pierde {card}', en: '{who} loses {card}' },
  logCopied: { es: '{who} copia {card}', en: '{who} copies {card}' },
  logUltimate: { es: '{who} desata su definitiva', en: '{who} unleashes the ultimate' },
  logDamage: { es: '{who} recibe {n} de daño', en: '{who} takes {n} damage' },
  logBlocked: { es: 'El Escudo de {who} bloquea el ataque', en: "{who}'s Shield blocks the attack" },
  logBurn: { es: '{who} sufre la Quemadura', en: '{who} suffers Burn' },
  logBuilt: { es: '{who}: +{n} {target}', en: '{who}: +{n} {target}' },
  logLost: { es: '{who}: −{n} {target}', en: '{who}: −{n} {target}' },
  logEvent: { es: 'Evento: {event}', en: 'Event: {event}' },
  logEnchant: { es: '{who} conjura {card}', en: '{who} casts {card}' },
  logEnchantGone: { es: '{card} de {who} desaparece', en: "{who}'s {card} fades" },
  logSwap: { es: 'Las Murallas se intercambian', en: 'The Walls swap' },
  logExtraTurn: { es: '{who} gana un turno extra', en: '{who} gains an extra turn' },
  logTimedOut: { es: '{who} agotó el tiempo', en: '{who} ran out of time' },
  logGameOver: { es: 'Fin de la partida', en: 'Game over' },

  // Results
  victory: { es: 'Victoria', en: 'Victory' },
  defeat: { es: 'Derrota', en: 'Defeat' },
  draw: { es: 'Empate', en: 'Draw' },
  winsTitle: { es: '¡{who} gana!', en: '{who} wins!' },
  reasonKeepBuilt: { es: '{who} completó su Torreón.', en: '{who} completed their Keep.' },
  reasonKeepDestroyed: { es: 'El Torreón de {who} cayó.', en: "{who}'s Keep fell." },
  reasonConcede: { es: '{who} se rindió.', en: '{who} conceded.' },
  reasonTurnLimit: { es: 'Se alcanzó el límite de turnos.', en: 'The turn limit was reached.' },
  statTurns: { es: 'Turnos', en: 'Turns' },
  statDamage: { es: 'Daño causado', en: 'Damage dealt' },
  statBuilt: { es: 'Piedra levantada', en: 'Stone raised' },
  statCards: { es: 'Cartas jugadas', en: 'Cards played' },
  statBest: { es: 'Mejor golpe', en: 'Biggest hit' },
  statUltimates: { es: 'Definitivas', en: 'Ultimates' },
  rematch: { es: 'Revancha', en: 'Rematch' },
  headToHead: { es: 'Tú contra {who}', en: 'You vs {who}' },
  headToHeadGames: { es: '{n} partidas en total', en: '{n} games in total' },
  headToHeadFirst: { es: 'Vuestra primera partida', en: 'Your first game together' },
  nemesisBadge: { es: 'Tu némesis', en: 'Your nemesis' },

  // Win/loss record
  myRecord: { es: 'Mi historial', en: 'My record' },
  recordOnline: { es: 'En línea', en: 'Online' },
  recordAi: { es: 'Contra la IA', en: 'Against the AI' },
  recordWins: { es: 'Victorias', en: 'Wins' },
  recordLosses: { es: 'Derrotas', en: 'Losses' },
  recordDraws: { es: 'Empates', en: 'Draws' },
  recordRate: { es: '{pct}% de victorias', en: '{pct}% win rate' },
  recordRivals: { es: 'Rivales', en: 'Opponents' },
  recordNoRivals: {
    es: 'Aún no has jugado en línea. Cada rival al que te enfrentes aparecerá aquí con vuestro marcador.',
    en: 'No online games yet. Every opponent you face will show up here with your score.',
  },
  recordNemesisHint: {
    es: 'Tu némesis es el rival con quien más has jugado (desde {n} partidas).',
    en: 'Your nemesis is the opponent you have played most (from {n} games on).',
  },
  recordNemesisLead: { es: 'Le vas ganando', en: "You're ahead" },
  recordNemesisBehind: { es: 'Te va ganando', en: "They're ahead" },
  recordNemesisTied: { es: 'Vais empatados', en: "You're tied" },
  recordLocalNote: {
    es: 'El historial se guarda en este navegador. Las partidas en el mismo dispositivo no cuentan.',
    en: 'Your record is kept in this browser. Games on a shared device do not count.',
  },
  recordReset: { es: 'Borrar historial', en: 'Clear record' },
  recordResetConfirm: { es: '¿Seguro? Pulsa otra vez para borrarlo.', en: 'Sure? Press again to clear it.' },
  mainMenu: { es: 'Menú principal', en: 'Main menu' },
  viewBoard: { es: 'Ver tablero', en: 'View board' },

  // Settings
  language: { es: 'Idioma', en: 'Language' },
  masterVolume: { es: 'Volumen general', en: 'Master volume' },
  musicVolume: { es: 'Música', en: 'Music' },
  sfxVolume: { es: 'Efectos', en: 'Effects' },
  animationSpeed: { es: 'Velocidad de animación', en: 'Animation speed' },
  speedNormal: { es: 'Normal', en: 'Normal' },
  speedFast: { es: 'Rápida', en: 'Fast' },
  reducedMotion: { es: 'Reducir movimiento', en: 'Reduce motion' },
  screenShake: { es: 'Sacudida de pantalla', en: 'Screen shake' },
  localTimer: { es: 'Reloj de turno con dos jugadores en un dispositivo', en: 'Turn clock with two players on one device' },
  installApp: { es: 'Instalar en el móvil', en: 'Install on your phone' },
  continueGame: { es: 'Continuar partida', en: 'Continue game' },
  continueGameHint: { es: 'Retoma la partida que dejaste a medias', en: 'Pick up the game you left unfinished' },
  gameRestored: { es: 'Partida recuperada: sigues donde lo dejaste', en: 'Game restored: you are back where you left off' },
  mute: { es: 'Silenciar', en: 'Mute' },
  unmute: { es: 'Activar sonido', en: 'Unmute' },
  muteAll: { es: 'Silenciar todo', en: 'Mute everything' },
  soundSettings: { es: 'Sonido', en: 'Sound' },
  effectsQuality: { es: 'Calidad de efectos', en: 'Effects quality' },
  qualityAuto: { es: 'Auto', en: 'Auto' },
  qualityHigh: { es: 'Alta', en: 'High' },
  qualityLow: { es: 'Baja', en: 'Low' },
  on: { es: 'Sí', en: 'On' },
  off: { es: 'No', en: 'Off' },

  // How to play
  rulesGoal: {
    es: 'Gana quien lleve su <b>Torreón</b> a {win} o deje el del rival en 0.',
    en: 'Win by raising your <b>Keep</b> to {win} or bringing your opponent’s down to 0.',
  },
  rulesTurn: {
    es: 'En tu turno, tus trabajadores producen recursos. Después juegas una carta pagando su coste, o descartas de 1 a 3 cartas. Al acabar repones la mano hasta {hand}.',
    en: 'On your turn your workers produce resources. Then you play one card by paying its cost, or discard 1 to 3 cards. Afterwards your hand refills to {hand}.',
  },
  rulesSchools: {
    es: 'Cada escuela se paga con su recurso: <b>Construcción</b> con Piedra, <b>Asalto</b> con Acero y <b>Arcano</b> con Maná. Los Canteros, Herreros y Arcanistas producen 1 por turno cada uno.',
    en: 'Each school is paid with its resource: <b>Construction</b> with Stone, <b>Assault</b> with Steel and <b>Arcane</b> with Mana. Masons, Smiths and Arcanists each produce 1 per turn.',
  },
  rulesDamage: {
    es: 'El daño golpea primero la <b>Muralla</b> y el resto pasa al Torreón. El daño <b>perforante</b> va directo al Torreón.',
    en: 'Damage hits the <b>Wall</b> first and the rest goes to the Keep. <b>Piercing</b> damage goes straight to the Keep.',
  },
  rulesHeroes: {
    es: 'Tu <b>héroe</b> tiene una pasiva y una <b>definitiva</b> que se carga con el daño que recibes. Usarla no gasta tu jugada.',
    en: 'Your <b>hero</b> has a passive and an <b>ultimate</b> that charges as you take damage. Using it does not spend your play.',
  },
  rulesExtras: {
    es: 'Los <b>encantamientos</b> se quedan en mesa varios turnos (máximo {max}). Las cartas con <b>Combo</b> ganan un extra si tu carta anterior era de la misma escuela (no vale si descartaste entre medias); solo esas cartas tienen Combo. Cada {every} turnos llega un <b>evento de batalla</b> que afecta a los dos.',
    en: '<b>Enchantments</b> stay on the table for several turns (up to {max}). Cards with <b>Combo</b> get a bonus when your previous card was from the same school (a discard in between breaks it); only those cards have Combo. Every {every} turns a <b>battle event</b> hits both players.',
  },
  rulesControls: {
    es: 'Toca una carta para verla grande y jugarla o descartarla. En ordenador también puedes arrastrarla, o usar las teclas 1 a 6, Intro para jugar, Supr para descartar y U para la definitiva.',
    en: 'Tap a card to see it large and play or discard it. On a computer you can also drag it, or use keys 1 to 6, Enter to play, Delete to discard and U for the ultimate.',
  },
} as const satisfies Record<string, LocalizedText>;

export type StringKey = keyof typeof STRINGS;

export function locale(): Locale {
  return settings.get().locale;
}

/** Interface text with `{name}` placeholders filled in. */
export function t(key: StringKey, values: Record<string, string | number> = {}): string {
  return fill(STRINGS[key][locale()], values);
}

/** A catalog text (card, hero, event...) in the current locale. */
export function L(text: LocalizedText): string {
  return localize(text, locale());
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
