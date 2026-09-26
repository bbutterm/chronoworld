import Phaser from 'phaser';
import { markHint } from '../hints';
import { stageStatus } from '../../core';
import { CONTENT, GAME } from '../content';
import { currentStage } from '../flow';
import { GAME_W } from '../layout';
import { CONTENT_BOTTOM, CONTENT_TOP, screen } from '../screen';
import { session } from '../session';
import { button, ellipsize, icon, pressable, text, toast } from '../ui';
import { C, FS, TOUCH } from '../theme';

const NODE = 130;

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

    text(this, GAME_W / 2, CONTENT_TOP + 40, chapter.name, FS.h2, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    if (ci > 0) button(this, 70, CONTENT_TOP + 40, TOUCH, TOUCH, 'k:buttonSquare_beige', '‹', () => this.scene.restart({ chapter: ci - 1 }), FS.hero);
    if (ci < chapters.length - 1) button(this, GAME_W - 70, CONTENT_TOP + 40, TOUCH, TOUCH, 'k:buttonSquare_beige', '›', () => this.scene.restart({ chapter: ci + 1 }), FS.hero);

    const stages = CONTENT.stages.filter((s) => s.chapter === chapter.id);
    const top = CONTENT_TOP + 150;
    const bottom = CONTENT_BOTTOM - 70;
    const step = stages.length > 1 ? (bottom - top) / (stages.length - 1) : 0;
    // Тропа зигзагом слева, подписи — ровным столбцом справа, чтобы линии их не перечёркивали.
    const pos = stages.map((_, i) => ({ x: i % 2 === 0 ? 170 : 340, y: bottom - step * i }));

    // Тропа между узлами — один Graphics на весь экран.
    const g = this.add.graphics();
    g.lineStyle(14, 0x6b4a2a, 0.9);
    for (let i = 1; i < pos.length; i++) g.lineBetween(pos[i - 1].x, pos[i - 1].y, pos[i].x, pos[i].y);

    stages.forEach((s, i) => {
      const st = stageStatus(session.save, s.id, GAME);
      const { x, y } = pos[i];
      const frame = st === 'locked' ? 'k:buttonSquare_grey' : st === 'cleared' ? 'k:buttonSquare_brown' : 'k:buttonSquare_blue';
      const size = s.boss ? NODE * 1.2 : NODE;
      const open = () => {
        if (st === 'locked') toast(this, 'Этап закрыт: сначала пройдите предыдущий');
        else this.scene.start('Stage', { stageId: s.id });
      };
      const node = button(this, x, y, size, size, frame, String(s.globalIndex + 1), open);
      // Подпись тоже нажимается — большая цель для пальца (с затемнением при нажатии, как у кнопок).
      const zh = Math.max(TOUCH, Math.min(step, 130));
      pressable(this, this.add.zone(750, y, 580, zh), 580, zh, open);
      if (s.boss) {
        this.add.circle(x, y, size * 0.72, 0xd64545, 0).setStrokeStyle(8, 0xd64545, st === 'locked' ? 0.4 : 1);
      }
      if (st === 'cleared') icon(this, x + size / 2 - 8, y - size / 2 + 8, 'iconCheck_bronze', 50);
      if (st === 'locked') {
        node.container.setAlpha(0.6);
        icon(this, x + size / 2 - 8, y - size / 2 + 8, 'iconCross_grey', 40);
      }
      if (st === 'open') {
        const ring = this.add.circle(x, y, size * 0.8).setStrokeStyle(6, 0xffd84a);
        this.tweens.add({ targets: ring, scale: 1.12, alpha: 0.3, yoyo: true, repeat: -1, duration: 700 });
      }
      const lx = 470;
      const color = st === 'locked' ? C.disabled : s.boss ? C.danger : C.text;
      ellipsize(text(this, lx, y - 20, s.name, FS.h2, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), GAME_W - lx - 30);
      const status = st === 'cleared' ? 'пройден' : st === 'open' ? (s.boss ? 'БОСС · открыт' : 'открыт') : s.boss ? 'босс · закрыт' : 'закрыт';
      text(this, lx, y + 24, status, FS.small, st === 'open' ? C.gold : st === 'cleared' ? C.success : C.dim, {
        stroke: C.stroke,
        strokeThickness: 4,
      }).setOrigin(0, 0.5);
    });
  }
}
