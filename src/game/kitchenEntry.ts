import Phaser from 'phaser';
import { activeMeal, kitchenReady, type KitchenContext, type KitchenIcon } from '../core';
import { GAME } from './content';
import { compactEntry, type EntryView } from './homeBuildings';
import { dot } from './screen';
import { session, today } from './session';
import { skinIcon } from './skin';
import { COLOR, hexNum, RARITY } from './theme';
import { tag } from './ui';
import { isUnlocked } from './unlockBanner';

/**
 * Кухня в Таверне (docs/design/kitchen.md, ядро src/core/kitchen): вход со страницы «Город» (kitchenTile — под
 * Лавкой), иконки продуктов и короткая плашка блюда дня для подготовки к бою (mealTag). Экран — KitchenScene.
 */

/** Контекст Кухни (data/kitchen.json собран в GAME.kitchen; нет файла — Кухни нет). */
export function kitchenCtx(): KitchenContext {
  return GAME as KitchenContext;
}

/** Цвет контурной иконки продукта или блюда (токены theme.ts). */
export const FOOD_TINT: Record<KitchenIcon, string> = {
  meat: COLOR.negative,
  apple: RARITY.red,
  carrot: RARITY.gold,
  honey: COLOR.gold,
  milk: COLOR.textPrimary,
  pot: COLOR.title,
};

/** Иконка продукта/блюда (контур скина в цвете продукта) с центром (x, y). */
export function foodIcon(scene: Phaser.Scene, x: number, y: number, icon: KitchenIcon, size: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, skinIcon(icon)).setDisplaySize(size, size).setTint(hexNum(FOOD_TINT[icon]));
}

/** IconSpec для chip/rewardRow: иконка продукта нужного размера. */
export const foodSpec = (icon: KitchenIcon) => (scene: Phaser.Scene, x: number, y: number, size: number) => foodIcon(scene, x, y, icon, size);

/**
 * Вход на «Городе» (центр x, y; w×h): компактная карточка «Кухня». Блюдо дня готово — подпись «Готово»; сегодня не
 * готовили и на блюдо хватает продуктов — красная точка (повод «выгодно сейчас»). Нет data/kitchen.json — ничего.
 */
export function kitchenTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): EntryView | null {
  const ctx = kitchenCtx();
  if (!ctx.kitchen) return null;
  const open = isUnlocked('kitchen');
  const day = today();
  const meal = open ? activeMeal(session.save, day, ctx) : null;
  const view = compactEntry(scene, x, y, w, h, {
    name: 'kitchenTile',
    title: 'Кухня',
    icon: 'pot',
    open,
    lockId: 'kitchen',
    onOpen: () => scene.scene.start('Kitchen'),
    ...(meal ? { status: { text: 'Готово', tone: 'positive' as const } } : {}),
  });
  if (open && kitchenReady(session.save, day, ctx)) dot(scene, x + w / 2 - 18, y - h / 2 + 16).setName('kitchenDot');
  return view;
}

/**
 * Плашка блюда дня для подготовки к бою (StageScene): иконка-котелок не нужна — название блюда тегом. Нет блюда — null.
 * x — правый край (align right).
 */
export function mealTag(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Container | null {
  const ctx = kitchenCtx();
  if (!ctx.kitchen) return null;
  const meal = activeMeal(session.save, today(), ctx);
  if (!meal) return null;
  return tag(scene, x, y, meal.name, 'positive', { align: 'right' }).setName('stageMeal');
}
