import Phaser from 'phaser';
import type { Theme } from './backdrops';

/**
 * Живое поле боя (визуальная полировка): мягкие тени под юнитами и лёгкие частицы по теме —
 * светлячки на лугу, клочья тумана и болотные огоньки в топи, пыль и дрожь факелов в склепе, песчинки по ветру
 * в пустыне, светлячки в ночном лесу Пайона, пузырьки на затонувшем корабле, низкий туман и голубые огоньки в Нифльхейме.
 *
 * Дёшево: фиксированный набор картинок с общими маленькими текстурами (один батч), двигаются в step() сцены
 * без твинов и без создания объектов во время боя. Всё — под юнитами (глубина чуть выше фона).
 */

export const SHADOW_TEX = 'skin_shadow';
const MOTE = 'skin_mote';
const FOG = 'skin_fog';
const BUBBLE = 'skin_bubble';

/** Маленькие текстуры частиц и тени (один раз). */
export function ensureAmbientTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  const canvas = (key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
    if (tm.exists(key)) return;
    const t = tm.createCanvas(key, w, h);
    if (!t) return;
    draw(t.getContext());
    t.refresh();
  };
  // Тень: эллипс, плотный в центре и растворяющийся к краю.
  canvas(SHADOW_TEX, 64, 32, (c) => {
    c.save();
    c.scale(1, 0.5);
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.38)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    c.restore();
  });
  // Искорка: белая точка с ореолом (красится tint).
  canvas(MOTE, 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  // Пузырёк: светлое кольцо с бликом (красится tint).
  canvas(BUBBLE, 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 8, 16, 16, 14);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(16, 16, 14, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath();
    c.arc(11, 11, 3, 0, Math.PI * 2);
    c.fill();
  });
  // Клочок тумана: мягкий эллипс (растягивается setDisplaySize).
  canvas(FOG, 128, 64, (c) => {
    c.save();
    c.scale(1, 0.5);
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    c.restore();
  });
}

interface Particle {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Фаза и частота покачивания/мерцания. */
  ph: number;
  f: number;
  /** Амплитуда покачивания, базовая и пиковая прозрачность. */
  amp: number;
  a0: number;
  a1: number;
  kind: 'firefly' | 'fog' | 'dust' | 'flicker';
}

/** Где летают частицы: поле боя (по x — с запасом за края, по y — от горизонта до низа). */
const X0 = -80;
const X1 = 1160;
const Y0 = 620;
const Y1 = 1900;

/** Тёплое мерцание факелов на стене склепа: их места в координатах поля (фон 720×1280 ×1.5). */
const CRYPT_TORCHES: [number, number][] = [
  [0.34 * 1080, (1280 * 0.36 - 110 - 16) * 1.5],
  [0.66 * 1080, (1280 * 0.36 - 110 - 16) * 1.5],
];

export class Ambient {
  private readonly items: Particle[] = [];
  private t = 0;

  constructor(scene: Phaser.Scene, theme: Theme, depth = 1) {
    ensureAmbientTextures(scene);
    const rnd = Phaser.Math.FloatBetween;
    const add = (kind: Particle['kind'], tex: string, p: Partial<Particle>, tint: number, blend: Phaser.BlendModes, w: number, h = w) => {
      const img = scene.add.image(0, 0, tex).setTint(tint).setBlendMode(blend).setDepth(depth).setDisplaySize(w, h);
      const it: Particle = { img, x: rnd(X0, X1), y: rnd(Y0, Y1), vx: 0, vy: 0, ph: rnd(0, Math.PI * 2), f: rnd(0.5, 1.2), amp: 0, a0: 0, a1: 1, kind, ...p };
      this.items.push(it);
      this.place(it);
    };
    const ADD = Phaser.BlendModes.ADD;
    const NORMAL = Phaser.BlendModes.NORMAL;
    if (theme === 'meadow') {
      // Светлячки: медленно блуждают, вспыхивают и гаснут.
      for (let i = 0; i < 12; i++) add('firefly', MOTE, { vx: rnd(-10, 10), vy: rnd(-8, 4), amp: rnd(10, 26), a0: 0, a1: rnd(0.55, 0.9) }, 0xe4ff9a, ADD, rnd(18, 30));
    } else if (theme === 'swamp') {
      // Клочья тумана низко над трясиной и редкие болотные огоньки.
      for (let i = 0; i < 5; i++) {
        add('fog', FOG, { y: rnd(900, Y1), vx: rnd(6, 14) * (i % 2 ? 1 : -1), amp: 6, a0: 0.08, a1: 0.16, f: rnd(0.15, 0.3) }, 0xd2dccb, NORMAL, rnd(520, 760), rnd(150, 220));
      }
      for (let i = 0; i < 7; i++) add('firefly', MOTE, { vx: rnd(-6, 6), vy: rnd(-6, 2), amp: rnd(8, 18), a0: 0, a1: rnd(0.45, 0.75), f: rnd(0.3, 0.7) }, 0xb6f07a, ADD, rnd(16, 26));
    } else if (theme === 'desert') {
      // Песчинки и пыль, которые ветер несёт вдоль поля (слева направо), плюс редкие пылевые клубы.
      for (let i = 0; i < 16; i++) add('dust', MOTE, { vx: rnd(40, 90), vy: rnd(-4, 4), amp: rnd(3, 8), a0: 0.1, a1: rnd(0.35, 0.6), f: rnd(0.6, 1.4) }, 0xffe2a8, ADD, rnd(6, 11));
      for (let i = 0; i < 3; i++) {
        add('fog', FOG, { y: rnd(1000, Y1), vx: rnd(20, 35), amp: 4, a0: 0.05, a1: 0.11, f: rnd(0.2, 0.35) }, 0xe8c890, NORMAL, rnd(460, 640), rnd(110, 160));
      }
    } else if (theme === 'grove') {
      // Светлячки ночного леса: холоднее и спокойнее луговых.
      for (let i = 0; i < 14; i++) add('firefly', MOTE, { vx: rnd(-8, 8), vy: rnd(-6, 3), amp: rnd(10, 24), a0: 0, a1: rnd(0.55, 0.9), f: rnd(0.4, 0.9) }, 0xd8ff8a, ADD, rnd(16, 28));
    } else if (theme === 'shipwreck') {
      // Пузырьки поднимаются к поверхности, покачиваясь; мелкая взвесь медленно дрейфует.
      for (let i = 0; i < 12; i++) add('dust', BUBBLE, { vx: rnd(-3, 3), vy: rnd(-70, -35), amp: rnd(6, 14), a0: 0.35, a1: rnd(0.6, 0.85), f: rnd(1.2, 2.2) }, 0xd8f8ff, NORMAL, rnd(10, 22));
      for (let i = 0; i < 8; i++) add('dust', MOTE, { vx: rnd(-6, 6), vy: rnd(-4, 4), amp: rnd(4, 10), a0: 0.05, a1: rnd(0.2, 0.35), f: rnd(0.3, 0.6) }, 0x9fe8e0, ADD, rnd(6, 10));
    } else if (theme === 'niflheim') {
      // Низкий стелющийся туман и холодные призрачные огоньки.
      for (let i = 0; i < 5; i++) {
        add('fog', FOG, { y: rnd(950, Y1), vx: rnd(5, 12) * (i % 2 ? 1 : -1), amp: 6, a0: 0.08, a1: 0.17, f: rnd(0.15, 0.3) }, 0xc8d2ea, NORMAL, rnd(540, 780), rnd(150, 220));
      }
      for (let i = 0; i < 8; i++) add('firefly', MOTE, { vx: rnd(-5, 5), vy: rnd(-8, 1), amp: rnd(10, 22), a0: 0.05, a1: rnd(0.5, 0.8), f: rnd(0.25, 0.55) }, 0x9ad8ff, ADD, rnd(18, 30));
    } else {
      // Пыль в тёплом свете и дрожь пламени факелов.
      for (let i = 0; i < 18; i++) add('dust', MOTE, { vx: rnd(-5, 5), vy: rnd(-7, 3), amp: rnd(4, 12), a0: 0.1, a1: rnd(0.3, 0.55), f: rnd(0.3, 0.8) }, 0xffe0b0, ADD, rnd(8, 14));
      for (const [x, y] of CRYPT_TORCHES) add('flicker', MOTE, { x, y, a0: 0.28, a1: 0.5, f: rnd(5, 7) }, 0xffa050, ADD, 300);
    }
  }

  /** dt — мс настоящего времени (частицы не ускоряются вместе с боем). */
  step(dt: number): void {
    const s = dt / 1000;
    this.t += s;
    for (const it of this.items) {
      if (it.kind === 'flicker') {
        // Два несоизмеримых синуса — «живое» пламя без случайных чисел в кадре.
        const k = 0.5 + 0.3 * Math.sin(this.t * it.f + it.ph) + 0.2 * Math.sin(this.t * it.f * 2.7 + it.ph * 2);
        it.img.setAlpha(it.a0 + (it.a1 - it.a0) * k);
        continue;
      }
      it.x += it.vx * s;
      it.y += it.vy * s;
      if (it.x < X0 - 300) it.x = X1 + 200;
      if (it.x > X1 + 300) it.x = X0 - 200;
      if (it.y < Y0) it.y = Y1;
      if (it.y > Y1) it.y = Y0;
      this.place(it);
    }
  }

  private place(it: Particle): void {
    const w = Math.sin(this.t * it.f + it.ph);
    it.img.setPosition(it.x + w * it.amp, it.y + Math.cos(this.t * it.f * 0.7 + it.ph) * it.amp * 0.6);
    if (it.kind === 'firefly') {
      // Вспыхивает на пике синуса, большую часть времени почти не виден.
      const k = Math.max(0, Math.sin(this.t * it.f * 1.3 + it.ph * 3));
      it.img.setAlpha(it.a0 + (it.a1 - it.a0) * k * k);
    } else if (it.kind !== 'flicker') {
      it.img.setAlpha(it.a0 + (it.a1 - it.a0) * (0.5 + 0.5 * w));
    }
  }
}
