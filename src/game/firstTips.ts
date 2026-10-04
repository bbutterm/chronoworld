import Phaser from 'phaser';
import type { StoryDef } from '../core';
import { GAME } from './content';
import { hintDone, markHint, type HintId } from './hints';
import { placeBand, sceneObstacles, type Rect } from './hintLayout';
import { GAME_H, GAME_W, HEADER_H } from './layout';
import { framedPortrait } from './portraitFrame';
import { NAV_H, navY } from './screen';
import { session } from './session';
import { motion } from './state';
import { speakerView } from './storyView';
import { COLOR, E, M, R, S, T, leading } from './theme';
import { plate, text } from './ui';
import { TIPS, type TipDef, type TipId } from './tipTexts';

/**
 * Реплики первого входа (как в AFK — пара слов наставника, когда игрок впервые видит режим): Башня-рогалик, MVP-охота,
 * первый вечер в таверне, первое событие экспедиции, первый заряд босса. Голос персонажа сюжета (Гаррет, Грета, Бруно)
 * в компактной плашке с портретом: имя и одна-две строки (tipTexts.ts, ≤ TIP_MAX знаков).
 *
 * Правила (ui-polish-research §2, §3 п. 3/10, P0 «реплика Гаррета закрывает панель охоты»):
 * - один раз: запоминается в общем списке подсказок обучения (hints.ts, localStorage `chronoworld.hints`; «Сбросить
 *   подсказки» покажет снова). Отметка — когда плашка правда нарисована;
 * - одна подсказка за визит: под диалогом и баннером «Новая функция!» ждёт их закрытия; если на экране уже указатель
 *   обучения (слой `hint`), реплика в этот раз не показывается (и не отмечается — будет в следующий вход);
 * - не поверх данных: экран передаёт желаемый верх, а плашка встаёт в ближайшую полосу, где не закрывает подписи,
 *   числа и кнопки (placeBand, hintLayout.ts);
 * - не мешает: касаний не ловит (кнопки под ней жмутся), первое касание где угодно или TIP_MS её убирают.
 * Слой — `firstTip` (e2e его не считает помехой: касание проходит сквозь).
 */

export { TIPS, type TipId } from './tipTexts';

/** Уже показана (на этом устройстве или устарела по сохранению — tutorial.ts). */
export const tipDone = (id: TipId): boolean => hintDone(id as HintId);

/** Имя слоя плашки. */
export const TIP_NAME = 'firstTip';
const DEPTH = 8800;
/** Сколько висит, если игрок ничего не трогает (мс времени сцены). */
const TIP_MS = 10000;
const W = 1000;
const PORTRAIT = 96;

function speakerOf(key: TipDef['speaker']) {
  const chapters: StoryDef[] = Object.values(GAME.story.chapters);
  const story = chapters.find((ch) => ch.speakers[key]) ?? GAME.story.tavern;
  return speakerView(story as StoryDef | undefined, key, session.save, GAME);
}

/**
 * Показать реплику первого входа id; y — где экран хотел бы видеть верх плашки (единицы игры 1080×1920), итоговое
 * место выбирает placeBand. Уже показана — null. Возвращает контейнер (его можно убрать раньше: destroy()).
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
    // Одна подсказка за визит: указатель обучения уже ведёт игрока — реплика подождёт следующего входа.
    if (tipDone(id) || scene.children.list.some((o) => o.name === 'hint' && o.active)) {
      layer.destroy();
      return;
    }
    markHint(id as HintId);
    draw(scene, layer, def, y);
  };
  scene.events.once(Phaser.Scenes.Events.POST_UPDATE, build);
  return layer;
}

/** Видимые подписи и интерактивные объекты сцены (что реплика не должна закрывать), кроме слоя самой реплики. */
export function obstacleRects(scene: Phaser.Scene, skip: Phaser.GameObjects.GameObject): Rect[] {
  const { controls, texts } = sceneObstacles(scene.children.list, { x: -GAME_W, y: -GAME_H, w: 0, h: 0 }, { w: GAME_W, h: GAME_H }, ['hint', TIP_NAME, skip.name]);
  return [...controls, ...texts];
}

function draw(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, def: TipDef, prefer: number): void {
  const who = speakerOf(def.speaker);
  const left = GAME_W / 2 - W / 2;
  const tx = left + S.s + PORTRAIT + S.s;
  const tw = W - (tx - left) - S.m;
  const name = text(scene, tx, 0, who.name, T.caption, COLOR.title, { fontStyle: 'bold' }).setOrigin(0, 0);
  const body = text(scene, tx, 0, def.text, T.body, COLOR.textPrimary, { align: 'left', wordWrap: { width: tw, useAdvancedWrap: true }, lineSpacing: leading(T.body) }).setOrigin(0, 0);
  const inner = name.height + S.xxs + body.height;
  const h = Math.max(PORTRAIT + 2 * S.s, inner + 2 * S.s);
  const band = placeBand(h, { prefer, avoid: obstacleRects(scene, layer), top: Math.min(prefer, HEADER_H), bottom: Math.max(prefer + h, navY() - NAV_H / 2 - S.xs), x: left, w: W });
  const top = band.y;
  const ty = top + (h - inner) / 2;
  name.setY(ty);
  body.setY(ty + name.height + S.xxs);
  const bg = plate(scene, GAME_W / 2, top + h / 2, W, h, { fill: COLOR.surfaceSunken, alpha: 0.96, border: COLOR.accent, borderW: 3, r: R.l });
  const face = framedPortrait(scene, left + S.s + PORTRAIT / 2, top + h / 2, who.sprite, PORTRAIT, who.gender);
  layer.add([bg, face, name, body]);
  layer.setData('tipBox', { x: left, y: top, w: W, h }).setData('tipOverlap', band.overlap);
  let gone = false;
  const close = () => {
    if (gone || !layer.active) return;
    gone = true;
    scene.input.off('pointerdown', onDown);
    if (motion.reduced) layer.destroy();
    else scene.tweens.add({ targets: layer, alpha: 0, duration: M.fast, ease: E.in, onComplete: () => layer.destroy() });
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
    layer.y = 16;
    scene.tweens.add({ targets: layer, alpha: 1, y: 0, duration: M.base, ease: E.out });
  }
}
