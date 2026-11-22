import { getCard, getHero, type HeroId } from '@cardcraft-castles/engine';
import {
  BORDERS,
  CAMPAIGN_DIFFICULTIES,
  CASTLE,
  DEFEAT,
  EPILOGUE,
  FINAL_INTRO,
  FINAL_RIVALS,
  INTRO,
  KINGDOMS,
  PERSONAS,
  PROLOGUE,
  SEND_OFF,
  TERRITORIES,
  TERRITORY_WON,
  TERRITORY_WON_ALLY,
  TIPS,
  attackable,
  awakeningLines,
  battleSetup,
  fallLines,
  getKingdom,
  getTerrain,
  getTerritory,
  isConquered,
  playerDeck,
  startBattle,
  type BattleOutcome,
  type CampaignDifficulty,
  type CampaignSave,
  type KingdomId,
  type Line,
  type Territory,
} from '@cardcraft-castles/campaign';
import { h, html, toast } from '../../app/dom';
import { L, t } from '../../app/i18n';
import { modal, type Screen } from '../../app/router';
import { battlefield } from '../../app/stage';
import { audio } from '../../fx/audio';
import { deleteCampaign, exportCode, importCode, loadCampaign, saveCampaign, seen, startCampaign } from '../../game/campaignStore';
import { artUrl, faceImg, iconSvg } from '../../ui/assets';
import { heroCss, skyFor } from '../../ui/theme';
import { attachCardZoom } from '../../ui/cardZoom';
import { cardFace } from '../../ui/card';
import { SCENE_ART, captainArt, playDialogue, possessedArt } from './dialogue';

const SVG = 'http://www.w3.org/2000/svg';
type RivalKingdom = Exclude<KingdomId, 'valdepiedra'>;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

const narrator = (text: { es: string; en: string }): Line => ({ speaker: { narrator: true }, text });

/** Who defends a territory, as the map and the battle show them. */
function defenderOf(territory: Territory): { name: string; title: string; art: string; hero: HeroId } | null {
  if (territory.kind === 'final') return null;
  if (!territory.kingdom || territory.kind === 'home') return null;
  const kingdom = getKingdom(territory.kingdom);
  if (territory.captain) {
    return { name: territory.captain.name, title: t('campaignCaptainOf', { kingdom: L(kingdom.name) }), art: captainArt(kingdom.id), hero: kingdom.hero };
  }
  const hero = getHero(kingdom.hero);
  return { name: PERSONAS[kingdom.hero]?.name ?? L(hero.name), title: L(hero.name), art: hero.art, hero: kingdom.hero };
}

/** What to show before a battle: the hero's first message, the castle challenge, the final scene, early tips. */
function scenesBefore(save: CampaignSave, territory: Territory, hero: HeroId): { lines: Line[]; keys: string[] } {
  const lines: Line[] = [];
  const keys: string[] = [];
  if (territory.kind === 'final') {
    if (!save.seen.includes('final')) (lines.push(...FINAL_INTRO), keys.push('final'));
    return { lines, keys };
  }
  const kingdom = territory.kingdom as RivalKingdom;
  if (!save.seen.includes(`intro-${kingdom}`)) {
    lines.push(...INTRO[kingdom]);
    keys.push(`intro-${kingdom}`);
  }
  if (territory.kind === 'castle' && !save.seen.includes(`castle-${kingdom}`)) {
    lines.push(...CASTLE[kingdom]);
    keys.push(`castle-${kingdom}`);
  }
  if (territory.captain) lines.push({ speaker: { captain: territory.captain.name, kingdom }, text: territory.captain.line });
  const battles = save.wins + save.losses;
  if (battles < TIPS.length && !save.seen.includes(`tip-${battles}`)) {
    lines.push(narrator(TIPS[battles]!));
    keys.push(`tip-${battles}`);
  }
  if (hero !== 'arquitecta' && SEND_OFF[hero]) lines.push({ speaker: { hero: 'arquitecta' }, text: SEND_OFF[hero]! });
  return { lines, keys };
}

/** What to show back on the map after a battle. */
function scenesAfter(save: CampaignSave, outcome: BattleOutcome): Line[] {
  const territory = getTerritory(outcome.territory);
  const kingdom = territory.kingdom as RivalKingdom | null;
  const lines: Line[] = [];
  if (!outcome.won) {
    const hero = kingdom ? getKingdom(kingdom).hero : FINAL_RIVALS[0]!;
    const options = DEFEAT[hero] ?? [];
    // Each defeat brings the next line, so the same taunt does not come back every time.
    if (options.length) lines.push({ speaker: { hero }, text: options[(Math.max(1, save.losses) - 1) % options.length]! });
    return lines;
  }
  if (territory.kind === 'final') return EPILOGUE.slice();
  if (territory.kind === 'castle' && kingdom) {
    lines.push(...fallLines(kingdom, isConquered(save, 'carmesi-castillo') && kingdom !== 'carmesi'));
    if (outcome.awakened && outcome.ally) lines.push(...awakeningLines(outcome.ally));
  } else if (kingdom) {
    const hero = getKingdom(kingdom).hero;
    if (isConquered(save, `${kingdom}-castillo`)) {
      // The hero is an ally by now: no more grumbling, just a word about their old captains.
      if (TERRITORY_WON_ALLY[hero]) lines.push({ speaker: { hero }, text: TERRITORY_WON_ALLY[hero]! });
    } else {
      // The more of their land falls, the less amused they are.
      const options = TERRITORY_WON[hero] ?? [];
      const taken = TERRITORIES.filter((t) => t.kingdom === kingdom && t.kind === 'territory' && isConquered(save, t.id)).length;
      if (options.length) lines.push({ speaker: { hero }, text: options[Math.min(Math.max(taken, 1), options.length) - 1]! });
    }
  }
  return lines;
}

export function campaignScreen(after: BattleOutcome | null = null): Screen {
  const el = h('div.campaign-screen');
  let save = loadCampaign();
  let selected: string | null = null;
  let hero: HeroId = save?.hero ?? 'arquitecta';
  let busy = false;

  const back = (): void => {
    audio.play('uiBack');
    void import('../flow').then(({ flow }) => flow.menu());
  };

  // ---------------------------------------------------------------------------
  // No campaign yet: choose a difficulty and watch the prologue.
  // ---------------------------------------------------------------------------
  const buildStart = (): void => {
    let difficulty: CampaignDifficulty = 'normal';
    const options = h('div.campaign-difficulties', { role: 'radiogroup', 'aria-label': t('campaignDifficulty') });
    const draw = (): void => {
      options.replaceChildren(
        ...CAMPAIGN_DIFFICULTIES.map((d) => {
          const key = d === 'historia' ? 'campaignHistoria' : d === 'normal' ? 'campaignNormal' : 'campaignDificil';
          return h(
            'button.campaign-difficulty',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(d === difficulty),
              class: d === difficulty ? 'on' : '',
              onclick: () => {
                audio.play('uiClick');
                difficulty = d;
                draw();
              },
            },
            h('strong', null, t(key)),
            h('small', null, t(`${key}Hint` as Parameters<typeof t>[0])),
          );
        }),
      );
    };
    draw();
    el.replaceChildren(
      h(
        'div.campaign-start.panel',
        null,
        h('h1', null, t('campaignTitle')),
        h('p', null, t('campaignNewLead')),
        h('h3', null, t('campaignDifficulty')),
        options,
        h(
          'div.actions',
          null,
          h('button.btn', { type: 'button', onclick: back }, t('back')),
          h(
            'button.btn.primary.big',
            {
              type: 'button',
              onclick: async () => {
                audio.play('uiClick');
                save = startCampaign(difficulty);
                hero = save.hero;
                build();
                await playDialogue(PROLOGUE, SCENE_ART.prologue);
                seen('prologue');
                save = loadCampaign();
              },
            },
            t('campaignStart'),
          ),
        ),
      ),
    );
  };

  // ---------------------------------------------------------------------------
  // The map
  // ---------------------------------------------------------------------------
  const mapSvg = (): SVGSVGElement => {
    const s = save!;
    const open = new Set(attackable(s));
    const root = svg('svg', { viewBox: '0 0 1000 700', class: 'campaign-map', role: 'img', 'aria-label': t('campaignTitle') });
    const defs = svg('defs', {});
    defs.append(
      svg(
        'radialGradient',
        { id: 'cm-glow' },
        svg('stop', { offset: '0%', 'stop-color': '#ffe3a0', 'stop-opacity': '0.9' }),
        svg('stop', { offset: '100%', 'stop-color': '#ffe3a0', 'stop-opacity': '0' }),
      ),
    );
    root.append(defs);

    // The painted valley, once it exists (`art/campaign/mapa.jpg`); the coloured lands sit on top of it.
    const painting = svg('image', { href: artUrl('campaign/mapa.jpg'), x: 0, y: 0, width: 1000, height: 700, preserveAspectRatio: 'xMidYMid slice', class: 'cm-painting' });
    painting.addEventListener('load', () => root.classList.add('has-painting'), { once: true });
    painting.addEventListener('error', () => painting.remove(), { once: true });
    root.append(painting);

    // Kingdom lands: a soft patch of the hero's colour with the kingdom's name.
    for (const k of KINGDOMS) {
      const color = heroCss(k.hero);
      root.append(svg('ellipse', { cx: k.x, cy: k.y, rx: k.id === 'carmesi' ? 190 : 150, ry: k.id === 'carmesi' ? 105 : 140, fill: color, 'fill-opacity': 0.2, stroke: color, 'stroke-opacity': 0.45, 'stroke-dasharray': '6 6', class: 'cm-land' }));
    }
    root.append(svg('circle', { cx: 500, cy: 380, r: 70, class: 'cm-crown-land' }));

    // Borders.
    for (const [a, b] of BORDERS) {
      const ta = getTerritory(a);
      const tb = getTerritory(b);
      const owned = isConquered(s, a) && isConquered(s, b);
      const front = (isConquered(s, a) && open.has(b)) || (isConquered(s, b) && open.has(a));
      root.append(svg('line', { x1: ta.x, y1: ta.y, x2: tb.x, y2: tb.y, class: `cm-border${owned ? ' owned' : front ? ' front' : ''}` }));
    }

    for (const k of KINGDOMS) {
      // Valdepiedra is a single castle: its node already carries the name.
      if (k.id === 'valdepiedra') continue;
      const label = svg('text', { x: k.x, y: k.id === 'carmesi' ? 252 : k.y - 118, class: 'cm-kingdom-name' }, L(k.name));
      root.append(label);
    }

    // Territories.
    for (const territory of TERRITORIES) {
      const owned = isConquered(s, territory.id);
      const canAttack = open.has(territory.id);
      const kingdom = territory.kingdom ? getKingdom(territory.kingdom) : null;
      const color = owned ? heroCss('arquitecta') : kingdom ? heroCss(kingdom.hero) : '#8a3a34';
      const big = territory.kind !== 'territory';
      const r = territory.kind === 'final' ? 30 : big ? 24 : 16;
      const g = svg('g', {
        class: `cm-node ${territory.kind}${owned ? ' owned' : ''}${canAttack ? ' open' : ''}${selected === territory.id ? ' selected' : ''}`,
        transform: `translate(${territory.x} ${territory.y})`,
        tabindex: 0,
        role: 'button',
        'aria-label': L(territory.name),
        style: `--c:${color}`,
      });
      if (canAttack) g.append(svg('circle', { r: r + 16, fill: 'url(#cm-glow)', class: 'cm-pulse' }));
      g.append(svg('circle', { r, class: 'cm-dot' }));
      if (big) {
        // A small keep on castles, home and the Crown.
        g.append(svg('path', { d: 'M-9 7V-3h-3v-6h4v3h3v-3h10v3h3v-3h4v6h-3V7z', class: 'cm-keep' }));
      } else if (owned) {
        g.append(svg('path', { d: 'M-6 0l4 4 8-9', class: 'cm-check' }));
      }
      const held = s.held[territory.id]?.length ?? 0;
      if (held) {
        g.append(svg('circle', { cx: r * 0.8, cy: -r * 0.8, r: 9, class: 'cm-held' }));
        g.append(svg('text', { x: r * 0.8, y: -r * 0.8 + 4, class: 'cm-held-n' }, String(held)));
      }
      g.append(svg('text', { y: r + 16, class: 'cm-name' }, L(territory.name)));
      const pick = (): void => {
        audio.play('uiClick');
        selected = territory.id;
        build();
      };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      root.append(g);
    }
    return root;
  };

  const detail = (): HTMLElement => {
    const s = save!;
    const id = selected ?? attackable(s)[0] ?? 'valdepiedra';
    const territory = getTerritory(id);
    const owned = isConquered(s, id);
    const canAttack = attackable(s).includes(id);
    const kingdom = territory.kingdom ? getKingdom(territory.kingdom) : null;
    const defender = defenderOf(territory);
    const terrain = territory.terrain ? getTerrain(territory.terrain) : null;
    const held = s.held[id] ?? [];

    const rewards = territory.rewards.filter((c) => !s.unlocked.includes(c));
    const ally = territory.kind === 'castle' && kingdom && !s.allies.includes(kingdom.hero) ? kingdom.hero : null;

    const heroPicker = h(
      'div.campaign-heroes',
      { role: 'radiogroup', 'aria-label': t('campaignChooseHero') },
      s.allies.map((id) =>
        h(
          'button.campaign-hero',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(id === hero),
            class: id === hero ? 'on' : '',
            title: L(getHero(id).name),
            style: `--hero:${heroCss(id)}`,
            onclick: () => {
              audio.play('uiClick');
              hero = id;
              build();
            },
          },
          faceImg(getHero(id).art, undefined, { alt: L(getHero(id).name) }),
        ),
      ),
    );

    return h(
      'aside.campaign-detail.panel',
      { style: kingdom ? `--hero:${heroCss(kingdom.hero)}` : '' },
      h('div.campaign-detail-head', null, h('h2', null, L(territory.name)), kingdom && territory.kind !== 'home' ? h('small', null, L(kingdom.name)) : null),
      territory.kind === 'home'
        ? h('p', null, t('campaignHome'))
        : territory.kind === 'final' && !canAttack && !owned
          ? h('p', null, t('campaignCrownLocked'))
          : null,
      owned && territory.kind !== 'home' ? h('p.campaign-owned', null, html(iconSvg('keep')), t('campaignConquered')) : null,
      defender && !owned
        ? h(
            'div.campaign-defender',
            null,
            faceImg(defender.art, getHero(defender.hero).art),
            h('div', null, h('small', null, t('campaignDefender')), h('strong', null, defender.name), h('span', null, defender.title)),
          )
        : null,
      territory.kind === 'final' && !owned
        ? h('div.campaign-defender', null, h('div', null, h('small', null, t('campaignDefender')), h('strong', null, FINAL_RIVALS.map((r) => PERSONAS[r]!.name).join(' · '))))
        : null,
      terrain && !owned ? h('div.campaign-terrain', null, h('small', null, t('campaignTerrain')), h('strong', null, L(terrain.name)), h('span', null, L(terrain.text))) : null,
      held.length ? h('p.campaign-held-note', null, t('campaignHeld', { n: held.length })) : null,
      !owned && (rewards.length || ally)
        ? h(
            'div.campaign-rewards',
            null,
            h('small', null, t('campaignReward')),
            ally ? h('p.campaign-ally', null, t('campaignRewardHero', { hero: L(getHero(ally).name) })) : null,
            h(
              'div.campaign-reward-cards',
              null,
              rewards.map((c) => {
                const face = cardFace(c, { lazy: true });
                face.title = L(getCard(c).name);
                attachCardZoom(face, c);
                return face;
              }),
            ),
          )
        : null,
      canAttack
        ? [
            h('small.campaign-hero-label', null, t('campaignChooseHero')),
            heroPicker,
            h(
              'button.btn.primary.big.campaign-attack',
              { type: 'button', onclick: () => void attack(id) },
              html(iconSvg('sword')),
              t('campaignAttack'),
            ),
          ]
        : !owned && territory.kind !== 'final' && territory.kind !== 'home'
          ? h('p.campaign-locked', null, t('campaignUnreachable'))
          : null,
    );
  };

  const attack = async (id: string): Promise<void> => {
    if (busy || !save) return;
    busy = true;
    try {
      audio.play('uiClick');
      const territory = getTerritory(id);
      const scenes = scenesBefore(save, territory, hero);
      await playDialogue(scenes.lines, territory.kind === 'final' ? SCENE_ART.crown : undefined);
      for (const key of scenes.keys) seen(key);
      save = loadCampaign()!;
      const battleId = `${id}:${Date.now().toString(36)}`;
      const setup = battleSetup(save, id, hero);
      save = startBattle(save, id, hero, battleId);
      saveCampaign(save);
      const { flow } = await import('../flow');
      flow.startCampaignBattle({ id: battleId, setup }, defenderSeats(territory));
    } finally {
      busy = false;
    }
  };

  const options = (): void => {
    audio.play('uiClick');
    modal((close) => {
      const code = h('textarea.campaign-code', { rows: 3, readonly: true, 'aria-label': t('campaignCopyCode') }) as HTMLTextAreaElement;
      code.value = exportCode(save!);
      const paste = h('textarea.campaign-code', { rows: 3, placeholder: 'CC1.…', 'aria-label': t('campaignPasteCode') }) as HTMLTextAreaElement;
      return h(
        'div.modal.panel.campaign-options',
        null,
        h('h2', null, t('campaignOptions')),
        h('p', null, t('campaignCodeHint')),
        code,
        h(
          'button.btn',
          {
            type: 'button',
            onclick: () => {
              code.select();
              void navigator.clipboard?.writeText(code.value).then(
                () => toast(t('campaignCodeCopied')),
                () => document.execCommand('copy') && toast(t('campaignCodeCopied')),
              );
            },
          },
          t('campaignCopyCode'),
        ),
        paste,
        h(
          'button.btn',
          {
            type: 'button',
            onclick: () => {
              const loaded = importCode(paste.value);
              if (!loaded) return toast(t('campaignCodeInvalid'), 'warn');
              saveCampaign(loaded);
              save = loaded;
              hero = loaded.hero;
              selected = null;
              toast(t('campaignCodeLoaded'));
              close();
              build();
            },
          },
          t('campaignPasteCode'),
        ),
        h('hr'),
        h('button.btn.ghost', { type: 'button', onclick: () => (close(), void playDialogue(PROLOGUE, SCENE_ART.prologue)) }, t('campaignStory')),
        h(
          'button.btn.danger',
          {
            type: 'button',
            onclick: (e: Event) => {
              // Two taps: the first asks, the second deletes.
              const btn = e.currentTarget as HTMLButtonElement;
              if (!btn.dataset.armed) {
                btn.dataset.armed = '1';
                btn.textContent = t('campaignResetConfirm');
                return;
              }
              deleteCampaign();
              save = null;
              selected = null;
              close();
              build();
            },
          },
          t('campaignReset'),
        ),
      );
    });
  };

  const build = (): void => {
    if (!save) return buildStart();
    if (!save.allies.includes(hero)) hero = save.allies[0]!;
    const total = TERRITORIES.filter((x) => x.kind !== 'home').length;
    const conquered = save.conquered.filter((x) => getTerritory(x).kind !== 'home').length;
    const header = h(
      'header.campaign-bar',
      null,
      h('button.btn', { type: 'button', onclick: back }, t('back')),
      h('div.campaign-title', null, h('h1', null, t('playCampaign')), h('span.beta-tag', null, t('betaTag'))),
      h(
        'div.campaign-stats',
        null,
        h('span', null, t('campaignProgress', { n: conquered, total })),
        h('span', null, t('campaignDeck', { n: playerDeck(save).length })),
        h(
          'span.campaign-allies',
          { title: t('campaignAllies') },
          save.allies.map((a) => faceImg(getHero(a).art, undefined, { alt: L(getHero(a).name), title: L(getHero(a).name), style: `--hero:${heroCss(a)}` })),
        ),
      ),
      h('button.btn.icon-only', { type: 'button', title: t('campaignOptions'), 'aria-label': t('campaignOptions'), onclick: options }, html(iconSvg('gear'))),
    );
    const scroller = h('div.campaign-map-wrap', null, mapSvg());
    el.replaceChildren(header, h('div.campaign-body', null, scroller, save.finished ? doneCard() : detail()));
    // On a narrow screen the map scrolls: start at the player's front.
    requestAnimationFrame(() => {
      const target = getTerritory(selected ?? attackable(save!)[0] ?? 'valdepiedra');
      const svgEl = scroller.querySelector('svg')!;
      const scale = svgEl.clientWidth / 1000;
      scroller.scrollLeft = target.x * scale - scroller.clientWidth / 2;
      scroller.scrollTop = target.y * scale - scroller.clientHeight / 2;
    });
  };

  const doneCard = (): HTMLElement =>
    h(
      'aside.campaign-detail.panel.campaign-done',
      null,
      h('h2', null, t('campaignDone')),
      h('p', null, t('campaignDoneLead')),
      h('div.campaign-cards', null, save!.allies.map((a) => h('img.campaign-ally-art', { src: artUrl(getHero(a).art), alt: L(getHero(a).name) }))),
      h('button.btn', { type: 'button', onclick: () => void playDialogue(EPILOGUE, SCENE_ART.epilogue) }, t('campaignStory')),
    );

  return {
    el,
    mount() {
      build();
      audio.music('menu');
      const field = battlefield();
      field.layout();
      void field.setMood(skyFor(null), 900);
      if (after && save) {
        const lines = scenesAfter(save, after);
        void playDialogue(lines, after.won && getTerritory(after.territory).kind === 'final' ? SCENE_ART.epilogue : undefined);
      }
    },
    resize() {
      requestAnimationFrame(() => battlefield().layout());
    },
    relocalize() {
      build();
    },
  };
}

/** The AI seats of a campaign battle, as the board shows them. */
function defenderSeats(territory: Territory): { nickname: string; hero: HeroId; isAi: true; title?: { es: string; en: string }; portrait?: string }[] {
  if (territory.kind === 'final') {
    return FINAL_RIVALS.map((hero) => ({ nickname: PERSONAS[hero]!.name, hero, isAi: true as const, title: { es: 'Poseído por el Ocaso', en: 'Possessed by the Twilight' }, portrait: possessedArt(hero) }));
  }
  const kingdom = getKingdom(territory.kingdom!);
  if (territory.captain) {
    return [
      {
        nickname: territory.captain.name,
        hero: kingdom.hero,
        isAi: true,
        title: { es: `Capitán · ${kingdom.name.es}`, en: `Captain · ${kingdom.name.en}` },
        portrait: captainArt(kingdom.id),
      },
    ];
  }
  return [{ nickname: PERSONAS[kingdom.hero]!.name, hero: kingdom.hero, isAi: true }];
}

