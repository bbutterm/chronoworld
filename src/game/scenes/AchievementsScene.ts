import Phaser from 'phaser';
import { achievementStatus, actClaimAchievement, actClaimAllAchievements, type AchievementCounter, type AchievementView } from '../../core';
import { GAME } from '../content';
import { describeEvents } from '../flow';
import { GAME_W } from '../layout';
import { CONTENT_TOP, screen, type NavTab } from '../screen';
import { commit, session, today } from '../session';
import { emptyState, ScrollArea, toast } from '../ui';
import { type SkinIcon } from '../skin';
import { C, S } from '../theme';
import { collect, queueRewardFly, staggerIn, type Point } from '../juice';
import { isUnlocked, lockedScreen } from '../unlockBanner';
import { claimState, groupRows } from '../inboxOrder';
import { checkMark, claimAllButton, claimAllY, claimButton, FOLD_H, foldRow, glyph, glyphColor, inboxRow, listBottom, metaChips, playClaimFx, queueClaimFx, ROW_STEP } from '../inboxRows';

export interface AchievementsData {
  /** Откуда пришли: «Главная» или «Герои» — туда ведёт «Назад» и подсвечивается вкладка. */
  from?: Extract<NavTab, 'Home' | 'Heroes'>;
  scroll?: number;
  /** Свёртка «Получено» раскрыта. */
  open?: boolean;
}

/** Иконка достижения по счётчику. */
const COUNTER_ICON: Record<AchievementCounter, SkinIcon> = {
  stages_cleared: 'map',
  tower_floor: 'tower',
  items_equipped: 'helmet',
  bounties_done: 'compass',
  battles_won: 'swords',
  hero_max_level: 'star',
  summons: 'scroll',
  ascensions: 'trophy',
};

/**
 * K10. Достижения: готовые к получению сверху (золотая кромка, «Забрать»), в процессе — с полосой и наградой справа
 * (ближе к цели — выше), полученные — свёрнуты в «Получено · N». «Забрать всё» — внизу, только когда есть что забрать.
 */
export class AchievementsScene extends Phaser.Scene {
  private area!: ScrollArea;
  private from: 'Home' | 'Heroes' = 'Home';
  private open = false;

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
    const g = groupRows(views, claimState, (a) => a.progress / a.target);
    // Всё уже получено — список не прячем за свёрткой.
    this.open = data.open ?? (!g.ready.length && !g.active.length);
    if (g.ready.length) claimAllButton(this, () => this.claimAll(), 'achievementsClaimAll');

    this.area = new ScrollArea(this, CONTENT_TOP + S.xs, listBottom(g.ready.length > 0));
    if (!views.length) this.area.add(emptyState(this, GAME_W / 2, 160, 'Достижений пока нет'));
    const rows: Phaser.GameObjects.GameObject[][] = [];
    let y = 0;
    const put = (h: number, build: (cy: number) => void) => {
      const cy = y + h / 2;
      rows.push(collect(this.area.content, () => build(cy)));
      y += h + S.xs;
    };
    for (const a of [...g.ready, ...g.active]) put(ROW_STEP - S.xs, (cy) => this.area.add(this.row(a, cy)));
    if (g.done.length) {
      put(FOLD_H, (cy) => this.area.add(foldRow(this, GAME_W / 2, cy, 'Получено', g.done.length, this.open, this.area.tap(() => this.restartKeep({ open: !this.open })))));
      if (this.open) for (const a of g.done) put(FOLD_H, (cy) => this.area.add(this.row(a, cy)));
    }
    this.area.setContentHeight(y);
    if (data.scroll) this.area.offset = data.scroll;
    staggerIn(this, 'Achievements', rows);
    playClaimFx(this);
  }

  private row(a: AchievementView, cy: number): Phaser.GameObjects.Container {
    const state = claimState(a);
    const icon = glyph(COUNTER_ICON[a.counter] ?? 'trophy', glyphColor(state));
    const chips = metaChips(a.rewards);
    if (state === 'ready') {
      const claim = this.area.tap(() => this.claim(a, { x: GAME_W - S.l - 140, y: this.area.content.y + cy }));
      return inboxRow(this, GAME_W / 2, cy, { state, icon, title: a.description, line: { chips }, trailing: claimButton(this, claim), onTap: claim }).setName(`ach_${a.id}`);
    }
    if (state === 'active') {
      return inboxRow(this, GAME_W / 2, cy, { state, icon, title: a.description, line: { progress: a.progress, target: a.target, key: `ach:${a.id}`, chips } }).setName(`ach_${a.id}`);
    }
    return inboxRow(this, GAME_W / 2, cy, { state, icon, title: a.description, trailing: checkMark(this), h: FOLD_H }).setName(`ach_${a.id}`);
  }

  private restartKeep(d: AchievementsData = {}): void {
    this.scene.restart({ from: this.from, scroll: this.area.offset, open: this.open, ...d } satisfies AchievementsData);
  }

  private claimAll(): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimAllAchievements(session.save, today(), GAME);
      commit(r.save);
      const at = { x: GAME_W / 2, y: claimAllY() };
      queueRewardFly('Achievements', at, before, { burst: true });
      queueClaimFx('Achievements', at, metaChips(r.rewards), this.eventLines(r.events));
      this.restartKeep({ scroll: 0 });
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
      queueClaimFx('Achievements', at, metaChips(r.rewards), this.eventLines(r.events));
      this.restartKeep();
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Строки событий, которых не видно на экране (какая карта героя выпала); гемы и золото долетают до шапки. */
  private eventLines(events: Parameters<typeof describeEvents>[0]): string[] {
    return describeEvents(events, session.save, GAME).filter((l) => !l.startsWith('Гемы'));
  }
}
