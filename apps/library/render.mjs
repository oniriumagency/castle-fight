/**
 * Renders the library's pages from `games.json`. Kept apart from build.mjs
 * (which touches the disk) so the tests can check the HTML directly.
 */

const LOCALES = ['es', 'en'];

const TEXT = {
  title: { es: 'Onirium Games', en: 'Onirium Games' },
  kicker: { es: 'Biblioteca de juegos', en: 'Game library' },
  intro: {
    es: 'Juegos de navegador hechos en Onirium. Sin descargas ni registro: elige uno y a jugar.',
    en: 'Browser games made at Onirium. No downloads, no sign-up: pick one and play.',
  },
  description: {
    es: 'Biblioteca de juegos de Onirium: juegos gratuitos para el navegador, en ordenador y móvil.',
    en: 'Onirium game library: free games for the browser, on desktop and mobile.',
  },
  language: { es: 'English', en: 'Español' },
  languageLabel: { es: 'Ver en inglés', en: 'Ver en español' },
  soon: { es: 'Más juegos en camino', en: 'More games on the way' },
  soonNote: { es: 'La biblioteca crece con cada estreno.', en: 'The library grows with every release.' },
  notFound: { es: 'Este camino no lleva a ningún sitio', en: 'This road leads nowhere' },
  notFoundNote: {
    es: 'La página que buscas no existe o se ha mudado.',
    en: 'The page you are looking for does not exist or has moved.',
  },
  back: { es: 'Volver a la biblioteca', en: 'Back to the library' },
  external: { es: '(se abre en otra web)', en: '(opens on another site)' },
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** `{ es, en }` as two spans; only the page's language shows (see styles.css). */
function both(text) {
  return LOCALES.map((locale) => `<span lang="${locale}">${escape(text[locale])}</span>`).join('');
}

/** File name of a game's cover once built: `covers/<id>.webp`. */
export const coverFile = (game) => `covers/${game.id}.webp`;

export function validate(data) {
  const problems = [];
  const ids = new Set();
  if (!Array.isArray(data.games) || data.games.length === 0) problems.push('games.json: "games" must be a non-empty list');
  for (const [index, game] of (data.games ?? []).entries()) {
    const where = `games[${index}]${game?.id ? ` (${game.id})` : ''}`;
    if (!/^[a-z0-9-]+$/.test(game?.id ?? '')) problems.push(`${where}: "id" must be lowercase letters, digits and dashes`);
    if (ids.has(game.id)) problems.push(`${where}: repeated id`);
    ids.add(game.id);
    for (const key of ['title', 'url', 'cover']) {
      if (typeof game[key] !== 'string' || !game[key]) problems.push(`${where}: "${key}" is required`);
    }
    if (game.url && !/^(\/|https:\/\/)/.test(game.url)) problems.push(`${where}: "url" must start with / or https://`);
    for (const key of ['tagline', 'description', 'play']) {
      for (const locale of LOCALES) {
        if (typeof game[key]?.[locale] !== 'string') problems.push(`${where}: "${key}.${locale}" is required`);
      }
    }
    for (const locale of LOCALES) {
      if (game.tags && !Array.isArray(game.tags[locale])) problems.push(`${where}: "tags.${locale}" must be a list`);
      if (game.badge && typeof game.badge[locale] !== 'string') problems.push(`${where}: "badge.${locale}" is required`);
    }
  }
  return problems;
}

function card(game) {
  const external = /^https:\/\//.test(game.url);
  const tags = game.tags
    ? `<ul class="tags">${LOCALES.map((locale) => game.tags[locale].map((tag) => `<li lang="${locale}">${escape(tag)}</li>`).join('')).join('')}</ul>`
    : '';
  return `
      <article class="game${game.badge ? ' beta' : ''}" id="${escape(game.id)}">
        <div class="cover">
          <img src="${coverFile(game)}" alt="" width="800" height="500" loading="lazy" decoding="async" />
        </div>
        ${game.badge ? `<span class="badge">${both(game.badge)}</span>` : ''}
        <div class="body">
          <h2>${escape(game.title)}</h2>
          <p class="tagline">${both(game.tagline)}</p>
          <p class="description">${both(game.description)}</p>
          ${tags}
          <a class="play" href="${escape(game.url)}"${external ? ' rel="noopener"' : ''}>${both(game.play)}<span class="sr-only">: ${escape(game.title)}${game.badge ? ` ${escape(game.badge.es)}` : ''}${external ? ` ${both(TEXT.external)}` : ''}</span></a>
        </div>
      </article>`;
}

/** Picks the language before the page paints: saved choice, else the game's, else Spanish. */
const LANGUAGE_SCRIPT = `<script>
      (function () {
        var lang = 'es';
        try {
          var saved = localStorage.getItem('onirium-games:lang');
          var game = JSON.parse(localStorage.getItem('cardcraft-castles:settings') || 'null');
          if (saved === 'es' || saved === 'en') lang = saved;
          else if (game && game.localeChosen && game.locale === 'en') lang = 'en';
        } catch (e) {}
        document.documentElement.setAttribute('data-lang', lang);
        document.documentElement.lang = lang;
      })();
    </script>`;

const TOGGLE_SCRIPT = `<script>
      document.querySelector('.lang').addEventListener('click', function () {
        var lang = document.documentElement.getAttribute('data-lang') === 'en' ? 'es' : 'en';
        document.documentElement.setAttribute('data-lang', lang);
        document.documentElement.lang = lang;
        try { localStorage.setItem('onirium-games:lang', lang); } catch (e) {}
      });
    </script>`;

function page({ title, body }) {
  return `<!doctype html>
<html lang="es" data-lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(TEXT.description.es)}" />
    <meta name="theme-color" content="#120e0b" />
    <meta property="og:title" content="${escape(title)}" />
    <meta property="og:description" content="${escape(TEXT.description.es)}" />
    <meta property="og:type" content="website" />
    <link rel="icon" href="/emblem.svg" type="image/svg+xml" />
    <link rel="preload" href="/fonts/cinzel-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/styles.css" />
    <style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}</style>
    ${LANGUAGE_SCRIPT}
  </head>
  <body>
    <div class="wrap top">
      <button class="lang" type="button">${LOCALES.map((l) => `<span lang="${l}" aria-label="${escape(TEXT.languageLabel[l])}">${escape(TEXT.language[l])}</span>`).join('')}</button>
    </div>
${body}
    <footer>
      <div class="wrap">Onirium · <a href="https://onirium.agency">onirium.agency</a></div>
    </footer>
    ${TOGGLE_SCRIPT}
  </body>
</html>
`;
}

export function renderIndex(data) {
  const games = data.games.map(card).join('');
  const soon = data.moreComing
    ? `
      <aside class="soon">
        <img src="/emblem.svg" alt="" width="44" height="44" />
        <p>${both(TEXT.soon)}</p>
        <small>${both(TEXT.soonNote)}</small>
      </aside>`
    : '';
  return page({
    title: TEXT.title.es,
    body: `    <header class="wrap hero">
      <img class="emblem" src="/emblem.svg" alt="" width="72" height="72" />
      <h1>${escape(TEXT.title.es)}</h1>
      <p class="kicker">${both(TEXT.kicker)}</p>
      <div class="rule"></div>
      <p class="intro">${both(TEXT.intro)}</p>
    </header>
    <main class="wrap shelf">${games}${soon}
    </main>`,
  });
}

export function renderNotFound() {
  return page({
    title: `${TEXT.notFound.es} · ${TEXT.title.es}`,
    body: `    <main class="wrap lost">
      <img class="emblem" src="/emblem.svg" alt="" width="64" height="64" style="margin: 0 auto" />
      <h1 class="hero" style="padding: 0; margin: 0; font: 700 28px/1.2 var(--display); color: var(--gold-l)">${both(TEXT.notFound)}</h1>
      <p style="margin: 0; color: var(--muted)">${both(TEXT.notFoundNote)}</p>
      <a class="play" href="/">${both(TEXT.back)}</a>
    </main>`,
  });
}
