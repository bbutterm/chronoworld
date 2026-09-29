/**
 * Рисование фонов глав 4–7 (пустыня, ночной лес, затонувший корабль, Нифльхейм) и общие кисти для backdrops.ts.
 * Без Phaser: только Canvas 2D. Всё детерминированно (свой seed на каждый фон) — фон одинаков при каждом запуске.
 * Поле боя: небо/даль до горизонта (≈ 36 % высоты), ниже земля; центр по y ≈ 47–96 % спокойный — там стоят бойцы,
 * детали — по краям. Карта кампании: атмосфера без мелочи в середине — поверх рисуется дорожка этапов.
 */

export type Ctx = CanvasRenderingContext2D;
export type Rng = ReturnType<typeof rng>;

export function rng(seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return { rnd, between: (a: number, b: number) => a + rnd() * (b - a) };
}

/** Заливка тайлом (или цветом, если тайла нет) с масштабом. */
export function tileFill(c: Ctx, tile: CanvasImageSource | null, fallback: string, scale: number, x: number, y: number, w: number, h: number): void {
  const pat = tile ? c.createPattern(tile, 'repeat') : null;
  if (pat) {
    pat.setTransform(new DOMMatrix().scale(scale));
    c.fillStyle = pat;
  } else c.fillStyle = fallback;
  c.fillRect(x, y, w, h);
}

/** Радиальная виньетка: края темнее цветом color. */
export function vignette(c: Ctx, W: number, H: number, cy: number, inner: number, outer: number, color: string): void {
  const v = c.createRadialGradient(W / 2, cy, inner, W / 2, cy, outer);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, color);
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}

/** Мягкое световое пятно (composite 'lighter'). color — строка rgba с буквой A на месте альфы. */
export function glow(c: Ctx, x: number, y: number, r: number, color: string, a: number): void {
  c.save();
  c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('A', String(a)));
  g.addColorStop(1, color.replace('A', '0'));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
}

/** Мягкое пятно тумана (эллипс с градиентом). */
export function fogBlob(c: Ctx, x: number, y: number, rx: number, ry: number, color: string, a: number): void {
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, color.replace('A', String(a)));
  g.addColorStop(1, color.replace('A', '0'));
  c.fillStyle = g;
  c.fillRect(-rx, -rx, rx * 2, rx * 2);
  c.restore();
}

/** Сухое дерево: ствол и ветвящиеся голые сучья (moss — свисающий мох). */
export function deadTree(c: Ctx, r: Rng, x: number, base: number, h: number, color: string, moss?: string): void {
  c.strokeStyle = color;
  c.lineCap = 'round';
  const branch = (x0: number, y0: number, len: number, ang: number, w: number, depth: number) => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo((x0 + x1) / 2 + r.between(-len, len) * 0.15, (y0 + y1) / 2, x1, y1);
    c.stroke();
    if (moss && depth <= 2 && r.rnd() < 0.6) {
      c.save();
      c.strokeStyle = moss;
      c.lineWidth = Math.max(1, w * 0.4);
      const ml = r.between(12, 40);
      c.beginPath();
      c.moveTo(x1, y1);
      c.bezierCurveTo(x1 + 3, y1 + ml * 0.3, x1 - 3, y1 + ml * 0.6, x1 + 1, y1 + ml);
      c.stroke();
      c.restore();
    }
    if (depth <= 0 || w < 1) return;
    const n = depth > 2 ? 2 : r.rnd() < 0.5 ? 2 : 3;
    for (let i = 0; i < n; i++) branch(x1, y1, len * r.between(0.55, 0.8), ang + r.between(-0.75, 0.75), w * 0.62, depth - 1);
  };
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x - h * 0.05, base);
  c.lineTo(x + h * 0.05, base);
  c.lineTo(x + h * 0.012, base - h * 0.55);
  c.lineTo(x - h * 0.012, base - h * 0.55);
  c.closePath();
  c.fill();
  branch(x, base - h * 0.5, h * 0.3, -Math.PI / 2 + r.between(-0.3, 0.3), h * 0.022, 4);
  branch(x, base - h * 0.35, h * 0.22, -Math.PI / 2 - r.between(0.5, 1.1), h * 0.014, 3);
  branch(x, base - h * 0.42, h * 0.22, -Math.PI / 2 + r.between(0.5, 1.1), h * 0.014, 3);
}

// ---------------------------------------------------------------------------------------------------------------
// Общие мелкие кисти новых тем.
// ---------------------------------------------------------------------------------------------------------------

/** Зерно/шум: n мелких точек цветами colors в прямоугольнике. */
export function grain(c: Ctx, r: Rng, x0: number, y0: number, w: number, h: number, n: number, colors: string[], size = 2): void {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[Math.floor(r.rnd() * colors.length)];
    const s = r.between(size * 0.5, size * 1.5);
    c.fillRect(r.between(x0, x0 + w), r.between(y0, y0 + h), s, s);
  }
}

/** Мягкая «площадка» в центре поля: пятно цвета color с растушёванным краем (как вытоптанная земля у луга). */
export function clearing(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, a: number): void {
  c.save();
  c.translate(cx, cy);
  c.scale(1, ry / rx);
  const m = c.createRadialGradient(0, 0, rx * 0.35, 0, 0, rx);
  m.addColorStop(0, color.replace('A', String(a)));
  m.addColorStop(1, color.replace('A', '0'));
  c.fillStyle = m;
  c.fillRect(-rx, -rx, rx * 2, rx * 2);
  c.restore();
}

/** Гряда: волнистая линия (сумма синусов) от y ≈ base, залитая вниз до bottom. Возвращает точки гребня. */
export function ridge(c: Ctx, r: Rng, W: number, base: number, amp: number, bottom: number, fill: string | CanvasGradient, freq = 1): Array<[number, number]> {
  const p1 = r.between(0, Math.PI * 2);
  const p2 = r.between(0, Math.PI * 2);
  const f1 = r.between(1.2, 2.2) * freq;
  const f2 = r.between(3, 5) * freq;
  const pts: Array<[number, number]> = [];
  for (let x = -20; x <= W + 20; x += 10) {
    const t = x / W;
    pts.push([x, base - amp * (0.65 * Math.sin(t * Math.PI * f1 + p1) + 0.35 * Math.sin(t * Math.PI * f2 + p2))]);
  }
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(-20, bottom);
  for (const [x, y] of pts) c.lineTo(x, y);
  c.lineTo(W + 20, bottom);
  c.closePath();
  c.fill();
  return pts;
}

/** Светлая кромка по гребню гряды (свет сверху). */
function crest(c: Ctx, pts: Array<[number, number]>, color: string, w: number): void {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineJoin = 'round';
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y + w / 2) : c.moveTo(x, y + w / 2)));
  c.stroke();
}

/** Звёзды: точки разной яркости в верхней полосе. */
export function stars(c: Ctx, r: Rng, W: number, h: number, n: number, color = '255,250,235'): void {
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(${color},${r.between(0.25, 0.9)})`;
    const s = r.rnd() < 0.1 ? 2.5 : r.between(1, 1.8);
    c.fillRect(r.between(0, W), r.between(0, h), s, s);
  }
}

/** Луна/солнце: светлый диск с ореолом. */
function orb(c: Ctx, x: number, y: number, rad: number, core: string, halo: string, haloA: number): void {
  glow(c, x, y, rad * 7, halo, haloA * 0.5);
  glow(c, x, y, rad * 2.6, halo, haloA);
  c.fillStyle = core;
  c.beginPath();
  c.arc(x, y, rad, 0, Math.PI * 2);
  c.fill();
}

/** Лучи света сверху (сквозь воду/облака): трапеции с затуханием вниз. */
function rays(c: Ctx, r: Rng, W: number, top: number, bottom: number, n: number, color: string, a: number): void {
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = r.between(-W * 0.1, W * 1.1);
    const w0 = r.between(14, 50);
    const w1 = w0 * r.between(2.5, 4);
    const lean = r.between(-0.25, 0.1) * (bottom - top);
    const g = c.createLinearGradient(0, top, 0, bottom);
    const aa = a * r.between(0.5, 1);
    g.addColorStop(0, color.replace('A', String(aa)));
    g.addColorStop(1, color.replace('A', '0'));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - w0 / 2, top);
    c.lineTo(x + w0 / 2, top);
    c.lineTo(x + lean + w1 / 2, bottom);
    c.lineTo(x + lean - w1 / 2, bottom);
    c.closePath();
    c.fill();
  }
  c.restore();
}

/** Солнце: ореол обычным наложением (на голубом небе 'lighter' даёт лиловое кольцо) и светлый диск. */
function sun(c: Ctx, x: number, y: number, rad: number, halo: string): void {
  for (const [rr, a] of [[rad * 8, 0.35], [rad * 3, 0.55]] as const) {
    const g = c.createRadialGradient(x, y, rad * 0.8, x, y, rr);
    g.addColorStop(0, halo.replace('A', String(a)));
    g.addColorStop(1, halo.replace('A', '0'));
    c.fillStyle = g;
    c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  c.fillStyle = '#fffaea';
  c.beginPath();
  c.arc(x, y, rad, 0, Math.PI * 2);
  c.fill();
}

/** Тень-эллипс под предметом. */
export function shadow(c: Ctx, x: number, y: number, rx: number, ry: number, a = 0.3): void {
  c.fillStyle = `rgba(0,0,0,${a})`;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

/** Валун: неровный многоугольник, светлый верх, тёмный низ. */
export function boulder(c: Ctx, r: Rng, x: number, y: number, s: number, light: string, dark: string): void {
  shadow(c, x + s * 0.1, y + 2, s * 1.1, s * 0.3);
  const n = 8;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    const rr = s * r.between(0.75, 1.05);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]);
  }
  const g = c.createLinearGradient(0, y - s * 0.8, 0, y);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x - s, y);
  for (const [px, py] of pts) c.lineTo(px, py);
  c.lineTo(x + s, y);
  c.closePath();
  c.fill();
}

// ---------------------------------------------------------------------------------------------------------------
// Глава 4 — «Пески Сограта»: пустыня.
// ---------------------------------------------------------------------------------------------------------------

/** Пирамида: светлая грань к солнцу (справа), тень слева, ступени-строчки. */
function pyramid(c: Ctx, x: number, base: number, w: number, h: number, lit: string, shade: string): void {
  c.fillStyle = shade;
  c.beginPath();
  c.moveTo(x - w / 2, base);
  c.lineTo(x, base - h);
  c.lineTo(x + w * 0.1, base);
  c.closePath();
  c.fill();
  c.fillStyle = lit;
  c.beginPath();
  c.moveTo(x + w * 0.1, base);
  c.lineTo(x, base - h);
  c.lineTo(x + w / 2, base);
  c.closePath();
  c.fill();
  // Ступени кладки.
  c.save();
  c.beginPath();
  c.moveTo(x - w / 2, base);
  c.lineTo(x, base - h);
  c.lineTo(x + w / 2, base);
  c.closePath();
  c.clip();
  c.strokeStyle = 'rgba(80,40,10,0.18)';
  c.lineWidth = 1;
  for (let y = base - 6; y > base - h; y -= 7) {
    c.beginPath();
    c.moveTo(x - w / 2, y);
    c.lineTo(x + w / 2, y);
    c.stroke();
  }
  c.restore();
}

/** Финиковая пальма: изогнутый ствол кольцами и веер листьев. */
function palm(c: Ctx, r: Rng, x: number, base: number, h: number, lean: number, trunk: string, leaf: string): void {
  const tx = x + lean;
  const ty = base - h;
  c.strokeStyle = trunk;
  c.lineCap = 'round';
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const px = (t: number) => x + lean * t * t;
    const py = (t: number) => base - h * t;
    c.lineWidth = h * (0.07 - 0.03 * t0);
    c.beginPath();
    c.moveTo(px(t0), py(t0));
    c.lineTo(px(t1), py(t1) + 1);
    c.stroke();
  }
  // Листья: дуги с перистой кромкой.
  c.fillStyle = leaf;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.55 + r.between(-0.1, 0.1);
    const len = h * r.between(0.4, 0.55);
    const ex = tx + Math.cos(a) * len;
    const ey = ty + Math.sin(a) * len * 0.6 + len * 0.35;
    const mx = tx + Math.cos(a) * len * 0.5;
    const my = ty + Math.sin(a) * len * 0.5 - len * 0.05;
    c.beginPath();
    c.moveTo(tx, ty);
    c.quadraticCurveTo(mx, my - len * 0.12, ex, ey);
    c.quadraticCurveTo(mx, my + len * 0.08, tx, ty);
    c.fill();
  }
  c.fillStyle = '#4a2e14';
  c.beginPath();
  c.arc(tx, ty + 4, h * 0.035, 0, Math.PI * 2);
  c.fill();
}

/** Колючий куст пустыни. */
export function dryBush(c: Ctx, r: Rng, x: number, y: number, s: number): void {
  c.strokeStyle = '#6a4a26';
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + r.between(-1.2, 1.2);
    const l = s * r.between(0.5, 1);
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + r.between(-4, 4), y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
}

/** Обломок колонны из песчаника (руины Морока). */
function brokenColumn(c: Ctx, r: Rng, x: number, base: number, w: number, h: number): void {
  shadow(c, x + w * 0.4, base, w * 1.1, w * 0.25, 0.28);
  const g = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#9a6a3a');
  g.addColorStop(0.55, '#e0b27a');
  g.addColorStop(1, '#b07c46');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x - w / 2, base);
  c.lineTo(x - w / 2, base - h);
  c.lineTo(x - w * 0.1, base - h - r.between(4, 14));
  c.lineTo(x + w * 0.15, base - h + r.between(0, 10));
  c.lineTo(x + w / 2, base - h - r.between(0, 8));
  c.lineTo(x + w / 2, base);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(90,50,20,0.3)';
  c.lineWidth = 2;
  for (const k of [-0.2, 0.2]) {
    c.beginPath();
    c.moveTo(x + w * k, base - 4);
    c.lineTo(x + w * k, base - h + 10);
    c.stroke();
  }
  c.fillStyle = '#c08a52';
  c.fillRect(x - w / 2 - 6, base - 12, w + 12, 12);
}

/** Выбеленный череп рогатого зверя. */
function hornSkull(c: Ctx, x: number, y: number, s: number): void {
  shadow(c, x, y + s * 0.5, s, s * 0.25, 0.25);
  c.strokeStyle = '#e6dcc4';
  c.lineWidth = s * 0.18;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x - s * 0.3, y - s * 0.2);
  c.quadraticCurveTo(x - s * 1.1, y - s * 0.3, x - s * 1.0, y - s * 0.9);
  c.moveTo(x + s * 0.3, y - s * 0.2);
  c.quadraticCurveTo(x + s * 1.1, y - s * 0.3, x + s * 1.0, y - s * 0.9);
  c.stroke();
  c.fillStyle = '#efe6d0';
  c.beginPath();
  c.ellipse(x, y, s * 0.4, s * 0.5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#3a2a1a';
  c.beginPath();
  c.arc(x - s * 0.16, y - s * 0.08, s * 0.1, 0, Math.PI * 2);
  c.arc(x + s * 0.16, y - s * 0.08, s * 0.1, 0, Math.PI * 2);
  c.fill();
}

/** Рябь ветра на песке: короткие дуги (светлая сторона + тень). */
function sandRipples(c: Ctx, r: Rng, x0: number, y0: number, w: number, h: number, n: number, a: number): void {
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r.between(x0, x0 + w);
    const y = r.between(y0, y0 + h);
    const l = r.between(30, 90);
    const bend = r.between(3, 7);
    c.lineWidth = 2;
    c.strokeStyle = `rgba(255,236,190,${a})`;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + l / 2, y - bend, x + l, y);
    c.stroke();
    c.strokeStyle = `rgba(120,70,30,${a * 0.9})`;
    c.beginPath();
    c.moveTo(x + 2, y + 3);
    c.quadraticCurveTo(x + l / 2, y + 3 - bend, x + l - 2, y + 3);
    c.stroke();
  }
}

/** Поле боя «Пески Сограта»: жаркое небо, пирамиды за дюнами, песок с рябью, руины и пальмы по краям. */
export function drawDesertField(c: Ctx, W: number, H: number): void {
  const r = rng(83);
  const horizon = H * 0.36;

  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#3a78c0');
  sky.addColorStop(0.5, '#8cbde0');
  sky.addColorStop(0.85, '#e8dcb8');
  sky.addColorStop(1, '#f6d9a0');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 10);
  sun(c, W * 0.74, H * 0.1, 30, 'rgba(255,240,200,A)');

  // Пирамиды вдали в дымке.
  pyramid(c, W * 0.3, horizon - 24, 300, 170, '#e7bf85', '#b98752');
  pyramid(c, W * 0.52, horizon - 20, 150, 82, '#e2b87e', '#b3814d');
  fogBlob(c, W * 0.4, horizon - 30, W * 0.7, 60, 'rgba(250,225,180,A)', 0.55);

  // Дюны — три плана, ближние теплее и темнее.
  const d1 = c.createLinearGradient(0, horizon - 50, 0, horizon + 20);
  d1.addColorStop(0, '#eac48a');
  d1.addColorStop(1, '#d4a266');
  crest(c, ridge(c, r, W, horizon - 20, 18, horizon + 30, d1), 'rgba(255,240,200,0.6)', 3);
  const d2 = c.createLinearGradient(0, horizon - 20, 0, horizon + 60);
  d2.addColorStop(0, '#e2b476');
  d2.addColorStop(1, '#c48e52');
  crest(c, ridge(c, r, W, horizon + 12, 24, horizon + 80, d2), 'rgba(255,236,190,0.55)', 3);

  // Песок поля.
  const sand = c.createLinearGradient(0, horizon + 40, 0, H);
  sand.addColorStop(0, '#dcae70');
  sand.addColorStop(0.5, '#d2a064');
  sand.addColorStop(1, '#b98450');
  c.fillStyle = sand;
  c.fillRect(0, horizon + 40, W, H - horizon - 40);
  const d3 = c.createLinearGradient(0, horizon + 20, 0, horizon + 90);
  d3.addColorStop(0, '#e6b87a');
  d3.addColorStop(1, '#d6a468');
  crest(c, ridge(c, r, W, horizon + 50, 16, horizon + 110, d3), 'rgba(255,240,205,0.5)', 2);
  grain(c, r, 0, horizon + 40, W, H - horizon, 2600, ['rgba(255,236,196,0.35)', 'rgba(140,90,40,0.25)', 'rgba(170,110,60,0.3)'], 2);
  // Тени дюн слева на поле (крупные мягкие пятна) — только у краёв.
  for (const [x, y] of [[0, H * 0.55], [W, H * 0.68], [0, H * 0.9], [W, H * 1.0]] as const) fogBlob(c, x, y, 200, 70, 'rgba(150,90,40,A)', 0.35);
  // Центр — плотный утоптанный песок, чуть светлее и глаже.
  clearing(c, W / 2, H * 0.71, W * 0.46, H * 0.2, 'rgba(236,200,140,A)', 0.35);
  // Рябь ветра: по краям гуще, в центре редкая и слабая.
  sandRipples(c, r, 0, H * 0.45, W * 0.2, H * 0.55, 14, 0.35);
  sandRipples(c, r, W * 0.8, H * 0.45, W * 0.2, H * 0.55, 14, 0.35);
  sandRipples(c, r, W * 0.2, H * 0.47, W * 0.6, H * 0.5, 10, 0.12);
  sandRipples(c, r, 0, horizon + 60, W, H * 0.08, 16, 0.3);

  // Руины, пальмы, камни — по краям.
  palm(c, r, W * 0.06, horizon + 70, 190, 30, '#6a4424', '#3e6a36');
  palm(c, r, W * 0.94, horizon + 60, 170, -26, '#6a4424', '#43723a');
  palm(c, r, W * 0.88, horizon + 40, 120, 18, '#7a5430', 'rgba(70,110,60,0.9)');
  brokenColumn(c, r, W * 0.14, H * 0.52, 44, 110);
  brokenColumn(c, r, W * 0.9, H * 0.6, 50, 70);
  boulder(c, r, W * 0.05, H * 0.72, 34, '#d8a870', '#8a5a30');
  boulder(c, r, W * 0.96, H * 0.84, 40, '#d8a870', '#8a5a30');
  boulder(c, r, W * 0.1, H * 0.97, 46, '#d2a26a', '#80522a');
  boulder(c, r, W * 0.2, horizon + 76, 18, '#e2b47a', '#9a6a3a');
  boulder(c, r, W * 0.7, horizon + 70, 14, '#e2b47a', '#9a6a3a');
  hornSkull(c, W * 0.9, H * 0.94, 22);
  for (const [x, y, s] of [[W * 0.04, H * 0.6, 26], [W * 0.95, H * 0.74, 30], [W * 0.18, H * 0.9, 22], [W * 0.82, H * 0.99, 28], [W * 0.4, horizon + 70, 16]] as const) {
    dryBush(c, r, x, y, s);
  }

  // Марево у горизонта и тёплый свет от солнца.
  const haze = c.createLinearGradient(0, horizon - 10, 0, horizon + H * 0.14);
  haze.addColorStop(0, 'rgba(255,230,185,0.55)');
  haze.addColorStop(1, 'rgba(255,230,185,0)');
  c.fillStyle = haze;
  c.fillRect(0, horizon - 10, W, H * 0.15);
  vignette(c, W, H, H * 0.64, W * 0.4, H * 0.74, 'rgba(70,30,6,0.55)');
  // Солнце поверх виньетки — слепящее.
  glow(c, W * 0.74, H * 0.1, 50, 'rgba(255,245,215,A)', 0.8);
}

/** Карта «Пески Сограта»: закатное небо, пирамиды, волны дюн до низа экрана, оазис с пальмами сбоку. */
export function drawDesertMap(c: Ctx, W: number, H: number): void {
  const r = rng(89);
  const sky = c.createLinearGradient(0, 0, 0, H * 0.4);
  sky.addColorStop(0, '#3e5f8e');
  sky.addColorStop(0.6, '#d8a078');
  sky.addColorStop(1, '#f4cf92');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H * 0.42);
  sun(c, W * 0.7, H * 0.2, 44, 'rgba(255,225,160,A)');
  pyramid(c, W * 0.28, H * 0.34, 380, 210, '#e5b67a', '#a8744a');
  pyramid(c, W * 0.58, H * 0.345, 180, 96, '#e0b07a', '#a4704a');
  pyramid(c, W * 0.86, H * 0.35, 120, 60, '#d9a874', '#a06c46');
  fogBlob(c, W / 2, H * 0.34, W, 80, 'rgba(250,215,165,A)', 0.55);

  // Гряды дюн сверху вниз: каждая темнее и теплее, светлый гребень.
  const bands: Array<[number, string, string]> = [
    [0.36, '#e8bc80', '#d19a5e'],
    [0.46, '#e0b072', '#c68c52'],
    [0.57, '#d6a466', '#b97e48'],
    [0.69, '#cc985c', '#aa703e'],
    [0.82, '#c08a52', '#9a6236'],
    [0.94, '#b27c48', '#8a552e'],
  ];
  for (const [k, top, bot] of bands) {
    const y = H * k;
    const g = c.createLinearGradient(0, y - 40, 0, y + H * 0.14);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    const pts = ridge(c, r, W, y, H * 0.025, H + 20, g, 0.8);
    crest(c, pts, 'rgba(255,238,200,0.55)', 3);
    // Тень под гребнем.
    c.strokeStyle = 'rgba(110,60,25,0.2)';
    c.lineWidth = 14;
    c.beginPath();
    pts.forEach(([x, yy], i) => (i ? c.lineTo(x, yy + 12) : c.moveTo(x, yy + 12)));
    c.stroke();
  }
  grain(c, r, 0, H * 0.34, W, H * 0.66, 2400, ['rgba(255,236,196,0.3)', 'rgba(120,70,30,0.22)'], 2);
  // Оазис у левого края: вода и пальмы.
  c.fillStyle = '#2f6f7a';
  c.beginPath();
  c.ellipse(W * 0.06, H * 0.64, 110, 30, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(200,240,240,0.35)';
  c.lineWidth = 2;
  c.stroke();
  palm(c, r, W * 0.02, H * 0.63, 210, 26, '#5a3a1e', '#2f5e2e');
  palm(c, r, W * 0.14, H * 0.64, 150, -14, '#5a3a1e', '#3a6a34');
  palm(c, r, W * 0.97, H * 0.9, 230, -34, '#4a2e18', '#2e5a2c');
  brokenColumn(c, r, W * 0.9, H * 0.48, 34, 70);
  hornSkull(c, W * 0.1, H * 0.92, 20);
  glow(c, W * 0.7, H * 0.2, W, 'rgba(255,190,110,A)', 0.1);
  vignette(c, W, H, H * 0.5, W * 0.36, H * 0.74, 'rgba(60,24,6,0.55)');
  glow(c, W * 0.7, H * 0.2, 70, 'rgba(255,245,215,A)', 0.7);
}

// ---------------------------------------------------------------------------------------------------------------
// Глава 5 — «Лес Пайона»: ночной лес, бамбук и сосны, луна, фонари, светлячки.
// ---------------------------------------------------------------------------------------------------------------

/** Сосна-силуэт: ствол и ярусы хвои (неровные треугольники). */
function pine(c: Ctx, r: Rng, x: number, base: number, h: number, color: string, rim?: string): void {
  c.fillStyle = color;
  c.fillRect(x - h * 0.02, base - h * 0.3, h * 0.04, h * 0.3);
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const w = h * (0.34 - k * 0.24);
    const y0 = base - h * (0.18 + k * 0.72);
    const th = h * 0.28;
    c.beginPath();
    c.moveTo(x - w, y0);
    c.lineTo(x - w * 0.45, y0 - th * 0.35 + r.between(-3, 3));
    c.lineTo(x, y0 - th);
    c.lineTo(x + w * 0.45, y0 - th * 0.35 + r.between(-3, 3));
    c.lineTo(x + w, y0);
    c.quadraticCurveTo(x, y0 - th * 0.12, x - w, y0);
    c.fill();
    if (rim) {
      // Лунный свет по правой кромке яруса.
      c.save();
      c.strokeStyle = rim;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, y0 - th);
      c.lineTo(x + w * 0.45, y0 - th * 0.35);
      c.lineTo(x + w, y0);
      c.stroke();
      c.restore();
      c.fillStyle = color;
    }
  }
}

/** Стебель бамбука с коленцами и листьями. */
function bamboo(c: Ctx, r: Rng, x: number, base: number, h: number, w: number, dark: string, light: string, leaf: string): void {
  const lean = r.between(-0.05, 0.05);
  c.save();
  c.translate(x, base);
  c.rotate(lean);
  const g = c.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, dark);
  g.addColorStop(0.35, light);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.fillRect(-w / 2, -h, w, h);
  // Коленца.
  const seg = r.between(60, 90);
  for (let y = -seg; y > -h; y -= seg) {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(-w / 2 - 1, y - 2, w + 2, 4);
    c.fillStyle = 'rgba(200,230,220,0.18)';
    c.fillRect(-w / 2 - 1, y + 2, w + 2, 2);
    if (r.rnd() < 0.55) {
      // Пучок листьев от коленца.
      const dir = r.rnd() < 0.5 ? -1 : 1;
      c.fillStyle = leaf;
      for (let i = 0; i < 3; i++) {
        const len = r.between(34, 60);
        const a = dir * r.between(0.3, 1.1);
        c.save();
        c.translate(dir * w * 0.4, y);
        c.rotate(Math.PI / 2 - a + (dir < 0 ? Math.PI : 0) + Math.PI);
        c.beginPath();
        c.ellipse(len / 2, 0, len / 2, r.between(3.5, 5.5), 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    }
  }
  c.restore();
}

/** Каменный фонарь (торо) с тёплым огнём. */
function stoneLantern(c: Ctx, x: number, base: number, s: number): void {
  glow(c, x, base - s * 2.2, s * 6, 'rgba(255,170,80,A)', 0.3);
  shadow(c, x, base, s * 1.1, s * 0.25, 0.4);
  c.fillStyle = '#3c3a4a';
  c.fillRect(x - s * 0.8, base - s * 0.3, s * 1.6, s * 0.3);
  c.fillRect(x - s * 0.22, base - s * 1.6, s * 0.44, s * 1.3);
  c.fillStyle = '#4a4858';
  c.fillRect(x - s * 0.7, base - s * 1.8, s * 1.4, s * 0.22);
  // Окошко с огнём.
  c.fillStyle = '#2c2a36';
  c.fillRect(x - s * 0.55, base - s * 2.6, s * 1.1, s * 0.8);
  const f = c.createRadialGradient(x, base - s * 2.2, 0, x, base - s * 2.2, s * 0.5);
  f.addColorStop(0, '#fff0c0');
  f.addColorStop(1, '#ff9a40');
  c.fillStyle = f;
  c.fillRect(x - s * 0.32, base - s * 2.5, s * 0.64, s * 0.6);
  // Крыша.
  c.fillStyle = '#524e62';
  c.beginPath();
  c.moveTo(x - s * 1.0, base - s * 2.55);
  c.quadraticCurveTo(x, base - s * 2.9, x + s * 1.0, base - s * 2.55);
  c.lineTo(x + s * 0.2, base - s * 3.2);
  c.lineTo(x - s * 0.2, base - s * 3.2);
  c.closePath();
  c.fill();
  c.fillRect(x - s * 0.1, base - s * 3.45, s * 0.2, s * 0.3);
  glow(c, x, base - s * 2.2, s * 1.6, 'rgba(255,210,140,A)', 0.5);
}

/** Бумажный фонарь на шнуре. */
function paperLantern(c: Ctx, x: number, y: number, s: number, cord: number): void {
  c.strokeStyle = 'rgba(20,16,30,0.9)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x, y - cord);
  c.lineTo(x, y - s);
  c.stroke();
  glow(c, x, y, s * 5, 'rgba(255,120,70,A)', 0.3);
  const g = c.createRadialGradient(x - s * 0.2, y - s * 0.2, 0, x, y, s);
  g.addColorStop(0, '#ffd9a0');
  g.addColorStop(0.6, '#f07a3a');
  g.addColorStop(1, '#a8341e');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(x, y, s * 0.8, s, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(120,30,10,0.5)';
  c.lineWidth = 1;
  for (const k of [-0.4, 0, 0.4]) {
    c.beginPath();
    c.ellipse(x, y, s * 0.8 * Math.abs(k || 0.01), s, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = '#2a1e1a';
  c.fillRect(x - s * 0.4, y - s * 1.05, s * 0.8, s * 0.15);
  c.fillRect(x - s * 0.4, y + s * 0.9, s * 0.8, s * 0.15);
}

/** Светлячки: жёлто-зелёные точки с ореолом. */
function fireflies(c: Ctx, r: Rng, n: number, x0: number, y0: number, w: number, h: number): void {
  for (let i = 0; i < n; i++) {
    const x = r.between(x0, x0 + w);
    const y = r.between(y0, y0 + h);
    glow(c, x, y, r.between(10, 18), 'rgba(220,255,140,A)', 0.35);
    glow(c, x, y, 3, 'rgba(255,255,220,A)', 0.95);
  }
}

/** Поле боя «Лес Пайона»: луна над соснами, туман, лунная поляна в центре, бамбук и фонари по краям. */
export function drawGroveField(c: Ctx, W: number, H: number, grass: CanvasImageSource | null): void {
  const r = rng(97);
  const horizon = H * 0.36;

  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#0e1230');
  sky.addColorStop(0.6, '#2a2c5e');
  sky.addColorStop(1, '#4e4a86');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 10);
  stars(c, r, W, horizon * 0.8, 120);
  orb(c, W * 0.72, H * 0.1, 34, '#f4f0dc', 'rgba(200,210,255,A)', 0.5);
  // Кратеры луны.
  c.fillStyle = 'rgba(180,176,160,0.45)';
  for (const [dx, dy, rr] of [[-10, -6, 7], [9, 8, 5], [4, -14, 4]] as const) {
    c.beginPath();
    c.arc(W * 0.72 + dx, H * 0.1 + dy, rr, 0, Math.PI * 2);
    c.fill();
  }

  // Дальние сосны в сизой дымке, туман, ближний ярус темнее с лунной кромкой.
  for (let x = -20; x < W + 30; x += r.between(28, 46)) pine(c, r, x, horizon - 20 + r.between(-10, 10), r.between(120, 170), 'rgba(58,60,110,0.9)');
  fogBlob(c, W / 2, horizon - 30, W * 0.9, 60, 'rgba(150,150,210,A)', 0.4);
  for (let x = -10; x < W + 30; x += r.between(50, 80)) pine(c, r, x, horizon + 14 + r.between(-8, 8), r.between(180, 250), '#1b1c3e', 'rgba(170,180,240,0.35)');

  // Трава: тайл, притемнённый ночной синевой.
  tileFill(c, grass, '#2c3a4a', 0.7, 0, horizon + 10, W, H - horizon);
  c.fillStyle = 'rgba(18,20,58,0.66)';
  c.fillRect(0, horizon + 10, W, H - horizon);
  const haze = c.createLinearGradient(0, horizon, 0, horizon + H * 0.14);
  haze.addColorStop(0, 'rgba(120,120,190,0.55)');
  haze.addColorStop(1, 'rgba(120,120,190,0)');
  c.fillStyle = haze;
  c.fillRect(0, horizon, W, H * 0.14);
  // Лунная поляна в центре: холодный свет на траве.
  clearing(c, W / 2, H * 0.71, W * 0.5, H * 0.22, 'rgba(150,160,220,A)', 0.22);
  glow(c, W * 0.55, H * 0.68, W * 0.55, 'rgba(120,130,200,A)', 0.1);
  // Пятна тени от крон по краям.
  for (let i = 0; i < 10; i++) {
    const x = r.rnd() < 0.5 ? r.between(-40, W * 0.18) : r.between(W * 0.82, W + 40);
    fogBlob(c, x, r.between(H * 0.45, H), r.between(80, 140), r.between(30, 50), 'rgba(4,4,20,A)', 0.45);
  }

  // Бамбук по краям (передний план), тонкие стебли ещё дальше.
  for (const [x, h, w] of [[8, H * 0.7, 22], [40, H * 0.62, 16], [70, H * 0.66, 18], [W - 12, H * 0.72, 24], [W - 46, H * 0.64, 17], [W - 80, H * 0.6, 14]] as const) {
    bamboo(c, r, x, H + 10, h, w, '#10283a', '#3c6e76', 'rgba(30,70,70,0.95)');
  }
  // Каменные фонари и бумажные фонарики на ветвях.
  stoneLantern(c, W * 0.17, H * 0.56, 22);
  stoneLantern(c, W * 0.85, H * 0.88, 26);
  paperLantern(c, W * 0.2, horizon + 18, 13, 70);
  paperLantern(c, W * 0.78, horizon + 40, 11, 90);
  // Кусты и камни.
  boulder(c, r, W * 0.14, H * 0.96, 34, '#3a3e62', '#15162e');
  boulder(c, r, W * 0.88, H * 0.58, 26, '#3a3e62', '#15162e');

  fireflies(c, r, 10, 0, H * 0.4, W * 0.2, H * 0.6);
  fireflies(c, r, 10, W * 0.8, H * 0.4, W * 0.2, H * 0.6);
  fireflies(c, r, 8, W * 0.1, horizon - 60, W * 0.8, 120);

  fogBlob(c, W * 0.12, H * 0.62, W * 0.4, 40, 'rgba(150,150,210,A)', 0.18);
  fogBlob(c, W * 0.9, H * 0.8, W * 0.35, 40, 'rgba(150,150,210,A)', 0.16);
  vignette(c, W, H, H * 0.66, W * 0.36, H * 0.72, 'rgba(4,4,22,0.72)');
}

/** Карта «Лес Пайона»: ночное небо с луной, ярусы сосен в тумане, бамбук по краям, фонари и светлячки. */
export function drawGroveMap(c: Ctx, W: number, H: number): void {
  const r = rng(101);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0b0e28');
  sky.addColorStop(0.3, '#2a2a5c');
  sky.addColorStop(0.55, '#1c1e46');
  sky.addColorStop(1, '#080a1c');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  stars(c, r, W, H * 0.3, 160);
  orb(c, W * 0.3, H * 0.13, 46, '#f4f0dc', 'rgba(190,200,255,A)', 0.5);

  // Ярусы сосен сверху вниз, между ними туман.
  const layers: Array<[number, string, number, number]> = [
    [0.36, 'rgba(62,62,118,0.9)', 130, 34],
    [0.48, 'rgba(40,42,90,0.95)', 170, 44],
    [0.62, '#1e2050', 220, 58],
    [0.8, '#12143a', 280, 74],
  ];
  layers.forEach(([k, color, h, step], i) => {
    for (let x = -20; x < W + 30; x += r.between(step * 0.8, step * 1.2)) pine(c, r, x, H * k + r.between(-14, 14), r.between(h * 0.8, h * 1.1), color, i >= 2 ? 'rgba(170,180,240,0.25)' : undefined);
    fogBlob(c, W / 2 + r.between(-100, 100), H * k + 10, W * 0.9, 70, 'rgba(140,140,210,A)', 0.28 - i * 0.04);
  });
  // Бамбук по краям на всю высоту.
  for (const [x, w] of [[6, 26], [44, 18], [W - 10, 28], [W - 50, 18]] as const) bamboo(c, r, x, H + 10, H * 0.95, w, '#08182a', '#2f5a66', 'rgba(24,56,60,0.95)');
  paperLantern(c, W * 0.14, H * 0.4, 14, 120);
  paperLantern(c, W * 0.86, H * 0.56, 16, 160);
  stoneLantern(c, W * 0.84, H * 0.95, 24);
  stoneLantern(c, W * 0.16, H * 0.78, 20);
  fireflies(c, r, 26, 0, H * 0.3, W, H * 0.7);
  vignette(c, W, H, H * 0.5, W * 0.34, H * 0.72, 'rgba(0,0,12,0.6)');
}

// ---------------------------------------------------------------------------------------------------------------
// Глава 6 — «Затонувший корабль»: подводная палуба, лучи сверху, мачты, водоросли, пузырьки.
// ---------------------------------------------------------------------------------------------------------------

/** Водоросль: волнистый стебель с листочками. */
function kelp(c: Ctx, r: Rng, x: number, base: number, h: number, color: string): void {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineCap = 'round';
  c.lineWidth = r.between(3, 5);
  const ph = r.between(0, Math.PI * 2);
  const amp = r.between(6, 14);
  c.beginPath();
  c.moveTo(x, base);
  const pts: Array<[number, number]> = [];
  for (let t = 0; t <= 1.001; t += 0.05) {
    const px = x + Math.sin(t * 7 + ph) * amp * t;
    const py = base - h * t;
    pts.push([px, py]);
    c.lineTo(px, py);
  }
  c.stroke();
  for (let i = 2; i < pts.length; i += 2) {
    const [px, py] = pts[i];
    const dir = i % 4 ? 1 : -1;
    c.beginPath();
    c.ellipse(px + dir * 8, py, 10, 3.5, dir * -0.6, 0, Math.PI * 2);
    c.fill();
  }
}

/** Пузырьки: столбик кружков, вверх мельче. */
function bubbles(c: Ctx, r: Rng, x: number, y: number, n: number, s: number): void {
  for (let i = 0; i < n; i++) {
    const bx = x + r.between(-8, 8);
    const by = y - i * r.between(14, 26);
    const br = s * r.between(0.5, 1) * (1 - (i / n) * 0.5);
    c.strokeStyle = 'rgba(200,245,255,0.55)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(bx, by, br, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = 'rgba(230,255,255,0.6)';
    c.beginPath();
    c.arc(bx - br * 0.35, by - br * 0.35, Math.max(1, br * 0.28), 0, Math.PI * 2);
    c.fill();
  }
}

/** Бочка на боку или стоя. */
function barrel(c: Ctx, x: number, y: number, s: number, lying: boolean): void {
  c.save();
  c.translate(x, y);
  if (lying) c.rotate(Math.PI / 2 - 0.2);
  shadow(c, 0, s * 0.7, s * 0.8, s * 0.2, 0.3);
  const g = c.createLinearGradient(-s * 0.55, 0, s * 0.55, 0);
  g.addColorStop(0, '#223a3a');
  g.addColorStop(0.45, '#557060');
  g.addColorStop(1, '#1a2e30');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-s * 0.45, -s * 0.7);
  c.quadraticCurveTo(-s * 0.62, 0, -s * 0.45, s * 0.7);
  c.lineTo(s * 0.45, s * 0.7);
  c.quadraticCurveTo(s * 0.62, 0, s * 0.45, -s * 0.7);
  c.closePath();
  c.fill();
  c.strokeStyle = '#1a2626';
  c.lineWidth = s * 0.08;
  for (const k of [-0.45, 0.45]) {
    c.beginPath();
    c.moveTo(-s * 0.56, s * k);
    c.lineTo(s * 0.56, s * k);
    c.stroke();
  }
  c.restore();
}

/** Сломанная мачта: брус с реей и обрывками канатов. */
function mast(c: Ctx, x: number, y: number, len: number, w: number, ang: number, color: string): void {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(4, -w / 2 + 6, len, w);
  const g = c.createLinearGradient(0, -w / 2, 0, w / 2);
  g.addColorStop(0, '#6a7a66');
  g.addColorStop(0.4, color);
  g.addColorStop(1, '#1a2624');
  c.fillStyle = g;
  c.fillRect(0, -w / 2, len, w);
  // Обломанный конец.
  c.beginPath();
  c.moveTo(len, -w / 2);
  c.lineTo(len + w * 0.8, -w * 0.1);
  c.lineTo(len + w * 0.3, w * 0.2);
  c.lineTo(len + w, w / 2);
  c.lineTo(len, w / 2);
  c.closePath();
  c.fill();
  // Железные обручи.
  c.fillStyle = 'rgba(20,30,30,0.7)';
  for (const k of [0.2, 0.55]) c.fillRect(len * k, -w / 2, w * 0.35, w);
  // Канаты.
  c.strokeStyle = 'rgba(150,160,120,0.6)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(len * 0.3, w / 2);
  c.quadraticCurveTo(len * 0.36, w * 2.5, len * 0.46, w * 2.8);
  c.moveTo(len * 0.62, w / 2);
  c.quadraticCurveTo(len * 0.66, w * 1.8, len * 0.72, w * 2.2);
  c.stroke();
  c.restore();
}

/** Корпус затонувшего судна вдали: накренённый силуэт, пробоина, мачты с рваным парусом. */
function hull(c: Ctx, x: number, base: number, w: number, h: number, tilt: number, color: string, sail: string): void {
  c.save();
  c.translate(x, base);
  c.rotate(tilt);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(-w / 2, -h);
  c.lineTo(w / 2 - w * 0.08, -h * 1.15);
  c.quadraticCurveTo(w / 2 + w * 0.05, -h * 0.6, w * 0.35, 0);
  c.lineTo(-w * 0.4, 0);
  c.quadraticCurveTo(-w / 2 - w * 0.02, -h * 0.4, -w / 2, -h);
  c.closePath();
  c.fill();
  // Надстройка на корме.
  c.fillRect(-w / 2, -h * 1.45, w * 0.22, h * 0.5);
  // Мачты.
  c.fillRect(-w * 0.12, -h * 3.2, w * 0.018, h * 2.2);
  c.fillRect(w * 0.18, -h * 2.6, w * 0.016, h * 1.6);
  c.fillRect(-w * 0.2, -h * 2.8, w * 0.18, h * 0.06);
  // Рваный парус.
  c.fillStyle = sail;
  c.beginPath();
  c.moveTo(-w * 0.19, -h * 2.74);
  c.lineTo(-w * 0.03, -h * 2.74);
  c.lineTo(-w * 0.05, -h * 2.1);
  c.lineTo(-w * 0.09, -h * 2.25);
  c.lineTo(-w * 0.13, -h * 1.95);
  c.lineTo(-w * 0.17, -h * 2.3);
  c.closePath();
  c.fill();
  // Пробоина.
  c.fillStyle = 'rgba(0,10,20,0.6)';
  c.beginPath();
  c.ellipse(w * 0.1, -h * 0.5, w * 0.06, h * 0.22, 0.3, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Каустика: светлая сетка бликов от поверхности на дне. */
function caustics(c: Ctx, r: Rng, x0: number, y0: number, w: number, h: number, n: number, a: number): void {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.lineWidth = 2;
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r.between(x0, x0 + w);
    const y = r.between(y0, y0 + h);
    const l = r.between(20, 50);
    c.strokeStyle = `rgba(150,240,230,${a * r.between(0.4, 1)})`;
    c.beginPath();
    c.moveTo(x, y);
    c.bezierCurveTo(x + l * 0.3, y - r.between(4, 10), x + l * 0.7, y + r.between(4, 10), x + l, y);
    c.stroke();
  }
  c.restore();
}

/** Поле боя «Затонувший корабль»: толща воды с лучами, корпус вдали, палуба в центре, обломки и водоросли по краям. */
export function drawShipwreckField(c: Ctx, W: number, H: number): void {
  const r = rng(107);
  const horizon = H * 0.36;

  const water = c.createLinearGradient(0, 0, 0, H);
  water.addColorStop(0, '#5cc4c8');
  water.addColorStop(0.18, '#237f98');
  water.addColorStop(0.36, '#145672');
  water.addColorStop(1, '#082438');
  c.fillStyle = water;
  c.fillRect(0, 0, W, H);
  // Поверхность: колышущиеся блики у верхнего края.
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(220,255,250,${r.between(0.05, 0.18)})`;
    c.beginPath();
    c.ellipse(r.between(0, W), r.between(0, H * 0.05), r.between(20, 60), r.between(2, 5), 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  rays(c, r, W, 0, horizon + H * 0.25, 9, 'rgba(190,250,240,A)', 0.16);

  // Даль: песчаные холмы и корпус судна в синей мгле.
  const far = c.createLinearGradient(0, horizon - 40, 0, horizon + 20);
  far.addColorStop(0, '#1d5a6c');
  far.addColorStop(1, '#154658');
  ridge(c, r, W, horizon - 16, 16, horizon + 40, far);
  hull(c, W * 0.34, horizon - 6, 360, 60, -0.1, 'rgba(14,44,58,0.95)', 'rgba(70,110,110,0.55)');
  fogBlob(c, W / 2, horizon - 20, W * 0.9, 70, 'rgba(60,150,170,A)', 0.35);
  kelp(c, r, W * 0.72, horizon + 10, 120, 'rgba(24,70,70,0.9)');
  kelp(c, r, W * 0.78, horizon + 14, 90, 'rgba(24,70,70,0.9)');

  // Палуба: доски с зазорами, притемнённые и холодные (низкий контраст).
  const deckTop = horizon + 30;
  const deck = c.createLinearGradient(0, deckTop, 0, H);
  deck.addColorStop(0, '#2c4a4a');
  deck.addColorStop(1, '#1c3236');
  c.fillStyle = deck;
  c.fillRect(0, deckTop, W, H - deckTop);
  // Доски к низу шире (лёгкая перспектива); каждая чуть своего тона, швы приглушены — фигуры читаются.
  for (let y = deckTop, ph = 30; y < H; y += ph, ph = Math.min(52, ph + 2)) {
    c.fillStyle = `rgba(${r.rnd() < 0.5 ? '0,14,20' : '120,160,140'},${r.between(0.03, 0.08)})`;
    c.fillRect(0, y, W, ph);
    c.fillStyle = 'rgba(0,12,18,0.22)';
    c.fillRect(0, y, W, 2);
    c.fillStyle = 'rgba(160,210,200,0.04)';
    c.fillRect(0, y + 2, W, 2);
    // Стыки досок со смещением.
    for (let x = r.between(0, 240); x < W; x += r.between(220, 340)) {
      c.fillStyle = 'rgba(0,12,18,0.18)';
      c.fillRect(x, y, 2, ph);
      c.fillStyle = 'rgba(0,12,18,0.25)';
      c.beginPath();
      c.arc(x + 10, y + ph / 2, 1.8, 0, Math.PI * 2);
      c.arc(x - 8, y + ph / 2, 1.8, 0, Math.PI * 2);
      c.fill();
    }
  }
  grain(c, r, 0, deckTop, W, H - deckTop, 1400, ['rgba(120,170,150,0.14)', 'rgba(0,10,14,0.25)'], 2);
  // Песок, намытый к бортам (края), и ил поверх досок.
  for (const [x, y, rx] of [[0, H * 0.55, 180], [W, H * 0.62, 190], [0, H * 0.86, 210], [W, H * 0.95, 220], [W * 0.5, H * 1.02, 260]] as const) {
    fogBlob(c, x, y, rx, rx * 0.35, 'rgba(160,170,130,A)', 0.4);
  }
  const hazeDeck = c.createLinearGradient(0, deckTop - 10, 0, deckTop + H * 0.14);
  hazeDeck.addColorStop(0, 'rgba(70,160,175,0.6)');
  hazeDeck.addColorStop(1, 'rgba(70,160,175,0)');
  c.fillStyle = hazeDeck;
  c.fillRect(0, deckTop - 10, W, H * 0.15);
  // Световое пятно в центре и каустика.
  glow(c, W / 2, H * 0.7, W * 0.6, 'rgba(90,200,210,A)', 0.14);
  caustics(c, r, W * 0.05, H * 0.46, W * 0.9, H * 0.52, 90, 0.12);

  // Обломки: мачты, бочки, якорная цепь — по краям.
  mast(c, -30, H * 0.5, 190, 22, 0.35, '#3a4c44');
  mast(c, W + 20, H * 0.84, 170, 20, Math.PI - 0.3, '#3a4c44');
  barrel(c, W * 0.9, H * 0.58, 30, false);
  barrel(c, W * 0.07, H * 0.8, 26, true);
  barrel(c, W * 0.14, H * 0.97, 28, false);
  // Якорная цепь.
  c.strokeStyle = 'rgba(30,44,44,0.9)';
  c.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    c.beginPath();
    c.ellipse(W * 0.8 + i * 14, H * 0.99 - i * 5, 8, 5, -0.35, 0, Math.PI * 2);
    c.stroke();
  }
  // Водоросли и кораллы.
  for (const [x, y, h] of [[16, H * 0.62, 140], [34, H * 0.64, 100], [W - 20, H * 0.72, 150], [W - 42, H * 0.74, 110], [26, H + 10, 190], [W - 30, H + 10, 200], [W * 0.18, deckTop + 20, 70]] as const) {
    kelp(c, r, x, y, h, r.rnd() < 0.5 ? '#1d6a5a' : '#2a7a58');
  }
  deadTree(c, r, W * 0.95, H * 0.5, 70, '#b06a6a');
  deadTree(c, r, W * 0.04, H * 0.93, 80, '#c07a60');
  // Пузырьки.
  for (const [x, y, n] of [[W * 0.08, H * 0.6, 7], [W * 0.93, H * 0.7, 8], [W * 0.2, H * 0.4, 5], [W * 0.82, H * 0.45, 6], [W * 0.5, horizon, 5]] as const) bubbles(c, r, x, y, n, 7);
  // Взвесь в воде.
  for (let i = 0; i < 40; i++) glow(c, r.between(0, W), r.between(0, H), r.between(2, 4), 'rgba(200,255,240,A)', 0.4);

  vignette(c, W, H, H * 0.62, W * 0.34, H * 0.74, 'rgba(0,10,24,0.72)');
}

/** Карта «Затонувший корабль»: лучи в толще воды, большой корпус на дне, лес водорослей по краям, пузырьки. */
export function drawShipwreckMap(c: Ctx, W: number, H: number): void {
  const r = rng(113);
  const water = c.createLinearGradient(0, 0, 0, H);
  water.addColorStop(0, '#4cb4c0');
  water.addColorStop(0.2, '#1c7690');
  water.addColorStop(0.6, '#0e4260');
  water.addColorStop(1, '#051a2c');
  c.fillStyle = water;
  c.fillRect(0, 0, W, H);
  rays(c, r, W, 0, H * 0.75, 12, 'rgba(180,250,240,A)', 0.14);
  // Дальние скалы.
  const g1 = c.createLinearGradient(0, H * 0.5, 0, H);
  g1.addColorStop(0, '#154e62');
  g1.addColorStop(1, '#0a2a3a');
  ridge(c, r, W, H * 0.56, 40, H + 20, g1);
  // Корпус на дне — чуть ниже середины, наклонён; туман поверх, чтобы дорожка читалась.
  hull(c, W * 0.52, H * 0.66, 560, 90, -0.14, 'rgba(10,34,46,0.95)', 'rgba(60,110,110,0.5)');
  fogBlob(c, W / 2, H * 0.6, W, 120, 'rgba(50,140,160,A)', 0.3);
  // Песчаное дно.
  const g2 = c.createLinearGradient(0, H * 0.78, 0, H);
  g2.addColorStop(0, '#3a6a6a');
  g2.addColorStop(1, '#16343c');
  crest(c, ridge(c, r, W, H * 0.82, 20, H + 20, g2), 'rgba(160,220,210,0.25)', 3);
  caustics(c, r, 0, H * 0.82, W, H * 0.18, 60, 0.12);
  mast(c, W * 0.02, H * 0.9, 220, 22, -0.5, '#2e4440');
  barrel(c, W * 0.86, H * 0.9, 30, true);
  // Лес водорослей по краям во всю высоту.
  for (const x of [8, 28, 52, W - 10, W - 32, W - 56]) kelp(c, r, x, H + 10, r.between(H * 0.35, H * 0.6), r.rnd() < 0.5 ? '#12584c' : '#1c6a50');
  // Рыбки-силуэты.
  c.fillStyle = 'rgba(8,30,44,0.6)';
  for (let i = 0; i < 9; i++) {
    const x = r.between(W * 0.1, W * 0.9);
    const y = r.between(H * 0.15, H * 0.45);
    const s = r.between(6, 12);
    c.beginPath();
    c.ellipse(x, y, s * 1.6, s * 0.6, 0, 0, Math.PI * 2);
    c.moveTo(x + s * 1.4, y);
    c.lineTo(x + s * 2.4, y - s * 0.7);
    c.lineTo(x + s * 2.4, y + s * 0.7);
    c.fill();
  }
  for (const [x, y, n] of [[W * 0.1, H * 0.8, 9], [W * 0.9, H * 0.7, 10], [W * 0.62, H * 0.62, 7], [W * 0.3, H * 0.9, 6]] as const) bubbles(c, r, x, y, n, 8);
  for (let i = 0; i < 40; i++) glow(c, r.between(0, W), r.between(0, H), r.between(2, 4), 'rgba(200,255,240,A)', 0.4);
  vignette(c, W, H, H * 0.45, W * 0.34, H * 0.74, 'rgba(0,6,18,0.65)');
}

// ---------------------------------------------------------------------------------------------------------------
// Глава 7 — «Нифльхейм»: мир мёртвых, туман, мёртвые деревья, призрачные огни, тёмно-фиолетовое небо.
// ---------------------------------------------------------------------------------------------------------------

/** Надгробие (плита с закруглённым верхом или крест), с трещиной. */
function grave(c: Ctx, r: Rng, x: number, base: number, s: number, cross: boolean, tone = '#5a5c6e'): void {
  c.save();
  c.translate(x, base);
  c.rotate(r.between(-0.12, 0.12));
  shadow(c, s * 0.2, 0, s * 0.8, s * 0.18, 0.35);
  const g = c.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
  g.addColorStop(0, '#2a2a38');
  g.addColorStop(0.4, tone);
  g.addColorStop(1, '#1e1e2a');
  c.fillStyle = g;
  if (cross) {
    c.fillRect(-s * 0.1, -s * 1.5, s * 0.2, s * 1.5);
    c.fillRect(-s * 0.4, -s * 1.15, s * 0.8, s * 0.2);
  } else {
    c.beginPath();
    c.moveTo(-s * 0.4, 0);
    c.lineTo(-s * 0.4, -s * 0.8);
    c.arc(0, -s * 0.8, s * 0.4, Math.PI, Math.PI * 2);
    c.lineTo(s * 0.4, 0);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(10,10,16,0.7)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(-s * 0.1, -s * 1.1);
    c.lineTo(0, -s * 0.8);
    c.lineTo(-s * 0.08, -s * 0.55);
    c.stroke();
    c.fillStyle = 'rgba(200,210,230,0.12)';
    c.fillRect(-s * 0.25, -s * 0.7, s * 0.5, 3);
  }
  c.restore();
}

/** Призрачный огонёк: холодное свечение с ядром и хвостом. */
function wisp(c: Ctx, x: number, y: number, s: number, color = 'rgba(140,220,255,A)'): void {
  glow(c, x, y, s * 6, color, 0.3);
  glow(c, x, y + s * 1.5, s * 2.2, color, 0.35);
  glow(c, x, y, s * 1.6, 'rgba(230,250,255,A)', 0.9);
}

/** Силуэт замка Хель вдали: башни с острыми шпилями. */
function spires(c: Ctx, x: number, base: number, w: number, h: number, color: string): void {
  c.fillStyle = color;
  const towers: Array<[number, number, number]> = [
    [-0.45, 0.45, 0.08], [-0.3, 0.7, 0.1], [-0.12, 0.55, 0.09], [0, 1, 0.12], [0.14, 0.62, 0.09], [0.3, 0.8, 0.1], [0.46, 0.4, 0.08],
  ];
  c.fillRect(x - w * 0.5, base - h * 0.28, w, h * 0.28);
  for (const [k, hh, ww] of towers) {
    const tx = x + k * w;
    const tw = ww * w;
    c.fillRect(tx - tw / 2, base - h * hh, tw, h * hh);
    c.beginPath();
    c.moveTo(tx - tw * 0.7, base - h * hh);
    c.lineTo(tx, base - h * hh - h * 0.28);
    c.lineTo(tx + tw * 0.7, base - h * hh);
    c.closePath();
    c.fill();
  }
  // Окна с холодным светом.
  for (const [k, hh] of [[-0.3, 0.55], [0, 0.8], [0.3, 0.62], [0.14, 0.45]] as const) {
    c.fillStyle = 'rgba(150,220,255,0.7)';
    c.fillRect(x + k * w - 2, base - h * hh, 4, 7);
    glow(c, x + k * w, base - h * hh + 3, 10, 'rgba(140,210,255,A)', 0.4);
  }
}

/** Поле боя «Нифльхейм»: фиолетовое небо, замок в тумане, мёртвый лес, серая земля, могилы и огни по краям. */
export function drawNiflheimField(c: Ctx, W: number, H: number, ground: CanvasImageSource | null): void {
  const r = rng(127);
  const horizon = H * 0.36;

  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#140c22');
  sky.addColorStop(0.5, '#34264e');
  sky.addColorStop(1, '#6a7088');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 10);
  stars(c, r, W, horizon * 0.5, 50, '210,220,255');
  // Бледная луна за пеленой.
  orb(c, W * 0.25, H * 0.09, 28, 'rgba(210,220,235,0.85)', 'rgba(170,180,230,A)', 0.4);
  fogBlob(c, W * 0.3, H * 0.1, W * 0.5, 30, 'rgba(90,80,120,A)', 0.6);

  spires(c, W * 0.66, horizon - 26, 220, 150, 'rgba(34,30,52,0.9)');
  fogBlob(c, W / 2, horizon - 30, W, 70, 'rgba(150,160,190,A)', 0.5);
  for (let x = -10; x < W + 30; x += r.between(40, 70)) deadTree(c, r, x, horizon - r.between(0, 16), r.between(110, 170), 'rgba(80,84,110,0.8)');
  fogBlob(c, W / 2, horizon, W * 0.9, 60, 'rgba(150,160,190,A)', 0.4);
  for (let x = 20; x < W; x += r.between(110, 170)) deadTree(c, r, x, horizon + r.between(6, 20), r.between(190, 250), '#1e1e2e');
  // Кромка кустарника у горизонта.
  c.fillStyle = '#1c1c2a';
  for (let x = -20; x < W + 20; x += r.between(30, 50)) {
    c.beginPath();
    c.arc(x, horizon + 12, r.between(14, 26), Math.PI, Math.PI * 2);
    c.fill();
  }
  c.fillRect(0, horizon + 10, W, 10);

  // Земля: сухая трава, выбеленная до пепельного серо-голубого.
  tileFill(c, ground, '#4a4e5e', 0.75, 0, horizon + 16, W, H - horizon);
  c.fillStyle = 'rgba(30,30,52,0.8)';
  c.fillRect(0, horizon + 16, W, H - horizon);
  grain(c, r, 0, horizon + 16, W, H - horizon, 1400, ['rgba(180,190,210,0.12)', 'rgba(10,8,20,0.25)'], 2);
  const haze = c.createLinearGradient(0, horizon, 0, horizon + H * 0.18);
  haze.addColorStop(0, 'rgba(150,160,195,0.6)');
  haze.addColorStop(1, 'rgba(150,160,195,0)');
  c.fillStyle = haze;
  c.fillRect(0, horizon, W, H * 0.18);
  clearing(c, W / 2, H * 0.71, W * 0.48, H * 0.21, 'rgba(120,128,170,A)', 0.2);

  // Могилы, кресты, мёртвые деревья — только края.
  for (const [x, y, s, cr] of [[W * 0.06, H * 0.52, 34, false], [W * 0.15, H * 0.56, 26, true], [W * 0.92, H * 0.55, 36, true], [W * 0.84, H * 0.5, 24, false], [W * 0.05, H * 0.8, 40, true], [W * 0.95, H * 0.84, 42, false], [W * 0.12, H * 0.99, 46, false], [W * 0.88, H * 1.0, 44, true], [W * 0.3, horizon + 50, 20, false], [W * 0.62, horizon + 44, 18, true]] as const) {
    grave(c, r, x, y, s, cr);
  }
  deadTree(c, r, W * 0.02, H * 0.72, 260, '#14141e');
  deadTree(c, r, W * 0.98, H * 0.66, 240, '#14141e');
  // Призрачные огни.
  for (const [x, y, s] of [[W * 0.1, H * 0.45, 5], [W * 0.9, H * 0.47, 6], [W * 0.06, H * 0.66, 5], [W * 0.95, H * 0.74, 5], [W * 0.18, H * 0.9, 6], [W * 0.84, H * 0.93, 5], [W * 0.4, horizon + 24, 4], [W * 0.56, horizon - 10, 3]] as const) {
    wisp(c, x, y, s);
  }
  // Низкий туман по земле — слабый в центре.
  fogBlob(c, W * 0.1, H * 0.62, W * 0.45, 50, 'rgba(170,180,215,A)', 0.26);
  fogBlob(c, W * 0.92, H * 0.76, W * 0.4, 46, 'rgba(170,180,215,A)', 0.24);
  fogBlob(c, W * 0.5, H * 0.99, W * 0.7, 70, 'rgba(170,180,215,A)', 0.26);

  vignette(c, W, H, H * 0.64, W * 0.34, H * 0.72, 'rgba(8,4,18,0.75)');
}

/** Карта «Нифльхейм»: тёмное небо, замок Хель на холме, мёртвый лес в слоях тумана, кладбище и огни внизу. */
export function drawNiflheimMap(c: Ctx, W: number, H: number): void {
  const r = rng(131);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0e0818');
  sky.addColorStop(0.3, '#3a2c56');
  sky.addColorStop(0.55, '#3c4058');
  sky.addColorStop(1, '#0c0c16');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  stars(c, r, W, H * 0.22, 70, '210,220,255');
  orb(c, W * 0.74, H * 0.1, 40, 'rgba(215,222,240,0.85)', 'rgba(160,170,230,A)', 0.4);
  spires(c, W * 0.42, H * 0.34, 340, 220, 'rgba(30,26,48,0.95)');
  fogBlob(c, W / 2, H * 0.35, W, 90, 'rgba(150,160,200,A)', 0.45);
  const layers: Array<[number, string, number, number]> = [
    [0.44, 'rgba(84,88,116,0.8)', 170, 40],
    [0.58, 'rgba(50,52,74,0.95)', 230, 70],
    [0.76, '#1c1c2a', 300, 110],
  ];
  layers.forEach(([k, color, h, step], i) => {
    for (let x = -10; x < W + 30; x += r.between(step * 0.8, step * 1.2)) deadTree(c, r, x, H * k + r.between(-20, 20), r.between(h * 0.8, h * 1.1), color);
    fogBlob(c, W / 2 + r.between(-120, 120), H * k + 20, W * 0.95, 90, 'rgba(150,160,200,A)', 0.32 - i * 0.05);
  });
  // Кладбище внизу.
  const g = c.createLinearGradient(0, H * 0.8, 0, H);
  g.addColorStop(0, '#2a2c3c');
  g.addColorStop(1, '#0e0e18');
  ridge(c, r, W, H * 0.84, 18, H + 20, g);
  for (let i = 0; i < 9; i++) grave(c, r, r.rnd() < 0.5 ? r.between(20, W * 0.25) : r.between(W * 0.75, W - 20), r.between(H * 0.86, H * 0.99), r.between(26, 40), r.rnd() < 0.4);
  // Ближние мёртвые деревья по краям.
  deadTree(c, r, -14, H + 10, H * 0.42, '#07070c');
  deadTree(c, r, W + 12, H + 10, H * 0.38, '#07070c');
  for (let i = 0; i < 16; i++) wisp(c, r.between(30, W - 30), r.between(H * 0.3, H * 0.97), r.between(3, 5));
  vignette(c, W, H, H * 0.5, W * 0.32, H * 0.72, 'rgba(4,0,12,0.65)');
}
