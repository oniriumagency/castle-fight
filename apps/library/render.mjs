/**
 * Renders the library's pages from `games.json`. Kept apart from build.mjs
 * (which touches the disk) so the tests can check the HTML directly.
 */

const LOCALES = ['es', 'en'];

const TEXT = {
  title: { es: 'Onirium Games', en: 'Onirium Games' },
  eyebrow: { es: 'Biblioteca de juegos', en: 'Game library' },
  heading: { es: ['Sueños que', 'se juegan.'], en: ['Dreams you', 'can play.'] },
  intro: {
    es: 'Los juegos que creamos en Onirium, listos para jugar en el navegador. Sin descargas ni registro: elige uno y entra.',
    en: 'The games we make at Onirium, ready to play in your browser. No downloads, no sign-up: pick one and jump in.',
  },
  description: {
    es: 'Biblioteca de juegos de Onirium: juegos gratuitos para el navegador, en ordenador y móvil.',
    en: 'Onirium game library: free games for the browser, on desktop and mobile.',
  },
  soon: { es: 'Más juegos en camino', en: 'More games on the way' },
  soonNote: { es: 'La biblioteca crece con cada estreno.', en: 'The library grows with every release.' },
  notFoundEyebrow: { es: 'Error 404', en: 'Error 404' },
  notFound: { es: ['Este sueño', 'no existe.'], en: ['This dream', "doesn't exist."] },
  notFoundNote: {
    es: 'La página que buscas no está aquí o se ha mudado.',
    en: 'The page you are looking for is not here or has moved.',
  },
  back: { es: 'Volver a la biblioteca', en: 'Back to the library' },
  external: { es: '(se abre en otra web)', en: '(opens on another site)' },
  tagline: { es: 'Del sueño a la pantalla.', en: 'From dream to screen.' },
  agency: { es: 'Conoce Onirium', en: 'Meet Onirium' },
  made: { es: 'Hecho con sueños y código.', en: 'Made with dreams and code.' },
  theme: { es: 'Cambiar modo claro u oscuro', en: 'Switch light or dark mode' },
};

/** Onirium's imagotype, as on onirium.agency: its colours follow the theme. */
function logo(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1172 495" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}g" x1="361" x2="1160" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0.04" stop-color="var(--logo-violet)"/><stop offset="0.82" stop-color="var(--logo-ink)"/></linearGradient><mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="1172" height="495"><rect width="1172" height="495" fill="#fff"/><g fill="none" stroke="#000" stroke-width="13.5" stroke-linejoin="miter" stroke-miterlimit="10"><polyline points="1094,133 1094,428.5 76.5,428.5 76.5,139 295,139 295,357.5 149,357.5 149,211.5 222,211.5 222,291"/><line x1="367.5" y1="59" x2="367.5" y2="428.5"/><line x1="514.5" y1="59" x2="514.5" y2="428.5"/><line x1="587.5" y1="59" x2="587.5" y2="428.5"/><line x1="733" y1="59" x2="733" y2="428.5"/><line x1="806" y1="59" x2="806" y2="428.5"/><line x1="950" y1="59" x2="950" y2="428.5"/><line x1="877" y1="59" x2="877" y2="350"/><line x1="441.5" y1="133" x2="441.5" y2="428.5"/><line x1="1023" y1="133" x2="1023" y2="428.5"/><line x1="660" y1="133" x2="660" y2="179.5"/><line x1="660" y1="315" x2="660" y2="428.5"/><line x1="685" y1="240.5" x2="733" y2="240.5"/></g></mask></defs><polygon points="0,0 1172,0 1161,59 10,59" fill="var(--logo-ink)"/><g mask="url(#${id}m)"><rect x="11" y="74" width="352" height="421" fill="var(--logo-violet)"/><rect x="361" y="74" width="799" height="363" fill="var(--logo-ink)"/><rect x="361" y="435.5" width="799" height="59.5" fill="url(#${id}g)"/></g></svg>`;
}

const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ARROW_UP_RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';

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
      if (game.kind && typeof game.kind[locale] !== 'string') problems.push(`${where}: "kind.${locale}" is required`);
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
      <article class="game" id="${escape(game.id)}">
        <div class="cover">
          <img src="/${coverFile(game)}" alt="" width="800" height="500" loading="lazy" decoding="async" />
          <span class="go">${ARROW_UP_RIGHT}</span>
          ${game.badge ? `<span class="badge">${both(game.badge)}</span>` : ''}
        </div>
        <div class="body">
          ${game.kind ? `<span class="kind">${both(game.kind)}</span>` : ''}
          <h2>${escape(game.title)}</h2>
          <p class="tagline">${both(game.tagline)}</p>
          <p class="description">${both(game.description)}</p>
          ${tags}
          <a class="btn ${game.badge ? 'btn-ghost' : 'btn-primary'}" href="${escape(game.url)}"${external ? ' rel="noopener"' : ''}>${both(game.play)}<span class="sr-only">: ${escape(game.title)}${game.badge ? ` (${both(game.badge)})` : ''}${external ? ` ${both(TEXT.external)}` : ''}</span>${ARROW}</a>
        </div>
      </article>`;
}

/**
 * Theme and language before the page paints, as on onirium.agency:
 * theme = saved choice, else the system's; language = `?lang=`, saved choice,
 * the language picked in Cardcraft: Castles, else the browser's.
 */
const BOOT_SCRIPT = `<script>
      (function () {
        var d = document.documentElement, theme = null, lang = null, game = null;
        try {
          theme = localStorage.getItem('onirium-theme');
          lang = localStorage.getItem('onirium-lang');
          game = JSON.parse(localStorage.getItem('cardcraft-castles:settings') || 'null');
        } catch (e) {}
        d.setAttribute('data-theme', theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
        var q = new URLSearchParams(location.search).get('lang');
        var nav = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'es'];
        var auto = nav.some(function (x) { return /^es\\b/i.test(x); }) ? 'es' : 'en';
        if (game && game.localeChosen && (game.locale === 'es' || game.locale === 'en')) auto = game.locale;
        var l = q === 'es' || q === 'en' ? q : lang === 'es' || lang === 'en' ? lang : auto;
        d.setAttribute('data-lang', l);
        d.lang = l;
      })();
    </script>`;

const TOOLS_SCRIPT = `<script>
      (function () {
        var d = document.documentElement;
        function save(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
        document.querySelector('[data-lang-toggle]').addEventListener('click', function () {
          var l = d.getAttribute('data-lang') === 'en' ? 'es' : 'en';
          d.setAttribute('data-lang', l);
          d.lang = l;
          save('onirium-lang', l);
        });
        document.querySelector('[data-theme-toggle]').addEventListener('click', function () {
          var t = d.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
          d.setAttribute('data-theme', t);
          save('onirium-theme', t);
        });
        var y = document.querySelector('[data-year]');
        if (y) y.textContent = new Date().getFullYear();
      })();
    </script>`;

function page({ title, body }) {
  return `<!doctype html>
<html lang="es" data-lang="es" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(TEXT.description.es)}" />
    <meta name="theme-color" content="#0A0910" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#F7F6FB" media="(prefers-color-scheme: light)" />
    <meta property="og:site_name" content="Onirium" />
    <meta property="og:title" content="${escape(title)}" />
    <meta property="og:description" content="${escape(TEXT.description.es)}" />
    <meta property="og:type" content="website" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preload" href="/fonts/big-shoulders-display-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/styles.css" />
    ${BOOT_SCRIPT}
  </head>
  <body>
    <div class="glow" aria-hidden="true"></div>
    <header class="site-header">
      <div class="wrap header-inner">
        <a class="brand" href="/" aria-label="Onirium Games">${logo('hdr')}</a>
        <div class="header-tools">
          <button class="tool lang-toggle" type="button" data-lang-toggle aria-label="Cambiar idioma / Change language"><span data-l="es">ES</span><span class="sep">/</span><span data-l="en">EN</span></button>
          <button class="tool theme-toggle" type="button" data-theme-toggle aria-label="${escape(TEXT.theme.es)} / ${escape(TEXT.theme.en)}">
            <svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>
            <svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>
          </button>
        </div>
      </div>
    </header>
${body}
    <footer class="site-footer">
      <div class="meander-band" aria-hidden="true"></div>
      <div class="wrap footer-inner">
        <div class="footer-brand">
          <a class="brand" href="https://onirium.agency" aria-label="Onirium">${logo('ftr')}</a>
          <p>${both(TEXT.tagline)}</p>
        </div>
        <nav class="footer-nav" aria-label="Onirium">
          <a href="https://onirium.agency">${both(TEXT.agency)}</a>
        </nav>
      </div>
      <div class="wrap footer-bottom">
        <small>© <span data-year>2026</span> Onirium · onirium.agency</small>
        <small>${both(TEXT.made)}</small>
      </div>
    </footer>
    ${TOOLS_SCRIPT}
  </body>
</html>
`;
}

/** A two-line display heading; the second line in the brand's violet. */
function heading(lines) {
  return LOCALES.map((l) => `<span lang="${l}">${escape(lines[l][0])} <em>${escape(lines[l][1])}</em></span>`).join('');
}

export function renderIndex(data) {
  const games = data.games.map(card).join('');
  const soon = data.moreComing
    ? `
      <aside class="soon">
        <span class="mark" aria-hidden="true"></span>
        <p>${both(TEXT.soon)}</p>
        <small>${both(TEXT.soonNote)}</small>
      </aside>`
    : '';
  return page({
    title: `${TEXT.title.es} · Biblioteca de juegos`,
    body: `    <main>
      <section class="wrap hero">
        <p class="eyebrow">${both(TEXT.eyebrow)}</p>
        <h1>${heading(TEXT.heading)}</h1>
        <p class="lead">${both(TEXT.intro)}</p>
      </section>
      <section class="wrap shelf" aria-label="Juegos / Games">${games}${soon}
      </section>
    </main>`,
  });
}

export function renderNotFound() {
  return page({
    title: `404 · ${TEXT.title.es}`,
    body: `    <main class="wrap hero lost">
      <p class="eyebrow">${both(TEXT.notFoundEyebrow)}</p>
      <h1>${heading(TEXT.notFound)}</h1>
      <p class="lead">${both(TEXT.notFoundNote)}</p>
      <a class="btn btn-primary" href="/">${both(TEXT.back)}${ARROW}</a>
    </main>`,
  });
}
