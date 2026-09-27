import Phaser from 'phaser';

/**
 * Скин интерфейса «тёмная бронза» (как в референсе владельца: тёмные плитки с бронзовой рамкой, активное — золотом,
 * металлические кружки этапов на тропе, контурные кремовые иконки). Всё рисуется кодом в canvas при загрузке —
 * арт не нужен. Когда придёт нарисованный UI-кит (docs/UI_ART_PROMPT.txt), id из манифеста с файлами победят:
 * SKIN_FOR подменяет только те id, у которых нет своего файла.
 */

/** Палитра скина. */
export const SKIN = {
  bg: 0x0d0e0b,
  bar: 0x121310,
  panelTop: '#2b2721',
  panelBottom: '#1a1815',
  bronze: '#5c4b31',
  bronzeLight: '#7a6442',
  gold: '#d6ae63',
  goldLight: '#f0cf8a',
  goldDark: '#8f6a2c',
  cream: '#eadfc6',
  creamDim: '#a89d86',
  forestTop: '#0f1d12',
  forestBottom: '#1f3d26',
} as const;

/** Числовые цвета для tint/заливок. */
export const SKIN_TINT = {
  cream: 0xeadfc6,
  creamDim: 0xa89d86,
  gold: 0xd6ae63,
  bronze: 0x5c4b31,
} as const;

/** Какие id манифеста/атласа рисуем скином (ключ текстуры скина). */
export const SKIN_FOR: Record<string, string> = {
  ui_slot_empty: 'skin_slot_empty',
  ui_panel: 'skin_panel',
  ui_panel_light: 'skin_panel_light',
  ui_slot_filled: 'skin_slot',
  ui_slot_selected: 'skin_slot_selected',
  ui_btn_primary: 'skin_btn_gold',
  ui_btn_secondary: 'skin_btn',
  ui_btn_speed: 'skin_btn',
  ui_btn_skip: 'skin_btn',
  'k:buttonLong_beige': 'skin_btn',
  'k:buttonLong_grey': 'skin_btn',
  'k:buttonLong_blue': 'skin_btn',
  'k:buttonLong_brown': 'skin_btn_active',
  'k:buttonSquare_beige': 'skin_btn',
  'k:buttonSquare_grey': 'skin_btn',
  'k:buttonSquare_blue': 'skin_btn',
  'k:buttonSquare_brown': 'skin_btn_active',
};

/** Эти id рисуем скином, даже если у них есть файл (старый бежевый арт не подходит к скину). */
export const SKIN_FORCE = new Set(['ui_slot_empty']);

/** Отступ 9-slice у текстур скина (они рисуются в игровых единицах, без масштаба). */
export const SKIN_SLICE = 30;
/** На золотой кнопке подпись тёмная, на остальных — кремовая. */
export const SKIN_DARK_LABEL = new Set(['skin_btn_gold']);

const RADIUS = 26;

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  draw(t.getContext());
  t.refresh();
}

/** Плитка: вертикальный градиент, рамка, тонкий блик сверху. pressed — темнее и без блика. */
function tile(ctx: Ctx, s: number, o: { top: string; bottom: string; border: string; glow?: string; pressed?: boolean }): void {
  const pad = 4;
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, o.pressed ? o.bottom : o.top);
  g.addColorStop(1, o.bottom);
  rr(ctx, pad, pad, s - pad * 2, s - pad * 2, RADIUS);
  ctx.fillStyle = g;
  ctx.fill();
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = 10;
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = o.border;
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (!o.pressed) {
    rr(ctx, pad + 5, pad + 5, s - pad * 2 - 10, s - pad * 2 - 10, RADIUS - 5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,240,210,0.07)';
    ctx.stroke();
  }
}

/** Контурные иконки 64×64 (белые — красятся tint'ом). */
const ICONS: Record<string, (ctx: Ctx) => void> = {
  map: (c) => {
    c.beginPath();
    c.moveTo(8, 16); c.lineTo(24, 10); c.lineTo(40, 16); c.lineTo(56, 10); c.lineTo(56, 48); c.lineTo(40, 54); c.lineTo(24, 48); c.lineTo(8, 54); c.closePath();
    c.moveTo(24, 10); c.lineTo(24, 48); c.moveTo(40, 16); c.lineTo(40, 54);
    c.stroke();
  },
  helmet: (c) => {
    c.beginPath();
    c.moveTo(14, 40); c.bezierCurveTo(14, 18, 22, 8, 32, 8); c.bezierCurveTo(42, 8, 50, 18, 50, 40); c.closePath();
    c.moveTo(12, 40); c.lineTo(10, 54); c.lineTo(54, 54); c.lineTo(52, 40);
    c.moveTo(26, 26); c.lineTo(38, 26); c.moveTo(32, 26); c.lineTo(32, 40);
    c.stroke();
  },
  home: (c) => {
    c.beginPath();
    c.moveTo(8, 30); c.lineTo(32, 10); c.lineTo(56, 30);
    c.moveTo(14, 26); c.lineTo(14, 54); c.lineTo(50, 54); c.lineTo(50, 26);
    c.moveTo(27, 54); c.lineTo(27, 40); c.lineTo(37, 40); c.lineTo(37, 54);
    c.stroke();
  },
  gear: (c) => {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.moveTo(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16);
      c.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24);
    }
    c.stroke();
    c.beginPath(); c.arc(32, 32, 16, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(32, 32, 7, 0, Math.PI * 2); c.stroke();
  },
  gift: (c) => {
    c.beginPath();
    c.rect(10, 24, 44, 10); c.rect(14, 34, 36, 20);
    c.moveTo(32, 24); c.lineTo(32, 54);
    c.moveTo(32, 24); c.bezierCurveTo(24, 10, 12, 16, 22, 24);
    c.moveTo(32, 24); c.bezierCurveTo(40, 10, 52, 16, 42, 24);
    c.stroke();
  },
  bag: (c) => {
    c.beginPath();
    c.moveTo(14, 22); c.lineTo(50, 22); c.lineTo(54, 54); c.lineTo(10, 54); c.closePath();
    c.moveTo(24, 22); c.bezierCurveTo(24, 8, 40, 8, 40, 22);
    c.stroke();
  },
  lock: (c) => {
    c.beginPath(); rr(c, 14, 28, 36, 26, 6); c.stroke();
    c.beginPath(); c.moveTo(21, 28); c.lineTo(21, 20); c.bezierCurveTo(21, 8, 43, 8, 43, 20); c.lineTo(43, 28); c.stroke();
    c.beginPath(); c.arc(32, 40, 3, 0, Math.PI * 2); c.stroke();
  },
  chest: (c) => {
    c.beginPath(); rr(c, 8, 26, 48, 28, 5); c.stroke();
    c.beginPath(); c.moveTo(8, 32); c.bezierCurveTo(8, 12, 56, 12, 56, 32); c.stroke();
    c.beginPath(); c.moveTo(8, 34); c.lineTo(56, 34); c.stroke();
    c.beginPath(); rr(c, 27, 30, 10, 10, 2); c.stroke();
  },
  scroll: (c) => {
    c.beginPath();
    c.moveTo(18, 10); c.lineTo(48, 10); c.lineTo(48, 50); c.bezierCurveTo(48, 56, 42, 56, 40, 52);
    c.moveTo(18, 10); c.bezierCurveTo(12, 10, 12, 18, 18, 18); c.lineTo(18, 50); c.bezierCurveTo(18, 58, 40, 58, 40, 52); c.lineTo(28, 52);
    c.moveTo(24, 22); c.lineTo(42, 22); c.moveTo(24, 30); c.lineTo(42, 30); c.moveTo(24, 38); c.lineTo(36, 38);
    c.stroke();
  },
  tower: (c) => {
    c.beginPath();
    c.moveTo(18, 54); c.lineTo(20, 22); c.lineTo(44, 22); c.lineTo(46, 54); c.closePath();
    c.moveTo(16, 22); c.lineTo(16, 12); c.lineTo(22, 12); c.lineTo(22, 16); c.lineTo(29, 16); c.lineTo(29, 12); c.lineTo(35, 12); c.lineTo(35, 16); c.lineTo(42, 16); c.lineTo(42, 12); c.lineTo(48, 12); c.lineTo(48, 22);
    c.moveTo(28, 54); c.lineTo(28, 42); c.bezierCurveTo(28, 36, 36, 36, 36, 42); c.lineTo(36, 54);
    c.stroke();
  },
  trophy: (c) => {
    c.beginPath();
    c.moveTo(20, 10); c.lineTo(44, 10); c.lineTo(44, 24); c.bezierCurveTo(44, 36, 20, 36, 20, 24); c.closePath();
    c.moveTo(20, 14); c.bezierCurveTo(8, 14, 10, 28, 22, 28);
    c.moveTo(44, 14); c.bezierCurveTo(56, 14, 54, 28, 42, 28);
    c.moveTo(32, 34); c.lineTo(32, 44); c.moveTo(22, 54); c.lineTo(42, 54); c.lineTo(40, 44); c.lineTo(24, 44); c.closePath();
    c.stroke();
  },
  swords: (c) => {
    c.beginPath();
    c.moveTo(12, 12); c.lineTo(44, 44); c.moveTo(52, 12); c.lineTo(20, 44);
    c.moveTo(38, 48); c.lineTo(48, 38); c.moveTo(16, 38); c.lineTo(26, 48);
    c.moveTo(44, 44); c.lineTo(52, 52); c.moveTo(20, 44); c.lineTo(12, 52);
    c.stroke();
  },
  check: (c) => {
    c.beginPath(); c.moveTo(14, 34); c.lineTo(26, 46); c.lineTo(50, 18); c.stroke();
  },
  back: (c) => {
    c.beginPath(); c.moveTo(38, 14); c.lineTo(20, 32); c.lineTo(38, 50); c.stroke();
  },
  next: (c) => {
    c.beginPath(); c.moveTo(26, 14); c.lineTo(44, 32); c.lineTo(26, 50); c.stroke();
  },
};

export type SkinIcon = keyof typeof ICONS;

/** Id текстуры иконки скина. */
export const skinIcon = (name: SkinIcon) => `skin_ico_${name}`;

/** Сгенерировать все текстуры скина (один раз, в BootScene). */
export function buildSkin(scene: Phaser.Scene): void {
  const S = 128;
  const base = { top: SKIN.panelTop, bottom: SKIN.panelBottom };
  canvas(scene, 'skin_panel', S, S, (c) => tile(c, S, { ...base, border: '#35302a' }));
  canvas(scene, 'skin_panel_light', S, S, (c) => tile(c, S, { top: '#34302a', bottom: '#24211c', border: SKIN.bronze }));
  canvas(scene, 'skin_slot', S, S, (c) => tile(c, S, { top: '#23201b', bottom: '#161512', border: SKIN.bronze }));
  canvas(scene, 'skin_slot_empty', S, S, (c) => tile(c, S, { top: '#181713', bottom: '#11100d', border: '#2e2a24' }));
  canvas(scene, 'skin_slot_selected', S, S, (c) => tile(c, S, { top: '#34302a', bottom: '#201d18', border: SKIN.gold, glow: SKIN.gold }));
  canvas(scene, 'skin_btn', S, S, (c) => tile(c, S, { ...base, border: SKIN.bronze }));
  canvas(scene, 'skin_btn_pressed', S, S, (c) => tile(c, S, { ...base, border: SKIN.bronze, pressed: true }));
  canvas(scene, 'skin_btn_active', S, S, (c) => tile(c, S, { top: '#342c20', bottom: '#1d1914', border: SKIN.gold, glow: 'rgba(214,174,99,0.6)' }));
  canvas(scene, 'skin_btn_active_pressed', S, S, (c) => tile(c, S, { top: '#342c20', bottom: '#1d1914', border: SKIN.gold, pressed: true }));
  canvas(scene, 'skin_btn_gold', S, S, (c) => tile(c, S, { top: SKIN.goldLight, bottom: '#b7862f', border: '#6b4a1a' }));
  canvas(scene, 'skin_btn_gold_pressed', S, S, (c) => tile(c, S, { top: '#b7862f', bottom: '#9a6f25', border: '#6b4a1a', pressed: true }));

  // Иконки: белый контур, скруглённые концы.
  for (const [name, draw] of Object.entries(ICONS)) {
    canvas(scene, `skin_ico_${name}`, 64, 64, (c) => {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 4.5;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      draw(c);
    });
  }

  // Кружки этапов: металлический диск с тёмным ободом и сектором-бликом (как «монета» в референсе).
  const disc = (key: string, face: [string, string], rim: string) =>
    canvas(scene, key, 200, 200, (c) => {
      const cx = 100;
      c.beginPath(); c.arc(cx, cx, 96, 0, Math.PI * 2); c.fillStyle = '#0b0b0a'; c.fill();
      c.beginPath(); c.arc(cx, cx, 90, 0, Math.PI * 2);
      const rg = c.createLinearGradient(0, 10, 0, 190);
      rg.addColorStop(0, '#3a342b'); rg.addColorStop(1, '#16140f');
      c.fillStyle = rg; c.fill();
      c.lineWidth = 3; c.strokeStyle = rim; c.stroke();
      c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2);
      const fg = c.createRadialGradient(cx - 20, cx - 25, 8, cx, cx, 70);
      fg.addColorStop(0, face[0]); fg.addColorStop(1, face[1]);
      c.fillStyle = fg; c.fill();
      // Сектора-блики.
      c.save();
      c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2); c.clip();
      c.fillStyle = 'rgba(255,255,255,0.07)';
      for (const a of [-2.4, -0.3, 1.8]) {
        c.beginPath(); c.moveTo(cx, cx); c.arc(cx, cx, 70, a, a + 0.55); c.closePath(); c.fill();
      }
      c.restore();
      c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2); c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.stroke();
    });
  disc('skin_node_locked', ['#4a4a4e', '#1e1e22'], '#2b2721');
  disc('skin_node_cleared', ['#5a4a30', '#2a2116'], SKIN.bronze);
  disc('skin_node_open', ['#8a2a2a', '#3a1010'], '#6a2a22');
  disc('skin_node_boss', ['#5a1a4a', '#220a1c'], '#7a2a44');

  // Лесной фон (как в референсе): градиент, силуэты крон двумя планами, лучи и светлячки.
  canvas(scene, 'skin_bg_forest', 540, 960, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 960);
    g.addColorStop(0, SKIN.forestTop); g.addColorStop(0.55, '#173222'); g.addColorStop(1, SKIN.forestBottom);
    c.fillStyle = g; c.fillRect(0, 0, 540, 960);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const crowns = (color: string, n: number, yMin: number, yMax: number, rMin: number, rMax: number) => {
      c.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const x = rnd() * 600 - 30;
        const y = yMin + rnd() * (yMax - yMin);
        const r = rMin + rnd() * (rMax - rMin);
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(x + r * 0.7, y + r * 0.2, r * 0.8, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(x - r * 0.6, y + r * 0.3, r * 0.7, 0, Math.PI * 2); c.fill();
      }
    };
    crowns('rgba(40,78,48,0.45)', 10, 80, 700, 50, 110);
    // Лучи света.
    c.fillStyle = 'rgba(160,220,150,0.05)';
    for (const x of [120, 300, 430]) {
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 40, 0); c.lineTo(x + 140, 960); c.lineTo(x + 60, 960); c.closePath(); c.fill();
    }
    crowns('rgba(12,28,16,0.75)', 9, 250, 960, 60, 130);
    // Стволы по краям.
    c.fillStyle = 'rgba(8,18,10,0.85)';
    c.fillRect(0, 0, 38, 960);
    c.fillRect(505, 0, 35, 960);
    // Светлячки.
    for (let i = 0; i < 14; i++) {
      const x = rnd() * 540;
      const y = rnd() * 960;
      const rg = c.createRadialGradient(x, y, 0, x, y, 7);
      rg.addColorStop(0, 'rgba(200,255,160,0.9)'); rg.addColorStop(1, 'rgba(200,255,160,0)');
      c.fillStyle = rg; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill();
    }
    // Виньетка.
    const v = c.createRadialGradient(270, 480, 250, 270, 480, 620);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v; c.fillRect(0, 0, 540, 960);
  });
}
