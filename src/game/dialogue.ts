import Phaser from 'phaser';
import { sfx } from './audio';
import { lineChimes } from './audioCore';
import { episodePageId, markPageSeen, markScenesSeen, pendingIntro, pendingScenes, type StoryScene, type StoryTrigger } from '../core';
import { GAME } from './content';
import { illustKey, loadIllust } from './illust';
import { GAME_H, GAME_W } from './layout';
import { framedPortrait } from './portraitFrame';
import { commit, session } from './session';
import { SKIN } from './skin';
import { isChapterFinale, speakerView } from './storyView';
import { introPages, showPages } from './storyPage';
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

/**
 * Плашка диалога: реплика до 120 символов крупным шрифтом (BODY_FS ≈ 15 px на 390×844) влезает в 3–4 строки без
 * прокрутки; портрет — наполовину над плашкой. Выше плашки — бойцы и карта: не растить без нужды.
 */
const PANEL_W = 1040;
const PANEL_H = 460;
const PANEL_Y = GAME_H - 30 - PANEL_H / 2;
const PORTRAIT = 250;
const BODY_FS = 42;
const BODY_Y = 140;
/**
 * Иллюстрация NPC (спикер с `illust`, например Кафра): в полный рост слева над плашкой, нижняя часть уходит за плашку —
 * текст реплики не закрывает. Высота на экране (исходник 320×480).
 */
const ILLUST_H = 820;
const ILLUST_UNDER = 150;

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
  const go = () => {
    playStory(scene, { type: 'beforeStage', stageId }, () => scene.scene.start('Battle', { mode: 'stage', stageId }), opts);
  };
  // Первый этап главы, а «Эпизод N» ещё не показан (в главу вошли не с карты) — сначала он. В авто-режиме не ждём
  // игрока: страница останется в «Летописи».
  const stage = GAME.content.stages.find((s) => s.id === stageId);
  const intro = stage && stage.index === 0 && !opts.auto ? pendingIntro(session.save, stage.chapter, GAME) : undefined;
  if (!intro || !stage) return go();
  showPages(scene, introPages(intro), () => {
    commit(markPageSeen(session.save, episodePageId(stage.chapter)));
    go();
  }, { doneLabel: 'В путь' });
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

  // Портрет в золотой рамке — наполовину над плашкой, слева.
  const px = left + 40 + PORTRAIT / 2;
  const py = top - 20;
  const face = scene.add.container(px, py);
  // Слой иллюстрации — за плашкой (плашка закрывает её низ), портрет в рамке в это время скрыт.
  const art = scene.add.container(0, 0);
  const nameText = text(scene, px + PORTRAIT / 2 + 40, top + 48, '', FS.h1, SKIN.goldLight, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5);
  const body = text(scene, left + 50, top + BODY_Y, '', BODY_FS, SKIN.cream, {
    wordWrap: { width: PANEL_W - 100, useAdvancedWrap: true },
    lineSpacing: 12,
    align: 'left',
  }).setOrigin(0, 0);
  const more = text(scene, GAME_W / 2 + PANEL_W / 2 - 40, PANEL_Y + PANEL_H / 2 - 36, '', FS.caption, SKIN.creamDim, OUTLINE).setOrigin(1, 0.5);
  const skip = button(scene, GAME_W / 2 + PANEL_W / 2 - 150, top - 70, 280, TOUCH, 'k:buttonLong_beige', 'Пропустить', () => close(), FS.h3);
  // Имя говорящего — на золотой кромке (табличка), текст реплики ниже неё.
  const nameTrim = scene.add.image(px + PORTRAIT / 2 + 40, top + 92, 'skin_trim').setOrigin(0, 0.5).setDisplaySize(PANEL_W - PORTRAIT - 150, 10);
  // Вверху плашки — тёплый отсвет, как от портрета.
  const warm = scene.add.image(px + 60, top + 40, 'skin_glow').setDisplaySize(520, 260).setTint(0xffc870).setAlpha(0.14).setBlendMode(Phaser.BlendModes.ADD);
  layer.add([shade, art, box, warm, nameTrim, face, nameText, body, more, skip.container]);
  // Иллюстрации спикеров сцены — загрузить заранее (к их первой реплике обычно уже готовы).
  for (const l of s.lines) {
    const ill = story?.speakers[l.speaker]?.illust;
    if (ill) void loadIllust(scene.game, ill);
  }

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
  let faceOf: string | null | undefined;
  let artOf: string | null = null;
  /** Имя и кромка: с портретом — правее рамки, с иллюстрацией — от левого края плашки. */
  const placeName = (withFace: boolean) => {
    const x = withFace ? px + PORTRAIT / 2 + 40 : left + 50;
    nameText.setX(x);
    nameTrim.setX(x).setDisplaySize(withFace ? PANEL_W - PORTRAIT - 150 : PANEL_W - 100, 10);
  };
  const setArt = (id: string | null) => {
    if (id === artOf) return;
    artOf = id;
    art.removeAll(true);
    const on = !!id && scene.textures.exists(illustKey(id));
    face.setVisible(!on);
    placeName(!on);
    if (!on || !id) return;
    const img = scene.add.image(0, 0, illustKey(id)).setOrigin(0.5, 1);
    const k = ILLUST_H / img.height;
    img.setScale(k);
    const x = left + 20 + (img.width * k) / 2;
    img.setPosition(x - 60, top + ILLUST_UNDER).setAlpha(0);
    art.add(img);
    // Появление — выезд слева с проявлением.
    scene.tweens.add({ targets: img, x, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
  };
  const setFace = (sprite: string | null, gender?: 'm' | 'f', illust?: string) => {
    if (illust && scene.textures.exists(illustKey(illust))) return setArt(illust);
    setArt(null);
    if (illust) {
      // Иллюстрация ещё грузится — пока портрет, по готовности подменим (если эта реплика ещё на экране).
      const lineNow = line;
      void loadIllust(scene.game, illust).then((ok) => {
        if (ok && !closed && line === lineNow) setArt(illust);
      });
    }
    // Тот же говорящий — портрет не пересобираем (бюст уже на месте, без мигания).
    const faceId = sprite && gender ? `${sprite}|${gender}` : sprite;
    if (faceId === faceOf) return;
    faceOf = faceId;
    face.removeAll(true);
    // Бюст RO (или портрет спрайта, или значок скина — framedPortrait сам выберет) в золотой рамке.
    const fp = framedPortrait(scene, 0, 0, sprite, PORTRAIT + 30, gender);
    face.add(fp);
    // Смена говорящего — лёгкий «вдох» портрета.
    fp.setScale(0.92);
    scene.tweens.add({ targets: fp, scale: 1, duration: 160, ease: 'Back.easeOut' });
  };
  const showLine = (i: number) => {
    line = i;
    lineAt = performance.now();
    const l = s.lines[i];
    const who = speakerView(story, l.speaker, session.save, GAME);
    nameText.setText(who.name);
    setFace(who.sprite, who.gender, who.illust);
    full = l.text;
    // Колокольчик Греты звенит в реплике — слышно (ограничитель не даст звенеть чаще раза в 1.5 с).
    if (lineChimes(full)) sfx('bell_chime', { delay: 0.2 });
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
