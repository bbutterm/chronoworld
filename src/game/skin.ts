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

interface TileOpts {
  top: string;
  bottom: string;
  border: string;
  /** Светлая кромка рамки сверху (металл: светлее сверху, темнее снизу). Нет — рамка одним цветом. */
  borderLight?: string;
  glow?: string;
  pressed?: boolean;
  /** Кнопка: «толщина» снизу (тёмная кромка), нажатая — без неё и ниже. */
  lip?: string;
  /** Глянец верхней половины (золотая кнопка). */
  gloss?: number;
  /** Золотые заклёпки-ромбы в углах (рамки карточек). */
  studs?: string;
}

/**
 * Плитка в духе AFK Arena: тёмный внешний контур-тень, тело с вертикальным градиентом, металлическая рамка
 * (светлее сверху), фаска — светлая линия по верху и тень по низу, тонкая внутренняя кромка; у кнопок — «толщина»
 * снизу (нажатая проседает), у карточек — заклёпки в углах. Всё в пределах угла 9-slice (SKIN_SLICE).
 */
function tile(ctx: Ctx, s: number, o: TileOpts): void {
  const pad = 5;
  const lip = o.lip && !o.pressed ? 7 : 0;
  const x = pad;
  const w = s - pad * 2;
  const y = pad + (o.lip && o.pressed ? 4 : 0);
  const h = s - pad * 2 - lip - (o.lip && o.pressed ? 4 : 0);
  // Внешний тёмный контур (отделяет плитку от любого фона) и мягкая тень.
  ctx.save();
  ctx.shadowColor = o.glow ?? 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = o.glow ? 12 : 6;
  ctx.shadowOffsetY = o.glow ? 0 : 2;
  rr(ctx, x - 1, y - 1, w + 2, h + lip + 2, RADIUS + 1);
  ctx.fillStyle = '#070605';
  ctx.fill();
  ctx.restore();
  // «Толщина» кнопки снизу.
  if (lip) {
    rr(ctx, x, y + lip, w, h, RADIUS);
    ctx.fillStyle = o.lip as string;
    ctx.fill();
  }
  // Тело.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, o.pressed ? o.bottom : o.top);
  g.addColorStop(1, o.bottom);
  rr(ctx, x, y, w, h, RADIUS);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  rr(ctx, x, y, w, h, RADIUS);
  ctx.clip();
  // Глянец: светлая верхняя половина с мягким краем.
  if (o.gloss && !o.pressed) {
    const gl = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
    gl.addColorStop(0, `rgba(255,255,255,${o.gloss})`);
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x, y, w, h * 0.55);
  }
  // Фаска: блик по верху, тень по низу.
  const bev = ctx.createLinearGradient(0, y, 0, y + h);
  bev.addColorStop(0, o.pressed ? 'rgba(0,0,0,0.25)' : 'rgba(255,236,200,0.10)');
  bev.addColorStop(0.18, 'rgba(255,236,200,0)');
  bev.addColorStop(0.8, 'rgba(0,0,0,0)');
  bev.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = bev;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  // Металлическая рамка.
  rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, RADIUS - 1);
  if (o.borderLight) {
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, o.borderLight);
    bg.addColorStop(0.5, o.border);
    bg.addColorStop(1, o.border);
    ctx.strokeStyle = bg;
  } else ctx.strokeStyle = o.border;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Внутренняя кромка — тонкий светлый контур.
  rr(ctx, x + 6, y + 6, w - 12, h - 12, RADIUS - 6);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = o.pressed ? 'rgba(255,240,210,0.04)' : 'rgba(255,240,210,0.09)';
  ctx.stroke();
  // Верхний блик рамки — короткая светлая линия по центру (как отблеск на металле).
  if (!o.pressed) {
    const hl = ctx.createLinearGradient(x + RADIUS, 0, x + w - RADIUS, 0);
    hl.addColorStop(0, 'rgba(255,245,215,0)');
    hl.addColorStop(0.5, 'rgba(255,245,215,0.35)');
    hl.addColorStop(1, 'rgba(255,245,215,0)');
    ctx.strokeStyle = hl;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + RADIUS, y + 3);
    ctx.lineTo(x + w - RADIUS, y + 3);
    ctx.stroke();
  }
  if (o.studs) {
    ctx.fillStyle = o.studs;
    for (const [cx, cy] of [[x + 13, y + 13], [x + w - 13, y + 13], [x + 13, y + h - 13], [x + w - 13, y + h - 13]]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4.5); ctx.lineTo(cx + 4.5, cy); ctx.lineTo(cx, cy + 4.5); ctx.lineTo(cx - 4.5, cy);
      ctx.closePath();
      ctx.fill();
    }
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
  // Вкладка «Город»: крепостная стена с двумя башнями и воротами.
  castle: (c) => {
    c.beginPath();
    c.moveTo(8, 56); c.lineTo(8, 14); c.lineTo(14, 14); c.lineTo(14, 20); c.lineTo(20, 20); c.lineTo(20, 14); c.lineTo(26, 14); c.lineTo(26, 30);
    c.lineTo(38, 30); c.lineTo(38, 14); c.lineTo(44, 14); c.lineTo(44, 20); c.lineTo(50, 20); c.lineTo(50, 14); c.lineTo(56, 14); c.lineTo(56, 56); c.closePath();
    c.moveTo(26, 56); c.lineTo(26, 44); c.bezierCurveTo(26, 36, 38, 36, 38, 44); c.lineTo(38, 56);
    c.stroke();
  },
  // Вкладка «Приключения»: компас (кольцо и стрелка).
  compass: (c) => {
    c.beginPath();
    c.arc(32, 32, 22, 0, Math.PI * 2);
    c.moveTo(32, 14); c.lineTo(39, 32); c.lineTo(32, 50); c.lineTo(25, 32); c.closePath();
    c.moveTo(25, 32); c.lineTo(39, 32);
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
  hourglass: (c) => {
    c.beginPath();
    c.moveTo(16, 8); c.lineTo(48, 8); c.moveTo(16, 56); c.lineTo(48, 56);
    c.moveTo(20, 8); c.bezierCurveTo(20, 26, 32, 26, 32, 32); c.bezierCurveTo(32, 38, 20, 38, 20, 56);
    c.moveTo(44, 8); c.bezierCurveTo(44, 26, 32, 26, 32, 32); c.bezierCurveTo(32, 38, 44, 38, 44, 56);
    c.moveTo(25, 50); c.lineTo(39, 50);
    c.stroke();
  },
  flag: (c) => {
    c.beginPath();
    c.moveTo(16, 58); c.lineTo(16, 8);
    c.moveTo(16, 10); c.bezierCurveTo(28, 4, 36, 16, 50, 10); c.lineTo(50, 34); c.bezierCurveTo(36, 40, 28, 28, 16, 34);
    c.stroke();
  },
  star: (c) => {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 11 : 24;
      if (i) c.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
      else c.moveTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
    }
    c.closePath();
    c.stroke();
  },
};

export type SkinIcon = keyof typeof ICONS;

/** Id текстуры иконки скина. */
export const skinIcon = (name: SkinIcon) => `skin_ico_${name}`;

/** Сгенерировать все текстуры скина (один раз, в BootScene). */
export function buildSkin(scene: Phaser.Scene): void {
  const S = 128;
  const base = { top: SKIN.panelTop, bottom: SKIN.panelBottom };
  const metal = { border: '#4a3b25', borderLight: '#a8864f' };
  const stud = 'rgba(214,174,99,0.75)';
  // Карточки: рамка «бронза», заклёпки в углах.
  canvas(scene, 'skin_panel', S, S, (c) => tile(c, S, { ...base, ...metal, studs: stud }));
  canvas(scene, 'skin_panel_light', S, S, (c) => tile(c, S, { top: '#38322a', bottom: '#25211b', border: SKIN.bronze, borderLight: '#b8955a', studs: stud }));
  canvas(scene, 'skin_slot', S, S, (c) => tile(c, S, { top: '#28241e', bottom: '#161512', border: SKIN.bronze, borderLight: '#8d7248' }));
  canvas(scene, 'skin_slot_empty', S, S, (c) => tile(c, S, { top: '#1a1915', bottom: '#11100d', border: '#2e2a24', borderLight: '#4a4236' }));
  canvas(scene, 'skin_slot_selected', S, S, (c) => tile(c, S, { top: '#3a3327', bottom: '#201d18', border: SKIN.gold, borderLight: SKIN.goldLight, glow: SKIN.gold }));
  // Кнопки: «толщина» снизу, нажатая проседает.
  const btn = { top: '#3a3228', bottom: '#1f1b16', ...metal, lip: '#0f0c09' };
  canvas(scene, 'skin_btn', S, S, (c) => tile(c, S, btn));
  canvas(scene, 'skin_btn_pressed', S, S, (c) => tile(c, S, { ...btn, pressed: true }));
  const active = { top: '#4a3b24', bottom: '#241d14', border: SKIN.goldDark, borderLight: SKIN.goldLight, lip: '#140f08' };
  canvas(scene, 'skin_btn_active', S, S, (c) => tile(c, S, { ...active, glow: 'rgba(214,174,99,0.6)' }));
  canvas(scene, 'skin_btn_active_pressed', S, S, (c) => tile(c, S, { ...active, pressed: true }));
  const gold = { top: '#ffe6a6', bottom: '#b27a26', border: '#5a3a10', borderLight: '#fff2c8', lip: '#6e4512', gloss: 0.32 };
  canvas(scene, 'skin_btn_gold', S, S, (c) => tile(c, S, gold));
  canvas(scene, 'skin_btn_gold_pressed', S, S, (c) => tile(c, S, { ...gold, top: '#d9a54c', pressed: true }));
  // Недоступная кнопка (ui.ts setEnabled(false)): серый «камень» — без тёплой бронзы и глянца, с той же «толщиной».
  canvas(scene, 'skin_btn_disabled', S, S, (c) => tile(c, S, { top: '#3b3a37', bottom: '#262523', border: '#1d1c1a', borderLight: '#6b6962', lip: '#121110' }));
  // Опасное действие (сброс прогресса): тёмно-красная кнопка, кремовая подпись.
  const danger = { top: '#a63a2a', bottom: '#5e1a12', border: '#2a0804', borderLight: '#e0806a', lip: '#2a0804', gloss: 0.12 };
  canvas(scene, 'skin_btn_danger', S, S, (c) => tile(c, S, danger));
  canvas(scene, 'skin_btn_danger_pressed', S, S, (c) => tile(c, S, { ...danger, pressed: true }));
  // Вкладки нижней навигации: плоские (без «толщины»), активная — золотая рамка и тёплое свечение.
  canvas(scene, 'skin_tab', S, S, (c) => tile(c, S, { top: '#221e19', bottom: '#15130f', border: '#3a3022', borderLight: '#6a5638' }));
  canvas(scene, 'skin_tab_pressed', S, S, (c) => tile(c, S, { top: '#221e19', bottom: '#15130f', border: '#3a3022', pressed: true }));
  canvas(scene, 'skin_tab_active', S, S, (c) => tile(c, S, { top: '#4d3c22', bottom: '#1f1911', border: SKIN.gold, borderLight: SKIN.goldLight, glow: 'rgba(240,207,138,0.7)' }));
  canvas(scene, 'skin_tab_active_pressed', S, S, (c) => tile(c, S, { top: '#4d3c22', bottom: '#1f1911', border: SKIN.gold, pressed: true }));
  // «Таблетка» валюты: утопленное тёмное поле с бронзовой кромкой.
  canvas(scene, 'skin_pill', S, S, (c) => {
    tile(c, S, { top: '#0c0b09', bottom: '#1b1813', border: '#3a2f1f', borderLight: '#8a6e44', pressed: true });
  });
  buildDecor(scene);

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

  // Искра (торжественные моменты: смена профессии) — мягкое свечение и четырёхлучевая звезда, белая (красится tint'ом).
  canvas(scene, 'skin_spark', 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(32, 2); c.quadraticCurveTo(35, 29, 62, 32); c.quadraticCurveTo(35, 35, 32, 62); c.quadraticCurveTo(29, 35, 2, 32); c.quadraticCurveTo(29, 29, 32, 2);
    c.fill();
  });
  // Лучи за фигурой героя: веер золотых клиньев, гаснущих к краю, и тёплое ядро.
  canvas(scene, 'skin_rays', 512, 512, (c) => {
    const cx = 256;
    const g = c.createRadialGradient(cx, cx, 20, cx, cx, 256);
    g.addColorStop(0, 'rgba(255,220,140,0.75)');
    g.addColorStop(0.5, 'rgba(214,174,99,0.3)');
    g.addColorStop(1, 'rgba(214,174,99,0)');
    c.fillStyle = g;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx, cx);
      c.arc(cx, cx, 256, a, a + (Math.PI / n) * 0.8);
      c.closePath();
      c.fill();
    }
    const core = c.createRadialGradient(cx, cx, 0, cx, cx, 150);
    core.addColorStop(0, 'rgba(255,236,190,0.55)');
    core.addColorStop(1, 'rgba(255,236,190,0)');
    c.fillStyle = core;
    c.fillRect(0, 0, 512, 512);
  });
  // Плашки «Победа» / «Поражение» в стиле скина: тёмная плита с металлической рамкой, лавровые ветви по бокам,
  // ромб-герб сверху, надпись с градиентом и тёмной обводкой (как итоговые баннеры AFK Arena).
  const banner = (key: string, label: string, face: [string, string], border: string, leaf: [string, string]) =>
    canvas(scene, key, 900, 300, (c) => {
      const W = 900;
      const H = 300;
      const bx = 100;
      const bw = W - 200;
      // Лавровые ветви: листья по дуге от низа плиты вверх и наружу.
      for (const d of [-1, 1]) {
        const ox = W / 2 + d * (bw / 2 - 30);
        for (let i = 0; i < 9; i++) {
          const t = i / 8;
          const ang = Math.PI * (0.62 - t * 0.6);
          const lx = ox + d * Math.cos(ang) * 120 * (0.4 + t * 0.6) + d * 30;
          const ly = 230 - t * 170;
          for (const side of [-1, 1]) {
            c.save();
            c.translate(lx, ly);
            c.rotate(d * (side * 0.7 - 0.2 - t * 0.5));
            c.beginPath();
            c.ellipse(side * 14, 0, 22 - t * 6, 8, 0, 0, Math.PI * 2);
            const lg = c.createLinearGradient(0, -8, 0, 8);
            lg.addColorStop(0, leaf[0]);
            lg.addColorStop(1, leaf[1]);
            c.fillStyle = lg;
            c.fill();
            c.lineWidth = 2;
            c.strokeStyle = '#140d06';
            c.stroke();
            c.restore();
          }
        }
      }
      // Плита.
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.7)';
      c.shadowBlur = 16;
      c.shadowOffsetY = 6;
      rr(c, bx, 60, bw, 180, 30);
      c.fillStyle = '#0a0806';
      c.fill();
      c.restore();
      const g = c.createLinearGradient(0, 60, 0, 240);
      g.addColorStop(0, '#3a3228');
      g.addColorStop(1, '#141210');
      rr(c, bx + 4, 64, bw - 8, 172, 26);
      c.fillStyle = g;
      c.fill();
      c.save();
      c.shadowColor = border;
      c.shadowBlur = 20;
      c.lineWidth = 6;
      const bg = c.createLinearGradient(0, 64, 0, 236);
      bg.addColorStop(0, face[0]);
      bg.addColorStop(0.5, border);
      bg.addColorStop(1, border);
      c.strokeStyle = bg;
      c.stroke();
      c.restore();
      rr(c, bx + 18, 78, bw - 36, 144, 18);
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255,240,210,0.16)';
      c.stroke();
      // Ромбы-заклёпки по бокам и герб сверху.
      c.fillStyle = border;
      for (const x of [bx + 44, W - bx - 44]) {
        c.beginPath(); c.moveTo(x, H / 2 - 16); c.lineTo(x + 12, H / 2); c.lineTo(x, H / 2 + 16); c.lineTo(x - 12, H / 2); c.closePath(); c.fill();
      }
      const crest = (r: number, fill: string | CanvasGradient) => {
        c.beginPath(); c.moveTo(W / 2, 62 - r); c.lineTo(W / 2 + r * 0.85, 62); c.lineTo(W / 2, 62 + r); c.lineTo(W / 2 - r * 0.85, 62); c.closePath();
        c.fillStyle = fill; c.fill();
      };
      crest(34, '#0a0806');
      const cg = c.createLinearGradient(0, 34, 0, 90);
      cg.addColorStop(0, face[0]);
      cg.addColorStop(1, border);
      crest(28, cg);
      crest(11, '#1a0e08');
      // Надпись: крупно, но в ширину плиты.
      let size = 100;
      c.font = `bold ${size}px Arial, "Helvetica Neue", sans-serif`;
      const maxW = bw - 150;
      const mw = c.measureText(label).width;
      if (mw > maxW) {
        size = Math.floor((size * maxW) / mw);
        c.font = `bold ${size}px Arial, "Helvetica Neue", sans-serif`;
      }
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 12;
      c.lineJoin = 'round';
      c.strokeStyle = '#120d07';
      c.strokeText(label, W / 2, H / 2 + 10);
      const tg = c.createLinearGradient(0, H / 2 - size / 2, 0, H / 2 + size / 2);
      tg.addColorStop(0, face[0]);
      tg.addColorStop(0.55, face[1]);
      tg.addColorStop(1, face[1]);
      c.fillStyle = tg;
      c.fillText(label, W / 2, H / 2 + 10);
      // Блик по верхней половине букв.
      c.save();
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(0, H / 2 - size / 2, W, size * 0.35);
      c.restore();
    });
  banner('skin_banner_victory', 'ПОБЕДА', ['#fff0c0', '#d6a040'], SKIN.gold, ['#f0cf8a', '#8f6a2c']);
  banner('skin_banner_defeat', 'ПОРАЖЕНИЕ', ['#ffc0b0', '#b8402e'], '#8a3a2e', ['#9a8a7a', '#4a3a30']);

  // Лесной фон (как в референсе): градиент, силуэты крон двумя планами, лучи и светлячки.
  canvas(scene, 'skin_bg_forest', BG_W, BG_H, (c) => drawForest(c, BG_W, BG_H));
  // Поле боя главы 1: поляна на опушке (трава и земля — тайлы художника, если загружены).
  const img = (key: string) => (scene.textures.exists(key) ? (scene.textures.get(key).getSourceImage() as CanvasImageSource) : null);
  canvas(scene, 'skin_bg_battle', BG_W, BG_H, (c) => drawMeadow(c, BG_W, BG_H, img('tile_grass_01'), img('tile_dirt')));
}

/**
 * Украшения экранов (шапка, навигация, ленты заголовков, медальоны иконок, блики) — src/game/decor.ts.
 * Все текстуры маленькие и рисуются один раз при загрузке.
 */
function buildDecor(scene: Phaser.Scene): void {
  // Шапка и навигация: вертикальный градиент тёмная бронза (растягивается по ширине).
  canvas(scene, 'skin_header_grad', 4, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#070605');
    g.addColorStop(0.55, '#15120d');
    g.addColorStop(1, '#2a2115');
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 256);
  });
  // Золотая кромка: тёмная подложка, золотая линия с угасанием к краям, светлый блик.
  canvas(scene, 'skin_trim', 512, 12, (c) => {
    c.fillStyle = 'rgba(0,0,0,0.7)';
    c.fillRect(0, 7, 512, 5);
    const g = c.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0, 'rgba(143,106,44,0.5)');
    g.addColorStop(0.5, '#e8c67e');
    g.addColorStop(1, 'rgba(143,106,44,0.5)');
    c.fillStyle = g;
    c.fillRect(0, 3, 512, 4);
    c.fillStyle = 'rgba(255,240,200,0.35)';
    c.fillRect(0, 3, 512, 1);
  });
  // Орнамент по центру кромки: ромб с «крыльями»-завитками.
  canvas(scene, 'skin_ornament', 240, 48, (c) => {
    const cx = 120;
    const cy = 24;
    c.lineCap = 'round';
    c.strokeStyle = '#0a0806';
    c.lineWidth = 7;
    const wings = () => {
      c.beginPath();
      for (const d of [-1, 1]) {
        c.moveTo(cx + d * 18, cy);
        c.bezierCurveTo(cx + d * 44, cy - 16, cx + d * 70, cy + 10, cx + d * 100, cy);
        c.moveTo(cx + d * 30, cy + 2);
        c.bezierCurveTo(cx + d * 46, cy + 14, cx + d * 60, cy + 6, cx + d * 66, cy - 2);
      }
      c.stroke();
    };
    wings();
    c.strokeStyle = '#d6ae63';
    c.lineWidth = 3;
    wings();
    const dia = (r: number, fill: string | CanvasGradient) => {
      c.beginPath();
      c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.8, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r * 0.8, cy);
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    };
    dia(20, '#0a0806');
    const g = c.createLinearGradient(0, cy - 16, 0, cy + 16);
    g.addColorStop(0, '#fff0c0');
    g.addColorStop(1, '#a8782c');
    dia(15, g);
    dia(6, '#5a1a14');
  });
  // Лента заголовка: тёмно-красное полотно с золотой кромкой и вырезами на концах (3-slice по горизонтали).
  canvas(scene, 'skin_ribbon', 256, 96, (c) => {
    const W = 256;
    const H = 96;
    const notch = 22;
    const shape = (inset: number) => {
      c.beginPath();
      c.moveTo(inset, 10 + inset);
      c.lineTo(W - inset, 10 + inset);
      c.lineTo(W - notch - inset * 0.5, H / 2);
      c.lineTo(W - inset, H - 10 - inset);
      c.lineTo(inset, H - 10 - inset);
      c.lineTo(notch + inset * 0.5, H / 2);
      c.closePath();
    };
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 8;
    c.shadowOffsetY = 3;
    shape(0);
    c.fillStyle = '#0a0706';
    c.fill();
    c.restore();
    shape(3);
    const g = c.createLinearGradient(0, 12, 0, H - 12);
    g.addColorStop(0, '#7a2a1e');
    g.addColorStop(0.5, '#5a1a12');
    g.addColorStop(1, '#3a0e0a');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3;
    const bg = c.createLinearGradient(0, 12, 0, H - 12);
    bg.addColorStop(0, '#f0cf8a');
    bg.addColorStop(1, '#8f6a2c');
    c.strokeStyle = bg;
    c.stroke();
    shape(9);
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(255,220,160,0.25)';
    c.stroke();
  });
  // Медальон под иконку: бронзовый обод, тёмное поле, блик сверху.
  canvas(scene, 'skin_medallion', 160, 160, (c) => {
    const cx = 80;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 8;
    c.shadowOffsetY = 3;
    c.beginPath(); c.arc(cx, cx, 72, 0, Math.PI * 2); c.fillStyle = '#0a0806'; c.fill();
    c.restore();
    const rim = c.createLinearGradient(0, 10, 0, 150);
    rim.addColorStop(0, '#f0cf8a');
    rim.addColorStop(0.5, '#a8803e');
    rim.addColorStop(1, '#4a3418');
    c.beginPath(); c.arc(cx, cx, 68, 0, Math.PI * 2); c.fillStyle = rim; c.fill();
    const face = c.createRadialGradient(cx, cx - 20, 6, cx, cx, 60);
    face.addColorStop(0, '#4a3a26');
    face.addColorStop(1, '#16120c');
    c.beginPath(); c.arc(cx, cx, 58, 0, Math.PI * 2); c.fillStyle = face; c.fill();
    c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.stroke();
    c.save();
    c.beginPath(); c.arc(cx, cx, 58, 0, Math.PI * 2); c.clip();
    const gl = c.createLinearGradient(0, 22, 0, 80);
    gl.addColorStop(0, 'rgba(255,240,200,0.18)');
    gl.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = gl;
    c.fillRect(0, 0, 160, 80);
    c.restore();
  });
  // Мягкое круглое свечение (белое — красится tint'ом).
  canvas(scene, 'skin_glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  // Блик, пробегающий по главной кнопке: косая мягкая полоса.
  canvas(scene, 'skin_shine', 96, 160, (c) => {
    const g = c.createLinearGradient(0, 0, 96, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(40, 0); c.lineTo(96, 0); c.lineTo(56, 160); c.lineTo(0, 160);
    c.closePath();
    c.fill();
  });
}

const BG_W = 720;
const BG_H = 1280;

/**
 * Ночной лес в несколько планов (как фон в референсе): небо с лунным светом, дальние ели в дымке, полоса тумана,
 * средний план лиственных крон, лучи света, крупные стволы с листвой по краям, кусты внизу, светлячки, виньетка.
 * Всё детерминированно (свой seed) — фон одинаков при каждом запуске.
 */
function drawForest(c: Ctx, W: number, H: number): void {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a: number, b: number) => a + rnd() * (b - a);

  // Небо.
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d1f1a');
  sky.addColorStop(0.38, '#2a5445');
  sky.addColorStop(0.55, '#1b3a2c');
  sky.addColorStop(1, '#0a160f');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  // Лунное свечение сверху справа.
  const moon = c.createRadialGradient(W * 0.72, H * 0.1, 0, W * 0.72, H * 0.1, W * 0.75);
  moon.addColorStop(0, 'rgba(190,230,200,0.22)');
  moon.addColorStop(1, 'rgba(190,230,200,0)');
  c.fillStyle = moon;
  c.fillRect(0, 0, W, H);

  // Ель: ярусы треугольников на тонком стволе.
  const pine = (x: number, base: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x - h * 0.02, base - h * 0.2, h * 0.04, h * 0.2);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const w = h * (0.34 - t * 0.22);
      const y = base - h * 0.12 - t * h * 0.78;
      c.beginPath();
      c.moveTo(x - w, y);
      c.lineTo(x + w, y);
      c.lineTo(x, y - h * 0.3);
      c.closePath();
      c.fill();
    }
  };
  // Лиственное дерево: ствол и крона из пересекающихся кругов.
  const tree = (x: number, base: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x - h * 0.035, base - h * 0.45, h * 0.07, h * 0.45);
    const cy = base - h * 0.62;
    const r = h * 0.26;
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.arc(x + between(-r, r) * 0.9, cy + between(-r, r) * 0.6, r * between(0.55, 0.85), 0, Math.PI * 2);
      c.fill();
    }
  };

  // Самый дальний ряд — светлые ели в дымке, за ним ближний дальний ряд.
  for (let x = -20; x < W + 40; x += between(22, 36)) pine(x, H * 0.44 + between(-15, 15), between(110, 170), 'rgba(58,104,84,0.75)');
  for (let x = -20; x < W + 40; x += between(28, 48)) pine(x, H * 0.52 + between(-20, 20), between(160, 240), 'rgba(34,72,54,0.95)');
  // Туман.
  const mist = c.createLinearGradient(0, H * 0.4, 0, H * 0.6);
  mist.addColorStop(0, 'rgba(120,170,140,0)');
  mist.addColorStop(0.5, 'rgba(120,170,140,0.16)');
  mist.addColorStop(1, 'rgba(120,170,140,0)');
  c.fillStyle = mist;
  c.fillRect(0, H * 0.4, W, H * 0.2);
  // Средний план — кроны темнее и крупнее, с просветами и подсветкой по верхнему краю.
  for (let x = -40; x < W + 60; x += between(110, 170)) {
    const base = H * 0.74 + between(-30, 30);
    const h = between(260, 360);
    tree(x, base, h, 'rgba(22,50,36,1)');
    // Лунная кромка: светлые пятна по верху кроны.
    c.fillStyle = 'rgba(120,180,140,0.12)';
    c.beginPath();
    c.arc(x + h * 0.05, base - h * 0.78, h * 0.16, Math.PI, Math.PI * 2);
    c.fill();
  }
  for (let x = 40; x < W; x += between(130, 200)) pine(x, H * 0.8 + between(-20, 20), between(240, 320), 'rgba(15,34,24,1)');
  // Земля среднего плана.
  const ground = c.createLinearGradient(0, H * 0.72, 0, H);
  ground.addColorStop(0, 'rgba(10,22,15,0)');
  ground.addColorStop(0.3, 'rgba(10,22,15,0.85)');
  ground.addColorStop(1, 'rgba(6,13,9,1)');
  c.fillStyle = ground;
  c.fillRect(0, H * 0.72, W, H * 0.28);

  // Лучи света сквозь кроны.
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const x of [W * 0.2, W * 0.46, W * 0.7]) {
    const g = c.createLinearGradient(x, 0, x + W * 0.25, H);
    g.addColorStop(0, 'rgba(170,230,170,0.08)');
    g.addColorStop(1, 'rgba(170,230,170,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + W * 0.06, 0);
    c.lineTo(x + W * 0.32, H);
    c.lineTo(x + W * 0.16, H);
    c.closePath();
    c.fill();
  }
  c.restore();

  // Ближний план — толстые стволы по краям, ветки и листва.
  const trunk = (x: number, w: number, lean: number) => {
    c.fillStyle = '#060d09';
    c.beginPath();
    c.moveTo(x - w / 2, H);
    c.lineTo(x + w / 2, H);
    c.lineTo(x + w * 0.35 + lean, 0);
    c.lineTo(x - w * 0.35 + lean, 0);
    c.closePath();
    c.fill();
  };
  trunk(-10, 90, 20);
  trunk(W + 12, 96, -24);
  const leaves = (cx: number, cy: number, n: number, r: number) => {
    c.fillStyle = '#081510';
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.ellipse(cx + between(-r, r), cy + between(-r * 0.5, r * 0.5), between(r * 0.25, r * 0.5), between(r * 0.15, r * 0.3), between(0, Math.PI), 0, Math.PI * 2);
      c.fill();
    }
  };
  leaves(40, 60, 26, 150);
  leaves(W - 40, 110, 26, 160);
  leaves(W * 0.5, -20, 18, 220);
  // Кусты и трава внизу.
  c.fillStyle = '#07110b';
  for (let x = -20; x < W + 20; x += between(40, 70)) {
    c.beginPath();
    c.arc(x, H - between(10, 50), between(40, 80), 0, Math.PI * 2);
    c.fill();
  }

  // Светлячки.
  for (let i = 0; i < 22; i++) {
    const x = between(20, W - 20);
    const y = between(H * 0.25, H * 0.95);
    const r = between(4, 9);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(210,255,170,0.95)');
    g.addColorStop(1, 'rgba(210,255,170,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  // Виньетка — чтобы интерфейс читался, края темнее.
  const v = c.createRadialGradient(W / 2, H * 0.5, W * 0.35, W / 2, H * 0.5, H * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}

/**
 * Поле боя «поляна на опушке»: сверху кромка леса в дымке, ниже трава (тайл tile_grass_01 или заливка),
 * в центре вытоптанная земляная площадка (tile_dirt) с мягким краем — там стоят отряды (y ≈ 55–90% экрана),
 * по краям кусты, камни, цветы; тени крон сверху и виньетка.
 */
function drawMeadow(c: Ctx, W: number, H: number, grass: CanvasImageSource | null, dirt: CanvasImageSource | null): void {
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const horizon = H * 0.36;

  // Небо и дальний лес.
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#7fb0a8');
  sky.addColorStop(1, '#d3e6c6');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 10);
  const crowns = (base: number, color: string, rMin: number, rMax: number, step: number) => {
    c.fillStyle = color;
    for (let x = -30; x < W + 40; x += between(step * 0.7, step * 1.3)) {
      const r = between(rMin, rMax);
      c.beginPath();
      c.arc(x, base - r * 0.6, r, 0, Math.PI * 2);
      c.arc(x + r * 0.6, base - r * 0.3, r * 0.8, 0, Math.PI * 2);
      c.fill();
    }
    c.fillRect(0, base - 4, W, 30);
  };
  crowns(horizon - 70, '#6f9878', 40, 70, 60);
  // Высокие деревья кромки леса: ствол и крона в два тона (свет сверху слева).
  const tall = (x: number, base: number, h: number) => {
    c.fillStyle = '#3a2c1e';
    c.fillRect(x - h * 0.03, base - h * 0.5, h * 0.06, h * 0.5);
    const cy = base - h * 0.68;
    const r = h * 0.2;
    c.fillStyle = '#2e5a3a';
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.arc(x + between(-r, r) * 0.9, cy + between(-r, r) * 0.7, r * between(0.6, 0.9), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(120,175,110,0.55)';
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(x - r * 0.35 + between(-r, r) * 0.4, cy - r * 0.45 + between(-r, r) * 0.3, r * between(0.25, 0.45), 0, Math.PI * 2);
      c.fill();
    }
  };
  for (let x = -20; x < W + 40; x += between(70, 120)) tall(x, horizon - 10 + between(-10, 10), between(170, 260));
  crowns(horizon - 20, '#3f6e4e', 50, 90, 80);
  crowns(horizon + 10, '#2c5639', 60, 100, 95);

  // Трава: тайл или заливка, к горизонту светлее (дымка).
  if (grass) {
    const pat = c.createPattern(grass, 'repeat');
    if (pat) {
      pat.setTransform(new DOMMatrix().scale(0.7));
      c.fillStyle = pat;
      c.fillRect(0, horizon, W, H - horizon);
    }
  } else {
    c.fillStyle = '#4c7a4a';
    c.fillRect(0, horizon, W, H - horizon);
  }
  const haze = c.createLinearGradient(0, horizon, 0, horizon + H * 0.18);
  haze.addColorStop(0, 'rgba(190,215,180,0.55)');
  haze.addColorStop(1, 'rgba(190,215,180,0)');
  c.fillStyle = haze;
  c.fillRect(0, horizon, W, H * 0.18);

  // Тени крон на траве под кромкой леса.
  c.fillStyle = 'rgba(10,30,15,0.25)';
  for (let x = -20; x < W + 20; x += between(60, 110)) {
    c.beginPath();
    c.ellipse(x, horizon + between(15, 40), between(50, 90), between(14, 24), 0, 0, Math.PI * 2);
    c.fill();
  }

  // Вытоптанная площадка: земля с мягким краем (рисуем в отдельный слой и гасим края радиальной маской).
  const cx = W / 2;
  const cy = H * 0.7;
  const rx = W * 0.47;
  const ry = H * 0.21;
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const l = layer.getContext('2d');
  if (l) {
    if (dirt) {
      const pat = l.createPattern(dirt, 'repeat');
      if (pat) {
        pat.setTransform(new DOMMatrix().scale(0.8));
        l.fillStyle = pat;
      }
    } else l.fillStyle = '#8a6a44';
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'destination-in';
    l.save();
    l.translate(cx, cy);
    l.scale(1, ry / rx);
    const m = l.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx);
    m.addColorStop(0, 'rgba(0,0,0,0.85)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = m;
    l.fillRect(-rx, -rx, rx * 2, rx * 2);
    l.restore();
    c.drawImage(layer, 0, 0);
  }

  // Пучки травы, цветы, камни.
  for (let i = 0; i < 70; i++) {
    const x = between(0, W);
    const y = between(horizon + 30, H);
    const inside = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.8;
    if (inside) continue;
    const k = (y - horizon) / (H - horizon);
    c.strokeStyle = 'rgba(30,70,30,0.8)';
    c.lineWidth = 1.5 + k * 1.5;
    for (let j = 0; j < 5; j++) {
      c.beginPath();
      c.moveTo(x + j * 3, y);
      c.lineTo(x + j * 3 + between(-6, 6), y - (8 + k * 14));
      c.stroke();
    }
  }
  const flowers = ['#f3e27a', '#f0f0e8', '#e8a0c8', '#9fc7ff'];
  for (let i = 0; i < 60; i++) {
    const x = between(0, W);
    const y = between(horizon + 40, H);
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.9) continue;
    const k = (y - horizon) / (H - horizon);
    c.fillStyle = flowers[i % flowers.length];
    c.beginPath();
    c.arc(x, y, 1.5 + k * 2.5, 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 9; i++) {
    const x = rnd() < 0.5 ? between(10, W * 0.18) : between(W * 0.82, W - 10);
    const y = between(H * 0.5, H * 0.95);
    const r = between(10, 22);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(x + 3, y + r * 0.5, r, r * 0.35, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8e948a';
    c.beginPath();
    c.ellipse(x, y, r, r * 0.65, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.beginPath();
    c.ellipse(x - r * 0.3, y - r * 0.25, r * 0.45, r * 0.25, 0, 0, Math.PI * 2);
    c.fill();
  }
  // Кусты по бокам.
  const bush = (x: number, y: number, r: number) => {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(x, y + r * 0.6, r * 1.3, r * 0.35, 0, 0, Math.PI * 2);
    c.fill();
    for (const [dx, dy, f, col] of [[-0.6, 0.1, 0.8, '#2d5a32'], [0.6, 0.15, 0.75, '#2d5a32'], [0, -0.2, 1, '#3a6e3c'], [-0.2, -0.45, 0.55, '#4f8a4c']] as const) {
      c.fillStyle = col;
      c.beginPath();
      c.arc(x + dx * r, y + dy * r, r * f, 0, Math.PI * 2);
      c.fill();
    }
  };
  bush(30, H * 0.52, 55);
  bush(W - 25, H * 0.58, 60);
  bush(10, H * 0.93, 80);
  bush(W - 5, H * 0.97, 85);

  // Виньетка: края и низ темнее, центр поляны светлый.
  const v = c.createRadialGradient(W / 2, H * 0.62, W * 0.4, W / 2, H * 0.62, H * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,15,5,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}
