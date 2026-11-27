/**
 * The page at `/reportes` where the developer reads the players' reports.
 * Self-contained (the Worker serves it as is). Everything a player wrote is
 * put on the page as text, never as markup.
 */
export const REPORTS_PAGE = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Reportes · Cardcraft: Castles</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d1020; --panel: #1b1726; --panel-2: #241e33; --line: rgb(227 182 86 / 30%);
    --ink: #ece6d6; --muted: #a79fb5; --gold: #e3b656; --danger: #e36b5a; --ok: #8ef59a; --idea: #8fc7ff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; padding: 12px 16px; background: rgb(13 16 32 / 94%); border-bottom: 1px solid var(--line); backdrop-filter: blur(6px); }
  h1 { margin: 0; font-size: 1.15rem; color: var(--gold); letter-spacing: .02em; }
  .counts { color: var(--muted); font-size: .9rem; }
  .spacer { flex: 1; }
  main { max-width: 980px; margin: 0 auto; padding: 16px; display: grid; gap: 14px; }
  button, input { font: inherit; }
  button { cursor: pointer; border-radius: 8px; border: 1px solid var(--line); background: var(--panel-2); color: var(--ink); padding: 6px 12px; }
  button:hover { border-color: var(--gold); }
  button.primary { background: linear-gradient(180deg, #f3c766, #a86c1c); color: #2a1606; border-color: transparent; font-weight: 600; }
  button.danger { color: var(--danger); }
  button[aria-pressed="true"] { border-color: var(--gold); color: var(--gold); }
  .login { max-width: 380px; margin: 12vh auto 0; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px; display: grid; gap: 12px; }
  .login h1 { font-size: 1.3rem; }
  .login p { margin: 0; color: var(--muted); font-size: .92rem; }
  input[type=password] { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: #120f1a; color: var(--ink); }
  .error { color: var(--danger); min-height: 1.2em; margin: 0; }
  .report { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: grid; gap: 10px; }
  .report.done { opacity: .55; }
  .report-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
  .badge { font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
  .badge.bug { color: var(--danger); } .badge.idea { color: var(--idea); } .badge.other { color: var(--muted); }
  .when { color: var(--muted); font-size: .88rem; }
  .actions { margin-left: auto; display: flex; gap: 8px; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-size: 1rem; }
  .text.empty { color: var(--muted); font-style: italic; }
  .shots { display: flex; flex-wrap: wrap; gap: 8px; }
  .shots a { display: block; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #000; }
  .shots img { display: block; height: 140px; max-width: 260px; object-fit: contain; }
  details summary { cursor: pointer; color: var(--muted); font-size: .9rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin: 8px 0 0; font-size: .88rem; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .more { justify-self: center; }
  .empty-list { text-align: center; color: var(--muted); padding: 40px 0; }
  .viewer { position: fixed; inset: 0; z-index: 5; background: rgb(5 4 10 / 88%); display: grid; place-items: center; padding: 16px; }
  .viewer img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }
  .viewer .close { position: fixed; top: 12px; right: 12px; width: 38px; height: 38px; border-radius: 50%; padding: 0; border: 2px solid #ffd2c8; background: radial-gradient(circle at 35% 30%, #ff6b57, #c4211a 60%, #8e110c); color: #fff; font-size: 20px; line-height: 1; }
  @media (max-width: 560px) { .actions { margin-left: 0; width: 100%; } }
</style>
</head>
<body>
<div id="app"></div>
<script>
(() => {
  const STORE = 'cardcraft-reports-key';
  const KIND = { bug: 'Error', idea: 'Sugerencia', other: 'Comentario' };
  const CONTEXT_LABELS = {
    version: 'Versión', screen: 'Pantalla', mode: 'Modo', difficulty: 'Dificultad', hero: 'Héroe', rivals: 'Rivales', turn: 'Turno', gameOver: 'Partida terminada',
    room: 'Sala', nickname: 'Apodo', locale: 'Idioma', browser: 'Navegador', os: 'Sistema', viewport: 'Ventana', screenSize: 'Pantalla física',
    pixelRatio: 'Densidad', touch: 'Táctil', standalone: 'Instalada', url: 'Dirección', userAgent: 'User agent', recentErrors: 'Errores recientes', events: 'Últimos eventos',
  };
  const app = document.getElementById('app');
  let key = '';
  try { key = localStorage.getItem(STORE) || ''; } catch {}
  let pendingOnly = true;
  let reports = [];
  let nextBefore = null;
  let counts = { total: 0, pending: 0 };
  const objectUrls = [];

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, { ...options, headers: { ...(options.headers || {}), authorization: 'Bearer ' + key } });
    if (!res.ok) {
      let message = res.status + '';
      try { message = (await res.json()).error.message; } catch {}
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return res;
  }

  function login(message) {
    key = '';
    try { localStorage.removeItem(STORE); } catch {}
    const input = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Clave', 'aria-label': 'Clave' });
    const error = el('p', { class: 'error', role: 'alert' }, message || '');
    const submit = async (e) => {
      e.preventDefault();
      key = input.value.trim();
      if (!key) return;
      error.textContent = '';
      try {
        await load(true);
        try { localStorage.setItem(STORE, key); } catch {}
      } catch (err) {
        error.textContent = err.status === 401 ? 'Clave incorrecta.' : err.status === 503 ? 'Falta configurar REPORTS_KEY en Cloudflare.' : 'No se pudo entrar: ' + err.message;
      }
    };
    app.replaceChildren(
      el('form', { class: 'login', onsubmit: submit },
        el('h1', null, 'Reportes de jugadores'),
        el('p', null, 'Errores, sugerencias y comentarios enviados desde Cardcraft: Castles.'),
        input,
        el('button', { class: 'primary', type: 'submit' }, 'Entrar'),
        error,
      ),
    );
    input.focus();
  }

  async function load(reset) {
    if (reset) { reports = []; nextBefore = null; for (const u of objectUrls.splice(0)) URL.revokeObjectURL(u); }
    const params = new URLSearchParams();
    if (pendingOnly) params.set('pending', '1');
    if (nextBefore) params.set('before', String(nextBefore));
    const data = await (await api('/api/reports?' + params)).json();
    reports = reports.concat(data.reports);
    counts = { total: data.total, pending: data.pending };
    nextBefore = data.reports.length === data.pageSize ? data.reports[data.reports.length - 1].id : null;
    render();
  }

  function describeValue(value) {
    if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\\n');
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    if (value === true) return 'sí';
    if (value === false) return 'no';
    return String(value);
  }

  function contextList(context) {
    const keys = Object.keys(context).filter((k) => context[k] !== null && context[k] !== '' && context[k] !== undefined);
    if (!keys.length) return null;
    const ordered = Object.keys(CONTEXT_LABELS).filter((k) => keys.includes(k)).concat(keys.filter((k) => !(k in CONTEXT_LABELS)));
    return el('dl', null, ordered.map((k) => [el('dt', null, CONTEXT_LABELS[k] || k), el('dd', { style: k === 'recentErrors' || k === 'events' ? 'white-space:pre-wrap' : null }, describeValue(context[k]))]));
  }

  function summary(context) {
    return [context.version, context.mode, context.hero, context.browser, context.os].filter(Boolean).join(' · ');
  }

  function openViewer(url) {
    const close = () => { viewer.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const viewer = el('div', { class: 'viewer', onclick: (e) => { if (e.target === viewer) close(); } }, el('img', { src: url, alt: 'Captura' }), el('button', { class: 'close', type: 'button', 'aria-label': 'Cerrar', onclick: close }, '×'));
    document.addEventListener('keydown', onKey);
    document.body.append(viewer);
  }

  function shot(report, n) {
    const link = el('a', { href: '#', title: 'Ver captura' });
    link.addEventListener('click', (e) => { e.preventDefault(); if (link.dataset.url) openViewer(link.dataset.url); });
    api('/api/reports/' + report.id + '/images/' + n)
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        link.dataset.url = url;
        link.append(el('img', { src: url, alt: 'Captura ' + (n + 1), loading: 'lazy' }));
      })
      .catch(() => link.append('Captura ' + (n + 1) + ' no disponible'));
    return link;
  }

  function card(report) {
    const when = new Date(report.created);
    const toggle = el('button', { type: 'button', onclick: async () => {
      try {
        await api('/api/reports/' + report.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: !report.done }) });
        report.done = !report.done;
        counts.pending += report.done ? -1 : 1;
        if (pendingOnly && report.done) reports = reports.filter((r) => r !== report);
        render();
      } catch (err) { handle(err); }
    } }, report.done ? 'Marcar pendiente' : 'Resuelto');
    let armed = false;
    const remove = el('button', { type: 'button', class: 'danger', onclick: async () => {
      if (!armed) { armed = true; remove.textContent = '¿Borrar? Pulsa otra vez'; return; }
      try {
        await api('/api/reports/' + report.id, { method: 'DELETE' });
        reports = reports.filter((r) => r !== report);
        counts.total -= 1;
        if (!report.done) counts.pending -= 1;
        render();
      } catch (err) { handle(err); }
    } }, 'Borrar');
    const meta = summary(report.context);
    const list = contextList(report.context);
    return el('article', { class: 'report' + (report.done ? ' done' : '') },
      el('div', { class: 'report-head' },
        el('span', { class: 'badge ' + report.kind }, KIND[report.kind] || report.kind),
        el('span', { class: 'when' }, '#' + report.id + ' · ' + when.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) + (report.country ? ' · ' + report.country : '')),
        el('div', { class: 'actions' }, toggle, remove),
      ),
      report.text ? el('p', { class: 'text' }, report.text) : el('p', { class: 'text empty' }, 'Sin texto, solo capturas.'),
      report.images.length ? el('div', { class: 'shots' }, report.images.map((_, n) => shot(report, n))) : null,
      list ? el('details', null, el('summary', null, meta || 'Contexto'), list) : null,
    );
  }

  function render() {
    const filter = (value, label) => el('button', { type: 'button', 'aria-pressed': String(pendingOnly === value), onclick: () => { pendingOnly = value; load(true).catch(handle); } }, label);
    const header = el('header', null,
      el('h1', null, 'Reportes'),
      el('span', { class: 'counts' }, counts.pending + ' pendientes de ' + counts.total),
      el('span', { class: 'spacer' }),
      filter(true, 'Pendientes'),
      filter(false, 'Todos'),
      el('button', { type: 'button', onclick: () => load(true).catch(handle) }, 'Actualizar'),
      el('button', { type: 'button', onclick: () => login() }, 'Salir'),
    );
    const body = reports.length
      ? reports.map(card)
      : [el('p', { class: 'empty-list' }, pendingOnly ? 'No hay reportes pendientes.' : 'Todavía no hay reportes.')];
    const more = nextBefore ? el('button', { type: 'button', class: 'more', onclick: () => load(false).catch(handle) }, 'Cargar más') : null;
    app.replaceChildren(header, el('main', null, body, more));
  }

  function handle(err) {
    if (err && (err.status === 401 || err.status === 503)) login(err.status === 401 ? 'La clave ya no es válida.' : 'Falta configurar REPORTS_KEY en Cloudflare.');
    else alert('Algo falló: ' + (err && err.message));
  }

  if (key) load(true).catch(handle); else login();
})();
</script>
</body>
</html>
`;
