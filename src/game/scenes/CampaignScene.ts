import Phaser from 'phaser';
import { markHint } from '../hints';
import { pendingScenes, stageStatus } from '../../core';
import { CONTENT, GAME } from '../content';
import { playScenes } from '../dialogue';
import { isChapterFinale, seenChapterScenes } from '../storyView';
import { openStoryHistory, startChapterDone } from './ChapterDoneScene';
import { currentStage } from '../flow';
import { GAME_W } from '../layout';
import { CONTENT_BOTTOM, CONTENT_TOP, screen } from '../screen';
import { session } from '../session';
import { button, ellipsize, pressable, text, toast } from '../ui';
import { C, FS, TINT, TOUCH } from '../theme';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from '../skin';

const NODE = 150;

/** Кампания: этапы главы снизу вверх, как тропа (закрыт / открыт / пройден / босс). */
export class CampaignScene extends Phaser.Scene {
  constructor() {
    super('Campaign');
  }

  create(data: { chapter?: number }): void {
    const chapters = CONTENT.chapters;
    const cur = currentStage(session.save, GAME);
    const ci = Phaser.Math.Clamp(data?.chapter ?? Math.max(0, chapters.findIndex((c) => c.id === cur?.chapter)), 0, chapters.length - 1);
    const chapter = chapters[ci];
    screen(this, 'Кампания', 'Campaign');
    markHint('home_campaign');
    if (!chapter) {
      text(this, GAME_W / 2, 600, 'В data/campaign нет глав', FS.h2);
      return;
    }

    text(this, GAME_W / 2, CONTENT_TOP + 40, chapter.name, FS.h2, SKIN.goldLight, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
    if (ci > 0) button(this, 70, CONTENT_TOP + 40, TOUCH, TOUCH, 'k:buttonSquare_beige', '‹', () => this.scene.restart({ chapter: ci - 1 }), FS.hero);
    if (ci < chapters.length - 1) button(this, GAME_W - 70, CONTENT_TOP + 40, TOUCH, TOUCH, 'k:buttonSquare_beige', '›', () => this.scene.restart({ chapter: ci + 1 }), FS.hero);

    const stages = CONTENT.stages.filter((s) => s.chapter === chapter.id);
    const top = CONTENT_TOP + 170;
    const bottom = CONTENT_BOTTOM - 90;
    const step = stages.length > 1 ? (bottom - top) / (stages.length - 1) : 0;
    // Тропа змейкой снизу вверх (как в референсе владельца), подпись — с той стороны, где больше места.
    const pos = stages.map((_, i) => ({ x: GAME_W / 2 + Math.sin(i * 1.05 + 0.4) * 250, y: bottom - step * i }));

    // Деревянная тропа: гладкая кривая через все узлы — тёмная кромка, доска, светлые «гвозди».
    if (pos.length > 1) {
      const curve = new Phaser.Curves.Spline(pos.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
      const pts = curve.getSpacedPoints(pos.length * 24);
      const g = this.add.graphics();
      g.lineStyle(64, 0x0e0b07, 0.9).strokePoints(pts);
      g.lineStyle(48, 0x5a3c22, 1).strokePoints(pts);
      g.lineStyle(26, 0x6e4b2b, 1).strokePoints(pts);
      g.fillStyle(0xc9a878, 0.5);
      for (let i = 0; i < pts.length; i += 3) g.fillCircle(pts[i].x, pts[i].y, 3.5);
    }

    stages.forEach((s, i) => {
      const st = stageStatus(session.save, s.id, GAME);
      const { x, y } = pos[i];
      const size = s.boss ? NODE * 1.25 : NODE;
      const open = () => {
        if (st === 'locked') toast(this, 'Этап закрыт: сначала пройдите предыдущий');
        else this.scene.start('Stage', { stageId: s.id });
      };
      const key = st === 'open' ? 'skin_node_open' : st === 'cleared' ? 'skin_node_cleared' : s.boss ? 'skin_node_boss' : 'skin_node_locked';
      pressable(this, this.add.image(x, y, key).setDisplaySize(size, size), size, size, open);
      text(this, x, y - 2, String(s.globalIndex + 1), size * 0.34, st === 'locked' ? SKIN.creamDim : SKIN.cream, {
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
      });
      // Значок в углу: замок (закрыт), галочка (пройден), корона-метка босса.
      const badge = (name: SkinIcon, color: number) => {
        const bx = x + size * 0.36;
        const by = y + size * 0.34;
        this.add.circle(bx, by, 26, 0x0d0e0b).setStrokeStyle(3, SKIN_TINT.bronze);
        this.add.image(bx, by, skinIcon(name)).setDisplaySize(34, 34).setTint(color);
      };
      if (st === 'locked') badge('lock', SKIN_TINT.gold);
      if (st === 'cleared') badge('check', 0x9fe0a6);
      if (st === 'open') {
        // Текущий этап: пульсирующее золотое кольцо вокруг узла (T3-21: красные квадраты-«прицел» наезжали на подпись).
        const r = size * 0.56;
        const g = this.add.graphics({ x, y });
        g.lineStyle(6, TINT.gold, 0.9).strokeCircle(0, 0, r);
        this.tweens.add({ targets: g, scale: 1.1, alpha: 0.35, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
      }
      // Подпись — сбоку от узла, в сторону центра экрана.
      const right = x < GAME_W / 2;
      const lx = right ? x + size * 0.62 : x - size * 0.62;
      const zh = Math.max(TOUCH, Math.min(step, 130));
      const zx = right ? (lx + GAME_W - 20) / 2 : (20 + lx) / 2;
      const zw = right ? GAME_W - 20 - lx : lx - 20;
      pressable(this, this.add.zone(zx, y, zw, zh), zw, zh, open);
      const color = st === 'locked' ? SKIN.creamDim : s.boss ? C.danger : SKIN.cream;
      ellipsize(
        text(this, lx, y - 18, s.name, FS.h3, color, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 }).setOrigin(right ? 0 : 1, 0.5),
        zw - 10,
      );
      const status = st === 'cleared' ? 'пройден' : st === 'open' ? (s.boss ? 'БОСС · в бой' : 'в бой') : s.boss ? 'босс' : 'закрыт';
      text(this, lx, y + 22, status, FS.caption, st === 'open' ? SKIN.goldLight : st === 'cleared' ? C.success : SKIN.creamDim, {
        stroke: '#000000',
        strokeThickness: 4,
      }).setOrigin(right ? 0 : 1, 0.5);
    });

    // «История» (P3): пересмотр увиденных сцен главы. Справа внизу — там нет узлов и подписей этапов.
    if (seenChapterScenes(session.save, chapter.id, GAME).length) {
      button(this, GAME_W - 150, CONTENT_BOTTOM - 20, 240, 90, 'k:buttonLong_beige', 'История', () => openStoryHistory(this, chapter.id), FS.body).container.setName('historyBtn');
    }

    // Сюжет: вступление главы — при первом входе на её карту (пока первый этап не пройден). P11: сначала — сцены
    // из очереди (финал, прерванный перезагрузкой); если среди них финал главы — после него «Глава пройдена» (T1-03).
    const scenes = pendingScenes(session.save, { type: 'chapterStart', chapter: chapter.id }, GAME);
    const finale = scenes.find((s) => isChapterFinale(s, GAME));
    playScenes(this, scenes, () => {
      if (finale) startChapterDone(this, { chapterId: finale.chapter });
    });
  }
}
