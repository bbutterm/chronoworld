import Phaser from 'phaser';
import { GAME } from '../content';
import { playScenes } from '../dialogue';
import { formatNumber, heroSprite, levelText, ROLE_NAMES } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, popIn, unitFigure } from '../screen';
import { clearChapterDone, heroCard } from '../../core';
import { commit, now, session } from '../session';
import { SKIN } from '../skin';
import { setThemeBackground, themeOfChapter } from '../backdrops';
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
    // Фон — карта пройденной главы (луг, топь, склеп), притемнённая.
    setThemeBackground(this.add.image(cx, GAME_H / 2, 'skin_bg_forest'), 'map', themeOfChapter(data.chapterId));
    this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0x07060a, 0.55);
    if (this.textures.exists('skin_rays')) {
      const rays = this.add.image(cx, 300, 'skin_rays').setDisplaySize(1200, 1200).setAlpha(0.35);
      this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
      // Второй веер навстречу — светом, слабее: лучи переливаются.
      const rays2 = this.add.image(cx, 300, 'skin_rays').setDisplaySize(820, 820).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: rays2, alpha: 0.28, duration: 800 });
      this.tweens.add({ targets: rays2, angle: -360, duration: 26000, repeat: -1 });
    }
    // Золотые искры медленно поднимаются по всему экрану (по кругу).
    if (this.textures.exists('skin_spark')) {
      for (let i = 0; i < 14; i++) {
        const x0 = Phaser.Math.Between(60, GAME_W - 60);
        const s = this.add.image(x0, GAME_H + 40, 'skin_spark').setTint(i % 3 ? 0xffd884 : 0xfff4d0).setScale(0.2 + Math.random() * 0.3).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        this.tweens.add({
          targets: s,
          y: Phaser.Math.Between(80, 700),
          x: x0 + Phaser.Math.Between(-80, 80),
          angle: 180,
          alpha: { from: 0.85, to: 0 },
          duration: 4200 + Math.random() * 2500,
          delay: Math.random() * 4000,
          repeat: -1,
        });
      }
    }

    // --- Заголовок ---
    const title = text(this, cx, 200, `Глава ${sum.number} пройдена!`, FS.hero + 8, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 });
    ellipsize(title, 1000);
    title.setScale(0.5).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 450, ease: 'Back.easeOut' });
    const subtitle = sum.name.replace(/^Глава\s*\d+\.\s*/, '');
    const sub = ellipsize(text(this, cx, 290, subtitle, FS.h2, SKIN.cream, { fontStyle: 'bold', ...OUTLINE }), 1000);
    // Золотой разделитель под подзаголовком: две черты, гаснущие к краям, и ромб по центру.
    const dy = 290 + sub.height / 2 + 18;
    const g = this.add.graphics();
    for (const d of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        g.fillStyle(TINT.gold, 1 - i / 12);
        g.fillRect(cx + d * (26 + i * 16) - (d < 0 ? 16 : 0), dy - 2, 16, 4);
      }
    }
    g.fillStyle(TINT.gold, 1).fillPoints([new Phaser.Math.Vector2(cx, dy - 12), new Phaser.Math.Vector2(cx + 12, dy), new Phaser.Math.Vector2(cx, dy + 12), new Phaser.Math.Vector2(cx - 12, dy)], true);
    g.setAlpha(0);
    this.tweens.add({ targets: g, alpha: 1, duration: 500, delay: 300 });

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
      const c = heroCard(hero, GAME);
      card(this, cx, ry, 1000, 620, true);
      text(this, cx, ry - 260, 'Новый герой в отряде!', FS.h2, C.inkGold, { fontStyle: 'bold' });
      // Тёплый отсвет за новым героем и тень под ногами.
      const halo = this.add.ellipse(cx, ry + 40, 420, 300, 0xffd27a, 0.1).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: halo, fillAlpha: { from: 0.06, to: 0.16 }, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut' });
      this.add.ellipse(cx, ry + 110, 300, 60, 0x000000, 0.3);
      unitFigure(this, heroSprite(hero, GAME), cx, ry + 110, 300, { maxScale: 2 });
      text(this, cx, ry + 180, `${c.name} присоединяется к отряду`, FS.h2, C.ink, { fontStyle: 'bold' }).setName('recruitName');
      text(this, cx, ry + 240, `${c.jobName} · ${ROLE_NAMES[c.role] ?? ''} · ${levelText(c.level)}`, FS.body, C.inkMuted);
    } else {
      card(this, cx, ry, 1000, 300, true);
      text(this, cx, ry, 'Отряд готов к новым землям', FS.h2, C.ink, { fontStyle: 'bold' });
    }

    // --- Кнопки ---
    const history = seenChapterScenes(save, data.chapterId, GAME);
    const hb = button(this, cx, 1480, 560, 120, 'ui_btn_secondary', 'История', () => openStoryHistory(this, data.chapterId), FS.h2);
    if (!history.length) hb.container.setAlpha(0.45).disableInteractive();
    const next = sum.next;
    button(this, cx, 1700, 760, 170, 'ui_btn_primary', next ? `Глава ${next.number} ›` : 'К кампании', () => {
      // Игрок ушёл с экрана — больше не показывать (метка в сохранении держала его на случай перезагрузки).
      commit(clearChapterDone(session.save));
      this.scene.start('Campaign', next ? { chapter: next.index } : {});
    }, FS.hero);
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
