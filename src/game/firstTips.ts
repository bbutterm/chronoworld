import Phaser from 'phaser';
import type { StoryDef } from '../core';
import { GAME } from './content';
import { hintDone, markHint, type HintId } from './hints';
import { GAME_W } from './layout';
import { framedPortrait } from './portraitFrame';
import { session } from './session';
import { motion } from './state';
import { speakerView } from './storyView';
import { C, FS } from './theme';
import { text } from './ui';
import { TIPS, type TipDef, type TipId } from './tipTexts';

/**
 * Подсказки первого входа (как в AFK — пара реплик наставника, когда игрок впервые видит новый режим): Башня-рогалик,
 * MVP-охота, первый вечер в таверне, первое событие экспедиции, первый заряд босса. Реплика живым голосом персонажа
 * сюжета (Гаррет, Грета, Бруно) в плашке с портретом, 2–3 строки.
 *
 * - Показывается один раз: запоминается в том же списке, что подсказки обучения (hints.ts, localStorage
 *   `chronoworld.hints`; «Сбросить подсказки» покажет снова). Отметка — когда плашка нарисована.
 * - Не мешает: плашка не ловит касания (кнопки под ней нажимаются), первое касание где угодно или TIP_MS её убирают.
 * - Ждёт, пока закроются сюжетный диалог и баннер «Новая функция!» (как hintPointer).
 * Слой — `firstTip` (e2e его не считает помехой: касание проходит сквозь).
 */

export { TIPS, type TipId } from './tipTexts';

/** Уже показана (на этом устройстве или устарела по сохранению — tutorial.ts). */
export const tipDone = (id: TipId): boolean => hintDone(id as HintId);

/** Имя слоя плашки. */
export const TIP_NAME = 'firstTip';
const DEPTH = 8800;
/** Сколько висит, если игрок ничего не трогает (мс времени сцены). */
const TIP_MS = 12000;
const W = 1000;
const PORTRAIT = 150;

function speakerOf(key: TipDef['speaker']) {
  const chapters: StoryDef[] = Object.values(GAME.story.chapters);
  const story = chapters.find((ch) => ch.speakers[key]) ?? GAME.story.tavern;
  return speakerView(story as StoryDef | undefined, key, session.save, GAME);
}

/**
 * Показать подсказку первого входа id с верхним краем на y (единицы игры 1080×1920). Уже показана — null.
 * Возвращает контейнер (его можно убрать раньше: destroy()).
 */
export function firstTip(scene: Phaser.Scene, id: TipId, y: number, depth = DEPTH): Phaser.GameObjects.Container | null {
  if (tipDone(id)) return null;
  const def = TIPS[id];
  const layer = scene.add.container(0, 0).setDepth(depth).setName(TIP_NAME).setData('tipId', id);
  const build = () => {
    if (!layer.scene || !layer.active) return;
    if (scene.children.getByName('dialogue') || scene.children.getByName('unlockBanner')) {
      scene.events.once(Phaser.Scenes.Events.POST_UPDATE, build);
      return;
    }
    // Отметка — когда плашка правда нарисована (экран мог смениться раньше — тогда покажется в следующий раз).
    if (tipDone(id)) {
      layer.destroy();
      return;
    }
    markHint(id as HintId);
    draw(scene, layer, def, y);
  };
  scene.events.once(Phaser.Scenes.Events.POST_UPDATE, build);
  return layer;
}

function draw(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, def: TipDef, top: number): void {
  const who = speakerOf(def.speaker);
  const left = GAME_W / 2 - W / 2;
  const tx = left + PORTRAIT + 50;
  const tw = W - PORTRAIT - 80;
  const name = text(scene, tx, top + 36, who.name, FS.small, C.gold, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }).setOrigin(0, 0.5);
  const body = text(scene, tx, top + 62, def.text, FS.body, C.text, { align: 'left', wordWrap: { width: tw, useAdvancedWrap: true }, lineSpacing: 4 }).setOrigin(0, 0);
  const h = Math.max(PORTRAIT + 40, 62 + body.height + 28);
  const bg = scene.add.rectangle(GAME_W / 2, top + h / 2, W, h, 0x120c07, 0.97).setStrokeStyle(5, 0xc9a45c, 1);
  const face = framedPortrait(scene, left + 20 + PORTRAIT / 2, top + h / 2, who.sprite, PORTRAIT, who.gender);
  layer.add([bg, face, name, body]);
  layer.setData('tipBox', { x: left, y: top, w: W, h });
  let gone = false;
  const close = () => {
    if (gone || !layer.active) return;
    gone = true;
    scene.input.off('pointerdown', onDown);
    if (motion.reduced) layer.destroy();
    else scene.tweens.add({ targets: layer, alpha: 0, duration: 220, onComplete: () => layer.destroy() });
  };
  // Касание где угодно (и сама кнопка под плашкой) — плашка уходит; сама она касаний не ловит. Касание, начатое до
  // показа (то, что открыло экран или окно, — на медленном кадре оно доходит позже), не считается.
  let armedAt = Infinity;
  const onDown = (p: Phaser.Input.Pointer) => {
    if (p.downTime >= armedAt) close();
  };
  scene.time.delayedCall(400, () => {
    armedAt = scene.game.loop.time;
    scene.input.on('pointerdown', onDown);
  });
  scene.time.delayedCall(TIP_MS, close);
  layer.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.off('pointerdown', onDown));
  if (!motion.reduced) {
    layer.setAlpha(0);
    layer.y = -16;
    scene.tweens.add({ targets: layer, alpha: 1, y: 0, duration: 260, ease: 'Quad.easeOut' });
  }
}
