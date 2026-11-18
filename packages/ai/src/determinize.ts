import { buildDeckList, getCard, nextRandom, shuffle } from '@cardcraft-castles/engine';
import type {
  CardId,
  CardInstance,
  EffectOp,
  GameState,
  PendingChoice,
  PendingChoiceView,
  PlayerId,
  PlayerPublicState,
  PlayerState,
  PlayerView,
  RngHolder,
} from '@cardcraft-castles/engine';

/**
 * The AI never sees hidden information. It works from a `PlayerView` (what a
 * human in the same seat sees) and, to look ahead with the real rules engine,
 * fills the unknown parts with a random guess: the opponent's hand and the
 * order of both decks. One such guess is a "world"; averaging over several
 * worlds keeps the AI from counting on cards it cannot know about.
 */

/** Remove one copy of each card in `known` from `pool`. */
function removeKnown(pool: CardId[], known: CardId[]): void {
  for (const cardId of known) {
    const index = pool.indexOf(cardId);
    if (index >= 0) pool.splice(index, 1);
  }
}

function guessPlayer(
  view: PlayerView,
  player: PlayerId,
  rng: RngHolder,
  revealed: CardInstance[] | undefined,
): PlayerState {
  const pub: PlayerPublicState = view.players[player];
  const seen = new Map<number, CardId>();
  for (const card of pub.hand) if (card.cardId !== null) seen.set(card.uid, card.cardId);
  for (const card of revealed ?? []) seen.set(card.uid, card.cardId);

  // Every card the player owns that is not known to be in hand: unknown hand
  // cards, the deck and the discard pile all come out of this pool.
  const pool = buildDeckList(view.rules);
  removeKnown(pool, [...seen.values()]);
  shuffle(rng, pool);

  const hand: CardInstance[] = pub.hand.map((card) => ({
    uid: card.uid,
    cardId: seen.get(card.uid) ?? pool.pop()!,
  }));
  const deck = pool.splice(0, Math.min(pub.deckCount, pool.length));

  return {
    hero: pub.hero,
    keep: pub.keep,
    wall: pub.wall,
    resources: { ...pub.resources },
    workers: { ...pub.workers },
    hand,
    deck,
    discard: pool,
    enchantments: pub.enchantments.map((e) => ({ ...e })),
    burn: pub.burn,
    frost: { ...pub.frost },
    shield: pub.shield,
    drawbridge: pub.drawbridge,
    handRevealed: pub.handRevealed,
    ultimateCharge: pub.ultimateCharge,
    ultimateUses: pub.ultimateUses,
    extraTurns: pub.extraTurns,
    lastPlayedCard: pub.lastPlayedCard,
    comboSchool: pub.comboSchool,
    // The view does not carry these. Only Ambush reads them, and it asks about
    // the card that closed the previous turn, which is what `comboSchool` holds.
    schoolsThisTurn: [],
    schoolsLastTurn: pub.comboSchool ? [pub.comboSchool] : [],
  };
}

function isChoiceOp(op: EffectOp, kind: PendingChoiceView['kind']): boolean {
  switch (kind) {
    case 'frostResource':
      return op.op === 'frost' && op.scope === 'choice';
    case 'discardFromHand':
      return op.op === 'peekAndDiscard';
    case 'destroyEnchantment':
      return op.op === 'destroyEnchantment';
  }
}

/**
 * Rebuild the engine's parked effect from what the view shows. The choice
 * always comes from the card the chooser just resolved, so the rest of the
 * effect is whatever that card does after the op that asked.
 * Returns null if it cannot be reconstructed.
 */
function guessPending(view: PlayerView): PendingChoice | null {
  const pending = view.pending;
  if (!pending) return null;
  const cardId = view.players[pending.player].lastPlayedCard;
  if (cardId === null) return null;
  const effects = getCard(cardId).effects;
  const index = effects.findIndex((op) => isChoiceOp(op, pending.kind));
  if (index < 0) return null;
  return {
    player: pending.player,
    kind: pending.kind,
    options: pending.options.slice(),
    ...(pending.revealed ? { revealed: pending.revealed.map((c) => ({ ...c })) } : {}),
    ctx: { player: pending.player, source: { kind: 'card', id: cardId }, combo: false },
    op: effects[index]!,
    rest: effects.slice(index + 1),
  };
}

/**
 * A full game state that is consistent with everything `view` shows, with the
 * hidden parts drawn at random from `rng`. Returns null when the view is in
 * the middle of a choice that cannot be rebuilt (the caller then falls back
 * to the default option).
 */
export function determinize(view: PlayerView, rng: RngHolder): GameState | null {
  const pending = guessPending(view);
  if (view.pending && !pending) return null;

  const opponent: PlayerId = view.viewer === 0 ? 1 : 0;
  const revealed = view.pending?.revealed;
  const players = [0, 1].map((p) =>
    guessPlayer(view, p as PlayerId, rng, p === opponent ? revealed : undefined),
  ) as [PlayerState, PlayerState];

  let nextUid = 1;
  for (const p of players) for (const card of p.hand) nextUid = Math.max(nextUid, card.uid + 1);

  // A fresh generator state for whatever the look-ahead rolls (random discards, events).
  nextRandom(rng);
  return {
    version: 1,
    rules: view.rules,
    rng: rng.rng,
    seq: view.seq,
    turn: view.turn,
    active: view.active,
    phase: view.phase,
    actionsLeft: view.actionsLeft,
    extraTurn: view.extraTurn,
    players,
    pending,
    activeEvent: view.activeEvent ? { ...view.activeEvent } : null,
    upcomingEvent: { ...view.upcomingEvent },
    nextUid,
    result: view.result ? { ...view.result } : null,
  };
}
