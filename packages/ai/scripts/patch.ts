/**
 * Try balance changes without editing the game data. A patch file lists new
 * numbers for cards and heroes; it is applied to the catalog in memory, for
 * this run only:
 *
 *   {
 *     "cards":  { "catapulta": { "cost": 10 }, "parapeto": { "effects": [{ "op": "wall", "amount": 7 }] } },
 *     "heroes": { "mariscal": { "ultimate": [{ "op": "damage", "amount": 12 }] } }
 *   }
 *
 * Once a patch gives the numbers you want, move them to `design/cards.json`
 * and `packages/engine/src/data` (and update the card's test).
 */
import { readFileSync } from 'node:fs';
import { CARDS, getCard, getHero, type EffectOp, type HeroPassive } from '@cardcraft-castles/engine';
import { arg } from './parallel';

export interface Patch {
  cards?: Record<string, { cost?: number; effects?: EffectOp[] }>;
  heroes?: Record<string, { passive?: HeroPassive; ultimate?: EffectOp[] }>;
  /** Multiply every card's damage, Wall or Keep amounts, to explore the pace of the game. */
  scale?: { damage?: number; wall?: number; keep?: number };
}

function scaled(ops: readonly EffectOp[], scale: NonNullable<Patch['scale']>): EffectOp[] {
  return ops.map((op) => {
    if (op.op === 'if') {
      return { ...op, then: scaled(op.then, scale), ...(op.else ? { else: scaled(op.else, scale) } : {}) };
    }
    if (op.op === 'damage' || op.op === 'wall' || op.op === 'keep') {
      return { ...op, amount: Math.max(1, Math.round(op.amount * (scale[op.op] ?? 1))) };
    }
    return op;
  });
}

/** Apply the file given with `--patch`, if any. Returns the patch for the report header. */
export function applyPatchFromArgs(): Patch | null {
  const file = arg('patch', '');
  if (!file) return null;
  const patch = JSON.parse(readFileSync(file, 'utf8')) as Patch;
  for (const [id, change] of Object.entries(patch.cards ?? {})) Object.assign(getCard(id), change);
  for (const [id, change] of Object.entries(patch.heroes ?? {})) Object.assign(getHero(id), change);
  if (patch.scale) for (const card of CARDS) Object.assign(card, { effects: scaled(card.effects, patch.scale) });
  return patch;
}
