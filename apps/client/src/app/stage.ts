import { Application } from 'pixi.js';
import { Battlefield } from '../scene/battlefield';

/**
 * The single PixiJS application behind every screen. The battlefield stays
 * alive between screens, so the menu shows the same world the game is
 * played in.
 */
let app: Application;
let field: Battlefield;

export async function initStage(): Promise<void> {
  app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x0d1020,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    powerPreference: 'high-performance',
  });
  document.getElementById('stage')!.appendChild(app.canvas);
  field = new Battlefield(app);
  field.layout();
  window.addEventListener('resize', () => requestAnimationFrame(() => app.resize()));
}

export function battlefield(): Battlefield {
  return field;
}

export function pixi(): Application {
  return app;
}
