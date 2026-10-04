import Phaser from 'phaser';
import { BRANCH_RARITY, branchOptions, branchPreview, heroCard, heroTemplate, type BranchView, type HeroState, type SaveState } from '../core';
import { CONTENT, GAME } from './content';
import { formatNumber, heroSprite, ROLE_NAMES, STAT_KEYS, STAT_LABELS } from './flow';
import { rarityPalette } from './heroCard';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { bottomSheet, popIn, popOut, registerModal, unitFigure } from './screen';
import { openSkillDetail } from './skillDetail';
import { skillIcon } from './skillIcons';
import { spriteView } from './sprites';
import { skillSummary } from './skillFacts';
import { BTN, button, ellipsize, plate, pressable, SURFACE, tag, text } from './ui';
import { C, COLOR, COLOR_N, FAMILY, R, S, T, TOUCH_COMFORT } from './theme';

/**
 * Выбор ветки второй профессии (docs/design/heroes-v2.md, разделы 3 и 5) — общий компонент вознесения синий →
 * фиолетовый, «Выбрать ветку» / «Сменить ветку» на карточке и «Контракта героя»: окно на весь экран, две большие
 * панели веток (фигура, роль, статы, ключевой навык и ульта). Лор и полный путь открываются отдельно. Нажатие по
 * панели — выбор (золотая рамка), внизу — «Отмена» и кнопка подтверждения. viewOnly — только посмотреть (превью веток
 * на синем): одна кнопка «Закрыть».
 */

export interface BranchPickerOptions {
  templateId: string;
  /** Заголовок окна («Выберите ветку»). */
  title: string;
  /** Подзаголовок (что будет: «Алан станет фиолетовым…»). */
  subtitle?: string;
  /** Текущая ветка (плашка «Сейчас», её не выбрать). */
  current?: string;
  /** Выбранная сразу. */
  selected?: string;
  /** Подпись кнопки подтверждения по выбранной ветке (null — не выбрана). */
  confirmLabel?: (job: string | null) => string;
  /** Почему подтвердить нельзя (не хватает гемов на смену) — кнопка серая, причина над ней; null — можно. */
  blocked?: (job: string | null) => string | null;
  /** Подтверждение (выбрана ветка job). */
  onConfirm?: (job: string) => void;
  /** Закрыть без выбора (по умолчанию — просто убрать окно). */
  onCancel?: () => void;
  /** Только посмотреть: одна кнопка «Закрыть». */
  viewOnly?: boolean;
  /** Экземпляр героя (для предупреждения «в отряде не останется лекаря»). */
  heroId?: string;
  save?: SaveState;
}

const DEPTH = 9200;
const PANEL_W = 504;
const PANEL_GAP = 24;
const TOP = 340;
const PANEL_H = 1280;
const BTN_Y = GAME_H - 120;

/** Роль в родительном падеже — «не останется лекаря». */
const ROLE_GEN: Record<string, string> = { tank: 'танка', damage: 'бойца урона', healer: 'лекаря', support: 'поддержки' };
/** Роль в творительном — «станет танком». */
const ROLE_INS: Record<string, string> = { tank: 'танком', damage: 'бойцом урона', healer: 'лекарем', support: 'поддержкой' };

/**
 * Предупреждение при выборе ветки со сменой роли: герой в отряде был единственным носителем своей роли —
 * «Вика станет танком — в отряде не останется лекаря». Нет отряда / роль та же — null.
 */
export function branchRoleWarning(save: SaveState, heroId: string, job: string): string | null {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero || !save.squad.includes(hero.id)) return null;
  const t = heroTemplate(GAME, hero.templateId);
  const target = t.branches.find((b) => b.job === job);
  if (!target) return null;
  const now = heroCard(hero, GAME).role;
  if (now === target.role) return null;
  const others = save.squad
    .filter((id): id is string => !!id && id !== hero.id)
    .map((id) => save.heroes.find((h) => h.id === id))
    .filter((h): h is HeroState => !!h && !!GAME.content.heroes[h.templateId])
    .map((h) => heroCard(h, GAME).role);
  if (others.includes(now)) return null;
  return `${t.name} станет ${ROLE_INS[target.role] ?? target.role} — в отряде не останется ${ROLE_GEN[now] ?? now}`;
}

/** Открыть окно выбора ветки. Возвращает слой (name `branchPicker`); закрытие — layer.destroy(). */
export function openBranchPicker(scene: Phaser.Scene, opts: BranchPickerOptions): Phaser.GameObjects.Container {
  const branches = branchOptions(opts.templateId, GAME);
  const layer = scene.add.container(0, 0).setDepth(DEPTH).setName('branchPicker');
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, COLOR_N.bg, 0.96).setInteractive();
  layer.add(shade);
  let finished = false;
  const close = () => {
    if (finished || !layer.scene) return;
    finished = true;
    popOut(scene, layer, opts.onCancel);
  };
  registerModal(layer, close);
  layer.add(text(scene, GAME_W / 2, 200, opts.title, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('branchTitle'));
  if (opts.subtitle) layer.add(text(scene, GAME_W / 2, 272, opts.subtitle, T.caption, COLOR.textSecondary, { wordWrap: { width: GAME_W - 2 * S.l } }).setMaxLines(2));

  let selected: string | null = opts.selected && opts.selected !== opts.current ? opts.selected : null;
  const highlights: { job: string; frame: Phaser.GameObjects.Rectangle; mark: Phaser.GameObjects.Container }[] = [];
  const warn = text(scene, GAME_W / 2, BTN_Y - 118, '', T.caption, COLOR.warning, { wordWrap: { width: GAME_W - 2 * S.l } }).setName('branchWarning');
  layer.add(warn);
  let confirmBtn: ReturnType<typeof button> | null = null;
  const refresh = () => {
    for (const h of highlights) {
      const on = h.job === selected;
      h.frame.setStrokeStyle(on ? 6 : 2, on ? COLOR_N.accent : COLOR_N.border, 1);
      h.mark.setVisible(on);
    }
    const why = selected ? (opts.blocked?.(selected) ?? null) : null;
    const w = why ?? (selected && opts.heroId && opts.save ? branchRoleWarning(opts.save, opts.heroId, selected) : null);
    warn.setText(w ?? '');
    if (confirmBtn) {
      confirmBtn.setLabel(opts.confirmLabel?.(selected) ?? 'Выбрать профессию');
      confirmBtn.setEnabled(!!selected && !why);
    }
  };

  const recipient = opts.save?.heroes.find(h => h.id === opts.heroId);
  branches.forEach((b, i) => {
    const x = GAME_W / 2 + (i === 0 ? -1 : 1) * (PANEL_W / 2 + PANEL_GAP / 2);
    const preview = branchPreview(opts.templateId, b.job, GAME, recipient);
    const shown = preview.card.advanced ? b.advanced! : b;
    const h = branchPanel(scene, layer, x, { ...shown, job: b.job, jobName: preview.card.jobName }, b.job === opts.current, branchStats(opts, b.job), preview.hero);
    highlights.push({ job: b.job, frame: h.frame, mark: h.mark });
    const pick = !opts.viewOnly && b.job !== opts.current;
    if (pick) pressable(scene, h.frame, PANEL_W, PANEL_H, () => {
      if (finished) return;
      selected = b.job;
      refresh();
    });
    for (const s of h.skillHits) pressable(scene, s.hit, PANEL_W - 2 * S.s, s.hit.height, () => {
      if (finished) return;
      openSkillDetail(scene, s.skill, { note: `${preview.card.jobName} · ур. ${s.level}`, ...(!s.ult && preview.hero.level < s.level ? { lockNote: `Откроется на ур. ${s.level}` } : {}), power: preview.card.rarity.skillPower, ult: s.ult, depth: DEPTH + 100 });
    });
    pressable(scene, h.details, PANEL_W - 2 * S.s, TOUCH_COMFORT, () => {
      if (!finished) branchDetails(scene, b, { ...shown, jobName: preview.card.jobName }, branchStats(opts, b.job), preview.hero);
    });
  });

  if (opts.viewOnly) {
    layer.add(button(scene, GAME_W / 2, BTN_Y, 460, BTN.l, '', 'Закрыть', close, T.heading, { sound: 'ui_back', variant: 'secondary' }).container.setName('branchClose'));
  } else {
    layer.add(button(scene, S.l + 170, BTN_Y, 340, BTN.l, '', 'Отмена', close, T.heading, { sound: 'ui_back', variant: 'secondary' }).container.setName('branchCancel'));
    confirmBtn = button(scene, GAME_W - S.l - 300, BTN_Y, 600, BTN.cta, '', 'Выбрать профессию', () => {
      if (finished || !selected) return;
      if (opts.blocked?.(selected)) {
        refresh();
        return;
      }
      finished = true;
      const job = selected;
      popOut(scene, layer, () => opts.onConfirm?.(job));
    }, T.heading, { variant: 'primary' });
    confirmBtn.container.setName('branchConfirm');
    layer.add(confirmBtn.container);
  }
  refresh();
  popIn(scene, layer, shade);
  return layer;
}

/** Сравнение без плавающего текста: фигура, роль, четыре стата и два ключевых навыка. */
function branchPanel(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  b: BranchView,
  isCurrent: boolean,
  stats: BranchStats | null,
  recipient: HeroState,
) {
  const pal = rarityPalette(recipient.rarity);
  const cy = TOP + PANEL_H / 2;
  layer.add(plate(scene, x, cy, PANEL_W, PANEL_H, { ...SURFACE.surface, border: COLOR.border, borderW: 2, r: R.l }));
  const frame = scene.add.rectangle(x, cy, PANEL_W, PANEL_H).setStrokeStyle(2, COLOR_N.border).setName(`branchPanel_${b.job}`);
  layer.add(frame);

  // Сразу в контейнер: асинхронный спрайт сохраняет локальные координаты после popIn.
  const figure = scene.add.container(x, TOP + 366).setName(`branchFigure_${b.job}`);
  layer.add(figure);
  figure.add(scene.add.ellipse(0, 0, 150, 28, COLOR_N.bg, 0.45));
  const spriteId = heroSprite(recipient, GAME);
  unitFigure(scene, spriteId, 0, 0, 264, {
    maxScale: 2.5,
    onReady: (o) => {
      if (!figure.scene || !layer.scene) { o.destroy(); return; }
      // Union bbox стойки включает оружие всех кадров; прозрачные поля клетки не уменьшают героя.
      const bbox = spriteView(scene, spriteId).def?.boxes?.idle;
      if (bbox) {
        const [x0, y0, x1, y1] = bbox;
        const k = Math.min(1, (PANEL_W - 2 * S.l) / Math.max(1, (x1 - x0) * o.scaleX), 264 / Math.max(1, (y1 - y0) * o.scaleY));
        o.setScale(o.scaleX * k);
        o.setPosition((o.displayOriginX - (x0 + x1) / 2) * o.scaleX, (o.displayOriginY - y1) * o.scaleY);
      } else {
        o.setScale(o.scaleX * Math.min(1, (PANEL_W - 2 * S.l) / Math.max(1, o.displayWidth), 264 / Math.max(1, o.displayHeight)));
        const bounds = o.getBounds();
        o.setPosition(o.x - bounds.centerX, o.y - bounds.bottom);
      }
      figure.add(o);
    },
  });
  layer.add(ellipsize(text(scene, x, TOP + 414, b.jobName, T.heading, pal.light, { fontStyle: 'bold' }), PANEL_W - 2 * S.s).setName(`branchName_${b.job}`));
  layer.add(text(scene, x, TOP + 476, ROLE_NAMES[b.role] ?? b.role, T.body, COLOR.textPrimary).setName(`branchRole_${b.job}`));
  const job = CONTENT.jobs[heroCard(recipient, GAME).job];
  const range = CONTENT.skills[job?.basic ?? '']?.range === 'melee' ? 'Ближний бой' : 'Дальний бой';
  layer.add(text(scene, x, TOP + 526, range, T.caption, COLOR.textSecondary));
  if (stats) {
    const values = STAT_KEYS.map(k => `${STAT_LABELS[k]} ${formatNumber(stats.next[k])}`);
    layer.add(text(scene, x, TOP + 580, `${values[0]} · ${values[1]}\n${values[2]} · ${values[3]}`, T.caption, COLOR.textPrimary, { lineSpacing: 10 }).setOrigin(0.5, 0).setName(`branchStats_${b.job}`));
  }
  const signature = b.skills.find(s => s.skill.startsWith('ro_')) ?? b.skills.at(-1);
  const skills = [...(signature ? [{ ...signature, ult: false }] : []), ...(b.ult ? [{ skill: b.ult, level: 1, ult: true }] : [])];
  const skillHits: { skill: string; hit: Phaser.GameObjects.Rectangle; level: number; ult: boolean }[] = [];
  const left = x - PANEL_W / 2 + S.s;
  skills.forEach((s, i) => {
    const top = TOP + 708 + i * 212;
    const sk = CONTENT.skills[s.skill];
    layer.add(text(scene, left, top, s.ult ? 'Ульта · полная энергия' : `Ключевой · ур. ${s.level}`, T.caption, s.ult ? COLOR.title : COLOR.textSecondary).setOrigin(0, 0));
    const locked = !s.ult && recipient.level < s.level;
    layer.add(scene.add.image(left + 42, top + 89, skillIcon(scene, sk)).setDisplaySize(76, 76).setAlpha(locked ? 0.5 : 1));
    const tx = left + 96;
    layer.add(text(scene, tx, top + 53, fitLines(scene, sk?.name ?? s.skill, T.caption, PANEL_W - 2 * S.s - 96, 2), T.caption, COLOR.textPrimary, { align: 'left', fontStyle: 'bold', lineSpacing: 2 }).setOrigin(0, 0).setName(`branchSkillName_${s.skill}`));
    layer.add(ellipsize(text(scene, left, top + 140, locked ? `Откроется на ур. ${s.level}` : skillSummary(sk, heroCard(recipient, GAME).rarity.skillPower), T.caption, COLOR.textSecondary).setOrigin(0, 0), PANEL_W - 2 * S.s).setName(`branchSkillSummary_${s.skill}`));
    layer.add(text(scene, x + PANEL_W / 2 - S.s, top + 88, '›', T.heading, COLOR.title));
    const hit = scene.add.rectangle(x, top + 96, PANEL_W - 2 * S.s, 192, COLOR_N.bg, 0.001).setName(`branchSkill_${s.skill}`);
    layer.add(hit);
    skillHits.push({ skill: s.skill, hit, level: s.level, ult: s.ult });
  });
  const details = scene.add.rectangle(x, TOP + 1198, PANEL_W - 2 * S.s, TOUCH_COMFORT, COLOR_N.surfaceRaised).setName(`branchDetails_${b.job}`);
  layer.add(details);
  layer.add(text(scene, x, TOP + 1198, 'Путь и все навыки ›', T.caption, COLOR.title));
  const mark = tag(scene, x, TOP + 38, 'Выбрано', 'accent', { solid: true }).setVisible(false).setName('branchMark');
  layer.add(mark);
  if (isCurrent) layer.add(tag(scene, x, TOP + 38, 'Сейчас', 'positive', { solid: true }).setName('branchMark'));
  return { frame, mark, skillHits, details };
}

/** Полный лор, изменения статов и будущий ранг доступны без обрезки в прокручиваемом листе. */
function branchDetails(scene: Phaser.Scene, lineage: BranchView, shown: BranchView, stats: BranchStats | null, recipient: HeroState): void {
  const sheet = bottomSheet(scene, shown.jobName, (box, width) => {
    let y = 0;
    const para = (value: string, color: string = COLOR.textSecondary) => {
      const row = text(scene, 0, y, value, T.body, color, { align: 'left', wordWrap: { width }, lineSpacing: 10 }).setOrigin(0, 0);
      box.add(row); y += row.height + S.m;
    };
    if (shown.promotion) para(shown.promotion, COLOR.title);
    if (shown.bio) para(shown.bio);
    if (stats) para('Базовые характеристики', COLOR.title);
    if (stats) para(STAT_KEYS.map(k => {
      const diff = stats.now ? stats.next[k] - stats.now[k] : 0;
      return `${STAT_LABELS[k]}: ${formatNumber(stats.next[k])}${diff ? ` (${diff > 0 ? '+' : '−'}${formatNumber(Math.abs(diff))})` : ''}`;
    }).join('\n'), COLOR.textPrimary);
    if (lineage.advanced) para(`${lineage.jobName} → ${lineage.advanced.jobName}\n${GAME.cards.rarities.find(r => r.id === lineage.advanced!.minRarity)?.name ?? lineage.advanced.minRarity} · уровень ${lineage.advanced.minLevel}`);
    para('Навыки профессии', COLOR.title);
    const all = [...(shown.ult ? [{ skill: shown.ult, level: 1, ult: true }] : []), ...shown.skills.map(s => ({ ...s, ult: false }))];
    for (const sk of all) {
      const label = CONTENT.skills[sk.skill]?.name ?? sk.skill;
      const btn = button(scene, width / 2, y + TOUCH_COMFORT / 2, width, TOUCH_COMFORT, '', `${sk.ult ? 'Ульта' : `Ур. ${sk.level}`} · ${label}`, () => openSkillDetail(scene, sk.skill, { ult: sk.ult, power: heroCard(recipient, GAME).rarity.skillPower, ...(!sk.ult && recipient.level < sk.level ? { lockNote: `Откроется на ур. ${sk.level}` } : {}), depth: DEPTH + 200 }), T.caption, { variant: 'secondary' });
      btn.container.setName(`branchDetailSkill_${sk.skill}`);
      ellipsize(btn.label, width - 2 * S.m);
      box.add(btn.container); y += TOUCH_COMFORT + S.xs;
    }
    return y;
  });
  sheet.layer.setDepth(DEPTH + 100).setName('branchDetailsSheet');
}

type StatsOf = ReturnType<typeof heroCard>['stats'];
interface BranchStats {
  next: StatsOf;
  /** Нынешняя ветка героя (смена ветки) — для разницы; первая ветка — без разницы. */
  now: StatsOf | null;
}

/** Статы героя opts.heroId в ветке job (null — окно без героя: «Контракт героя»). */
function branchStats(opts: BranchPickerOptions, job: string): BranchStats | null {
  const hero = opts.heroId && opts.save ? opts.save.heroes.find((h) => h.id === opts.heroId) : undefined;
  if (!hero || !GAME.content.heroes[hero.templateId]) return null;
  try {
    // Ветку выбирают при вознесении в фиолетовый: статы — уже на фиолетовом (как после вознесения).
    const ids = GAME.cards.rarities.map((r) => r.id);
    const rarity = ids.indexOf(hero.rarity) < ids.indexOf(BRANCH_RARITY) ? BRANCH_RARITY : hero.rarity;
    const next = heroCard({ ...hero, rarity, branch: job }, GAME).stats;
    const now = opts.current && hero.branch && job !== opts.current ? heroCard(hero, GAME).stats : null;
    return { next, now };
  } catch {
    return null;
  }
}

/** Строки текста после переноса по ширине width (шрифт FS, стиль fontStyle). */
function wrappedLines(scene: Phaser.Scene, value: string, size: number, width: number, fontStyle = 'normal'): string[] {
  const probe = text(scene, -9999, -9999, value, size, C.text, { fontStyle, wordWrap: { width } });
  const lines = probe.getWrappedText(value);
  probe.destroy();
  return lines;
}

/**
 * MT-09: текст в maxLines строк без обрыва на полуслове — если не влезает, последняя строка укорачивается по словам и
 * заканчивается «…» (и more — «подробнее ›», когда полный текст открывается касанием).
 */
function fitLines(scene: Phaser.Scene, value: string, size: number, width: number, maxLines: number, fontStyle = 'normal', more = ''): string {
  const lines = wrappedLines(scene, value, size, width, fontStyle);
  if (lines.length <= maxLines) return lines.join('\n');
  const keep = lines.slice(0, maxLines);
  const words = keep[maxLines - 1].trim().split(/\s+/);
  const probe = text(scene, -9999, -9999, '', size, C.text, { fontStyle });
  const line = () => `${words.join(' ').replace(/[,.:;—-]+$/, '')}…${more}`;
  probe.setText(line());
  while (words.length > 1 && probe.width > width) {
    words.pop();
    probe.setText(line());
  }
  const last = line();
  probe.destroy();
  keep[maxLines - 1] = last;
  return keep.join('\n');
}
