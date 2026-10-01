import Phaser from 'phaser';
import { oreIcon } from '../itemIcons';
import { huntBoss, huntStatus, sweepHunt, type HuntOutcome, type HuntReward, type HuntStatus } from '../../core';
import { ELEMENT_NAMES, type Element } from '../../core/elements';
import { elementBadge } from '../battleElements';
import { GAME } from '../content';
import { formatNumber, RARITY_NAMES } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, CONTENT_TOP, gemIcon, popIn, screen, unitFigure, unitTint } from '../screen';
import { commit, session, today } from '../session';
import { button, ellipsize, progressBar, text, toast } from '../ui';
import { ctaShine, glow, ribbon, slowRays } from '../decor';
import { SKIN, skinIcon } from '../skin';
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

/** «святость, огонь». */
const elementList = (els: readonly Element[]): string => els.map((e) => ELEMENT_NAMES[e]).join(', ');

/** Строка «Попыток сегодня» и кнопки внизу. */
const FOOTER_Y = GAME_H - 170 - 120;
/** Карточка MVP, подсказка состава, награда — сверху вниз. */
const MVP_H = 610;
const HINT_H = 150;
const GAP = 20;

/** Выбранный уровень MVP (между заходами на экран; выше доступного — сбрасывается). */
let pickedRank: number | null = null;

/**
 * «Охота на MVP» (docs/design/mvp-hunt.md; как MVP в Ragnarok Online + гильдейская охота AFK Arena): MVP дня — имя,
 * легенда, стихия и слабость, механики строкой каждая, подсказка «кого взять» по стихиям героев игрока, уровень MVP
 * (◀ ▶ — ниже ради карты), награда за победу, карта MVP, лучший результат; «Зачистка» и «В бой» (BattleScene, режим hunt,
 * ульта вручную). Без hunt.mvp — та же карточка босса без стихий и уровней.
 */
export class HuntScene extends Phaser.Scene {
  constructor() {
    super('Hunt');
  }

  create(data: HuntSceneData = {}): void {
    screen(this, 'Охота на MVP', 'Adventure', { to: 'Adventure' });
    const st = huntStatus(session.save, today(), GAME);
    if (!st.unlocked) {
      lockedScreen(this, 'hunt');
      return;
    }
    if (pickedRank === null || pickedRank > st.rank) pickedRank = st.rank;
    const top = CONTENT_TOP;
    const groups: Phaser.GameObjects.GameObject[][] = [];
    groups.push(collect(this.children, () => this.mvpCard(st, top)));
    groups.push(collect(this.children, () => this.squadHint(st, top + MVP_H + GAP)));
    groups.push(collect(this.children, () => this.rewards(st, top + MVP_H + HINT_H + 2 * GAP)));
    groups.push(collect(this.children, () => this.footer(st)));
    staggerIn(this, 'Hunt', groups);
    if (data.outcome) this.showOutcome(data.outcome);
  }

  /** MVP дня: фигура в ореоле, имя, подпись, стихия и слабость, легенда, механики. */
  private mvpCard(st: HuntStatus, top: number): void {
    const boss = st.boss;
    const def = boss.def;
    card(this, GAME_W / 2, top + MVP_H / 2, 1040, MVP_H);
    const fx = 230;
    glow(this, fx, top + 215, 340, 0xd64545, 0.3, true);
    slowRays(this, fx, top + 215, 380, 0.18, 0xffb070);
    unitFigure(this, def.visual.sprite, fx, top + 370, 290, {
      maxScale: 2,
      onReady: (o) => o.setTint(unitTint(def.visual)),
    });
    const tx = 440;
    const tw = 1040 - tx;
    text(this, tx, top + 50, st.mvp ? `MVP дня · побед: ${st.kills}` : 'Босс дня', FS.small, C.muted).setOrigin(0, 0.5).setName('huntKills');
    const name = text(this, tx, top + 105, def.name, FS.h1, C.title, TITLE_STYLE).setOrigin(0, 0.5).setName('huntName');
    ellipsize(name, tw);
    if (boss.title) ellipsize(text(this, tx, top + 158, boss.title, FS.small, SKIN.cream, OUTLINE).setOrigin(0, 0.5), tw);
    if (boss.element !== 'neutral') {
      elementBadge(this, tx + 22, top + 215, boss.element, 40);
      text(this, tx + 56, top + 215, `Стихия: ${ELEMENT_NAMES[boss.element]}`, FS.body, C.text, OUTLINE).setOrigin(0, 0.5);
    }
    if (boss.weakTo.length) {
      boss.weakTo.forEach((el, i) => elementBadge(this, tx + 22 + i * 46, top + 270, el, 40));
      const x = tx + 22 + boss.weakTo.length * 46 - 12;
      ellipsize(
        text(this, x, top + 270, `Слабость: ${elementList(boss.weakTo)}`, FS.body, C.positive, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5).setName('huntWeak'),
        1040 - x,
      );
    }
    if (boss.legend) {
      text(this, tx, top + 305, boss.legend, FS.caption - 2, SKIN.cream, { ...OUTLINE, wordWrap: { width: tw }, align: 'left', lineSpacing: -4 }).setOrigin(0, 0).setName('huntLegend');
    }
    // Механики — строкой каждая, во всю ширину под фигурой.
    const my = top + 455;
    this.add.rectangle(GAME_W / 2, my - 22, 980, 3, 0x8a6a3a, 0.6);
    boss.mechanics.forEach((m, i) => {
      const t = text(this, 70, my + 10 + i * 38, `• ${m}`, FS.caption - 2, C.text, OUTLINE).setOrigin(0, 0.5).setName(`huntMech${i}`);
      ellipsize(t, 960);
    });
  }

  /** Подсказка состава: герои игрока нужной стихии (в отряде / нет) и кнопка «Отряд». */
  private squadHint(st: HuntStatus, top: number): void {
    card(this, GAME_W / 2, top + HINT_H / 2, 1040, HINT_H);
    const boss = st.boss;
    if (!st.mvp || !boss.weakTo.length) {
      text(this, 60, top + HINT_H / 2, 'Соберите сильный отряд: босс бьёт больно.', FS.body, C.text, OUTLINE).setOrigin(0, 0.5);
    } else {
      const inSquad = st.heroes.filter((h) => h.inSquad);
      const out = st.heroes.filter((h) => !h.inSquad);
      const mvp = GAME.hunt.mvp;
      const head = mvp ? `Стихия слабости: АТК ×${1 + mvp.weaknessAtk}${mvp.armorAtk ? `, прочим −${Math.round(mvp.armorAtk * 100)}%` : ''}` : 'Стихия слабости бьёт сильнее';
      ellipsize(text(this, 60, top + 48, head, FS.body, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5).setName('huntHintHead'), 700);
      const line = !st.heroes.length
        ? 'У вас нет героя этой стихии — MVP будет тяжелее'
        : [inSquad.length ? `в отряде: ${inSquad.map((h) => h.name).join(', ')}` : '', out.length ? `можно взять: ${out.map((h) => h.name).join(', ')}` : '']
            .filter(Boolean)
            .join(' · ');
      const color = !st.heroes.length ? C.danger : inSquad.length ? C.positive : C.warning;
      ellipsize(text(this, 60, top + 102, line, FS.caption - 2, color, OUTLINE).setOrigin(0, 0.5).setName('huntHintLine'), 700);
    }
    button(this, 900, top + HINT_H / 2, 230, 100, 'ui_btn_secondary', 'Отряд', () => this.scene.start('Squad', { back: { to: 'Hunt' } }), FS.h3);
  }

  /** Уровень MVP (◀ ▶), награда за победу, карта MVP, лучший результат и шкала порогов. */
  private rewards(st: HuntStatus, top: number): void {
    const h = FOOTER_Y - 150 - top;
    card(this, GAME_W / 2, top + h / 2, 1040, h);
    ribbon(this, GAME_W / 2, top + 36, st.mvp ? 'Уровень и награда' : 'Награда за урон', { size: FS.h3, minW: 420 });
    const rank = st.mvp ? (pickedRank ?? st.rank) : 0;
    let y = top + 115;
    if (st.mvp) {
      const boss = huntBoss(today(), GAME, rank);
      const left = button(this, 110, y, 110, 90, 'ui_btn_secondary', '◀', () => this.pick(rank - 1, st), FS.h2);
      left.setEnabled(rank > 0);
      const right = button(this, 970, y, 110, 90, 'ui_btn_secondary', '▶', () => this.pick(rank + 1, st), FS.h2);
      right.setEnabled(rank < st.rank);
      text(this, GAME_W / 2, y - 18, `Уровень ${rank + 1} из ${st.ranks}${rank < st.rank ? ' (ниже вашего)' : ''}`, FS.h3, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setName('huntRank');
      text(this, GAME_W / 2, y + 26, `Здоровье ${formatNumber(boss.def.stats.hp)} · бой ${GAME.hunt.timeLimitSeconds} с`, FS.caption - 2, C.muted, OUTLINE);
      y += 90;
      const tier = Math.min(rank, st.tiers.length - 1);
      text(this, 60, y, `Победа — порог ${tier + 1}:`, FS.small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5);
      const rw = text(this, 60, y + 44, huntRewardText(st.tiers[tier].rewards), FS.caption - 2, SKIN.cream, OUTLINE).setOrigin(0, 0.5).setName('huntReward');
      if (rw.width > 960) rw.setScale(960 / rw.width);
      y += 100;
      const cardDef = st.boss.card;
      if (cardDef && GAME.hunt.mvp) {
        const pity = Math.max(1, GAME.hunt.mvp.cardPity - (session.save.hunt?.dry ?? 0));
        const chance = `${cardDef.name}: шанс ${Math.round(GAME.hunt.mvp.cardChance * 100)}%, точно — через ${pity} ${pity === 1 ? 'победу' : pity < 5 ? 'победы' : 'побед'}`;
        ellipsize(text(this, 60, y, chance, FS.small, '#d8b4ff', { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5).setName('huntCard'), 960);
        ellipsize(text(this, 60, y + 42, `${cardDef.text} Вставляется в снаряжение.`, FS.caption - 2, C.muted, OUTLINE).setOrigin(0, 0.5), 960);
        y += 100;
      }
    }
    // Шкала порогов: заливка — лучший результат по этому MVP.
    const bx = 90;
    const bw = GAME_W - 180;
    const by = Math.min(y + 10, top + h - 90);
    progressBar(this, bx, by, bw, 22, tierPosition(st.best, st.tiers.map((t) => t.damage)), 0xd6a645, { key: 'hunt_best' });
    st.tiers.forEach((_, i) => {
      const x = bx + (bw * (i + 1)) / st.tiers.length;
      const reached = i <= st.bestTier;
      this.add.rectangle(x, by, 4, 30, reached ? 0xffe08a : 0x6a5a40);
    });
    const best = st.best > 0 ? `Лучший результат: ${formatNumber(st.best)} · порог ${st.bestTier + 1} из ${st.tiers.length}` : 'Ещё не бились — первый бой покажет силу отряда';
    text(this, GAME_W / 2, by + 48, best, FS.small, st.best > 0 ? C.gold : C.dim, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setName('huntBest');
  }

  private pick(rank: number, st: HuntStatus): void {
    pickedRank = Math.max(0, Math.min(st.rank, rank));
    this.scene.restart({});
  }

  /** Попытки, «Зачистка», «В бой». */
  private footer(st: HuntStatus): void {
    const y = FOOTER_Y;
    // MT-14: руда в итогах была сюрпризом — первая попытка дня (бой или зачистка) даёт ещё Благословенную руду.
    const ore = st.attemptsLeft === st.attemptsPerDay ? ' · первая даёт руду' : '';
    text(this, GAME_W / 2, y - 110, st.attemptsLeft > 0 ? `Попыток сегодня: ${st.attemptsLeft} из ${st.attemptsPerDay}${ore}` : 'Попытки кончились — новый MVP завтра', FS.h3, st.attemptsLeft > 0 ? C.text : C.muted, {
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
    this.scene.start('Battle', { mode: 'hunt', ...(pickedRank !== null ? { rank: pickedRank } : {}) });
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

  /** Итог попытки поверх экрана: «MVP!» или урон, порог, рекорд, полученные награды, карта MVP. */
  private showOutcome(out: HuntOutcome): void {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const layer = this.add.container(0, 0).setDepth(8000).setName('huntOutcome');
    const shade = this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x000000, 0.72).setInteractive();
    const box = card(this, cx, cy, 900, 960).setInteractive();
    layer.add([shade, box]);
    const head = out.sweep ? 'Зачистка' : out.killed ? 'MVP!' : 'Охота окончена';
    layer.add(ribbon(this, cx, cy - 440, head, { size: out.killed ? FS.h1 : FS.h2, minW: 480 }));
    if (out.killed) {
      layer.add(text(this, cx, cy - 340, `${out.boss.def.name} повержен!`, FS.h2, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setName('huntOutKilled'));
    } else {
      layer.add(text(this, cx, cy - 340, out.boss.rank !== undefined ? 'Урон по MVP' : 'Урон по боссу', FS.body, C.muted));
    }
    layer.add(text(this, cx, cy - 255, formatNumber(out.damage), 96, SKIN.goldLight, { fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 12 }));
    const tierLine = out.tier >= 0 ? `Порог ${out.tier + 1} из ${GAME.hunt.tiers.length}` : 'Порог не взят — награды нет';
    layer.add(text(this, cx, cy - 165, tierLine, FS.h3, out.tier >= 0 ? C.success : C.danger, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }));
    let y = cy - 110;
    if (out.rankUp) {
      const lvl = out.save.hunt?.level;
      layer.add(text(this, cx, y, lvl !== undefined ? `Новый уровень MVP: ${lvl + 1}` : 'Новый уровень MVP!', FS.body, C.positive, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setName('huntRankUp'));
      y += 55;
    } else if (out.record) {
      layer.add(text(this, cx, y, 'Новый рекорд!', FS.body, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }));
      y += 55;
    }
    if (out.grant.card) {
      const cd = GAME.hunt.cards.find((c) => c.id === out.grant.card);
      layer.add(text(this, cx, y + 10, `${cd?.name ?? out.grant.card}!`, FS.h2, '#d8b4ff', { fontStyle: 'bold', stroke: '#2a0a3a', strokeThickness: 7 }).setName('huntOutCard'));
      if (cd) layer.add(text(this, cx, y + 62, `${cd.text} Вставьте в снаряжение: Герои → вещь.`, FS.caption - 2, SKIN.cream, { ...OUTLINE, wordWrap: { width: 820 } }));
      y += 130;
    }
    const g = out.grant;
    const lines: string[] = [];
    if (g.gold || g.jobExp) lines.push(`Золото +${formatNumber(g.gold)} · опыт +${formatNumber(g.jobExp)} в запас`);
    for (const e of g.heroCards) if (e.type === 'heroCard') lines.push(`Карта героя: ${e.name}`);
    for (const it of g.items) lines.push(`Предмет: ${GAME.equipment.items[it.itemId]?.name ?? it.itemId}`);
    y += 20;
    for (const l of lines) {
      layer.add(text(this, cx, y, l, FS.body, SKIN.cream, { ...OUTLINE, wordWrap: { width: 820 } }));
      y += 56;
    }
    if (g.ore) {
      // Первая атака дня со взятым порогом — «Благословенная руда» (1–3).
      const t = text(this, cx + 20, y, `Благословенная руда ×${g.ore}`, FS.body, '#bfe9ff', { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setName('huntOre');
      layer.add([t, oreIcon(this, t.x - t.width / 2 - 34, y, 52)]);
      y += 56;
    }
    if (g.gems) {
      const t = text(this, cx - 20, y, `Гемы +${g.gems}`, FS.body, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
      layer.add([t, gemIcon(this, t.x + t.width / 2 + 26, y, 34)]);
    }
    const ok = button(this, cx, cy + 385, 440, 130, 'ui_btn_primary', 'Отлично', () => layer.destroy(), FS.h2);
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
