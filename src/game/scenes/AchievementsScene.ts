import Phaser from 'phaser';
import { achievementStatus, actClaimAchievement, actClaimAllAchievements, type AchievementCounter, type AchievementView } from '../../core';
import { GAME } from '../content';
import { describeEvents } from '../flow';
import { GAME_W } from '../layout';
import { contentBottom, CONTENT_TOP, refreshScreen, screen, type NavTab } from '../screen';
import { commit, session, today } from '../session';
import { emptyState, ScrollArea, shieldTaps, toast, type ButtonView } from '../ui';
import { type SkinIcon } from '../skin';
import { C, S } from '../theme';
import { collect, queueRewardFly, staggerIn, type Point } from '../juice';
import { isUnlocked, lockedScreen } from '../unlockBanner';
import { claimState, groupRows } from '../inboxOrder';
import { checkMark, claimAllButton, claimAllY, claimButton, foldRow, glyph, glyphColor, metaChips, playClaimFx, queueClaimFx, ROW_W } from '../inboxRows';

import { utilityInboxRow as inboxRow, utilityListLayout, utilityRowHeight } from '../utilityScreenLayout';
import { onViewChange } from '../viewport';

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
  private claimAllControl?: ButtonView;

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
    this.claimAllControl = undefined;
    this.area = new ScrollArea(this, CONTENT_TOP + S.xs, contentBottom());
    this.area.content.setName('achievementsScroll');
    this.open = data.open ?? false;
    this.drawList(data.scroll ?? 0, data.open === undefined);
    onViewChange(this, () => this.layoutList());
  }

  private layoutList(): void {
    const l = utilityListLayout(CONTENT_TOP + S.xs, contentBottom(), !!this.claimAllControl);
    this.area.setBounds(l.top, l.bottom);
    this.claimAllControl?.container.setY(l.claimY);
  }

  private drawList(scroll = this.area.offset, defaultFold = false): void {
    this.area.clear();
    this.claimAllControl?.container.destroy();
    this.claimAllControl = undefined;
    const views = achievementStatus(session.save, GAME);
    const g = groupRows(views, claimState, (a) => a.progress / a.target);
    if (defaultFold) this.open = !g.ready.length && !g.active.length;
    if (g.ready.length) this.claimAllControl = claimAllButton(this, () => this.claimAll(), 'achievementsClaimAll');
    this.layoutList();
    if (!views.length) this.area.add(emptyState(this, GAME_W / 2, 160, 'Достижений пока нет'));
    const rows: Phaser.GameObjects.GameObject[][] = [];
    let y = 0;
    const put = (h: number, build: (cy: number) => void) => {
      rows.push(collect(this.area.content, () => build(y + h / 2)));
      y += h + S.xs;
    };
    for (const a of [...g.ready, ...g.active]) {
      const line = claimState(a) === 'ready' ? { chips: metaChips(a.rewards) } : { progress: a.progress, target: a.target, key: '', chips: metaChips(a.rewards) };
      put(utilityRowHeight(line), (cy) => this.area.add(this.row(a, cy)));
    }
    if (g.done.length) {
      put(utilityRowHeight(), (cy) => this.area.add(foldRow(this, GAME_W / 2, cy, 'Получено', g.done.length, this.open, this.area.tap(() => this.refreshKeep({ open: !this.open }))).setSize(ROW_W, utilityRowHeight())));
      if (this.open) for (const a of g.done) put(utilityRowHeight(), (cy) => this.area.add(this.row(a, cy)));
    }
    this.area.setContentHeight(y);
    this.area.offset = scroll;
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
    return inboxRow(this, GAME_W / 2, cy, { state, icon, title: a.description, trailing: checkMark(this), h: utilityRowHeight() }).setName(`ach_${a.id}`);
  }

  private refreshKeep(d: AchievementsData = {}): void {
    this.open = d.open ?? this.open;
    shieldTaps(this.sys?.game);
    refreshScreen(this);
    this.drawList(d.scroll ?? this.area.offset);
  }

  private claimAll(): void {
    if (!achievementStatus(session.save, GAME).some((a) => a.done && !a.claimed)) return;
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimAllAchievements(session.save, today(), GAME);
      commit(r.save);
      const at = { x: GAME_W / 2, y: claimAllY() };
      queueRewardFly('Achievements', at, before, { burst: true });
      queueClaimFx('Achievements', at, metaChips(r.rewards), this.eventLines(r.events));
      this.refreshKeep({ scroll: 0 });
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claim(a: AchievementView, at: Point): void {
    const current = achievementStatus(session.save, GAME).find((x) => x.id === a.id);
    if (!current?.done || current.claimed) return;
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimAchievement(session.save, today(), a.id, GAME);
      commit(r.save);
      queueRewardFly('Achievements', at, before);
      queueClaimFx('Achievements', at, metaChips(r.rewards), this.eventLines(r.events));
      this.refreshKeep();
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Строки событий, которых не видно на экране (какая карта героя выпала); гемы и золото долетают до шапки. */
  private eventLines(events: Parameters<typeof describeEvents>[0]): string[] {
    return describeEvents(events, session.save, GAME).filter((l) => !l.startsWith('Гемы'));
  }
}
