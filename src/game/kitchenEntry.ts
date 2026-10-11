import Phaser from 'phaser';
import { activeMeal, kitchenReady, pantryText, type FullContext, type KitchenIcon, type Pantry, type Recipe } from '../core';
import { GAME } from './content';
import { compactEntry, type EntryView } from './homeBuildings';
import { juiceOn } from './juice';
import { composeDish, DISH_PX, type Pixels } from './kitchenDishArt';
import { GAME_W } from './layout';
import { dot } from './screen';
import { session, today } from './session';
import { skinIcon } from './skin';
import { COLOR, E, hexNum, M, RARITY, S } from './theme';
import { ellipsize, rewardRow, tag, type ChipSpec } from './ui';
import { isUnlocked } from './unlockBanner';
import { roIcon, roIconScale } from './itemIcons';

/**
 * Кухня в Таверне (docs/design/kitchen.md, ядро src/core/kitchen): вход со страницы «Город» (kitchenTile — под
 * Лавкой), иконки продуктов и блюд (dishIcon — собраны из иконок RO, kitchenDishArt.ts), короткая плашка блюда дня
 * для подготовки к бою (mealTag), полученные продукты в итогах экспедиции, охоты и сундука (foodChips, foodLine,
 * floatFood). Экран — KitchenScene.
 */

/** Контекст Кухни (data/kitchen.json собран в GAME.kitchen; нет файла — Кухни нет). */
export function kitchenCtx(): FullContext {
  return GAME;
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

/**
 * Иконка продукта/блюда с центром (x, y): родная иконка RO (assets/ui/icons/item_food_<icon>.png — яблоко 512, морковь 515,
 * мясо 517, мёд 518, молоко 519; целый масштаб, без tint), нет такой — контур скина в цвете продукта (котелок).
 */
export function foodIcon(scene: Phaser.Scene, x: number, y: number, icon: KitchenIcon, size: number): Phaser.GameObjects.Image {
  const ro = roIcon(scene, `food_${icon}`);
  if (ro) return scene.add.image(x, y, ro).setScale(roIconScale(size));
  return scene.add.image(x, y, skinIcon(icon)).setDisplaySize(size, size).setTint(hexNum(FOOD_TINT[icon]));
}

/** IconSpec для chip/rewardRow: иконка продукта нужного размера. */
export const foodSpec = (icon: KitchenIcon) => (scene: Phaser.Scene, x: number, y: number, size: number) => foodIcon(scene, x, y, icon, size);

/** Пиксели загруженной текстуры (иконки RO 24×24) или undefined. */
function texturePixels(scene: Phaser.Scene, key: string | undefined): Pixels | undefined {
  if (!key || typeof document === 'undefined') return undefined;
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (!img?.width || !img.height) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) return undefined;
  c.drawImage(img, 0, 0);
  const px = { w: img.width, h: img.height, data: c.getImageData(0, 0, img.width, img.height).data };
  canvas.width = 0;
  canvas.height = 0;
  return px;
}

/**
 * Текстура блюда recipe.dish (собирается один раз на игру из иконок продуктов RO, kitchenDishArt.ts). Нет поля dish,
 * не загружена ни одна иконка его продуктов или нет canvas — undefined (рисуем иконку продукта).
 */
function dishTexture(scene: Phaser.Scene, recipe: Recipe): string | undefined {
  if (!recipe.dish || typeof document === 'undefined') return undefined;
  const key = `kitchen_dish_${recipe.id}`;
  if (scene.textures.exists(key)) return key;
  const cfg = kitchenCtx().kitchen;
  const icons: Record<string, Pixels | undefined> = {};
  for (const id of recipe.dish.items) {
    const g = cfg?.ingredients.find((x) => x.id === id);
    icons[id] = texturePixels(scene, roIcon(scene, g ? `food_${g.icon}` : undefined));
  }
  if (!recipe.dish.items.some((id) => icons[id])) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = DISH_PX;
  canvas.height = DISH_PX;
  const c = canvas.getContext('2d');
  if (!c) return undefined;
  const img = c.createImageData(DISH_PX, DISH_PX);
  img.data.set(composeDish(recipe.dish, icons));
  c.putImageData(img, 0, 0);
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return undefined;
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

/**
 * Картинка блюда с центром (x, y) в квадрате box: пиксельная, целый масштаб (×3 в медальоне рецепта). Нет картинки
 * блюда — иконка продукта icon (как раньше).
 */
export function dishIcon(scene: Phaser.Scene, x: number, y: number, recipe: Recipe, box: number): Phaser.GameObjects.Image {
  const key = dishTexture(scene, recipe);
  if (key) return scene.add.image(x, y, key).setScale(Math.max(1, Math.floor((box * 0.95) / DISH_PX)));
  return foodIcon(scene, x, y, recipe.icon, box * 0.62);
}

/**
 * Полученные продукты (поле ingredients итогов claimExpedition, HuntGrant, claimOffline) чипами «иконка ×N» для rewardRow —
 * в порядке кладовой (data/kitchen.json). Нет выдачи или Кухни — [].
 */
export function foodChips(gained: Pantry | undefined): ChipSpec[] {
  const cfg = kitchenCtx().kitchen;
  if (!cfg || !gained) return [];
  return cfg.ingredients.filter((g) => (gained[g.id] ?? 0) > 0).map((g) => ({ icon: foodSpec(g.icon), value: `×${gained[g.id]}` }));
}

/** Строка итога для тостов и окон: «Продукты: Мясо ×2, Мёд ×1». Нет выдачи — null. */
export function foodLine(gained: Pantry | undefined): string | null {
  const list = gained ? pantryText(gained, kitchenCtx()) : '';
  return list ? `Продукты: ${list}` : null;
}

/**
 * Продукты всплывают рядом чипов над точкой получения и гаснут — как опыт над сундуком (CampaignScene floatGain).
 * Ряд не выходит за поля экрана. Нет выдачи — null. «Уменьшить анимацию» — постоять и исчезнуть без движения.
 */
export function floatFood(scene: Phaser.Scene, from: { x: number; y: number }, gained: Pantry | undefined): Phaser.GameObjects.Container | null {
  const items = foodChips(gained);
  if (!items.length) return null;
  const row = rewardRow(scene, from.x, from.y - 40, items, { size: 's', gap: S.xxs, maxW: GAME_W - 2 * S.l }).setDepth(50).setName('foodGain');
  const half = row.width / 2;
  row.setX(Math.min(GAME_W - S.l - half, Math.max(S.l + half, from.x)));
  if (!juiceOn()) {
    scene.time.delayedCall(M.count * 2, () => row.destroy());
    return row;
  }
  row.setAlpha(0);
  scene.tweens.add({ targets: row, alpha: 1, y: from.y - 110, duration: M.slow, ease: E.out });
  scene.tweens.add({ targets: row, alpha: 0, y: from.y - 160, delay: M.slow + M.count, duration: M.base, ease: E.in, onComplete: () => row.destroy() });
  return row;
}

/**
 * Вход на «Городе» (центр x, y; w×h): компактная карточка «Кухня». Блюдо дня приготовлено — в медальоне его картинка,
 * подпись «Сыты» зелёным; сегодня не готовили и на блюдо хватает продуктов — «Готовить» и красная точка (повод
 * «выгодно сейчас»). Подписи короткие: в узкой карточке под Лавкой помещается около 8 букв. Нет data/kitchen.json — ничего.
 */
export function kitchenTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): EntryView | null {
  const ctx = kitchenCtx();
  if (!ctx.kitchen) return null;
  const open = isUnlocked('kitchen');
  const day = today();
  const meal = open ? activeMeal(session.save, day, ctx) : null;
  const ready = open && kitchenReady(session.save, day, ctx);
  const status = meal ? { text: 'Сыты', tone: 'positive' as const } : ready ? { text: 'Готовить', tone: 'neutral' as const } : null;
  const view = compactEntry(scene, x, y, w, h, {
    name: 'kitchenTile',
    title: 'Кухня',
    icon: 'pot',
    open,
    lockId: 'kitchen',
    onOpen: () => scene.scene.start('Kitchen'),
    ...(status ? { status } : {}),
  });
  const sub = status && view.root.list.find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text && o !== view.label);
  if (sub) ellipsize(sub.setName('kitchenStatus'), w / 2 - S.m - sub.x);
  // Блюдо дня — его картинка в медальоне вместо котелка (котелок — 48 % стороны медальона compactEntry; картинка ×2 — внутри кольца).
  const pot = meal && view.root.list.find((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image && o.texture.key === skinIcon('pot'));
  if (meal && pot) {
    view.root.add(dishIcon(scene, pot.x, pot.y, meal, (pot.displayWidth / 0.48) * 0.72).setName('kitchenTileDish'));
    pot.setVisible(false);
  }
  if (ready) dot(scene, x + w / 2 - 18, y - h / 2 + 16).setName('kitchenDot');
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
