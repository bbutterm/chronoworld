import Phaser from 'phaser';
import { shopStatus, type ShopContext } from '../core';
import { GAME } from './content';
import { artCardTexture, artEntry, type EntryView } from './homeBuildings';
import { hasIllust, illustKey, loadIllust } from './illust';
import { session, today } from './session';
import { isUnlocked } from './unlockBanner';

/**
 * Вход в Лавку со страницы «Город»: витрина-картинка (artEntry, homeBuildings.ts) — лавка с полками и Кафра
 * за прилавком (иллюстрация assets/ui/illust/kafra_01.png, грузится лениво). HomeScene ставит её одной строкой (shopTile).
 */

/** Контекст Лавки (data/shop.json собран в GAME.shop). */
export function shopCtx(): ShopContext {
  if (!GAME.shop) throw new Error('Лавка: нет data/shop.json');
  return GAME as typeof GAME & ShopContext;
}

/** Иллюстрация продавщицы (Кафра). */
const KEEPER = 'kafra_01';
/** Линия прилавка (доля высоты карточки): ниже неё продавщицы не видно. */
const DESK = 0.8;
/** Верх продавщицы (доля высоты). */
const KEEPER_TOP = 0.12;

/** Нарисованная лавка: тёплая стена, лампа, две полки с банками, прилавок. */
function paintShop(c: CanvasRenderingContext2D, W: number, H: number): void {
  const wall = c.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#24170e');
  wall.addColorStop(0.5, '#3a2516');
  wall.addColorStop(1, '#170f09');
  c.fillStyle = wall;
  c.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 44) {
    c.fillStyle = `rgba(0,0,0,${0.16 + ((x / 44) % 3) * 0.05})`;
    c.fillRect(x, 0, 3, H);
  }
  const lamp = c.createRadialGradient(W * 0.3, H * 0.18, 4, W * 0.3, H * 0.2, W * 0.9);
  lamp.addColorStop(0, 'rgba(255,200,120,0.45)');
  lamp.addColorStop(1, 'rgba(255,160,80,0)');
  c.fillStyle = lamp;
  c.fillRect(0, 0, W, H);
  // Полки с товаром: банки зелий разных цветов (середину закроет продавщица).
  const colors = ['#c0392b', '#2e86c1', '#d4ac0d', '#8e44ad', '#27ae60', '#e67e22'];
  [H * 0.26, H * 0.48].forEach((sy, i) => {
    c.fillStyle = '#1b110a';
    c.fillRect(0, sy, W, 12);
    c.fillStyle = 'rgba(255,190,120,0.18)';
    c.fillRect(0, sy, W, 2);
    for (let x = 10 + i * 14, n = 0; x < W - 24; x += 34 + ((n * 7) % 13), n++) {
      const h = 26 + ((n * 11 + i * 5) % 22);
      const w = 16 + ((n * 5) % 10);
      c.fillStyle = colors[(n + i * 2) % colors.length];
      c.globalAlpha = 0.85;
      c.fillRect(x, sy - h, w, h);
      c.fillRect(x + w / 2 - 3, sy - h - 8, 6, 8);
      c.globalAlpha = 0.35;
      c.fillStyle = '#ffffff';
      c.fillRect(x + 3, sy - h + 4, 3, h - 10);
      c.globalAlpha = 1;
    }
  });
  // Прилавок.
  const top = H * DESK;
  const desk = c.createLinearGradient(0, top, 0, H);
  desk.addColorStop(0, '#5a3a20');
  desk.addColorStop(0.12, '#3b2414');
  desk.addColorStop(1, '#1a0f08');
  c.fillStyle = desk;
  c.fillRect(0, top, W, H - top);
  c.fillStyle = 'rgba(255,210,150,0.25)';
  c.fillRect(0, top, W, 3);
}

/** Витрина Лавки. Закрыта — приглушённая с замком, касание — «откроется на этапе 2-1»; открыта — переход в Лавку. */
export function shopTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): EntryView | null {
  if (!GAME.shop) return null;
  const open = isUnlocked('shop');
  // Бесплатное обновление ассортимента ещё не взято сегодня — золотая точка «есть что посмотреть».
  const free = open && shopStatus(session.save, today(), shopCtx()).nextRefreshCost === 0;
  return artEntry(scene, x, y, w, h, artCardTexture(scene, 'shop', w, h, paintShop), {
    name: 'shopTile',
    title: 'Лавка',
    open,
    lockId: 'shop',
    onOpen: () => scene.scene.start('Shop'),
    goldDot: free,
    // Продавщица за прилавком: низ фигуры уходит за прилавок (обрезка по его линии).
    extra: (root) => {
      if (!hasIllust(KEEPER)) return;
      const place = () => {
        if (!root.scene || !scene.textures.exists(illustKey(KEEPER))) return;
        const img = scene.add.image(w * 0.08, -h / 2 + h * KEEPER_TOP, illustKey(KEEPER)).setOrigin(0.5, 0);
        const k = (h * 0.9) / img.height;
        img.setScale(k);
        img.setCrop(0, 0, img.width, Math.min(img.height, (h * (DESK - KEEPER_TOP)) / k));
        if (!open) img.setTint(0x6c665e);
        // Сразу над картинкой карточки — под названием, замком и тегами.
        root.addAt(img, 1);
      };
      if (scene.textures.exists(illustKey(KEEPER))) place();
      else void loadIllust(scene.game, KEEPER).then(place);
    },
  });
}
