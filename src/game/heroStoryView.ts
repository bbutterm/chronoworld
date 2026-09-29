import Phaser from 'phaser';
import { heroPeakLevel, heroStoryPieces, heroStoryUnread, heroTemplate, markHeroStoryRead, newlyOpenedStories, type SaveState } from '../core';
import { sfx } from './audio';
import { haptic } from './haptics';
import { GAME, LORE } from './content';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { commit, session } from './session';
import { SKIN, SKIN_TINT } from './skin';
import { divider } from './storyPage';
import { button, ScrollArea, text, toast } from './ui';
import { C, FS, OUTLINE, TINT, TOUCH } from './theme';

/**
 * История героя кусочками (data/lore/hero_stories.json, ядро — src/core/lore/heroStories.ts): страница во весь экран
 * со списком кусочков — открытые (уровень, заголовок, текст; только что открытые — «новое»), закрытые — «Откроется на
 * ур. N». Открытие страницы отмечает открытые кусочки прочитанными (save.heroStoryRead). Вход — кнопка во вкладке
 * «История» карточки героя и окно героя в Летописи (вкладка «Герои»).
 */

/** Имя слоя страницы (e2e ищет его). */
export const HERO_STORY_NAME = 'heroStory';
const DEPTH = 9600;
const TEXT_W = 940;
const LEFT = (GAME_W - TEXT_W) / 2;
const LIST_TOP = 510;
const LIST_BOTTOM = 1690;
const BTN_Y = 1822;
/** Шрифт текста кусочка: крупнее основного (на 390×844 ≈ 15 px). */
const BODY_FS = 40;

/** Есть ли у героя история кусочками. */
export const hasHeroStory = (templateId: string) => (LORE.heroStories[templateId]?.length ?? 0) > 0;

/** Сколько кусочков истории героя открыто и не прочитано (для отметки «новое»). */
export const heroStoryNew = (templateId: string, save: SaveState = session.save) => heroStoryUnread(save, templateId, LORE);

/** «3 / 10» — открыто из всего. */
export function heroStoryProgress(templateId: string, save: SaveState = session.save): { open: number; total: number } {
  const list = heroStoryPieces(save, templateId, LORE);
  return { open: list.filter((p) => p.open).length, total: list.length };
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

/** Красная точка «новое» с книжкой (кусочек истории открыт и не прочитан). */
export function storyDot(scene: Phaser.Scene, x: number, y: number, r = 20): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y).setName('storyDot');
  const disc = scene.add.circle(0, 0, r, TINT.badge).setStrokeStyle(Math.max(2, r / 6), 0xffffff);
  const g = scene.add.graphics();
  // Раскрытая книжка: две страницы с приподнятыми внешними краями и корешок.
  const w = r * 0.62;
  const h = r * 0.6;
  const lift = r * 0.16;
  const V = Phaser.Math.Vector2;
  g.fillStyle(0xffffff, 1);
  g.fillPoints([new V(-1, -h / 2 + lift), new V(-w, -h / 2), new V(-w, h / 2 - lift), new V(-1, h / 2)], true);
  g.fillPoints([new V(1, -h / 2 + lift), new V(w, -h / 2), new V(w, h / 2 - lift), new V(1, h / 2)], true);
  c.add([disc, g]);
  return c;
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
  const fresh = new Set(pieces.filter((p) => p.open && !p.read).map((p) => p.level));
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
  const back = scene.add.rectangle(cx, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x07060a, 1).setInteractive();
  layer.add(back);
  if (scene.textures.exists('skin_glow')) layer.add(scene.add.image(cx, 360, 'skin_glow').setDisplaySize(1300, 900).setTint(0xffc870).setAlpha(0.16).setBlendMode(Phaser.BlendModes.ADD));

  const open = pieces.filter((p) => p.open).length;
  let y = 160;
  const kicker = text(scene, cx, y, 'ИСТОРИЯ ГЕРОЯ', FS.h3, SKIN.goldLight, { fontStyle: 'bold', ...OUTLINE });
  kicker.setLetterSpacing?.(6);
  layer.add(kicker);
  y += 66;
  const title = text(scene, cx, y, t.name, FS.hero + 12, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 }).setOrigin(0.5, 0).setName('heroStoryTitle');
  layer.add(title);
  y += title.height + 6;
  const sub = text(scene, cx, y, pieces.length ? `Открыто ${open} из ${pieces.length} · новая часть — каждые 10 уровней` : 'Летописец ещё не записал эту историю', FS.body, SKIN.cream, {
    fontStyle: 'italic',
    ...OUTLINE,
    wordWrap: { width: TEXT_W },
    align: 'center',
  }).setOrigin(0.5, 0);
  layer.add(sub);
  y += sub.height + 30;
  layer.add(divider(scene, cx, y));

  // Список кусочков: открытые — уровень, заголовок, текст; закрытые — одна строка «Откроется на ур. N».
  const area = new ScrollArea(scene, LIST_TOP, LIST_BOTTOM);
  let ly = 10;
  const nextClosed = pieces.find((p) => !p.open);
  for (const p of pieces) {
    if (p.open) {
      const head = text(scene, LEFT, ly, `Ур. ${p.level}`, FS.body, SKIN.goldLight, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0);
      area.add(head);
      if (fresh.has(p.level)) {
        const tagText = text(scene, 0, 0, 'новое', FS.caption - 4, C.text, { fontStyle: 'bold' });
        const tag = scene.add.container(LEFT + head.width + 24 + (tagText.width + 28) / 2, ly + head.height / 2, [
          scene.add.rectangle(0, 0, tagText.width + 28, 40, TINT.badge).setStrokeStyle(3, 0xffffff),
          tagText,
        ]).setName(`heroStoryNew_${p.level}`);
        area.add(tag);
      }
      ly += head.height + 4;
      const tt = text(scene, LEFT, ly, p.title, FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 8, wordWrap: { width: TEXT_W } }).setOrigin(0, 0);
      area.add(tt);
      ly += tt.height + 14;
      const body = text(scene, LEFT, ly, p.text, BODY_FS, SKIN.cream, { align: 'left', wordWrap: { width: TEXT_W, useAdvancedWrap: true }, lineSpacing: 14 })
        .setOrigin(0, 0)
        .setName(`heroStoryText_${p.level}`);
      area.add(body);
      ly += body.height + 36;
      area.add(scene.add.rectangle(cx, ly, TEXT_W * 0.6, 3, SKIN_TINT.gold, 0.35));
      ly += 40;
    } else {
      const left = p === nextClosed ? Math.max(0, p.level - heroPeakLevel(session.save, templateId)) : 0;
      const lock = text(scene, LEFT, ly, `Ур. ${p.level} · Откроется на ур. ${p.level}${left ? ` (ещё ${left} ур.)` : ''}`, FS.h3, C.dim, { ...OUTLINE, wordWrap: { width: TEXT_W } })
        .setOrigin(0, 0)
        .setName(`heroStoryLocked_${p.level}`);
      area.add(lock);
      ly += lock.height + 34;
    }
  }
  area.setContentHeight(ly + 10);
  layer.add(area.parts);
  if (ly > LIST_BOTTOM - LIST_TOP) layer.add(text(scene, cx, LIST_BOTTOM + 22, '⇅ листайте', FS.caption, SKIN.creamDim, OUTLINE));
  // Первый непрочитанный кусочек — сразу на экране.
  const firstFresh = [...fresh][0];
  if (firstFresh !== undefined) {
    const o = area.content.getByName(`heroStoryNew_${firstFresh}`) as Phaser.GameObjects.Container | null;
    if (o) area.offset = Math.max(0, o.y - 60);
  }
  const closeBtn = button(scene, cx, BTN_Y, 520, 140, 'ui_btn_primary', 'Закрыть', close, FS.h2);
  closeBtn.container.setName('heroStoryClose');
  const backBtn = button(scene, 170, 70, 280, TOUCH, 'k:buttonLong_beige', '‹ Назад', close, FS.h3);
  backBtn.container.setName('heroStoryBack');
  layer.add([closeBtn.container, backBtn.container]);
  layer.setAlpha(0);
  scene.tweens.add({ targets: layer, alpha: 1, duration: 220 });
  sfx('ui_open');
  haptic('soft');
  return layer;
}

