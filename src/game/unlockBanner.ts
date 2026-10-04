import Phaser from 'phaser';
import { featureUnlocked, lockedText, markUnlocksSeen, pendingUnlocks, unlockDef, type FeatureId, type FeatureView } from '../core';
import { GAME } from './content';
import { glow, medallion, slowRays } from './decor';
import { GAME_H, GAME_W } from './layout';
import { card, CONTENT_TOP, popIn } from './screen';
import { commit, session } from './session';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from './skin';
import { speedGate } from './state';
import { mugIcon } from './tavernEntry';
import { C, COLOR, FS, leading, OUTLINE, R, S, T, TITLE_STYLE } from './theme';
import { unlockTagline } from './tipTexts';
import { BTN, button, clampLines, plate, pressable, SURFACE, text, toast } from './ui';
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
  autobattler: { scene: 'Autobattler' },
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

const BOX_W = 860;
const ICON = 220;
/** Касание мимо окна в первые мс после показа не закрывает баннер (хвост тапа, который открыл экран). */
const SHADE_GUARD_MS = 500;

/**
 * Баннер «Новая функция!» — «момент» (§3 п. 10): лучи и медальон функции, название, одна строка, одна главная кнопка
 * «Перейти» и тихая «Позже». Без пересказа правил, номера этапа и реплик (подробности — на экране функции).
 * Касание мимо окна — то же «Позже»: баннер никогда не запирает экран под ним (итоги боя и их «Дальше»).
 */
function banner(scene: Phaser.Scene, f: FeatureView, more: number, close: (go: boolean) => void): void {
  const cx = GAME_W / 2;
  // data: id и заголовок функции — для e2e (popIn переносит содержимое во вложенный контейнер).
  const layer = scene.add.container(0, 0).setDepth(DEPTH).setName(UNLOCK_BANNER_NAME).setData({ id: f.id, title: f.title });
  // Шторка ловит касания: под баннером ничего не нажимается, а касание мимо окна — «Позже».
  const shade = scene.add.rectangle(cx, GAME_H / 2, GAME_W * 2, GAME_H * 2, 0x000000, 0.8).setInteractive();
  layer.add(shade);

  const kicker = text(scene, cx, 0, 'Новая функция', T.caption, COLOR.accent, { fontStyle: 'bold' }).setOrigin(0.5, 0);
  const title = text(scene, cx, 0, f.title, T.title, COLOR.title, { fontStyle: 'bold' }).setOrigin(0.5, 0);
  const line = clampLines(
    text(scene, cx, 0, unlockTagline(f.description), T.body, COLOR.textSecondary, {
      wordWrap: { width: BOX_W - 2 * S.xl, useAdvancedWrap: true },
      align: 'center',
      lineSpacing: leading(T.body),
    }).setOrigin(0.5, 0),
    2,
  );
  // Медальон наполовину заходит на верх окна (как в AFK): текст начинается под ним.
  const PAD_TOP = ICON / 2 + S.m;
  const CTA_W = 560;
  const LATER_H = BTN.m;
  const boxH = PAD_TOP + kicker.height + S.xxs + title.height + S.s + line.height + S.xl + BTN.cta + S.xs + LATER_H + S.s;
  const below = more > 0 ? 80 : 0;
  const boxTop = Math.round((GAME_H - (ICON / 2 + boxH + below)) / 2 + ICON / 2);
  const iconY = boxTop;

  layer.add(slowRays(scene, cx, iconY, 820, 0.45));
  layer.add(glow(scene, cx, iconY, 480, 0xffd27a, 0.5, true));
  // Окно ловит касания само: касание по окну мимо кнопок — не «Позже».
  const box = plate(scene, cx, boxTop + boxH / 2, BOX_W, boxH, { ...SURFACE.raised, r: R.xl }).setInteractive();
  layer.add(box);
  layer.add(featureIcon(scene, f, cx, iconY, ICON));

  let y = boxTop + PAD_TOP;
  layer.add(kicker.setY(y));
  y += kicker.height + S.xxs;
  layer.add(title.setY(y));
  y += title.height + S.s;
  layer.add(line.setY(y));

  let closed = false;
  const done = (go: boolean) => {
    if (closed) return;
    closed = true;
    layer.destroy();
    close(go);
  };
  const ctaY = boxTop + boxH - S.s - LATER_H - S.xs - BTN.cta / 2;
  layer.add(button(scene, cx, ctaY, CTA_W, BTN.cta, 'ui_btn_primary', 'Перейти', () => done(true), T.heading, { variant: 'primary' }).container);
  layer.add(button(scene, cx, boxTop + boxH - S.s - LATER_H / 2, 360, LATER_H, '', 'Позже', () => done(false), T.body, { variant: 'ghost' }).container);
  if (more > 0) layer.add(text(scene, cx, boxTop + boxH + 48, `Ещё ${more}`, T.caption, COLOR.textTertiary));

  // Касание мимо окна — «Позже» (только касание, которое и началось на шторке после короткой паузы).
  const shownAt = scene.time.now;
  let armed = false;
  shade.on('pointerdown', () => {
    armed = scene.time.now - shownAt >= SHADE_GUARD_MS;
  });
  shade.on('pointerup', () => {
    const ok = armed;
    armed = false;
    if (ok) done(false);
  });
  haptic('unlock');
  popIn(scene, layer, shade);
}
