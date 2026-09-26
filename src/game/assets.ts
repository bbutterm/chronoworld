import Phaser from 'phaser';
import manifestJson from '../../assets/manifest.json';

interface AssetEntry {
  /** Путь внутри assets/ или null — тогда рисуется плейсхолдер. */
  file: string | null;
  w: number;
  h: number;
  color: string;
  label: string;
  shape?: 'rect' | 'circle';
}

const MANIFEST = (manifestJson as unknown as { assets: Record<string, AssetEntry> }).assets;

export const heroBattle = (heroId: string) => `hero_${heroId}_battle`;
export const heroPortrait = (heroId: string) => `hero_${heroId}_portrait`;

/** Ставит в очередь загрузки все ассеты с файлом. */
export function queueAssets(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (a.file) scene.load.image(id, a.file);
  }
}

/** Для всех id без текстуры (нет файла или не загрузился) рисует цветной прямоугольник с подписью. */
export function buildPlaceholders(scene: Phaser.Scene): void {
  for (const [id, a] of Object.entries(MANIFEST)) {
    if (scene.textures.exists(id)) continue;
    const tex = scene.textures.createCanvas(id, a.w, a.h);
    if (!tex) continue;
    const ctx = tex.getContext();
    ctx.fillStyle = a.color;
    if (a.shape === 'circle') {
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(a.w / 2, a.h / 2, Math.min(a.w, a.h) / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, a.w, a.h);
      if (Math.min(a.w, a.h) >= 64) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(2, Math.min(a.w, a.h) / 40);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, a.w - ctx.lineWidth, a.h - ctx.lineWidth);
      }
    }
    if (a.label && Math.min(a.w, a.h) >= 64) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      const big = Math.min(a.w, a.h) > 512;
      // На больших фонах подпись маленькая и в углу, чтобы не мешать бою.
      if (big) {
        ctx.globalAlpha = 0.3;
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(a.label, 24, 24);
      } else {
        ctx.font = `bold ${Math.round(Math.min(a.w / (a.label.length * 0.62), a.h / 3))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.label, a.w / 2, a.h / 2);
      }
    }
    tex.refresh();
  }
}

/** Есть ли настоящий арт (для плейсхолдеров не отражаем текстуру, чтобы подпись читалась). */
export function hasArt(id: string): boolean {
  return !!MANIFEST[id]?.file;
}

export function assetColor(id: string): number {
  const a = MANIFEST[id];
  return a ? Phaser.Display.Color.HexStringToColor(a.color).color : 0xffffff;
}
