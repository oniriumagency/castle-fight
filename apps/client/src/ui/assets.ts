import type { Resource, School } from '@cardcraft-castles/engine';

/** URL of an illustration from its catalog path (`cards/x.jpg` → the WebP made by `scripts/build-art.mjs`). */
export function artUrl(path: string): string {
  return `${import.meta.env.BASE_URL}art/${path.replace(/\.(jpe?g|png)$/i, '.webp')}`;
}

/** URL of a portrait's round close-up of the face (`heroes/x.jpg` → `heroes/x-face.webp`, made by `scripts/build-art.mjs`). */
export function faceUrl(path: string): string {
  return artUrl(path.replace(/\.(jpe?g|png)$/i, '-face.jpg'));
}

/**
 * A round portrait: the sharp close-up of the face, then the whole painting,
 * then `fallback` (a captain whose portrait is not painted yet shows their hero).
 */
export function faceImg(path: string, fallback = path, attrs: Record<string, string> = {}): HTMLImageElement {
  const img = document.createElement('img');
  for (const [k, v] of Object.entries(attrs)) img.setAttribute(k, v);
  if (!img.hasAttribute('alt')) img.alt = '';
  img.draggable = false;
  const chain = [faceUrl(path), artUrl(path), faceUrl(fallback), artUrl(fallback)].filter((u, i, all) => all.indexOf(u) === i);
  let step = 0;
  img.src = chain[0]!;
  img.addEventListener('error', () => {
    step++;
    if (step < chain.length) img.src = chain[step]!;
  });
  return img;
}

const preloaded = new Set<string>();

/** Starts downloading illustrations so cards never pop in empty. */
export function preloadArt(paths: readonly string[]): Promise<void> {
  const pending = paths
    .map(artUrl)
    .filter((url) => !preloaded.has(url))
    .map(
      (url) =>
        new Promise<void>((resolve) => {
          preloaded.add(url);
          const img = new Image();
          img.decoding = 'async';
          img.onload = img.onerror = () => resolve();
          img.src = url;
        }),
    );
  return Promise.all(pending).then(() => undefined);
}

/**
 * Handles an illustration that fails to load. A download can fail for a
 * moment (a dropped connection on a phone, a request cut off while the tab
 * was in the background), and the browser never tries again on its own, so
 * the card would stay dark for the rest of the match. Try once more after a
 * short pause, skipping the cache, and only call `onMissing` if that fails too
 * (the file really is not there, such as a card whose art is not painted yet).
 */
export function watchArt(img: HTMLImageElement, onMissing: () => void): void {
  let retried = false;
  img.addEventListener('error', () => {
    if (retried) {
      onMissing();
      return;
    }
    retried = true;
    const src = img.getAttribute('src');
    if (!src) {
      onMissing();
      return;
    }
    window.setTimeout(() => {
      img.src = `${src}${src.includes('?') ? '&' : '?'}retry=${Date.now()}`;
    }, 1200);
  });
}

/** Inline SVG icons. Drawn for this game; `currentColor` lets CSS tint them. */
const PATHS = {
  // Resources (same shapes as the cost shield on the card frame).
  piedra: '<path d="M1 5l4-3h7l3 3v6l-3 3H5l-4-3z"/>',
  acero: '<path d="M12.5 1L15 1l0 2.5-7 7 1.5 1.5-1.5 1.5-1.8-1.8L3.5 14.5 1.5 12.5l2.8-2.7L2.5 8 4 6.5 5.5 8z"/>',
  mana: '<path d="M8 0l5 6-5 10L3 6z"/>',
  hero: '<path d="M1 13l1-9 3.5 4L8 2l2.5 6L14 4l1 9z"/>',
  // Structures
  keep: '<path d="M3 15V5H2V1h2v1.5h2V1h4v1.5h2V1h2v4h-1v10H9.5v-3.5a1.5 1.5 0 0 0-3 0V15z"/>',
  wall: '<path d="M0 15V6h2V4h2v2h2V4h4v2h2V4h2v2h2v9zM2 8v2h3V8zm4.5 0v2h3V8zM11 8v2h3V8zM4 11.5v2h3v-2zm5 0v2h3v-2z" fill-rule="evenodd"/>',
  // Workers (a hammer for each trade would be too similar; a figure with a badge)
  worker: '<path d="M8 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 15c0-3.5 2.2-6.5 5-6.5s5 3 5 6.5z"/>',
  // Statuses
  burn: '<path d="M8 0c1 3 4.5 4.5 4.5 9A4.5 4.5 0 0 1 8 15.5 4.5 4.5 0 0 1 3.5 11c0-2 1-3.3 2-4.2 0 1.5.6 2.7 1.7 3.1C6.6 6.6 7.3 3 8 0z"/>',
  frost:
    '<path d="M7.25 0h1.5v3.2l1.9-1.4.9 1.2-2.8 2.1v2.1l1.8-1 .4-3.4 1.5.2-.3 2.3 2.8-1.6.75 1.3-2.8 1.6 2.2.9-.6 1.4-3.2-1.3-1.8 1 1.8 1 3.2-1.3.6 1.4-2.2.9 2.8 1.6-.75 1.3-2.8-1.6.3 2.3-1.5.2-.4-3.4-1.8-1v2.1l2.8 2.1-.9 1.2-1.9-1.4V16h-1.5v-3.2l-1.9 1.4-.9-1.2 2.8-2.1V8.8l-1.8 1-.4 3.4-1.5-.2.3-2.3-2.8 1.6-.75-1.3 2.8-1.6-2.2-.9.6-1.4 3.2 1.3 1.8-1-1.8-1-3.2 1.3-.6-1.4 2.2-.9L.8 4.3l.75-1.3 2.8 1.6-.3-2.3 1.5-.2.4 3.4 1.8 1V4.9L5 2.8l.9-1.2 1.35 1z"/>',
  // A blade eaten through by rust, dripping.
  rust: '<path d="M13.5 0 16 2.5 7.5 11l-1-1 1.6-2.6-2 .6zM5 10.5 6.5 12 4 14.5 2.5 13zM2 15.5a1.2 1.2 0 1 1 0-.01zM11 9.5c.8 1.2 1.3 2 1.3 2.6a1.3 1.3 0 0 1-2.6 0c0-.6.5-1.4 1.3-2.6z"/>',
  shield: '<path d="M8 0l6.5 2.5V7c0 4.2-2.7 7.4-6.5 9C4.2 14.4 1.5 11.2 1.5 7V2.5z"/>',
  eye: '<path d="M8 3c3.6 0 6.4 2.6 7.6 5-1.2 2.4-4 5-7.6 5S1.6 10.4.4 8C1.6 5.6 4.4 3 8 3zm0 2.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z" fill-rule="evenodd"/>',
  enchant: '<path d="M8 0l1.8 5.2L15 6.2l-4.1 3.4L12.3 15 8 12l-4.3 3 1.4-5.4L1 6.2l5.2-1z"/>',
  combo: '<path d="M9.5 0L3 9h4.5L6 16l7-9.5H8.5z"/>',
  // Interface
  gear: '<path d="M6.7 0h2.6l.4 2.1 1.3.6 1.8-1.2 1.8 1.8-1.2 1.8.6 1.3 2 .4v2.6l-2 .4-.6 1.3 1.2 1.8-1.8 1.8-1.8-1.2-1.3.6-.4 2.1H6.7l-.4-2.1-1.3-.6-1.8 1.2-1.8-1.8 1.2-1.8-.6-1.3L0 9.3V6.7l2-.4.6-1.3-1.2-1.8 1.8-1.8L5 2.7l1.3-.6zM8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z" fill-rule="evenodd"/>',
  menu: '<path d="M1 3h14v2H1zm0 4h14v2H1zm0 4h14v2H1z"/>',
  scroll: '<path d="M3 1h9a2 2 0 0 1 2 2v1h-2v9a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-1h2V3a2 2 0 0 1 1-2zm1.5 3v1.5h6V4zm0 3v1.5h6V7zm0 3v1.5h4V10z" fill-rule="evenodd"/>',
  sunset: '<path d="M8 6.5a5 5 0 0 1 5 5H3a5 5 0 0 1 5-5zM0 12.5h16V14H0zM7.25 1h1.5v3.5h-1.5zM1.9 3.6l1.05-1.05 2.3 2.3L4.2 5.9zm12.2 0-1.05-1.05-2.3 2.3 1.05 1.05z"/>',
  clock: '<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm-.9 3v5.6l4 2.4.8-1.3-3.3-2V3z" fill-rule="evenodd"/>',
  close: '<path d="M2.3 1L8 6.7 13.7 1 15 2.3 9.3 8l5.7 5.7-1.3 1.3L8 9.3 2.3 15 1 13.7 6.7 8 1 2.3z"/>',
  link: '<path d="M6.4 9.6l3.2-3.2 1 1-3.2 3.2zM4 7.5l1-1 1 1-1 1a2.1 2.1 0 0 0 3 3l1-1 1 1-1 1a3.5 3.5 0 0 1-5-5zm8 1l-1 1-1-1 1-1a2.1 2.1 0 0 0-3-3l-1 1-1-1 1-1a3.5 3.5 0 0 1 5 5z"/>',
  sword: '<path d="M14 0h2v2L6.5 11.5 8 13l-1.3 1.3-1.6-1.6L2 15.8.2 14l3.1-3.1-1.6-1.6L3 8l1.5 1.5z"/>',
  users: '<path d="M5.5 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM0 14c0-3 2.4-5.5 5.5-5.5S11 11 11 14zm11-12a2.5 2.5 0 1 1 0 5zm1.2 6.6C14.4 9.3 16 11.4 16 14h-3.6c0-2-.8-4-2.2-5.3z"/>',
  book: '<path d="M1 2c2.5-.8 5-.6 6.5 1v12C6 13.6 3.5 13.4 1 14.2zm14 0v12.2c-2.5-.8-5-.6-6.5.8V3c1.5-1.6 4-1.8 6.5-1z"/>',
  globe: '<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM2 7h2.6c.1-1.8.5-3.4 1.1-4.6A6 6 0 0 0 2 7zm4.1 0h3.8C9.7 4 8.8 2.1 8 2c-.8.1-1.7 2-1.9 5zm5.3 0H14a6 6 0 0 0-3.7-4.6c.6 1.2 1 2.8 1.1 4.6zM2 9a6 6 0 0 0 3.7 4.6c-.6-1.2-1-2.8-1.1-4.6zm4.1 0c.2 3 1.1 4.9 1.9 5 .8-.1 1.7-2 1.9-5zm5.3 0c-.1 1.8-.5 3.4-1.1 4.6A6 6 0 0 0 14 9z" fill-rule="evenodd"/>',
  emote: '<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM5 5a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 5 5zm6 0a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 11 5zM4 9.5c.8 1.8 2.3 3 4 3s3.2-1.2 4-3z" fill-rule="evenodd"/>',
  arrow: '<path d="M10 1L3 8l7 7 1.4-1.4L5.8 8l5.6-5.6z"/>',
  sound: '<path d="M1 5.5h3L8 2v12l-4-3.5H1zm9.6-.9a4.6 4.6 0 0 1 0 6.8l-1-1a3.2 3.2 0 0 0 0-4.8zm2.1-2.1a7.6 7.6 0 0 1 0 11l-1-1a6.2 6.2 0 0 0 0-9z"/>',
  mute: '<path d="M1 5.5h3L8 2v12l-4-3.5H1zm9.3-.3L12 6.9l1.7-1.7 1 1L13 7.9l1.7 1.7-1 1L12 8.9l-1.7 1.7-1-1L11 7.9 9.3 6.2z"/>',
  // Speech bubble with an exclamation mark: send a report or a suggestion.
  feedback: '<path d="M2.5 1h11A2.5 2.5 0 0 1 16 3.5v6.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5v-3.5H2.5A2.5 2.5 0 0 1 0 10V3.5A2.5 2.5 0 0 1 2.5 1zm4.6 2.2l.3 4.6h1.2l.3-4.6zM8 8.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill-rule="evenodd"/>',
  image: '<path d="M1.5 2h13A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 12.5v-9A1.5 1.5 0 0 1 1.5 2zm.1 1.6v7.6l3.6-3.8 2.6 2.6 2.1-2.2 4.5 4.4V3.6zM11 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" fill-rule="evenodd"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function iconSvg(name: IconName, cls = ''): string {
  return `<svg class="icon ${cls}" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${PATHS[name]}</svg>`;
}

export function icon(name: IconName, cls = ''): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = iconSvg(name, cls);
  return t.content.firstElementChild as SVGElement;
}

export const SCHOOL_ICON: Record<School, IconName> = { construccion: 'piedra', asalto: 'acero', arcano: 'mana' };
export const RESOURCE_ICON: Record<Resource, IconName> = { piedra: 'piedra', acero: 'acero', mana: 'mana' };

/** Colours per resource, used by the HUD and the VFX. */
export const RESOURCE_COLOR: Record<Resource, string> = { piedra: '#e0b25a', acero: '#c9d2dc', mana: '#6fd3f0' };

/**
 * Multi-tone emblems from the approved card frame: a stone block, a sword, a
 * faceted crystal and a crown. Used on the cost shield and in the HUD.
 */
const EMBLEMS = {
  piedra:
    '<path d="M12 2.5l9.5 4.8L12 12 2.5 7.3z" fill="#ffe9a8"/><path d="M2.5 7.3L12 12v9.5l-9.5-4.8z" fill="#d9a03c"/><path d="M21.5 7.3L12 12v9.5l9.5-4.8z" fill="#8f5c18"/><path d="M2.5 12l9.5 4.7M7.2 9.6v4.7M7.2 16.8v2.3M21.5 12L12 16.7M16.8 9.6v4.7" fill="none" stroke-width=".6" opacity=".7"/><path d="M6 6.9l6-3 3 1.5" fill="none" stroke="#fff" stroke-width=".8" opacity=".8"/>',
  acero:
    '<g transform="rotate(45 12 12)"><path d="M12 0l2.3 3.5V15H9.7V3.5z" fill="#f3f7fb"/><path d="M12 0l2.3 3.5V15H12z" fill="#93a3b5"/><path d="M12 3v11" stroke="#5d6b7b" stroke-width=".5"/><path d="M6 15h12a1 1 0 010 2.2H6a1 1 0 010-2.2z" fill="#f0c04e"/><path d="M10.9 17.2h2.2v4h-2.2z" fill="#7a4a1e"/><circle cx="12" cy="22.3" r="1.6" fill="#f0c04e"/></g>',
  mana:
    '<path d="M12 1L5.5 8.5 12 11z" fill="#d6f8ff"/><path d="M12 1l6.5 7.5L12 11z" fill="#7fdcf5"/><path d="M5.5 8.5L12 11v12z" fill="#43b3e2"/><path d="M18.5 8.5L12 11v12z" fill="#2474b0"/><path d="M8 7.5l3-3.5" fill="none" stroke="#fff" stroke-width=".9"/><path d="M19.5 2.5v3M18 4h3M4 15.5v2.4M2.8 16.7h2.4" fill="none" stroke="#bff3ff" stroke-width=".8"/>',
  hero:
    '<path d="M3.5 17L2 6.5l5.5 4L12 3l4.5 7.5 5.5-4L20.5 17z" fill="#ffd34d"/><path d="M12 3l4.5 7.5 5.5-4L20.5 17H12z" fill="#f09a1c"/><path d="M3.5 17h17v3.5h-17z" fill="#ffe58a"/><circle cx="12" cy="18.7" r="1.1" fill="#e0382e"/><circle cx="7.5" cy="18.7" r=".8" fill="#4fc3f7"/><circle cx="16.5" cy="18.7" r=".8" fill="#4fc3f7"/><circle cx="12" cy="3" r="1.2" fill="#fff3b0"/><circle cx="2" cy="6.5" r="1" fill="#fff3b0"/><circle cx="22" cy="6.5" r="1" fill="#fff3b0"/>',
} as const;

export type EmblemName = keyof typeof EMBLEMS;

export function emblemSvg(name: EmblemName, cls = ''): string {
  return `<svg class="emblem-icon ${cls}" viewBox="0 0 24 24" stroke="#1a1208" stroke-width=".7" stroke-linejoin="round" aria-hidden="true">${EMBLEMS[name]}</svg>`;
}

export const SCHOOL_EMBLEM: Record<School, EmblemName> = { construccion: 'piedra', asalto: 'acero', arcano: 'mana' };
