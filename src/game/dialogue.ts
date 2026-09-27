import Phaser from 'phaser';
import { markScenesSeen, pendingScenes, type StoryScene, type StoryTrigger } from '../core';
import { GAME } from './content';
import { GAME_H, GAME_W } from './layout';
import { portrait } from './screen';
import { commit, session } from './session';
import { skinIcon, SKIN, SKIN_TINT } from './skin';
import { portraitKey, SPRITES } from './sprites';
import { isChapterFinale, speakerView } from './storyView';
import { button, panel, text } from './ui';
import { FS, OUTLINE, TOUCH } from './theme';

/** Имя слоя диалога (e2e ищет его, чтобы пролистать сцену). */
export const DIALOGUE_NAME = 'dialogue';
const DEPTH = 9500;
/** Печать по буквам: мс на символ. */
const TYPE_MS = 22;
/**
 * Авто-режим (авто-прохождение, T1-05): строка висит не меньше AUTO_LINE_MS после того, как дописана, плюс время
 * на чтение по длине — сюжет успевают прочитать. Финал главы и сцена босса в авто не листаются (только касанием).
 */
export const AUTO_LINE_MS = 4000;
const AUTO_CHAR_MS = 45;
/**
 * T1-06. Касание, начатое раньше, чем строка появилась, или в первые LINE_GUARD_MS после этого, строку не листает:
 * это «хвост» прошлого нажатия (двойной тап по «В бой», «Пропустить» в бою) или случайный тап. Время — по часам
 * браузера (время DOM-события), а не по кадрам: на медленном кадре касание «из прошлого» иначе проскакивает.
 */
export const LINE_GUARD_MS = 250;

const PANEL_W = 1040;
const PANEL_H = 370;
const PANEL_Y = GAME_H - 30 - PANEL_H / 2;
const PORTRAIT = 210;

export interface DialogueOptions {
  /** Строки листаются сами (авто-прохождение не должно ждать игрока). Касание по-прежнему листает. */
  auto?: boolean;
}

/** Открыт ли диалог на сцене. */
export const dialogueOpen = (scene: Phaser.Scene) => !!scene.children.getByName(DIALOGUE_NAME);

/**
 * Показать сцены сюжета по очереди поверх экрана: плашка снизу — портрет, имя, текст по буквам.
 * Касание дописывает строку, второе — следующая; «Пропустить» закрывает текущую сцену. Каждая сцена
 * помечается увиденной (save.seenScenes), когда закрыта. После последней — onDone.
 */
export function playScenes(scene: Phaser.Scene, scenes: readonly StoryScene[], onDone: () => void, opts: DialogueOptions = {}): void {
  const queue = [...scenes];
  const next = () => {
    const s = queue.shift();
    if (!s) {
      onDone();
      return;
    }
    showScene(scene, s, () => {
      commit(markScenesSeen(session.save, [s.id]));
      next();
    }, opts);
  };
  next();
}

/**
 * Сюжет по поводу trigger: есть не увиденные сцены — показать и потом onDone; нет — onDone сразу.
 * Возвращает true, если диалог открыт.
 */
export function playStory(scene: Phaser.Scene, trigger: StoryTrigger, onDone: () => void, opts: DialogueOptions = {}): boolean {
  const scenes = pendingScenes(session.save, trigger, GAME);
  playScenes(scene, scenes, onDone, opts);
  return scenes.length > 0;
}

/** Начать бой на этапе: сначала сюжет «перед этапом» (и начала главы), потом бой. */
export function startStageBattle(scene: Phaser.Scene, stageId: string, opts: DialogueOptions = {}): void {
  playStory(scene, { type: 'beforeStage', stageId }, () => scene.scene.start('Battle', { mode: 'stage', stageId }), opts);
}

function showScene(scene: Phaser.Scene, s: StoryScene, onClose: () => void, opts: DialogueOptions): void {
  const story = GAME.story.chapters[s.chapter];
  // Финал главы и сцена босса — кульминация: в авто-режиме их не листаем сами.
  const auto = !!opts.auto && !s.bossIntro && !isChapterFinale(s, GAME);
  const layer = scene.add.container(0, 0).setDepth(DEPTH).setName(DIALOGUE_NAME);
  // Затемнение ловит все касания: экран под диалогом недоступен (бой не стартует, кнопки не жмутся).
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.45).setInteractive();
  const box = panel(scene, GAME_W / 2, PANEL_Y, PANEL_W, PANEL_H, 'ui_panel');
  const top = PANEL_Y - PANEL_H / 2;
  const left = GAME_W / 2 - PANEL_W / 2;

  // Портрет в рамке — наполовину над плашкой, слева.
  const px = left + 40 + PORTRAIT / 2;
  const py = top - 20;
  const frame = panel(scene, px, py, PORTRAIT + 20, PORTRAIT + 20, 'ui_slot_filled');
  const face = scene.add.container(px, py);
  const nameText = text(scene, px + PORTRAIT / 2 + 40, top + 44, '', FS.h2, SKIN.goldLight, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5);
  const body = text(scene, left + 50, top + 130, '', FS.body, SKIN.cream, {
    wordWrap: { width: PANEL_W - 100, useAdvancedWrap: true },
    lineSpacing: 10,
    align: 'left',
  }).setOrigin(0, 0);
  const more = text(scene, GAME_W / 2 + PANEL_W / 2 - 40, PANEL_Y + PANEL_H / 2 - 40, '', FS.caption, SKIN.creamDim, OUTLINE).setOrigin(1, 0.5);
  const skip = button(scene, GAME_W / 2 + PANEL_W / 2 - 150, top - 70, 280, TOUCH, 'k:buttonLong_beige', 'Пропустить', () => close(), FS.h3);
  layer.add([shade, box, frame, face, nameText, body, more, skip.container]);

  let line = -1;
  let shown = 0;
  let full = '';
  let typer: Phaser.Time.TimerEvent | null = null;
  let autoNext: Phaser.Time.TimerEvent | null = null;
  let closed = false;
  /** Когда появилась текущая строка (performance.now) и засчитано ли касание, начатое на затемнении. */
  let lineAt = performance.now();
  let armed = false;

  const stopTimers = () => {
    typer?.remove();
    autoNext?.remove();
    typer = autoNext = null;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    stopTimers();
    layer.destroy();
    onClose();
  };
  const finishLine = () => {
    typer?.remove();
    typer = null;
    shown = full.length;
    body.setText(full);
    more.setText(line < s.lines.length - 1 ? `${line + 1}/${s.lines.length}  · коснитесь ›` : `${line + 1}/${s.lines.length}  · коснитесь — закрыть`);
    if (auto) autoNext = scene.time.delayedCall(AUTO_LINE_MS + full.length * AUTO_CHAR_MS, advance);
  };
  const setFace = (sprite: string | null) => {
    face.removeAll(true);
    const size = PORTRAIT - 20;
    // Картинки нет (новый юнит ещё без арта) — иконка скина вместо пустой текстуры.
    if (!sprite || (!SPRITES[sprite] && !scene.textures.exists(portraitKey(sprite)))) {
      face.add(scene.add.image(0, 0, skinIcon('swords')).setDisplaySize(size * 0.6, size * 0.6).setTint(SKIN_TINT.gold));
      return;
    }
    face.add(portrait(scene, 0, 0, portraitKey(sprite), size));
  };
  const showLine = (i: number) => {
    line = i;
    lineAt = performance.now();
    const l = s.lines[i];
    const who = speakerView(story, l.speaker, session.save, GAME);
    nameText.setText(who.name);
    setFace(who.sprite);
    full = l.text;
    shown = 0;
    body.setText('');
    more.setText('');
    stopTimers();
    // Букв — по прошедшему времени, а не по срабатываниям таймера (на 30 FPS таймер тикает не чаще кадра).
    const start = scene.time.now;
    typer = scene.time.addEvent({
      delay: TYPE_MS,
      loop: true,
      callback: () => {
        shown = Math.max(shown + 1, Math.floor((scene.time.now - start) / TYPE_MS));
        body.setText(full.slice(0, shown));
        if (shown >= full.length) finishLine();
      },
    });
  };
  const advance = () => {
    if (closed) return;
    if (shown < full.length) {
      finishLine();
      return;
    }
    if (line + 1 < s.lines.length) showLine(line + 1);
    else close();
  };
  // Листает только касание, которое и началось на затемнении после появления строки (+ LINE_GUARD_MS).
  const eventTime = (p: Phaser.Input.Pointer) => {
    const t = (p.event as Event | undefined)?.timeStamp;
    return typeof t === 'number' && t > 0 ? t : performance.now();
  };
  shade.on('pointerdown', (p: Phaser.Input.Pointer) => {
    armed = eventTime(p) - lineAt >= LINE_GUARD_MS;
  });
  shade.on('pointerup', () => {
    if (!armed) return;
    armed = false;
    advance();
  });
  // Сцена выключилась (переход) — таймеры Phaser уберёт сам, диалог просто исчезает, не увиденным.
  showLine(0);
}
