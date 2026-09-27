import Phaser from 'phaser';
import { achievementStatus, actClaimAchievement, type AchievementView } from '../../core';
import { GAME } from '../content';
import { claimableAchievements, describeEvents, formatNumber, metaRewardsText, sortAchievements } from '../flow';
import { GAME_W } from '../layout';
import { CONTENT_BOTTOM, CONTENT_TOP, screen, type NavTab } from '../screen';
import { commit, session, today } from '../session';
import { button, ellipsize, emptyState, icon, panel, progressBar, ScrollArea, text, toast } from '../ui';
import { C, FS, TINT } from '../theme';

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
    text(this, 50, CONTENT_TOP + 40, `Получено ${got} / ${views.length}`, FS.h3, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    if (ready) text(this, GAME_W - 50, CONTENT_TOP + 40, `Можно забрать: ${ready}`, FS.body, C.success, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5);
    // Пустое состояние «забрать нечего» — подсказка, что делать дальше.
    else if (views.length && got < views.length) text(this, GAME_W - 50, CONTENT_TOP + 40, 'Забрать пока нечего — играйте дальше', FS.small, C.muted).setOrigin(1, 0.5);

    this.area = new ScrollArea(this, CONTENT_TOP + 90, CONTENT_BOTTOM + 10);
    if (!views.length) emptyState(this, GAME_W / 2, CONTENT_TOP + 300, 'Достижений пока нет.');
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
    const main = grey ? C.disabled : dark ? C.ink : C.text;
    const stroke = { stroke: dark || grey ? C.none : C.stroke, strokeThickness: dark || grey ? 0 : 4 };
    s.add(ellipsize(text(this, 70, y - 55, a.name, FS.h3, main, { fontStyle: 'bold', ...stroke }).setOrigin(0, 0.5), 700));
    s.add(text(this, 70, y - 10, a.description, FS.small, grey ? C.disabled : dark ? C.inkMuted : C.muted, { align: 'left', wordWrap: { width: 680 } }).setOrigin(0, 0.5));
    s.add(progressBar(this, 70, y + 45, 440, 30, a.progress / a.target, grey ? 0x6a6a70 : a.done ? TINT.gold : TINT.success));
    // На жёлтой (выполнено) полосе — тёмная подпись без обводки, на зелёной/серой — белая с обводкой.
    const onGold = a.done && !a.claimed;
    s.add(text(this, 290, y + 45, `${formatNumber(a.progress)} / ${formatNumber(a.target)}`, FS.caption, onGold ? C.titleStroke : C.text, { fontStyle: 'bold', stroke: onGold ? C.none : C.stroke, strokeThickness: onGold ? 0 : 4 }));
    s.add(text(this, 540, y + 45, metaRewardsText(a.rewards, ' каждому'), FS.small, grey ? C.disabled : dark ? C.inkGold : C.gold, { fontStyle: 'bold', align: 'left', wordWrap: { width: 280 } }).setOrigin(0, 0.5));

    const bx = 900;
    if (a.claimed) {
      s.add(icon(this, bx - 55, y - 40, 'iconCheck_bronze', 48)).setAlpha(0.7);
      s.add(text(this, bx + 25, y - 40, 'Получено', FS.small, C.disabled, { fontStyle: 'bold' }));
    } else if (a.done) {
      const b = button(this, bx, y - 30, 230, 100, 'ui_btn_primary', 'Забрать', s.tap(() => this.claim(a)), FS.h3);
      s.add(b.container);
      this.tweens.add({ targets: b.container, scale: 1.05, yoyo: true, repeat: -1, duration: 700 });
    }
  }

  private claim(a: AchievementView): void {
    try {
      const r = actClaimAchievement(session.save, today(), a.id, GAME);
      commit(r.save);
      const lines = [`«${a.name}»: ${metaRewardsText(r.rewards, ' каждому')}`, ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))];
      this.scene.restart({ from: this.from, scroll: this.area.offset } satisfies AchievementsData);
      this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, lines.join('\n'), C.success, 4000));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }
}
