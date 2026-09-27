import Phaser from 'phaser';
import manifestJson from '../../assets/manifest.json';
import { SKIN_FOR, SKIN_FORCE, SKIN_SLICE } from './skin';

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

/** Ставит в очередь загрузки все ассеты с файлом. */
export function queueAssets(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (!a.file) continue;
    if (a.atlasXml) scene.load.atlasXML(id, a.file, a.atlasXml);
    else scene.load.image(id, a.file);
  }
}

/** После загрузки: фильтр для пиксель-арта. */
export function setupLoadedAssets(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (a.file && a.pixelArt && scene.textures.exists(id)) scene.textures.get(id).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
}

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
    if (scene.textures.exists(id) || a.atlasXml) continue;
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
