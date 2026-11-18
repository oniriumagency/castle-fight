/** Tiny DOM helpers: the interface is plain DOM, no framework. */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener> & {
  class?: string;
  style?: string;
};

/**
 * `h('button.primary', { onclick }, 'Play')` builds an element. The tag can
 * carry classes after dots. Attributes starting with `on` become listeners;
 * `false`/`null` attributes are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}`,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name as K);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key === 'class') {
        el.className = [el.className, String(value)].filter(Boolean).join(' ');
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** An element from trusted markup we wrote ourselves (icons, rule texts). */
export function html(markup: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves after the next two frames, so a freshly inserted element can transition. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Short message at the bottom of the screen. */
export function toast(message: string, kind: 'info' | 'warn' = 'info', ms = 2600): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const el = h('div.toast', { class: kind }, message);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

export function isTouch(): boolean {
  return matchMedia('(hover: none)').matches;
}
