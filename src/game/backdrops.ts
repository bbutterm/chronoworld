import Phaser from 'phaser';
import { chapterTheme, towerFloor, type ChapterTheme } from '../core';
import { CONTENT, GAME } from './content';
import { GAME_H, GAME_W } from './layout';
import {
  deadTree,
  drawDesertField,
  drawDesertMap,
  drawGroveField,
  drawGroveMap,
  drawNiflheimField,
  drawNiflheimMap,
  drawShipwreckField,
  drawShipwreckMap,
  fogBlob,
  glow,
  rng,
  tileFill,
  vignette,
  type Ctx,
  type Rng,
} from './backdropsExtra';
import { drawClockField, drawClockMap, drawOrcField, drawOrcMap, drawSewerField, drawSewerMap } from './backdropsRoute';
import { bleedImage } from './viewport';
import { BackgroundCache, type BackgroundKind } from './backgroundCache';

/**
 * Фоны по темам (визуальная полировка): поле боя и карта кампании для каждой темы. Тема главы — поле theme в
 * data/campaign (иначе по id слота, chapterTheme в ядре), а не место главы в кампании: слоты маршрута из 10 глав
 * переезжают (docs/design/lore-route.md §4.2), арт и музыка едут вместе с содержимым.
 *   meadow — Поля Пронтеры (гл. 1) и лесной ярус башни (skin_bg_battle, skin_bg_forest из skin.ts);
 *   sewer — канализация Пронтеры (гл. 2), orc — орочья деревня (гл. 3), clocktower — часовая башня Альдебарана (гл. 7):
 *     временные нарисованные фоны (backdropsRoute.ts);
 *   desert (гл. 4), grove (гл. 5), shipwreck (гл. 6), niflheim (гл. 10 и «Ярус владык») — backdropsExtra.ts;
 *   crypt — Гласт Хейм (гл. 8) и костяной ярус; swamp — болотный ярус башни (бывшие «Проклятые топи»);
 *   labyrinth — Лабиринтный лес (гл. 9, пока нет): до своего рисунка — мёртвый лес топей.
 *
 * Всё рисуется кодом в canvas 720×1280 (как фоны скина), лениво — при первом показе темы. Чтобы не копить
 * видеопамять (≈ 3.7 МБ на фон), держим не больше одного запасного фона каждого вида (бой / карта). Фоны живых
 * изображений остаются до их удаления или замены: баннеры «Приключений» показывают разные темы одновременно.
 * Если владелец положит файл assets/backgrounds/bg_battle_ch<N>.(jpg|png|webp) или bg_map_ch<N>.*
 * (N — номер главы на маршруте, THEME_FILE_NO), он побеждает: грузится по требованию и подменяет нарисованный.
 */

export type Theme = ChapterTheme;
/** Номер главы маршрута для файлов фона темы (bg_battle_ch<N> / bg_map_ch<N>); swamp — бывшая глава 2 («swamp»). */
const THEME_FILE: Record<Theme, string> = {
  meadow: 'ch1',
  sewer: 'ch2',
  orc: 'ch3',
  desert: 'ch4',
  grove: 'ch5',
  shipwreck: 'ch6',
  clocktower: 'ch7',
  crypt: 'ch8',
  labyrinth: 'ch9',
  niflheim: 'ch10',
  swamp: 'swamp',
};
/** Темы полос башни по порядку (лесной, болотный, костяной ярус, «Ярус владык»); дальше — последняя. */
const TOWER_THEMES: readonly Theme[] = ['meadow', 'swamp', 'crypt', 'niflheim'];
type Kind = BackgroundKind;

const FIELD_W = GAME_W;
const FIELD_H = GAME_H;
const BG_W = 720;
const BG_H = 1280;

/** Файлы фонов от художника (если есть): имя без расширения → URL от корня assets. */
const FILES: Record<string, string> = {};
for (const path of Object.keys(import.meta.glob('../../assets/backgrounds/bg_{battle,map}_{ch*,swamp}.{jpg,png,webp}', { query: '?url', import: 'default' }))) {
  const name = path.split('/').pop()!;
  FILES[name.replace(/\.(jpg|png|webp)$/, '')] = `backgrounds/${name}`;
}

/** Тема главы: поле theme главы (data/campaign), иначе тема слота по id (ядро, chapterTheme), неизвестная — луг. */
export function themeOfChapter(chapterId: string | undefined): Theme {
  return chapterTheme(CONTENT.chapters.find((c) => c.id === chapterId));
}

/** Тема этажа башни — по его полосе (лесной, болотный, костяной ярус, «Ярус владык» — Нифльхейм). */
export function themeOfTowerFloor(floor: number): Theme {
  try {
    return TOWER_THEMES[Math.min(towerFloor(floor, GAME).band, TOWER_THEMES.length - 1)];
  } catch {
    return 'meadow';
  }
}

/** Тема боя: этап — по главе, башня — по полосе этажа, тестовый бой — луг. */
export function themeOfBattle(o: { stageId?: string; towerFloor?: number }): Theme {
  if (o.stageId) return themeOfChapter(CONTENT.stages.find((s) => s.id === o.stageId)?.chapter);
  if (o.towerFloor) return themeOfTowerFloor(o.towerFloor);
  return 'meadow';
}

/** Ключ нарисованного фона темы. Луг — фоны скина, построенные при загрузке. */
const drawnKey = (kind: Kind, t: Theme) => (t === 'meadow' ? (kind === 'battle' ? 'skin_bg_battle' : 'skin_bg_forest') : `skin_bg_${kind}_${t}`);

/** A game owns its textures. Another game must never evict them through a shared module cache. */
const caches = new WeakMap<Phaser.Game, BackgroundCache<Phaser.GameObjects.Image>>();
const loading = new WeakMap<Phaser.Game, Map<string, Promise<HTMLImageElement | null>>>();
const uses = new WeakMap<Phaser.GameObjects.Image, { generation: number; cache: BackgroundCache<Phaser.GameObjects.Image> }>();

/** Фоны скина, построенные при загрузке (нужны и другим экранам) — их не вытесняем. */
const BOOT_KEYS = new Set(['skin_bg_battle', 'skin_bg_forest', 'bg_arena']);

function evict(game: Phaser.Game, keys: string[]): void {
  for (const key of keys) if (game.textures.exists(key)) game.textures.remove(key);
}

/** Switch the image first, then release its old source; live frames must never refer to a deleted texture. */
function useTexture(bg: Phaser.GameObjects.Image, kind: Kind, key: string): void {
  const game = bg.scene.game;
  let use = uses.get(bg);
  if (!use) {
    let cache = caches.get(game);
    if (!cache) {
      cache = new BackgroundCache();
      caches.set(game, cache);
    }
    use = { generation: 0, cache };
    uses.set(bg, use);
    const own = use;
    bg.once(Phaser.GameObjects.Events.DESTROY, () => {
      own.generation++;
      evict(game, own.cache.release(bg));
      uses.delete(bg);
    });
  }
  bg.setTexture(key).setDisplaySize(FIELD_W, FIELD_H);
  evict(game, use.cache.bind(bg, kind, BOOT_KEYS.has(key) ? null : key));
}

/** All images awaiting one file share the download, then each checks its own lifetime and request generation. */
function loadBackground(game: Phaser.Game, fileId: string): Promise<HTMLImageElement | null> {
  let requests = loading.get(game);
  if (!requests) {
    requests = new Map();
    loading.set(game, requests);
  }
  const existing = requests.get(fileId);
  if (existing) return existing;
  const own = requests;
  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => {
      console.warn(`Фон ${FILES[fileId]} не загрузился — остаётся нарисованный`);
      resolve(null);
    };
    el.src = FILES[fileId];
  }).finally(() => own.delete(fileId));
  own.set(fileId, request);
  return request;
}

function drawn(scene: Phaser.Scene, kind: Kind, t: Theme): string {
  const key = drawnKey(kind, t);
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, BG_W, BG_H);
  if (!tex) return kind === 'battle' ? 'bg_arena' : 'skin_bg_forest';
  const ctx = tex.getContext();
  const img = (k: string) => (scene.textures.exists(k) ? (scene.textures.get(k).getSourceImage() as CanvasImageSource) : null);
  if (kind === 'battle') {
    if (t === 'swamp' || t === 'labyrinth') drawSwampField(ctx, BG_W, BG_H, img('tile_grass_02'), img('tile_dirt'));
    else if (t === 'sewer') drawSewerField(ctx, BG_W, BG_H, img('tile_stone'));
    else if (t === 'orc') drawOrcField(ctx, BG_W, BG_H, img('tile_grass_dry'));
    else if (t === 'clocktower') drawClockField(ctx, BG_W, BG_H, null);
    else if (t === 'desert') drawDesertField(ctx, BG_W, BG_H);
    else if (t === 'grove') drawGroveField(ctx, BG_W, BG_H, img('tile_grass_02'));
    else if (t === 'shipwreck') drawShipwreckField(ctx, BG_W, BG_H);
    else if (t === 'niflheim') drawNiflheimField(ctx, BG_W, BG_H, img('tile_grass_dry'));
    else drawCryptField(ctx, BG_W, BG_H, img('tile_stone'));
  } else if (t === 'swamp' || t === 'labyrinth') drawSwampMap(ctx, BG_W, BG_H);
  else if (t === 'sewer') drawSewerMap(ctx, BG_W, BG_H);
  else if (t === 'orc') drawOrcMap(ctx, BG_W, BG_H);
  else if (t === 'clocktower') drawClockMap(ctx, BG_W, BG_H);
  else if (t === 'desert') drawDesertMap(ctx, BG_W, BG_H);
  else if (t === 'grove') drawGroveMap(ctx, BG_W, BG_H);
  else if (t === 'shipwreck') drawShipwreckMap(ctx, BG_W, BG_H);
  else if (t === 'niflheim') drawNiflheimMap(ctx, BG_W, BG_H);
  else drawCryptMap(ctx, BG_W, BG_H);
  tex.refresh();
  return key;
}

/**
 * Полноэкранный фон темы (1080×1920 по центру поля — viewport.ts продолжит его на поля вытянутых экранов).
 * kind: 'battle' — поле боя (центр y ≈ 900–1840 спокойный), 'map' — карта кампании.
 */
export function addThemeBackground(scene: Phaser.Scene, kind: Kind, t: Theme, alpha = 1): Phaser.GameObjects.Image {
  const bg = scene.add.image(FIELD_W / 2, FIELD_H / 2, '__DEFAULT').setAlpha(alpha);
  setThemeBackground(bg, kind, t);
  // Сцена уже построена (бой строится после загрузки листов, позже create) — viewport.ts её фоны уже продолжил
  // на поля; этот продолжаем сами, иначе на вытянутых экранах над и под полем — пустые полосы.
  if (scene.sys.settings.status === Phaser.Scenes.RUNNING) bleedImage(scene, bg);
  return bg;
}

/**
 * Поставить фон темы на готовую полноэкранную картинку (фон каркаса screen(): карта кампании, «Глава пройдена»).
 * Вызывать в create() — до того, как viewport.ts продолжит фон на поля.
 */
export function setThemeBackground(bg: Phaser.GameObjects.Image, kind: Kind, t: Theme): Phaser.GameObjects.Image {
  const scene = bg.scene;
  const fileId = `bg_${kind}_${THEME_FILE[t]}`;
  const key = scene.textures.exists(fileId) ? fileId : drawn(scene, kind, t);
  useTexture(bg, kind, key);
  const use = uses.get(bg)!;
  const gen = ++use.generation;
  if (FILES[fileId] && !scene.textures.exists(fileId)) {
    void loadBackground(scene.game, fileId).then((el) => {
      // A destroyed or repurposed image must not resurrect an unused texture or replace its newer theme.
      if (!el || !bg.scene || uses.get(bg) !== use || use.generation !== gen) return;
      const tm = bg.scene.textures;
      if (!tm.exists(fileId)) tm.addImage(fileId, el);
      useTexture(bg, kind, fileId);
      // Поля вытянутого экрана уже продолжали прежний фон — продолжить новый.
      if (bg.getData('bleed')) bleedImage(bg.scene, bg);
    });
  }
  return bg;
}

/** Фон каркаса screen() на сцене (skin_bg_forest), если он есть. */
export function screenBackground(scene: Phaser.Scene): Phaser.GameObjects.Image | undefined {
  return scene.children.list.find((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image && o.texture.key === 'skin_bg_forest');
}

// ---------------------------------------------------------------------------------------------------------------
// Рисование. Всё детерминированно (свой seed) — фон одинаков при каждом запуске.
// ---------------------------------------------------------------------------------------------------------------

/** Лужа стоячей воды: тёмная гладь, светлая кромка, блики, кувшинки. */
function pool(c: Ctx, r: Rng, x: number, y: number, rx: number, ry: number): void {
  c.save();
  c.fillStyle = 'rgba(30,38,22,0.55)';
  c.beginPath();
  c.ellipse(x, y + ry * 0.12, rx * 1.08, ry * 1.12, 0, 0, Math.PI * 2);
  c.fill();
  const g = c.createLinearGradient(0, y - ry, 0, y + ry);
  g.addColorStop(0, '#2b3d38');
  g.addColorStop(1, '#152320');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(120,140,100,0.45)';
  c.lineWidth = 2;
  c.stroke();
  // Отблеск неба.
  c.strokeStyle = 'rgba(190,210,190,0.18)';
  c.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const ly = y - ry * 0.4 + i * ry * 0.3;
    const lw = rx * r.between(0.3, 0.6);
    const lx = x + r.between(-rx * 0.3, rx * 0.2);
    c.beginPath();
    c.moveTo(lx - lw / 2, ly);
    c.lineTo(lx + lw / 2, ly);
    c.stroke();
  }
  // Кувшинки.
  const pads = Math.round(r.between(1, 4));
  for (let i = 0; i < pads; i++) {
    const px = x + r.between(-rx * 0.6, rx * 0.6);
    const py = y + r.between(-ry * 0.4, ry * 0.4);
    const pr = r.between(6, 11);
    const a = r.between(0, Math.PI * 2);
    c.fillStyle = '#3f6a34';
    c.beginPath();
    c.ellipse(px, py, pr, pr * 0.55, 0, a + 0.35, a + Math.PI * 2 - 0.35);
    c.lineTo(px, py);
    c.closePath();
    c.fill();
    if (r.rnd() < 0.3) {
      c.fillStyle = '#e8c8d8';
      c.beginPath();
      c.arc(px + pr * 0.2, py - pr * 0.1, 3, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}

/** Пучок камыша с рогозом. */
function reeds(c: Ctx, r: Rng, x: number, y: number, h: number): void {
  const n = Math.round(r.between(5, 9));
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const bx = x + r.between(-h * 0.15, h * 0.15);
    const lean = r.between(-h * 0.25, h * 0.25);
    const hh = h * r.between(0.6, 1);
    c.strokeStyle = i % 2 ? '#4a5a2c' : '#39462a';
    c.lineWidth = r.between(2, 3.5);
    c.beginPath();
    c.moveTo(bx, y);
    c.quadraticCurveTo(bx + lean * 0.3, y - hh * 0.6, bx + lean, y - hh);
    c.stroke();
    if (r.rnd() < 0.45) {
      // Рогоз — коричневая «сосиска» на верхушке.
      c.fillStyle = '#5a3a22';
      c.save();
      c.translate(bx + lean * 0.85, y - hh * 0.88);
      c.rotate(Math.atan2(lean, hh) * 0.8);
      c.beginPath();
      c.ellipse(0, 0, 3.5, h * 0.09, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }
}

/** Поле боя «топь»: мёртвый лес в тумане, мутная трава, грязная гать в центре, лужи и камыш по краям. */
export function drawSwampField(c: Ctx, W: number, H: number, grass: CanvasImageSource | null, dirt: CanvasImageSource | null): void {
  const r = rng(47);
  const horizon = H * 0.36;

  // Небо: болезненно-бледное, с мутным солнцем.
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#34423a');
  sky.addColorStop(0.7, '#6f7f6c');
  sky.addColorStop(1, '#9aa892');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 10);
  glow(c, W * 0.3, H * 0.12, W * 0.3, 'rgba(220,230,190,A)', 0.25);

  // Дальний мёртвый лес в дымке, затем ближе и темнее.
  for (let x = -10; x < W + 30; x += r.between(40, 70)) deadTree(c, r, x, horizon - r.between(0, 20), r.between(120, 180), 'rgba(88,104,90,0.8)');
  fogBlob(c, W / 2, horizon - 40, W * 0.9, 70, 'rgba(170,185,160,A)', 0.45);
  for (let x = 10; x < W; x += r.between(90, 150)) deadTree(c, r, x, horizon + r.between(0, 15), r.between(190, 260), '#3a4636', 'rgba(90,110,70,0.8)');
  // Кромка кустарника на горизонте.
  c.fillStyle = '#2f3b2c';
  for (let x = -20; x < W + 20; x += r.between(30, 50)) {
    c.beginPath();
    c.arc(x, horizon + 6, r.between(18, 34), Math.PI, Math.PI * 2);
    c.fill();
  }
  c.fillRect(0, horizon + 4, W, 10);

  // Мутная трава.
  tileFill(c, grass, '#4d5a38', 0.7, 0, horizon, W, H - horizon);
  c.fillStyle = 'rgba(34,44,22,0.58)';
  c.fillRect(0, horizon, W, H - horizon);
  const haze = c.createLinearGradient(0, horizon, 0, horizon + H * 0.16);
  haze.addColorStop(0, 'rgba(170,185,160,0.6)');
  haze.addColorStop(1, 'rgba(170,185,160,0)');
  c.fillStyle = haze;
  c.fillRect(0, horizon, W, H * 0.16);

  // Лужи — по краям и у горизонта (центр поля свободен).
  pool(c, r, W * 0.5, horizon + 70, W * 0.3, 26);
  pool(c, r, W * 0.08, H * 0.55, 90, 36);
  pool(c, r, W * 0.95, H * 0.63, 100, 40);
  pool(c, r, W * 0.06, H * 0.84, 110, 42);
  pool(c, r, W * 0.93, H * 0.95, 120, 44);

  // Грязная гать в центре: земля, притемнённая до болотной грязи, мягкий край.
  const cx = W / 2;
  const cy = H * 0.7;
  const rx = W * 0.46;
  const ry = H * 0.21;
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const l = layer.getContext('2d');
  if (l) {
    tileFill(l, dirt, '#5a4a32', 0.8, 0, 0, W, H);
    l.fillStyle = 'rgba(46,40,20,0.3)';
    l.fillRect(0, 0, W, H);
    // Тёмные мокрые пятна грязи.
    for (let i = 0; i < 26; i++) {
      l.fillStyle = `rgba(28,26,16,${r.between(0.12, 0.28)})`;
      l.beginPath();
      l.ellipse(r.between(cx - rx, cx + rx), r.between(cy - ry, cy + ry), r.between(20, 60), r.between(8, 18), 0, 0, Math.PI * 2);
      l.fill();
    }
    l.globalCompositeOperation = 'destination-in';
    l.save();
    l.translate(cx, cy);
    l.scale(1, ry / rx);
    const m = l.createRadialGradient(0, 0, rx * 0.5, 0, 0, rx);
    m.addColorStop(0, 'rgba(0,0,0,0.92)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = m;
    l.fillRect(-rx, -rx, rx * 2, rx * 2);
    l.restore();
    c.drawImage(layer, 0, 0);
  }
  // Доски гати поперёк грязи — у краёв площадки, чтобы не мешать фигурам.
  const plank = (x: number, y: number, w: number, a: number) => {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(-w / 2 + 2, -5, w, 14);
    c.fillStyle = '#4a3a26';
    c.fillRect(-w / 2, -7, w, 12);
    c.fillStyle = 'rgba(255,230,190,0.12)';
    c.fillRect(-w / 2, -7, w, 3);
    c.restore();
  };
  for (let i = 0; i < 5; i++) plank(r.between(W * 0.1, W * 0.22), H * 0.58 + i * 22, r.between(60, 90), r.between(-0.12, 0.12));
  for (let i = 0; i < 4; i++) plank(r.between(W * 0.78, W * 0.9), H * 0.8 + i * 22, r.between(60, 90), r.between(-0.12, 0.12));

  // Камыш по краям.
  for (const [x, y, h] of [[20, H * 0.5, 90], [60, H * 0.62, 70], [W - 30, H * 0.56, 100], [W - 70, H * 0.7, 80], [30, H * 0.92, 120], [110, H * 0.99, 90], [W - 40, H * 0.88, 110], [W - 120, H * 1.0, 100], [W * 0.3, horizon + 40, 60], [W * 0.72, horizon + 50, 70]] as const) {
    reeds(c, r, x, y, h);
  }
  // Пни.
  const stump = (x: number, y: number, s: number) => {
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath();
    c.ellipse(x, y + 2, s * 1.2, s * 0.35, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#3a2e22';
    c.fillRect(x - s * 0.7, y - s * 1.1, s * 1.4, s * 1.1);
    c.fillStyle = '#5a4832';
    c.beginPath();
    c.ellipse(x, y - s * 1.1, s * 0.7, s * 0.25, 0, 0, Math.PI * 2);
    c.fill();
  };
  stump(W * 0.15, H * 0.47, 16);
  stump(W * 0.86, H * 0.5, 20);

  // Полосы низкого тумана (слабые — фигуры должны читаться).
  fogBlob(c, W * 0.15, H * 0.6, W * 0.4, 40, 'rgba(190,205,185,A)', 0.22);
  fogBlob(c, W * 0.9, H * 0.75, W * 0.35, 38, 'rgba(190,205,185,A)', 0.2);
  fogBlob(c, W * 0.5, H * 0.98, W * 0.6, 60, 'rgba(190,205,185,A)', 0.22);

  vignette(c, W, H, H * 0.64, W * 0.38, H * 0.72, 'rgba(6,14,8,0.62)');
}

/** Кость: палочка с утолщениями на концах. */
function bone(c: Ctx, x: number, y: number, len: number, ang: number, color = '#bdb39c'): void {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(-len / 2 + 2, -1, len, 5);
  c.fillStyle = color;
  c.fillRect(-len / 2, -2.5, len, 5);
  for (const e of [-len / 2, len / 2]) {
    c.beginPath();
    c.arc(e, -2.5, 3.5, 0, Math.PI * 2);
    c.arc(e, 2.5, 3.5, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** Череп: купол, скулы, глазницы. */
function skull(c: Ctx, x: number, y: number, s: number, ang = 0): void {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(2, s * 0.9, s * 1.1, s * 0.3, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#c9bfa6';
  c.beginPath();
  c.arc(0, 0, s, Math.PI * 0.9, Math.PI * 2.1);
  c.lineTo(s * 0.6, s * 0.8);
  c.lineTo(-s * 0.6, s * 0.8);
  c.closePath();
  c.fill();
  c.fillStyle = '#1a1512';
  c.beginPath();
  c.ellipse(-s * 0.4, s * 0.15, s * 0.26, s * 0.3, 0, 0, Math.PI * 2);
  c.ellipse(s * 0.4, s * 0.15, s * 0.26, s * 0.3, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(0, s * 0.35);
  c.lineTo(-s * 0.1, s * 0.55);
  c.lineTo(s * 0.1, s * 0.55);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.beginPath();
  c.arc(-s * 0.3, -s * 0.45, s * 0.3, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Куча костей: несколько костей и череп. */
function bonePile(c: Ctx, r: Rng, x: number, y: number, s: number): void {
  for (let i = 0; i < 5; i++) bone(c, x + r.between(-s, s), y + r.between(-s * 0.3, s * 0.3), r.between(s * 0.6, s * 1.1), r.between(0, Math.PI));
  skull(c, x + r.between(-s * 0.4, s * 0.4), y - s * 0.2, s * 0.42, r.between(-0.3, 0.3));
}

/** Факел на стене: скоба, пламя, тёплое свечение. */
function torch(c: Ctx, x: number, y: number, s: number): void {
  glow(c, x, y - s * 0.6, s * 7, 'rgba(255,150,60,A)', 0.32);
  glow(c, x, y - s * 0.6, s * 2.2, 'rgba(255,210,140,A)', 0.45);
  c.fillStyle = '#2a211a';
  c.fillRect(x - s * 0.18, y - s * 0.1, s * 0.36, s * 1.4);
  c.fillStyle = '#4a3a2a';
  c.fillRect(x - s * 0.4, y - s * 0.25, s * 0.8, s * 0.3);
  const f = c.createRadialGradient(x, y - s * 0.55, 0, x, y - s * 0.55, s * 0.8);
  f.addColorStop(0, '#fff2c0');
  f.addColorStop(0.45, '#ffb040');
  f.addColorStop(1, 'rgba(220,80,20,0)');
  c.fillStyle = f;
  c.beginPath();
  c.moveTo(x, y - s * 1.5);
  c.quadraticCurveTo(x + s * 0.55, y - s * 0.5, x, y - s * 0.1);
  c.quadraticCurveTo(x - s * 0.55, y - s * 0.5, x, y - s * 1.5);
  c.fill();
}

/** Кладка: ряды камней со смещением, каждый камень чуть своего тона. */
function masonry(c: Ctx, r: Rng, x0: number, y0: number, w: number, h: number, bw: number, bh: number, tones: string[]): void {
  c.save();
  c.beginPath();
  c.rect(x0, y0, w, h);
  c.clip();
  c.fillStyle = '#0c0b0e';
  c.fillRect(x0, y0, w, h);
  for (let row = 0, y = y0; y < y0 + h; row++, y += bh) {
    for (let x = x0 - (row % 2 ? bw / 2 : 0); x < x0 + w; x += bw) {
      c.fillStyle = tones[Math.floor(r.rnd() * tones.length)];
      c.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(x + 2, y + 2, bw - 4, 3);
    }
  }
  c.restore();
}

/** Поле боя «склеп»: стена с арками и факелами, каменный пол, кости по краям, паутина, тёмная виньетка. */
export function drawCryptField(c: Ctx, W: number, H: number, stone: CanvasImageSource | null): void {
  const r = rng(71);
  const wallBottom = H * 0.36;

  // Стена.
  masonry(c, r, 0, 0, W, wallBottom, 64, 34, ['#2a2730', '#2f2b35', '#26232b', '#332e38']);
  // Арки-ниши между колоннами.
  const arch = (x: number, w: number, top: number) => {
    c.fillStyle = '#08070a';
    c.beginPath();
    c.moveTo(x - w / 2, wallBottom);
    c.lineTo(x - w / 2, top + w / 2);
    c.arc(x, top + w / 2, w / 2, Math.PI, Math.PI * 2);
    c.lineTo(x + w / 2, wallBottom);
    c.closePath();
    c.fill();
    c.strokeStyle = '#45404c';
    c.lineWidth = 8;
    c.stroke();
    // Черепа в нише (оссуарий).
    for (let row = 0; row < 3; row++) {
      for (let i = -1; i <= 1; i++) skull(c, x + i * w * 0.27, wallBottom - 26 - row * 34, 11, 0);
    }
    // Тьма сверху ниши.
    const g = c.createLinearGradient(0, top, 0, wallBottom);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(1, 'rgba(0,0,0,0.2)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - w / 2 + 4, wallBottom);
    c.lineTo(x - w / 2 + 4, top + w / 2);
    c.arc(x, top + w / 2, w / 2 - 4, Math.PI, Math.PI * 2);
    c.lineTo(x + w / 2 - 4, wallBottom);
    c.closePath();
    c.fill();
  };
  arch(W * 0.18, 130, 170);
  arch(W * 0.5, 170, 120);
  arch(W * 0.82, 130, 170);
  // Колонны.
  const pillar = (x: number) => {
    const pw = 46;
    const g = c.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0);
    g.addColorStop(0, '#2a2630');
    g.addColorStop(0.4, '#4a4452');
    g.addColorStop(1, '#1e1b22');
    c.fillStyle = g;
    c.fillRect(x - pw / 2, 0, pw, wallBottom);
    c.fillStyle = '#524b5a';
    c.fillRect(x - pw / 2 - 8, wallBottom - 22, pw + 16, 22);
    c.fillRect(x - pw / 2 - 8, 60, pw + 16, 16);
  };
  for (const x of [W * 0.34, W * 0.66, 0, W]) pillar(x);
  // Плинтус стены и тень от неё на полу.
  c.fillStyle = '#1b181f';
  c.fillRect(0, wallBottom - 8, W, 16);

  // Пол: плиты (тайл), притемнённые, с тёплым светом в центре.
  // Плиты крупнее и приглушены (меньше контраста — фигуры на полу читаются).
  tileFill(c, stone, '#4a4650', 0.85, 0, wallBottom + 8, W, H - wallBottom);
  c.fillStyle = 'rgba(40,34,48,0.68)';
  c.fillRect(0, wallBottom + 8, W, H - wallBottom);
  const shade = c.createLinearGradient(0, wallBottom, 0, wallBottom + 120);
  shade.addColorStop(0, 'rgba(0,0,0,0.7)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = shade;
  c.fillRect(0, wallBottom, W, 120);
  glow(c, W / 2, H * 0.7, W * 0.62, 'rgba(255,205,150,A)', 0.14);

  // Факелы на колоннах (свет падает и на пол).
  for (const x of [W * 0.34, W * 0.66]) torch(c, x, wallBottom - 110, 26);
  glow(c, W * 0.34, wallBottom + 60, 120, 'rgba(255,150,70,A)', 0.12);
  glow(c, W * 0.66, wallBottom + 60, 120, 'rgba(255,150,70,A)', 0.12);

  // Трещины на полу.
  c.strokeStyle = 'rgba(8,6,10,0.55)';
  c.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    let x = r.between(0, W);
    let y = r.between(wallBottom + 40, H);
    c.beginPath();
    c.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += r.between(-30, 30);
      y += r.between(6, 26);
      c.lineTo(x, y);
    }
    c.stroke();
  }

  // Кости и черепа — только по краям (центр поля чистый).
  for (const [x, y, s] of [[18, H * 0.5, 26], [W - 22, H * 0.54, 30], [14, H * 0.74, 24], [W - 16, H * 0.8, 28], [50, H * 0.97, 36], [W - 60, H * 0.98, 34], [W * 0.26, wallBottom + 40, 22], [W * 0.76, wallBottom + 38, 20]] as const) {
    bonePile(c, r, x, y, s);
  }
  for (let i = 0; i < 10; i++) {
    const x = r.rnd() < 0.5 ? r.between(6, W * 0.1) : r.between(W * 0.9, W - 6);
    bone(c, x, r.between(H * 0.45, H * 0.98), r.between(16, 26), r.between(0, Math.PI));
  }
  // Свечи в нижних углах.
  const candle = (x: number, y: number, h: number) => {
    glow(c, x, y - h - 6, 50, 'rgba(255,190,110,A)', 0.35);
    c.fillStyle = '#e6dcc4';
    c.fillRect(x - 5, y - h, 10, h);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x + 1, y - h, 4, h);
    c.fillStyle = '#ffd890';
    c.beginPath();
    c.ellipse(x, y - h - 7, 3.5, 7, 0, 0, Math.PI * 2);
    c.fill();
  };
  candle(W * 0.12, H * 0.9, 34);
  candle(W * 0.17, H * 0.92, 22);
  candle(W * 0.88, H * 0.86, 30);
  candle(W * 0.83, H * 0.88, 20);

  // Паутина в верхних углах.
  const web = (x: number, y: number, dir: number) => {
    c.strokeStyle = 'rgba(220,220,235,0.22)';
    c.lineWidth = 1.5;
    const R = 120;
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * (Math.PI / 2);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + dir * Math.cos(a) * R, y + Math.sin(a) * R);
      c.stroke();
    }
    for (let k = 1; k <= 4; k++) {
      c.beginPath();
      for (let i = 0; i <= 5; i++) {
        const a = (i / 5) * (Math.PI / 2);
        const rr = (R * k) / 4.5;
        const px = x + dir * Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) c.moveTo(px, py);
        else c.quadraticCurveTo(x + dir * Math.cos(a - 0.15) * rr * 0.85, y + Math.sin(a - 0.15) * rr * 0.85, px, py);
      }
      c.stroke();
    }
  };
  web(0, 0, 1);
  web(W, 0, -1);

  vignette(c, W, H, H * 0.66, W * 0.32, H * 0.7, 'rgba(0,0,0,0.78)');
}

/** Карта «топь»: мёртвый лес в несколько планов, туман, тёмная вода с отражениями, болотные огни. */
export function drawSwampMap(c: Ctx, W: number, H: number): void {
  const r = rng(53);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#141c18');
  sky.addColorStop(0.35, '#3a4a3e');
  sky.addColorStop(0.6, '#26332a');
  sky.addColorStop(1, '#0b120e');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  glow(c, W * 0.3, H * 0.14, W * 0.7, 'rgba(200,220,180,A)', 0.14);

  for (let x = -10; x < W + 30; x += r.between(36, 60)) deadTree(c, r, x, H * 0.45 + r.between(-20, 20), r.between(150, 220), 'rgba(70,88,74,0.75)');
  fogBlob(c, W / 2, H * 0.45, W * 0.9, 90, 'rgba(150,170,145,A)', 0.3);
  for (let x = 0; x < W + 30; x += r.between(80, 130)) deadTree(c, r, x, H * 0.62 + r.between(-25, 25), r.between(240, 330), '#233026', 'rgba(70,95,60,0.7)');
  fogBlob(c, W * 0.3, H * 0.6, W * 0.7, 80, 'rgba(150,170,145,A)', 0.22);
  // Вода внизу: тёмная гладь с полосами отражений.
  const water = c.createLinearGradient(0, H * 0.68, 0, H);
  water.addColorStop(0, '#1b2923');
  water.addColorStop(1, '#070d0a');
  c.fillStyle = water;
  c.fillRect(0, H * 0.68, W, H * 0.32);
  c.strokeStyle = 'rgba(160,190,160,0.08)';
  c.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const y = r.between(H * 0.7, H);
    const x = r.between(0, W);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + r.between(20, 70), y);
    c.stroke();
  }
  // Кочки и камыш на воде.
  for (let i = 0; i < 9; i++) {
    const x = r.between(0, W);
    const y = r.between(H * 0.72, H * 0.98);
    c.fillStyle = '#1e2a1c';
    c.beginPath();
    c.ellipse(x, y, r.between(30, 60), r.between(10, 16), 0, 0, Math.PI * 2);
    c.fill();
    reeds(c, r, x, y, r.between(50, 90));
  }
  // Ближние мёртвые стволы по краям.
  c.fillStyle = '#060b08';
  for (const [x, lean] of [[-6, 16], [W + 8, -20]] as const) {
    c.beginPath();
    c.moveTo(x - 50, H);
    c.lineTo(x + 50, H);
    c.lineTo(x + 26 + lean, 0);
    c.lineTo(x - 26 + lean, 0);
    c.closePath();
    c.fill();
  }
  // Болотные огоньки.
  for (let i = 0; i < 18; i++) glow(c, r.between(30, W - 30), r.between(H * 0.3, H * 0.95), r.between(5, 10), 'rgba(190,240,150,A)', 0.9);
  vignette(c, W, H, H * 0.5, W * 0.35, H * 0.72, 'rgba(0,0,0,0.55)');
}

/** Карта «склеп»: коридор катакомб — кладка по бокам, арки вглубь, факелы, кости у стен. */
export function drawCryptMap(c: Ctx, W: number, H: number): void {
  const r = rng(29);
  masonry(c, r, 0, 0, W, H, 72, 40, ['#1d1a22', '#221e27', '#1a171e', '#26212b']);
  // Арки коридора, уходящие вглубь (от большой к малой).
  for (let i = 0; i < 5; i++) {
    const k = 1 - i * 0.17;
    const w = W * 0.9 * k;
    const top = H * 0.12 + i * H * 0.05;
    const bottom = H * 0.9 - i * H * 0.07;
    c.strokeStyle = `rgba(80,72,90,${0.8 - i * 0.12})`;
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
  // Глубина: тёмный центр коридора с лиловым отсветом.
  glow(c, W / 2, H * 0.42, W * 0.3, 'rgba(140,110,190,A)', 0.12);
  // Факелы по стенам — пара на каждый план.
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.2;
    const y = H * 0.62 - i * H * 0.1;
    torch(c, W / 2 - W * 0.42 * k, y, 24 * k);
    torch(c, W / 2 + W * 0.42 * k, y, 24 * k);
  }
  // Кости у стен.
  for (let i = 0; i < 7; i++) {
    bonePile(c, r, r.rnd() < 0.5 ? r.between(20, 120) : r.between(W - 120, W - 20), r.between(H * 0.7, H * 0.98), r.between(26, 40));
  }
  // Пыль в воздухе.
  for (let i = 0; i < 26; i++) glow(c, r.between(0, W), r.between(0, H), r.between(2, 5), 'rgba(255,225,170,A)', 0.6);
  vignette(c, W, H, H * 0.5, W * 0.3, H * 0.7, 'rgba(0,0,0,0.7)');
}
