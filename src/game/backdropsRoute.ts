/**
 * Временные нарисованные фоны слотов маршрута из 10 глав (docs/design/lore-route.md §0): канализация Пронтеры (глава 2),
 * орочья деревня (глава 3), часовая башня Альдебарана (глава 7). Держатся, пока владелец не положит файлы
 * assets/backgrounds/bg_battle_ch<N>.jpg / bg_map_ch<N>.jpg (N — номер главы на маршруте, backdrops.ts).
 * Правила те же, что в backdropsExtra.ts: Canvas 2D, свой seed, центр поля боя (y ≈ 47–96 %) спокойный — детали по краям.
 */
import { boulder, clearing, dryBush, fogBlob, glow, grain, ridge, rng, stars, tileFill, vignette, type Ctx, type Rng } from './backdropsExtra';

/** Кирпичная кладка (ряды со сдвигом), тёмные швы. */
function bricks(c: Ctx, r: Rng, x0: number, y0: number, w: number, h: number, bw: number, bh: number, tones: string[], seam = '#0d0f0e'): void {
  c.save();
  c.beginPath();
  c.rect(x0, y0, w, h);
  c.clip();
  c.fillStyle = seam;
  c.fillRect(x0, y0, w, h);
  for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
    for (let x = x0 - (row % 2 ? bw / 2 : 0); x < x0 + w; x += bw) {
      c.fillStyle = tones[Math.floor(r.rnd() * tones.length)];
      c.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
  }
  c.restore();
}

/** Тёмная арка-проём (устье стока, дверь). */
function archway(c: Ctx, x: number, bottom: number, w: number, h: number, rim: string): void {
  c.fillStyle = '#050706';
  c.beginPath();
  c.moveTo(x - w / 2, bottom);
  c.lineTo(x - w / 2, bottom - h + w / 2);
  c.arc(x, bottom - h + w / 2, w / 2, Math.PI, Math.PI * 2);
  c.lineTo(x + w / 2, bottom);
  c.closePath();
  c.fill();
  c.strokeStyle = rim;
  c.lineWidth = 10;
  c.stroke();
}

/** Решётка стока. */
function grate(c: Ctx, x: number, y: number, w: number, h: number): void {
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillRect(x - w / 2, y - h / 2, w, h);
  c.strokeStyle = '#5b5e58';
  c.lineWidth = 4;
  c.strokeRect(x - w / 2, y - h / 2, w, h);
  for (let i = 1; i < 5; i++) {
    c.beginPath();
    c.moveTo(x - w / 2 + (w * i) / 5, y - h / 2);
    c.lineTo(x - w / 2 + (w * i) / 5, y + h / 2);
    c.stroke();
  }
}

/** Труба из стены с капающей струйкой. */
function pipe(c: Ctx, x: number, y: number, s: number, dir: number): void {
  c.fillStyle = '#4a4f47';
  c.fillRect(x - s * 0.5, y - s * 0.35, s, s * 0.7);
  c.fillStyle = '#2a2d28';
  c.beginPath();
  c.ellipse(x + dir * s * 0.5, y, s * 0.18, s * 0.35, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(120,170,140,0.45)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x + dir * s * 0.55, y + s * 0.2);
  c.quadraticCurveTo(x + dir * s * 0.9, y + s * 0.6, x + dir * s * 0.95, y + s * 1.6);
  c.stroke();
}

/** Поле боя «канализация Пронтеры»: кирпичная стена с устьями стоков, канал с зелёной водой, мокрые плиты, решётки. */
export function drawSewerField(c: Ctx, W: number, H: number, stone: CanvasImageSource | null): void {
  const r = rng(211);
  const wallBottom = H * 0.3;
  bricks(c, r, 0, 0, W, wallBottom, 58, 28, ['#3a3f38', '#343930', '#40463c', '#2f342c']);
  archway(c, W * 0.22, wallBottom, 150, 200, '#50554b');
  archway(c, W * 0.78, wallBottom, 150, 200, '#50554b');
  archway(c, W * 0.5, wallBottom, 110, 150, '#50554b');
  for (const [x, dir] of [[W * 0.36, 1], [W * 0.64, -1]] as const) pipe(c, x, wallBottom * 0.45, 40, dir);
  // Мох и потёки на стене.
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(70,110,60,${r.between(0.15, 0.35)})`;
    c.fillRect(r.between(0, W), r.between(wallBottom * 0.5, wallBottom), r.between(4, 10), r.between(10, 40));
  }
  // Канал вдоль стены: зелёная вода с бликами.
  const chTop = wallBottom;
  const chBottom = wallBottom + H * 0.08;
  const water = c.createLinearGradient(0, chTop, 0, chBottom);
  water.addColorStop(0, '#1d3a2c');
  water.addColorStop(1, '#2d5540');
  c.fillStyle = water;
  c.fillRect(0, chTop, W, chBottom - chTop);
  c.strokeStyle = 'rgba(170,230,190,0.18)';
  c.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const x = r.between(0, W);
    const y = r.between(chTop + 6, chBottom - 6);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + r.between(20, 60), y);
    c.stroke();
  }
  // Кромка канала.
  c.fillStyle = '#5a5e55';
  c.fillRect(0, chBottom, W, 12);
  // Пол: мокрые плиты.
  tileFill(c, stone, '#4a4e48', 0.85, 0, chBottom + 12, W, H - chBottom);
  c.fillStyle = 'rgba(30,40,34,0.62)';
  c.fillRect(0, chBottom + 12, W, H - chBottom);
  const shade = c.createLinearGradient(0, chBottom, 0, chBottom + 100);
  shade.addColorStop(0, 'rgba(0,0,0,0.6)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = shade;
  c.fillRect(0, chBottom, W, 100);
  clearing(c, W / 2, H * 0.71, W * 0.46, H * 0.2, 'rgba(150,170,150,A)', 0.14);
  // Лужи и решётки — по краям.
  for (const [x, y, rx] of [[W * 0.08, H * 0.6, 60], [W * 0.92, H * 0.72, 70], [W * 0.1, H * 0.93, 80], [W * 0.88, H * 0.98, 60]] as const) {
    c.fillStyle = 'rgba(40,80,60,0.55)';
    c.beginPath();
    c.ellipse(x, y, rx, rx * 0.3, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(170,230,190,0.2)';
    c.lineWidth = 2;
    c.stroke();
  }
  grate(c, W * 0.12, H * 0.78, 70, 40);
  grate(c, W * 0.88, H * 0.86, 70, 40);
  // Бочка и ящик у стены.
  c.fillStyle = '#5a3e22';
  c.fillRect(W * 0.02, chBottom + 30, 50, 44);
  c.strokeStyle = '#2a1c0e';
  c.lineWidth = 3;
  c.strokeRect(W * 0.02, chBottom + 30, 50, 44);
  glow(c, W / 2, H * 0.1, W * 0.5, 'rgba(160,220,170,A)', 0.08);
  vignette(c, W, H, H * 0.66, W * 0.32, H * 0.7, 'rgba(0,6,2,0.78)');
}

/** Карта «канализация»: тоннель стоков уходит вглубь, по центру — канал с водой, лампы-огоньки по стенам. */
export function drawSewerMap(c: Ctx, W: number, H: number): void {
  const r = rng(223);
  bricks(c, r, 0, 0, W, H, 66, 32, ['#2c312a', '#262a24', '#30352d', '#23271f']);
  for (let i = 0; i < 5; i++) {
    const k = 1 - i * 0.17;
    const w = W * 0.92 * k;
    const top = H * 0.1 + i * H * 0.05;
    const bottom = H * 0.92 - i * H * 0.07;
    c.strokeStyle = `rgba(90,100,84,${0.8 - i * 0.12})`;
    c.lineWidth = 18 * k;
    c.beginPath();
    c.moveTo(W / 2 - w / 2, bottom);
    c.lineTo(W / 2 - w / 2, top + w / 2);
    c.arc(W / 2, top + w / 2, w / 2, Math.PI, Math.PI * 2);
    c.lineTo(W / 2 + w / 2, bottom);
    c.stroke();
    c.fillStyle = `rgba(0,0,0,${0.18 + i * 0.05})`;
    c.fill();
  }
  // Канал по центру — клин воды вглубь.
  const water = c.createLinearGradient(0, H * 0.5, 0, H);
  water.addColorStop(0, 'rgba(40,80,60,0.5)');
  water.addColorStop(1, 'rgba(50,100,72,0.85)');
  c.fillStyle = water;
  c.beginPath();
  c.moveTo(W * 0.46, H * 0.5);
  c.lineTo(W * 0.54, H * 0.5);
  c.lineTo(W * 0.72, H);
  c.lineTo(W * 0.28, H);
  c.closePath();
  c.fill();
  glow(c, W / 2, H * 0.42, W * 0.3, 'rgba(150,220,170,A)', 0.12);
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.2;
    const y = H * 0.6 - i * H * 0.1;
    glow(c, W / 2 - W * 0.42 * k, y, 30 * k, 'rgba(255,210,140,A)', 0.5);
    glow(c, W / 2 + W * 0.42 * k, y, 30 * k, 'rgba(255,210,140,A)', 0.5);
  }
  for (let i = 0; i < 30; i++) glow(c, r.between(0, W), r.between(0, H), r.between(2, 4), 'rgba(190,240,190,A)', 0.5);
  vignette(c, W, H, H * 0.5, W * 0.3, H * 0.7, 'rgba(0,4,0,0.7)');
}

/** Остроконечная хижина орков: шкуры на кольях, чёрный вход. */
function orcHut(c: Ctx, x: number, base: number, w: number, h: number, hide: string, dark: string): void {
  c.fillStyle = hide;
  c.beginPath();
  c.moveTo(x - w / 2, base);
  c.lineTo(x, base - h);
  c.lineTo(x + w / 2, base);
  c.closePath();
  c.fill();
  c.fillStyle = dark;
  c.beginPath();
  c.moveTo(x - w * 0.12, base);
  c.lineTo(x, base - h * 0.35);
  c.lineTo(x + w * 0.12, base);
  c.closePath();
  c.fill();
  c.strokeStyle = '#3a2410';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x - w * 0.08, base - h - 14);
  c.lineTo(x + w * 0.06, base - h + 10);
  c.moveTo(x + w * 0.08, base - h - 14);
  c.lineTo(x - w * 0.06, base - h + 10);
  c.stroke();
}

/** Частокол из заострённых брёвен. */
function palisade(c: Ctx, r: Rng, x0: number, x1: number, base: number, h: number, color: string): void {
  c.fillStyle = color;
  for (let x = x0; x < x1; x += r.between(14, 20)) {
    const hh = h * r.between(0.85, 1.1);
    c.beginPath();
    c.moveTo(x, base);
    c.lineTo(x, base - hh + 10);
    c.lineTo(x + 7, base - hh);
    c.lineTo(x + 14, base - hh + 10);
    c.lineTo(x + 14, base);
    c.closePath();
    c.fill();
  }
}

/** Тотем с черепом на шесте. */
function totem(c: Ctx, x: number, base: number, h: number): void {
  c.fillStyle = '#4a2e16';
  c.fillRect(x - 4, base - h, 8, h);
  c.fillStyle = '#d8ceb0';
  c.beginPath();
  c.ellipse(x, base - h - 10, 14, 12, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1a120a';
  c.fillRect(x - 8, base - h - 12, 5, 5);
  c.fillRect(x + 3, base - h - 12, 5, 5);
  c.strokeStyle = '#d8ceb0';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(x - 12, base - h - 18);
  c.quadraticCurveTo(x - 26, base - h - 34, x - 20, base - h - 44);
  c.moveTo(x + 12, base - h - 18);
  c.quadraticCurveTo(x + 26, base - h - 34, x + 20, base - h - 44);
  c.stroke();
}

/** Костёр (угли и свет). */
function campfire(c: Ctx, x: number, y: number, s: number): void {
  glow(c, x, y - s, s * 4, 'rgba(255,150,60,A)', 0.35);
  c.fillStyle = '#2a1a0c';
  c.fillRect(x - s, y - 4, s * 2, 8);
  c.fillStyle = '#ff9a3a';
  c.beginPath();
  c.moveTo(x - s * 0.6, y);
  c.quadraticCurveTo(x, y - s * 2.2, x + s * 0.6, y);
  c.closePath();
  c.fill();
  c.fillStyle = '#ffe08a';
  c.beginPath();
  c.moveTo(x - s * 0.3, y);
  c.quadraticCurveTo(x, y - s * 1.2, x + s * 0.3, y);
  c.closePath();
  c.fill();
}

/** Поле боя «орочья деревня»: закатное небо, холмы, частокол и хижины на горизонте, вытоптанная земля, тотемы. */
export function drawOrcField(c: Ctx, W: number, H: number, grass: CanvasImageSource | null): void {
  const r = rng(233);
  const horizon = H * 0.36;
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#3a2a4a');
  sky.addColorStop(0.55, '#b4603a');
  sky.addColorStop(1, '#e8a060');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 10);
  glow(c, W * 0.7, horizon - 20, 120, 'rgba(255,200,120,A)', 0.5);
  const h1 = c.createLinearGradient(0, horizon - 80, 0, horizon);
  h1.addColorStop(0, '#5a4a3a');
  h1.addColorStop(1, '#3a3024');
  ridge(c, r, W, horizon - 50, 22, horizon + 20, h1);
  palisade(c, r, 0, W * 0.34, horizon + 6, 60, '#3a2616');
  palisade(c, r, W * 0.66, W, horizon + 6, 60, '#3a2616');
  orcHut(c, W * 0.44, horizon + 4, 110, 90, '#7a5634', '#1a1008');
  orcHut(c, W * 0.58, horizon + 2, 80, 64, '#6a4a2c', '#1a1008');
  fogBlob(c, W / 2, horizon, W, 50, 'rgba(220,150,90,A)', 0.3);
  // Земля: сухая трава, в центре вытоптано.
  tileFill(c, grass, '#6a6a3a', 0.8, 0, horizon + 10, W, H - horizon);
  c.fillStyle = 'rgba(90,70,40,0.55)';
  c.fillRect(0, horizon + 10, W, H - horizon);
  grain(c, r, 0, horizon + 10, W, H - horizon, 1600, ['rgba(220,190,120,0.18)', 'rgba(40,28,12,0.25)'], 2);
  clearing(c, W / 2, H * 0.71, W * 0.48, H * 0.21, 'rgba(170,130,80,A)', 0.35);
  // Края: тотемы, валуны, кусты, костры.
  totem(c, W * 0.07, H * 0.62, 150);
  totem(c, W * 0.93, H * 0.7, 160);
  campfire(c, W * 0.1, H * 0.9, 18);
  campfire(c, W * 0.9, H * 0.52, 14);
  for (const [x, y, s] of [[W * 0.05, H * 0.76, 34], [W * 0.95, H * 0.88, 40], [W * 0.2, horizon + 50, 18], [W * 0.78, horizon + 60, 16]] as const) boulder(c, r, x, y, s, '#8a7a60', '#3a3024');
  for (const [x, y, s] of [[W * 0.04, H * 0.5, 26], [W * 0.96, H * 0.6, 28], [W * 0.15, H * 0.98, 24], [W * 0.85, H * 0.99, 26]] as const) dryBush(c, r, x, y, s);
  vignette(c, W, H, H * 0.64, W * 0.36, H * 0.74, 'rgba(30,12,4,0.6)');
}

/** Карта «орочья деревня»: закат, дальние горы, деревня хижин за частоколом, дорога-земля вниз. */
export function drawOrcMap(c: Ctx, W: number, H: number): void {
  const r = rng(239);
  const sky = c.createLinearGradient(0, 0, 0, H * 0.5);
  sky.addColorStop(0, '#2a2038');
  sky.addColorStop(0.6, '#a0583a');
  sky.addColorStop(1, '#d89058');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  stars(c, r, W, H * 0.12, 30);
  ridge(c, r, W, H * 0.3, 40, H * 0.5, '#4a3a40', 0.8);
  ridge(c, r, W, H * 0.4, 30, H * 0.6, '#3a2e26');
  palisade(c, r, 0, W, H * 0.48, 70, '#2a1a0e');
  for (let i = 0; i < 6; i++) orcHut(c, W * (0.1 + i * 0.16) + r.between(-20, 20), H * 0.46 + r.between(-10, 10), r.between(80, 120), r.between(60, 90), '#6a4a2c', '#140c06');
  const g = c.createLinearGradient(0, H * 0.48, 0, H);
  g.addColorStop(0, '#5a4628');
  g.addColorStop(1, '#2a2012');
  c.fillStyle = g;
  c.fillRect(0, H * 0.48, W, H * 0.52);
  grain(c, r, 0, H * 0.48, W, H * 0.52, 1400, ['rgba(220,180,110,0.15)', 'rgba(20,12,4,0.3)'], 2);
  for (let i = 0; i < 6; i++) campfire(c, r.rnd() < 0.5 ? r.between(30, W * 0.2) : r.between(W * 0.8, W - 30), r.between(H * 0.55, H * 0.97), r.between(10, 16));
  totem(c, W * 0.06, H * 0.8, 170);
  totem(c, W * 0.94, H * 0.7, 150);
  vignette(c, W, H, H * 0.55, W * 0.32, H * 0.72, 'rgba(20,8,2,0.6)');
}

/** Шестерня: зубчатое колесо с ободом и спицами. */
function gear(c: Ctx, x: number, y: number, rad: number, teeth: number, color: string, rim: string, rot = 0): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? rad : rad * 1.14;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  c.strokeStyle = rim;
  c.lineWidth = Math.max(2, rad * 0.08);
  c.beginPath();
  c.arc(0, 0, rad * 0.78, 0, Math.PI * 2);
  c.stroke();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * rad * 0.2, Math.sin(a) * rad * 0.2);
    c.lineTo(Math.cos(a) * rad * 0.78, Math.sin(a) * rad * 0.78);
    c.stroke();
  }
  c.fillStyle = rim;
  c.beginPath();
  c.arc(0, 0, rad * 0.2, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Циферблат с римскими метками-чёрточками и стрелками (стоят на 3:13 — час падения Гласт Хейма). */
function clockFace(c: Ctx, x: number, y: number, rad: number): void {
  glow(c, x, y, rad * 1.5, 'rgba(255,220,150,A)', 0.2);
  c.fillStyle = '#e8dcb8';
  c.beginPath();
  c.arc(x, y, rad, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#7a5a2a';
  c.lineWidth = rad * 0.08;
  c.stroke();
  c.strokeStyle = '#3a2a14';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.lineWidth = i % 3 ? 3 : 6;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * rad * 0.78, y + Math.sin(a) * rad * 0.78);
    c.lineTo(x + Math.cos(a) * rad * 0.9, y + Math.sin(a) * rad * 0.9);
    c.stroke();
  }
  const hand = (a: number, len: number, w: number) => {
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a - Math.PI / 2) * len, y + Math.sin(a - Math.PI / 2) * len);
    c.stroke();
  };
  hand(((3 + 13 / 60) / 12) * Math.PI * 2, rad * 0.5, 6);
  hand((13 / 60) * Math.PI * 2, rad * 0.75, 4);
}

/** Поле боя «часовая башня»: стена с большим циферблатом и шестернями, латунные балки, дощатый пол. */
export function drawClockField(c: Ctx, W: number, H: number, floor: CanvasImageSource | null): void {
  const r = rng(251);
  const wallBottom = H * 0.36;
  bricks(c, r, 0, 0, W, wallBottom, 60, 30, ['#4a3e36', '#443830', '#52453a', '#3e332c'], '#1a140f');
  gear(c, W * 0.08, wallBottom * 0.55, 90, 14, '#6a5230', '#a07e44', 0.2);
  gear(c, W * 0.92, wallBottom * 0.4, 110, 16, '#6a5230', '#a07e44', 0.5);
  gear(c, W * 0.86, wallBottom * 0.92, 50, 10, '#7a6038', '#b08a4a', 0.1);
  clockFace(c, W / 2, wallBottom * 0.48, 120);
  // Латунная балка под стеной.
  const beam = c.createLinearGradient(0, wallBottom - 18, 0, wallBottom + 6);
  beam.addColorStop(0, '#c09a50');
  beam.addColorStop(1, '#6a5028');
  c.fillStyle = beam;
  c.fillRect(0, wallBottom - 18, W, 24);
  // Пол: доски.
  tileFill(c, floor, '#6a4e32', 0.9, 0, wallBottom + 6, W, H - wallBottom);
  c.fillStyle = 'rgba(70,46,26,0.55)';
  c.fillRect(0, wallBottom + 6, W, H - wallBottom);
  c.strokeStyle = 'rgba(20,12,6,0.35)';
  c.lineWidth = 2;
  for (let y = wallBottom + 40; y < H; y += 46) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y);
    c.stroke();
  }
  const shade = c.createLinearGradient(0, wallBottom, 0, wallBottom + 110);
  shade.addColorStop(0, 'rgba(0,0,0,0.6)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = shade;
  c.fillRect(0, wallBottom, W, 110);
  clearing(c, W / 2, H * 0.71, W * 0.46, H * 0.2, 'rgba(255,210,150,A)', 0.12);
  // Шестерни, упавшие на пол по краям, и лампы.
  gear(c, W * 0.05, H * 0.84, 44, 10, '#5a4428', '#906c3a', 0.3);
  gear(c, W * 0.95, H * 0.66, 38, 9, '#5a4428', '#906c3a', 0.7);
  gear(c, W * 0.92, H * 0.97, 52, 12, '#5a4428', '#906c3a', 0.1);
  for (const [x, y] of [[W * 0.24, wallBottom - 60], [W * 0.76, wallBottom - 60]] as const) {
    glow(c, x, y, 70, 'rgba(255,200,120,A)', 0.45);
    c.fillStyle = '#ffe0a0';
    c.fillRect(x - 6, y - 10, 12, 20);
  }
  // Пыль в луче.
  for (let i = 0; i < 30; i++) glow(c, r.between(W * 0.3, W * 0.7), r.between(0, H * 0.6), r.between(2, 4), 'rgba(255,230,180,A)', 0.5);
  vignette(c, W, H, H * 0.64, W * 0.32, H * 0.72, 'rgba(18,8,2,0.72)');
}

/** Карта «часовая башня»: шахта башни с шестернями по стенам, огромный циферблат наверху, лестница вниз. */
export function drawClockMap(c: Ctx, W: number, H: number): void {
  const r = rng(257);
  bricks(c, r, 0, 0, W, H, 64, 32, ['#3a302a', '#342a24', '#40352e', '#2e2620'], '#140f0b');
  clockFace(c, W / 2, H * 0.16, 170);
  for (let i = 0; i < 9; i++) {
    const left = i % 2 === 0;
    gear(c, left ? r.between(0, W * 0.18) : r.between(W * 0.82, W), H * (0.3 + i * 0.075), r.between(50, 110), Math.round(r.between(9, 16)), '#5e4a2c', '#9a7842', r.between(0, 1));
  }
  // Маятник и цепи по центру.
  c.strokeStyle = 'rgba(190,150,80,0.6)';
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(W / 2, H * 0.3);
  c.lineTo(W / 2 + 40, H * 0.62);
  c.stroke();
  c.fillStyle = '#b08a4a';
  c.beginPath();
  c.arc(W / 2 + 40, H * 0.62, 30, 0, Math.PI * 2);
  c.fill();
  glow(c, W / 2, H * 0.5, W * 0.35, 'rgba(255,200,130,A)', 0.1);
  for (let i = 0; i < 24; i++) glow(c, r.between(0, W), r.between(0, H), r.between(2, 4), 'rgba(255,225,170,A)', 0.5);
  vignette(c, W, H, H * 0.5, W * 0.3, H * 0.7, 'rgba(10,4,0,0.7)');
}
