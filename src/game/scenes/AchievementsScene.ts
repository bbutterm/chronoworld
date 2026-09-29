import Phaser from 'phaser';
import { achievementStatus, actClaimAchievement, actClaimAllAchievements, type AchievementView } from '../../core';
import { GAME } from '../content';
import { claimableAchievements, describeEvents, formatNumber, metaRewardsText, sortAchievements } from '../flow';
import { GAME_W } from '../layout';
import { CONTENT_TOP, contentBottom, screen, type NavTab } from '../screen';
import { commit, session, today } from '../session';
import { button, ellipsize, emptyState, panel, progressBar, ScrollArea, text, toast } from '../ui';
import { medallion } from '../decor';
import { skinIcon } from '../skin';
import { C, FS, TINT } from '../theme';
import { afterRewardFly, collect, pulse, queueRewardFly, staggerIn, type Point } from '../juice';
import { isUnlocked, lockedScreen } from '../unlockBanner';

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
    // Зашли в обход главной (кнопка на экране «Герои») до этапа открытия — замок вместо списка.
    if (!isUnlocked('achievements')) {
      lockedScreen(this, 'achievements');
      return;
    }
    const views = achievementStatus(session.save, GAME);
    const got = views.filter((a) => a.claimed).length;
    const ready = claimableAchievements(views);
    text(this, 50, CONTENT_TOP + 40, `Получено ${got} / ${views.length}`, FS.h3, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    if (ready > 1) {
      // «Забрать всё» (как в AFK): все выполненные достижения одним нажатием.
      const all = button(this, GAME_W - 240, CONTENT_TOP + 42, 400, 80, 'ui_btn_primary', `Забрать всё (${ready})`, () => this.claimAll({ x: GAME_W - 240, y: CONTENT_TOP + 42 }), FS.body);
      pulse(this, all.container, 1.04, 700);
    } else if (ready) text(this, GAME_W - 50, CONTENT_TOP + 40, `Можно забрать: ${ready}`, FS.body, C.success, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5);
    // Пустое состояние «забрать нечего» — подсказка, что делать дальше.
    else if (views.length && got < views.length) text(this, GAME_W - 50, CONTENT_TOP + 40, 'Забрать пока нечего — играйте дальше', FS.small, C.muted).setOrigin(1, 0.5);

    this.area = new ScrollArea(this, CONTENT_TOP + 90, contentBottom() + 10);
    if (!views.length) emptyState(this, GAME_W / 2, CONTENT_TOP + 300, 'Достижений пока нет.');
    const list = sortAchievements(views);
    const rows = list.map((a, i) => collect(this.area.content, () => this.row(a, ROW_H * (i + 0.5))));
    this.area.setContentHeight(ROW_H * list.length + 20);
    if (data.scroll) this.area.offset = data.scroll;
    staggerIn(this, 'Achievements', rows);
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
    s.add(progressBar(this, 70, y + 45, 440, 30, a.progress / a.target, grey ? 0x6a6a70 : a.done ? TINT.gold : TINT.success, { key: `ach:${a.id}` }));
    // На жёлтой (выполнено) полосе — тёмная подпись без обводки, на зелёной/серой — белая с обводкой.
    const onGold = a.done && !a.claimed;
    s.add(text(this, 290, y + 45, `${formatNumber(a.progress)} / ${formatNumber(a.target)}`, FS.caption, onGold ? C.titleStroke : C.text, { fontStyle: 'bold', stroke: onGold ? C.none : C.stroke, strokeThickness: onGold ? 0 : 4 }));
    s.add(text(this, 540, y + 45, metaRewardsText(a.rewards, ' в запас'), FS.small, grey ? C.disabled : dark ? C.inkGold : C.gold, { fontStyle: 'bold', align: 'left', wordWrap: { width: 280 } }).setOrigin(0, 0.5));

    const bx = 900;
    if (a.claimed) {
      const got = s.add(text(this, bx + 25, y - 40, 'Получено', FS.small, C.disabled, { fontStyle: 'bold' }));
      s.add(this.add.image(got.x - got.width / 2 - 30, y - 40, skinIcon('check')).setDisplaySize(44, 44).setTint(0x9fe0a6).setAlpha(0.7));
    } else if (!a.done) {
      // В работе — справа тусклый медальон с кубком (строка не пустует, видно «за что»).
      s.add(medallion(this, bx + 20, y - 8, 116, 'trophy', 0xa89d86).setAlpha(0.75));
    } else if (a.done) {
      const b = button(this, bx, y - 30, 230, 100, 'ui_btn_primary', 'Забрать', s.tap(() => this.claim(a, { x: bx, y: this.area.content.y + y - 30 })), FS.h3);
      s.add(b.container);
      pulse(this, b.container);
    }
  }

  private claimAll(at: Point): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimAllAchievements(session.save, today(), GAME);
      commit(r.save);
      queueRewardFly('Achievements', at, before);
      const lines = [`Достижений: ${r.claimed.length} · ${metaRewardsText(r.rewards, ' в запас')}`, ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))];
      this.scene.restart({ from: this.from } satisfies AchievementsData);
      this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, lines.join('\n'), C.success, 4000)));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claim(a: AchievementView, at: Point): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimAchievement(session.save, today(), a.id, GAME);
      commit(r.save);
      queueRewardFly('Achievements', at, before);
      const lines = [`«${a.name}»: ${metaRewardsText(r.rewards, ' в запас')}`, ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))];
      this.scene.restart({ from: this.from, scroll: this.area.offset } satisfies AchievementsData);
      this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, lines.join('\n'), C.success, 4000)));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }
}
