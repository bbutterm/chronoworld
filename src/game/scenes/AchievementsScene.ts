import Phaser from 'phaser';
import { achievementStatus, claimAchievement, type AchievementView } from '../../core';
import { GAME } from '../content';
import { claimableAchievements, describeEvents, formatNumber, metaRewardsText, sortAchievements } from '../flow';
import { GAME_W } from '../layout';
import { CONTENT_BOTTOM, CONTENT_TOP, screen, type NavTab } from '../screen';
import { commit, session } from '../session';
import { button, icon, panel, progressBar, ScrollArea, text, toast } from '../ui';

const ROW_H = 190;

export interface AchievementsData {
  /** Откуда пришли: «Главная» или «Герои» — туда ведёт «Назад» и подсвечивается вкладка. */
  from?: Extract<NavTab, 'Home' | 'Heroes'>;
  scroll?: number;
}

/** K10. Достижения: готовые к получению сверху, в процессе — с полосой прогресса, полученные — серые внизу. */
export class AchievementsScene extends Phaser.Scene {
  private area!: ScrollArea;
  private from: 'Home' | 'Heroes' = 'Home';

  constructor() {
    super('Achievements');
  }

  create(data: AchievementsData = {}): void {
    this.from = data.from ?? 'Home';
    screen(this, 'Достижения', this.from, { to: this.from });
    const views = achievementStatus(session.save, GAME);
    const got = views.filter((a) => a.claimed).length;
    const ready = claimableAchievements(views);
    text(this, 50, CONTENT_TOP + 40, `Получено ${got} / ${views.length}`, 36, '#ffe9a8', { fontStyle: 'bold', stroke: '#3a2412', strokeThickness: 6 }).setOrigin(0, 0.5);
    if (ready) text(this, GAME_W - 50, CONTENT_TOP + 40, `Можно забрать: ${ready}`, 32, '#9fe0a6', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 }).setOrigin(1, 0.5);

    this.area = new ScrollArea(this, CONTENT_TOP + 90, CONTENT_BOTTOM + 10);
    const list = sortAchievements(views);
    list.forEach((a, i) => this.row(a, ROW_H * (i + 0.5)));
    this.area.setContentHeight(ROW_H * list.length + 20);
    if (data.scroll) this.area.offset = data.scroll;
  }

  private row(a: AchievementView, y: number): void {
    const s = this.area;
    const grey = a.claimed;
    const bg = s.add(panel(this, GAME_W / 2, y, 1020, ROW_H - 16, a.done && !a.claimed ? 'ui_panel_light' : 'ui_panel'));
    if (grey) bg.setAlpha(0.5);
    const dark = a.done && !a.claimed;
    const main = grey ? '#9a9aa0' : dark ? '#4a3520' : '#ffffff';
    const stroke = { stroke: dark || grey ? '#00000000' : '#000000', strokeThickness: dark || grey ? 0 : 4 };
    s.add(text(this, 70, y - 55, a.name, 34, main, { fontStyle: 'bold', ...stroke }).setOrigin(0, 0.5));
    s.add(text(this, 70, y - 10, a.description, 28, grey ? '#8a8a90' : dark ? '#6a4a2a' : '#e0cfb0', { align: 'left', wordWrap: { width: 680 } }).setOrigin(0, 0.5));
    s.add(progressBar(this, 70, y + 45, 440, 30, a.progress / a.target, grey ? 0x6a6a70 : a.done ? 0xffd84a : 0x6fd06f));
    // На жёлтой (выполнено) полосе — тёмная подпись без обводки, на зелёной/серой — белая с обводкой.
    const onGold = a.done && !a.claimed;
    s.add(text(this, 290, y + 45, `${formatNumber(a.progress)} / ${formatNumber(a.target)}`, 26, onGold ? '#3a2412' : '#ffffff', { fontStyle: 'bold', stroke: onGold ? '#00000000' : '#000000', strokeThickness: onGold ? 0 : 4 }));
    s.add(text(this, 540, y + 45, metaRewardsText(a.rewards, ' каждому'), 28, grey ? '#8a8a90' : dark ? '#7a4a10' : '#ffd84a', { fontStyle: 'bold', align: 'left', wordWrap: { width: 280 } }).setOrigin(0, 0.5));

    const bx = 900;
    if (a.claimed) {
      s.add(icon(this, bx - 55, y - 40, 'iconCheck_bronze', 48)).setAlpha(0.7);
      s.add(text(this, bx + 25, y - 40, 'Получено', 28, '#9a9aa0', { fontStyle: 'bold' }));
    } else if (a.done) {
      const b = button(this, bx, y - 30, 230, 100, 'ui_btn_primary', 'Забрать', s.tap(() => this.claim(a)), 36);
      s.add(b.container);
      this.tweens.add({ targets: b.container, scale: 1.05, yoyo: true, repeat: -1, duration: 700 });
    }
  }

  private claim(a: AchievementView): void {
    try {
      const r = claimAchievement(session.save, a.id, GAME);
      commit(r.save);
      const lines = [`«${a.name}»: ${metaRewardsText(r.rewards, ' каждому')}`, ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))];
      this.scene.restart({ from: this.from, scroll: this.area.offset } satisfies AchievementsData);
      this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, lines.join('\n'), '#9fe0a6', 4000));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
    }
  }
}
