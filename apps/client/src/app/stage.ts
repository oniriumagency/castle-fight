import { Application } from 'pixi.js';
import { audio } from '../fx/audio';
import { Battlefield } from '../scene/battlefield';
import { reportProblem } from './errorReport';
import { consoleBrowser, effectsLow, reportGpuTrouble } from './quality';

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
    // A console draws the canvas at 1x and without antialiasing: its browser
    // has little GPU memory and closes the tab when the scene asks too much.
    antialias: !consoleBrowser(),
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, consoleBrowser() ? 1 : effectsLow() ? 1.5 : 2),
    powerPreference: 'high-performance',
  });
  document.getElementById('stage')!.appendChild(app.canvas);
  // If the graphics card drops the canvas (low GPU memory), Pixi brings it
  // back by itself; we report it and keep the effects light from then on.
  app.canvas.addEventListener('webglcontextlost', () => {
    reportGpuTrouble();
    reportProblem('webgl-context-lost', 'The WebGL context was lost', { effectsLow: effectsLow(), resolution: app.renderer.resolution });
  });
  field = new Battlefield(app);
  field.layout();
  field.onAmbient = (kind) => audio.play(kind, 0.5, { gain: 0.7, pan: Math.random() - 0.5 });
  window.addEventListener('resize', () => requestAnimationFrame(() => app.resize()));
}

export function battlefield(): Battlefield {
  return field;
}

export function pixi(): Application {
  return app;
}
