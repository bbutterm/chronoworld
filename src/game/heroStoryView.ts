import Phaser from 'phaser';
import { heroPeakLevel, heroStoryBranches, heroStoryGateLabel, heroStoryPieces, heroStoryUnread, heroTemplate, jobTitle, markHeroStoryRead, newlyOpenedStories, type HeroStoryEntry, type SaveState } from '../core';
import { sfx } from './audio';
import { haptic } from './haptics';
import { GAME, LORE } from './content';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { view } from './viewport';
import { commit, session } from './session';
import { SKIN } from './skin';
import { divider } from './storyPage';
import { BTN, button, ScrollArea, tag, text, toast } from './ui';
import { C, COLOR, FAMILY, M, S, T } from './theme';

/**
 * История героя кусочками (data/lore/hero_stories.json, ядро — src/core/lore/heroStories.ts): страница во весь экран.
 * Сначала общие кусочки (ур. 10–50), затем разделы веток второй профессии (ур. 60–100):
 * - своя ветка (на ней стоит копия героя) — все пять кусочков: открытые текстом, закрытые строкой «Ур. N · откроется…»;
 * - другая ветка — прочитанные раньше кусочки видны («дневник всех путей»: ветку сменили — прочитанное не пропадает),
 *   закрытые не показываются по одному, а одной строкой «ещё N частей — откроются на ветке X» (без спойлеров и без
 *   пяти одинаковых замков); героя без ветки — такие строки для обеих веток.
 * Только что открытые — «новое». Открытие страницы отмечает открытые кусочки прочитанными (save.heroStoryRead).
 * Вход — кнопка во вкладке «История» карточки героя и окно героя в Летописи (вкладка «Герои»).
 */

/** Имя слоя страницы (e2e ищет его). */
export const HERO_STORY_NAME = 'heroStory';
const DEPTH = 9600;
const TEXT_W = 940;
const LEFT = (GAME_W - TEXT_W) / 2;
/** Раскладка для поля 1080×1920; на вытянутых экранах (390×844) шапка поднимается, а список и кнопка опускаются в поля. */
const LIST_BOTTOM = 1690;
const BTN_Y = 1822;
/** Шрифт текста кусочка — T.body, межстрочный 1.4 (как страницы эпизода, storyPage.ts). */
const BODY_FS = T.body;
const BODY_LEADING = Math.round(T.body * 0.4);
/** Фон страницы (и затухание краёв списка). */
const BG = 0x07060a;

/** Есть ли у героя история кусочками. */
export const hasHeroStory = (templateId: string) => (LORE.heroStories[templateId]?.length ?? 0) > 0;

/** Сколько кусочков истории героя открыто и не прочитано (для отметки «новое»). */
export const heroStoryNew = (templateId: string, save: SaveState = session.save) => heroStoryUnread(save, templateId, LORE);

/**
 * «7 из 15» — открыто из пути героя: общие кусочки + кусочки его веток (героя без ветки — одной ветки) + прочитанные
 * кусочки других веток.
 */
export function heroStoryProgress(templateId: string, save: SaveState = session.save): { open: number; total: number } {
  const list = heroStoryPieces(save, templateId, LORE);
  const mine = heroStoryBranches(save, templateId);
  const firstBranch = list.find((p) => p.branch)?.branch;
  const counted = list.filter((p) => p.path !== 'other' || p.open || (!mine.length && p.branch === firstBranch));
  return { open: list.filter((p) => p.open).length, total: counted.length };
}

/**
 * Тост после повышения уровня: какие кусочки открылись (before → after). Ничего — false.
 */
export function toastOpenedStories(scene: Phaser.Scene, before: SaveState, after: SaveState, templateId: string): boolean {
  const fresh = newlyOpenedStories(before, after, templateId, LORE);
  if (!fresh.length) return false;
  toast(scene, `Открыта история: «${fresh.map((p) => p.title).join('», «')}»`, C.gold, 3500);
  return true;
}

export interface HeroStoryOptions {
  /** Список под страницей — не листать, пока она открыта. */
  lock?: ScrollArea;
  /** После закрытия (обновить отметки «новое»). */
  onClose?: () => void;
}

/** Открыть страницу истории героя templateId поверх экрана. */
export function openHeroStory(scene: Phaser.Scene, templateId: string, opts: HeroStoryOptions = {}): Phaser.GameObjects.Container {
  const t = heroTemplate(GAME, templateId);
  const pieces = heroStoryPieces(session.save, templateId, LORE);
  const fresh = new Set(pieces.filter((p) => p.open && !p.read).map((p) => p.key));
  if (fresh.size) commit(markHeroStoryRead(session.save, templateId, LORE));
  const cx = GAME_W / 2;
  const layer = scene.add.container(0, 0).setDepth(DEPTH).setName(HERO_STORY_NAME);
  if (opts.lock) opts.lock.locked = true;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (opts.lock) opts.lock.locked = false;
    layer.destroy();
    opts.onClose?.();
  };
  // Фон ловит все касания: экран под страницей недоступен.
  const back = scene.add.rectangle(cx, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, BG, 1).setInteractive();
  layer.add(back);
  // Безопасная область экрана в координатах мира: сверху до −BLEED_Y, снизу до GAME_H + BLEED_Y.
  const v = view();
  const dt = Math.max(-BLEED_Y, Math.min(0, v.safeTop));
  const db = Math.min(BLEED_Y, Math.max(0, v.safeBottom - GAME_H));
  const listBottom = LIST_BOTTOM + db;
  const btnY = BTN_Y + db;
  if (scene.textures.exists('skin_glow')) layer.add(scene.add.image(cx, 360 + dt, 'skin_glow').setDisplaySize(1300, 900).setTint(0xffc870).setAlpha(0.16).setBlendMode(Phaser.BlendModes.ADD));

  const progress = heroStoryProgress(templateId);
  let y = 160 + dt;
  const kicker = text(scene, cx, y, 'ИСТОРИЯ ГЕРОЯ', T.caption, SKIN.goldLight, { fontStyle: 'bold' });
  kicker.setLetterSpacing?.(6);
  layer.add(kicker);
  y += 50;
  const title = text(scene, cx, y, t.name, T.display, C.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0.5, 0).setName('heroStoryTitle');
  title.setShadow(0, 4, 'rgba(0,0,0,0.8)', 8, false, true);
  layer.add(title);
  y += title.height + S.xxs;
  const sub = text(scene, cx, y, pieces.length ? `Открыто ${progress.open} из ${progress.total} · новая часть — каждые 10 уровней` : 'Летописец ещё не записал эту историю', T.caption, COLOR.textSecondary, {
    wordWrap: { width: TEXT_W },
    align: 'center',
  }).setOrigin(0.5, 0);
  layer.add(sub);
  y += sub.height + S.m;
  layer.add(divider(scene, cx, y));

  // Список: общие кусочки, затем разделы веток (своя — первой). Открытые — уровень, заголовок, текст; закрытые своей
  // ветки и общие — строка «Ур. N · откроется…»; закрытые другой ветки — одна строка на ветку.
  // Список — сразу под разделителем шапки (подзаголовок может занять две строки).
  const listTop = y + 56;
  const area = new ScrollArea(scene, listTop, listBottom);
  let ly = 10;
  const branchName = (job: string) => jobTitle(GAME, job, t.gender);
  const nextClosed = new Map<string, HeroStoryEntry>();
  for (const p of pieces) if (!p.open && p.path !== 'other' && !nextClosed.has(p.branch ?? '')) nextClosed.set(p.branch ?? '', p);
  const hasBranch = heroStoryBranches(session.save, templateId).length > 0;

  const openPiece = (p: HeroStoryEntry) => {
    const head = text(scene, LEFT, ly, `Ур. ${p.level}`, T.caption, SKIN.goldLight, { fontStyle: 'bold' }).setOrigin(0, 0);
    area.add(head);
    if (fresh.has(p.key)) area.add(tag(scene, LEFT + head.width + S.xs, ly + head.height / 2, 'новое', 'accent', { solid: true, align: 'left' }).setName(`heroStoryNew_${p.key}`));
    ly += head.height + S.xxs;
    const tt = text(scene, LEFT, ly, p.title, T.title, C.title, { fontFamily: FAMILY.heading, fontStyle: 'bold', wordWrap: { width: TEXT_W } }).setOrigin(0, 0);
    area.add(tt);
    ly += tt.height + S.xs;
    const body = text(scene, LEFT, ly, p.text, BODY_FS, SKIN.cream, { align: 'left', wordWrap: { width: TEXT_W, useAdvancedWrap: true }, lineSpacing: BODY_LEADING })
      .setOrigin(0, 0)
      .setName(`heroStoryText_${p.key}`);
    area.add(body);
    ly += body.height + S.l;
  };
  const lockedLine = (p: HeroStoryEntry) => {
    const peak = heroPeakLevel(session.save, templateId, p.branch);
    const left = nextClosed.get(p.branch ?? '') === p ? Math.max(0, p.level - peak) : 0;
    // Два условия (BUG-167): уровень копии и место в кампании. Уровень есть — только «после главы N».
    const gate = !p.stageReached && p.unlockAfterStage ? heroStoryGateLabel(p.unlockAfterStage, GAME.content) : '';
    const how = p.levelReached ? `откроется ${gate}` : `откроется на ур. ${p.level}${left ? ` (ещё ${left} ур.)` : ''}${gate ? ` и ${gate}` : ''}`;
    const lock = text(scene, LEFT, ly, `Ур. ${p.level} · ${how}`, T.body, COLOR.textTertiary, { wordWrap: { width: TEXT_W } })
      .setOrigin(0, 0)
      .setName(`heroStoryLocked_${p.key}`);
    area.add(lock);
    ly += lock.height + S.m;
  };
  const section = (title: string, note: string, name: string) => {
    ly += 16;
    const head = text(scene, cx, ly, title, T.heading, SKIN.goldLight, { fontFamily: FAMILY.heading, fontStyle: 'bold', align: 'center', wordWrap: { width: TEXT_W } })
      .setOrigin(0.5, 0)
      .setName(name);
    area.add(head);
    ly += head.height + 6;
    if (note) {
      const n = text(scene, cx, ly, note, T.caption, COLOR.textSecondary, { align: 'center', wordWrap: { width: TEXT_W } }).setOrigin(0.5, 0);
      area.add(n);
      ly += n.height;
    }
    ly += 14;
    area.add(divider(scene, cx, ly));
    ly += 40;
  };

  for (const p of pieces.filter((q) => !q.branch)) (p.open ? openPiece(p) : lockedLine(p));
  const branches = [...new Set(pieces.filter((p) => p.branch).map((p) => p.branch!))];
  for (const b of branches) {
    const list = pieces.filter((p) => p.branch === b);
    const mine = list[0].path === 'mine';
    const opened = list.filter((p) => p.open);
    const closed = list.filter((p) => !p.open);
    const levels = `ур. ${list[0].level}–${list[list.length - 1].level}`;
    if (mine) section(`Путь: ${branchName(b)}`, `вторая профессия героя · ${levels}`, `heroStoryBranch_${b}`);
    else if (opened.length) section(`Другой путь: ${branchName(b)}`, 'прочитано раньше, на этой ветке', `heroStoryBranch_${b}`);
    if (mine) {
      for (const p of list) (p.open ? openPiece(p) : lockedLine(p));
      continue;
    }
    for (const p of opened) openPiece(p);
    if (!closed.length) continue;
    const what = opened.length ? `Ещё ${closed.length} ${closed.length === 1 ? 'часть' : closed.length < 5 ? 'части' : 'частей'}` : `${levels[0].toUpperCase()}${levels.slice(1)}`;
    const how = hasBranch
      ? `откроются на ветке «${branchName(b)}»`
      : `путь «${branchName(b)}»: откроется, когда герой выберет эту ветку (фиолетовая редкость)`;
    const line = text(scene, LEFT, ly, `${what} · ${how}`, T.body, COLOR.textTertiary, { wordWrap: { width: TEXT_W } })
      .setOrigin(0, 0)
      .setName(`heroStoryOther_${b}`);
    area.add(line);
    ly += line.height + S.m;
  }
  area.setContentHeight(ly + 10);
  layer.add(area.parts);
  // Нижний край полосы списка — мягкое затухание в фон, а не строка, срезанная посередине (сверху — свечение шапки,
  // сплошная полоса фона легла бы на него ступенькой).
  const FADE = 56;
  const fade = scene.add.graphics();
  fade.fillGradientStyle(BG, BG, BG, BG, 0, 0, 1, 1).fillRect(-BLEED_X, listBottom - FADE, GAME_W + 2 * BLEED_X, FADE);
  layer.add(fade);
  // Первый непрочитанный кусочек — сразу на экране.
  const firstFresh = [...fresh][0];
  if (firstFresh !== undefined) {
    const o = area.content.getByName(`heroStoryNew_${firstFresh}`) as Phaser.GameObjects.Container | null;
    if (o) area.offset = Math.max(0, o.y - 60);
  }
  const closeBtn = button(scene, cx, btnY, 520, BTN.cta, '', 'Закрыть', close, T.heading, { variant: 'secondary' });
  closeBtn.container.setName('heroStoryClose');
  const backBtn = button(scene, S.l + BTN.icon / 2, 70 + dt, BTN.icon, BTN.icon, '', '‹', close, T.title, { variant: 'icon' });
  backBtn.container.setName('heroStoryBack');
  layer.add([closeBtn.container, backBtn.container]);
  layer.setAlpha(0);
  scene.tweens.add({ targets: layer, alpha: 1, duration: M.base });
  sfx('ui_open');
  haptic('soft');
  return layer;
}

