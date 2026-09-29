import Phaser from 'phaser';
import { assetUrl } from './assetUrl';

/**
 * Крупные иллюстрации NPC для сюжетных диалогов (как в RO: Кафра в полный рост). Файлы — assets/ui/illust/<id>.png
 * (≈ 320×480, прозрачный фон), id — поле `illust` спикера в data/story. Грузятся по требованию (≈ 0.6 МБ видеопамяти
 * каждая) и остаются в кэше; в dist попадают через scripts/lib/used-assets.ts (illustFiles).
 */
const FILES = new Set(
  Object.keys(import.meta.glob('../../assets/ui/illust/*.png', { query: '?url', import: 'default' })).map((p) => p.split('/').pop()!.replace(/\.png$/, '')),
);
const pending = new Map<string, Promise<boolean>>();

export const illustKey = (id: string) => `illust_${id}`;
/** Есть ли файл иллюстрации. */
export const hasIllust = (id: string) => FILES.has(id);

/** Загрузить иллюстрацию (один раз); true — текстура готова. */
export function loadIllust(game: Phaser.Game, id: string): Promise<boolean> {
  const key = illustKey(id);
  if (game.textures.exists(key)) return Promise.resolve(true);
  if (!FILES.has(id)) return Promise.resolve(false);
  const running = pending.get(id);
  if (running) return running;
  const p = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!game.textures.exists(key)) game.textures.addImage(key, img);
      resolve(true);
    };
    img.onerror = () => {
      console.warn(`Иллюстрация ${id} не загрузилась — будет портрет в рамке`);
      resolve(false);
    };
    img.src = assetUrl(`ui/illust/${id}.png`);
  }).finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}
