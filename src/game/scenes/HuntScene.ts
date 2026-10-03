import Phaser from 'phaser';
import { oreIcon, roIcon } from '../itemIcons';
import { huntBoss, huntStatus, sweepHunt, type HuntOutcome, type HuntReward, type HuntStatus } from '../../core';
import { ELEMENT_NAMES, type Element } from '../../core/elements';
import { elementBadge, elementTitle } from '../battleElements';
import { GAME } from '../content';
import { formatNumber, heroSprite, RARITY_COLORS, RARITY_NAMES } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { bottomSheet, CONTENT_TOP, contentBottom, cta, popIn, portrait, screen, unitFigure, unitTint } from '../screen';
import { cardArtId, showCardArt } from '../cardArt';
import { commit, restartOnNewDay, session, today } from '../session';
import { BTN, button, chip, ellipsize, infoButton, plate, progressBar, rewardRow, SURFACE, tag, text, toast, type ChipSpec } from '../ui';
import { ctaShine, glow, ribbon, slowRays } from '../decor';
import { skinIcon } from '../skin';
import { portraitKey } from '../sprites';
import { C, COLOR, COLOR_N, FAMILY, R, S, T, Z } from '../theme';
import { lockedScreen } from '../unlockBanner';
import { plural } from '../skillFacts';
import { burst, collect, countUp, rewardFly, staggerIn } from '../juice';
import { firstTip } from '../firstTips';
import { heroCardIcon } from '../heroCard';
import { rewardIcon } from '../rewardsView';

/** Данные экрана: после боя (BattleScene) или «Зачистки» — итог попытки поверх экрана. */
export interface HuntSceneData {
  outcome?: HuntOutcome;
}

/**
 * Награда порога строкой: «золото 450 · опыт 100 · гемы 2 · карта героя 3% · предмет (редкий)» — для листа «i»
 * и сообщений; на экране — чипы (huntRewardChips).
 */
export function huntRewardText(r: HuntReward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`золото ${formatNumber(r.gold)}`);
  if (r.jobExp) parts.push(`опыт ${formatNumber(r.jobExp)}`);
  if (r.gems) parts.push(`гемы ${r.gems}`);
  const cards = (r.heroCards?.blue ?? 0) + (r.heroCards?.purple ?? 0);
  if (cards > 0) parts.push(`карта героя ${Math.round(cards * 100)}%`);
  if (r.item) parts.push(`предмет (${RARITY_NAMES[r.item].toLowerCase()})`);
  return parts.join(' · ') || '—';
}

/** Шанс строкой: 0.08 → «8%», 1 → «×1», 1.5 → «≈1.5». */
const chance = (x: number): string => (x >= 1 && Number.isInteger(x) ? `×${x}` : x >= 1 ? `≈${x}` : `${Math.round(x * 100)}%`);

/**
 * Награда порога чипами (§3 п. 4): золото, опыт, гемы, карта героя (шанс), предмет (иконка цвета редкости),
 * руда (первая попытка дня), карта MVP (шанс). Без Phaser-объектов — фабрики иконок, рисуются в rewardRow.
 */
export function huntRewardChips(r: HuntReward, extra: { ore?: boolean; mvpCard?: { id: string; chance: number } } = {}): ChipSpec[] {
  const out: ChipSpec[] = [];
  if (r.gold) out.push({ icon: 'gold', value: r.gold, tone: 'gold' });
  if (r.jobExp) out.push({ icon: 'hero_exp', value: r.jobExp });
  if (r.gems) out.push({ icon: 'gems', value: r.gems, tone: 'gem' });
  // Карты героя — одним чипом: шанс синей и фиолетовой вместе, значок — старшей из возможных.
  const blue = r.heroCards?.blue ?? 0;
  const purple = r.heroCards?.purple ?? 0;
  if (blue + purple > 0) {
    const rar = purple > 0 ? 'purple' : 'blue';
    out.push({ icon: (s, x, y, size) => heroCardIcon(s, x, y, size, rar), value: chance(blue + purple), tone: 'info' });
  }
  if (r.item) {
    const item = r.item;
    out.push({ icon: (s, x, y, size) => s.add.image(x, y, skinIcon('helmet')).setDisplaySize(size, size).setTint(Phaser.Display.Color.HexStringToColor(RARITY_COLORS[item]).color), value: '×1' });
  }
  if (extra.ore) out.push({ icon: (s, x, y, size) => oreIcon(s, x, y, size), value: '1–3', tone: 'info' });
  if (extra.mvpCard) {
    const id = extra.mvpCard.id;
    out.push({ icon: (s, x, y, size) => mvpCardIcon(s, x, y, size, id), value: chance(extra.mvpCard.chance), tone: 'accent' });
  }
  return out;
}

/** Иконка карты MVP: рисунок карты RO (догружается) в фиолетовой рамке; пока рисунка нет — рамка со звездой. */
function mvpCardIcon(scene: Phaser.Scene, x: number, y: number, size: number, id: string): Phaser.GameObjects.Container {
  const h = Math.round(size * 1.15);
  const w = Math.round(h * 0.72);
  const frame = scene.add.rectangle(0, 0, w, h, 0x1a0f22).setStrokeStyle(3, 0xb07ae0);
  const star = scene.add.image(0, 0, skinIcon('star')).setDisplaySize(size * 0.55, size * 0.55).setTint(0xd8b4ff);
  const box = scene.add.container(x, y, [frame, star]);
  if (cardArtId(id))
    showCardArt(scene, id, 0, 0, h - 6, (img) => {
      if (!box.scene) return img.destroy();
      star.setVisible(false);
      box.add(img);
    }, box);
  return box;
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

/** Засечки фаз MVP на полосе ОЗ (доли 0…1, по убыванию): фазы юнита с порогом здоровья. */
export function phasePips(phases: readonly { atHpPct?: number }[] | undefined): number[] {
  return (phases ?? [])
    .map((p) => p.atHpPct)
    .filter((p): p is number => p !== undefined && p > 0 && p < 1)
    .sort((a, b) => b - a);
}

/** Геометрия экрана (единицы поля 1080×1920). */
const L = {
  /** Баннер MVP: высота — от свободного места, в этих пределах. */
  bannerMin: 560,
  bannerMax: 760,
  /** Ряд «кого взять» под баннером. */
  squadH: 128,
  /** Блок уровня и награды. */
  levelH: 400,
  /** Главная кнопка: высота и отступ от низа области. */
  ctaH: BTN.cta,
} as const;
const W = GAME_W - 2 * S.l;
const LEFT = S.l;

/** null — следовать за верхним уровнем; число — намеренно выбранный фарм ниже него. */
let pickedRank: number | null = null;
let pickedSaveCreatedAt: number | undefined;

/** Новая игра и понижение уровня не должны оставлять недоступный выбор. */
function syncRankSelection(rank: number): void {
  if (pickedSaveCreatedAt !== session.save.createdAt) {
    pickedSaveCreatedAt = session.save.createdAt;
    pickedRank = null;
  }
  if (pickedRank !== null && pickedRank >= rank) pickedRank = null;
}

/**
 * «Охота на MVP» (docs/design/mvp-hunt.md; как MVP в Ragnarok Online + гильдейская охота AFK Arena). Экран в духе AFK:
 * MVP дня крупно на баннере (имя, стихия, слабость чипами, полоса ОЗ с засечками фаз), ряд «кого взять» — портреты
 * героев нужной стихии, уровень MVP (◀ ▶) и награда чипами, шкала порогов с лучшим результатом; внизу одна главная
 * «В бой» (попытки — чип на ней) и вторичная «Зачистка». Легенда, механики и правила — за «i» (лист снизу).
 */
export class HuntScene extends Phaser.Scene {
  constructor() {
    super('Hunt');
  }

  create(data: HuntSceneData = {}): void {
    // Итог попытки одноразовый: Phaser сохраняет старые данные при входе без data.
    this.sys.settings.data = {};
    restartOnNewDay(this);
    screen(this, 'Охота на MVP', 'Adventure', { to: 'Adventure' });
    const st = huntStatus(session.save, today(), GAME);
    syncRankSelection(st.rank);
    if (!st.unlocked) {
      lockedScreen(this, 'hunt');
      return;
    }
    // Раскладка сверху вниз по видимой области: баннер растёт на вытянутых экранах, кнопки — у низа.
    const bottom = contentBottom();
    const ctaY = bottom - S.xs - L.ctaH / 2;
    const top = CONTENT_TOP + S.xs;
    const restH = L.squadH + L.levelH + L.ctaH + S.xs + 3 * S.s + S.l;
    const bannerH = Phaser.Math.Clamp(bottom - top - restH, L.bannerMin, L.bannerMax);
    const gap = Math.max(S.s, (bottom - top - bannerH - L.squadH - L.levelH - L.ctaH - S.xs - S.l) / 3);
    const squadY = top + bannerH + gap;
    const levelY = squadY + L.squadH + gap;
    const groups: Phaser.GameObjects.GameObject[][] = [];
    groups.push(collect(this.children, () => this.banner(st, top, bannerH)));
    groups.push(collect(this.children, () => this.squadRow(st, squadY)));
    groups.push(collect(this.children, () => this.levelBlock(st, levelY)));
    groups.push(collect(this.children, () => this.footer(st, ctaY)));
    staggerIn(this, 'Hunt', groups);
    if (data.outcome) this.showOutcome(data.outcome);
    // Первый вход: Гаррет о MVP дня (firstTips.ts, один раз) — над кнопками, placeBand обходит данные.
    else firstTip(this, 'tip_hunt', ctaY - L.ctaH / 2 - 260);
  }

  /** Баннер MVP: багровый ореол и фигура справа, имя и стихия слева сверху, слабость и полоса ОЗ с фазами снизу. */
  private banner(st: HuntStatus, top: number, h: number): void {
    const boss = st.boss;
    const def = boss.def;
    const shape = this.make.graphics({}, false);
    shape.fillStyle(0xffffff, 1).fillRoundedRect(LEFT, top, W, h, R.l);
    const mask = shape.createGeometryMask();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => shape.destroy());
    const clip = <G extends Phaser.GameObjects.Components.Mask>(g: G): G => g.setMask(mask);
    clip(this.add.graphics().fillGradientStyle(0x4a1712, 0x4a1712, 0x120605, 0x120605, 1).fillRect(LEFT, top, W, h));
    const fx = LEFT + W * 0.66;
    const feet = top + h - 150;
    const fh = h * 0.62;
    clip(slowRays(this, fx, feet - fh * 0.5, h * 1.4, 0.2, 0xffb070));
    clip(glow(this, fx, feet - fh * 0.45, fh * 1.3, 0xd64545, 0.35, true));
    clip(this.add.ellipse(fx, feet, fh * 0.7, 44, 0x000000, 0.45));
    // Тень для текста: тёмный левый край и низ — имя и чипы читаются на любом MVP.
    const shade = clip(this.add.graphics().fillGradientStyle(0, 0, 0, 0, 0.55, 0, 0.92, 0.35).fillRect(LEFT, top, W, h));
    unitFigure(this, def.visual.sprite, fx, feet, fh, {
      maxScale: 2.2,
      onReady: (o) => {
        if (!shade.scene || o.scene !== this) return void o.destroy();
        clip(o).setTint(unitTint(def.visual));
        this.children.moveBelow(o, shade);
      },
    });
    plate(this, GAME_W / 2, top + h / 2, W, h, { fill: COLOR.bg, alpha: 0, border: COLOR.border, borderW: 4, r: R.l, hl: 0.18 }).setName('huntBanner');

    const tx = LEFT + S.l;
    const ty = top + S.l;
    if (st.mvp) tag(this, tx, ty + 6, st.kills > 0 ? `MVP дня · побед ${st.kills}` : 'MVP дня', 'accent', { align: 'left' }).setName('huntKills');
    const name = text(this, tx, ty + 44, def.name, T.display, COLOR.title, {
      fontFamily: FAMILY.heading,
      fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: 3, color: '#000000', blur: 8, fill: true },
    }).setOrigin(0, 0).setName('huntName');
    if (name.width > W - 2 * S.l - 80) name.setFontSize(T.title);
    ellipsize(name, W - 2 * S.l - 80);
    let below = name.y + name.height;
    if (boss.title) {
      const sub = text(this, tx, below + S.xxs, boss.title, T.caption, COLOR.textSecondary).setOrigin(0, 0);
      sub.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
      ellipsize(sub, W * 0.55);
      below = sub.y + sub.height;
    }
    // Стихия MVP — значок и название (чип), справа сверху — «i».
    if (boss.element !== 'neutral') {
      chip(this, tx, below + S.s + 28, (s, x, y, size) => elementBadge(s, x, y, boss.element, size), elementTitle(boss.element), 'neutral', { size: 's', align: 'left' }).setName('huntElement');
    }
    infoButton(this, LEFT + W - S.l, ty + 6, () => this.rules(st)).setName('huntInfo');

    // Низ баннера: слабость чипами (зелёным) и полоса ОЗ MVP с засечками фаз.
    const barY = top + h - S.l;
    const weakY = barY - 72;
    if (boss.weakTo.length) {
      let x = tx;
      const lbl = text(this, x, weakY, 'Слабость', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
      lbl.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
      x += lbl.width + S.xs;
      boss.weakTo.forEach((el, i) => {
        const c = chip(this, x, weakY, (s, cx, cy, size) => elementBadge(s, cx, cy, el, size), elementTitle(el), 'positive', { size: 's', align: 'left' }).setName(i === 0 ? 'huntWeak' : `huntWeak${i}`);
        x += c.width + S.xxs;
      });
    }
    const hpW = W - 2 * S.l;
    const hpX = tx;
    const hp = text(this, LEFT + W - S.l, weakY, formatNumber(def.stats.hp), T.caption, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(1, 0.5).setName('huntHp');
    hp.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
    this.add.rectangle(hpX + hpW / 2, barY, hpW + 6, 22, 0x000000, 0.75).setStrokeStyle(2, COLOR_N.border, 1);
    this.add.rectangle(hpX, barY, hpW, 14, 0xc23a2a).setOrigin(0, 0.5);
    this.add.rectangle(hpX, barY - 3, hpW, 4, 0xffffff, 0.18).setOrigin(0, 0.5);
    for (const p of phasePips(def.phases)) {
      this.add.rectangle(hpX + hpW * p, barY, 22, 22, COLOR_N.gold).setAngle(45).setStrokeStyle(3, 0x1a0f04, 1).setName('huntPhase');
    }
  }

  /** «Кого взять»: портреты героев нужной стихии (в отряде — галка), справа — «Отряд». */
  private squadRow(st: HuntStatus, top: number): void {
    const h = L.squadH;
    const cy = top + h / 2;
    plate(this, GAME_W / 2, cy, W, h, { ...SURFACE.surface, r: R.l });
    const btnW = 230;
    button(this, LEFT + W - S.s - btnW / 2, cy, btnW, BTN.m, '', 'Отряд', () => this.scene.start('Squad', { back: { to: 'Hunt' } }), T.body, { variant: 'secondary' }).container.setName('huntSquad');
    const x0 = LEFT + S.s;
    if (!st.mvp || !st.boss.weakTo.length) return;
    // Копии одного героя — один портрет; сначала те, кто в отряде.
    const seen = new Set<string>();
    const list = [...st.heroes].sort((a, b) => Number(b.inSquad) - Number(a.inSquad)).filter((hh) => (seen.has(hh.name) ? false : (seen.add(hh.name), true)));
    if (!list.length) {
      tag(this, x0, cy, 'Нет героев этой стихии', 'warning', { align: 'left' }).setName('huntNoHeroes');
      return;
    }
    // Подпись ряда — значок стихии слабости и «×2»: эти герои бьют MVP вдвое сильнее.
    const mvp = GAME.hunt.mvp;
    const lead = chip(this, x0, cy, (s, x, y, sz) => elementBadge(s, x, y, st.boss.weakTo[0], sz), mvp ? `×${1 + mvp.weaknessAtk}` : '×', 'positive', { size: 's', align: 'left', bg: false }).setName('huntSquadLead');
    const px = x0 + lead.width + S.s;
    const size = 92;
    const step = size + S.xs;
    const room = Math.floor((LEFT + W - S.s - btnW - S.s - px + S.xs) / step);
    list.slice(0, room).forEach((hh, i) => {
      const x = px + size / 2 + i * step;
      const hero = session.save.heroes.find((e) => e.id === hh.heroId);
      plate(this, x, cy, size, size, { ...SURFACE.sunken, border: hh.inSquad ? COLOR.positive : COLOR.border, borderW: 3, r: R.s });
      if (hero) portrait(this, x, cy, portraitKey(heroSprite(hero, GAME)), size - 12).setAlpha(hh.inSquad ? 1 : 0.55);
      if (st.boss.weakTo.length > 1) elementBadge(this, x - size / 2 + 14, cy - size / 2 + 14, hh.element, 30);
      if (hh.inSquad) this.add.image(x + size / 2 - 14, cy + size / 2 - 14, skinIcon('check')).setDisplaySize(34, 34).setTint(COLOR_N.positive);
    });
  }

  /** Уровень MVP (◀ ▶), награда победы чипами, шкала порогов с лучшим результатом. */
  private levelBlock(st: HuntStatus, top: number): void {
    const h = L.levelH;
    plate(this, GAME_W / 2, top + h / 2, W, h, { ...SURFACE.surface, r: R.l });
    const rank = st.mvp ? (pickedRank ?? st.rank) : 0;
    let y = top + 64;
    let tier = st.tiers.length - 1;
    if (st.mvp) {
      const boss = huntBoss(today(), GAME, rank);
      const arrow = (b: ReturnType<typeof button>, icon: 'back' | 'next') => b.container.add(this.add.image(0, -2, skinIcon(icon)).setDisplaySize(52, 52).setTint(COLOR_N.title));
      const left = button(this, LEFT + S.s + 50, y, 100, BTN.m, '', '', () => this.pick(rank - 1, st), T.heading, { variant: 'icon' });
      arrow(left, 'back');
      left.setEnabled(rank > 0);
      left.container.setName('huntPrev');
      // BUG-193: ▶ выше своего уровня не молчит — объясняет, как подняться.
      const right = button(this, LEFT + W - S.s - 50, y, 100, BTN.m, '', '', () => {
        if (rank < st.rank) this.pick(rank + 1, st);
        else toast(this, `Победите MVP уровня ${rank + 1} — откроется ${rank + 2}-й`, C.warning);
      }, T.heading, { variant: 'icon' });
      arrow(right, 'next');
      right.container.setName('huntNext');
      if (rank >= st.rank) right.container.setAlpha(0.45);
      text(this, GAME_W / 2, y, `Уровень ${rank + 1} / ${st.ranks}`, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('huntRank');
      if (rank < st.rank) tag(this, GAME_W / 2, y + 56, 'ниже вашего', 'neutral').setScale(0.85);
      // Здоровье на баннере — для выбранного уровня (баннер рисует MVP своего уровня).
      const hp = this.children.getByName('huntHp') as Phaser.GameObjects.Text | null;
      hp?.setText(formatNumber(boss.def.stats.hp));
      tier = Math.min(rank, st.tiers.length - 1);
      y += rank < st.rank ? 130 : 108;
    } else y += 40;
    // Награда победы на этом уровне (без MVP — высший порог): чипы, карта MVP — последней.
    const cardDef = st.boss.card;
    const mvpCard = cardDef && GAME.hunt.mvp ? { id: cardDef.id, chance: GAME.hunt.mvp.cardChance } : undefined;
    const ore = st.attemptsLeft === st.attemptsPerDay && st.attemptsLeft > 0;
    // Шкала порогов: заливка — лучший результат по этому MVP; справа — кубок «8/10».
    const by = top + h - 50;
    // Ряд наград — посередине между уровнем и шкалой (одна строка или две).
    const row = rewardRow(this, GAME_W / 2, 0, huntRewardChips(st.tiers[tier].rewards, { ore, mvpCard }), { maxW: W - 2 * S.s, size: 's', gap: S.xxs }).setName('huntReward');
    const band = { top: y - 28, bottom: by - 40 };
    row.setY(band.top + Math.max(0, (band.bottom - band.top - row.height) / 2) + 28);
    const best = chip(this, LEFT + W - S.s, by, 'trophy', st.best > 0 ? `${st.bestTier + 1}/${st.tiers.length}` : '—', st.best > 0 ? 'gold' : 'neutral', { size: 's', align: 'right' }).setName('huntBest');
    const bx = LEFT + S.m;
    const bw = best.x - best.width / 2 - S.s - bx;
    progressBar(this, bx, by, bw, 22, tierPosition(st.best, st.tiers.map((t) => t.damage)), 0xd6a645, { key: 'hunt_best' });
    st.tiers.forEach((_, i) => {
      if (i === st.tiers.length - 1) return;
      const x = bx + (bw * (i + 1)) / st.tiers.length;
      this.add.rectangle(x, by, 4, 30, i <= st.bestTier ? 0xffe08a : 0x6a5a40);
    });
  }

  /** Правила и подробности — лист снизу (легенда, механики, слабость, карта MVP, попытки). */
  private rules(st: HuntStatus): void {
    const boss = st.boss;
    bottomSheet(this, boss.def.name, (c, w) => {
      let y = 0;
      const para = (s: string, color: string = COLOR.textPrimary, size: number = T.body) => {
        const t = text(this, 0, y, s, size, color, { align: 'left', wordWrap: { width: w, useAdvancedWrap: true } }).setOrigin(0, 0);
        c.add(t);
        y += t.height + S.s;
      };
      const head = (s: string) => {
        const t = text(this, 0, y, s, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0);
        c.add(t);
        y += t.height + S.xs;
      };
      if (boss.legend) para(boss.legend, COLOR.textSecondary);
      if (boss.mechanics.length) {
        head('Фазы и приёмы');
        for (const m of boss.mechanics) para(`• ${m}`);
      }
      const mvp = GAME.hunt.mvp;
      if (mvp && boss.weakTo.length) {
        head('Стихия');
        para(`Герои стихии «${boss.weakTo.map((e: Element) => ELEMENT_NAMES[e]).join('», «')}» бьют ×${1 + mvp.weaknessAtk}${mvp.armorAtk ? `, остальные −${Math.round(mvp.armorAtk * 100)}%` : ''}.`);
      }
      if (boss.card && mvp) {
        head(boss.card.name);
        const pity = Math.max(1, mvp.cardPity - (session.save.hunt?.dry ?? 0));
        para(`${boss.card.text} Вставляется в снаряжение.`);
        para(`Шанс ${Math.round(mvp.cardChance * 100)}% за победу, точно — через ${pity} ${plural(pity, 'победу', 'победы', 'побед')}.`, COLOR.textSecondary, T.caption);
      }
      head('Попытки');
      para(`${st.attemptsPerDay} в день, бой ${GAME.hunt.timeLimitSeconds} с. Первая попытка дня даёт Благословенную руду.${GAME.hunt.sweep ? ' «Зачистка» повторяет лучший бой.' : ''}`, COLOR.textSecondary, T.caption);
      return y;
    });
  }

  private pick(rank: number, st: HuntStatus): void {
    const selected = Math.max(0, Math.min(st.rank, rank));
    pickedRank = selected < st.rank ? selected : null;
    this.scene.restart({});
  }

  /** «Зачистка» (вторичная) и «В бой» (главная, чип попыток на углу). */
  private footer(st: HuntStatus, y: number): void {
    const sweepW = 360;
    const goW = W - sweepW - S.s;
    const sweep = button(this, LEFT + sweepW / 2, y, sweepW, L.ctaH, '', 'Зачистка', () => this.sweep(), T.heading, { variant: 'secondary' });
    sweep.container.setName('huntSweep');
    sweep.setEnabled(st.canSweep);
    const gx = LEFT + W - goW / 2;
    const go = cta(this, gx, y, 'В бой', () => this.fight(), { w: goW, h: L.ctaH, enabled: st.attemptsLeft > 0 });
    go.label.setX(30);
    go.container.add(this.add.image(30 - go.label.width / 2 - 48, -4, skinIcon('swords')).setDisplaySize(62, 62).setTint(st.attemptsLeft > 0 ? 0x3a2408 : 0x6a6a6a));
    if (st.attemptsLeft > 0) ctaShine(this, go.container, goW, L.ctaH);
    // Попытки — чип на правом верхнем углу главной кнопки («2/2»; кончились — песочные часы).
    const left = st.attemptsLeft;
    chip(this, gx + goW / 2 - S.xs, y - L.ctaH / 2, left > 0 ? 'swords' : 'hourglass', `${left}/${st.attemptsPerDay}`, left > 0 ? 'positive' : 'neutral', { size: 's', align: 'right' })
      .setName('huntAttempts')
      .setDepth(1);
  }

  private fight(): void {
    if (!session.save.squad.some(Boolean)) {
      this.scene.start('Squad', { back: { to: 'Hunt' } });
      return;
    }
    const st = huntStatus(session.save, today(), GAME);
    syncRankSelection(st.rank);
    this.scene.start('Battle', { mode: 'hunt', rank: pickedRank ?? st.rank });
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

  /**
   * Итог попытки поверх экрана: заголовок-лента, одно крупное число (отсчёт), порог и смена уровня тегами,
   * полученное — чипами, карта MVP — рисунком. «Отлично» — монеты летят в «таблетку» золота.
   */
  private showOutcome(out: HuntOutcome): void {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const layer = this.add.container(0, 0).setDepth(Z.modal).setName('huntOutcome');
    const shade = this.add.rectangle(cx, cy, GAME_W * 3, GAME_H * 3, 0x000000, 0.72).setInteractive();
    layer.add(shade);
    const mvpFight = !out.sweep && out.levelBefore !== undefined;
    const hp = out.boss.def.stats.hp;
    const pct = out.killed ? 100 : Math.min(99, Math.floor((out.damage / Math.max(1, hp)) * 100));
    const g = out.grant;
    const cardDef = g.card ? GAME.hunt.cards.find((c) => c.id === g.card) : undefined;
    const bw = 900;
    // Полученное — чипами (строятся первыми: высота окна — по содержимому).
    const items: ChipSpec[] = [];
    if (g.gold) items.push({ icon: 'gold', value: `+${formatNumber(g.gold)}`, tone: 'gold' });
    if (g.jobExp) items.push({ icon: 'hero_exp', value: `+${formatNumber(g.jobExp)}` });
    if (g.gems) items.push({ icon: 'gems', value: `+${g.gems}`, tone: 'gem' });
    if (g.ore) items.push({ icon: (s, x, y, size) => oreIcon(s, x, y, size), value: `×${g.ore}`, tone: 'info' });
    const cards = g.heroCards.filter((e) => e.type === 'heroCard');
    if (cards.length) items.push({ icon: (s, x, y, size) => rewardIcon(s, x, y, 'heroCard', size), value: `×${cards.length}`, tone: 'info' });
    if (g.items.length) {
      const rar = GAME.equipment.items[g.items[0].itemId]?.rarity ?? 'common';
      items.push({ icon: (s, x, y, size) => roIconOr(s, x, y, size, g.items[0].itemId, RARITY_COLORS[rar]), value: `×${g.items.length}` });
    }
    const row = items.length ? rewardRow(this, cx, 0, items, { maxW: bw - 2 * S.l }).setName('huntOutRewards') : null;
    const pityTag = !cardDef && out.killed && !!out.boss.card && !!GAME.hunt.mvp;
    const CARD_H = 190;
    const bh = 420 + (row ? row.height + S.l : 80) + (cardDef ? CARD_H + S.s + 56 + 40 + S.s : pityTag ? 52 + S.l : 0) + 170;
    const top = cy - bh / 2;
    const box = plate(this, cx, cy, bw, bh, { fill: COLOR.surfaceRaised, alpha: 0.98, border: COLOR.accent, borderW: 4, r: R.xl, hl: 0.15 }).setInteractive();
    layer.add(box);
    // BUG-185: MVP — исход называется прямо: «MVP!» или «Поражение», доля снятых ОЗ и уровень «10 → 9».
    const head = out.sweep ? 'Зачистка' : out.killed ? 'MVP!' : mvpFight ? 'Поражение' : 'Охота окончена';
    layer.add(ribbon(this, cx, top, head, { size: out.killed ? T.heading : T.body, minW: 480 }).setName('huntOutHead'));
    const sub = out.killed ? `${out.boss.def.name} повержен` : mvpFight ? 'Снято ОЗ' : out.boss.rank !== undefined ? 'Урон по MVP' : 'Урон по боссу';
    layer.add(text(this, cx, top + 110, sub, T.body, out.killed ? COLOR.gold : COLOR.textSecondary, { fontStyle: out.killed ? 'bold' : 'normal' }).setName(out.killed ? 'huntOutKilled' : mvpFight ? 'huntOutLost' : 'huntOutSub'));
    const bigVal = mvpFight && !out.killed ? pct : out.damage;
    const fmt = (n: number) => (mvpFight && !out.killed ? `${n}%` : formatNumber(n));
    const bigY = top + 210;
    const big = text(this, cx, bigY, fmt(0), T.display * 1.25, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 10 }).setName('huntOutBig');
    layer.add(big);
    countUp(this, big, 0, bigVal, fmt, {
      delay: 160,
      onDone: () => {
        if (out.killed || out.record || out.rankUp) burst(this, { x: cx, y: bigY });
      },
    });
    // Порог и уровень — тегами в ряд.
    const tags: Phaser.GameObjects.Container[] = [];
    tags.push(tag(this, 0, 0, out.tier >= 0 ? `Порог ${out.tier + 1}/${GAME.hunt.tiers.length}` : 'Порог не взят', out.tier >= 0 ? 'positive' : 'negative'));
    const lb = out.levelBefore;
    const la = out.levelAfter;
    if (mvpFight && lb !== undefined && la !== undefined && la !== lb) tags.push(tag(this, 0, 0, `Уровень ${lb + 1} → ${la + 1}`, la > lb ? 'positive' : 'negative').setName(la > lb ? 'huntRankUp' : 'huntRankDown'));
    else if (out.rankUp) {
      const lvl = out.save.hunt?.level;
      tags.push(tag(this, 0, 0, lvl !== undefined ? `Уровень ${lvl + 1}` : 'Новый уровень', 'positive').setName('huntRankUp'));
    } else if (out.record && !mvpFight) tags.push(tag(this, 0, 0, 'Рекорд', 'gold'));
    const tagsW = tags.reduce((n, t) => n + t.width, 0) + S.xs * (tags.length - 1);
    let tx = cx - tagsW / 2;
    for (const t of tags) {
      t.setPosition(tx + t.width / 2, top + 320);
      tx += t.width + S.xs;
    }
    layer.add(tags);
    let y = top + 420;
    if (row) {
      layer.add(row.setY(y));
      y += row.height + S.l;
    } else {
      layer.add(text(this, cx, y, 'Награды нет', T.body, COLOR.textTertiary));
      y += 80;
    }
    if (cardDef) {
      // Карта MVP — рисунок, название и куда вставить (одна строка).
      const ch = CARD_H;
      layer.add(this.add.rectangle(cx, y + ch / 2, ch * 0.72 + 8, ch + 8, 0x1a0f22).setStrokeStyle(4, 0xb07ae0));
      showCardArt(this, cardDef.id, cx, y + ch / 2, ch, (img) => layer.add(img), layer);
      y += ch + S.s;
      layer.add(text(this, cx, y, `${cardDef.name}!`, T.heading, '#d8b4ff', { fontStyle: 'bold' }).setName('huntOutCard'));
      y += 56;
      layer.add(ellipsize(text(this, cx, y, 'Вставить: Инвентарь → «Карты MVP»', T.caption, COLOR.textSecondary), bw - 2 * S.l));
    } else if (pityTag && out.boss.card && GAME.hunt.mvp) {
      // BUG-193: победа без карты — когда карта выпадет точно.
      const pity = Math.max(1, GAME.hunt.mvp.cardPity - (out.save.hunt?.dry ?? 0));
      layer.add(tag(this, cx, y, `${out.boss.card.name} — через ${pity} ${plural(pity, 'победу', 'победы', 'побед')}`, 'accent'));
    }
    const close = () => {
      const pill = this.children.getByName('pill_gold') as Phaser.GameObjects.Container | null;
      const key = roIcon(this, 'gold');
      if (g.gold > 0 && pill && key) rewardFly(this, { x: cx, y: bigY }, { x: pill.x, y: pill.y, box: pill }, { key, scale: 3 }, { n: 6 });
      layer.destroy();
    };
    const ok = cta(this, cx, top + bh - 95, 'Отлично', close, { w: 440, h: 130 });
    layer.add(ok.container);
    layer.setData('close', close);
    popIn(this, layer, shade);
  }
}

/** Иконка предмета RO в рамке цвета редкости; нет иконки — шлем цвета редкости. */
function roIconOr(scene: Phaser.Scene, x: number, y: number, size: number, itemId: string, color: string): Phaser.GameObjects.GameObject {
  const tint = Phaser.Display.Color.HexStringToColor(color).color;
  const key = roIcon(scene, itemId);
  if (!key) return scene.add.image(x, y, skinIcon('helmet')).setDisplaySize(size, size).setTint(tint);
  const cell = scene.add.rectangle(0, 0, size, size, tint, 0.2).setStrokeStyle(2, tint, 1);
  const ico = scene.add.image(0, 0, key).setScale(Math.max(1, Math.round(size / 24)));
  return scene.add.container(x, y, [cell, ico]);
}
