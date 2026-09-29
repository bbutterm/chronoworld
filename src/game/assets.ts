import Phaser from 'phaser';
import manifestJson from '../../assets/manifest.json';
import { SKIN_REPLACED } from '../pipeline/bootAssets';
import { animatedEffect, animatedFxKey } from './animatedFx';
import { assetUrl } from './assetUrl';
import { addPackedTexture, imagePixels } from './packedTexture';
import { packAlphaGrid } from '../pipeline/sheetPack';
import { SheetLru, textureBytes } from './spriteCache';
import { queueDamageDigits } from './numberFont';
import { queueItemIconFiles, setupItemIconFilters } from './itemIcons';
import { SKIN_FOR, SKIN_FORCE, SKIN_SLICE } from './skin';
import { queueSkillIconFiles, skillIconFileKeys } from './skillIcons';

interface AssetEntry {
  /** Путь внутри assets/ или null — тогда рисуется плейсхолдер. */
  file?: string | null;
  /** XML атласа (Starling/Kenney) рядом с file. */
  atlasXml?: string;
  /** Кадр из атласа: id атласа и имя кадра. */
  atlas?: string;
  frame?: string;
  /** Кадр «нажато» для кнопок из атласа. */
  pressed?: string;
  /** 9-slice: [слева, справа, сверху, снизу]. */
  slice?: [number, number, number, number];
  w: number;
  h: number;
  color: string;
  label: string;
  shape?: 'rect' | 'circle';
  /** Плейсхолдер-фон: вертикальный градиент. */
  gradient?: string[];
  /** Пиксель-арт: масштабировать без сглаживания. */
  pixelArt?: boolean;
}

const MANIFEST = (manifestJson as unknown as { assets: Record<string, AssetEntry> }).assets;

/** Ставит в очередь загрузки все ассеты с файлом. Анимированные эффекты боя — не здесь (holdAnimatedFx). */
export function queueAssets(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (!a.file || SKIN_REPLACED.has(id)) continue;
    if (a.atlasXml) scene.load.atlasXML(id, a.file, a.atlasXml);
    else scene.load.image(id, a.file);
  }
  // Значки навыков от художника (assets/ui/icons/skill_<id>.png), если есть; остальные рисует skillIcons.
  queueSkillIconFiles(scene);
  // Иконки предметов и ресурсов RO (assets/ui/icons/item_<id>.png) и цифры урона RO (assets/fx/damage/numbers.png).
  queueItemIconFiles(scene);
  queueDamageDigits(scene);
}

/** После загрузки: фильтр для пиксель-арта. */
export function setupLoadedAssets(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (a.file && a.pixelArt && scene.textures.exists(id)) scene.textures.get(id).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
  // Иконки навыков RO — пиксель-арт.
  for (const key of skillIconFileKeys()) if (scene.textures.exists(key)) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  setupItemIconFilters(scene);
}

/**
 * Анимированные эффекты боя в памяти: LRU с бюджетом, как листы юнитов (spriteCache.ts). Бой держит эффекты своих
 * навыков до выключения сцены, потом они остаются про запас, сверх бюджета — выгружаются самые давние.
 * Общие эффекты (удар, смерть, лечение…) ужатые — ≈ 6 МБ; 16 МБ хватает на них и навыки последнего боя.
 */
export const FX_BUDGET_BYTES = 16 * 1048576;
const fxLru = new SheetLru(FX_BUDGET_BYTES);
const fxInflight = new Map<string, Promise<void>>();

function loadAnimatedFx(game: Phaser.Game, id: string): Promise<void> {
  const effect = animatedEffect(id);
  const key = animatedFxKey(id);
  if (!effect || game.textures.exists(key)) return Promise.resolve();
  const running = fxInflight.get(id);
  if (running) return running;
  const p = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      fxInflight.delete(id);
      if (!game.textures.exists(key)) {
        // Кадры эффекта — по габаритам своей альфы, плотно (sheetPack.ts): ≈ вдвое меньше видеопамяти, пиксели те же.
        const pixels = imagePixels(img);
        const pack = pixels && packAlphaGrid(pixels, img.width, effect.cell, effect.columns, effect.frames);
        const tex =
          (pack && addPackedTexture(game.textures, key, img, pack, effect.cell)) ||
          game.textures.addSpriteSheet(key, img, { frameWidth: effect.cell[0], frameHeight: effect.cell[1] });
        if (tex) {
          tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
          fxLru.add(id, textureBytes(tex.source[0].width, tex.source[0].height));
          trimAnimatedFx(game);
        }
      }
      resolve();
    };
    img.onerror = () => {
      fxInflight.delete(id);
      console.warn(`Эффект ${effect.file} не загрузился — в бою будет статичный`);
      resolve();
    };
    img.src = assetUrl(effect.file);
  });
  fxInflight.set(id, p);
  return p;
}

function trimAnimatedFx(game: Phaser.Game): void {
  for (const id of fxLru.trim()) if (game.textures.exists(animatedFxKey(id))) game.textures.remove(animatedFxKey(id));
}

/**
 * T4-12 / память текстур. Анимированные эффекты грузятся не при старте, а боем — только нужные ему (battleFxIds),
 * и держатся до выключения сцены. Пока не загрузились, бой рисует статичные fx_* (battleFx сам проверяет текстуру).
 * Промис — когда все загрузились (или не загрузились).
 */
export function holdAnimatedFx(scene: Phaser.Scene, ids: string[]): Promise<void> {
  const game = scene.game;
  const want = [...new Set(ids)].filter((id) => animatedEffect(id));
  for (const id of want) {
    fxLru.hold(id);
    fxLru.touch(id);
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    for (const id of want) fxLru.release(id);
    trimAnimatedFx(game);
  });
  return Promise.all(want.map((id) => loadAnimatedFx(game, id))).then(() => undefined);
}

/** Сводка кэша эффектов (отладка, perf). */
export const animatedFxStats = () => ({ effects: fxLru.ids(), bytes: fxLru.bytes, budget: fxLru.budget });

/** Есть ли id в манифесте ассетов (для проверки ссылок из контента). */
export const hasAsset = (id: string) => id in MANIFEST;

/** Текстура и кадр для id из манифеста (кадр атласа или отдельная картинка/плейсхолдер). */
export function tex(scene: Phaser.Scene, id: string, pressed = false): { key: string; frame?: string } {
  const skin = skinKey(scene, id);
  if (skin) return { key: pressed && scene.textures.exists(`${skin}_pressed`) ? `${skin}_pressed` : skin };
  if (id.startsWith(KENNEY_PREFIX)) return kenney(scene, id.slice(KENNEY_PREFIX.length), pressed);
  const a = MANIFEST[id];
  if (a?.atlas && a.frame && scene.textures.exists(a.atlas)) {
    return { key: a.atlas, frame: pressed && a.pressed ? a.pressed : a.frame };
  }
  return { key: id };
}

/** Текстура скина для id (панели и кнопки без своего файла рисуются скином, см. skin.ts). */
export function skinKey(scene: Phaser.Scene, id: string): string | null {
  const k = SKIN_FOR[id] ?? (id.startsWith('skin_') ? id : undefined);
  if (!k || (MANIFEST[id]?.file && !SKIN_FORCE.has(id)) || !scene.textures.exists(k)) return null;
  return k;
}

export function sliceOf(id: string): [number, number, number, number] {
  if (SKIN_FOR[id] || id.startsWith('skin_')) return [SKIN_SLICE, SKIN_SLICE, SKIN_SLICE, SKIN_SLICE];
  if (id.startsWith(KENNEY_PREFIX)) return id.includes('panel_') ? [16, 16, 16, 16] : [12, 12, 12, 12];
  return MANIFEST[id]?.slice ?? [16, 16, 16, 16];
}

/**
 * Кадры атласа Kenney UI без записи в манифесте: id вида `k:panel_blue` (имя кадра без .png).
 * Нажатое состояние — кадр `<имя>_pressed`, если он есть в атласе. Атлас не загрузился — плейсхолдер-панель.
 */
const KENNEY_PREFIX = 'k:';
const KENNEY_ATLAS = 'ui_kenney';
export const kframe = (name: string) => `${KENNEY_PREFIX}${name}`;

function kenney(scene: Phaser.Scene, name: string, pressed: boolean): { key: string; frame?: string } {
  if (!scene.textures.exists(KENNEY_ATLAS)) return { key: 'ui_panel' };
  const atlas = scene.textures.get(KENNEY_ATLAS);
  const p = `${name}_pressed.png`;
  if (pressed && atlas.has(p)) return { key: KENNEY_ATLAS, frame: p };
  return atlas.has(`${name}.png`) ? { key: KENNEY_ATLAS, frame: `${name}.png` } : { key: 'ui_panel' };
}

/** Для всех id без текстуры (нет файла или не загрузился) рисует цветной прямоугольник с подписью. */
export function buildPlaceholders(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (scene.textures.exists(id) || a.atlasXml || SKIN_REPLACED.has(id)) continue;
    if (a.atlas && scene.textures.exists(a.atlas)) continue;
    // Градиент-заглушка фона растягивается на экран (setDisplaySize) — рисуем в ¼ размера, это экономит ~7 МБ видеопамяти.
    const shrink = a.gradient ? 4 : 1;
    const w = Math.ceil((a.w || 128) / shrink);
    const h = Math.ceil((a.h || 128) / shrink);
    const t = scene.textures.createCanvas(id, w, h);
    if (!t) continue;
    const ctx = t.getContext();
    ctx.fillStyle = a.color;
    if (a.gradient) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      a.gradient.forEach((c, i) => g.addColorStop(i / Math.max(1, a.gradient!.length - 1), c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (a.shape === 'circle') {
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, w, h);
      if (Math.min(w, h) >= 64) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(2, Math.min(w, h) / 40);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
      }
    }
    if (a.label && Math.min(w, h) >= 64) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      if (Math.min(w, h) > 512) {
        // На больших фонах подпись маленькая и в углу, чтобы не мешать бою.
        ctx.globalAlpha = 0.3;
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(a.label, 24, 24);
      } else {
        ctx.font = `bold ${Math.round(Math.min(w / (a.label.length * 0.62), h / 3))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.label, w / 2, h / 2);
      }
    }
    t.refresh();
  }
}

/** Есть ли настоящий арт (для плейсхолдеров не отражаем текстуру, чтобы подпись читалась). */
export function hasArt(id: string): boolean {
  return !!MANIFEST[id]?.file;
}
