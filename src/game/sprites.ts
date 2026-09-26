import Phaser from 'phaser';
import { buildRegistry, resolveAnim, type AnimName, type LegacySprites, type SpriteDef, type SpritesV2 } from '../pipeline/sprites';

const first = <T>(mods: Record<string, unknown>): T | undefined => Object.values(mods)[0] as T | undefined;

/** Файлов может не быть — glob тогда пустой, и реестр просто без этого источника. */
export const SPRITES = buildRegistry(
  first<LegacySprites>(import.meta.glob('../../assets/sprites.legacy.json', { eager: true, import: 'default' })),
  first<SpritesV2>(import.meta.glob('../../assets/sprites/sprites.json', { eager: true, import: 'default' })),
);

export const spriteKey = (id: string) => `spr_${id}`;
export const portraitKey = (id: string) => `portrait_${id}`;
const animKey = (id: string, name: AnimName) => `spr_${id}:${name}`;

/** Ставит в загрузку только нужные спрайты (старые листы монстров огромные — не грузим зря). */
export function queueSprites(scene: Phaser.Scene, ids: string[]): void {
  for (const id of new Set(ids)) {
    const s = SPRITES[id];
    if (!s) continue;
    scene.load.spritesheet(spriteKey(id), s.file, { frameWidth: s.cell[0], frameHeight: s.cell[1] });
    if (s.portrait) scene.load.image(portraitKey(id), s.portrait);
  }
}

/**
 * После загрузки: анимации, фильтр без сглаживания; для отсутствующих — плейсхолдеры-силуэты цвета роли
 * (roles: id спрайта → tank/damage/healer/support).
 */
export function setupSprites(scene: Phaser.Scene, ids: string[], roles: Record<string, string> = {}): void {
  for (const id of new Set(ids)) {
    const s = SPRITES[id];
    const key = spriteKey(id);
    if (s && scene.textures.exists(key)) {
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      for (const [name, a] of Object.entries(s.anims)) {
        const k = animKey(id, name as AnimName);
        if (scene.anims.exists(k) || !a) continue;
        scene.anims.create({
          key: k,
          frames: Array.from({ length: a.frames }, (_, i) => ({ key, frame: a.row * s.columns + i, duration: a.ms[i] ?? a.ms[0] })),
        });
      }
    } else {
      placeholder(scene, key, 128, 128, roles[id], true);
    }
    const pk = portraitKey(id);
    if (scene.textures.exists(pk)) scene.textures.get(pk).setFilter(Phaser.Textures.FilterMode.NEAREST);
    else if (s && scene.textures.exists(key)) {
      // Портрета нет — берём кадр стойки, обрезанный по фигуре (в клетке листа много пустоты).
      const idle = s.anims.idle;
      const frame = scene.textures.getFrame(key, (idle?.row ?? 0) * s.columns);
      if (frame) portraitFromFrame(scene, pk, key, frame);
    } else placeholder(scene, pk, 128, 128, roles[id], false);
  }
}

/** Портрет из кадра: квадрат вокруг непрозрачных пикселей (один раз при загрузке). */
function portraitFromFrame(scene: Phaser.Scene, pk: string, key: string, frame: Phaser.Textures.Frame): void {
  const w = frame.cutWidth;
  const h = frame.cutHeight;
  const tmp = scene.textures.createCanvas(`${pk}__tmp`, w, h);
  if (!tmp) return;
  tmp.drawFrame(key, frame.name);
  const data = tmp.getContext().getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) {
    x0 = 0;
    y0 = 0;
    x1 = w - 1;
    y1 = h - 1;
  }
  const side = Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.08);
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  const c = scene.textures.createCanvas(pk, side, side);
  if (c) {
    c.getContext().drawImage(tmp.getSourceImage() as HTMLCanvasElement, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side, 0, 0, side, side);
    c.refresh();
    c.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  scene.textures.remove(tmp);
}

/** Цвета ролей для силуэтов-плейсхолдеров: основной и тёмный (контур, фон портрета). */
export const ROLE_COLORS: Record<string, [string, string]> = {
  tank: ['#5b8be0', '#1e3566'],
  damage: ['#e0644f', '#5e2018'],
  healer: ['#5cc26a', '#1c4d24'],
  support: ['#e0b048', '#5a4210'],
};
const NEUTRAL: [string, string] = ['#9a9aa8', '#3a3a44'];

/**
 * Плейсхолдер юнита без арта: силуэт человечка цвета роли с предметом роли
 * (танк — щит, урон — меч, лекарь — посох с крестом, поддержка — флажок).
 * body = true — фигура в полный рост, ноги у низа клетки (как у спрайтов); false — портрет по пояс.
 */
function placeholder(scene: Phaser.Scene, key: string, w: number, h: number, role: string | undefined, body: boolean): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  const ctx = t.getContext();
  const [main, dark] = (role && ROLE_COLORS[role]) || NEUTRAL;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (body) {
    // Тень под ногами.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.94, w * 0.24, h * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    figure(ctx, w * 0.5, h * 0.94, h * 0.78, main, dark);
    prop(ctx, role, w * 0.5, h * 0.94, h * 0.78, main, dark);
  } else {
    // Портрет: круглый тёмный фон и фигура по пояс крупно.
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    figure(ctx, w * 0.5, h * 1.72, h * 1.5, main, dark);
    ctx.restore();
    ctx.strokeStyle = main;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  t.refresh();
}

/** Человечек: ноги, туловище-трапеция, руки, голова. (cx, feet) — точка ног, size — рост. */
function figure(ctx: CanvasRenderingContext2D, cx: number, feet: number, size: number, main: string, dark: string): void {
  const u = size / 100;
  const y = (v: number) => feet - v * u;
  ctx.fillStyle = main;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(2, 3 * u);
  const shape = (draw: () => void) => {
    ctx.beginPath();
    draw();
    ctx.fill();
    ctx.stroke();
  };
  // Ноги.
  shape(() => ctx.roundRect(cx - 14 * u, y(30), 11 * u, 30 * u, 4 * u));
  shape(() => ctx.roundRect(cx + 3 * u, y(30), 11 * u, 30 * u, 4 * u));
  // Руки.
  shape(() => ctx.roundRect(cx - 27 * u, y(70), 10 * u, 34 * u, 5 * u));
  shape(() => ctx.roundRect(cx + 17 * u, y(70), 10 * u, 34 * u, 5 * u));
  // Туловище.
  shape(() => {
    ctx.moveTo(cx - 22 * u, y(72));
    ctx.lineTo(cx + 22 * u, y(72));
    ctx.lineTo(cx + 16 * u, y(28));
    ctx.lineTo(cx - 16 * u, y(28));
    ctx.closePath();
  });
  // Голова.
  shape(() => ctx.arc(cx, y(86), 13 * u, 0, Math.PI * 2));
  // Блик — чтобы силуэт не был плоским.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(cx - 4 * u, y(90), 5 * u, 0, Math.PI * 2);
  ctx.fill();
}

/** Предмет роли в правой руке (или щит спереди у танка). */
function prop(ctx: CanvasRenderingContext2D, role: string | undefined, cx: number, feet: number, size: number, main: string, dark: string): void {
  const u = size / 100;
  const y = (v: number) => feet - v * u;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(2, 3 * u);
  switch (role) {
    case 'tank':
      ctx.fillStyle = '#d8dce6';
      ctx.beginPath();
      ctx.moveTo(cx - 34 * u, y(66));
      ctx.lineTo(cx - 10 * u, y(66));
      ctx.lineTo(cx - 10 * u, y(44));
      ctx.lineTo(cx - 22 * u, y(32));
      ctx.lineTo(cx - 34 * u, y(44));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = main;
      ctx.fillRect(cx - 24 * u, y(60), 4 * u, 20 * u);
      return;
    case 'damage':
      ctx.strokeStyle = '#e8ecf4';
      ctx.lineWidth = Math.max(3, 5 * u);
      ctx.beginPath();
      ctx.moveTo(cx + 24 * u, y(38));
      ctx.lineTo(cx + 40 * u, y(84));
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(2, 4 * u);
      ctx.beginPath();
      ctx.moveTo(cx + 16 * u, y(44));
      ctx.lineTo(cx + 32 * u, y(38));
      ctx.stroke();
      return;
    case 'healer':
      ctx.strokeStyle = '#a07040';
      ctx.lineWidth = Math.max(3, 4 * u);
      ctx.beginPath();
      ctx.moveTo(cx + 30 * u, y(2));
      ctx.lineTo(cx + 30 * u, y(92));
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx + 27 * u, y(104), 6 * u, 16 * u);
      ctx.fillRect(cx + 22 * u, y(99), 16 * u, 6 * u);
      return;
    case 'support':
      ctx.strokeStyle = '#a07040';
      ctx.lineWidth = Math.max(3, 4 * u);
      ctx.beginPath();
      ctx.moveTo(cx + 30 * u, y(10));
      ctx.lineTo(cx + 30 * u, y(96));
      ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.moveTo(cx + 31 * u, y(96));
      ctx.lineTo(cx + 50 * u, y(88));
      ctx.lineTo(cx + 31 * u, y(78));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
  }
}

/** Всё, что нужно сцене, чтобы поставить спрайт юнита. */
export interface SpriteView {
  key: string;
  /** Высота клетки на экране. */
  size: number;
  /** Высота фигуры над ногами на экране (макушка) — для подписи, полосок и центра тела. */
  height: number;
  /** Смещение origin, чтобы ноги стояли в точке юнита. */
  originX: number;
  originY: number;
  def?: SpriteDef;
  /** true — настоящий арт (его можно отражать); false — плейсхолдер с подписью. */
  art: boolean;
}

export function spriteView(scene: Phaser.Scene, id: string): SpriteView {
  const s = SPRITES[id];
  const key = spriteKey(id);
  if (s && scene.anims.exists(animKey(id, 'idle'))) {
    const size = s.cell[1] * s.scale;
    const originY = s.anchor[1] / s.cell[1];
    // Нет bbox (старые листы) — считаем, что фигура занимает 85% клетки над ногами.
    const height = s.top !== undefined ? s.top * s.scale : Math.min(size * originY * 0.85, 240);
    return { key, size, height, originX: s.anchor[0] / s.cell[0], originY, def: s, art: true };
  }
  return { key, size: 200, height: 160, originX: 0.5, originY: 0.94, art: false };
}

/** Ключ анимации с учётом замен или null, если у спрайта нет ни её, ни замены. */
export function anim(view: SpriteView, id: string, name: AnimName): string | null {
  const n = resolveAnim(view.def, name);
  return view.art && n ? animKey(id, n) : null;
}

/** Через сколько мс после начала анимации удар касается цели. */
export function hitDelay(view: SpriteView, name: AnimName): number {
  const a = view.def?.anims[resolveAnim(view.def, name) ?? 'attack'];
  if (!a) return 0;
  const hit = a.hitFrame ?? Math.floor(a.frames / 2);
  return a.ms.slice(0, hit).reduce((s, v) => s + v, 0);
}
