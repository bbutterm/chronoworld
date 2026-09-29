import Phaser from 'phaser';
import { featureUnlocked, lockedText, markUnlocksSeen, pendingUnlocks, unlockDef, type FeatureId, type FeatureView } from '../core';
import { GAME } from './content';
import { glow, medallion, ribbon, slowRays } from './decor';
import { GAME_H, GAME_W } from './layout';
import { card, CONTENT_TOP, popIn } from './screen';
import { commit, session } from './session';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from './skin';
import { speedGate } from './state';
import { mugIcon } from './tavernEntry';
import { C, FS, OUTLINE, TITLE_STYLE } from './theme';
import { button, pressable, text, toast } from './ui';
import { haptic } from './haptics';

/**
 * Открытие функций по этапам (data/unlocks.json, ядро — src/core/unlocks): замки на закрытом («Откроется на этапе 1-8»,
 * касание — тост) и полноэкранный баннер «Новая функция!» один раз на функцию (save.seenUnlocks).
 * Экраны зовут одной строкой: showUnlockBanners — страницы «Кампания», «Город», «Приключения» и итоги боя;
 * lockCover / lockedToast — замки. «Перейти» ведёт прямо на экран функции, его «Назад» — на её страницу навигации.
 */

/** Имя слоя баннера (e2e закрывает его «Позже»). */
export const UNLOCK_BANNER_NAME = 'unlockBanner';
const DEPTH = 9000;

/** Куда ведёт «Перейти» (быстрые награды — на странице «Кампания»). */
const GOTO: Record<FeatureId, { scene: string; data?: object }> = {
  fast_rewards: { scene: 'Campaign' },
  quests: { scene: 'Quests' },
  speed_x2: { scene: 'Campaign' },
  achievements: { scene: 'Achievements', data: { from: 'Home' } },
  tavern: { scene: 'Tavern' },
  bounties: { scene: 'Expeditions' },
  tower: { scene: 'Tower' },
  hunt: { scene: 'Hunt' },
  shop: { scene: 'Shop' },
  refine: { scene: 'Heroes' },
};

/** Функция открыта у текущего игрока. */
export const isUnlocked = (id: FeatureId): boolean => featureUnlocked(session.save, id, GAME);

/** «Откроется на этапе 1-8» или '' (открыта). */
export const lockLabel = (id: FeatureId): string => lockedText(session.save, id, GAME);

/** Тост на касание закрытого: «Экспедиции откроются на этапе 1-8». */
export function lockedToast(scene: Phaser.Scene, id: FeatureId): void {
  const title = unlockDef(id, GAME)?.title;
  const label = lockLabel(id);
  toast(scene, title ? `${title}: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label);
}

/** Скорость ×2 в бою (state.ts → speedGate): закрыта до своего этапа, касание «1x» — тост. Вызывается один раз из main.ts. */
export function installUnlockGates(game: Phaser.Game): void {
  speedGate.open = () => isUnlocked('speed_x2');
  speedGate.onLocked = () => {
    const top = game.scene.getScenes(true)[0];
    if (top) lockedToast(top, 'speed_x2');
  };
}

/**
 * Закрытая карточка (центр x, y; размер w×h): затемнение поверх, замок и «Откроется на этапе 1-2» по центру;
 * касание — тост. Кнопки под затемнением не нажимаются.
 */
export function lockCover(scene: Phaser.Scene, x: number, y: number, w: number, h: number, id: FeatureId): Phaser.GameObjects.Container {
  const shade = scene.add.rectangle(0, 0, w - 12, h - 12, 0x0b0a08, 0.88);
  const label = text(scene, 26, 0, lockLabel(id), FS.h3, C.muted, { ...OUTLINE, fontStyle: 'bold' });
  const lock = scene.add.image(26 - label.width / 2 - 36, -2, skinIcon('lock')).setDisplaySize(48, 48).setTint(SKIN_TINT.gold);
  const c = scene.add.container(x, y, [shade, lock, label]).setDepth(30).setName(`lock_${id}`);
  pressable(scene, shade, w - 12, h - 12, () => lockedToast(scene, id));
  return c;
}

/** Экран закрытой функции (зашли в обход главной): замок, название, «Откроется на этапе…». */
export function lockedScreen(scene: Phaser.Scene, id: FeatureId): void {
  const cy = CONTENT_TOP + 520;
  card(scene, GAME_W / 2, cy, 900, 520);
  medallion(scene, GAME_W / 2, cy - 110, 180, 'lock', SKIN_TINT.creamDim);
  text(scene, GAME_W / 2, cy + 50, unlockDef(id, GAME)?.title ?? '', FS.h1, C.title, TITLE_STYLE);
  text(scene, GAME_W / 2, cy + 130, lockLabel(id), FS.body, C.muted, OUTLINE);
}

/**
 * Показать баннеры «Новая функция!» для открытых, но не показанных функций — по одному, в порядке таблицы.
 * «Позже» — следующий баннер (после последнего — onDone), «Перейти» — экран функции (остальные баннеры покажутся там,
 * где их позовут). Каждый показанный отмечается в сохранении. Нечего показать или баннер уже открыт — onDone сразу.
 * Возвращает true, если баннер открыт.
 */
export function showUnlockBanners(scene: Phaser.Scene, onDone: () => void = () => {}): boolean {
  const queue = pendingUnlocks(session.save, GAME);
  if (!queue.length || scene.children.getByName(UNLOCK_BANNER_NAME)) {
    onDone();
    return false;
  }
  const next = () => {
    const f = queue.shift();
    if (!f) {
      onDone();
      return;
    }
    banner(scene, f, queue.length, (go) => {
      commit(markUnlocksSeen(session.save, [f.id]));
      if (!go) {
        next();
        return;
      }
      const to = GOTO[f.id];
      scene.scene.start(to.scene, to.data);
    });
  };
  next();
  return true;
}

/** Имя говорящего для реплики line (спикер garret из data/story). */
function garretName(): string {
  for (const ch of Object.values(GAME.story.chapters)) if (ch.speakers.garret) return ch.speakers.garret.name;
  return 'Капитан Гаррет';
}

/**
 * Иконка функции на баннере: медальон скина и свой знак у каждой функции (не общая «стрелка»):
 * быстрые награды — сундук, задания — свиток, скорость — надпись «2x», достижения — кубок, Таверна — кружка,
 * экспедиции — карта, Башня — башня. Неизвестная функция — иконка из data/unlocks.json (icon).
 */
export function featureIcon(scene: Phaser.Scene, f: Pick<FeatureView, 'id' | 'icon'>, x: number, y: number, size: number): Phaser.GameObjects.Container {
  const disc = scene.add.image(0, 0, 'skin_medallion').setDisplaySize(size, size);
  const c = scene.add.container(x, y, [disc]);
  const glyph = (icon: SkinIcon) => c.add(scene.add.image(0, 0, skinIcon(icon)).setDisplaySize(size * 0.5, size * 0.5).setTint(SKIN_TINT.gold));
  switch (f.id) {
    case 'fast_rewards':
      // Сундук из арта главной (полный), без него — сундук скина.
      if (scene.textures.exists('ui_chest_full')) c.add(scene.add.image(0, size * 0.02, 'ui_chest_full').setDisplaySize(size * 0.62, size * 0.62));
      else glyph('chest');
      break;
    case 'speed_x2': {
      const t = text(scene, 0, -2, '2x', Math.round(size * 0.36), SKIN.goldLight, { fontStyle: 'bold', stroke: '#1a0806', strokeThickness: 8 });
      t.setShadow(0, 4, 'rgba(0,0,0,0.6)', 3, true, false);
      c.add(t);
      break;
    }
    case 'tavern':
      c.add(mugIcon(scene, 0, -size * 0.02, size * 0.5));
      break;
    case 'quests':
      glyph('scroll');
      break;
    case 'achievements':
      glyph('trophy');
      break;
    case 'bounties':
      glyph('map');
      break;
    case 'tower':
      glyph('tower');
      break;
    default:
      if (f.icon === 'mug') c.add(mugIcon(scene, 0, -size * 0.02, size * 0.5));
      else glyph(f.icon as SkinIcon);
  }
  return c;
}

const BOX_W = 940;
const ICON = 240;

function banner(scene: Phaser.Scene, f: FeatureView, more: number, close: (go: boolean) => void): void {
  const cx = GAME_W / 2;
  // data: id и заголовок функции — для e2e (popIn переносит содержимое во вложенный контейнер).
  const layer = scene.add.container(0, 0).setDepth(DEPTH).setName(UNLOCK_BANNER_NAME).setData({ id: f.id, title: f.title });
  // Шторка ловит все касания: под баннером ничего не нажимается.
  const shade = scene.add.rectangle(cx, GAME_H / 2, GAME_W * 2, GAME_H * 2, 0x000000, 0.82).setInteractive();
  layer.add(shade);

  // Тексты создаются сразу (нужна их высота), окно — по содержимому: без пустого провала над кнопками.
  const title = text(scene, cx, 0, f.title, FS.hero, C.title, TITLE_STYLE);
  const stage = text(scene, cx, 0, `Открыто за этап ${f.stageLabel}`, FS.small, C.gold, OUTLINE);
  const desc = text(scene, cx, 0, f.description, FS.body, C.text, { ...OUTLINE, wordWrap: { width: 820 }, align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0);
  const who = f.line ? text(scene, cx, 0, garretName(), FS.small, C.gold, { ...OUTLINE, fontStyle: 'bold' }) : null;
  const line = f.line
    ? text(scene, cx, 0, `«${f.line}»`, FS.small, C.muted, { ...OUTLINE, fontStyle: 'italic', wordWrap: { width: 800 }, align: 'center' }).setOrigin(0.5, 0)
    : null;
  // Медальон наполовину заходит на верх окна (как в AFK): текст начинается под ним.
  const PAD_TOP = ICON / 2 + 50;
  const BTN_H = 120;
  const lineH = who && line ? 36 + 26 + line.height : 0;
  const boxH = PAD_TOP + 128 + desc.height + lineH + 48 + BTN_H + 50;
  // Всё вместе (лента над медальоном, окно, «Ещё новых функций») — по центру экрана.
  const above = ICON / 2 + 150;
  const below = more > 0 ? 70 : 0;
  const boxTop = Math.round((GAME_H - (above + boxH + below)) / 2 + above - 20);
  const iconY = boxTop;

  layer.add(slowRays(scene, cx, iconY, 900, 0.5));
  layer.add(glow(scene, cx, iconY, 520, 0xffd27a, 0.55, true));
  layer.add(card(scene, cx, boxTop + boxH / 2, BOX_W, boxH));
  layer.add(ribbon(scene, cx, iconY - ICON / 2 - 60, 'Новая функция!', { size: FS.h1, minW: 560 }));
  layer.add(featureIcon(scene, f, cx, iconY, ICON));

  let y = boxTop + PAD_TOP + 30;
  layer.add(title.setY(y));
  y += 64;
  layer.add(stage.setY(y));
  y += 34;
  layer.add(desc.setY(y));
  y += desc.height;
  if (who && line) {
    y += 36;
    layer.add([who.setY(y), line.setY(y + 26)]);
    y += 26 + line.height;
  }
  const by = boxTop + boxH - 50 - BTN_H / 2;
  const done = (go: boolean) => {
    layer.destroy();
    close(go);
  };
  layer.add(button(scene, cx - 215, by, 380, BTN_H, 'k:buttonLong_beige', 'Позже', () => done(false), FS.h2).container);
  layer.add(button(scene, cx + 215, by, 380, BTN_H, 'ui_btn_primary', 'Перейти', () => done(true), FS.h2).container);
  if (more > 0) layer.add(text(scene, cx, boxTop + boxH + 44, `Ещё новых функций: ${more}`, FS.small, C.muted, OUTLINE));
  haptic('unlock');
  popIn(scene, layer, shade);
}
