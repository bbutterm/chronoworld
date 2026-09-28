import Phaser from 'phaser';
import { shopStatus, type ShopContext } from '../core';
import { GAME } from './content';
import { medallion } from './decor';
import { card } from './screen';
import { session, today } from './session';
import { SKIN_TINT, skinIcon } from './skin';
import { C, FS, TITLE_STYLE } from './theme';
import { pressable, text } from './ui';
import { isUnlocked, lockedToast } from './unlockBanner';

/**
 * Вход в Лавку с главной: узкая плитка-медальон в полосе под «В кампанию», справа от плитки «Охота на босса»
 * (huntEntry.ts: 780 × 140 по центру, x 150…930). HomeScene ставит её одной строкой (shopTile) — раскладка здесь.
 */

/** Контекст Лавки (data/shop.json собран в GAME.shop). */
export function shopCtx(): ShopContext {
  if (!GAME.shop) throw new Error('Лавка: нет data/shop.json');
  return GAME as typeof GAME & ShopContext;
}

/** Место плитки на главной: правый край полосы под «В кампанию» (у охоты y 1640, h 140; зазор 16 до её края 930). */
export const SHOP_TILE = { x: 1010, y: 1640, w: 128, h: 140 } as const;

/** Плитка Лавки. Закрыта — тусклая с замком, касание — «откроется на этапе 2-1»; открыта — переход в Лавку. */
export function shopTile(scene: Phaser.Scene, x: number = SHOP_TILE.x, y: number = SHOP_TILE.y, w: number = SHOP_TILE.w, h: number = SHOP_TILE.h): void {
  if (!GAME.shop) return;
  const open = isUnlocked('shop');
  const bg = card(scene, x, y, w, h);
  bg.setName('shopTile');
  const icon = medallion(scene, x, y - 18, 80, 'bag', open ? SKIN_TINT.gold : SKIN_TINT.creamDim);
  text(scene, x, y + 46, 'Лавка', FS.caption, open ? C.title : C.dim, TITLE_STYLE);
  if (!open) {
    bg.setAlpha(0.75);
    icon.setAlpha(0.7);
    scene.add.image(x + w / 2 - 22, y - h / 2 + 22, skinIcon('lock')).setDisplaySize(30, 30).setTint(SKIN_TINT.creamDim);
    pressable(scene, bg, w, h, () => lockedToast(scene, 'shop'));
    return;
  }
  pressable(scene, bg, w, h, () => scene.scene.start('Shop'));
  // Бесплатное обновление ассортимента ещё не взято сегодня — зелёная точка, как «можно что-то сделать».
  const st = shopStatus(session.save, today(), shopCtx());
  if (st.nextRefreshCost === 0) scene.add.circle(x + w / 2 - 14, y - h / 2 + 14, 12, 0x3fbf5a).setStrokeStyle(3, 0x0f2a12);
}
