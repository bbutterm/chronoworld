import Phaser from 'phaser';
import { CONTENT, GAME } from '../content';
import { playScenes } from '../dialogue';
import { formatNumber, heroSprite, jobLevelText, ROLE_NAMES } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, popIn, unitFigure } from '../screen';
import { now, session } from '../session';
import { SKIN } from '../skin';
import { chapterSummary, playTimeText, sceneLabel, seenChapterScenes } from '../storyView';
import { button, ellipsize, panel, text } from '../ui';
import { C, FS, OUTLINE, TINT } from '../theme';

export interface ChapterDoneData {
  chapterId: string;
}

export const CHAPTER_DONE = 'ChapterDone';

/**
 * Открыть «Глава пройдена» (T1-03). Сцена регистрируется при первом показе — список сцен игры (main.ts) не трогаем.
 */
export function startChapterDone(from: Phaser.Scene, data: ChapterDoneData): void {
  if (!from.scene.get(CHAPTER_DONE)) from.scene.add(CHAPTER_DONE, ChapterDoneScene, false);
  from.scene.start(CHAPTER_DONE, data);
}

/** Имя слоя списка «История» (e2e). */
const HISTORY = 'history';

/**
 * T1-03. «Глава пройдена» — после финальной сцены главы (docs/design/chapter1.md §7.2): название главы, итоги
 * (этапы, время, награды), карточка нового героя, «История» (пересмотр увиденных сцен главы) и «Глава N ›».
 */
export class ChapterDoneScene extends Phaser.Scene {
  constructor() {
    super(CHAPTER_DONE);
  }

  create(data: ChapterDoneData): void {
    const save = session.save;
    const sum = chapterSummary(save, data.chapterId, GAME);
    const cx = GAME_W / 2;
    this.add.image(cx, GAME_H / 2, 'skin_bg_forest').setDisplaySize(GAME_W, GAME_H);
    this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0x07060a, 0.55);
    if (this.textures.exists('skin_rays')) {
      const rays = this.add.image(cx, 300, 'skin_rays').setDisplaySize(1200, 1200).setAlpha(0.35);
      this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
    }

    // --- Заголовок ---
    const title = text(this, cx, 200, `Глава ${sum.number} пройдена!`, FS.hero + 8, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 });
    ellipsize(title, 1000);
    title.setScale(0.5).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 450, ease: 'Back.easeOut' });
    const subtitle = sum.name.replace(/^Глава\s*\d+\.\s*/, '');
    ellipsize(text(this, cx, 290, subtitle, FS.h2, SKIN.cream, { fontStyle: 'bold', ...OUTLINE }), 1000);

    // --- Итоги ---
    const sy = 480;
    card(this, cx, sy, 1000, 250);
    const row = (y: number, label: string, value: string, color: string = C.text) => {
      text(this, 110, y, label, FS.body, C.muted).setOrigin(0, 0.5);
      text(this, 970, y, value, FS.body, color, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    };
    row(sy - 75, 'Этапы', `${sum.cleared} / ${sum.stages}`, C.success);
    row(sy - 25, 'В пути', playTimeText(now() - save.createdAt));
    row(sy + 25, 'Награды главы', `золото ${formatNumber(sum.gold)} · опыт ${formatNumber(sum.jobExp)}`, C.gold);
    row(sy + 75, 'Трофеев в сумке', String(sum.items), '#6fb8ff');

    // --- Новый герой ---
    const ry = 1010;
    if (sum.recruit) {
      const hero = sum.recruit;
      const job = CONTENT.jobs[hero.job];
      card(this, cx, ry, 1000, 620, true);
      text(this, cx, ry - 260, 'Новый герой в отряде!', FS.h2, C.inkGold, { fontStyle: 'bold' });
      this.add.ellipse(cx, ry + 110, 300, 60, 0x000000, 0.3);
      unitFigure(this, heroSprite(hero, GAME), cx, ry + 110, 300, { maxScale: 2 });
      text(this, cx, ry + 180, `${hero.name} присоединяется к отряду`, FS.h2, C.ink, { fontStyle: 'bold' }).setName('recruitName');
      text(this, cx, ry + 240, `${job?.name ?? hero.job} · ${ROLE_NAMES[job?.role ?? ''] ?? ''} · ${jobLevelText(hero.jobLevel)}`, FS.body, C.inkMuted);
    } else {
      card(this, cx, ry, 1000, 300, true);
      text(this, cx, ry, 'Отряд готов к новым землям', FS.h2, C.ink, { fontStyle: 'bold' });
    }

    // --- Кнопки ---
    const history = seenChapterScenes(save, data.chapterId, GAME);
    const hb = button(this, cx, 1480, 560, 120, 'ui_btn_secondary', 'История', () => openStoryHistory(this, data.chapterId), FS.h2);
    if (!history.length) hb.container.setAlpha(0.45).disableInteractive();
    const next = sum.next;
    button(this, cx, 1700, 760, 170, 'ui_btn_primary', next ? `Глава ${next.number} ›` : 'К кампании', () =>
      this.scene.start('Campaign', next ? { chapter: next.index } : {}),
    FS.hero);
    if (next) ellipsize(text(this, cx, 1820, next.name.replace(/^Глава\s*\d+\.\s*/, ''), FS.small, SKIN.creamDim, OUTLINE), 900);
  }
}

/** «История» (P3 / T1-03): список увиденных сцен главы; касание — пересмотреть сцену поверх экрана. */
export function openStoryHistory(sc: Phaser.Scene, chapterId: string): void {
  if (sc.children.getByName(HISTORY)) return;
  const scenes = seenChapterScenes(session.save, chapterId, GAME);
  const layer = sc.add.container(0, 0).setDepth(9000).setName(HISTORY);
  const shade = sc.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
  const rowH = 118;
  const h = Math.min(1500, 370 + Math.max(1, scenes.length) * rowH);
  const top = GAME_H / 2 - h / 2;
  const box = panel(sc, GAME_W / 2, GAME_H / 2, 940, h, 'ui_panel').setInteractive();
  const head = text(sc, GAME_W / 2, top + 80, 'История главы', FS.h1, C.title, { fontStyle: 'bold', ...OUTLINE });
  // Черта под заголовком.
  const line = sc.add.rectangle(GAME_W / 2, top + 140, 860, 2, TINT.frame, 0.5);
  layer.add([shade, box, head, line]);
  const close = () => layer.destroy();
  shade.on('pointerup', close);
  if (!scenes.length) layer.add(text(sc, GAME_W / 2, top + 200, 'Сцен этой главы вы ещё не видели', FS.body, C.muted));
  // Не влезают все — последние (свежие) сцены.
  const fit = Math.max(1, Math.floor((h - 370) / rowH));
  scenes.slice(-fit).forEach((s, i) => {
    const b = button(sc, GAME_W / 2, top + 200 + i * rowH, 800, 100, 'k:buttonLong_beige', `▶  ${sceneLabel(s, GAME)}`, () => {
      close();
      playScenes(sc, [s], () => {});
    }, FS.h3);
    layer.add(b.container);
  });
  const done = button(sc, GAME_W / 2, top + h - 90, 400, 110, 'ui_btn_primary', 'Закрыть', close, FS.h3);
  layer.add(done.container);
  popIn(sc, layer, shade);
}
