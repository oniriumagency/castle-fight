import { settings } from '../app/settings';

/**
 * The victory fireworks of the battlefield, in miniature, around a portrait:
 * rockets climb past the avatar and burst into coloured sparks, over and over,
 * for as long as the canvas stays on the page. "Reduce motion" keeps it still.
 */

/** Same pairs as the fireworks over the winning castle. */
const COLORS: [string, string][] = [
  ['#ffd27a', '#ffffff'],
  ['#ff6a50', '#ffe0a0'],
  ['#7fd6f2', '#ffffff'],
  ['#b06cff', '#ffd0ff'],
];

interface Rocket {
  x: number;
  y: number;
  fromY: number;
  toY: number;
  t: number;
  ms: number;
  colors: [string, string];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  trail: boolean;
}

/** Canvas size relative to the avatar: room for the bursts around it. */
const SPAN = 2.8;

/** Wraps the portrait so the fireworks can sit around it, and starts them. */
export function withFireworks(avatar: HTMLElement): HTMLElement {
  const frame = document.createElement('span');
  frame.className = 'avatar-fireworks';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  frame.append(canvas, avatar);
  const ctx = canvas.getContext('2d');
  if (!ctx) return frame;

  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  let w = 0;
  let h = 0;
  let unit = 1;
  let last = 0;
  let nextLaunch = 250;
  let colorIndex = Math.floor(Math.random() * COLORS.length);

  const resize = (): boolean => {
    const size = avatar.getBoundingClientRect().width;
    if (!size) return false;
    const box = Math.round(size * SPAN);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (box !== w) {
      w = h = box;
      canvas.width = canvas.height = Math.round(box * dpr);
      canvas.style.width = canvas.style.height = `${box}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      unit = size / 72;
    }
    return true;
  };

  const launch = (): void => {
    const side = Math.random() < 0.5 ? -1 : 1;
    // Bursts land around the portrait (left, right or above it), never right on the face.
    const angle = -Math.PI / 2 + side * (0.35 + Math.random() * 0.95);
    const r = (w / SPAN) * (0.75 + Math.random() * 0.35);
    const x = w / 2 + Math.cos(angle) * r;
    const toY = h / 2 + Math.sin(angle) * r;
    rockets.push({ x, y: h, fromY: h, toY, t: 0, ms: 520 + Math.random() * 200, colors: COLORS[colorIndex++ % COLORS.length]! });
  };

  const burst = (x: number, y: number, colors: [string, string]): void => {
    const count = 34 + Math.floor(Math.random() * 12);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = (1.4 + Math.random() * 1.6) * unit;
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0,
        maxLife: 900 + Math.random() * 600,
        size: (1.8 + Math.random() * 1.6) * unit,
        color: i % 3 === 0 ? colors[1] : colors[0],
        trail: false,
      });
    }
    // A soft flash where it bursts.
    sparks.push({ x, y, vx: 0, vy: 0, life: 0, maxLife: 320, size: 22 * unit, color: colors[0], trail: true });
  };

  const draw = (now: number): void => {
    if (!canvas.isConnected) return;
    requestAnimationFrame(draw);
    const dt = Math.min(50, last ? now - last : 16);
    last = now;
    // Hidden (board view, "reduce motion"): nothing to draw, and nothing left over when it comes back.
    if (settings.get().reducedMotion || !frame.offsetParent || !resize()) {
      if (rockets.length || sparks.length) {
        rockets.length = sparks.length = 0;
        ctx.clearRect(0, 0, w, h);
      }
      return;
    }
    const step = dt / 16.67;
    nextLaunch -= dt;
    if (nextLaunch <= 0) {
      launch();
      // Now and then two in quick succession.
      nextLaunch = Math.random() < 0.3 ? 160 : 420 + Math.random() * 360;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]!;
      r.t += dt / r.ms;
      const k = 1 - Math.pow(1 - Math.min(1, r.t), 3);
      const y = r.fromY + (r.toY - r.fromY) * k;
      const x = r.x + Math.sin(r.t * 6) * 2 * unit;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff0c0';
      ctx.beginPath();
      ctx.arc(x, y, 1.6 * unit, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffd080';
      ctx.fillRect(x - 0.6 * unit, y, 1.2 * unit, 9 * unit);
      if (r.t >= 1) {
        rockets.splice(i, 1);
        burst(x, y, r.colors);
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) {
        sparks.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.maxLife;
      if (p.trail) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = k * 0.7;
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
        continue;
      }
      p.vx *= Math.pow(0.96, step);
      p.vy = p.vy * Math.pow(0.96, step) + 0.03 * unit * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  requestAnimationFrame(draw);
  return frame;
}
