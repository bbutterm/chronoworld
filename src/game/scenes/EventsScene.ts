import Phaser from 'phaser';
import {
  claimLogin,
  claimNewbieMilestone,
  claimNewbieTask,
  loginStatus,
  newbieStatus,
  type CardRarity,
  type LoginDayView,
  type LoginStatus,
  type NewbieMilestoneView,
  type NewbieStatus,
  type NewbieTaskView,
  type RewardBundle,
} from '../../core';
import { slowRays } from '../decor';
import { GAME } from '../content';
import { daysText } from '../flow';
import { heroCardIcon } from '../heroCard';
import { artCardTexture } from '../homeBuildings';
import { touchToday } from '../homeEvents';
import { afterRewardFly, collect, juiceOn, pulse, queueRewardFly, staggerIn, type Point } from '../juice';
import { GAME_W } from '../layout';
import { rewardIcon, rewardItems, rewardText, rewardToast, type RewardItem } from '../rewardsView';
import { CONTENT_TOP, contentBottom, dot, screen } from '../screen';
import { commit, restartOnNewDay, session, today } from '../session';
import { skinIcon, type SkinIcon } from '../skin';
import { C, COLOR, COLOR_N, FAMILY, R, S, T } from '../theme';
import { chip, listRow, mixHex, plate, pressable, progressBar, ScrollArea, segmented, SURFACE, tag, text, toast, type ChipSpec, type Tone } from '../ui';

export type EventsTab = 'login' | 'newbie';

export interface EventsData {
  tab?: EventsTab;
  /** «7 дней новичка»: выбранный день (1…7). */
  day?: number;
}

/** Раскладка (поле 1080): баннер события, вкладки (если событий два), содержимое вкладки. */
export const EV_L = {
  w: GAME_W - 2 * S.l,
  top: CONTENT_TOP + S.xs,
  bannerH: 360,
  segH: 88,
  /** Вход: плитки дней 4 в ряд, день 7 — на две колонки. */
  cols: 4,
  tileH: 300,
  /** Новичок: узел вехи на дорожке, строка задания. */
  node: 104,
  rowH: 136,
} as const;
const TILE_W = (EV_L.w - (EV_L.cols - 1) * S.s) / EV_L.cols;
const CHECK_TINT = 0x9fe0a6;

/** Центр плитки дня входа (день 1…7) и её ширина: 1–4 — первый ряд, 5–6 — второй, 7 — две колонки справа. */
export function loginTilePos(day: number, top: number): { x: number; y: number; w: number } {
  const i = day - 1;
  const col = i % EV_L.cols;
  const row = Math.floor(i / EV_L.cols);
  const y = top + EV_L.tileH / 2 + row * (EV_L.tileH + S.s);
  const x = S.l + TILE_W / 2 + col * (TILE_W + S.s);
  if (day === 7) return { x: x + (TILE_W + S.s) / 2, y, w: 2 * TILE_W + S.s };
  return { x, y, w: TILE_W };
}

/** Порядок заданий: «можно забрать» сверху, затем в процессе, внизу — полученные и закрытые. */
export function sortTasks<T extends Pick<NewbieTaskView, 'ready' | 'claimed' | 'locked'>>(tasks: readonly T[]): T[] {
  const rank = (t: T) => (t.ready ? 0 : t.claimed || t.locked ? 2 : 1);
  return tasks.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
}

/** Иконка задания по счётчику достижений. */
function taskIcon(counter: string): SkinIcon {
  switch (counter) {
    case 'stages_cleared':
    case 'battles_won':
      return 'swords';
    case 'tower_floor':
      return 'tower';
    case 'summons':
      return 'scroll';
    case 'bounties_done':
      return 'flag';
    case 'items_equipped':
      return 'helmet';
    default:
      return 'star';
  }
}

/** Награда чипом: иконка вида (мини-карта у героя/контракта) и короткое число, цвет — по валюте. */
function rewardChip(it: RewardItem, dim = false): ChipSpec {
  const tone: Tone = dim ? 'neutral' : it.kind === 'gold' ? 'gold' : it.kind === 'gems' ? 'gem' : 'neutral';
  return { icon: (s, x, y, size) => rewardIcon(s, x, y, it.kind, size, dim, it), value: it.short, tone };
}

/** Главный приз события (последний день входа / последняя веха новичка): контракт или карточка героя. */
function mainPrize(r: RewardBundle | undefined): { rarity: CardRarity; hero?: string; pick: boolean } | null {
  const pick = r?.heroPicks?.[0];
  if (pick) return { rarity: pick.rarity, pick: true };
  const hero = r?.heroes?.[0];
  if (hero) return { rarity: GAME.content.heroes[hero]?.baseRarity ?? 'purple', hero, pick: false };
  return null;
}

/** Нарисованный баннер события: ночное небо фиолетовым, гирлянда флажков, тёплый свет справа под главный приз. */
function paintBanner(c: CanvasRenderingContext2D, W: number, H: number): void {
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2a1840');
  sky.addColorStop(0.6, '#3b2350');
  sky.addColorStop(1, '#1a1020');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  const light = c.createRadialGradient(W * 0.8, H * 0.5, 8, W * 0.8, H * 0.5, H * 0.95);
  light.addColorStop(0, 'rgba(255,214,140,0.55)');
  light.addColorStop(0.5, 'rgba(216,144,255,0.18)');
  light.addColorStop(1, 'rgba(216,144,255,0)');
  c.fillStyle = light;
  c.fillRect(0, 0, W, H);
  // Звёзды-искры (детерминированно).
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % W;
    const y = ((i * 53) % (H * 0.7)) + 8;
    c.fillStyle = `rgba(255,240,200,${0.25 + ((i * 7) % 5) * 0.1})`;
    c.fillRect(x, y, 2 + (i % 2), 2 + (i % 2));
  }
  // Гирлянда флажков провисает дугой по верху.
  const colors = ['#e0392b', '#e8b85a', '#4a90e2', '#5fbf5a', '#a35fe0'];
  const sag = (x: number) => 18 + Math.sin((x / W) * Math.PI) * H * 0.12;
  c.strokeStyle = 'rgba(40,24,12,0.9)';
  c.lineWidth = 2;
  c.beginPath();
  for (let x = 0; x <= W; x += 8) (x ? c.lineTo(x, sag(x)) : c.moveTo(x, sag(x)));
  c.stroke();
  for (let x = 14, n = 0; x < W - 10; x += 34, n++) {
    const y = sag(x);
    c.fillStyle = colors[n % colors.length];
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(x - 11, y);
    c.lineTo(x + 11, y);
    c.lineTo(x, y + 24);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
  }
  // Земля: тёмная полоса с огоньками фонарей.
  c.fillStyle = 'rgba(12,8,14,0.85)';
  c.fillRect(0, H * 0.82, W, H * 0.18);
  for (let x = 40; x < W; x += 150) {
    const g = c.createRadialGradient(x, H * 0.8, 1, x, H * 0.8, 26);
    g.addColorStop(0, 'rgba(255,200,110,0.8)');
    g.addColorStop(1, 'rgba(255,200,110,0)');
    c.fillStyle = g;
    c.fillRect(x - 26, H * 0.8 - 26, 52, 52);
  }
}

/**
 * События новичка (как в AFK Arena): баннер события с главным призом и таймером; «Вход» — 7 плиток дней (готовая —
 * золотая с точкой, полученная — тусклая с галкой), «Новичок» — дорожка очков с вехами-наградами, дни заданий и задания
 * строками списка. Награду забирают касанием. Ядро — src/core/events (touchEvents, loginStatus, claimLogin, newbieStatus…).
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
    let y = EV_L.top;
    if (this.tab === 'login') this.banner(login.name, login.days[login.days.length - 1], { label: `День ${login.loginDays} из ${login.days.length}`, tone: 'neutral' }, y);
    else {
      const final = nb.milestones[nb.milestones.length - 1];
      const when = !nb.active ? { label: 'Последний шанс', tone: 'warning' as Tone } : { label: nb.daysLeft === 0 ? 'Последний день' : daysText(nb.daysLeft), tone: 'neutral' as Tone };
      this.banner(nb.name, final ? { claimed: final.claimed, rewards: final.rewards } : undefined, when, y, true);
    }
    y += EV_L.bannerH + S.m;
    if (tabs.length > 1) {
      this.tabs(tabs, y + EV_L.segH / 2, { login: login.claimable > 0, newbie: nb.open && nb.claimable > 0 });
      y += EV_L.segH + S.m;
    }
    if (this.tab === 'login') this.loginTab(login, y);
    else this.newbieTab(nb, y);
  }

  /** Баннер: картинка, название и чип срока слева, главный приз справа (с лучами, пока не получен). */
  private banner(name: string, prize: Pick<LoginDayView, 'claimed' | 'rewards'> | undefined, when: { label: string; tone: Tone }, top: number, clock = false): void {
    const { w, bannerH: h } = EV_L;
    const cy = top + h / 2;
    this.add.image(GAME_W / 2, cy, artCardTexture(this, 'eventsBanner', w, h, paintBanner)).setDisplaySize(w, h).setName('eventsBanner');
    const left = S.l + S.m;
    const title = text(this, left, cy + h / 2 - S.m - 72 - S.xs - T.title / 2, name, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    title.setShadow(0, 3, 'rgba(0,0,0,0.85)', 6, false, true);
    chip(this, left, cy + h / 2 - S.m - 28, clock ? 'hourglass' : null, when.label, when.tone, { size: 's', align: 'left' }).setName('eventsWhen');
    const p = mainPrize(prize?.rewards);
    if (!p) return;
    const px = GAME_W - S.l - 170;
    if (!prize?.claimed) slowRays(this, px, cy, 380, 0.35, 0xd890ff);
    heroCardIcon(this, px, cy + S.xxs, h - 2 * S.l, p.rarity, p.hero, { pick: p.pick, dim: prize?.claimed }).setName('eventsPrize');
  }

  /** Вкладки «Вход / Новичок» одного вида (segmented); есть что забрать — красная точка в углу вкладки. */
  private tabs(tabs: EventsTab[], y: number, ready: Record<EventsTab, boolean>): void {
    const names: Record<EventsTab, string> = { login: 'Вход', newbie: 'Новичок' };
    const specs = tabs.map((t) => ({ label: names[t], dot: ready[t] }));
    const seg = segmented(this, GAME_W / 2, y, EV_L.w, specs, tabs.indexOf(this.tab), (i) => {
      this.scene.restart({ tab: tabs[i], day: this.day });
    });
    seg.container.setName('eventsTabs');
  }

  // ---------- «Вход 7 дней» ----------

  private loginTab(st: LoginStatus, top: number): void {
    const rows: Phaser.GameObjects.GameObject[][] = [[], []];
    for (const d of st.days) {
      const pos = loginTilePos(d.day, top);
      rows[d.day <= EV_L.cols ? 0 : 1].push(...collect(this.children, () => this.dayTile(d, st, pos.x, pos.y, pos.w)));
    }
    staggerIn(this, 'Events:login', rows);
  }

  /** Плитка дня: «День N», награды чипами (день 7 — контракт), низ — «Забрать» / «Завтра» / галка. */
  private dayTile(d: LoginDayView, st: LoginStatus, x: number, y: number, w: number): void {
    const h = EV_L.tileH;
    if (d.ready) slowRays(this, x, y, Math.max(w, h) * 1.1, 0.25, 0xffd27a);
    const bg = d.ready
      ? plate(this, x, y, w, h, { fill: mixHex(COLOR.surfaceRaised, COLOR.accent, 0.18), border: COLOR.accent, borderW: 4, r: R.l, hl: 0.2 })
      : plate(this, x, y, w, h, { ...(d.claimed ? SURFACE.surface : SURFACE.raised), r: R.l });
    bg.setName(d.ready ? `loginClaim_${d.day}` : `loginDay_${d.day}`);
    const objs: Phaser.GameObjects.GameObject[] = [];
    objs.push(text(this, x, y - h / 2 + S.s + T.caption / 2, `День ${d.day}`, T.caption, d.ready ? COLOR.title : COLOR.textSecondary, { fontStyle: 'bold' }));
    const items = rewardItems(d.rewards);
    const prize = mainPrize(d.rewards);
    if (prize) {
      // День 7: контракт крупно слева, подпись справа.
      const cx = x - w / 2 + S.l + 70;
      objs.push(heroCardIcon(this, cx, y + 10, 180, prize.rarity, prize.hero, { pick: prize.pick, dim: d.claimed }));
      const lbl = text(this, cx + 70 + S.s, y + 10, d.label ?? 'Главная награда', T.body, d.claimed ? COLOR.textTertiary : COLOR.textPrimary, {
        fontStyle: 'bold',
        wordWrap: { width: w - 140 - S.l - 2 * S.s },
      }).setOrigin(0, 0.5);
      objs.push(lbl);
    } else {
      const step = 64;
      const y0 = y + 6 - ((items.length - 1) * step) / 2;
      items.forEach((it, i) => objs.push(chip(this, x, y0 + i * step, rewardChip(it, d.claimed).icon, it.short, rewardChip(it, d.claimed).tone, { bg: false })));
    }
    const by = y + h / 2 - S.s - 26;
    if (d.ready) {
      const t = tag(this, x, by, 'Забрать', 'accent', { solid: true });
      pulse(this, t, 1.06, 700);
      dot(this, x + w / 2 - 18, y - h / 2 + 18);
    } else if (d.claimed) {
      objs.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha?.(0.45));
      this.add.image(x, by, skinIcon('check')).setDisplaySize(52, 52).setTint(CHECK_TINT);
    } else if (d.day === st.loginDays + 1) {
      text(this, x, by, 'Завтра', T.caption, COLOR.textTertiary);
    }
    pressable(this, bg, w, h, () => this.claimDay(d, { x, y }));
  }

  private claimDay(d: LoginDayView, at: Point): void {
    if (d.claimed) return toast(this, 'Эта награда уже получена');
    if (!d.reached) {
      const n = d.day - loginStatus(session.save, today(), GAME).loginDays;
      return toast(this, n === 1 ? 'Награда откроется завтра' : `Награда откроется через ${daysText(n)} входа`);
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

  private newbieTab(st: NewbieStatus, top: number): void {
    // Дорожка очков: слева — очки, вехи — узлы на полосе, под каждым — главная награда чипом.
    const final = st.milestones[st.milestones.length - 1];
    const span = Math.max(1, final?.points ?? st.maxPoints);
    const rowY = top + 28;
    chip(this, S.l, rowY, 'star', `${st.points} / ${span}`, 'accent', { size: 's', align: 'left' }).setName('nbPoints');
    const barY = rowY + 28 + S.s + EV_L.node / 2;
    const x0 = S.l + 24;
    const x1 = GAME_W - S.l - 70;
    progressBar(this, x0, barY, x1 - x0, 22, Math.min(1, st.points / span), COLOR_N.accent, { key: 'events:newbie' });
    for (const m of st.milestones) this.node(m, x0 + ((x1 - x0) * m.points) / span, barY);

    // Дни заданий: вкладки 1…7; в дне есть что забрать — точка.
    const segY = barY + EV_L.node / 2 + S.s + 56 + S.m + EV_L.segH / 2;
    const days = st.days.map((d) => ({ label: `${d.day}`, dot: d.tasks.some((t) => t.ready), lock: d.locked }));
    const seg = segmented(this, GAME_W / 2, segY, EV_L.w, days, this.day - 1, (i) => this.scene.restart({ tab: 'newbie', day: i + 1 }));
    seg.container.setName('nbDays');

    const day = st.days[this.day - 1];
    const listTop = segY + EV_L.segH / 2 + S.m;
    this.area = new ScrollArea(this, listTop, contentBottom() + 10);
    let ly = 0;
    if (day.locked) {
      const left = this.day - st.eventDay;
      this.area.add(text(this, GAME_W / 2, T.body / 2, left === 1 ? 'Откроется завтра' : `Откроется через ${daysText(left)}`, T.body, COLOR.textSecondary));
      ly += T.body + S.s;
    }
    const rows = sortTasks(day.tasks).map((t) => {
      const objs = collect(this.area!.content, () => this.taskRow(t, ly + EV_L.rowH / 2, st.open));
      ly += EV_L.rowH + S.xs;
      return objs;
    });
    this.area.setContentHeight(ly + S.xs);
    staggerIn(this, 'Events:newbie', rows);
  }

  /** Веха на дорожке: узел (очки), под ним — главная награда; готова — золотой с точкой, получена — тусклый с галкой. */
  private node(m: NewbieMilestoneView, x: number, y: number): void {
    const s = EV_L.node;
    const items = rewardItems(m.rewards);
    const hero = mainPrize(m.rewards);
    if (m.ready) slowRays(this, x, y, s * 2, 0.35, 0xffd27a);
    const bg = m.ready
      ? plate(this, x, y, s, s, { fill: mixHex(COLOR.surfaceRaised, COLOR.accent, 0.25), border: COLOR.accent, borderW: 4, r: R.pill, hl: 0.2 })
      : plate(this, x, y, s, s, { ...(m.claimed ? SURFACE.sunken : SURFACE.raised), r: R.pill });
    bg.setName(`nbChest_${m.points}`);
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (hero) parts.push(heroCardIcon(this, x, y, s - 24, hero.rarity, hero.hero, { pick: hero.pick, dim: m.claimed }));
    else parts.push(this.add.image(x, y - 12, skinIcon('chest')).setDisplaySize(48, 48).setTint(m.ready ? COLOR_N.accent : COLOR_N.textSecondary));
    if (!hero) parts.push(text(this, x, y + 26, `${m.points}`, T.caption, m.ready ? COLOR.title : COLOR.textPrimary, { fontStyle: 'bold' }));
    // Под узлом — главная награда вехи (первая в списке; у последней вехи — её очки).
    const first = items[0];
    const under = y + s / 2 + S.xs + 28;
    if (hero) parts.push(text(this, x, under, `${m.points}`, T.caption, m.ready ? COLOR.title : COLOR.textPrimary, { fontStyle: 'bold' }));
    else if (first) parts.push(chip(this, x, under, rewardChip(first, m.claimed).icon, first.short, rewardChip(first, m.claimed).tone, { size: 's', bg: false }));
    if (m.claimed) {
      parts.forEach((o) => (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha?.(0.5));
      this.add.image(x + s / 2 - 12, y - s / 2 + 12, skinIcon('check')).setDisplaySize(40, 40).setTint(CHECK_TINT);
    }
    if (m.ready) {
      dot(this, x + s / 2 - 10, y - s / 2 + 10);
      if (juiceOn()) pulse(this, bg, 1.06, 700);
    }
    pressable(this, bg, s, s, () => this.claimChest(m, { x, y }));
  }

  /** Задание строкой списка: иконка по счётчику, название, прогресс и очки; справа — «Забрать», «Перейти», галка или замок. */
  private taskRow(t: NewbieTaskView, y: number, open: boolean): void {
    const a = this.area!;
    const scene = this;
    const progress = `${Math.min(t.progress, t.target).toLocaleString('ru-RU')} / ${t.target.toLocaleString('ru-RU')}  ·  +${t.points} очков`;
    let trailing: Phaser.GameObjects.Container | Phaser.GameObjects.Image | string | undefined;
    let onTap: (() => void) | undefined;
    if (t.ready) {
      trailing = tag(scene, 0, 0, 'Забрать', 'accent', { solid: true });
      onTap = a.tap(() => this.claimTask(t));
    } else if (t.claimed) {
      trailing = scene.add.image(0, 0, skinIcon('check')).setDisplaySize(52, 52).setTint(CHECK_TINT);
    } else if (t.locked) {
      trailing = scene.add.image(0, 0, skinIcon('lock')).setDisplaySize(44, 44).setTint(COLOR_N.textTertiary);
    } else if (open) {
      // «Перейти» — вся строка; справа — шеврон цвета акцента.
      trailing = scene.add.image(0, 0, skinIcon('next')).setDisplaySize(44, 44).setTint(COLOR_N.accent);
      const to = taskDestination(t.counter);
      onTap = a.tap(() => this.scene.start(to));
    }
    const row = listRow(scene, GAME_W / 2, y, EV_L.w, {
      icon: taskIcon(t.counter),
      title: t.name,
      subtitle: progress,
      trailing,
      raised: t.ready,
      dim: t.claimed || t.locked,
      h: EV_L.rowH,
      onTap,
    });
    row.setName(`nbTask_${t.id}`);
    a.add(row);
    // Тонкая полоса прогресса по низу строки (в процессе).
    if (!t.claimed && !t.locked && !t.ready && t.progress > 0) {
      a.add(progressBar(scene, S.l + S.s + 104 + S.s, y + EV_L.rowH / 2 - 14, 360, 10, t.progress / t.target, COLOR_N.positive, { key: `nb:${t.id}` }));
    }
  }

  private claimTask(t: NewbieTaskView): void {
    try {
      const r = claimNewbieTask(session.save, today(), t.id, GAME);
      commit(r.save);
      this.restartWithToast(`+${r.points} очков`, { tab: 'newbie', day: this.day }, false);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claimChest(m: NewbieMilestoneView, at: Point): void {
    if (m.claimed) return toast(this, 'Эта награда уже получена');
    if (!m.reached) return toast(this, `${m.points} очков: ${rewardText(m.rewards)}`);
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = claimNewbieMilestone(session.save, today(), m.points, GAME);
      commit(r.save);
      queueRewardFly('Events', at, before, { burst: true });
      if (this.toContract(rewardToast(`${m.points} очков`, r.rewards, r.events), r.events, { tab: 'newbie', day: this.day })) return;
      this.restartWithToast(rewardToast(`${m.points} очков`, r.rewards, r.events), { tab: 'newbie', day: this.day });
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
    this.events.once(Phaser.Scenes.Events.CREATE, () => (fly ? afterRewardFly(this, () => toast(this, message, C.success, 4500)) : toast(this, message, C.success, 2500)));
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
