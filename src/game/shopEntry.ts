import Phaser from 'phaser';
import { shopStatus, type ShopContext } from '../core';
import { GAME } from './content';
import { session, today } from './session';
import { skinIcon } from './skin';
import { buildingTile, type BuildingTile } from './tavernEntry';
import { C } from './theme';
import { isUnlocked } from './unlockBanner';

/**
 * Вход в Лавку со страницы «Город»: плитка-«здание» (buildingTile), HomeScene ставит её одной строкой (shopTile).
 */

/** Контекст Лавки (data/shop.json собран в GAME.shop). */
export function shopCtx(): ShopContext {
  if (!GAME.shop) throw new Error('Лавка: нет data/shop.json');
  return GAME as typeof GAME & ShopContext;
}

/** Плитка Лавки. Закрыта — тусклая с замком, касание — «откроется на этапе 2-1»; открыта — переход в Лавку. */
export function shopTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile | null {
  if (!GAME.shop) return null;
  const open = isUnlocked('shop');
  // Бесплатное обновление ассортимента ещё не взято сегодня — зелёная точка, как «можно что-то сделать».
  const free = open && shopStatus(session.save, today(), shopCtx()).nextRefreshCost === 0;
  return buildingTile(scene, x, y, w, h, {
    name: 'shopTile',
    title: 'Лавка',
    art: (size, tint) => scene.add.image(0, 0, skinIcon('bag')).setDisplaySize(size * 0.5, size * 0.5).setTint(tint),
    open,
    status: { text: free ? 'Бесплатное обновление' : 'Товары дня', color: free ? C.success : C.muted },
    note: 'Снаряжение, опыт и свитки за золото',
    lockId: 'shop',
    onOpen: () => scene.scene.start('Shop'),
    dot: free,
  });
}
