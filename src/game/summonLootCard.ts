import Phaser from 'phaser';
import type { SummonLoot } from '../core';
import { backTexture, frameTexture, heroCardSize } from './heroCard';
import { compactNumber } from './frame';
import { oreIcon, roIconImage } from './itemIcons';
import { rewardIcon } from './rewardsView';
import { C, FS, TINT } from './theme';
import { ellipsize, text } from './ui';

/** Короткие подписи на карте (в сетке ×10 «Опыт героев» и «Благословенная руда» обрезались многоточием). */
const CARD_NAME: Partial<Record<SummonLoot['loot'], string>> = { heroExp: 'Опыт', ore: 'Руда' };

/**
 * Лицо карты-награды Таверны (вещь, опыт, золото, алмазы, руда) — в стиле карты героя (drawHeroCard): та же рубашка и
 * рамка по look, крупная иконка, внизу тёмная полоса с названием и количеством. data `w`, `h` — как у карты героя.
 */
export function summonLootFace(scene: Phaser.Scene, x: number, y: number, maxW: number, maxH: number, loot: SummonLoot): Phaser.GameObjects.Container {
  const cw = Math.floor(Math.min(maxW, maxH / heroCardSize(1).h));
  const { w, h } = heroCardSize(cw);
  const s = w / 300;
  const box = scene.add.container(x, y).setName(`lootCard_${loot.loot}`).setData({ w, h });
  const inset = 12 * s;
  box.add(scene.add.image(0, 0, backTexture(scene, loot.look)).setDisplaySize(w - inset * 2, h - inset * 2));
  const size = w * 0.5;
  const iy = -h * 0.1;
  const ico =
    loot.loot === 'gear' && loot.itemId
      ? roIconImage(scene, 0, iy, loot.itemId, size)
      : loot.loot === 'ore'
        ? oreIcon(scene, 0, iy, size)
        : loot.loot === 'gear'
          ? null
          : rewardIcon(scene, 0, iy, loot.loot === 'heroExp' ? 'exp' : loot.loot, size);
  if (ico) box.add(ico);
  const bandH = 104 * s;
  const bandY = h / 2 - inset - bandH / 2;
  box.add(scene.add.rectangle(0, bandY, w - inset * 2, bandH, TINT.cardBand, 0.62));
  box.add(scene.add.image(0, 0, frameTexture(scene, loot.look, w, h)));
  const small = Math.max(FS.caption, Math.round(30 * s));
  const name = text(scene, 0, bandY - bandH * 0.2, CARD_NAME[loot.loot] ?? loot.name, small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 });
  box.add(ellipsize(name, w - inset * 2 - 8 * s));
  if (loot.loot !== 'gear' && loot.loot !== 'ore') {
    box.add(text(scene, 0, bandY + bandH * 0.24, `+${compactNumber(loot.amount)}`, small, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }));
  }
  return box;
}
