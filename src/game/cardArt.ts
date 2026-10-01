import Phaser from 'phaser';
import { assetUrl } from './assetUrl';

/**
 * Рисунки карт RO (docs/SPRITES_NEEDED.md, Г): `assets/ui/cards/<id>.webp`, 180×240 (из 300×400 клиента,
 * tools/ro_cards.py). Имя — id карты MVP охоты (`card_<mvp>`, data/hunt.json → cards) или id карты Башни
 * (data/tower.json → run.blessings). Карта Башни того же монстра, что MVP (Осирис, Бафомет…), берёт `card_<id>`.
 * Грузятся по требованию (один раз на игру), как большие картинки предметов; нет файла или сети — остаётся портрет.
 */

const FILES = Object.keys(import.meta.glob('../../assets/ui/cards/*.webp', { query: '?url', import: 'default' }));
const IDS = new Set(FILES.map((f) => f.split('/').pop()!.replace(/\.webp$/, '')));

/** Соотношение сторон рисунка карты (ширина / высота). */
export const CARD_ART_RATIO = 3 / 4;

/** Файл рисунка для карты Башни или MVP (id без расширения) или undefined. */
export function cardArtId(id: string): string | undefined {
  if (IDS.has(id)) return id;
  if (IDS.has(`card_${id}`)) return `card_${id}`;
  return undefined;
}

const pending = new Map<string, Promise<string | undefined>>();

/** Загрузить рисунок карты; ключ текстуры или undefined (нет рисунка, ошибка сети). */
export function loadCardArt(game: Phaser.Game, id: string): Promise<string | undefined> {
  const file = cardArtId(id);
  if (!file) return Promise.resolve(undefined);
  const key = `card_art_${file}`;
  if (game.textures.exists(key)) return Promise.resolve(key);
  const running = pending.get(file);
  if (running) return running;
  const p = new Promise<string | undefined>((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!game.textures.exists(key)) game.textures.addImage(key, img);
      resolve(key);
    };
    img.onerror = () => {
      console.warn(`Рисунок карты ${file} не загрузился — останется портрет`);
      resolve(undefined);
    };
    img.src = assetUrl(`ui/cards/${file}.webp`);
  }).finally(() => pending.delete(file));
  pending.set(file, p);
  return p;
}

/**
 * Положить рисунок карты в прямоугольник (x, y — центр; h — высота, ширина по пропорции) поверх того, что уже
 * нарисовано (портрет-заглушка). Если рисунок уже в памяти — сразу, иначе после загрузки, если экран и `owner`
 * (окно, контейнер) ещё живы. `place` — куда положить картинку (контейнер окна, глубина).
 */
export function showCardArt(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  h: number,
  place?: (img: Phaser.GameObjects.Image) => void,
  owner?: Phaser.GameObjects.GameObject,
): boolean {
  if (!cardArtId(id)) return false;
  const sys = scene.sys;
  void loadCardArt(scene.game, id).then((key) => {
    if (!key || !sys.isActive() || scene.sys !== sys || (owner && !owner.active)) return;
    const img = scene.add.image(x, y, key).setDisplaySize(h * CARD_ART_RATIO, h).setName(`cardArt_${id}`);
    place?.(img);
  });
  return true;
}
