import Phaser from 'phaser';
import { buildRegistry, resolveAnim, type AnimName, type LegacySprites, type SpriteDef, type SpriteFixes, type SpritesV2 } from '../pipeline/sprites';
import { assetUrl } from './assetUrl';
import { FONT, GAME_H, GAME_W } from './layout';
import { SheetLru, textureBytes } from './spriteCache';
import { setSpriteLookup } from './spriteRegistry';

const first = <T>(mods: Record<string, unknown>): T | undefined => Object.values(mods)[0] as T | undefined;

/** Файлов может не быть — glob тогда пустой, и реестр просто без этого источника. */
export const SPRITES = buildRegistry(
  first<LegacySprites>(import.meta.glob('../../assets/sprites.legacy.json', { eager: true, import: 'default' })),
  first<SpritesV2>(import.meta.glob('../../assets/sprites/sprites.json', { eager: true, import: 'default' })),
  first<SpriteFixes>(import.meta.glob('../../assets/sprites/fixes.json', { eager: true, import: 'default' })),
);
// Листы героев по полу (<спрайт>_f / _m) ищут чистые помощники flow.ts / storyView через spriteRegistry.
setSpriteLookup((id) => !!SPRITES[id]);

export const spriteKey = (id: string) => `spr_${id}`;
export const portraitKey = (id: string) => `portrait_${id}`;
const animKey = (id: string, name: AnimName) => `spr_${id}:${name}`;

/** Размер сгенерированного портрета (канвас): дёшево держать все, экранам-спискам не нужны листы. */
export const PORTRAIT_SIZE = 160;
const PENDING_PORTRAIT = 'portrait__pending';
const OVERLAY_DELAY_MS = 150;

/** U. Листы юнитов в памяти: LRU с бюджетом и удержаниями активных сцен. */
const lru = new SheetLru();
/** Загрузки листов в процессе: id → промис. */
const inflight = new Map<string, Promise<void>>();
/** Роли спрайтов (id → tank/damage/…) — цвет плейсхолдера, если листа нет или он не загрузился. */
let roles: Record<string, string> = {};

export const isPortraitKey = (key: string) => key.startsWith('portrait_') && key !== PENDING_PORTRAIT;
const idOfPortraitKey = (key: string) => key.slice('portrait_'.length);
const sheetLoaded = (game: Phaser.Game, id: string) => game.textures.exists(spriteKey(id));

/**
 * При старте (BootScene): только файлы портретов (маленькие) — листы юнитов грузятся по требованию
 * (whenSprites / ensureSprites / requestPortrait).
 */
export function queuePortraitFiles(scene: Phaser.Scene, ids: string[]): void {
  for (const id of new Set(ids)) {
    const s = SPRITES[id];
    if (s?.portrait) scene.load.image(portraitKey(id), s.portrait);
  }
}

/**
 * После загрузки BootScene: запомнить роли; фильтр портретов-файлов; силуэты-плейсхолдеры для спрайтов без листа
 * (spriteRoles: id спрайта → tank/damage/healer/support).
 */
export function setupSprites(scene: Phaser.Scene, spriteRoles: Record<string, string>): void {
  roles = spriteRoles;
  const tm = scene.textures;
  for (const id of Object.keys(spriteRoles)) {
    const pk = portraitKey(id);
    if (tm.exists(pk)) tm.get(pk).setFilter(Phaser.Textures.FilterMode.NEAREST);
    if (SPRITES[id]) continue;
    placeholder(tm, spriteKey(id), 128, 128, roles[id], true);
    placeholder(tm, pk, 128, 128, roles[id], false);
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = assetUrl(url);
  });
}

/**
 * Загрузить лист. Не загрузчиком сцены: тот сбрасывается при выключении сцены, а лист нужен и следующей.
 * Не загрузился — плейсхолдер (как раньше в BootScene).
 */
function loadSheet(game: Phaser.Game, id: string): Promise<void> {
  if (sheetLoaded(game, id)) return Promise.resolve();
  const running = inflight.get(id);
  if (running) return running;
  const s = SPRITES[id];
  const p = loadImage(s.file).then((img) => {
    inflight.delete(id);
    const tm = game.textures;
    if (sheetLoaded(game, id)) return;
    if (!img) {
      console.warn(`Лист ${s.file} не загрузился, рисую плейсхолдер`);
      placeholder(tm, spriteKey(id), 128, 128, roles[id], true);
      placeholder(tm, portraitKey(id), 128, 128, roles[id], false);
      return;
    }
    const key = spriteKey(id);
    const tex = tm.addSpriteSheet(key, img, { frameWidth: s.cell[0], frameHeight: s.cell[1] });
    if (!tex) return;
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const [name, a] of Object.entries(s.anims)) {
      const k = animKey(id, name as AnimName);
      if (game.anims.exists(k) || !a) continue;
      game.anims.create({
        key: k,
        frames: Array.from({ length: a.frames }, (_, i) => ({ key, frame: a.row * s.columns + (a.cols?.[i] ?? i), duration: a.ms[i] ?? a.ms[0] })),
      });
    }
    const pk = portraitKey(id);
    if (!tm.exists(pk)) {
      // Портрета нет — берём кадр стойки, обрезанный по фигуре (в клетке листа много пустоты). Один раз и навсегда.
      const frame = tm.getFrame(key, (s.anims.idle?.row ?? 0) * s.columns);
      if (frame) portraitFromFrame(tm, pk, key, frame);
    }
    lru.add(id, textureBytes(img.width, img.height));
  });
  inflight.set(id, p);
  return p;
}

/** Выгрузить лист: анимации и текстура (портрет остаётся). */
function unloadSheet(game: Phaser.Game, id: string): void {
  // destroy, а не anims.remove: remove только вынимает анимацию из менеджера, а её слушатели pauseall/resumeall
  // остаются на нём навсегда (утечка по 2 слушателя на анимацию при каждой выгрузке листа — npm run perf).
  for (const name of Object.keys(SPRITES[id]?.anims ?? {})) game.anims.get(animKey(id, name as AnimName))?.destroy();
  if (sheetLoaded(game, id)) game.textures.remove(spriteKey(id));
}

function trim(game: Phaser.Game): void {
  for (const id of lru.trim()) unloadSheet(game, id);
}

/** Какие листы держит каждая сцена до своего выключения; поколение — чтобы опоздавшая загрузка не строила старую сцену. */
const holds = new Map<Phaser.Scene, Set<string>>();
const generation = new Map<Phaser.Scene, number>();
const genOf = (scene: Phaser.Scene) => generation.get(scene) ?? 0;

function holdFor(scene: Phaser.Scene, ids: string[]): void {
  let set = holds.get(scene);
  if (!set) {
    const own = new Set<string>();
    set = own;
    holds.set(scene, own);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      holds.delete(scene);
      generation.set(scene, genOf(scene) + 1);
      for (const id of own) lru.release(id);
      trim(scene.game);
    });
  }
  for (const id of ids) {
    if (set.has(id)) continue;
    set.add(id);
    lru.hold(id);
  }
}

/** «Загрузка…» поверх сцены, если листы грузятся дольше OVERLAY_DELAY_MS. Возвращает «убрать». */
function loadingOverlay(scene: Phaser.Scene): () => void {
  let layer: Phaser.GameObjects.Container | null = null;
  const gen = genOf(scene);
  const timer = setTimeout(() => {
    if (!scene.sys.isActive() || genOf(scene) !== gen) return;
    const width = GAME_W;
    const height = GAME_H;
    const shade = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.45).setInteractive();
    const label = scene.add
      .text(width / 2, height / 2, 'Загрузка…', { fontFamily: FONT, fontSize: '52px', color: '#ffffff', stroke: '#000000', strokeThickness: 8 })
      .setOrigin(0.5);
    layer = scene.add.container(0, 0, [shade, label]).setDepth(20000).setName('spritesLoading');
  }, OVERLAY_DELAY_MS);
  return () => {
    clearTimeout(timer);
    if (layer?.scene) layer.destroy();
    layer = null;
  };
}

/**
 * U. Листы юнитов для сцены: грузит недостающие и держит их до выключения сцены (потом они уходят в LRU
 * с бюджетом SHEET_BUDGET_BYTES, самые давние выгружаются). Всё уже в памяти — ready вызывается сразу
 * (в том же кадре, без мигания); иначе — после загрузки, если сцена ещё та же. Дольше 150 мс — «Загрузка…».
 */
export function whenSprites(scene: Phaser.Scene, ids: string[], ready: () => void): void {
  const game = scene.game;
  const want = [...new Set(ids)].filter((id) => SPRITES[id]);
  holdFor(scene, want);
  for (const id of want) lru.touch(id);
  const missing = want.filter((id) => !sheetLoaded(game, id));
  if (!missing.length) {
    ready();
    return;
  }
  const gen = genOf(scene);
  const done = loadingOverlay(scene);
  void Promise.all(missing.map((id) => loadSheet(game, id))).then(() => {
    done();
    trim(game);
    if (genOf(scene) === gen && scene.sys.isActive()) ready();
  });
}

/** То же промисом. Сцену выключили до конца загрузки — тоже разрешается (строить уже нечего). */
export function ensureSprites(scene: Phaser.Scene, ids: string[]): Promise<void> {
  return new Promise((resolve) => {
    const gen = genOf(scene);
    whenSprites(scene, ids, resolve);
    if (genOf(scene) === gen) scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => resolve());
  });
}

/** Портреты генерируются по одному: пиковая память — один лист. */
let portraitChain: Promise<void> = Promise.resolve();
const portraitWaits = new Map<string, Promise<void>>();

/**
 * Портрет спрайта (portrait_<id>): есть — сразу; нет — загрузить лист, вырезать портрет и, если лист больше
 * никому не нужен, сразу выгрузить (спискам героев листы не нужны).
 */
export function requestPortrait(game: Phaser.Game, id: string): Promise<void> {
  const pk = portraitKey(id);
  if (game.textures.exists(pk)) return Promise.resolve();
  if (!SPRITES[id]) {
    placeholder(game.textures, pk, 128, 128, roles[id], false);
    return Promise.resolve();
  }
  const running = portraitWaits.get(id);
  if (running) return running;
  const p = portraitChain
    .then(async () => {
      if (game.textures.exists(pk)) return;
      const had = sheetLoaded(game, id);
      await loadSheet(game, id);
      if (!had && !lru.isHeld(id)) {
        lru.delete(id);
        unloadSheet(game, id);
      }
    })
    .finally(() => portraitWaits.delete(id));
  portraitChain = p;
  portraitWaits.set(id, p);
  return p;
}

/** Заглушка на время генерации портрета — нейтральный силуэт. */
function pendingPortrait(tm: Phaser.Textures.TextureManager): string {
  placeholder(tm, PENDING_PORTRAIT, 128, 128, undefined, false);
  return PENDING_PORTRAIT;
}

/**
 * Портрет portrait_<id> на картинке: уже есть — ничего не делает; нет — ставит заглушку и подменяет,
 * когда портрет готов (onReady — пересчитать размер).
 */
export function lazyPortrait(scene: Phaser.Scene, key: string, img: Phaser.GameObjects.Image, onReady: () => void): void {
  if (scene.textures.exists(key) || !isPortraitKey(key)) return;
  img.setTexture(pendingPortrait(scene.textures));
  void requestPortrait(scene.game, idOfPortraitKey(key)).then(() => {
    if (!img.scene || !scene.textures.exists(key)) return;
    img.setTexture(key);
    onReady();
  });
}

/** Идёт ли загрузка листов (для e2e/perf: экран «досчитался»). */
export const spritesBusy = () => inflight.size > 0 || portraitWaits.size > 0;

/** Сводка кэша листов (отладка, perf). */
export const spriteStats = () => ({ sheets: lru.ids(), bytes: lru.bytes, budget: lru.budget });

/** Портрет из кадра: квадрат вокруг непрозрачных пикселей, уменьшенный до PORTRAIT_SIZE (один раз на спрайт). */
function portraitFromFrame(tm: Phaser.Textures.TextureManager, pk: string, key: string, frame: Phaser.Textures.Frame): void {
  const w = frame.cutWidth;
  const h = frame.cutHeight;
  const tmp = tm.createCanvas(`${pk}__tmp`, w, h);
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
  const out = Math.min(side, PORTRAIT_SIZE);
  const c = tm.createCanvas(pk, out, out);
  if (c) {
    const ctx = c.getContext();
    // Уменьшаем со сглаживанием (без «лесенки»), в родном размере — как есть.
    ctx.imageSmoothingEnabled = out < side;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp.getSourceImage() as HTMLCanvasElement, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side, 0, 0, out, out);
    c.refresh();
    c.setFilter(out < side ? Phaser.Textures.FilterMode.LINEAR : Phaser.Textures.FilterMode.NEAREST);
  }
  tm.remove(tmp);
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
function placeholder(tm: Phaser.Textures.TextureManager, key: string, w: number, h: number, role: string | undefined, body: boolean): void {
  if (tm.exists(key)) return;
  const t = tm.createCanvas(key, w, h);
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
