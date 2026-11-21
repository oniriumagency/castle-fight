import { describe, expect, it } from 'vitest';
import { CARDS, applyAction, createGame } from '@cardcraft-castles/engine';
import { chooseAction, profileForTier } from '@cardcraft-castles/ai';
import {
  BORDERS,
  FINAL_RIVALS,
  RIVAL_KINGDOMS,
  STARTING_CARDS,
  TERRITORIES,
  attackable,
  battleSetup,
  heroesDefeated,
  MIN_DECK,
  neighboursOf,
  newCampaign,
  parseCampaign,
  playerDeck,
  rivalDeck,
  rivalTier,
  settleBattle,
  startBattle,
  ultimateAwake,
  type CampaignSave,
} from '../src/index';

/** Win `territory` straight away. */
function win(save: CampaignSave, territory: string, hero = save.hero): CampaignSave {
  const started = startBattle(save, territory, hero, `b-${territory}-${save.wins + save.losses}`);
  return settleBattle(started, started.pending!.id, true)!.save;
}

describe('map', () => {
  it('hands out every card exactly once: the starting deck plus the rewards', () => {
    const rewards = TERRITORIES.flatMap((t) => t.rewards);
    const all = [...STARTING_CARDS, ...rewards].sort();
    expect(all).toEqual(CARDS.map((c) => c.id).sort());
  });

  it('borders are between real territories and every territory is reachable', () => {
    const ids = new Set(TERRITORIES.map((t) => t.id));
    for (const [a, b] of BORDERS) expect(ids.has(a) && ids.has(b)).toBe(true);
    const seen = new Set(['valdepiedra']);
    const queue = ['valdepiedra'];
    while (queue.length) for (const n of neighboursOf(queue.shift()!)) if (!seen.has(n)) (seen.add(n), queue.push(n));
    // The Crown has no borders: it opens when the five castles fall.
    expect([...ids].filter((id) => !seen.has(id))).toEqual(['corona']);
  });

  it('each castle sits behind at least two territories of its kingdom', () => {
    for (const k of RIVAL_KINGDOMS) {
      for (const n of neighboursOf(`${k}-castillo`)) {
        expect(n.startsWith(`${k}-`)).toBe(true);
        expect(neighboursOf(n).some((m) => !m.startsWith(`${k}-`))).toBe(false);
      }
    }
  });
});

describe('progress', () => {
  it('starts with the Architect, 18 cards, no ultimate, and two borders to attack', () => {
    const save = newCampaign();
    expect(save.allies).toEqual(['arquitecta']);
    expect(playerDeck(save).length).toBe(72);
    expect(ultimateAwake(save)).toBe(false);
    expect(attackable(save).sort()).toEqual(['alambiques-a', 'bastion-a']);
  });

  it('conquering opens the neighbours, the castle gives its hero and wakes the ultimate', () => {
    let save = newCampaign();
    save = win(save, 'bastion-a');
    expect(save.unlocked).toContain('puntales');
    expect(attackable(save)).toContain('bastion-c');
    expect(attackable(save)).not.toContain('bastion-castillo');
    save = win(save, 'bastion-c');
    expect(attackable(save)).toContain('bastion-castillo');
    const started = startBattle(save, 'bastion-castillo', 'arquitecta', 'x');
    const { save: after, outcome } = settleBattle(started, 'x', true)!;
    expect(outcome.ally).toBe('guardian');
    expect(outcome.awakened).toBe(true);
    expect(after.allies).toContain('guardian');
    expect(heroesDefeated(after)).toBe(1);
    // The result counts once.
    expect(settleBattle(after, 'x', true)).toBeNull();
  });

  it('a defeat leaves a copy with the territory until it is conquered', () => {
    let save = startBattle(newCampaign(), 'bastion-a', 'arquitecta', 'l1');
    const lost = settleBattle(save, 'l1', false, () => 0)!;
    expect(lost.outcome.lost).toBe(playerDeck(save)[0]);
    expect(playerDeck(lost.save).length).toBe(71);
    save = startBattle(lost.save, 'bastion-a', 'arquitecta', 'w1');
    const won = settleBattle(save, 'w1', true)!;
    expect(won.outcome.recovered).toEqual([lost.outcome.lost]);
    expect(playerDeck(won.save).length).toBe(72 + 4 + 4);
  });

  it('never takes the deck below the minimum', () => {
    let save = newCampaign();
    for (let i = 0; i < 40; i++) {
      save = startBattle(save, 'bastion-a', 'arquitecta', `l${i}`);
      save = settleBattle(save, `l${i}`, false)!.save;
    }
    expect(playerDeck(save).length).toBe(MIN_DECK);
  });

  it('the Crown opens after the five castles and ends the campaign', () => {
    let save = newCampaign();
    const order = ['bastion-a', 'bastion-c', 'bastion-castillo', 'bastion-b', 'ceniza-a', 'ceniza-c', 'ceniza-castillo', 'ceniza-b', 'carmesi-a', 'carmesi-c', 'carmesi-castillo', 'carmesi-b', 'escarcha-b', 'escarcha-c', 'escarcha-castillo', 'escarcha-a', 'alambiques-b', 'alambiques-c', 'alambiques-castillo'];
    for (const t of order) {
      expect(attackable(save)).not.toContain('corona');
      save = win(save, t);
    }
    expect(save.allies.length).toBe(6);
    expect(attackable(save)).toContain('corona');
    const setup = battleSetup(save, 'corona', 'mariscal');
    expect(setup.heroes).toEqual(['mariscal', ...FINAL_RIVALS]);
    const started = startBattle(save, 'corona', 'mariscal', 'f');
    expect(settleBattle(started, 'f', true)!.save.finished).toBe(true);
  });

  it('reads back what it saved and drops nonsense', () => {
    const save = win(newCampaign('dificil'), 'alambiques-a');
    expect(parseCampaign(JSON.parse(JSON.stringify(save)))).toEqual(save);
    expect(parseCampaign({ v: 2 })).toBeNull();
    expect(parseCampaign(null)).toBeNull();
  });
});

describe('battles', () => {
  it('captains play without passive or ultimate and with their kingdom’s cards', () => {
    const save = newCampaign();
    const setup = battleSetup(save, 'bastion-a', 'arquitecta');
    expect(setup.heroes).toEqual(['arquitecta', 'guardian']);
    expect(setup.seats[0]!.ultimateLocked).toBe(true);
    expect(setup.seats[1]).toMatchObject({ noPassive: true, ultimateLocked: true });
    expect(setup.seats[1]!.deck).toContain('puntales');
    expect(setup.rules.wallStart).toBe(25);
    const castle = battleSetup(win(win(save, 'bastion-a'), 'bastion-c'), 'bastion-castillo', 'arquitecta');
    expect(castle.seats[1]!.noPassive).toBeUndefined();
    expect(castle.seats[1]!.deck).toContain('ciudadela-eterna');
    expect(rivalDeck(save, 'corona')).toBeUndefined();
  });

  it('gets harder with every hero beaten and with the chosen difficulty', () => {
    const save = newCampaign();
    // The first castle gets a softer AI on purpose: its deck already makes it the hardest fight so far.
    expect(rivalTier(save, 'bastion-castillo')).toBeLessThan(rivalTier(save, 'bastion-a'));
    const later = win(win(win(save, 'bastion-a'), 'bastion-c'), 'bastion-castillo');
    expect(rivalTier(later, 'alambiques-a')).toBeLessThan(rivalTier(later, 'alambiques-castillo'));
    expect(rivalTier(later, 'alambiques-a')).toBeGreaterThan(rivalTier(save, 'alambiques-a'));
    expect(rivalTier(newCampaign('historia'), 'bastion-a')).toBeLessThan(rivalTier(save, 'bastion-a'));
    expect(rivalTier(newCampaign('dificil'), 'bastion-a')).toBeGreaterThan(rivalTier(save, 'bastion-a'));
  });

  it('every battle of the campaign plays to the end with the real engine and AI', () => {
    let save = newCampaign();
    for (const t of ['bastion-a', 'alambiques-a', 'alambiques-c']) {
      const setup = battleSetup(save, t, 'arquitecta');
      let { state } = createGame({ seed: t, heroes: setup.heroes, seats: setup.seats, rules: setup.rules, ...(setup.firstEvent ? { firstEvent: setup.firstEvent } : {}) });
      let steps = 0;
      while (state.phase !== 'finished' && steps++ < 2000) {
        const result = applyAction(state, chooseAction(state, 'normal', { profile: profileForTier(setup.tier) }));
        if (!result.ok) throw new Error(result.error.message);
        state = result.state;
      }
      expect(state.phase).toBe('finished');
      save = win(save, t);
    }
  });
});
