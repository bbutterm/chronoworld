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
import { card, confirm, CONTENT_BOTTOM, CONTENT_TOP, noticeModal, popIn, screen } from '../screen';
import { commit, session, today } from '../session';
import { button, ellipsize, emptyState, pressable, ScrollArea, text, toast } from '../ui';
import { markHint } from '../hints';
import { C, FS, OUTLINE } from '../theme';
import { sfx } from '../audio';
import { haptic } from '../haptics';
import { burst, countUp, juiceOn, pulse } from '../juice';
import { drawHeroCard, glowTexture, heroCardSize, raysTexture, rarityColor, rarityName, rarityPalette, rarityPips } from '../heroCard';
import {
  ascendButtonState,
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

const TOP = CONTENT_TOP;
const REVEAL_DEPTH = 8500;
/** Кнопка «Вознести» и строка причины над ней. */
const BTN_Y = CONTENT_BOTTOM - 78;
const REASON_Y = BTN_Y - 108;
const PANEL_W = 1040;
const BRANCH_TILE_H = 236;

/** Выбранный корм переживает перезапуск сцены (выбор в окне, «Авто»). */
let chosenFor: { heroId: string; ids: string[] } | null = null;
/** Ветка, выбранная на экране (переход синий → фиолетовый), — переживает перезапуск. */
let branchFor: { heroId: string; job: string } | null = null;

const hexNum = (s: string) => Phaser.Display.Color.HexStringToColor(s).color;
const powerOf = (h: HeroState) => heroPower(h, GAME, session.save);

/**
 * H4 «Вознесение» в духе AFK Arena: крупно карточка сейчас слева и после вознесения справа (рамки и ромбы редкостей,
 * между ними — стрелка и мощь «было → станет»), «Что даст» (статы было → станет, предел уровня, сила навыков, новые
 * навыки; на фиолетовом — две ветки второй профессии на выбор с иконками навыков), «Корм» — слоты с подписью «Алан,
 * синий» / «Любой, фиолетовый» (касание — выбор из подходящих копий с уровнями и метками «в отряде» / «закреплён»,
 * «Авто» — самые слабые), «Где взять копии» (окно), кнопка «Вознести · N золота» (неактивна — причина над ней).
 * Показ: корм влетает в карточку, она переворачивается и меняет рамку, вспышка цвета новой редкости, «+N мощи».
 * Правила корма — ядро (merge.ts): занятые копии (отряд, пресет, экспедиция, замок) в корм не идут.
 */
export class AscendScene extends Phaser.Scene {
  constructor() {
    super('Ascend');
  }

  private heroId = '';
  private chosen: string[] = [];
  /** Выбранная ветка (переход с выбором ветки, у героя ветки ещё нет). */
  private branch: string | undefined;
  private slotPos: { x: number; y: number }[] = [];

  create(data: { heroId: string }): void {
    this.heroId = data.heroId;
    this.slotPos = [];
    const hero = session.save.heroes.find((h) => h.id === data.heroId);
    screen(this, 'Вознесение', 'Heroes', { to: 'Hero', data: { heroId: data.heroId } });
    if (!hero || !GAME.content.heroes[hero.templateId]) return;
    const req = ascendRequirement(session.save, hero.id, GAME);
    this.branch = req && needsBranchPick(hero, req.to) && branchFor?.heroId === hero.id && req.branches?.some((b) => b.job === branchFor!.job) ? branchFor.job : undefined;
    const prev = ascendPreview(hero, GAME, this.branch);
    if (!req || !prev) {
      emptyState(this, GAME_W / 2, GAME_H / 2, 'Карточка на максимальной редкости — возносить некуда.');
      return;
    }
    // Выбор корма: прежний для этой карточки (только ещё подходящие), иначе — пусто.
    const valid = new Set(req.fodder.flatMap((f) => f.candidates));
    this.chosen = chosenFor?.heroId === hero.id ? chosenFor.ids.filter((id) => valid.has(id)) : [];
    chosenFor = { heroId: hero.id, ids: this.chosen };

    const choosing = needsBranchPick(hero, req.to);
    const lay = this.layout(prev, req, !!choosing);
    let y = this.compare(hero, req, lay.cardW);
    y = this.gains(hero, req, prev, y + 8, !!choosing);
    this.fodderBlock(hero, req, y + 16, lay.slotW);
    this.footer(hero, req);
  }

  /** Размеры карточек и слотов, чтобы всё влезло над кнопкой (на фиолетовом добавляются ветки). */
  private layout(prev: AscendPreview, req: AscendRequirement, choosing: boolean): { cardW: number; slotW: number } {
    const room = REASON_Y - 40 - TOP;
    for (const [cardW, slotW] of [
      [290, 180],
      [260, 170],
      [230, 160],
      [210, 150],
    ] as const) {
      const need = this.compareH(cardW) + 8 + this.gainsH(prev, choosing) + 16 + this.fodderH(slotW, fodderSlots(req).length);
      if (need <= room) return { cardW, slotW };
    }
    return { cardW: 200, slotW: 140 };
  }

  // ---------- сейчас → после ----------

  private compareH(cardW: number): number {
    return 20 + heroCardSize(cardW).h + 100;
  }

  /** Две карточки со стрелкой и мощью посередине. Возвращает низ блока. */
  private compare(hero: HeroState, req: AscendRequirement, cardW: number): number {
    const { h } = heroCardSize(cardW);
    const cy = TOP + 20 + h / 2;
    const lx = 40 + cardW / 2;
    const rx = GAME_W - 40 - cardW / 2;
    const to = rarityPalette(req.to);
    const motion = juiceOn();
    // Сияние и лучи цвета новой редкости за карточкой «после».
    const rays = this.add.image(rx, cy, raysTexture(this)).setDisplaySize(cardW * 2.1, cardW * 2.1).setTint(to.glow).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
    const glow = this.add.image(rx, cy, glowTexture(this)).setDisplaySize(cardW * 1.8, h * 1.45).setTint(to.tint).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    if (motion) {
      this.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
      this.tweens.add({ targets: glow, alpha: 0.25, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    drawHeroCard(this, lx, cy, hero, { w: cardW, figure: 'sprite' });
    const after = drawHeroCard(this, rx, cy, hero, { w: cardW, figure: 'sprite', rarity: req.to, level: hero.level, ...(this.branch ? { branch: this.branch } : {}) });
    after.setName('ascendAfter');
    // Подписи редкостей и ромбы под карточками.
    const t = heroTemplate(GAME, hero.templateId);
    const ly = cy + h / 2 + 34;
    text(this, lx, ly, rarityName(req.from), FS.h3, rarityColor(req.from), { fontStyle: 'bold', ...OUTLINE, strokeThickness: 5 });
    text(this, rx, ly, rarityName(req.to), FS.h3, to.light, { fontStyle: 'bold', ...OUTLINE, strokeThickness: 5 });
    rarityPips(this, lx, ly + 44, t, req.from, 11);
    rarityPips(this, rx, ly + 44, t, req.to, 11);

    // Середина: мощь было → станет, стрелка цвета новой редкости.
    const mx = GAME_W / 2;
    const pw = ascendPower(hero, GAME, powerOf, this.branch)!;
    text(this, mx, cy - 126, 'Мощь', FS.caption, C.dim, OUTLINE);
    text(this, mx, cy - 82, formatNumber(pw.from), FS.h3, C.muted, { fontStyle: 'bold', ...OUTLINE });
    this.arrow(mx, cy + 6, to.tint, motion);
    text(this, mx, cy + 94, formatNumber(pw.to), FS.h1, to.light, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setName('ascendPowerTo');
    const gain = pw.to - pw.from;
    const pct = pw.from > 0 ? Math.round((gain / pw.from) * 100) : 0;
    const chip = text(this, mx, cy + 150, `+${formatNumber(gain)}${pct ? ` (+${pct}%)` : ''}`, FS.caption, C.positive, { fontStyle: 'bold', ...OUTLINE });
    const bg = this.add.rectangle(mx, cy + 150, chip.width + 28, chip.height + 6, 0x0e2a12, 0.85).setStrokeStyle(2, 0x7dff8f, 0.7);
    this.children.moveBelow(bg as unknown as Phaser.GameObjects.GameObject, chip as unknown as Phaser.GameObjects.GameObject);
    return TOP + this.compareH(cardW);
  }

  /** Тройная стрелка «»» — огоньки бегут вправо. */
  private arrow(x: number, y: number, tint: number, motion: boolean): void {
    for (let i = 0; i < 3; i++) {
      const cx = x - 60 + i * 60;
      const g = this.add.graphics({ x: cx, y });
      g.fillStyle(0x000000, 0.9).fillPoints([new Phaser.Geom.Point(-26, -46), new Phaser.Geom.Point(8, 0), new Phaser.Geom.Point(-26, 46), new Phaser.Geom.Point(-4, 0)], true);
      g.fillStyle(tint, 1).fillPoints([new Phaser.Geom.Point(-20, -36), new Phaser.Geom.Point(4, 0), new Phaser.Geom.Point(-20, 36), new Phaser.Geom.Point(-4, 0)], true);
      g.setAlpha(motion ? 0.35 : 0.5 + i * 0.25);
      if (motion) this.tweens.add({ targets: g, alpha: 1, duration: 380, delay: i * 180, yoyo: true, repeat: -1, repeatDelay: 280, ease: 'Sine.easeInOut' });
    }
  }

  // ---------- что даст ----------

  private gainLines(prev: AscendPreview, choosing: boolean): { s: string; color: string; skills?: string[] }[] {
    const lines: { s: string; color: string; skills?: string[] }[] = [{ s: `Предел уровня ${prev.maxLevel.from} → ${prev.maxLevel.to}`, color: C.gold }];
    if (prev.skillPower.to !== prev.skillPower.from) lines.push({ s: `Сила навыков ×${prev.skillPower.from} → ×${prev.skillPower.to}`, color: C.positive });
    if (!choosing) {
      if (prev.newJob) lines.push({ s: `Новая профессия: ${heroCardJob(this.heroId, prev.newJob)}`, color: rarityColor(prev.to) });
      const skills = prev.newSkills.slice(0, 3);
      if (skills.length) lines.push({ s: 'Новые навыки:', color: C.info, skills: skills.map((s) => s.skill) });
    }
    return lines;
  }

  private gainsH(prev: AscendPreview, choosing: boolean): number {
    const lines = this.gainLines(prev, choosing);
    return 196 + lines.reduce((a, l) => a + (l.skills ? 84 : 52), 0) + (choosing ? BRANCH_TILE_H + 60 : 0) + 12;
  }

  /** «Что даст»: статы было → станет, предел, сила навыков, навыки / ветки. Возвращает низ блока. */
  private gains(hero: HeroState, req: AscendRequirement, prev: AscendPreview, top: number, choosing: boolean): number {
    const hh = this.gainsH(prev, choosing);
    card(this, GAME_W / 2, top + hh / 2, PANEL_W, hh, true);
    text(this, 50, top + 40, 'Что даст', FS.h3, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5);
    STAT_KEYS.forEach((k, i) => {
      const cx = 150 + i * 260;
      const a = prev.stats.from[k];
      const b = prev.stats.to[k];
      text(this, cx, top + 92, STAT_LABELS[k], FS.caption, C.inkMuted);
      text(this, cx, top + 134, `${formatNumber(a)} → ${formatNumber(b)}`, FS.caption, b > a ? C.positive : C.ink, { fontStyle: 'bold' });
      if (b > a) text(this, cx, top + 172, `+${formatNumber(b - a)}`, FS.caption, C.positive);
    });
    let y = top + 222;
    for (const l of this.gainLines(prev, choosing)) {
      const t = text(this, 50, y, l.s, FS.small, l.color, { fontStyle: 'bold' }).setOrigin(0, 0.5);
      if (l.skills) {
        let x = t.x + t.width + 24;
        const nameW = Math.max(120, (GAME_W - 60 - x) / l.skills.length - 100);
        for (const id of l.skills) {
          const sk = CONTENT.skills[id];
          const icon = this.add.image(x + 32, y, skillIcon(this, sk)).setDisplaySize(64, 64);
          const nm = ellipsize(text(this, x + 74, y, sk?.name ?? id, FS.caption, C.ink).setOrigin(0, 0.5), nameW);
          pressable(this, icon, 72, 72, () => openSkillDetail(this, id, { note: 'Откроется после вознесения' }));
          x += 74 + nm.width + 26;
          if (x > GAME_W - 120) break;
        }
        y += 84;
      } else y += 52;
    }
    if (choosing) this.branchTiles(hero, req, y - 10);
    return top + hh;
  }

  /** Две ветки второй профессии: касание — выбрать, «подробнее» — большое окно с описаниями навыков. */
  private branchTiles(hero: HeroState, req: AscendRequirement, top: number): void {
    const branches = req.branches ?? [];
    text(this, 50, top + 16, this.branch ? 'Ветка второй профессии:' : 'Выберите ветку второй профессии:', FS.small, this.branch ? C.title : C.warning, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 3 }).setOrigin(0, 0.5);
    const tw = 490;
    branches.forEach((b, i) => {
      const x = GAME_W / 2 + (i === 0 ? -1 : 1) * (tw / 2 + 10);
      const y = top + 50 + BRANCH_TILE_H / 2;
      this.branchTile(hero, b, x, y, tw, b.job === this.branch);
    });
  }

  private branchTile(hero: HeroState, b: BranchView, x: number, y: number, w: number, on: boolean): void {
    const pal = rarityPalette('purple');
    const h = BRANCH_TILE_H;
    const bg = this.add.rectangle(x, y, w, h, on ? 0x2a1648 : 0x140c1c, 0.92).setStrokeStyle(on ? 6 : 3, on ? 0xffd84a : pal.tint, on ? 1 : 0.7).setName(`branchTile_${b.job}`);
    if (on && juiceOn()) {
      const g = this.add.image(x, y, glowTexture(this)).setDisplaySize(w * 1.2, h * 1.3).setTint(0xffd84a).setAlpha(0.25).setBlendMode(Phaser.BlendModes.ADD);
      this.children.moveBelow(g as unknown as Phaser.GameObjects.GameObject, bg as unknown as Phaser.GameObjects.GameObject);
    }
    const left = x - w / 2 + 20;
    ellipsize(text(this, left, y - h / 2 + 36, `${on ? '✓ ' : ''}${b.jobName}`, FS.h3, on ? C.gold : pal.light, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5), w - 40);
    text(this, left, y - h / 2 + 80, ROLE_NAMES[b.role] ?? b.role, FS.caption, C.muted, OUTLINE).setOrigin(0, 0.5);
    const skills = [...b.skills].sort((p, q) => p.level - q.level).slice(0, 4);
    const step = Math.min(110, (w - 40) / Math.max(1, skills.length));
    skills.forEach((s, i) => {
      const ix = left + 44 + i * step;
      const iy = y + 22;
      this.add.image(ix, iy, skillIcon(this, CONTENT.skills[s.skill])).setDisplaySize(80, 80);
      text(this, ix, iy + 56, `ур. ${s.level}`, FS.caption, C.dim);
    });
    const pick = () => {
      if (b.job === this.branch) return;
      branchFor = { heroId: hero.id, job: b.job };
      sfx('equip');
      this.scene.restart({ heroId: hero.id });
    };
    pressable(this, bg, w, h, pick);
    // «Подробнее» — окно с полными описаниями навыков обеих веток (там же можно выбрать).
    const more = text(this, x + w / 2 - 20, y - h / 2 + 36, 'подробнее ›', FS.caption, C.info, { fontStyle: 'bold', ...OUTLINE }).setOrigin(1, 0.5);
    const hit = this.add.rectangle(more.x - more.width / 2, more.y, more.width + 30, 80, 0x000000, 0.001).setName(`branchMore_${b.job}`);
    pressable(this, hit, more.width + 30, 80, () => this.openBranches(hero, b.job));
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
        this.scene.restart({ heroId: hero.id });
      },
    });
  }

  // ---------- корм ----------

  private fodderH(slotW: number, n: number): number {
    return n ? 96 + heroCardSize(slotW).h + 86 : 0;
  }

  private fodderBlock(hero: HeroState, req: AscendRequirement, top: number, slotW: number): void {
    const slots = fodderSlots(req);
    if (!slots.length) return;
    const placed = placeFodder(req, this.chosen);
    const { h: sh } = heroCardSize(slotW);
    const hh = this.fodderH(slotW, slots.length);
    card(this, GAME_W / 2, top + hh / 2, PANEL_W, hh);
    const filled = placed.filter(Boolean).length;
    text(this, 50, top + 46, `Корм ${filled}/${slots.length}`, FS.h3, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5);
    const auto = button(this, 880, top + 48, 250, 86, filled < slots.length ? 'ui_btn_primary' : 'ui_btn_secondary', 'Авто', () => this.autoFill(hero), FS.h3);
    auto.container.setName('autoFodder');
    const n = slots.length;
    const step = Math.min(slotW + 36, 960 / Math.max(1, n));
    const x0 = GAME_W / 2 - ((n - 1) * step) / 2;
    const y = top + 96 + sh / 2;
    slots.forEach((s, i) => {
      const x = x0 + i * step;
      this.slotPos.push({ x, y });
      const id = placed[i];
      const fh = id ? session.save.heroes.find((q) => q.id === id) : undefined;
      if (fh) {
        const c = drawHeroCard(this, x, y, fh, { w: slotW, showIcons: false, onTap: () => this.unchoose(id!) });
        c.setName(`fodderSlot_${i}`);
        // Крестик — «убрать из корма».
        const cx = x + slotW / 2 - 8;
        const cy = y - sh / 2 + 8;
        this.add.circle(cx, cy, 22, 0x2a0e0a, 0.95).setStrokeStyle(3, 0xf0e6cf, 0.9);
        text(this, cx, cy - 2, '✕', FS.caption, C.text, { fontStyle: 'bold' });
        return;
      }
      const color = hexNum(rarityColor(s.rarity));
      const has = req.fodder[s.group].candidates.some((c) => !this.chosen.includes(c));
      const bg = this.add.rectangle(x, y, slotW, sh, 0x0b0805, 0.78).setStrokeStyle(5, color, has ? 1 : 0.55).setName(`fodderSlot_${i}`);
      this.add.rectangle(x, y, slotW - 16, sh - 16, color, 0.1);
      const plus = text(this, x, y - sh * 0.16, '+', 96, has ? C.text : C.placeholder, { fontStyle: 'bold', ...OUTLINE });
      const cap = fodderSlotCaption(s, hero, GAME);
      ellipsize(text(this, x, y + sh * 0.2, cap.who, FS.caption, has ? C.text : C.placeholder, { fontStyle: 'bold', ...OUTLINE }), slotW - 16);
      ellipsize(text(this, x, y + sh * 0.2 + 38, cap.rarity, FS.caption, rarityPalette(s.rarity).light, { fontStyle: 'bold', ...OUTLINE }), slotW - 16);
      pressable(this, bg, slotW, sh, () => this.pick(hero, req, s.group));
      if (has && juiceOn()) this.tweens.add({ targets: plus, scale: 1.12, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    });
    // Под слотами: «Где взять копии» (окно со всеми источниками) и подсказка про цепочку «Авто».
    const ry = top + hh - 40;
    const chain = !autoFodder(session.save, hero.id, GAME) && autoChain(session.save, hero.id, GAME).length > 0;
    if (chain) {
      text(this, 50, ry, '«Авто» сольёт младшие копии', FS.caption, C.positive, OUTLINE).setOrigin(0, 0.5);
      if (juiceOn()) pulse(this, auto.container, 1.05);
    }
    const src = text(this, GAME_W - 50, ry, 'Где взять копии ›', FS.small, C.info, { fontStyle: 'bold', ...OUTLINE }).setOrigin(1, 0.5).setName('copySources');
    const hit = this.add.rectangle(src.x - src.width / 2, ry, src.width + 40, 84, 0x000000, 0.001);
    pressable(this, hit, src.width + 40, 84, () => this.sources(hero));
  }

  private sources(hero: HeroState): void {
    const name = heroTemplate(GAME, hero.templateId).name;
    noticeModal(this, 'Где взять копии', [
      `Карты этого героя (${name}) и любых других героев:`,
      ...copySources(session.save, hero.templateId, GAME).map((s) => `• ${s}`),
      'Опыт и золото, вложенные в корм, вернутся в запас.',
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
        confirm(this, `Сначала слить копии (${name}):\n${lines.join('\n')}\nЗатем «Авто» заполнит корм.`, 'Слить', () => this.runChain(hero, steps));
        return;
      }
      toast(this, 'Свободных копий не хватает — «Где взять копии»', C.error, 2500);
      return;
    }
    chosenFor = { heroId: hero.id, ids };
    sfx('equip');
    this.scene.restart({ heroId: hero.id });
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
    if (done) {
      sfx('rarity_up');
      haptic('levelUp');
    }
    const ids = autoFodder(session.save, hero.id, GAME);
    chosenFor = { heroId: hero.id, ids: ids ?? [] };
    this.scene.restart({ heroId: hero.id });
    const sc = this.scene.get('Ascend');
    sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, `Слито копий: ${done} шаг(а)${ids ? ' — корм готов' : ''}`, C.success, 2500));
  }

  private unchoose(id: string): void {
    chosenFor = { heroId: this.heroId, ids: this.chosen.filter((x) => x !== id) };
    sfx('ui_back');
    this.scene.restart({ heroId: this.heroId });
  }

  /** Окно выбора корма для слота group: подходящие копии с уровнями, свободные первыми; занятые — серые с меткой. */
  private pick(hero: HeroState, req: AscendRequirement, group: number): void {
    const opts = fodderOptions(session.save, req, group, this.chosen);
    if (!opts.length) {
      this.sources(hero);
      return;
    }
    const layer = this.add.container(0, 0).setDepth(9000).setName('fodderPicker');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.78).setInteractive();
    const boxH = 1300;
    const boxTop = GAME_H / 2 - boxH / 2;
    const box = card(this, GAME_W / 2, GAME_H / 2, 1000, boxH).setInteractive();
    const cap = fodderSlotCaption(req.fodder[group], hero, GAME);
    const title = text(this, GAME_W / 2, boxTop + 64, `Корм: ${cap.who}, ${cap.rarity}`, FS.h2, C.title, { fontStyle: 'bold', ...OUTLINE });
    const sub = text(this, GAME_W / 2, boxTop + 124, 'Слабые — первыми. Опыт и золото корма вернутся.', FS.caption, C.muted, OUTLINE);
    layer.add([shade, box, title, sub]);
    // Закрыть — перезапуск экрана (список выбора со своей прокруткой уходит целиком).
    const close = () => this.scene.restart({ heroId: this.heroId });
    shade.on('pointerup', close);
    const w = 250;
    const { h } = heroCardSize(w);
    const rowH = h + 70;
    const area = new ScrollArea(this, boxTop + 170, boxTop + boxH - 170);
    area.content.setDepth(9001);
    opts.forEach((o, i) => {
      const fh = session.save.heroes.find((q) => q.id === o.id)!;
      const x = GAME_W / 2 + ((i % 3) - 1) * (w + 40);
      const y = 16 + h / 2 + Math.floor(i / 3) * rowH;
      const busy = !!o.tag || o.chosen;
      const c = drawHeroCard(this, x, y, fh, {
        w,
        parent: area.content,
        showIcons: false,
        inSquad: o.tag === 'в отряде',
        locked: o.tag === 'закреплён',
        onTap: area.tap(() => {
          if (o.chosen) {
            toast(this, 'Эта карта уже в другом слоте', C.warning, 2000);
            return;
          }
          if (o.tag) {
            toast(this, `${fodderBlocker(session.save, o.id, GAME) ?? o.tag} — в корм нельзя, сначала освободите карту`, C.warning, 3000);
            return;
          }
          chosenFor = { heroId: this.heroId, ids: [...this.chosen, o.id] };
          sfx('equip');
          this.scene.restart({ heroId: this.heroId });
        }),
      });
      c.setName(`fodderOption_${o.id}`);
      if (busy) c.setAlpha(0.45);
      const label = o.chosen ? 'уже в корме' : o.tag ? o.tag : `ур. ${o.level}`;
      area.content.add(text(this, x, y + h / 2 + 30, label, FS.caption, o.tag ? C.warning : o.chosen ? C.dim : C.positive, { fontStyle: 'bold', ...OUTLINE }));
    });
    area.setContentHeight(Math.ceil(opts.length / 3) * rowH + 20);
    const cancel = button(this, GAME_W / 2, boxTop + boxH - 90, 400, 110, 'k:buttonLong_beige', 'Отмена', close, FS.h3, { sound: 'ui_back' });
    layer.add(cancel.container);
    popIn(this, layer, shade);
  }

  // ---------- кнопка и подтверждение ----------

  private footer(hero: HeroState, req: AscendRequirement): void {
    const st = ascendButtonState(session.save, hero.id, this.chosen, GAME, { branchChosen: !!this.branch });
    const goldOk = session.save.resources.gold >= req.gold;
    if (st.reason) {
      text(this, GAME_W / 2, REASON_Y, st.reason, FS.small, C.warning, { fontStyle: 'bold', ...OUTLINE, wordWrap: { width: 980 } }).setName('ascendNote').setMaxLines(2);
    } else {
      text(this, GAME_W / 2, REASON_Y, `Готово! Золото: есть ${formatNumber(session.save.resources.gold)}`, FS.small, C.positive, { fontStyle: 'bold', ...OUTLINE }).setName('ascendNote');
    }
    if (st.ready) {
      const g = this.add.image(GAME_W / 2, BTN_Y, glowTexture(this)).setDisplaySize(1000, 300).setTint(rarityPalette(req.to).glow).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
      if (juiceOn()) this.tweens.add({ targets: g, alpha: 0.25, duration: 800, yoyo: true, repeat: -1 });
    }
    const label = `Вознести · ${formatNumber(req.gold)} золота`;
    const b = button(this, GAME_W / 2, BTN_Y, 820, 140, st.ready ? 'ui_btn_primary' : 'ui_btn_secondary', label, () => this.confirmAscend(hero, req), FS.h2);
    b.container.setName('ascendConfirm');
    if (!goldOk) b.label.setColor(C.danger);
    if (st.ready) pulse(this, b.container, 1.04);
    else b.setEnabled(false);
  }

  private confirmAscend(hero: HeroState, req: AscendRequirement): void {
    const st = ascendButtonState(session.save, hero.id, this.chosen, GAME, { branchChosen: !!this.branch });
    if (!st.ready) {
      toast(this, st.reason ?? 'Пока нельзя', C.error, 2500);
      return;
    }
    const name = heroCard(hero, GAME).name;
    const fodder = this.chosen.map((id) => session.save.heroes.find((h) => h.id === id)).filter((h): h is HeroState => !!h);
    const lines = [`${name}: ${rarityName(req.from)} → ${rarityName(req.to)}`];
    const choose = needsBranchPick(hero, req.to) && this.branch;
    if (choose) lines.push(`Ветка: ${(req.branches ?? []).find((b) => b.job === this.branch)?.jobName ?? this.branch}`);
    if (fodder.length) lines.push(`В корм: ${fodder.map((h) => `${heroCard(h, GAME).name} (ур. ${h.level})`).join(', ')}`);
    lines.push(`Золото: ${formatNumber(req.gold)}. Опыт корма вернётся в запас.`);
    if (valuableFodder(session.save, this.chosen).length) lines.push('Внимание: в корме синие карточки и выше!');
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
    const skills = events.flatMap((e) => (e.type === 'skillUnlocked' ? [CONTENT.skills[e.skill]?.name ?? e.skill] : []));
    const motion = juiceOn();
    const layer = this.add.container(0, 0).setDepth(REVEAL_DEPTH).setName('ascendReveal');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x05040a, 1).setAlpha(0.94).setInteractive();
    layer.add(shade);
    const cy = 700;
    const W = 440;
    const rays = this.add.image(GAME_W / 2, cy, raysTexture(this)).setDisplaySize(1300, 1300).setTint(pal.glow).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    const halo = this.add.image(GAME_W / 2, cy, glowTexture(this)).setDisplaySize(820, 920).setTint(pal.tint).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    layer.add([rays, halo]);
    const oldCard = drawHeroCard(this, GAME_W / 2, cy, hero, { w: W, rarity: before.rarity, figure: 'sprite', showIcons: false, level: hero.level });
    layer.add(oldCard);

    // Текст итога (появляется после вспышки).
    const info = this.add.container(0, 0).setAlpha(motion ? 0 : 1);
    layer.add(info);
    const title = text(this, GAME_W / 2, 230, 'Вознесение!', FS.hero + 16, C.gold, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 });
    const sub = text(this, GAME_W / 2, 318, `${rarityName(before.rarity)} → ${rarityName(hero.rarity)}`, FS.h1, pal.light, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    info.add([title, sub]);
    let y = cy + heroCardSize(W).h / 2 + 64;
    const powerLine = text(this, GAME_W / 2, y, `Мощь ${formatNumber(before.power)}`, FS.h1, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    info.add(powerLine);
    const plus = text(this, GAME_W / 2 + 250, cy - 120, `+${formatNumber(power - before.power)} мощи`, FS.h1, C.positive, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 7 }).setAlpha(motion ? 0 : 1).setName('revealPlus');
    y += 66;
    // Статы было → стало одной строкой.
    const stats = STAT_KEYS.filter((k) => k !== 'spd')
      .map((k) => `${STAT_LABELS[k]} ${formatNumber(before.stats[k])} → ${formatNumber(after.stats[k])}`)
      .join('   ');
    info.add(text(this, GAME_W / 2, y, stats, FS.small, C.positive, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 3 }));
    y += 60;
    const extra: { s: string; color: string }[] = [{ s: `Предел уровня ${before.card.maxLevel} → ${after.maxLevel}`, color: C.text }];
    if (jobChanged) extra.unshift({ s: `${after.name} — теперь ${after.jobName}!`, color: pal.light });
    if (skills.length) extra.push({ s: `Новый навык: ${skills.join(', ')}`, color: C.info });
    if (refund.exp || refund.gold) extra.push({ s: `Вернулось: опыт ${formatNumber(refund.exp)}, золото ${formatNumber(refund.gold)}`, color: C.muted });
    for (const e of extra) {
      const t = text(this, GAME_W / 2, y, e.s, FS.body, e.color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 3, wordWrap: { width: 980 } }).setOrigin(0.5, 0);
      t.setY(y - 20);
      info.add(t);
      y += Math.max(52, t.height + 12);
    }
    if (jobChanged) {
      const form = activeForm(heroTemplate(GAME, hero.templateId), hero);
      if (form.promotion) {
        const q = text(this, GAME_W / 2, y + 4, `«${form.promotion}»`, FS.caption, C.title, { fontStyle: 'italic', ...OUTLINE, wordWrap: { width: 940 }, lineSpacing: 4 }).setOrigin(0.5, 0);
        info.add(q);
        y += q.height + 20;
      }
    }
    // Строка вознесения на новую редкость (lore-route §5.8, поле героя ascendLines).
    const said = (heroTemplate(GAME, hero.templateId).ascendLines as Partial<Record<string, string>> | undefined)?.[hero.rarity];
    if (said) {
      const q = text(this, GAME_W / 2, y + 4, `«${said}»`, FS.caption, C.title, { fontStyle: 'italic', ...OUTLINE, wordWrap: { width: 940 }, lineSpacing: 4 }).setOrigin(0.5, 0).setName('ascendLine');
      info.add(q);
      y += q.height + 20;
    }
    const done = button(this, GAME_W / 2, Math.min(GAME_H - 130, Math.max(y + 90, CONTENT_BOTTOM - 70)), 520, 130, 'ui_btn_primary', 'Отлично!', () => this.scene.start('Hero', { heroId }), FS.h2);
    done.container.setName('revealDone').setAlpha(motion ? 0 : 1);
    layer.add([plus, done.container]);

    const finish = (newCard: Phaser.GameObjects.Container) => {
      sfx('rarity_up');
      haptic('levelUp');
      if (jobChanged) sfx('job_change', { delay: 0.6 });
      countUp(this, powerLine, before.power, power, (n) => `Мощь ${formatNumber(n)}`, { duration: 900, delay: motion ? 250 : 0 });
      if (!motion) {
        rays.setAlpha(0.4);
        halo.setAlpha(0.5);
        return;
      }
      this.cameras.main.shake(220, 0.006);
      // Вспышка цвета новой редкости, белое ядро, волна-кольцо.
      const flash = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, pal.tint, 0.85).setDepth(REVEAL_DEPTH + 10).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: flash, alpha: 0, duration: 520, onComplete: () => flash.destroy() });
      const core = this.add.image(GAME_W / 2, cy, glowTexture(this)).setDisplaySize(900, 900).setTint(0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(REVEAL_DEPTH + 11);
      this.tweens.add({ targets: core, alpha: 0, scale: core.scale * 1.6, duration: 600, onComplete: () => core.destroy() });
      for (let i = 0; i < 2; i++) {
        const ring = this.add.circle(GAME_W / 2, cy, 120).setStrokeStyle(14 - i * 5, pal.glow, 1).setDepth(REVEAL_DEPTH + 9);
        this.tweens.add({ targets: ring, scale: 5 + i * 2, alpha: 0, duration: 700 + i * 250, delay: i * 120, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
      }
      burst(this, { x: GAME_W / 2, y: cy });
      this.tweens.add({ targets: rays, alpha: 0.45, duration: 400 });
      this.tweens.add({ targets: rays, angle: 360, duration: 30000, repeat: -1 });
      this.tweens.add({ targets: halo, alpha: 0.6, duration: 400 });
      this.tweens.add({ targets: halo, alpha: 0.35, duration: 1100, delay: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: info, alpha: 1, duration: 350, delay: 150 });
      this.tweens.add({ targets: done.container, alpha: 1, duration: 300, delay: 1000 });
      plus.setScale(0.4);
      this.tweens.add({ targets: plus, alpha: 1, scale: 1, duration: 380, delay: 700, ease: 'Back.easeOut' });
      this.tweens.add({ targets: plus, y: plus.y - 24, duration: 1400, delay: 1080, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      void newCard;
    };
    const makeNew = () => drawHeroCard(this, GAME_W / 2, cy, hero, { w: W, figure: 'sprite', showIcons: false, glow: true });
    if (!motion) {
      oldCard.destroy();
      const nc = makeNew();
      layer.addAt(nc, layer.getIndex(info));
      finish(nc);
      return;
    }
    // Корм летит в карточку и растворяется; карточка дрожит, светится, переворачивается — и возвращается в новой рамке.
    this.tweens.add({ targets: shade, alpha: { from: 0, to: 0.94 }, duration: 250 });
    fodderFrom.forEach((p, i) => {
      const g = this.add.image(p.x, p.y, glowTexture(this)).setDisplaySize(220, 280).setTint(pal.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(REVEAL_DEPTH + 5);
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
            this.tweens.add({ targets: nc, scaleX: 1.12, duration: 200, ease: 'Cubic.easeOut', onComplete: () => this.tweens.add({ targets: nc, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.easeOut' }) });
            finish(nc);
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
