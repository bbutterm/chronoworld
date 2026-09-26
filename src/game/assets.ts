import Phaser from 'phaser';
import manifestJson from '../../assets/manifest.json';

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
  const a = MANIFEST[id];
  if (a?.atlas && a.frame && scene.textures.exists(a.atlas)) {
    return { key: a.atlas, frame: pressed && a.pressed ? a.pressed : a.frame };
  }
  return { key: id };
}

export function sliceOf(id: string): [number, number, number, number] {
  return MANIFEST[id]?.slice ?? [16, 16, 16, 16];
}

/** Для всех id без текстуры (нет файла или не загрузился) рисует цветной прямоугольник с подписью. */
export function buildPlaceholders(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (scene.textures.exists(id) || a.atlasXml) continue;
    if (a.atlas && scene.textures.exists(a.atlas)) continue;
    const w = a.w || 128;
    const h = a.h || 128;
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
