import Phaser from 'phaser';
import {
  claimLogin,
  claimNewbieMilestone,
  claimNewbieTask,
  loginStatus,
  newbieStatus,
  type LoginDayView,
  type NewbieMilestoneView,
  type NewbieStatus,
  type NewbieTaskView,
} from '../../core';
import { GAME } from '../content';
import { ribbon, slowRays, glow } from '../decor';
import { daysText, formatNumber, pointsText } from '../flow';
import { drawHeroCard, heroCardIcon, heroCardSize } from '../heroCard';
import { touchToday } from '../homeEvents';
import { afterRewardFly, collect, juiceOn, pulse, queueRewardFly, staggerIn, type Point } from '../juice';
import { GAME_W } from '../layout';
import { rewardColumn, rewardRow, rewardText, rewardToast } from '../rewardsView';
import { badge, card, CONTENT_TOP, contentBottom, cornerBadge, screen } from '../screen';
import { commit, restartOnNewDay, session, today } from '../session';
import { SKIN, SKIN_TINT, skinIcon } from '../skin';
import { C, FS, OUTLINE, TINT, TITLE_STYLE } from '../theme';
import { button, pressable, progressBar, ScrollArea, text, toast } from '../ui';

export type EventsTab = 'login' | 'newbie';

export interface EventsData {
  tab?: EventsTab;
  /** «7 дней новичка»: выбранный день (1…7). */
  day?: number;
}

const TAB_Y = CONTENT_TOP + 60;
const TAB_W = 440;
const TAB_H = 110;
const CHECK_TINT = 0x9fe0a6;

/** Плитки дней входа 1–6: 3 × 2, день 7 — широкая плитка с карточкой героя. */
const LOGIN = { top: CONTENT_TOP + 330, tileW: 320, tileH: 290, gapY: 20, xs: [200, 540, 880], day7Y: 0, day7H: 430 } as const;

/** «7 дней новичка»: полоса очков с сундуками, выбор дня, список заданий. */
const NB = { barX: 90, barW: 700, barY: CONTENT_TOP + 400, dayY: CONTENT_TOP + 540, listTop: CONTENT_TOP + 610, rowH: 180 } as const;

/**
 * События новичка (как в AFK Arena): вкладка «Вход» — календарь 7 дней входа (пропуски не сбрасывают), день 7 —
 * фиолетовый герой; вкладка «Новичок» — задания по дням, очки → сундуки, последний сундук — фиолетовый герой.
 * Награду забирают нажатием. Ядро — src/core/events (touchEvents, loginStatus, claimLogin, newbieStatus…).
 */
export class EventsScene extends Phaser.Scene {
  private tab: EventsTab = 'login';
  private day = 1;
  private area?: ScrollArea;

  constructor() {
    super('Events');
  }

  create(data: EventsData = {}): void {
    this.area = undefined;
    touchToday();
    restartOnNewDay(this);
    const d = today();
    const login = loginStatus(session.save, d, GAME);
    const nb = newbieStatus(session.save, d, GAME);
    // Нет вкладки «Новичок» (событие закрыто) — только «Вход»; и наоборот.
    const tabs: EventsTab[] = [];
    if (!login.done) tabs.push('login');
    if (nb.open) tabs.push('newbie');
    if (!tabs.length) tabs.push('login');
    this.tab = data.tab && tabs.includes(data.tab) ? data.tab : tabs[0];
    this.day = Phaser.Math.Clamp(data.day ?? Math.min(nb.eventDay, nb.days.length), 1, nb.days.length);

    screen(this, 'События', 'Home', { to: 'Home' });
    this.tabs(tabs, login.claimable, nb.open ? nb.claimable : 0);
    if (this.tab === 'login') this.loginTab();
    else this.newbieTab(nb);
  }

  private tabs(tabs: EventsTab[], loginBadge: number, newbieBadge: number): void {
    const names: Record<EventsTab, string> = { login: 'Вход', newbie: 'Новичок' };
    const step = TAB_W + 30;
    tabs.forEach((t, i) => {
      const x = GAME_W / 2 + (i - (tabs.length - 1) / 2) * step;
      const on = t === this.tab;
      const b = button(this, x, TAB_Y, TAB_W, TAB_H, on ? 'skin_tab_active' : 'skin_tab', names[t], () => {
        if (!on) this.scene.restart({ tab: t, day: this.day });
      }, FS.h3, { sound: 'ui_tab' });
      b.label.setColor(on ? SKIN.goldLight : SKIN.creamDim);
      b.container.setName(`tab_${t}`);
      cornerBadge(this, x, TAB_Y, TAB_W, TAB_H, t === 'login' ? loginBadge : newbieBadge);
    });
  }

  // ---------- «Вход 7 дней» ----------

  private loginTab(): void {
    const st = loginStatus(session.save, today(), GAME);
    const top = TAB_Y + TAB_H / 2 + 20;
    ribbon(this, GAME_W / 2, top + 50, st.name, { size: FS.h2, minW: 560 });
    text(this, GAME_W / 2, top + 130, `Дней входа: ${st.loginDays} из ${st.days.length}. Пропуски не сбрасывают счёт —\nзаходите каждый день и забирайте награду нажатием.`, FS.small, C.muted, { align: 'center', lineSpacing: 6, ...OUTLINE });

    const rows: Phaser.GameObjects.GameObject[][] = [];
    const small = st.days.slice(0, Math.min(6, st.days.length - 1));
    const big = st.days[st.days.length - 1];
    small.forEach((d, i) => {
      const x = LOGIN.xs[i % 3];
      const y = LOGIN.top + LOGIN.tileH / 2 + Math.floor(i / 3) * (LOGIN.tileH + LOGIN.gapY);
      const objs = collect(this.children, () => this.dayTile(d, x, y));
      if (i % 3 === 0) rows.push(objs);
      else rows[rows.length - 1].push(...objs);
    });
    const bigY = LOGIN.top + 2 * (LOGIN.tileH + LOGIN.gapY) + LOGIN.day7H / 2;
    if (big) rows.push(collect(this.children, () => this.bigDayTile(big, bigY)));
    staggerIn(this, 'Events:login', rows);
  }

  /** Состояние плитки: подложка, подпись дня, галочка/замок, пульс готовой. Возвращает фон плитки. */
  private tileFrame(d: LoginDayView, x: number, y: number, w: number, h: number): Phaser.GameObjects.NineSlice {
    if (d.ready) {
      const g = glow(this, x, y, Math.max(w, h) * 1.25, 0xffd27a, 0.45, true);
      g.setScale((w * 1.3) / 128, (h * 1.3) / 128);
    }
    const bg = card(this, x, y, w, h, d.ready);
    if (d.claimed) bg.setAlpha(0.55);
    bg.setName(`loginDay_${d.day}`);
    text(this, x, y - h / 2 + 36, `День ${d.day}`, FS.h3, d.ready ? C.ink : d.claimed ? C.disabled : C.title, d.ready ? { fontStyle: 'bold' } : TITLE_STYLE);
    pressable(this, bg, w, h, () => this.claimDay(d, { x, y }));
    return bg;
  }

  private dayTile(d: LoginDayView, x: number, y: number): void {
    const { tileW: w, tileH: h } = LOGIN;
    this.tileFrame(d, x, y, w, h);
    rewardColumn(this, x, y - 20 + (Object.keys(d.rewards).length > 1 ? -18 : 18), d.rewards, { size: 52, step: 70, font: FS.h3, dim: d.claimed });
    this.dayState(d, x, y + h / 2 - 40);
    if (d.ready) {
      // Готовая плитка: золотая кнопка внизу (нажатие по всей плитке тоже забирает).
      const b = button(this, x, y + h / 2 - 44, w - 70, 70, 'ui_btn_primary', 'Забрать', () => this.claimDay(d, { x, y }), FS.small);
      b.container.setName(`loginClaim_${d.day}`);
      pulse(this, b.container, 1.04, 700);
      cornerBadge(this, x, y, w, h, 1);
    }
  }

  /** Низ плитки: «Получено» с галочкой, «Завтра» / «Через N дн.» или ничего (готова — подпись сверху). */
  private dayState(d: LoginDayView, x: number, y: number): void {
    if (d.claimed) {
      const t = text(this, x + 22, y, 'Получено', FS.small, C.success, { fontStyle: 'bold', ...OUTLINE });
      this.add.image(t.x - t.width / 2 - 26, y, skinIcon('check')).setDisplaySize(40, 40).setTint(CHECK_TINT);
    } else if (!d.reached) {
      const st = loginStatus(session.save, today(), GAME);
      const n = d.day - st.loginDays;
      const t = text(this, x + 20, y, n === 1 ? 'Завтра' : `Через ${daysText(n)}`, FS.small, C.dim, OUTLINE);
      this.add.image(t.x - t.width / 2 - 24, y, skinIcon('lock')).setDisplaySize(34, 34).setTint(SKIN_TINT.creamDim);
    }
  }

  /** День 7: широкая плитка — карточка героя слева, подпись и остальные награды справа. */
  private bigDayTile(d: LoginDayView, y: number): void {
    const w = 1000;
    const h = LOGIN.day7H;
    const x = GAME_W / 2;
    this.tileFrame(d, x, y, w, h);
    const hero = d.rewards.heroes?.[0];
    const pick = d.rewards.heroPicks?.[0];
    const cx = x - w / 2 + 190;
    if (hero) {
      if (!d.claimed) slowRays(this, cx, y + 20, 360, 0.35, 0xd890ff);
      drawHeroCard(this, cx, y + 26, hero, { w: 210, glow: !d.claimed, level: null }).setAlpha(d.claimed ? 0.6 : 1);
    } else if (pick) {
      // «Контракт героя»: рубашка цвета редкости с пером-звездой — герой и ветка на выбор.
      if (!d.claimed) slowRays(this, cx, y + 20, 360, 0.35, 0xd890ff);
      heroCardIcon(this, cx, y + 26, 290, pick.rarity, undefined, { pick: true, dim: d.claimed });
    }
    const tx = x - w / 2 + 360;
    const name = hero ? (GAME.content.heroes[hero]?.name ?? hero) : pick ? 'Герой и ветка — на выбор' : '';
    text(this, tx, y - 90, d.label ?? 'Главная награда', FS.h2, d.ready ? C.ink : d.claimed ? C.disabled : C.title, d.ready ? { fontStyle: 'bold' } : TITLE_STYLE).setOrigin(0, 0.5);
    if (name) text(this, tx, y - 30, name, FS.h3, d.ready ? C.inkMuted : C.text, d.ready ? {} : OUTLINE).setOrigin(0, 0.5);
    const rest = { ...d.rewards, heroes: [], heroPicks: [] };
    rewardRow(this, tx, y + 30, rest, { dim: d.claimed });
    this.dayState(d, x + 150, y + h / 2 - 50);
    if (d.ready) {
      const b = button(this, x + w / 2 - 170, y + 110, 260, 100, 'ui_btn_primary', 'Забрать', () => this.claimDay(d, { x: cx, y }), FS.h3);
      b.container.setName(`loginClaim_${d.day}`);
      pulse(this, b.container);
      cornerBadge(this, x, y, w, h, 1);
    } else if (!d.claimed) {
      text(this, tx, y + 100, 'Заходите в игру 7 разных дней', FS.small, C.muted, OUTLINE).setOrigin(0, 0.5);
    }
  }

  private claimDay(d: LoginDayView, at: Point): void {
    if (d.claimed) return toast(this, 'Эта награда уже получена');
    if (!d.reached) {
      const n = d.day - loginStatus(session.save, today(), GAME).loginDays;
      return toast(this, n === 1 ? 'Награда откроется завтра — заходите!' : `Награда откроется через ${daysText(n)} входа`);
    }
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = claimLogin(session.save, today(), d.day, GAME);
      commit(r.save);
      queueRewardFly('Events', at, before, { burst: true });
      if (this.toContract(rewardToast(`День ${d.day}`, r.rewards, r.events), r.events, { tab: 'login' })) return;
      this.restartWithToast(rewardToast(`День ${d.day}`, r.rewards, r.events), { tab: 'login' });
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  // ---------- «7 дней новичка» ----------

  private newbieTab(st: NewbieStatus): void {
    const top = TAB_Y + TAB_H / 2 + 20;
    ribbon(this, GAME_W / 2, top + 50, st.name, { size: FS.h2, minW: 560 });
    const when = st.active
      ? st.daysLeft === 0
        ? `День ${st.eventDay} из ${st.durationDays} — последний день заданий`
        : `День ${st.eventDay} из ${st.durationDays} · до конца ${daysText(st.daysLeft)}`
      : 'Задания закончились — заберите награды сегодня';
    text(this, 60, top + 125, when, FS.small, st.active ? C.muted : C.gold, OUTLINE).setOrigin(0, 0.5);
    text(this, 60, top + 175, `Очки: ${st.points} / ${st.maxPoints}`, FS.h3, C.title, TITLE_STYLE).setOrigin(0, 0.5);

    // Главная награда — последний сундук: карточка героя справа.
    const final = st.milestones[st.milestones.length - 1];
    const hero = final?.rewards.heroes?.[0];
    const finalPick = final?.rewards.heroPicks?.[0];
    if (!hero && finalPick) {
      const ch = 204;
      const cx = GAME_W - 60 - 75;
      const cy = top + 105 + ch / 2;
      if (!final.claimed) slowRays(this, cx, cy, 260, 0.3, 0xd890ff);
      heroCardIcon(this, cx, cy, ch, finalPick.rarity, undefined, { pick: true, dim: final.claimed });
      text(this, cx, cy + ch / 2 + 22, `за ${pointsText(final.points)}`, FS.caption, C.gold, OUTLINE);
    }
    if (hero) {
      const cw = 150;
      const { h } = heroCardSize(cw);
      const cx = GAME_W - 60 - cw / 2;
      const cy = top + 105 + h / 2;
      if (!final.claimed) slowRays(this, cx, cy, 260, 0.3, 0xd890ff);
      drawHeroCard(this, cx, cy, hero, { w: cw, glow: final.ready, level: null, showPips: false }).setAlpha(final.claimed ? 0.6 : 1);
      text(this, cx, cy + h / 2 + 22, `за ${pointsText(final.points)}`, FS.caption, C.gold, OUTLINE);
    }

    const barY = NB.barY;
    progressBar(this, NB.barX, barY, NB.barW, 34, st.maxPoints ? st.points / Math.max(1, final?.points ?? st.maxPoints) : 0, TINT.success, { key: 'events:newbie' });
    const span = Math.max(1, final?.points ?? st.maxPoints);
    for (const m of st.milestones) this.chest(m, NB.barX + (NB.barW * m.points) / span, barY);

    // Дни: 1…7, закрытые — замок, со значком — есть что забрать.
    const n = st.days.length;
    const dw = Math.min(140, (GAME_W - 80) / n - 10);
    st.days.forEach((d, i) => {
      const x = GAME_W / 2 + (i - (n - 1) / 2) * (dw + 10);
      const on = d.day === this.day;
      const b = button(this, x, NB.dayY, dw, 96, on ? 'skin_tab_active' : 'skin_tab', `${d.day}`, () => {
        if (!on) this.scene.restart({ tab: 'newbie', day: d.day });
      }, FS.h2, { sound: 'ui_tab' });
      b.label.setColor(on ? SKIN.goldLight : d.locked ? C.disabled : SKIN.cream);
      b.container.setName(`nbDay_${d.day}`);
      if (d.locked) b.container.add(this.add.image(dw / 2 - 22, -28, skinIcon('lock')).setDisplaySize(28, 28).setTint(SKIN_TINT.creamDim));
      const ready = d.tasks.filter((t) => t.ready).length;
      if (ready) badge(this, x + dw / 2 - 10, NB.dayY - 40, ready);
    });

    const day = st.days[this.day - 1];
    this.area = new ScrollArea(this, NB.listTop, contentBottom() + 10);
    if (day.locked) {
      const left = this.day - st.eventDay;
      this.area.add(text(this, GAME_W / 2, 60, left === 1 ? `Задания дня ${this.day} откроются завтра` : `Задания дня ${this.day} откроются через ${daysText(left)}`, FS.body, C.muted, OUTLINE));
    }
    const rows = day.tasks.map((t, i) => collect(this.area!.content, () => this.taskRow(t, (day.locked ? 120 : 0) + NB.rowH * (i + 0.5), NB.rowH - 14, st.open)));
    this.area.setContentHeight((day.locked ? 120 : 0) + NB.rowH * day.tasks.length + 10);
    staggerIn(this, 'Events:newbie', rows);
  }

  private chest(m: NewbieMilestoneView, x: number, y: number): void {
    const x0 = Math.min(x, NB.barX + NB.barW - 10);
    if (m.ready) {
      const g = this.add.rectangle(x0, y, 116, 116, 0xffd84a, 0.35).setStrokeStyle(6, 0xffd84a);
      if (juiceOn()) this.tweens.add({ targets: g, alpha: 0.35, yoyo: true, repeat: -1, duration: 600 });
    }
    const frame = m.claimed ? 'k:buttonSquare_grey' : m.ready ? 'k:buttonSquare_beige' : 'k:buttonSquare_brown';
    const b = button(this, x0, y, 96, 96, frame, String(m.points), () => this.claimChest(m, { x: x0, y }), FS.caption);
    b.label.setY(28).setColor(m.claimed ? C.disabled : m.ready ? SKIN.goldLight : SKIN.cream).setStroke('#000000', 5);
    const hero = !!m.rewards.heroes?.length || !!m.rewards.heroPicks?.length;
    b.container.addAt(this.add.image(0, -12, skinIcon(hero ? 'star' : 'chest')).setDisplaySize(52, 52).setTint(m.claimed ? 0x6a6a70 : hero ? 0xd890ff : m.ready ? SKIN_TINT.gold : SKIN_TINT.creamDim), 1);
    b.container.setName(`nbChest_${m.points}`);
    if (m.claimed) this.add.image(x0 + 34, y - 34, skinIcon('check')).setDisplaySize(40, 40).setTint(CHECK_TINT);
    if (m.ready) {
      cornerBadge(this, x0, y, 96, 96, 1);
      pulse(this, b.container, 1.08, 600);
    }
  }

  private taskRow(t: NewbieTaskView, y: number, h: number, open: boolean): void {
    const a = this.area!;
    const grey = t.claimed || t.locked;
    const bg = a.add(card(this, GAME_W / 2, y, 1020, h, t.ready));
    if (grey) bg.setAlpha(0.55);
    const dark = t.ready;
    a.add(text(this, 60, y - h * 0.22, t.name, FS.body, dark ? C.ink : grey ? C.disabled : C.text, {
      fontStyle: 'bold',
      ...(dark ? {} : OUTLINE),
      align: 'left',
      wordWrap: { width: 620 },
    }).setOrigin(0, 0.5));
    a.add(progressBar(this, 60, y + h * 0.22, 420, 30, t.progress / t.target, t.done ? TINT.gold : TINT.success, { key: `nb:${t.id}` }));
    a.add(text(this, 270, y + h * 0.22, `${formatNumber(t.progress)} / ${formatNumber(t.target)}`, FS.caption, t.done ? C.titleStroke : C.text, t.done ? { fontStyle: 'bold' } : { fontStyle: 'bold', ...OUTLINE }));
    a.add(text(this, 560, y + h * 0.22, `+${pointsText(t.points)}`, FS.body, dark ? C.inkMuted : grey ? C.disabled : C.success, { fontStyle: 'bold' }));
    const bx = 880;
    if (t.claimed) {
      const done = a.add(text(this, bx + 24, y, 'Готово', FS.body, C.success, { fontStyle: 'bold' }));
      a.add(this.add.image(done.x - done.width / 2 - 34, y, skinIcon('check')).setDisplaySize(46, 46).setTint(CHECK_TINT));
    } else if (t.locked) {
      a.add(this.add.image(bx, y, skinIcon('lock')).setDisplaySize(56, 56).setTint(SKIN_TINT.creamDim));
    } else if (t.ready) {
      const b = button(this, bx, y, 240, 100, 'ui_btn_primary', 'Забрать', a.tap(() => this.claimTask(t)), FS.h3);
      a.add(b.container);
      pulse(this, b.container);
    } else if (open) {
      a.add(button(this, bx, y, 240, 100, 'ui_btn_secondary', 'Перейти', a.tap(() => this.scene.start(taskDestination(t.counter))), FS.h3).container);
    }
  }

  private claimTask(t: NewbieTaskView): void {
    try {
      const r = claimNewbieTask(session.save, today(), t.id, GAME);
      commit(r.save);
      this.restartWithToast(`«${t.name}»: +${r.points} очков`, { tab: 'newbie', day: this.day }, false);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claimChest(m: NewbieMilestoneView, at: Point): void {
    if (m.claimed) return toast(this, 'Эта награда уже получена');
    if (!m.reached) return toast(this, `Нужно ${m.points} очков. В сундуке: ${rewardText(m.rewards)}.`);
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = claimNewbieMilestone(session.save, today(), m.points, GAME);
      commit(r.save);
      queueRewardFly('Events', at, before);
      if (this.toContract(rewardToast(`Сундук за ${m.points} очков`, r.rewards, r.events), r.events, { tab: 'newbie', day: this.day })) return;
      this.restartWithToast(rewardToast(`Сундук за ${m.points} очков`, r.rewards, r.events), { tab: 'newbie', day: this.day });
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** В награде «Контракт героя» — сразу экран выбора героя (назад — сюда же). true — ушли. */
  private toContract(message: string, events: readonly { type: string }[], data: EventsData): boolean {
    if (!events.some((e) => e.type === 'heroPick')) return false;
    this.scene.start('HeroPick', { back: { to: 'Events', data } });
    const sc = this.scene.get('HeroPick');
    sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, message, C.success, 4000));
    return true;
  }

  private restartWithToast(message: string, data: EventsData, fly = true): void {
    this.scene.restart(data);
    this.events.once(Phaser.Scenes.Events.CREATE, () => (fly ? afterRewardFly(this, () => toast(this, message, C.success, 4500)) : toast(this, message, C.success, 3500)));
  }
}

/** Куда ведёт «Перейти» у задания новичка (по счётчику достижений). */
export function taskDestination(counter: string): string {
  switch (counter) {
    case 'stages_cleared':
    case 'battles_won':
      return 'Campaign';
    case 'tower_floor':
      return 'Tower';
    case 'summons':
      return 'Tavern';
    case 'bounties_done':
      return 'Expeditions';
    case 'hero_max_level':
    case 'ascensions':
    case 'items_equipped':
      return 'Heroes';
    default:
      return 'Home';
  }
}
