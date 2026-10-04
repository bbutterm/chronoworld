import Phaser from 'phaser';
import { BRANCH_RARITY, branchOptions, branchPreview, heroCard, heroTemplate, type BranchView, type CardRarity, type HeroState, type SaveState } from '../core';
import { CONTENT, GAME } from './content';
import { formatNumber, heroSprite, ROLE_NAMES, STAT_KEYS, STAT_LABELS } from './flow';
import { glowTexture, iconBadge, rarityPalette } from './heroCard';
import { juiceOn, pulse } from './juice';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { card, popIn, unitFigure } from './screen';
import { openSkillDetail } from './skillDetail';
import { skillIcon } from './skillIcons';
import { BTN, button, ellipsize, pressable, tag, text } from './ui';
import { C, COLOR, COLOR_N, FAMILY, FS, OUTLINE, S, T } from './theme';

/**
 * Выбор ветки второй профессии (docs/design/heroes-v2.md, разделы 3 и 5) — общий компонент вознесения синий →
 * фиолетовый, «Выбрать ветку» / «Сменить ветку» на карточке и «Контракта героя»: окно на весь экран, две большие
 * панели веток (фигура формы в стойке, класс, роль, строка возвышения, 4 навыка с иконками и описанием). Нажатие по
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
const PANEL_H = 1330;
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
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x07040c, 0.94).setInteractive();
  layer.add(shade);
  const close = () => {
    layer.destroy();
    opts.onCancel?.();
  };
  const t = GAME.content.heroes[opts.templateId];
  layer.add(text(scene, GAME_W / 2, 200, opts.title, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('branchTitle'));
  if (opts.subtitle) layer.add(text(scene, GAME_W / 2, 272, opts.subtitle, T.caption, COLOR.textSecondary, { wordWrap: { width: GAME_W - 2 * S.l } }).setMaxLines(2));

  let selected: string | null = opts.selected && opts.selected !== opts.current ? opts.selected : null;
  const highlights: { job: string; frame: Phaser.GameObjects.Rectangle; glow: Phaser.GameObjects.Image; mark: Phaser.GameObjects.Container }[] = [];
  const warn = text(scene, GAME_W / 2, BTN_Y - 110, '', T.caption, COLOR.warning, { fontStyle: 'bold', ...OUTLINE, wordWrap: { width: GAME_W - 2 * S.l } }).setName('branchWarning');
  layer.add(warn);
  let confirmBtn: ReturnType<typeof button> | null = null;
  const refresh = () => {
    for (const h of highlights) {
      const on = h.job === selected;
      h.frame.setStrokeStyle(on ? 8 : 3, on ? COLOR_N.gold : COLOR_N.border, on ? 1 : 0.8);
      h.glow.setAlpha(on ? 0.5 : 0);
      h.mark.setVisible(on);
    }
    const why = selected ? (opts.blocked?.(selected) ?? null) : null;
    const w = why ?? (selected && opts.heroId && opts.save ? branchRoleWarning(opts.save, opts.heroId, selected) : null);
    warn.setText(w ?? '');
    if (confirmBtn) {
      confirmBtn.setLabel(opts.confirmLabel?.(selected) ?? 'Выбрать');
      confirmBtn.setEnabled(!!selected && !why);
    }
  };

  branches.forEach((b, i) => {
    const x = GAME_W / 2 + (i === 0 ? -1 : 1) * (PANEL_W / 2 + PANEL_GAP / 2);
    const preview = branchPreview(opts.templateId, b.job, GAME, opts.save?.heroes.find(h => h.id === opts.heroId));
    const shown = preview.card.advanced ? b.advanced! : b;
    const h = branchPanel(scene, layer, x, { ...shown, job: b.job, jobName: preview.card.jobName }, t?.gender ?? 'm', opts.templateId, b.job === opts.current, branchStats(opts, b.job), preview.hero, b);
    highlights.push({ job: b.job, frame: h.frame, glow: h.glow, mark: h.mark });
    const pick = !opts.viewOnly && b.job !== opts.current;
    if (pick) {
      pressable(scene, h.frame, PANEL_W, PANEL_H, () => {
        selected = b.job;
        refresh();
      });
    }
    // Навык ветки: подробности поверх окна (и выбор этой ветки, как касание панели).
    for (const s of h.skillHits) {
      pressable(scene, s.hit, PANEL_W - 20, s.hit.height, () => {
        if (pick) {
          selected = b.job;
          refresh();
        }
        openSkillDetail(scene, s.skill, { note: `Ветка ${b.jobName} · ур. ${s.level}`, depth: DEPTH + 100 });
      });
    }
  });

  if (opts.viewOnly) {
    layer.add(button(scene, GAME_W / 2, BTN_Y, 460, BTN.l, '', 'Закрыть', close, T.heading, { sound: 'ui_back', variant: 'secondary' }).container.setName('branchClose'));
  } else {
    layer.add(button(scene, S.l + 170, BTN_Y, 340, BTN.l, '', 'Отмена', close, T.heading, { sound: 'ui_back', variant: 'secondary' }).container.setName('branchCancel'));
    confirmBtn = button(scene, GAME_W - S.l - 300, BTN_Y, 600, BTN.cta, '', 'Выбрать', () => {
      if (!selected || opts.blocked?.(selected)) return;
      const job = selected;
      layer.destroy();
      opts.onConfirm?.(job);
    }, T.heading, { variant: 'primary' });
    confirmBtn.container.setName('branchConfirm');
    layer.add(confirmBtn.container);
    if (!selected || !opts.blocked?.(selected)) pulse(scene, confirmBtn.container, 1.03);
  }
  refresh();
  popIn(scene, layer, shade);
  return layer;
}

/** Большая панель ветки: фигура, класс, роль, возвышение, навыки. Возвращает рамку (для нажатия и подсветки). */
function branchPanel(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  b: BranchView,
  gender: 'm' | 'f',
  templateId: string,
  isCurrent: boolean,
  stats: BranchStats | null = null,
  recipient?: HeroState,
  lineage?: BranchView,
): { frame: Phaser.GameObjects.Rectangle; glow: Phaser.GameObjects.Image; mark: Phaser.GameObjects.Container; skillHits: { skill: string; hit: Phaser.GameObjects.Rectangle; level: number }[] } {
  const rarity: CardRarity = recipient?.rarity ?? BRANCH_RARITY;
  const pal = rarityPalette(rarity);
  const cy = TOP + PANEL_H / 2;
  const glow = scene.add.image(x, cy, glowTexture(scene)).setDisplaySize(PANEL_W * 1.3, PANEL_H * 1.1).setTint(0xffd84a).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
  layer.add(glow);
  if (juiceOn()) scene.tweens.add({ targets: glow, scale: glow.scale * 1.04, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  layer.add(card(scene, x, cy, PANEL_W, PANEL_H));
  // Витрина цвета редкости под фигурой: длинная строка возвышения — витрина ниже, чтобы цитата влезла целиком.
  const quoteLines = b.promotion ? wrappedLines(scene, `«${b.promotion}»`, FS.caption, PANEL_W - 50, 'italic').length : 0;
  const showH = 380 - Math.max(0, Math.min(3, quoteLines - 2)) * 40;
  const showY = TOP + 20 + showH / 2;
  layer.add(scene.add.rectangle(x, showY, PANEL_W - 40, showH, pal.tint, 0.18));
  layer.add(scene.add.image(x, showY + 40, glowTexture(scene)).setDisplaySize(420, 360).setTint(pal.glow).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD));
  const feet = TOP + showH - 10;
  layer.add(scene.add.ellipse(x, feet + 4, 170, 34, 0x000000, 0.45));
  const sprite = heroSprite(recipient ?? { id: `branch_${b.job}`, templateId, rarity, level: 1, branch: b.job }, GAME);
  unitFigure(scene, sprite, x, feet, 320, {
    maxScale: 3,
    onReady: (o) => {
      if (!layer.scene) {
        o.destroy();
        return;
      }
      // Фигура грузится позже — встаёт под отметки «Сейчас»/«Выбрано» (иначе закрывает их).
      layer.add(o);
      for (const m of layer.list.filter((x) => x.name === 'branchMark')) layer.bringToTop(m);
    },
  });
  void gender;
  // Класс и роль.
  let y = TOP + showH + 60;
  layer.add(ellipsize(text(scene, x, y, b.jobName, FS.h1, pal.light, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 7 }), PANEL_W - 40).setName(`branchName_${b.job}`));
  y += 62;
  const job = CONTENT.jobs[b.job];
  const range = CONTENT.skills[job?.basic ?? '']?.range === 'melee' ? 'ближний бой' : 'дальний бой';
  const roleText = text(scene, x + 24, y, `${ROLE_NAMES[b.role] ?? b.role} · ${range}`, FS.small, C.text, { fontStyle: 'bold', ...OUTLINE });
  layer.add(iconBadge(scene, roleText.x - roleText.width / 2 - 30, y, b.role, 24, pal.tint));
  layer.add(roleText);
  y += 50;
  // BUG-065: статы героя в этой ветке (при смене ветки — разница с нынешней).
  if (stats) {
    const parts = STAT_KEYS.map((k) => {
      const d = stats.now ? stats.next[k] - stats.now[k] : 0;
      return `${STAT_LABELS[k]} ${formatNumber(stats.next[k])}${d ? ` (${d > 0 ? '+' : '−'}${formatNumber(Math.abs(d))})` : ''}`;
    });
    const st = text(scene, x, y - 6, `${parts[0]} · ${parts[1]}\n${parts[2]} · ${parts[3]}`, FS.caption, C.text, { ...OUTLINE, align: 'center', lineSpacing: -2 }).setOrigin(0.5, 0).setName(`branchStats_${b.job}`);
    if (st.width > PANEL_W - 30) st.setScale((PANEL_W - 30) / st.width);
    layer.add(st);
    y += st.displayHeight + 12;
  }
  if (b.promotion) {
    const p = text(scene, x, y, fitLines(scene, `«${b.promotion}»`, FS.caption, PANEL_W - 50, 5, 'italic'), FS.caption, C.title, { fontStyle: 'italic', ...OUTLINE, lineSpacing: 2 }).setOrigin(0.5, 0);
    layer.add(p);
    y += p.height + 18;
  }
  // Навыки формы (по уровню открытия).
  const left = x - PANEL_W / 2 + 26;
  const signature = (lineage?.advanced?.skills ?? b.skills).find(s => s.skill.startsWith('ro_'));
  const skills = [...(signature ? [signature] : b.skills.slice(-1)), ...(b.ult ? [{ skill: b.ult, level: 1 }] : [])];
  if (lineage?.advanced) {
    layer.add(text(scene, x, y, `${lineage.jobName} → ${lineage.advanced.jobName}\nЗолото · ур. 70 · далее 80 / красный 90, 100\n${b.skills.length} навыков · коснитесь навыка: подробнее`, FS.caption, C.text, { wordWrap: { width: PANEL_W - 45 } }).setOrigin(0.5, 0));
    y += 145;
  }
  const room = TOP + PANEL_H - 20 - y;
  const rowH = Math.min(170, Math.floor(room / Math.max(1, skills.length)));
  const rows: { skill: string; y: number; level: number }[] = [];
  for (const s of skills) {
    rows.push({ skill: s.skill, y: y + rowH / 2, level: s.level });
    const sk = CONTENT.skills[s.skill];
    const iy = y + 38;
    layer.add(scene.add.image(left + 38, iy, skillIcon(scene, sk)).setDisplaySize(68, 68));
    layer.add(text(scene, left + 38, iy + 54, `ур. ${s.level}`, T.caption, COLOR.textSecondary));
    layer.add(ellipsize(text(scene, left + 96, iy - 18, sk?.name ?? s.skill, T.caption, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5), PANEL_W - 126));
    if (sk?.description) {
      const lines = Math.max(1, Math.floor((rowH - 46) / 37));
      layer.add(text(scene, left + 96, iy + 4, fitLines(scene, sk.description, FS.caption, PANEL_W - 136, lines, 'normal', ' ›'), FS.caption, C.muted, { align: 'left', lineSpacing: 0 }).setOrigin(0, 0));
    }
    y += rowH;
  }
  // Рамка поверх (для нажатия и подсветки) и отметки.
  const frame = scene.add.rectangle(x, cy, PANEL_W, PANEL_H).setStrokeStyle(3, 0x5a4a30, 0.8).setName(`branchPanel_${b.job}`);
  layer.add(frame);
  // Строки навыков — поверх рамки: касание открывает полное описание (в панели оно обрезано).
  const skillHits = rows.map((r) => {
    const hit = scene.add.rectangle(x, r.y, PANEL_W - 20, rowH - 4, 0x000000, 0.001).setName(`branchSkill_${r.skill}`);
    layer.add(hit);
    return { skill: r.skill, hit, level: r.level };
  });
  const mark = tag(scene, x, TOP + 30, 'Выбрано', 'accent', { solid: true }).setVisible(false).setName('branchMark');
  layer.add(mark);
  if (isCurrent) layer.add(tag(scene, x, TOP + 30, 'Сейчас', 'positive', { solid: true }).setName('branchMark'));
  return { frame, glow, mark, skillHits };
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
