/**
 * Client shell: a PixiJS stage that runs a local game on the rules engine and
 * draws both castles. It exists to prove the pipeline (engine, events,
 * rendering, texts in two languages); the real board, cards, lobby and
 * effects replace it.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  BATTLE_EVENTS,
  CARDS,
  GAME_TITLE,
  HEROES,
  TERMS,
  applyAction,
  createGame,
  eagerPolicy,
  getCard,
  getHero,
  hashSeed,
  legalActions,
  localize,
  randomPick,
  type GameEvent,
  type GameState,
  type Locale,
  type PlayerId,
} from '@cardcraft-castles/engine';
import { detectLocale, t } from './i18n';

const COLORS = { sky: 0x0d1220, ground: 0x1a2233, keep: 0xd8c08a, wall: 0x8d7b5a, ink: 0xf3e9d2, gold: 0xd9a441 };

let locale: Locale = detectLocale();
let state: GameState;
let lastLine = '';
const rng = { rng: hashSeed(Date.now()) };

const app = new Application();
await app.init({ resizeTo: window, background: COLORS.sky, antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
document.getElementById('stage')!.appendChild(app.canvas);

const scene = new Container();
app.stage.addChild(scene);

const logLine = document.getElementById('log')!;
const nextButton = document.getElementById('next') as HTMLButtonElement;
const restartButton = document.getElementById('restart') as HTMLButtonElement;
const localeButton = document.getElementById('locale') as HTMLButtonElement;

function heroName(player: PlayerId): string {
  return localize(getHero(state.players[player].hero).name, locale);
}

function describe(events: GameEvent[]): string {
  for (const event of events) {
    if (event.type === 'gameOver') {
      return event.winner === null ? t('draw', locale) : t('wins', locale, { who: heroName(event.winner) });
    }
  }
  for (const event of events) {
    const who = 'player' in event ? heroName(event.player) : '';
    if (event.type === 'cardPlayed') return t('played', locale, { who, card: localize(getCard(event.cardId).name, locale) });
    if (event.type === 'cardDiscarded') return t('discarded', locale, { who, card: localize(getCard(event.cardId).name, locale) });
    if (event.type === 'ultimateUsed') return t('ultimate', locale, { who });
    if (event.type === 'choiceMade') return t('chose', locale, { who });
  }
  return '';
}

function label(text: string, size: number, color: number, bold = false): Text {
  return new Text({
    text,
    style: { fontFamily: 'Georgia, serif', fontSize: size, fill: color, fontWeight: bold ? 'bold' : 'normal', align: 'center' },
  });
}

/** One castle: the Keep as a tower and the Wall in front of it, scaled to their heights. */
function drawCastle(player: PlayerId, centerX: number, groundY: number, unit: number, facing: 1 | -1): void {
  const p = state.players[player];
  const keepWidth = unit * 14;
  const keepHeight = Math.max(2, p.keep) * unit;
  const wallWidth = unit * 5;
  const wallHeight = p.wall * unit;
  const wallX = centerX + facing * (keepWidth / 2 + unit * 6);

  const g = new Graphics();
  g.rect(centerX - keepWidth / 2, groundY - keepHeight, keepWidth, keepHeight).fill(COLORS.keep);
  for (let i = 0; i < 4; i++) {
    g.rect(centerX - keepWidth / 2 + (i * keepWidth) / 3.5, groundY - keepHeight - unit * 2, keepWidth / 7, unit * 2).fill(COLORS.keep);
  }
  if (wallHeight > 0) g.rect(wallX - wallWidth / 2, groundY - wallHeight, wallWidth, wallHeight).fill(COLORS.wall);
  if (state.active === player && state.phase !== 'finished') {
    g.rect(centerX - keepWidth, groundY + unit * 1.5, keepWidth * 2, unit * 0.8).fill(COLORS.gold);
  }
  scene.addChild(g);

  const name = label(heroName(player), Math.max(14, unit * 3.2), COLORS.gold, true);
  name.anchor.set(0.5, 1);
  name.position.set(centerX, groundY - Math.max(keepHeight, wallHeight) - unit * 5);
  const stats = label(
    `${localize(TERMS.keep, locale)} ${p.keep}  ·  ${localize(TERMS.wall, locale)} ${p.wall}`,
    Math.max(12, unit * 2.6),
    COLORS.ink,
  );
  stats.anchor.set(0.5, 0);
  stats.position.set(centerX, groundY + unit * 3.5);
  scene.addChild(name, stats);
}

function render(): void {
  scene.removeChildren().forEach((child) => child.destroy());
  const { width, height } = app.screen;
  const groundY = height * 0.68;
  // One unit is one point of Keep; a winning Keep (100) must fit above the ground.
  const unit = Math.min((groundY - height * 0.2) / state.rules.keepWin, width / 90);

  scene.addChild(new Graphics().rect(0, groundY, width, height - groundY).fill(COLORS.ground));

  const title = label(GAME_TITLE, Math.max(22, Math.min(width / 16, 54)), COLORS.gold, true);
  title.anchor.set(0.5, 0);
  title.position.set(width / 2, height * 0.03);
  const tagline = label(
    `${t('tagline', locale)}\n${t('turn', locale, { turn: state.turn })}`,
    Math.max(13, Math.min(width / 44, 20)),
    COLORS.ink,
  );
  tagline.anchor.set(0.5, 0);
  tagline.position.set(width / 2, title.y + title.height + 4);
  scene.addChild(title, tagline);

  drawCastle(0, width * 0.25, groundY, unit, 1);
  drawCastle(1, width * 0.75, groundY, unit, -1);

  document.documentElement.lang = locale;
  logLine.textContent =
    lastLine || t('shellNote', locale, { cards: CARDS.length, heroes: HEROES.length, events: BATTLE_EVENTS.length });
  nextButton.textContent = t('next', locale);
  nextButton.disabled = state.phase === 'finished';
  restartButton.textContent = t('restart', locale);
  localeButton.textContent = t('switchLocale', locale);
}

function newGame(): void {
  const heroes = HEROES.map((h) => h.id);
  state = createGame({ seed: Date.now(), heroes: [randomPick(rng, heroes), randomPick(rng, heroes)] }).state;
  lastLine = '';
  render();
}

function nextMove(): void {
  if (state.phase === 'finished') return;
  const result = applyAction(state, eagerPolicy(state, legalActions(state), rng));
  if (!result.ok) return;
  state = result.state;
  lastLine = describe(result.events) || lastLine;
  render();
}

nextButton.addEventListener('click', nextMove);
restartButton.addEventListener('click', newGame);
localeButton.addEventListener('click', () => {
  locale = locale === 'es' ? 'en' : 'es';
  lastLine = '';
  render();
});
window.addEventListener('resize', () => requestAnimationFrame(render));

newGame();
