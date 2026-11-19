/**
 * Large screens: the whole game is laid out for about 1920×1080 CSS pixels.
 * On a bigger window (a 1440p or 4K monitor at 100 % scaling) everything is
 * zoomed up as if the player had pressed Ctrl + in the browser, so panels,
 * cards and text keep the size they have on a 1080p screen.
 *
 * Browser zoom changes every measurement consistently; CSS `zoom` on the page
 * does not (element styles are in layout pixels, while rectangles, pointer
 * positions and the window size stay in screen pixels). So, while zoomed, the
 * few screen-pixel readings the game uses are converted back to layout
 * pixels here, once, and the rest of the code works as on a 1080p screen.
 *
 * Must be imported before anything that measures the page (the Pixi stage).
 */

const DESIGN_W = 1920;
const DESIGN_H = 1080;
const MAX_ZOOM = 2;

let zoom = 1;

/** Current page zoom (1 on screens up to about 1080p). */
export function uiZoom(): number {
  return zoom;
}

function getter<T>(owner: object, key: string): (this: T) => number {
  let proto: object | null = owner;
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    if (desc?.get) return desc.get as (this: T) => number;
    proto = Object.getPrototypeOf(proto);
  }
  throw new Error(`no getter for ${key}`);
}

function install(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // Only where `zoom` behaves as the standard says: rectangles come back zoomed.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:10px;height:10px;zoom:2';
  document.documentElement.append(probe);
  const supported = Math.round(probe.getBoundingClientRect().width) === 20;
  probe.remove();
  if (!supported) return;

  const innerW = getter<Window>(window, 'innerWidth');
  const innerH = getter<Window>(window, 'innerHeight');
  const dpr = getter<Window>(window, 'devicePixelRatio');
  const rawW = (): number => innerW.call(window);
  const rawH = (): number => innerH.call(window);

  const compute = (): number => {
    // Phones and tablets keep their own layout.
    if (matchMedia('(pointer: coarse)').matches) return 1;
    const z = Math.min(rawW() / DESIGN_W, rawH() / DESIGN_H);
    if (z < 1.1) return 1;
    return Math.min(MAX_ZOOM, Math.round(z * 20) / 20);
  };

  const apply = (): void => {
    zoom = compute();
    document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
  };

  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => rawW() / zoom });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => rawH() / zoom });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr.call(window) * zoom });

  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const r = rect.call(this);
    return zoom === 1 ? r : new DOMRect(r.x / zoom, r.y / zoom, r.width / zoom, r.height / zoom);
  };

  for (const key of ['clientX', 'clientY', 'pageX', 'pageY', 'x', 'y'] as const) {
    const get = getter<MouseEvent>(MouseEvent.prototype, key);
    Object.defineProperty(MouseEvent.prototype, key, {
      configurable: true,
      get(this: MouseEvent) {
        return get.call(this) / zoom;
      },
    });
  }
  if (typeof Touch !== 'undefined') {
    for (const key of ['clientX', 'clientY', 'pageX', 'pageY'] as const) {
      const get = getter<Touch>(Touch.prototype, key);
      Object.defineProperty(Touch.prototype, key, {
        configurable: true,
        get(this: Touch) {
          return get.call(this) / zoom;
        },
      });
    }
  }

  apply();
  // Capture phase on window, registered first: the zoom is right before any
  // other resize handler measures the page.
  window.addEventListener('resize', apply, true);
}

install();
