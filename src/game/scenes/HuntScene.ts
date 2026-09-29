import Phaser from 'phaser';
import { oreIcon } from '../itemIcons';
import { huntStatus, sweepHunt, type HuntOutcome, type HuntReward, type HuntStatus } from '../../core';
import { GAME } from '../content';
import { formatNumber, RARITY_NAMES } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, CONTENT_TOP, gemIcon, popIn, screen, unitFigure, unitTint } from '../screen';
import { commit, session, today } from '../session';
import { button, progressBar, text, toast } from '../ui';
import { ctaShine, glow, ribbon, slowRays } from '../decor';
import { SKIN, SKIN_TINT, skinIcon } from '../skin';
import { C, FS, OUTLINE, TITLE_STYLE } from '../theme';
import { lockedScreen } from '../unlockBanner';
import { collect, staggerIn } from '../juice';

/** Данные экрана: после боя (BattleScene) или «Зачистки» — итог попытки поверх экрана. */
export interface HuntSceneData {
  outcome?: HuntOutcome;
}

/**
 * Награда порога: «золото 450 · опыт 100 · гемы 2 · карта героя 3% · предмет (редкий)». lines — редкие награды
 * (карта, предмет) второй строкой: так строка порога не переносится посреди слов и шрифт не мельчает.
 */
export function huntRewardText(r: HuntReward, lines = false): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`золото ${formatNumber(r.gold)}`);
  if (r.jobExp) parts.push(`опыт ${formatNumber(r.jobExp)}`);
  if (r.gems) parts.push(`гемы ${r.gems}`);
  const extra: string[] = [];
  const cards = (r.heroCards?.blue ?? 0) + (r.heroCards?.purple ?? 0);
  if (cards > 0) extra.push(`карта героя ${Math.round(cards * 100)}%`);
  if (r.item) extra.push(`предмет (${RARITY_NAMES[r.item].toLowerCase()})`);
  if (lines && parts.length && extra.length) return `${parts.join(' · ')}\n${extra.join(' · ')}`;
  return [...parts, ...extra].join(' · ') || '—';
}

/** Строка порога: двухстрочные награды (карта героя, предмет) не касаются соседних (MT-14). Порогов много — ниже (до ROW_MIN). */
const ROW_H = 78;
const ROW_MIN = 66;
/** Шапка карточки порогов: лента, шкала, номера под шкалой. */
const TIERS_HEAD = 160;
/** Строка «Попыток сегодня» и кнопки внизу: карточка порогов кончается выше. */
const FOOTER_Y = GAME_H - 170 - 120;
const TIERS_BOTTOM = FOOTER_Y - 110 - 40;

/**
 * «Охота на босса» (аналог гильдейской охоты AFK Arena): босс дня, пороги урона с наградами и отметкой лучшего
 * результата, попытки на сегодня, «Зачистка» (повтор лучшего результата без боя) и «В бой» (BattleScene, режим hunt).
 */
export class HuntScene extends Phaser.Scene {
  constructor() {
    super('Hunt');
  }

  create(data: HuntSceneData = {}): void {
    screen(this, 'Охота на босса', 'Adventure', { to: 'Adventure' });
    const st = huntStatus(session.save, today(), GAME);
    if (!st.unlocked) {
      lockedScreen(this, 'hunt');
      return;
    }
    const top = CONTENT_TOP;
    const groups: Phaser.GameObjects.GameObject[][] = [];
    groups.push(collect(this.children, () => this.bossCard(st, top)));
    groups.push(collect(this.children, () => this.tiers(st, top + 420)));
    groups.push(collect(this.children, () => this.footer(st)));
    staggerIn(this, 'Hunt', groups);
    if (data.outcome) this.showOutcome(data.outcome);
  }

  /** Босс дня: фигура в ореоле, имя, подпись, мощь, лучший урон. */
  private bossCard(st: HuntStatus, top: number): void {
    const def = st.boss.def;
    card(this, GAME_W / 2, top + 200, 1040, 400);
    const fx = 290;
    glow(this, fx, top + 210, 360, 0xd64545, 0.3, true);
    slowRays(this, fx, top + 210, 400, 0.18, 0xffb070);
    unitFigure(this, def.visual.sprite, fx, top + 365, 280, {
      maxScale: 2,
      onReady: (o) => o.setTint(unitTint(def.visual)),
    });
    const tx = 540;
    text(this, tx, top + 60, 'Босс дня', FS.small, C.muted).setOrigin(0, 0.5);
    // Уровня у босса охоты нет: его здоровье — запас на урон (×180–200), «ур. 140» только пугал бы. Цель — порог урона.
    text(this, tx, top + 115, def.name, FS.h1, C.title, TITLE_STYLE).setOrigin(0, 0.5);
    if (st.boss.title) text(this, tx, top + 170, st.boss.title, FS.small, SKIN.cream, { ...OUTLINE, wordWrap: { width: 470 }, align: 'left' }).setOrigin(0, 0.5);
    text(this, tx, top + 225, `Здоровье ${formatNumber(def.stats.hp)}`, FS.body, C.danger, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5);
    text(this, tx, top + 275, `Бой ${GAME.hunt.timeLimitSeconds} с · награда по урону`, FS.small, C.muted).setOrigin(0, 0.5);
    text(this, tx, top + 330, st.best > 0 ? `Лучший урон: ${formatNumber(st.best)}` : 'Ещё не бились', FS.h3, st.best > 0 ? C.gold : C.dim, {
      fontStyle: 'bold',
      stroke: C.stroke,
      strokeThickness: 5,
    }).setOrigin(0, 0.5);
  }

  /** Пороги урона: полоса лучшего результата с отметками порогов и список наград. */
  private tiers(st: HuntStatus, top: number): void {
    // MT-14: номера порогов — под шкалой (над ней их закрывала лента «Награда за урон»).
    const n = Math.max(1, st.tiers.length);
    const rowH = Phaser.Math.Clamp(Math.floor((TIERS_BOTTOM - top - TIERS_HEAD - 20) / n), ROW_MIN, ROW_H);
    const h = TIERS_HEAD + 20 + st.tiers.length * rowH;
    card(this, GAME_W / 2, top + h / 2, 1040, h);
    ribbon(this, GAME_W / 2, top + 40, 'Награда за урон', { size: FS.h3, minW: 420 });

    // Полоса: шкала по порогам (каждый порог — равный отрезок), заливка — лучший урон.
    const bx = 90;
    const bw = GAME_W - 180;
    const by = top + 92;
    const pos = tierPosition(st.best, st.tiers.map((t) => t.damage));
    progressBar(this, bx, by, bw, 26, pos, 0xd6a645, { key: 'hunt_best' });
    st.tiers.forEach((_, i) => {
      const x = bx + (bw * (i + 1)) / st.tiers.length;
      const reached = i <= st.bestTier;
      this.add.rectangle(x, by, 4, 34, reached ? 0xffe08a : 0x6a5a40);
      text(this, x - 2, by + 36, `${i + 1}`, FS.caption, reached ? SKIN.goldLight : C.dim, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 });
    });

    st.tiers.forEach((t, i) => {
      const y = top + TIERS_HEAD + rowH / 2 + i * rowH;
      const reached = i <= st.bestTier;
      const current = i === st.bestTier;
      if (current) this.add.rectangle(GAME_W / 2, y, 1000, rowH - 6, 0xd6a645, 0.18).setStrokeStyle(3, SKIN_TINT.gold, 0.8);
      text(this, 90, y, `${i + 1}`, FS.h3, reached ? SKIN.goldLight : C.dim, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
      text(this, 140, y, formatNumber(t.damage), FS.body, reached ? C.gold : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5);
      // Редкие награды — второй строкой (не перенос посреди слов); не влезает по ширине — «…».
      const rw = text(this, 330, y, huntRewardText(t.rewards, true), FS.caption - 2, reached ? SKIN.cream : C.muted, { ...OUTLINE, align: 'left', lineSpacing: -6 }).setOrigin(0, 0.5);
      if (rw.width > 640) rw.setScale(640 / rw.width);
      if (reached) this.add.image(GAME_W - 80, y, skinIcon('check')).setDisplaySize(36, 36).setTint(0x9fe0a6);
    });
  }

  /** Попытки, «Зачистка», «В бой». */
  private footer(st: HuntStatus): void {
    const y = FOOTER_Y;
    // MT-14: руда в итогах была сюрпризом — первая попытка дня (бой или зачистка) даёт ещё Благословенную руду.
    const ore = st.attemptsLeft === st.attemptsPerDay ? ' · первая даёт руду' : '';
    text(this, GAME_W / 2, y - 110, st.attemptsLeft > 0 ? `Попыток сегодня: ${st.attemptsLeft} из ${st.attemptsPerDay}${ore}` : 'Попытки кончились — новый босс завтра', FS.h3, st.attemptsLeft > 0 ? C.text : C.muted, {
      fontStyle: 'bold',
      stroke: C.stroke,
      strokeThickness: 5,
    });
    const sweep = button(this, 270, y, 440, 140, 'ui_btn_secondary', 'Зачистка', () => this.sweep(), FS.h2);
    sweep.setEnabled(st.canSweep);
    if (GAME.hunt.sweep && st.best > 0) text(this, 270, y + 92, 'повтор лучшего боя', FS.caption, C.muted);
    const go = button(this, 790, y, 440, 140, st.attemptsLeft > 0 ? 'ui_btn_primary' : 'ui_btn_secondary', 'В бой', () => this.fight(), FS.hero);
    go.setEnabled(st.attemptsLeft > 0);
    go.label.setX(30);
    go.container.add(this.add.image(30 - go.label.width / 2 - 48, -4, skinIcon('swords')).setDisplaySize(62, 62).setTint(0x3a2408));
    if (st.attemptsLeft > 0) ctaShine(this, go.container, 440, 140);
  }

  private fight(): void {
    if (!session.save.squad.some(Boolean)) {
      this.scene.start('Squad', { back: { to: 'Hunt' } });
      return;
    }
    this.scene.start('Battle', { mode: 'hunt' });
  }

  private sweep(): void {
    try {
      const out = sweepHunt(session.save, today(), GAME);
      commit(out.save);
      this.scene.restart({ outcome: out } satisfies HuntSceneData);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Итог попытки поверх экрана: урон, порог, рекорд, полученные награды. */
  private showOutcome(out: HuntOutcome): void {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const layer = this.add.container(0, 0).setDepth(8000).setName('huntOutcome');
    const shade = this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x000000, 0.72).setInteractive();
    const box = card(this, cx, cy, 900, 860).setInteractive();
    layer.add([shade, box]);
    layer.add(ribbon(this, cx, cy - 390, out.sweep ? 'Зачистка' : 'Охота окончена', { size: FS.h2, minW: 480 }));
    layer.add(text(this, cx, cy - 280, 'Урон по боссу', FS.body, C.muted));
    layer.add(text(this, cx, cy - 195, formatNumber(out.damage), 104, SKIN.goldLight, { fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 12 }));
    const tierLine = out.tier >= 0 ? `Порог ${out.tier + 1} из ${GAME.hunt.tiers.length}` : 'Порог не взят — награды нет';
    layer.add(text(this, cx, cy - 100, tierLine, FS.h3, out.tier >= 0 ? C.success : C.danger, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }));
    if (out.record) layer.add(text(this, cx, cy - 45, 'Новый рекорд!', FS.body, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }));

    const g = out.grant;
    const lines: string[] = [];
    if (g.gold || g.jobExp) lines.push(`Золото +${formatNumber(g.gold)} · опыт +${formatNumber(g.jobExp)} в запас`);
    for (const e of g.heroCards) if (e.type === 'heroCard') lines.push(`Карта героя: ${e.name}`);
    for (const it of g.items) lines.push(`Предмет: ${GAME.equipment.items[it.itemId]?.name ?? it.itemId}`);
    let y = cy + 30;
    for (const l of lines) {
      layer.add(text(this, cx, y, l, FS.body, SKIN.cream, { ...OUTLINE, wordWrap: { width: 820 } }));
      y += 60;
    }
    if (g.ore) {
      // Первая атака дня со взятым порогом — «Благословенная руда» (1–3).
      const t = text(this, cx + 20, y, `Благословенная руда ×${g.ore}`, FS.body, '#bfe9ff', { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setName('huntOre');
      layer.add([t, oreIcon(this, t.x - t.width / 2 - 34, y, 52)]);
      y += 60;
    }
    if (g.gems) {
      const t = text(this, cx - 20, y, `Гемы +${g.gems}`, FS.body, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
      layer.add([t, gemIcon(this, t.x + t.width / 2 + 26, y, 34)]);
    }
    const ok = button(this, cx, cy + 330, 440, 130, 'ui_btn_primary', 'Отлично', () => layer.destroy(), FS.h2);
    layer.add(ok.container);
    popIn(this, layer, shade);
  }
}

/** Положение урона на шкале из равных отрезков между порогами (0…1). */
export function tierPosition(damage: number, thresholds: readonly number[]): number {
  const n = thresholds.length;
  if (!n || damage <= 0) return 0;
  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? 0 : thresholds[i - 1];
    const hi = thresholds[i];
    if (damage < hi) return (i + (damage - lo) / (hi - lo)) / n;
  }
  return 1;
}
