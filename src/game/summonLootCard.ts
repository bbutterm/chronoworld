import Phaser from 'phaser';
import type { CardRarity, Rarity, SummonLoot } from '../core';
import { GAME } from './content';
import { backTexture, frameTexture, heroCardSize } from './heroCard';
import { compactNumber } from './frame';
import { oreIcon, roIconImage } from './itemIcons';
import { rewardIcon } from './rewardsView';
import { C, FS, TINT } from './theme';
import { ellipsize, text } from './ui';

/** Короткие подписи на карте (в сетке ×10 «Опыт героев» и «Благословенная руда» обрезались многоточием). */
const CARD_NAME: Partial<Record<SummonLoot['loot'], string>> = { heroExp: 'Опыт', ore: 'Руда' };

/** Имя вещи на карте: до стольких строк, мельче основного не больше чем на столько (шаг 2), сжатие не сильнее. */
const GEAR_LINES = 3;
const GEAR_SHRINK = 4;
const GEAR_MIN_SCALE = 0.8;

/**
 * Слова в ≤ n строк так, чтобы самая широкая строка была как можно уже (перебор разрывов: в имени вещи 1–4 слова).
 * Перенос Phaser жадный: «Поножи / ночного караула» вместо «Поножи ночного / караула».
 */
export function balancedLines(words: readonly string[], n: number, measure: (s: string) => number): string[] {
  const whole = [words.join(' ')];
  if (n <= 1 || words.length <= 1) return whole;
  let best = whole;
  let bestW = measure(whole[0]);
  for (let i = 1; i < words.length; i++) {
    const rest = balancedLines(words.slice(i), n - 1, measure);
    const lines = [words.slice(0, i).join(' '), ...rest];
    const w = Math.max(...lines.map(measure));
    if (w < bestW) {
      best = lines;
      bestW = w;
    }
  }
  return best;
}

/**
 * Имя вещи целиком (first-30min P3: «Составн…» вместо «Составной лук»): одной строкой, иначе в две-три по словам,
 * при нехватке — мельче на шаг (на телефоне шрифт не бывает мельче 12 CSS px — viewport.ts), затем чуть уже
 * (setScale до GEAR_MIN_SCALE: одно длинное слово на узкой карте ×10). Не влезло и так — многоточие.
 * Центр — (0, 0); видимый размер (displayWidth/Height) ≤ maxW × maxH.
 */
function gearName(scene: Phaser.Scene, name: string, size: number, maxW: number, maxH: number): Phaser.GameObjects.Text {
  const t = text(scene, 0, 0, name, size, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4, align: 'center' });
  const words = name.split(' ').filter(Boolean);
  const measure = (s: string) => t.setText(s).width;
  let best: { fs: number; text: string; k: number } | null = null;
  for (let fs = size; fs >= size - GEAR_SHRINK; fs -= 2) {
    t.setFontSize(fs);
    for (let n = 1; n <= GEAR_LINES; n++) {
      const lines = balancedLines(words, n, measure);
      t.setText(lines.join('\n'));
      const k = Math.min(1, maxW / t.width, maxH / t.height);
      if (k >= 1) return t;
      if (!best || k > best.k) best = { fs, text: t.text, k };
      if (lines.length < n) break;
    }
  }
  if (best && best.k >= GEAR_MIN_SCALE) return t.setFontSize(best.fs).setText(best.text).setScale(best.k);
  t.setFontSize(size - GEAR_SHRINK).setText(name);
  return ellipsize(t, maxW);
}

/** Рамка вещи по её редкости — как в сумке и на «Снаряжении» (RARITY_COLORS: обычная кремовая, редкая синяя, эпик фиолетовый). */
const ITEM_FRAME: Record<Rarity, CardRarity | 'none'> = { common: 'none', rare: 'blue', epic: 'purple' };

/**
 * Рамка и рубашка карты-награды (ui-heroes 3). Зелёный, синий и фиолетовый в Таверне — редкости героев: фиолетовая
 * руда или зелёная обычная вещь говорили неправду о редкости. Вещь — цветом своей редкости, как в сумке (обычная —
 * нейтральная); золото, опыт, алмазы и руда — нейтральная рамка. Ядро (loot.look) не трогаем: только вид.
 */
export function lootFrameLook(loot: Pick<SummonLoot, 'loot' | 'itemId'>, rarityOf: (itemId: string) => Rarity | undefined = itemRarity): CardRarity | 'none' {
  if (loot.loot !== 'gear' || !loot.itemId) return 'none';
  const r = rarityOf(loot.itemId);
  return r ? ITEM_FRAME[r] : 'none';
}

function itemRarity(itemId: string): Rarity | undefined {
  return GAME.equipment?.items[itemId]?.rarity;
}

/**
 * Лицо карты-награды Таверны (вещь, опыт, золото, алмазы, руда) — в стиле карты героя (drawHeroCard): рубашка и
 * рамка по lootFrameLook (вещь — цвет её редкости, валюта — нейтральная), крупная иконка, внизу тёмная полоса с названием и количеством. data `w`, `h` — как у карты героя.
 * У вещи числа нет — её имя занимает полосу целиком (в две-три строки, полоса растёт вверх к иконке).
 */
export function summonLootFace(scene: Phaser.Scene, x: number, y: number, maxW: number, maxH: number, loot: SummonLoot): Phaser.GameObjects.Container {
  const cw = Math.floor(Math.min(maxW, maxH / heroCardSize(1).h));
  const { w, h } = heroCardSize(cw);
  const s = w / 300;
  const box = scene.add.container(x, y).setName(`lootCard_${loot.loot}`).setData({ w, h });
  const inset = 12 * s;
  const look = lootFrameLook(loot);
  box.setData('look', look);
  box.add(scene.add.image(0, 0, backTexture(scene, look)).setDisplaySize(w - inset * 2, h - inset * 2));
  const small = Math.max(FS.caption, Math.round(30 * s));
  const textW = w - inset * 2 - 4 * s;
  const bottom = h / 2 - inset;
  let bandH = 104 * s;
  // Вещь: числа нет — имя на всю полосу; полоса растёт вверх (до половины карты), иконка встаёт над ней.
  const gear = loot.loot === 'gear' ? gearName(scene, loot.name, small, textW, h * 0.5 - inset - 16 * s) : null;
  if (gear) bandH = Math.max(bandH, gear.displayHeight + 16 * s);
  const bandY = bottom - bandH / 2;
  const top = -h / 2 + inset + 8 * s;
  const iconBottom = bottom - bandH - 6 * s;
  const size = Math.min(w * 0.5, iconBottom - top);
  // Иконка — на прежнем месте, пока не задевает полосу; иначе — посередине между верхом карты и полосой.
  const iy = -h * 0.1 + size / 2 <= iconBottom ? -h * 0.1 : (top + iconBottom) / 2;
  const ico =
    loot.loot === 'gear' && loot.itemId
      ? roIconImage(scene, 0, iy, loot.itemId, size)
      : loot.loot === 'gear'
        ? null
        : loot.loot === 'ore'
          ? oreIcon(scene, 0, iy, size)
          : rewardIcon(scene, 0, iy, loot.loot === 'heroExp' ? 'exp' : loot.loot, size);
  if (ico) box.add(ico);
  box.add(scene.add.rectangle(0, bandY, w - inset * 2, bandH, TINT.cardBand, 0.62));
  box.add(scene.add.image(0, 0, frameTexture(scene, look, w, h)));
  if (gear) {
    box.add(gear.setPosition(0, bandY));
    return box;
  }
  const name = text(scene, 0, bandY - bandH * 0.2, CARD_NAME[loot.loot] ?? loot.name, small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 });
  box.add(ellipsize(name, textW));
  if (loot.loot !== 'ore') {
    box.add(text(scene, 0, bandY + bandH * 0.24, `+${compactNumber(loot.amount)}`, small, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }));
  }
  return box;
}
