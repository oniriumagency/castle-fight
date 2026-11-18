/**
 * Core types of the Cardcraft: Castles rules engine.
 *
 * Everything in `GameState` is plain JSON (no classes, Maps, Dates or
 * functions), so a state can be stored, sent over the wire and restored with
 * `JSON.stringify` / `JSON.parse`.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Seat index, from 0. Classic games have 2 players; the free-for-all
 * prototype has 3. In 2-player games "the opponent" is always `other(p)`.
 */
export type PlayerId = number;

/**
 * How cards that hit "the opponent" work when there are 3 or more players.
 *  - `choose`: the player picks one rival per card (the `target` of the action).
 *  - `all` (default): the card hits every living rival, scaled by `rules.multiAllScale`.
 *    No alliances are possible: hitting one rival always hits the other too.
 */
export type MultiTargeting = 'choose' | 'all';
export type Locale = 'es' | 'en';
export type LocalizedText = Record<Locale, string>;

export type School = 'construccion' | 'asalto' | 'arcano';
export type Resource = 'piedra' | 'acero' | 'mana';
export type Rarity = 'comun' | 'rara' | 'epica' | 'legendaria';
export type ResourceMap = Record<Resource, number>;

/** Ids come from `design/cards.json`; they are validated when the catalog loads. */
export type CardId = string;
export type HeroId = string;
export type BattleEventId = string;

// ---------------------------------------------------------------------------
// Rules (tunable numbers)
// ---------------------------------------------------------------------------

export interface Rules {
  /** Starting Keep height. */
  keepStart: number;
  /** Starting Wall height. */
  wallStart: number;
  /** Keep height that wins the game. */
  keepWin: number;
  /** Starting amount of each resource. */
  resourceStart: number;
  /** Starting number of each worker. */
  workerStart: number;
  /** Extra Wall for the player who moves second, to make up for the lost tempo. */
  secondPlayerWall: number;
  /** Cards in hand; the hand refills to this size when your turn starts. */
  handSize: number;
  /** Most cards one discard action can throw away. */
  discardMax: number;
  /** Turn clock for online play. The engine has no clock: see the `timeout` action. */
  turnSeconds: number;
  /** Enchantments a player can have at once. */
  maxEnchantments: number;
  /** A global battle event fires after every this many turns. */
  eventEveryTurns: number;
  /** Copies of each card in a player's deck, by rarity. */
  deckCopies: Record<Rarity, number>;
  /** Damage dealt by Burn at the start of the burned player's turn. */
  burnDamage: number;
  /** Burn turns stack up to this cap. */
  burnMaxTurns: number;
  /** Frost turns on one resource stack up to this cap. */
  frostMaxTurns: number;
  /** Shield charges stack up to this cap. */
  shieldMaxCharges: number;
  /** Damage a player must take to charge the hero ultimate for the first time. */
  ultimateCharge: number;
  /** Each use of the ultimate raises the damage needed for the next one by this much. */
  ultimateChargeStep: number;
  /** Workers of a type can never drop below this. */
  minWorkers: number;
  /** Events can never reduce a Keep below this (events are never lethal). */
  eventKeepFloor: number;
  /** After this many turns the higher Keep wins. 0 disables the limit. */
  turnLimit: number;
  /** 3+ players only: how cards that hit "the opponent" pick their victims. */
  multiTargeting: MultiTargeting;
  /**
   * 3+ players, `all` mode, while 2+ rivals are alive: damage, steals, drains
   * and Burn turns are multiplied by this per rival (rounded, at least 1).
   */
  multiAllScale: number;
  /** 3+ players: attacks against the strict leader (highest Keep) deal this much more. */
  leaderExtraDamage: number;
  /** 3+ players: whoever knocks a castle down gains this much of each resource. */
  eliminationBounty: number;
  /**
   * Twilight Fury: from the start of this turn the war escalates so long games
   * end. 0 (or missing, in saves from older versions) turns it off.
   */
  twilightTurn: number;
  /** Twilight Fury: its level rises by one every this many turns. */
  twilightEvery: number;
  /** Twilight Fury: extra damage of every attack, per level. */
  twilightAttackBonus: number;
  /** Twilight Fury: Wall the active player loses at the start of their turn, per level. */
  twilightErosion: number;
  /** Twilight Fury: Keep the active player loses at the start of their turn, per level (never below 1). */
  twilightKeepErosion: number;
  /** Twilight Fury: extra Castle every card that builds it raises, per level. */
  twilightBuildBonus: number;
  /**
   * Twilight Fury: this many turns after it starts the game is decided at the
   * end of the turn (highest Castle, then Wall, wins). 0: no deadline.
   */
  twilightTurns: number;
}

// ---------------------------------------------------------------------------
// Data-driven effect definitions
// ---------------------------------------------------------------------------

export type DamageKind =
  /** Hits the Wall first, the remainder goes to the Keep. */
  | 'normal'
  /** Ignores the Wall and hits the Keep. */
  | 'piercing'
  /** Hits only the Wall; nothing carries over to the Keep. */
  | 'wallOnly';

export type Condition =
  /** Your Keep is below `value`. */
  | { kind: 'selfKeepBelow'; value: number }
  /** Your opponent played a card of `school` during their last turn. */
  | { kind: 'opponentPlayedSchoolLastTurn'; school: School };

/** Passive modifiers granted by an enchantment while it is on the table. */
export interface EnchantmentModifiers {
  /** Effects resolved at the start of each of the owner's turns. */
  onTurnStart?: EffectOp[];
  /** Each attack against the owner's Wall deals this much less damage. */
  wallDamageReduction?: number;
  /** Each of the owner's attacks deals this much more damage. */
  attackBonus?: number;
  /** The opponent's cards of `school` cost `amount` more. */
  opponentCostIncrease?: { school: School; amount: number };
}

/**
 * One atomic step of a card, ultimate or enchantment effect. "You" is the
 * player resolving the effect, "opponent" is the other player.
 */
export type EffectOp =
  /**
   * +amount to your Wall. `comboBonus` is added when Combo is active and
   * `perDiscard` once for each card the same effect made you discard.
   */
  | { op: 'wall'; amount: number; comboBonus?: number; perDiscard?: number }
  /** +amount to your Keep. */
  | { op: 'keep'; amount: number; comboBonus?: number; perDiscard?: number }
  /**
   * An attack against the opponent. Each repetition (`times`) is a separate
   * hit: attack bonuses, Buttress reduction and Shield apply per hit.
   * `wallMultiplier` multiplies the damage the Wall takes.
   */
  | {
      op: 'damage';
      amount: number;
      kind?: DamageKind;
      times?: number;
      wallMultiplier?: number;
      comboBonus?: number;
      /** Added to `amount` once for each card the same effect made you discard. */
      perDiscard?: number;
    }
  | { op: 'gainResource'; resource: Resource | 'all'; amount: number }
  | { op: 'gainWorker'; worker: Resource; amount: number }
  /** Steal up to `amount` of the resource the opponent has most of. */
  | { op: 'stealResource'; amount: number }
  /** The opponent loses `amount` of each resource. */
  | { op: 'drainResources'; amount: number }
  /** The opponent loses 1 worker of the type they have most of (never below `minWorkers`). */
  | { op: 'loseWorker' }
  /** Like `loseWorker`, and you gain a worker of that type. */
  | { op: 'stealWorker' }
  /** Burn on the opponent. */
  | { op: 'burn'; turns: number }
  /** Frost on the opponent: one chosen resource, or all three. */
  | { op: 'frost'; scope: 'choice' | 'all'; turns: number }
  /** Shield charges for you. */
  | { op: 'shield'; charges: number }
  /** Remove your negative statuses (Burn and Frost). */
  | { op: 'cleanse' }
  /**
   * Put the source card on the table as an enchantment. It lasts `turns` of
   * the owner's turns or, with `charges`, that many attacks: each attack that
   * uses its `attackBonus` or `wallDamageReduction` spends one.
   */
  | { op: 'enchant'; turns?: number; charges?: number; modifiers: EnchantmentModifiers }
  /** Destroy one enemy enchantment (choice when there are several). */
  | { op: 'destroyEnchantment' }
  /** The opponent's hand is revealed until your next turn. */
  | { op: 'revealHand' }
  /** The next piercing attack against you is treated as normal damage. */
  | { op: 'drawbridge' }
  /** Look at the opponent's hand and discard one card of your choice. */
  | { op: 'peekAndDiscard' }
  /** The opponent discards `count` random cards. */
  | { op: 'discardRandom'; count: number }
  /**
   * Discard `count` cards of your own hand, chosen one at a time, or the whole
   * hand. With `upTo` you may stop early. Each card counts for `perDiscard`.
   */
  | { op: 'discardOwn'; count: number | 'hand'; upTo?: boolean }
  /** Draw `count` cards. */
  | { op: 'draw'; count: number }
  | { op: 'swapWalls' }
  /** Resolve the effects of the last card the opponent played. */
  | { op: 'copyLast' }
  /** Take an extra turn after this one. */
  | { op: 'extraTurn' }
  /** Discard your hand and draw a full new one. */
  | { op: 'redrawHand' }
  /** You may play (or discard) one more card this turn. */
  | { op: 'extraPlay' }
  | { op: 'if'; cond: Condition; then: EffectOp[]; else?: EffectOp[] };

export interface CardDef {
  id: CardId;
  school: School;
  rarity: Rarity;
  /** Base cost, paid in the resource of the card's school. */
  cost: number;
  name: LocalizedText;
  text: LocalizedText;
  /** Rules text for 3+ players, where the card hits every rival with scaled numbers (absent: same as `text`). */
  textFfa?: LocalizedText;
  /** Art path relative to `art/`. */
  art: string;
  effects: EffectOp[];
}

export interface HeroPassive {
  /** Your cards of `school` cost `amount` less. */
  costReduction?: { school: School; amount: number };
  /** Each of your attacks deals this much more damage. */
  attackBonus?: number;
  /** Burn and Frost you apply last this many more turns. */
  statusDurationBonus?: number;
  /** At the start of your turn, gain this much of one random resource. */
  randomResourcePerTurn?: number;
  /** When you discard as your action, steal this much of the opponent's top resource. */
  stealOnDiscard?: number;
  /** Your Wall starts this much higher. */
  startingWallBonus?: number;
}

export interface HeroDef {
  id: HeroId;
  name: LocalizedText;
  text: LocalizedText;
  /** Rules text for 3+ players (absent: same as `text`). */
  textFfa?: LocalizedText;
  art: string;
  passive: HeroPassive;
  ultimate: EffectOp[];
}

/** Effects of a global battle event; they hit both players alike. */
export type BattleEventEffect =
  | { kind: 'bothLoseWall'; amount: number }
  | { kind: 'bothLoseKeep'; amount: number }
  | { kind: 'bothGainResources'; amount: number }
  | { kind: 'bothGainRandomWorker' }
  /** For `turns` turns, cards of `school` cost half (rounded up). */
  | { kind: 'halfCost'; school: School; turns: number }
  /** For `turns` turns, cards of `school` cannot be played. */
  | { kind: 'banSchool'; school: School; turns: number };

export interface BattleEventDef {
  id: BattleEventId;
  name: LocalizedText;
  text: LocalizedText;
  art: string;
  effect: BattleEventEffect;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

/**
 * A card in a hand. `uid` is assigned when the card is drawn, so it carries no
 * information about the card and is safe to show to the opponent.
 */
export interface CardInstance {
  uid: number;
  cardId: CardId;
}

export interface Enchantment {
  cardId: CardId;
  /**
   * Owner turns left. It ticks down at the end of each owner turn after the
   * one it was played on. Unused (0) when the enchantment has `charges`.
   */
  turnsLeft: number;
  /** Attacks left, for enchantments that last a number of attacks instead of turns. */
  charges?: number;
  /** True during the turn the enchantment was played. */
  fresh: boolean;
}

export interface PlayerState {
  hero: HeroId;
  keep: number;
  wall: number;
  resources: ResourceMap;
  workers: ResourceMap;
  hand: CardInstance[];
  /** Draw pile; the next card is the last element. */
  deck: CardId[];
  discard: CardId[];
  /** Oldest first. */
  enchantments: Enchantment[];
  /** Burn turns left. */
  burn: number;
  /** Frost turns left per resource. */
  frost: ResourceMap;
  /** Shield charges. */
  shield: number;
  /** The next piercing attack against this player is treated as normal damage. */
  drawbridge: boolean;
  /** This player's hand is visible to the opponent until the opponent's next turn. */
  handRevealed: boolean;
  /**
   * Cards a rival's effect made this player discard since their last turn: they
   * draw that many fewer when their next turn starts (the hand only refills on
   * the turn after). Missing in old saves: 0.
   */
  drawShort?: number;
  /** Who revealed it; the hand hides again when that player's next turn starts. */
  revealedBy?: PlayerId;
  /** 3+ players: this castle fell and the player no longer takes turns. */
  eliminated?: boolean;
  /** Damage taken towards the next ultimate (see `ultimateThreshold`). */
  ultimateCharge: number;
  /** Times this player has used the ultimate. */
  ultimateUses: number;
  /** Extra turns waiting after the current one. */
  extraTurns: number;
  /** Last card whose effect this player resolved (what Mirage copies). */
  lastPlayedCard: CardId | null;
  /** School of the last card played; discarding resets it. Drives Combo. */
  comboSchool: School | null;
  schoolsThisTurn: School[];
  schoolsLastTurn: School[];
}

/** Who or what produced an effect. */
export interface EffectSource {
  kind: 'card' | 'ultimate' | 'enchantment';
  id: string;
}

export interface EffectContext {
  player: PlayerId;
  source: EffectSource;
  combo: boolean;
  /** Cards this effect has made its player discard so far (drives `perDiscard`). */
  discarded?: number;
  /** 3+ players, `choose` mode: the rival this effect is aimed at. */
  target?: PlayerId;
}

export type ChoiceKind =
  /** Pick the opponent resource to freeze. Options are `Resource` names. */
  | 'frostResource'
  /** Pick the opponent card to discard. Options are card uids as strings. */
  | 'discardFromHand'
  /** Pick the enemy enchantment to destroy. Options are card ids. */
  | 'destroyEnchantment'
  /**
   * Pick one of your own cards to discard. Options are card uids as strings,
   * plus `'done'` (first, the default) when you may stop early.
   */
  | 'discardOwn';

/** A decision the active player must make before the effect continues. */
export interface PendingChoice {
  player: PlayerId;
  kind: ChoiceKind;
  /** Valid answers; the first one is the default used on timeout. */
  options: string[];
  /** For `discardFromHand`: the opponent hand being looked at. */
  revealed?: CardInstance[];
  /** For `discardOwn`: cards discarded so far and how many more at most. */
  progress?: { done: number; left: number };
  /** @internal */
  ctx: EffectContext;
  /** @internal */
  op: EffectOp;
  /** @internal */
  rest: EffectOp[];
}

export type GamePhase =
  /** The active player must play or discard (and may use the ultimate). */
  | 'action'
  /** The active player must answer `state.pending`. */
  | 'choice'
  | 'finished';

export type GameOverReason =
  /** The winner's Keep reached `rules.keepWin`. */
  | 'keepBuilt'
  /** The loser's Keep fell to 0 (with 3+ players: the winner is the last castle standing). */
  | 'keepDestroyed'
  | 'concede'
  /** `rules.turnLimit` was reached; the higher Keep (then Wall) wins. */
  | 'turnLimit'
  /** The Twilight Fury deadline was reached; the higher Keep (then Wall) wins. */
  | 'twilight';

export interface GameResult {
  /** `null` is a draw (only possible on `turnLimit`). */
  winner: PlayerId | null;
  reason: GameOverReason;
}

export interface GameState {
  version: 1;
  rules: Rules;
  /** Seeded RNG state (uint32). Never send it to clients. */
  rng: number;
  /** Number of actions applied so far. */
  seq: number;
  /** Turn number, starting at 1. Each player's turn counts as one. */
  turn: number;
  active: PlayerId;
  phase: GamePhase;
  /** Cards the active player may still play or discard this turn. */
  actionsLeft: number;
  /** True when the current turn is an extra turn. */
  extraTurn: boolean;
  players: PlayerState[];
  pending: PendingChoice | null;
  /** Battle event with a lasting effect that is currently running. */
  activeEvent: { id: BattleEventId; turnsLeft: number } | null;
  /** The next battle event and the turn at whose start it fires. Public. */
  upcomingEvent: { id: BattleEventId; turn: number };
  nextUid: number;
  result: GameResult | null;
}

// ---------------------------------------------------------------------------
// Board: the public part shared by `GameState` and `PlayerView`
// ---------------------------------------------------------------------------

export interface BoardPlayer {
  hero: HeroId;
  keep: number;
  resources: ResourceMap;
  enchantments: Enchantment[];
  ultimateCharge: number;
  ultimateUses: number;
  lastPlayedCard: CardId | null;
  comboSchool: School | null;
  /** Schools of the cards played during this player's last turn (drives some card conditions). */
  schoolsLastTurn: School[];
  hand: VisibleCard[];
  eliminated?: boolean;
}

/**
 * What the query helpers (`legalActions`, `effectiveCost`, `playBlocker`...)
 * need to know. Both the server's `GameState` and a client's `PlayerView`
 * fit, so the same helpers work on either side.
 */
export interface Board {
  rules: Rules;
  /** Turn number (drives the Twilight Fury). */
  turn: number;
  active: PlayerId;
  phase: GamePhase;
  players: BoardPlayer[];
  pending: { player: PlayerId; options: string[] } | null;
  activeEvent: { id: BattleEventId; turnsLeft: number } | null;
  /** Present on a `PlayerView` only. */
  viewer?: PlayerId;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  /** Play the card `uid` from your hand, paying its cost. */
  | { type: 'play'; player: PlayerId; uid: number; target?: PlayerId }
  /**
   * Discard the card `uid` from your hand as your action, plus the cards in
   * `also` (up to `rules.discardMax` cards in all). The hand refills when the player's next turn starts.
   */
  | { type: 'discard'; player: PlayerId; uid: number; also?: number[] }
  /** Use the hero ultimate. Free action: it does not use up your play. */
  | { type: 'ultimate'; player: PlayerId; target?: PlayerId }
  /** Answer the pending choice with one of `state.pending.options`. */
  | { type: 'choose'; player: PlayerId; option: string }
  /** Give up. Allowed at any time, for either player. */
  | { type: 'concede'; player: PlayerId }
  /**
   * The turn clock ran out. SERVER ONLY: never accept it from a client.
   * Pending choices take their default and a random card is discarded.
   */
  | { type: 'timeout' };

export type ErrorCode =
  | 'gameOver'
  | 'notYourTurn'
  | 'wrongPhase'
  | 'cardNotInHand'
  | 'cannotAfford'
  | 'schoolBanned'
  | 'nothingToCopy'
  | 'ultimateNotReady'
  | 'invalidChoice'
  | 'invalidAction';

export interface EngineError {
  code: ErrorCode;
  message: string;
}

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineError };

// ---------------------------------------------------------------------------
// Event log (what happened, for animation, VFX, audio and replays)
// ---------------------------------------------------------------------------

/** A card as one viewer sees it: `cardId` is null when it is hidden. */
export interface VisibleCard {
  uid: number;
  cardId: CardId | null;
}

export type ChangeReason = EffectSource | { kind: 'production' | 'hero' | 'battleEvent' | 'twilight'; id: string };

export type GameEvent =
  | { type: 'gameStarted'; firstPlayer: PlayerId; heroes: HeroId[] }
  | { type: 'turnStarted'; player: PlayerId; turn: number; extraTurn: boolean }
  | { type: 'turnEnded'; player: PlayerId; turn: number }
  /** A global battle event fired. `turns` is set for lasting events. */
  | { type: 'battleEventStarted'; eventId: BattleEventId; turns: number | null }
  | { type: 'battleEventEnded'; eventId: BattleEventId }
  /** The next battle event was announced. */
  | { type: 'battleEventForecast'; eventId: BattleEventId; turn: number }
  /**
   * The Twilight Fury began or grew (`level` 1, 2, 3...). `deadline` is the
   * turn at whose end the game is decided, or 0 if it has none.
   */
  | { type: 'twilightRose'; level: number; deadline: number }
  /** Start-of-turn production. `frozen` lists resources that did not produce. */
  | { type: 'produced'; player: PlayerId; gained: ResourceMap; frozen: Resource[] }
  /** `delta` is the actual change (already clamped at 0). */
  | { type: 'resourcesChanged'; player: PlayerId; delta: Partial<ResourceMap>; reason: ChangeReason }
  | { type: 'workersChanged'; player: PlayerId; delta: Partial<ResourceMap>; reason: ChangeReason }
  | {
      type: 'cardPlayed';
      player: PlayerId;
      uid: number;
      cardId: CardId;
      resource: Resource;
      cost: number;
      combo: boolean;
    }
  | { type: 'cardCopied'; player: PlayerId; cardId: CardId }
  | {
      type: 'cardDiscarded';
      player: PlayerId;
      uid: number;
      cardId: CardId;
      reason: 'action' | 'timeout' | 'effect';
    }
  /** The whole hand was discarded face down (Augur's Eye). */
  | { type: 'handRedrawn'; player: PlayerId; count: number }
  /** `visible` is true when the owner's hand was revealed at that moment. */
  | { type: 'cardsDrawn'; player: PlayerId; cards: VisibleCard[]; visible: boolean }
  | { type: 'deckReshuffled'; player: PlayerId }
  /** A Keep or Wall grew. `amount` is the actual growth. */
  | { type: 'built'; player: PlayerId; target: 'keep' | 'wall'; amount: number; reason: ChangeReason }
  /**
   * One hit. `amount` is the damage after bonuses and reductions; `wallLoss`
   * and `keepLoss` are what the target actually lost. `blocked` means a Shield
   * charge absorbed the hit.
   */
  | {
      type: 'damage';
      source: PlayerId;
      target: PlayerId;
      kind: DamageKind;
      cause: 'card' | 'ultimate' | 'burn';
      amount: number;
      wallLoss: number;
      keepLoss: number;
      blocked: boolean;
    }
  /** A Keep or Wall shrank without being attacked (battle events). */
  | { type: 'structureLost'; player: PlayerId; target: 'keep' | 'wall'; amount: number; reason: ChangeReason }
  | { type: 'wallsSwapped'; walls: number[] }
  | { type: 'burnApplied'; player: PlayerId; turns: number; total: number }
  | { type: 'frostApplied'; player: PlayerId; resource: Resource; turns: number; total: number }
  | { type: 'shieldGained'; player: PlayerId; charges: number; total: number }
  | { type: 'statusesCleansed'; player: PlayerId }
  | { type: 'drawbridgeRaised'; player: PlayerId }
  | { type: 'drawbridgeLowered'; player: PlayerId }
  | { type: 'handRevealed'; player: PlayerId; cards: CardInstance[] }
  | { type: 'handHidden'; player: PlayerId }
  | {
      type: 'enchantmentAdded';
      player: PlayerId;
      cardId: CardId;
      turns: number;
      /** Attacks it lasts, for enchantments counted in attacks instead of turns. */
      charges?: number;
      refreshed: boolean;
    }
  | { type: 'enchantmentTriggered'; player: PlayerId; cardId: CardId }
  /** An attack spent one charge of an enchantment; `charges` are the ones left. */
  | { type: 'enchantmentCharge'; player: PlayerId; cardId: CardId; charges: number }
  | {
      type: 'enchantmentRemoved';
      player: PlayerId;
      cardId: CardId;
      reason: 'expired' | 'destroyed' | 'replaced' | 'spent';
    }
  | { type: 'choiceRequested'; player: PlayerId; kind: ChoiceKind; options: string[]; revealed?: CardInstance[] }
  | { type: 'choiceMade'; player: PlayerId; kind: ChoiceKind; option: string }
  | { type: 'ultimateCharged'; player: PlayerId; charge: number; threshold: number; ready: boolean }
  | { type: 'ultimateUsed'; player: PlayerId; heroId: HeroId }
  | { type: 'extraTurnGranted'; player: PlayerId }
  | { type: 'extraPlayGranted'; player: PlayerId }
  | { type: 'timedOut'; player: PlayerId }
  /** 3+ players: a castle fell. `by` is who knocked it down (null for a concession). */
  | { type: 'playerEliminated'; player: PlayerId; by: PlayerId | null }
  | { type: 'gameOver'; winner: PlayerId | null; reason: GameOverReason };

// ---------------------------------------------------------------------------
// Per-player view (hidden information removed)
// ---------------------------------------------------------------------------

export interface PlayerPublicState {
  hero: HeroId;
  keep: number;
  wall: number;
  resources: ResourceMap;
  workers: ResourceMap;
  enchantments: Enchantment[];
  burn: number;
  frost: ResourceMap;
  shield: number;
  drawbridge: boolean;
  handRevealed: boolean;
  ultimateCharge: number;
  /** Charge needed for the next ultimate. */
  ultimateThreshold: number;
  ultimateReady: boolean;
  ultimateUses: number;
  extraTurns: number;
  lastPlayedCard: CardId | null;
  comboSchool: School | null;
  /** Schools of the cards played during this player's last turn. */
  schoolsLastTurn: School[];
  eliminated: boolean;
  /** Your own cards are always visible; the opponent's only when revealed. */
  hand: VisibleCard[];
  deckCount: number;
  discardCount: number;
}

export interface PendingChoiceView {
  player: PlayerId;
  kind: ChoiceKind;
  /** Empty for the player who is not choosing. */
  options: string[];
  revealed?: CardInstance[];
  /** For `discardOwn`: cards discarded so far and how many more at most. */
  progress?: { done: number; left: number };
  /** 3+ players: the rival the effect is aimed at. */
  target?: PlayerId;
}

/** What one player is allowed to know. Safe to send to that player's client. */
export interface PlayerView {
  viewer: PlayerId;
  rules: Rules;
  seq: number;
  turn: number;
  active: PlayerId;
  phase: GamePhase;
  actionsLeft: number;
  extraTurn: boolean;
  /** Indexed by `PlayerId`, like `GameState.players`. */
  players: PlayerPublicState[];
  pending: PendingChoiceView | null;
  activeEvent: { id: BattleEventId; turnsLeft: number } | null;
  upcomingEvent: { id: BattleEventId; turn: number };
  result: GameResult | null;
}
