import Phaser from 'phaser';
import { heroCard, type HeroState } from '../core';
import { GAME } from './content';
import { heroSprite } from './flow';
import { unitFigure } from './screen';
import { CARD_BACK, GLOW } from './tavernArt';
import { ellipsize, text } from './ui';
import { C, FS } from './theme';

/**
 * Карточка героя для Таверны: рамка цвета редкости, фигура героя на подсвеченном фоне, имя (и класс на крупной).
 * ВРЕМЕННО локальная: общий рисовальщик карточек src/game/heroCard.ts (drawHeroCard) делает другой агент параллельно —
 * после слияния заменить summonCardFace на него (тот же вид: рамка редкости + спрайт/портрет + имя).
 */

export const rarityColor = (hex: string): number => Phaser.Display.Color.HexStringToColor(hex).color;

/** Рубашка карты (w×h, центр в 0,0). */
export function cardBack(scene: Phaser.Scene, w: number, h: number): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, CARD_BACK).setDisplaySize(w, h);
}

/**
 * Лицевая сторона карты (контейнер с центром в 0,0; сам ставится в x, y). big — крупная карта (×1, показ фиолетовой):
 * ещё класс и название редкости. Фигура грузится по требованию и встаёт в карту, когда готова.
 */
export function summonCardFace(scene: Phaser.Scene, x: number, y: number, w: number, h: number, hero: HeroState, big = false): Phaser.GameObjects.Container {
  const card = heroCard(hero, GAME);
  const col = rarityColor(card.rarity.color);
  const box = scene.add.container(x, y);
  // Подложка, плашка имени и рамка — одна картинка на редкость и размер (рисуется один раз на канвасе:
  // Graphics перестраивается каждый кадр, а десять карт на столе — это заметно на слабых телефонах).
  const plateH = big ? h * 0.24 : h * 0.22;
  box.add(scene.add.image(0, 0, faceTexture(scene, card.rarity.color, w, h, plateH)));
  const halo = scene.add.image(0, -h * 0.1, GLOW).setTint(col).setAlpha(0.7).setDisplaySize(w * 1.3, h * 0.95).setBlendMode(Phaser.BlendModes.ADD);
  box.add(halo);
  // Пол под ногами.
  const floor = scene.add.image(0, h * 0.2, GLOW).setTint(0x000000).setAlpha(0.6).setDisplaySize(w * 0.75, h * 0.1);
  box.add(floor);
  const nameY = big ? h / 2 - plateH * 0.72 - 6 : h / 2 - plateH / 2 - 6;
  box.add(ellipsize(text(scene, 0, nameY, card.name, big ? FS.h1 : FS.caption, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), w - 20));
  if (big) {
    box.add(ellipsize(text(scene, 0, nameY + plateH * 0.42, `${card.jobName} · ${card.rarity.name}`, FS.small, card.rarity.color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }), w - 24));
  }

  // Фигура героя: ноги на «полу», высота — почти вся карта над плашкой.
  const feet = h * 0.2;
  const figH = h * 0.62;
  unitFigure(scene, heroSprite(hero, GAME), x, y + feet, figH, {
    maxScale: big ? 3 : 1.8,
    onReady: (o) => {
      if (!box.scene) {
        o.destroy();
        return;
      }
      // unitFigure поставил фигуру в мировые координаты — переносим в карту (под плашку имени).
      o.setPosition(0, o instanceof Phaser.GameObjects.Sprite ? feet : feet - figH / 2);
      box.addAt(o, box.getIndex(floor) + 1);
    },
  });
  return box;
}

/** Рамка редкости с подложкой и плашкой имени (канвас, кэш по цвету и размеру). */
function faceTexture(scene: Phaser.Scene, color: string, w: number, h: number, plateH: number): string {
  const key = `tavern_face_${color.slice(1)}_${Math.round(w)}x${Math.round(h)}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, Math.round(w), Math.round(h));
  if (!tex) return '__WHITE';
  const c = tex.getContext();
  const col = Phaser.Display.Color.HexStringToColor(color);
  const rgb = (k: number, a = 1) => `rgba(${Math.round(col.red * k)},${Math.round(col.green * k)},${Math.round(col.blue * k)},${a})`;
  const r = Math.round(w * 0.07);
  const rr = (x: number, y: number, ww: number, hh: number, rad: number) => {
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + ww, y, x + ww, y + hh, rad);
    c.arcTo(x + ww, y + hh, x, y + hh, rad);
    c.arcTo(x, y + hh, x, y, rad);
    c.arcTo(x, y, x + ww, y, rad);
    c.closePath();
  };
  // Подложка: тёмный цвет редкости, светлее кверху.
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, rgb(0.34));
  bg.addColorStop(1, rgb(0.12));
  c.fillStyle = bg;
  rr(0, 0, w, h, r);
  c.fill();
  // Плашка имени.
  c.save();
  rr(0, 0, w, h, r);
  c.clip();
  c.fillStyle = 'rgba(13,9,6,0.9)';
  c.fillRect(6, h - plateH - 6, w - 12, plateH);
  c.fillStyle = rgb(1);
  c.fillRect(6, h - plateH - 6, w - 12, 4);
  c.restore();
  // Рамка: толстый контур цвета редкости, тонкая золотая линия внутри.
  const lw = Math.max(6, w * 0.04);
  c.strokeStyle = rgb(1);
  c.lineWidth = lw;
  rr(lw / 2 + 1, lw / 2 + 1, w - lw - 2, h - lw - 2, r);
  c.stroke();
  c.strokeStyle = 'rgba(240,207,138,0.7)';
  c.lineWidth = 2;
  rr(12, 12, w - 24, h - 24, Math.max(4, r - 8));
  c.stroke();
  // Самоцветы в верхних углах.
  const gem = Math.max(9, w * 0.05);
  for (const gx of [10, w - 10]) {
    const gy = 10;
    for (const [size, fill] of [
      [gem + 2, '#f0cf8a'],
      [gem, rgb(1)],
    ] as const) {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(gx, gy - size);
      c.lineTo(gx + size, gy);
      c.lineTo(gx, gy + size);
      c.lineTo(gx - size, gy);
      c.closePath();
      c.fill();
    }
  }
  tex.refresh();
  return key;
}
