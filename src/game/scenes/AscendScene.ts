import Phaser from 'phaser';
import {
  actAscend,
  activeForm,
  ascendRequirement,
  autoChain,
  autoFodder,
  fodderBlocker,
  heroCard,
  heroPower,
  heroTemplate,
  type AscendRequirement,
  type BranchView,
  type HeroState,
} from '../../core';
import { CONTENT, GAME } from '../content';
import { formatNumber, ROLE_NAMES, STAT_KEYS, STAT_LABELS } from '../flow';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from '../layout';
import { bottomSheet, confirm, CONTENT_BOTTOM, CONTENT_TOP, cta, noticeModal, screen } from '../screen';
import { commit, session, today } from '../session';
import { button, chip, ellipsize, emptyState, infoButton, mixHex, plate, pressable, rewardRow, stat, SURFACE, tag, text, toast, type ChipSpec } from '../ui';
import { markHint } from '../hints';
import { C, COLOR, COLOR_N, E, FAMILY, M, R, S, T, Z } from '../theme';
import { sfx } from '../audio';
import { burst, countUp, juiceOn, moment, MOMENT_DEPTH, pulse } from '../juice';
import { drawHeroCard, glowTexture, heroCardSize, raysTexture, rarityName, rarityPalette, rarityPips } from '../heroCard';
import {
  ascendButtonState,
  ascendedBranch,
  ascendPower,
  ascendPreview,
  copySources,
  fodderOptions,
  fodderSlotCaption,
  fodderSlots,
  needsBranchPick,
  placeFodder,
  valuableFodder,
  type AscendPreview,
} from '../heroesView';
import { openBranchPicker } from '../branchPicker';
import { skillIcon } from '../skillIcons';
import { openSkillDetail } from '../skillDetail';
import type { HeroData } from './HeroScene';

const TOP = CONTENT_TOP;
/** Главная кнопка «Вознести» и строка причины над ней. */
const BTN_Y = CONTENT_BOTTOM - 80;
const REASON_Y = BTN_Y - 112;
/** Ширина контента: поля экрана S.l. */
const CW = GAME_W - 2 * S.l;
const LEFT = S.l;
/** Строка стата в «Что даст» (две колонки). */
const STAT_ROW_H = 64;
const BRANCH_TILE_H = 240;
/** Пояс новых навыков (иконки 72). */
const SKILLS_H = 96;
/** Шапка блока корма: «Корм 1/2», «Где взять копии», «Авто». */
const FODDER_HEAD_H = 104;
/** Подпись под слотом корма. */
const SLOT_CAP_H = 52;
/** Сколько копий показывает лист выбора корма (слабые и свободные — первыми; больше не нужно). */
const PICK_MAX = 12;

/** Выбранный корм переживает перезапуск сцены (выбор в листе, «Авто»). */
let chosenFor: { heroId: string; ids: string[] } | null = null;
/** Ветка, выбранная на экране (переход синий → фиолетовый), — переживает перезапуск. */
let branchFor: { heroId: string; job: string } | null = null;

const powerOf = (h: HeroState) => heroPower(h, GAME, session.save);

/** Строки «Что даст»: подпись, новое значение, прирост (без прироста — не показываем). */
export interface GainRow {
  label: string;
  value: string;
  delta: string | number | null;
}

/** Строки «Что даст» по превью: 4 стата, предел уровня, сила навыков (если растёт). */
export function gainRows(prev: AscendPreview): GainRow[] {
  const rows: GainRow[] = STAT_KEYS.map((k) => ({ label: STAT_LABELS[k], value: formatNumber(prev.stats.to[k]), delta: prev.stats.to[k] - prev.stats.from[k] || null }));
  rows.push({ label: 'Предел уровня', value: String(prev.maxLevel.to), delta: prev.maxLevel.to - prev.maxLevel.from || null });
  if (prev.skillPower.to !== prev.skillPower.from) rows.push({ label: 'Сила навыков', value: `×${prev.skillPower.to}`, delta: null });
  return rows;
}

/**
 * Короткая причина под кнопкой (одна строка, ≤ 40 символов): нехватка копий/золота — красным; пустые слоты при свободных
 * копиях — без строки (подсвечена «Авто»), не выбрана ветка — «Выберите ветку».
 */
export function shortReason(reason: string | null): { text: string; tone: 'negative' | 'warning' } | null {
  if (!reason) return null;
  if (/экспедици/i.test(reason)) return { text: 'Экспедиция: дождитесь и заберите награды', tone: 'warning' };
  if (reason.startsWith('Положите')) return null;
  if (reason.startsWith('Выберите ветку')) return { text: 'Выберите ветку', tone: 'warning' };
  if (reason.startsWith('Не хватает золота')) return { text: `${reason.replace(/^Не хватает золота:\s*/, 'Не хватает ')} золота`, tone: 'negative' };
  return { text: reason, tone: 'negative' };
}

/**
 * H4 «Вознесение» в духе AFK Arena: карточка «сейчас» слева и «после» справа (рамки и ромбы редкостей), между ними —
 * мощь «было → станет» крупно; «Что даст» — строки статов с приростом; на фиолетовом — две ветки второй профессии
 * карточками (касание — выбрать, «i» — описания навыков); корм — слоты с рамкой нужной редкости (касание — лист
 * выбора копий, «Авто» — самые слабые, «Где взять копии» — источники); одна главная кнопка «Вознести» с ценой-чипом,
 * причина — одной строкой над ней. Показ: корм влетает в карточку, она переворачивается в новой рамке, момент
 * «Вознесение!» (juice.ts: звук, вибрация, лучи), мощь отсчитывается, статы и возврат корма — чипами.
 * Правила корма — ядро (merge.ts): занятые копии (отряд, пресет, экспедиция, замок) в корм не идут.
 */
export class AscendScene extends Phaser.Scene {
  constructor() {
    super('Ascend');
  }

  private heroId = '';
  /** После выбора копий и показа вознесения вернуться на ту же вкладку и к тому же родителю карточки. */
  private heroReturn!: HeroData;
  private chosen: string[] = [];
  /** Выбранная ветка (переход с выбором ветки, у героя ветки ещё нет). */
  private branch: string | undefined;
  private slotPos: { x: number; y: number }[] = [];

  create(data: HeroData): void {
    this.heroId = data.heroId;
    this.heroReturn = { heroId: data.heroId, tab: data.tab, back: data.back };
    this.slotPos = [];
    const hero = session.save.heroes.find((h) => h.id === data.heroId);
    screen(this, 'Вознесение', 'Heroes', { to: 'Hero', data: this.heroReturn });
    if (!hero || !GAME.content.heroes[hero.templateId]) return;
    const req = ascendRequirement(session.save, hero.id, GAME);
    this.branch = req && needsBranchPick(hero, req.to, GAME) && branchFor?.heroId === hero.id && req.branches?.some((b) => b.job === branchFor!.job) ? branchFor.job : undefined;
    const prev = ascendPreview(hero, GAME, this.branch);
    if (!req || !prev) {
      emptyState(this, GAME_W / 2, GAME_H / 2, 'Максимальная редкость');
      return;
    }
    // Выбор корма: прежний для этой карточки (только ещё подходящие), иначе — пусто.
    const valid = new Set(req.fodder.flatMap((f) => f.candidates));
    this.chosen = chosenFor?.heroId === hero.id ? chosenFor.ids.filter((id) => valid.has(id)) : [];
    chosenFor = { heroId: hero.id, ids: this.chosen };

    const choosing = needsBranchPick(hero, req.to, GAME);
    const lay = this.layout(prev, req, choosing);
    let y = this.compare(hero, req, lay.cardW);
    y = this.gains(hero, req, prev, y + S.s, choosing);
    this.fodderBlock(hero, req, y + S.l, lay.slotW);
    this.footer(hero, req);
  }

  private reopen(): void {
    this.scene.restart(this.heroReturn);
  }

  /** Размеры карточек и слотов: всё влезает над строкой причины (на фиолетовом добавляются ветки). */
  private layout(prev: AscendPreview, req: AscendRequirement, choosing: boolean): { cardW: number; slotW: number } {
    const room = REASON_Y - 40 - TOP;
    const n = fodderSlots(req).length;
    for (const [cardW, slotW] of [
      [300, 180],
      [270, 170],
      [240, 160],
      [220, 150],
      [200, 140],
    ] as const) {
      const need = this.compareH(cardW) + S.s + this.gainsH(prev, choosing) + S.l + this.fodderH(slotW, n);
      if (need <= room) return { cardW, slotW };
    }
    return { cardW: 190, slotW: 130 };
  }

  // ---------- сейчас → после ----------

  private compareH(cardW: number): number {
    return S.s + heroCardSize(cardW).h + 56;
  }

  /** Две карточки, между ними — мощь «было → станет» и прирост. Возвращает низ блока. */
  private compare(hero: HeroState, req: AscendRequirement, cardW: number): number {
    const { h } = heroCardSize(cardW);
    const cy = TOP + S.s + h / 2;
    const lx = LEFT + cardW / 2;
    const rx = GAME_W - LEFT - cardW / 2;
    const to = rarityPalette(req.to);
    const motion = juiceOn();
    // Сияние и лучи цвета новой редкости за карточкой «после».
    const rays = this.add.image(rx, cy, raysTexture(this)).setDisplaySize(cardW * 2, cardW * 2).setTint(to.glow).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD);
    const glow = this.add.image(rx, cy, glowTexture(this)).setDisplaySize(cardW * 1.7, h * 1.4).setTint(to.tint).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD);
    if (motion) {
      this.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
      this.tweens.add({ targets: glow, alpha: 0.22, duration: M.count, yoyo: true, repeat: -1, ease: E.inOut });
    }
    drawHeroCard(this, lx, cy, hero, { w: cardW, figure: 'sprite', showIcons: false }).setAlpha(0.92);
    const futureBranch = ascendedBranch(hero, req.to, GAME, this.branch);
    const after = drawHeroCard(this, rx, cy, hero, { w: cardW, figure: 'sprite', showIcons: false, rarity: req.to, level: hero.level, ...(futureBranch ? { branch: futureBranch } : {}) });
    after.setName('ascendAfter');
    // Ромбы редкостей под карточками (слово не нужно — цвет рамки и ромбы).
    const t = heroTemplate(GAME, hero.templateId);
    const py = cy + h / 2 + 32;
    rarityPips(this, lx, py, t, req.from, 11);
    rarityPips(this, rx, py, t, req.to, 11);

    // Середина: мощь было (вторичная) → станет (крупно, цвет новой редкости) и прирост тегом.
    const mx = GAME_W / 2;
    const pw = ascendPower(hero, GAME, powerOf, this.branch)!;
    text(this, mx, cy - 120, formatNumber(pw.from), T.body, COLOR.textSecondary, { fontStyle: 'bold' }).setName('ascendPowerFrom');
    this.arrow(mx, cy - 44, to.tint, motion);
    text(this, mx, cy + 46, formatNumber(pw.to), T.display, to.light, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('ascendPowerTo');
    const gain = pw.to - pw.from;
    const pct = pw.from > 0 ? Math.round((gain / pw.from) * 100) : 0;
    tag(this, mx, cy + 126, `+${formatNumber(gain)}${pct ? ` · ${pct}%` : ''}`, 'positive').setName('ascendPowerGain');
    return TOP + this.compareH(cardW);
  }

  /** Тройная стрелка «›››» — огоньки бегут вправо (одна Graphics на шеврон). */
  private arrow(x: number, y: number, tint: number, motion: boolean): void {
    for (let i = 0; i < 3; i++) {
      const g = this.add.graphics({ x: x - 44 + i * 44, y });
      g.fillStyle(tint, 1).fillPoints([new Phaser.Geom.Point(-14, -26), new Phaser.Geom.Point(6, 0), new Phaser.Geom.Point(-14, 26), new Phaser.Geom.Point(-4, 0)], true);
      g.setAlpha(motion ? 0.3 : 0.5 + i * 0.25);
      if (motion) this.tweens.add({ targets: g, alpha: 1, duration: M.slow, delay: i * 180, yoyo: true, repeat: -1, repeatDelay: 280, ease: E.inOut });
    }
  }

  // ---------- что даст ----------

  private gainsH(prev: AscendPreview, choosing: boolean): number {
    const rows = Math.ceil(gainRows(prev).length / 2);
    const skills = !choosing && (prev.newSkills.length > 0 || !!prev.newJob);
    return S.m + rows * STAT_ROW_H + (skills ? SKILLS_H : 0) + S.xs + (choosing ? S.s + BRANCH_TILE_H : 0);
  }

  /** «Что даст»: строки статов с приростом (две колонки), новые навыки / ветки. Возвращает низ блока. */
  private gains(hero: HeroState, req: AscendRequirement, prev: AscendPreview, top: number, choosing: boolean): number {
    const rows = gainRows(prev);
    const nRows = Math.ceil(rows.length / 2);
    const skills = !choosing && (prev.newSkills.length > 0 || !!prev.newJob);
    const panelH = S.m + nRows * STAT_ROW_H + (skills ? SKILLS_H : 0) + S.xs;
    plate(this, GAME_W / 2, top + panelH / 2, CW, panelH, { ...SURFACE.surface, r: R.l });
    const colW = (CW - 3 * S.m) / 2;
    rows.forEach((r, i) => {
      const col = i % 2;
      const x = LEFT + S.m + colW / 2 + col * (colW + S.m);
      const y = top + S.m / 2 + STAT_ROW_H / 2 + Math.floor(i / 2) * STAT_ROW_H;
      stat(this, x, y, r.label, r.value, { w: colW, delta: r.delta });
    });
    if (skills) this.newSkills(prev, top + S.m / 2 + nRows * STAT_ROW_H + SKILLS_H / 2);
    if (choosing) this.branchTiles(hero, req, top + panelH + S.s);
    return top + this.gainsH(prev, choosing);
  }

  /** Новая профессия (тегом) и иконки новых навыков (касание — описание). */
  private newSkills(prev: AscendPreview, y: number): void {
    let x = LEFT + S.m;
    if (!prev.newJob) {
      const cap = text(this, x, y, 'Новые навыки', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
      x += cap.width + S.s;
    }
    if (prev.newJob) {
      const t = tag(this, x, y, heroCardJob(this.heroId, prev.newJob), 'accent', { align: 'left' });
      x += t.width + S.s;
    }
    for (const s of prev.newSkills.slice(0, 5)) {
      if (x + 80 > GAME_W - LEFT - S.m) break;
      const sk = CONTENT.skills[s.skill];
      const box = plate(this, x + 40, y, 80, 80, { ...SURFACE.sunken, border: mixHex(COLOR.border, COLOR.info, 0.5), r: R.s });
      this.add.image(x + 40, y, skillIcon(this, sk)).setDisplaySize(64, 64);
      pressable(this, box, 80, 80, () => openSkillDetail(this, s.skill, { note: 'Откроется после вознесения' }));
      x += 80 + S.xs;
    }
  }

  /** Две ветки второй профессии карточками: касание — выбрать, «i» — окно с описаниями навыков обеих веток. */
  private branchTiles(hero: HeroState, req: AscendRequirement, top: number): void {
    const branches = req.branches ?? [];
    const tw = (CW - S.s) / 2;
    branches.slice(0, 2).forEach((b, i) => {
      const x = LEFT + tw / 2 + i * (tw + S.s);
      this.branchTile(hero, b, x, top + BRANCH_TILE_H / 2, tw, b.job === this.branch, !this.branch);
    });
  }

  private branchTile(hero: HeroState, b: BranchView, x: number, y: number, w: number, on: boolean, none: boolean): void {
    const h = BRANCH_TILE_H;
    const purple = rarityPalette('purple');
    // Имя плитки — `branchTile_<job>` (e2e-chapter1 нажимает её по имени): объект верхнего уровня сцены.
    const bg = plate(this, x, y, w, h, on ? { fill: mixHex(COLOR.surfaceRaised, purple.main, 0.22), border: COLOR.accent, borderW: 5, r: R.l, hl: 0.16 } : { ...SURFACE.raised, border: mixHex(COLOR.border, purple.main, none ? 0.6 : 0.3), r: R.l }).setName(`branchTile_${b.job}`);
    if (on && juiceOn()) {
      const g = this.add.image(x, y, glowTexture(this)).setDisplaySize(w * 1.15, h * 1.3).setTint(COLOR_N.accent).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD);
      this.children.moveBelow(g as unknown as Phaser.GameObjects.GameObject, bg as unknown as Phaser.GameObjects.GameObject);
    }
    const left = x - w / 2 + S.m;
    const head = text(this, left, y - h / 2 + 46, b.jobName, T.heading, on ? COLOR.title : purple.light, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    ellipsize(head, w - 2 * S.m - 72);
    text(this, left, y - h / 2 + 92, ROLE_NAMES[b.role] ?? b.role, T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    const skills = [...b.skills].sort((p, q) => p.level - q.level).slice(0, 4);
    const size = Math.min(80, (w - 2 * S.m - 3 * S.xs) / 4);
    skills.forEach((s, i) => {
      this.add.image(left + size / 2 + i * (size + S.xs), y + h / 2 - S.m - size / 2, skillIcon(this, CONTENT.skills[s.skill])).setDisplaySize(size, size).setAlpha(on || none ? 1 : 0.6);
    });
    if (on) tag(this, x + w / 2 - S.xs, y - h / 2 + 46, '✓', 'accent', { solid: true, align: 'right' });
    pressable(this, bg, w, h, () => {
      if (b.job === this.branch) return;
      branchFor = { heroId: hero.id, job: b.job };
      sfx('equip');
      this.reopen();
    });
    // «i» — подробности обеих веток (там же можно выбрать).
    if (!on) infoButton(this, x + w / 2 - S.m - 18, y - h / 2 + 46, () => this.openBranches(hero, b.job), { size: 52 }).setName(`branchMore_${b.job}`);
  }

  private openBranches(hero: HeroState, selected: string): void {
    openBranchPicker(this, {
      templateId: hero.templateId,
      title: 'Ветка второй профессии',
      subtitle: `${heroTemplate(GAME, hero.templateId).name} получит её при вознесении.`,
      selected,
      heroId: hero.id,
      save: session.save,
      confirmLabel: (job) => (job ? `Выбрать: ${(ascendRequirement(session.save, hero.id, GAME)?.branches ?? []).find((x) => x.job === job)?.jobName ?? job}` : 'Выберите ветку'),
      onConfirm: (job) => {
        branchFor = { heroId: hero.id, job };
        this.reopen();
      },
    });
  }

  // ---------- корм ----------

  private fodderH(slotW: number, n: number): number {
    return n ? FODDER_HEAD_H + heroCardSize(slotW).h + SLOT_CAP_H : 0;
  }

  private fodderBlock(hero: HeroState, req: AscendRequirement, top: number, slotW: number): void {
    const slots = fodderSlots(req);
    if (!slots.length) return;
    const placed = placeFodder(req, this.chosen);
    const { h: sh } = heroCardSize(slotW);
    const filled = placed.filter(Boolean).length;
    const hy = top + FODDER_HEAD_H / 2 - S.xs;
    text(this, LEFT, hy, `Копии ${filled}/${slots.length}`, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const need = filled < slots.length;
    const auto = button(this, GAME_W - LEFT - 110, hy, 220, 96, '', 'Авто', () => this.autoFill(hero), T.heading, { variant: 'secondary' });
    auto.container.setName('autoFodder');
    // «Где взять копии» — ghost-ссылка (окно со всеми источниками).
    const src = button(this, GAME_W - LEFT - 220 - S.s - 170, hy, 340, 96, '', 'Где взять копии', () => this.sources(hero), T.caption, { variant: 'ghost', sound: null });
    src.container.setName('copySources');
    const chain = !autoFodder(session.save, hero.id, GAME) && autoChain(session.save, hero.id, GAME).length > 0;
    const autoReady = need && (!!autoFodder(session.save, hero.id, GAME) || chain);
    if (autoReady && juiceOn()) pulse(this, auto.container, 1.05);

    const n = slots.length;
    const step = Math.min(slotW + S.l, CW / Math.max(1, n));
    const x0 = GAME_W / 2 - ((n - 1) * step) / 2;
    const y = top + FODDER_HEAD_H + sh / 2;
    slots.forEach((s, i) => {
      const x = x0 + i * step;
      this.slotPos.push({ x, y });
      const id = placed[i];
      const fh = id ? session.save.heroes.find((q) => q.id === id) : undefined;
      if (fh) {
        const c = drawHeroCard(this, x, y, fh, { w: slotW, showIcons: false, showPips: false, onTap: () => this.unchoose(id!) });
        c.setName(`fodderSlot_${i}`);
        // «−» в углу — убрать из корма (вся карточка тоже убирает).
        const g = this.add.graphics({ x: x + slotW / 2 - 10, y: y - sh / 2 + 10 });
        g.fillStyle(COLOR_N.surfaceSunken, 1).fillCircle(0, 0, 22).lineStyle(3, COLOR_N.textSecondary, 1).strokeCircle(0, 0, 22);
        g.lineStyle(5, COLOR_N.textPrimary, 1).lineBetween(-9, 0, 9, 0);
        return;
      }
      const pal = rarityPalette(s.rarity);
      const has = req.fodder[s.group].candidates.some((c) => !this.chosen.includes(c));
      const bg = plate(this, x, y, slotW, sh, { fill: mixHex(COLOR.surfaceSunken, pal.main, 0.12), alpha: 0.95, border: has ? pal.main : mixHex(COLOR.surfaceSunken, pal.main, 0.5), borderW: 4, r: R.m }).setName(`fodderSlot_${i}`);
      const plus = this.add.graphics({ x, y });
      plus.lineStyle(10, has ? COLOR_N.textPrimary : COLOR_N.textTertiary, has ? 1 : 0.6);
      plus.lineBetween(-26, 0, 26, 0).lineBetween(0, -26, 0, 26);
      const cap = fodderSlotCaption(s, hero, GAME);
      ellipsize(text(this, x, y + sh / 2 + SLOT_CAP_H / 2 + 2, cap.who, T.caption, has ? pal.light : COLOR.textTertiary, { fontStyle: 'bold' }), step - S.xs);
      pressable(this, bg, slotW, sh, () => this.pick(hero, req, s.group));
      if (has && juiceOn()) this.tweens.add({ targets: plus, scale: 1.15, duration: M.emphasis, yoyo: true, repeat: -1, ease: E.inOut });
    });
  }

  private sources(hero: HeroState): void {
    const name = heroTemplate(GAME, hero.templateId).name;
    noticeModal(this, 'Где взять копии', [
      `Карты этого героя (${name}) и любых других героев:`,
      ...copySources(session.save, hero.templateId, GAME).map((s) => `• ${s}`),
      'Опыт и золото, вложенные в выбранные копии, вернутся в запас.',
    ]);
  }

  private autoFill(hero: HeroState): void {
    const ids = autoFodder(session.save, hero.id, GAME);
    if (!ids) {
      // Цепочка: копий нужной редкости не хватает, но есть младшие — «сначала слить 3 зелёные в синюю».
      const steps = autoChain(session.save, hero.id, GAME);
      if (steps.length) {
        const name = heroCard(hero, GAME).name;
        const lines = steps.map((st) => {
          const t = session.save.heroes.find((h) => h.id === st.targetId)!;
          const to = rarityName(ascendRequirement(session.save, t.id, GAME)?.to ?? t.rarity).toLowerCase();
          return `• ${st.fodderIds.length + 1} × ${rarityName(t.rarity).toLowerCase()} → ${to}`;
        });
        confirm(this, `Сначала слить копии (${name}):\n${lines.join('\n')}`, 'Слить', () => this.runChain(hero, steps));
        return;
      }
      toast(this, 'Свободных копий не хватает', C.error, 2500);
      return;
    }
    chosenFor = { heroId: hero.id, ids };
    sfx('equip');
    this.reopen();
  }

  /** Выполнить цепочку слияний (autoChain) по шагам, затем заполнить корм «Авто». */
  private runChain(hero: HeroState, steps: { targetId: string; fodderIds: string[] }[]): void {
    let done = 0;
    for (const st of steps) {
      try {
        const r = actAscend(session.save, today(), st.targetId, st.fodderIds, GAME);
        commit(r.save);
        markHint('ascend');
        done++;
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
        break;
      }
    }
    // Рутина (не момент): короткий звук слияния, без вибрации «момента».
    if (done) sfx('equip');
    const ids = autoFodder(session.save, hero.id, GAME);
    chosenFor = { heroId: hero.id, ids: ids ?? [] };
    this.reopen();
    const sc = this.scene.get('Ascend');
    sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, `Слито копий: ${done}`, C.success, 2000));
  }

  private unchoose(id: string): void {
    chosenFor = { heroId: this.heroId, ids: this.chosen.filter((x) => x !== id) };
    sfx('ui_back');
    this.reopen();
  }

  /** Лист выбора корма для слота group: подходящие копии с уровнями, свободные первыми; занятые — бледные с меткой. */
  private pick(hero: HeroState, req: AscendRequirement, group: number): void {
    const opts = fodderOptions(session.save, req, group, this.chosen).slice(0, PICK_MAX);
    if (!opts.length) {
      this.sources(hero);
      return;
    }
    const cap = fodderSlotCaption(req.fodder[group], hero, GAME);
    const sheet = bottomSheet(this, `${cap.who}, ${cap.rarity}`, (content, width, close) => {
      const cols = 4;
      const w = Math.floor((width - (cols - 1) * S.s) / cols);
      const { h } = heroCardSize(w);
      const rowH = h + 64;
      opts.forEach((o, i) => {
        const fh = session.save.heroes.find((q) => q.id === o.id)!;
        const x = w / 2 + (i % cols) * (w + S.s);
        const y = h / 2 + Math.floor(i / cols) * rowH;
        const busy = !!o.tag || o.chosen;
        const c = drawHeroCard(this, x, y, fh, {
          w,
          parent: content,
          showIcons: false,
          showPips: false,
          inSquad: o.tag === 'в отряде',
          locked: o.tag === 'закреплён',
          onTap: () => {
            if (o.chosen) return;
            if (o.tag) {
              toast(this, `${fodderBlocker(session.save, o.id, GAME) ?? o.tag}`, C.warning, 2500);
              return;
            }
            close();
            chosenFor = { heroId: this.heroId, ids: [...this.chosen, o.id] };
            sfx('equip');
            this.reopen();
          },
        });
        c.setName(`fodderOption_${o.id}`);
        if (busy) c.setAlpha(0.45);
        const label = o.chosen ? 'выбрана' : (o.tag ?? `ур. ${o.level}`);
        content.add(text(this, x, y + h / 2 + 30, label, T.caption, o.tag ? COLOR.warning : o.chosen ? COLOR.textTertiary : COLOR.textSecondary, { fontStyle: 'bold' }));
      });
      return Math.ceil(opts.length / cols) * rowH - S.xs;
    });
    sheet.layer.setName('fodderPicker');
  }

  // ---------- кнопка и подтверждение ----------

  private footer(hero: HeroState, req: AscendRequirement): void {
    const st = ascendButtonState(session.save, hero.id, this.chosen, GAME, { branchChosen: !!this.branch });
    const goldOk = session.save.resources.gold >= req.gold;
    const why = shortReason(st.reason);
    if (why) ellipsize(text(this, GAME_W / 2, REASON_Y, why.text, T.body, why.tone === 'negative' ? COLOR.negative : COLOR.warning, { fontStyle: 'bold' }).setName('ascendNote'), CW);
    if (st.ready) {
      const g = this.add.image(GAME_W / 2, BTN_Y, glowTexture(this)).setDisplaySize(900, 280).setTint(rarityPalette(req.to).glow).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD);
      if (juiceOn()) this.tweens.add({ targets: g, alpha: 0.2, duration: M.count, yoyo: true, repeat: -1, ease: E.inOut });
    }
    // Одна главная кнопка: «Вознести» и цена-чип внутри (красная, если золота не хватает).
    const w = 720;
    const b = cta(this, GAME_W / 2, BTN_Y, 'Вознести', () => this.confirmAscend(hero, req), { w, enabled: st.ready });
    b.container.setName('ascendConfirm');
    b.label.setFontSize(T.title);
    const price = chip(this, 0, 0, 'gold', formatNumber(req.gold), goldOk ? (st.ready ? 'neutral' : 'neutral') : 'negative', { bg: false });
    if (st.ready && goldOk) (price.list.find((o) => o.type === 'Text') as Phaser.GameObjects.Text | undefined)?.setColor(COLOR.onAccent);
    const gap = S.s;
    const total = b.label.width + gap + price.width;
    b.label.setX(-total / 2 + b.label.width / 2);
    price.setPosition(total / 2 - price.width / 2, -3);
    b.container.add(price);
    if (!st.ready) price.setAlpha(goldOk ? 0.55 : 1);
    if (st.ready && juiceOn()) pulse(this, b.container, 1.03);
  }

  private confirmAscend(hero: HeroState, req: AscendRequirement): void {
    const st = ascendButtonState(session.save, hero.id, this.chosen, GAME, { branchChosen: !!this.branch });
    if (!st.ready) {
      toast(this, st.reason && /экспедици/i.test(st.reason) ? st.reason : shortReason(st.reason)?.text ?? (this.chosen.length ? 'Пока нельзя' : 'Выберите копии или используйте «Авто»'), C.error, 3500);
      return;
    }
    const name = heroCard(hero, GAME).name;
    const lines = [`${name}: ${rarityName(req.from)} → ${rarityName(req.to)}`];
    const choose = needsBranchPick(hero, req.to, GAME) && this.branch;
    if (choose) lines.push(`Ветка: ${(req.branches ?? []).find((b) => b.job === this.branch)?.jobName ?? this.branch}`);
    const restored = ascendedBranch(hero, req.to, GAME);
    if (!hero.branch && restored) lines.push(`Восстановится прежняя профессия: ${heroCard({ ...hero, rarity: req.to, branch: restored }, GAME).jobName}`);
    if (this.chosen.length) lines.push(`Будет использовано: ${this.chosen.length} ${this.chosen.length === 1 ? 'карта' : 'карты'} · ${formatNumber(req.gold)} золота`);
    if (valuableFodder(session.save, this.chosen).length) lines.push('Выбраны синие карточки и выше');
    confirm(this, lines.join('\n'), 'Вознести', () => this.doAscend(hero, choose ? this.branch : undefined));
  }

  private doAscend(hero: HeroState, branch?: string): void {
    const before = { power: powerOf(hero), rarity: hero.rarity, card: heroCard(hero, GAME), stats: heroCard(hero, GAME).stats };
    const fodder = this.slotPos.slice(0, this.chosen.length);
    try {
      const r = actAscend(session.save, today(), hero.id, this.chosen, GAME, branch ? { branch } : {});
      commit(r.save);
      markHint('ascend');
      chosenFor = null;
      branchFor = null;
      this.reveal(hero.id, before, r.events, fodder, r.refund);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  // ---------- показ ----------

  /**
   * Показ вознесения: затемнение, корм влетает в карточку, она дрожит и переворачивается в новой рамке — в этот миг
   * момент «Вознесение!» (juice.ts: стингер, вибрация, лучи; keep — остаётся фоном), вспышка цвета новой редкости,
   * мощь отсчитывается, ниже — статы столбиками с приростом, возврат корма чипами, реплика героя; «Отлично!» последней.
   */
  private reveal(
    heroId: string,
    before: { power: number; rarity: HeroState['rarity']; card: ReturnType<typeof heroCard>; stats: ReturnType<typeof heroCard>['stats'] },
    events: ReturnType<typeof actAscend>['events'],
    fodderFrom: { x: number; y: number }[],
    refund: { exp: number; gold: number },
  ): void {
    const hero = session.save.heroes.find((h) => h.id === heroId)!;
    const after = heroCard(hero, GAME);
    const pal = rarityPalette(hero.rarity);
    const power = powerOf(hero);
    const asc = events.find((e) => e.type === 'ascended');
    const jobChanged = !!(asc && asc.type === 'ascended' && asc.jobChanged);
    const motion = juiceOn();
    // Подложка экрана (под моментом) и передний слой (над затемнением момента).
    const back = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, COLOR_N.bg, 1).setAlpha(0.95).setDepth(Z.modal).setInteractive();
    const layer = this.add.container(0, 0).setDepth(MOMENT_DEPTH + 10).setName('ascendReveal');
    const cy = 760;
    const W = 420;
    const cardH = heroCardSize(W).h;
    const halo = this.add.image(GAME_W / 2, cy, glowTexture(this)).setDisplaySize(800, 900).setTint(pal.tint).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    layer.add(halo);
    const oldCard = drawHeroCard(this, GAME_W / 2, cy, hero, { w: W, rarity: before.rarity, figure: 'sprite', showIcons: false, level: hero.level });
    layer.add(oldCard);

    // Итог (появляется после вспышки): мощь, статы столбиками, профессия/навык, возврат корма, реплика.
    const info = this.add.container(0, 0).setAlpha(motion ? 0 : 1);
    layer.add(info);
    let y = cy + cardH / 2 + 64;
    const powerLine = text(this, GAME_W / 2, y, formatNumber(before.power), T.display, COLOR.gold, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('revealPower');
    const plus = tag(this, GAME_W / 2 + 230, y, `+${formatNumber(power - before.power)}`, 'positive').setName('revealPlus');
    info.add([powerLine, plus]);
    y += 104;
    // Статы — строками в две колонки на поверхности (как «Что даст»): новое значение и прирост.
    const rows: GainRow[] = STAT_KEYS.map((k) => ({ label: STAT_LABELS[k], value: formatNumber(after.stats[k]), delta: after.stats[k] - before.stats[k] || null }));
    rows.push({ label: 'Предел уровня', value: String(after.maxLevel), delta: after.maxLevel - before.card.maxLevel || null });
    const panelH = S.xs + Math.ceil(rows.length / 2) * STAT_ROW_H + S.xs;
    info.add(plate(this, GAME_W / 2, y + panelH / 2, CW, panelH, { ...SURFACE.surface, r: R.l }));
    const colW = (CW - 3 * S.m) / 2;
    rows.forEach((r, i) => info.add(stat(this, LEFT + S.m + colW / 2 + (i % 2) * (colW + S.m), y + S.xs + STAT_ROW_H / 2 + Math.floor(i / 2) * STAT_ROW_H, r.label, r.value, { w: colW, delta: r.delta })));
    y += panelH + S.l;
    const skills = events.flatMap((e) => (e.type === 'skillUnlocked' ? [CONTENT.skills[e.skill]?.name ?? e.skill] : []));
    const tags: Phaser.GameObjects.Container[] = [];
    if (jobChanged) tags.push(tag(this, 0, y, after.jobName, 'accent'));
    if (skills.length) tags.push(tag(this, 0, y, skills.length === 1 ? skills[0] : `Навыки: ${skills.length}`, 'info'));
    if (tags.length) {
      const tw = tags.reduce((n, t) => n + t.width, 0) + S.xs * (tags.length - 1);
      let tx = GAME_W / 2 - tw / 2;
      for (const t of tags) {
        t.setX(tx + t.width / 2);
        tx += t.width + S.xs;
        info.add(t);
      }
      y += 76;
    }
    const back2: ChipSpec[] = [];
    if (refund.exp) back2.push({ icon: 'hero_exp', value: `+${formatNumber(refund.exp)}` });
    if (refund.gold) back2.push({ icon: 'gold', value: `+${formatNumber(refund.gold)}`, tone: 'gold' });
    if (back2.length) {
      info.add(rewardRow(this, GAME_W / 2, y, back2, { size: 's' }).setName('revealRefund'));
      y += 80;
    }
    // Реплика: строка вознесения на новую редкость (lore-route §5.8, ascendLines), иначе — девиз новой профессии.
    const said = (heroTemplate(GAME, hero.templateId).ascendLines as Partial<Record<string, string>> | undefined)?.[hero.rarity];
    const form = jobChanged ? activeForm(heroTemplate(GAME, hero.templateId), hero) : undefined;
    const quote = said ?? form?.promotion;
    if (quote) {
      const q = text(this, GAME_W / 2, y, `«${quote}»`, T.caption, COLOR.textSecondary, { fontStyle: 'italic', wordWrap: { width: CW - 2 * S.m } }).setOrigin(0.5, 0).setName(said ? 'ascendLine' : 'promotionLine');
      q.setMaxLines(3);
      info.add(q);
      y += q.height + S.s;
    }
    const doneY = Math.min(GAME_H - 130, Math.max(y + 90, CONTENT_BOTTOM - 70));
    const done = cta(this, GAME_W / 2, doneY, 'Отлично!', () => this.scene.start('Hero', this.heroReturn), { w: 520 });
    done.container.setName('revealDone').setAlpha(motion ? 0 : 1);
    layer.add(done.container);

    const title = { at: { x: GAME_W / 2, y: 250 }, subtitle: `${rarityName(before.rarity)} → ${rarityName(hero.rarity)}`, color: pal.light };
    const finish = () => {
      moment(this, 'ascend', { ...title, keep: true });
      if (jobChanged) sfx('job_change', { delay: 0.6 });
      countUp(this, powerLine, before.power, power, (n) => formatNumber(n), { duration: M.count, delay: motion ? 250 : 0 });
      if (!motion) {
        halo.setAlpha(0.5);
        return;
      }
      this.cameras.main.shake(220, 0.006);
      // Вспышка цвета новой редкости, белое ядро, волна-кольцо.
      const flash = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, pal.tint, 0.85).setDepth(MOMENT_DEPTH + 20).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: flash, alpha: 0, duration: 520, onComplete: () => flash.destroy() });
      const core = this.add.image(GAME_W / 2, cy, glowTexture(this)).setDisplaySize(900, 900).setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(MOMENT_DEPTH + 21);
      this.tweens.add({ targets: core, alpha: 0, scale: core.scale * 1.6, duration: M.emphasis, onComplete: () => core.destroy() });
      const ring = this.add.circle(GAME_W / 2, cy, 120).setStrokeStyle(12, pal.glow, 1).setDepth(MOMENT_DEPTH + 19);
      this.tweens.add({ targets: ring, scale: 6, alpha: 0, duration: 800, ease: E.out, onComplete: () => ring.destroy() });
      burst(this, { x: GAME_W / 2, y: cy });
      this.tweens.add({ targets: halo, alpha: 0.6, duration: M.slow });
      this.tweens.add({ targets: halo, alpha: 0.35, duration: 1100, delay: 500, yoyo: true, repeat: -1, ease: E.inOut });
      this.tweens.add({ targets: info, alpha: 1, duration: M.slow, delay: M.fast });
      // Кнопка — последней (§4.6: не нажать случайно).
      this.tweens.add({ targets: done.container, alpha: 1, duration: M.base, delay: 1000 });
      plus.setScale(0.4).setAlpha(0);
      this.tweens.add({ targets: plus, alpha: 1, scale: 1, duration: M.slow, delay: 700, ease: E.pop });
    };
    const makeNew = () => drawHeroCard(this, GAME_W / 2, cy, hero, { w: W, figure: 'sprite', showIcons: false, glow: true });
    if (!motion) {
      oldCard.destroy();
      layer.addAt(makeNew(), layer.getIndex(info));
      finish();
      return;
    }
    // Корм летит в карточку и растворяется; карточка дрожит, светится, переворачивается — и возвращается в новой рамке.
    this.tweens.add({ targets: back, alpha: { from: 0, to: 0.95 }, duration: M.base });
    fodderFrom.forEach((p, i) => {
      const g = this.add.image(p.x, p.y, glowTexture(this)).setDisplaySize(220, 280).setTint(pal.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(MOMENT_DEPTH + 15);
      this.tweens.add({ targets: g, x: GAME_W / 2, y: cy, scale: 0.25, duration: 520, delay: 200 + i * 90, ease: 'Cubic.easeIn', onComplete: () => g.destroy() });
    });
    this.tweens.add({ targets: halo, alpha: 0.45, duration: 700, delay: 200 });
    this.tweens.add({ targets: oldCard, x: GAME_W / 2 + 6, duration: 50, yoyo: true, repeat: 8, delay: 350 });
    // Твином, а не таймером сцены: последовательность идёт по реальному времени даже на медленных кадрах.
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: fodderFrom.length ? 900 : 650,
      onComplete: () => {
        this.tweens.add({
          targets: oldCard,
          scaleX: 0,
          scaleY: 1.08,
          duration: 180,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            oldCard.destroy();
            const nc = makeNew();
            layer.addAt(nc, layer.getIndex(info));
            nc.setScale(0, 1.08);
            this.tweens.add({ targets: nc, scaleX: 1.12, duration: 200, ease: E.out, onComplete: () => this.tweens.add({ targets: nc, scaleX: 1, scaleY: 1, duration: 260, ease: E.pop }) });
            finish();
          },
        });
      },
    });
  }
}

/** Название профессии после вознесения — по полу героя (Жрица, Волшебница). */
function heroCardJob(heroId: string, job: string): string {
  const hero = session.save.heroes.find((h) => h.id === heroId);
  const view = hero ? heroCard(hero, GAME).branches.find((b) => b.job === job) : undefined;
  return view?.jobName ?? CONTENT.jobs[job]?.name ?? job;
}
