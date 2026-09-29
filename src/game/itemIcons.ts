import Phaser from 'phaser';
import type { Slot } from '../core';
import { assetUrl } from './assetUrl';
import { C, FS, TINT } from './theme';
import { text } from './ui';

/**
 * Иконки предметов Ragnarok Online (docs/RO_EXTRACT_LIST.md §4): `assets/ui/icons/item_<id>.png` — родные 24×24 из клиента
 * (для снаряжения id предмета, для ресурсов — `gold`, `gems`, `scrolls`, `hero_exp`, `blessed_ore`, `treasure_chest`…),
 * `assets/ui/collection/item_<id>.png` — большая картинка 75×100 для окна предмета (грузится по требованию).
 * Иконки грузит экран загрузки (queueItemIconFiles), фильтр — NEAREST, масштаб — целый (roIconScale): пиксели не мылятся.
 * Иконку RO не красим — цвет редкости уходит в рамку и подложку ячейки. Нет файла — силуэт ниже (T3-27).
 */

/** Готовые PNG иконок RO (известны при сборке). */
const ICON_FILES = Object.keys(import.meta.glob('../../assets/ui/icons/item_*.png', { query: '?url', import: 'default' }));
const COLLECTION_FILES = Object.keys(import.meta.glob('../../assets/ui/collection/item_*.png', { query: '?url', import: 'default' }));
const fileId = (f: string) => f.split('/').pop()!.replace(/^item_|\.png$/g, '');
const ICON_IDS = new Set(ICON_FILES.map(fileId));
const COLLECTION_IDS = new Set(COLLECTION_FILES.map(fileId));

/** Сторона иконки RO в пикселях. */
export const RO_ICON_PX = 24;
/** Ключ текстуры иконки RO предмета или ресурса. */
export const roIconKey = (id: string) => `item_${id}`;
const collectionKey = (id: string) => `item_col_${id}`;

/** Экран загрузки: поставить в очередь все иконки RO (≈ 17 КБ в WebP). Путь — от корня assets, как в манифесте. */
export function queueItemIconFiles(scene: Phaser.Scene): void {
  for (const id of ICON_IDS) scene.load.image(roIconKey(id), `ui/icons/item_${id}.png`);
}

/** После загрузки: иконки RO — пиксель-арт (без сглаживания). */
export function setupItemIconFilters(scene: Phaser.Scene): void {
  for (const id of ICON_IDS) if (scene.textures.exists(roIconKey(id))) scene.textures.get(roIconKey(id)).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Ключ загруженной иконки RO для id (или undefined — рисуем запасной вариант). */
export function roIcon(scene: Phaser.Scene, id: string | undefined): string | undefined {
  if (!id || !ICON_IDS.has(id)) return undefined;
  const key = roIconKey(id);
  return scene.textures.exists(key) ? key : undefined;
}

/**
 * Целый масштаб иконки 24×24 под желаемый размер (игровые единицы): ×1, ×2, ×3…; чуть вверх — у иконок RO
 * прозрачные поля, сам предмет меньше 24 пикселей.
 */
export function roIconScale(size: number): number {
  return Math.max(1, Math.round(size / RO_ICON_PX + 0.3));
}

/**
 * Оттенок иконки ресурса: прозрачный «1carat Diamond» RO на тёмном фоне читается как лист бумаги — гемы подкрашены
 * в цвет гемов интерфейса (умножение: блики и контур остаются). Предметы не красим никогда.
 */
export const RO_ICON_TINT: Readonly<Record<string, number>> = { gems: 0x8fe6ff };

/** Иконка RO размером ≈ size (целый масштаб) или undefined, если иконки нет. */
export function roIconImage(scene: Phaser.Scene, x: number, y: number, id: string, size: number): Phaser.GameObjects.Image | undefined {
  const key = roIcon(scene, id);
  if (!key) return undefined;
  const img = scene.add.image(x, y, key).setScale(roIconScale(size));
  return RO_ICON_TINT[id] ? img.setTint(RO_ICON_TINT[id]) : img;
}

/** Есть ли большая картинка RO для окна предмета. */
export const hasCollectionArt = (id: string): boolean => COLLECTION_IDS.has(id);

const pendingCollection = new Map<string, Promise<string | undefined>>();

/** Загрузить большую картинку предмета (один раз на игру); ключ текстуры или undefined (нет файла, ошибка сети). */
export function loadCollectionArt(game: Phaser.Game, id: string): Promise<string | undefined> {
  const key = collectionKey(id);
  if (!COLLECTION_IDS.has(id)) return Promise.resolve(undefined);
  if (game.textures.exists(key)) return Promise.resolve(key);
  const running = pendingCollection.get(id);
  if (running) return running;
  const p = new Promise<string | undefined>((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!game.textures.exists(key)) game.textures.addImage(key, img)?.setFilter(Phaser.Textures.FilterMode.NEAREST);
      resolve(key);
    };
    img.onerror = () => {
      console.warn(`Картинка предмета ${id} не загрузилась — будет иконка`);
      resolve(undefined);
    };
    img.src = assetUrl(`ui/collection/item_${id}.png`);
  }).finally(() => pendingCollection.delete(id));
  pendingCollection.set(id, p);
  return p;
}

/**
 * T3-27. Запасные иконки предметов без нового арта: силуэт по слоту (оружие — клинок, лук, посох или топор; доспех, шлем, сапоги), нарисованный на холсте
 * оттенками серого — setTint цветом редкости даёт цветную иконку с объёмом. Текстуры строятся лениво, один раз.
 */
type Ctx = CanvasRenderingContext2D;

const S = 96;

type Shape = Slot | 'bow' | 'staff' | 'axe' | 'knuckle' | 'violin';

const DRAW: Record<Shape, (c: Ctx) => void> = {
  weapon: (c) => {
    // Клинок по диагонали, гарда, рукоять, навершие.
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(-Math.PI / 4);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -44);
    c.lineTo(8, -32);
    c.lineTo(8, 14);
    c.lineTo(-8, 14);
    c.lineTo(-8, -32);
    c.closePath();
    c.fill();
    c.fillStyle = '#b8b8b8';
    c.fillRect(-2, -34, 4, 46);
    c.fillStyle = '#d8d8d8';
    c.fillRect(-22, 14, 44, 8);
    c.fillStyle = '#8a8a8a';
    c.fillRect(-5, 22, 10, 18);
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.arc(0, 44, 7, 0, Math.PI * 2);
    c.fill();
    c.restore();
  },
  armor: (c) => {
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(28, 14);
    c.lineTo(40, 20);
    c.quadraticCurveTo(48, 26, 56, 20);
    c.lineTo(68, 14);
    c.lineTo(84, 26);
    c.lineTo(76, 44);
    c.lineTo(70, 40);
    c.lineTo(70, 82);
    c.quadraticCurveTo(48, 90, 26, 82);
    c.lineTo(26, 40);
    c.lineTo(20, 44);
    c.lineTo(12, 26);
    c.closePath();
    c.fill();
    c.fillStyle = '#a8a8a8';
    c.fillRect(46, 30, 4, 50);
    c.fillStyle = '#c8c8c8';
    c.fillRect(30, 56, 36, 5);
  },
  helmet: (c) => {
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(18, 66);
    c.bezierCurveTo(16, 30, 30, 14, 48, 14);
    c.bezierCurveTo(66, 14, 80, 30, 78, 66);
    c.lineTo(84, 78);
    c.lineTo(12, 78);
    c.closePath();
    c.fill();
    c.fillStyle = '#6a6a6a';
    c.fillRect(28, 46, 40, 8);
    c.fillStyle = '#b0b0b0';
    c.fillRect(45, 16, 6, 30);
  },
  bow: (c) => {
    // Дуга лука, тетива и стрела.
    c.strokeStyle = '#e8e8e8';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(24, 12);
    c.quadraticCurveTo(92, 48, 24, 84);
    c.stroke();
    c.strokeStyle = '#a0a0a0';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(24, 12);
    c.lineTo(24, 84);
    c.stroke();
    c.strokeStyle = '#d0d0d0';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(16, 48);
    c.lineTo(80, 48);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(88, 48);
    c.lineTo(74, 40);
    c.lineTo(74, 56);
    c.closePath();
    c.fill();
  },
  staff: (c) => {
    // Древко по диагонали и навершие-кристалл.
    c.strokeStyle = '#a8a8a8';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(20, 84);
    c.lineTo(62, 34);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(72, 8);
    c.lineTo(86, 24);
    c.lineTo(72, 44);
    c.lineTo(58, 24);
    c.closePath();
    c.fill();
    c.fillStyle = '#c8c8c8';
    c.beginPath();
    c.moveTo(72, 8);
    c.lineTo(86, 24);
    c.lineTo(72, 24);
    c.closePath();
    c.fill();
  },
  axe: (c) => {
    c.strokeStyle = '#9a9a9a';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(26, 86);
    c.lineTo(64, 16);
    c.stroke();
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(56, 22);
    c.quadraticCurveTo(92, 14, 88, 48);
    c.quadraticCurveTo(70, 40, 50, 36);
    c.closePath();
    c.fill();
  },
  boots: (c) => {
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.moveTo(30, 12);
    c.lineTo(58, 12);
    c.lineTo(58, 56);
    c.quadraticCurveTo(84, 60, 86, 76);
    c.lineTo(86, 84);
    c.lineTo(28, 84);
    c.closePath();
    c.fill();
    c.fillStyle = '#9a9a9a';
    c.fillRect(28, 76, 58, 8);
    c.fillStyle = '#c0c0c0';
    c.fillRect(30, 12, 28, 8);
  },
  knuckle: (c) => {
    // Кастет: четыре кольца на пальцы и упор под ладонь.
    c.fillStyle = '#e0e0e0';
    // Скруглённая планка (без roundRect — его нет в старых WebView).
    c.fillRect(24, 30, 48, 30);
    c.beginPath();
    c.arc(24, 45, 15, 0, Math.PI * 2);
    c.arc(72, 45, 15, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#b0b0b0';
    c.beginPath();
    c.moveTo(22, 58);
    c.quadraticCurveTo(48, 90, 74, 58);
    c.lineTo(66, 58);
    c.quadraticCurveTo(48, 78, 30, 58);
    c.closePath();
    c.fill();
    c.fillStyle = '#4a4a4a';
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(22 + i * 17.3, 45, 6.5, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) c.fillRect(17 + i * 17.3, 32, 10, 4);
  },
  violin: (c) => {
    // Скрипка по диагонали: корпус «восьмёркой», гриф, завиток; смычок поперёк.
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(-Math.PI / 5);
    c.fillStyle = '#e8e8e8';
    c.beginPath();
    c.ellipse(0, 18, 18, 17, 0, 0, Math.PI * 2);
    c.ellipse(0, -8, 14, 13, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#9a9a9a';
    c.fillRect(-3, -44, 6, 40);
    c.beginPath();
    c.arc(0, -46, 6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#5a5a5a';
    c.fillRect(-7, 4, 4, 10);
    c.fillRect(3, 4, 4, 10);
    c.fillRect(-8, 24, 16, 4);
    c.restore();
    c.strokeStyle = '#c8c8c8';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(18, 22);
    c.lineTo(80, 76);
    c.stroke();
  },
};

/** Форма иконки: слот, а у оружия — вид по id предмета (лук, посох, топор, кастет, скрипка; остальное — клинок). */
function shapeOf(slot: Slot, itemId = ''): Shape {
  if (slot !== 'weapon') return slot;
  if (/bow|arbalest/.test(itemId)) return 'bow';
  if (/staff|rod|mace/.test(itemId)) return 'staff';
  if (/axe/.test(itemId)) return 'axe';
  // MT-13: кастет и скрипка — не клинок (было не отличить от «Меча»).
  if (/knuckle|claw|fist/.test(itemId)) return 'knuckle';
  if (/violin|guitar|lute|harp/.test(itemId)) return 'violin';
  return 'weapon';
}

/** Ключ текстуры иконки (строится при первом обращении). */
export function itemIconKey(scene: Phaser.Scene, slot: Slot, itemId?: string): string {
  const shape = shapeOf(slot, itemId);
  const key = `item_ico_${shape}`;
  if (!scene.textures.exists(key)) {
    const t = scene.textures.createCanvas(key, S, S);
    if (t) {
      const c = t.getContext();
      c.lineJoin = 'round';
      DRAW[shape](c);
      t.refresh();
    }
  }
  return key;
}

/**
 * Квадрат-ячейка с иконкой предмета: тёмная подложка, рамка и иконка цветом редкости (как ячейки в AFK Arena).
 * Возвращает объекты (подложка, иконка, значок заточки «+N» в левом верхнем углу) — вызывающий кладёт их в свой контейнер/список.
 */
export function itemCell(scene: Phaser.Scene, x: number, y: number, size: number, slot: Slot | null, color: number, itemId?: string, refine = 0): Phaser.GameObjects.GameObject[] {
  const bg = scene.add.rectangle(x, y, size, size, TINT.checkOff, 0.95).setStrokeStyle(4, color, 1);
  if (!slot) return [bg];
  const ro = roIcon(scene, itemId);
  const out: Phaser.GameObjects.GameObject[] = [bg];
  if (ro) {
    // Иконка RO как есть (целый масштаб, без tint), редкость — рамкой и подложкой её цвета.
    out.push(scene.add.rectangle(x, y, size - 8, size - 8, color, 0.18));
    out.push(scene.add.image(x, y, ro).setScale(Math.max(1, Math.floor((size * 0.86) / RO_ICON_PX))).setName('roItemIcon'));
  } else out.push(scene.add.image(x, y, itemIconKey(scene, slot, itemId)).setDisplaySize(size * 0.78, size * 0.78).setTint(color));
  if (refine > 0) out.push(refineBadge(scene, x - size / 2 + 6, y - size / 2 + 2, refine, size >= 100 ? FS.small : FS.caption));
  return out;
}

/** Значок заточки «+N» (золотой, с обводкой); x, y — левый верхний угол. */
export function refineBadge(scene: Phaser.Scene, x: number, y: number, refine: number, size: number = FS.caption): Phaser.GameObjects.Text {
  return text(scene, x, y, `+${refine}`, size, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0).setName('refineBadge');
}

/**
 * «Благословенная руда» (RO Blessed Ore): голубовато-белый самородок с гранями и искрой, рисуется кодом один раз
 * (цвет свой, без tint). Ключ текстуры — ore_blessed.
 */
export function oreIconKey(scene: Phaser.Scene): string {
  const key = 'ore_blessed';
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, S, S);
  if (!t) return key;
  const c = t.getContext();
  c.lineJoin = 'round';
  // Свечение.
  const glow = c.createRadialGradient(48, 52, 6, 48, 52, 46);
  glow.addColorStop(0, 'rgba(190,235,255,0.55)');
  glow.addColorStop(1, 'rgba(190,235,255,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, S, S);
  // Самородок: неровный многоугольник.
  const body: [number, number][] = [[22, 58], [30, 34], [50, 24], [70, 32], [78, 54], [66, 74], [40, 78]];
  c.beginPath();
  body.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  const g = c.createLinearGradient(24, 26, 76, 78);
  g.addColorStop(0, '#f4fbff');
  g.addColorStop(0.5, '#a9dcf5');
  g.addColorStop(1, '#5d9fc8');
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = '#1d3b52';
  c.stroke();
  // Грани.
  c.lineWidth = 2;
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.beginPath();
  c.moveTo(30, 34);
  c.lineTo(46, 50);
  c.lineTo(50, 24);
  c.moveTo(46, 50);
  c.lineTo(78, 54);
  c.moveTo(46, 50);
  c.lineTo(40, 78);
  c.stroke();
  // Искра.
  c.fillStyle = '#ffffff';
  c.beginPath();
  const [sx, sy] = [66, 20];
  const star: [number, number][] = [[0, -12], [3, -3], [12, 0], [3, 3], [0, 12], [-3, 3], [-12, 0], [-3, -3]];
  star.forEach(([dx, dy], i) => (i ? c.lineTo(sx + dx, sy + dy) : c.moveTo(sx + dx, sy + dy)));
  c.closePath();
  c.fill();
  t.refresh();
  return key;
}

/** Иконка «Благословенной руды» размером size: Enriched Oridecon из RO, иначе самородок, нарисованный кодом. */
export function oreIcon(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Image {
  return roIconImage(scene, x, y, 'blessed_ore', size) ?? scene.add.image(x, y, oreIconKey(scene)).setDisplaySize(size, size);
}
