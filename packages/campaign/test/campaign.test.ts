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
  RENAMED,
  isFutureCampaign,
  CAMPAIGN_VERSION,
  playerDeck,
  rivalDeck,
  rivalTier,
  settleBattle,
  startBattle,
  ultimateAwake,
  revealedBy,
  visibleTerritories,
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
    save = win(win(save, 'bastion-c'), 'bastion-b');
    // The hero is always the last battle of their kingdom.
    expect(attackable(save)).not.toContain('bastion-castillo');
    save = win(save, 'bastion-d');
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

  it('the map shows only the player’s land and what they can attack; the hero shows up last', () => {
    let save = newCampaign();
    expect(visibleTerritories(save).sort()).toEqual(['alambiques-a', 'bastion-a', 'valdepiedra']);
    save = win(save, 'bastion-a');
    expect(visibleTerritories(save)).toContain('bastion-c');
    expect(revealedBy(save, 'bastion-a')).toContain('bastion-c');
    save = win(win(save, 'bastion-c'), 'bastion-b');
    // Three captains down: the castle next to them is still out of sight.
    expect(visibleTerritories(save)).not.toContain('bastion-castillo');
    save = win(save, 'bastion-d');
    expect(visibleTerritories(save)).toContain('bastion-castillo');
    expect(revealedBy(save, 'bastion-d')).toContain('bastion-castillo');
    expect(visibleTerritories(save)).not.toContain('corona');
    // Every visible territory is held or can be attacked, and nothing else.
    const shown = new Set(visibleTerritories(save));
    for (const t of TERRITORIES) expect(shown.has(t.id)).toBe(save.conquered.includes(t.id) || attackable(save).includes(t.id));
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
    const order = ['bastion', 'alambiques', 'ceniza', 'escarcha', 'carmesi'].flatMap((k) => ['a', 'c', 'b', 'd', 'castillo'].map((x) => `${k}-${x}`));
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

  it('keeps old saves through updates: lenient fields, unknown ids set aside and brought back', () => {
    const save = win(newCampaign('dificil'), 'alambiques-a');
    // A save written before `seen` existed, with no version, and a difficulty this build does not know.
    const { seen: _seen, v: _v, ...bare } = save;
    const loose = parseCampaign({ ...bare, difficulty: 'pesadilla' })!;
    expect(loose.conquered).toEqual(save.conquered);
    expect(loose.difficulty).toBe('normal');
    expect(loose.seen).toEqual([]);
    // A territory, card and hero this build does not have: kept aside, not dropped.
    const odd = { ...save, conquered: [...save.conquered, 'isla-perdida'], unlocked: [...save.unlocked, 'carta-retirada'], allies: [...save.allies, 'bardo'], held: { 'isla-perdida': ['carta-retirada'] } };
    const parsed = parseCampaign(JSON.parse(JSON.stringify(odd)))!;
    expect(parsed.conquered).toEqual(save.conquered);
    expect(parsed.unlocked).toEqual(save.unlocked);
    expect(parsed.retired).toEqual({ conquered: ['isla-perdida'], unlocked: ['carta-retirada'], allies: ['bardo'], held: { 'isla-perdida': ['carta-retirada'] } });
    // ...and it survives being saved and played on.
    const again = parseCampaign(JSON.parse(JSON.stringify(win(parsed, 'alambiques-c'))))!;
    expect(again.retired).toEqual(parsed.retired);
    // Once a rename points the old id at a real one, the progress comes back.
    RENAMED.territories['isla-perdida'] = 'bastion-a';
    try {
      const back = parseCampaign(JSON.parse(JSON.stringify(again)))!;
      expect(back.conquered).toContain('bastion-a');
      expect(back.retired?.conquered).toEqual([]);
      expect(back.held['bastion-a']).toBeUndefined();
      expect(back.retired?.held).toEqual({ 'bastion-a': ['carta-retirada'] });
    } finally {
      delete RENAMED.territories['isla-perdida'];
    }
    expect(isFutureCampaign({ ...save, v: CAMPAIGN_VERSION + 1 })).toBe(true);
    expect(isFutureCampaign(save)).toBe(false);
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
    const castle = battleSetup(['bastion-a', 'bastion-c', 'bastion-b', 'bastion-d'].reduce((acc, id) => win(acc, id), save), 'bastion-castillo', 'arquitecta');
    expect(castle.seats[1]!.noPassive).toBeUndefined();
    expect(castle.seats[1]!.deck).toContain('ciudadela-eterna');
    expect(rivalDeck(save, 'corona')).toBeUndefined();
  });

  it('gets harder with every hero beaten and with the chosen difficulty', () => {
    const save = newCampaign();
    // The first castle gets a softer AI on purpose: its deck already makes it the hardest fight so far.
    expect(rivalTier(save, 'bastion-castillo')).toBeLessThan(rivalTier(save, 'bastion-a'));
    const later = ['bastion-a', 'bastion-c', 'bastion-b', 'bastion-d', 'bastion-castillo'].reduce((acc, id) => win(acc, id), save);
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

describe('dialogues', () => {
  it('every rival hero has four different lines for losing land and for beating the player', async () => {
    const { TERRITORY_WON, TERRITORY_WON_ALLY, DEFEAT } = await import('../src/dialogues');
    for (const hero of ['guardian', 'alquimista', 'saboteadora', 'hechicera', 'mariscal']) {
      for (const set of [TERRITORY_WON[hero]!, DEFEAT[hero]!]) {
        expect(set).toHaveLength(4);
        expect(new Set(set.map((l) => l.es)).size).toBe(4);
        expect(set.every((l) => l.es && l.en)).toBe(true);
      }
      expect(TERRITORY_WON_ALLY[hero]?.es).toBeTruthy();
    }
  });
});
