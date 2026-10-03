import Phaser from 'phaser';
import { achievementStatus, finishedExpeditions, questStatus, towerFloor, towerStatus } from '../core';
import { setThemeBackground, themeOfChapter, themeOfTowerFloor, type Theme } from './backdrops';
import { GAME } from './content';
import { claimableAchievements, claimableCount, currentStage, expeditionsBadgeCount, heroSprite, towerBadgeCount } from './flow';
import { markHint } from './hints';
import { now, session, today } from './session';
import { skinIcon, type SkinIcon } from './skin';
import { dot, unitFigure, unitTint } from './screen';
import { slowRays } from './decor';
import { buildingTile, type BuildingTile } from './tavernEntry';
import { C, COLOR, FAMILY, R, S, T } from './theme';
import { type Panel, chip, ellipsize, plate, pressable, text, type IconSpec, type Tone } from './ui';
import { isUnlocked, lockedToast, lockLabel } from './unlockBanner';

/**
 * Плитки-«здания» страницы «Город» (Задания, Достижения — рядом с Таверной и Лавкой; тот же buildingTile, что у
 * Таверны) и баннеры режимов страницы «Приключения» (modeBanner: Башня, Экспедиции; Охота — huntEntry.ts).
 * Каждая ставится одной строкой; значки — те же счётчики flow.ts, что зажигают точку вкладки (navBadges.ts).
 * Дисциплина §2.4: число — только у наград к получению (Задания, Достижения); у режимов — точка без числа и только
 * по событию (вернулись, ждёт выбор).
 */

const glyph = (scene: Phaser.Scene, icon: SkinIcon) => (size: number, tint: number) => scene.add.image(0, 0, skinIcon(icon)).setDisplaySize(size * 0.5, size * 0.5).setTint(tint);

/** «Задания дня»: активность за день, значок — сколько наград можно забрать. */
export function questsTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile {
  const open = isUnlocked('quests');
  const qs = questStatus(session.save, GAME, today());
  const n = open ? claimableCount(qs) : 0;
  return buildingTile(scene, x, y, w, h, {
    name: 'questsTile',
    title: 'Задания',
    art: glyph(scene, 'scroll'),
    open,
    status: { text: `Активность ${qs.activity} / ${qs.maxActivity}`, color: n > 0 ? C.success : C.muted },
    note: 'Дела дня за гемы и золото',
    lockId: 'quests',
    onOpen: () => scene.scene.start('Quests'),
    badge: n,
  });
}

/** Достижения: сколько получено, значок — сколько можно забрать. */
export function achievementsTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile {
  const open = isUnlocked('achievements');
  const views = achievementStatus(session.save, GAME);
  const got = views.filter((a) => a.claimed).length;
  const n = open ? claimableAchievements(views) : 0;
  return buildingTile(scene, x, y, w, h, {
    name: 'achievementsTile',
    title: 'Достижения',
    art: glyph(scene, 'trophy'),
    open,
    status: { text: `Получено ${got} / ${views.length}`, color: n > 0 ? C.success : C.info },
    note: 'Награды за вехи пути',
    lockId: 'achievements',
    onOpen: () => scene.scene.start('Achievements', { from: 'Home' }),
    badge: n,
  });
}

// ———————————————————————————————————————— Баннеры «Приключений» ————————————————————————————————————————

/**
 * Баннер режима страницы «Приключения» (как «Тёмный лес» AFK Arena): широкая картина во всю ширину — фон темы
 * (backdrops.ts) или градиент, фигура (монстр этажа, MVP дня, отряд) справа, внизу слева — название заголовочной
 * гарнитурой и один чип состояния. Красная точка — только у событий (вернулись, ждёт выбор). Закрыт — темнее,
 * фигура силуэтом, вместо чипа — замок и «Откроется на этапе …» (касание — тост). Без описаний.
 * Рамка — цель нажатия, её имя — для e2e/атласа.
 */
export interface ModeBannerSpec {
  name: string;
  title: string;
  open: boolean;
  lockId: Parameters<typeof lockedToast>[1];
  onOpen: () => void;
  /** Градиент картины сверху вниз (под фоном темы или вместо него). */
  colors: readonly [number, number];
  /** Фон темы: вид, тема и какая строка фона (0…1920) встанет в центр баннера. */
  backdrop?: { kind: 'battle' | 'map'; theme: Theme; focusY: number };
  /** Фигуры справа (id листа, оттенок). */
  figures?: readonly { sprite: string; tint?: number }[];
  /** Высота фигуры — доля высоты баннера. */
  figureH?: number;
  /** Цвет ореола за фигурой. */
  glow?: number;
  /** Медленные лучи за фигурой (цвет) — «момент» без фона темы (MVP дня). */
  rays?: number;
  status?: { icon?: IconSpec; text: string; tone: Tone };
  /** Красная точка: есть что сделать сейчас (событие, не постоянное состояние). */
  dot?: boolean;
}

export interface ModeBanner {
  frame: Panel;
  /** Центр фигуры — для указателя подсказки. */
  focusX: number;
  focusY: number;
}

export function modeBanner(scene: Phaser.Scene, x: number, y: number, w: number, h: number, o: ModeBannerSpec): ModeBanner {
  const left = x - w / 2;
  const top = y - h / 2;
  const shape = scene.make.graphics({}, false);
  shape.fillStyle(0xffffff, 1).fillRoundedRect(left, top, w, h, R.l);
  const mask = shape.createGeometryMask();
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => shape.destroy());
  const clip = <G extends Phaser.GameObjects.Components.Mask>(g: G): G => g.setMask(mask);
  clip(scene.add.graphics().fillGradientStyle(o.colors[0], o.colors[0], o.colors[1], o.colors[1], 1).fillRect(left, top, w, h));
  if (o.backdrop) {
    // Фон темы во весь размер поля (1080×1920 — как на карте и в бою): нужная полоса — в баннере, остальное срезает
    // маска. Файл фона догрузится позже и подменит нарисованный — маска и место остаются.
    const by = y + 960 - o.backdrop.focusY;
    const bg = scene.add.image(x, Math.abs(by - 960) < 1 ? by + 2 : by, '__DEFAULT');
    setThemeBackground(bg, o.backdrop.kind, o.backdrop.theme);
    clip(bg).setAlpha(o.open ? 1 : 0.45);
  }
  const figs = o.figures ?? [];
  const fx = left + w * (figs.length > 1 ? 0.7 : 0.74);
  const feet = top + h - S.xl;
  const fh = h * (o.figureH ?? 0.66);
  if (o.rays !== undefined && o.open && figs.length) clip(slowRays(scene, fx, feet - fh * 0.5, h * 1.5, 0.22, o.rays));
  if (o.glow !== undefined && o.open && figs.length) {
    clip(scene.add.image(fx, feet - fh * 0.45, 'skin_glow').setDisplaySize(fh * 1.6, fh * 1.4).setTint(o.glow).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD));
  }
  if (figs.length) clip(scene.add.ellipse(fx, feet, Math.min(w * 0.5, fh * 0.6 * figs.length), 40, 0x000000, 0.4));
  // Тень для текста: тёмный низ и левый край — название и чип читаются на любом фоне. Фигуры встают под неё.
  const a = o.open ? [0.55, 0, 0.9, 0.35] : [0.75, 0.5, 0.92, 0.7];
  const shade = clip(scene.add.graphics().fillGradientStyle(0, 0, 0, 0, a[0], a[1], a[2], a[3]).fillRect(left, top, w, h));
  const step = Math.min(170, (w * 0.42) / Math.max(1, figs.length));
  figs.forEach((f, i) => {
    const px = fx + (i - (figs.length - 1) / 2) * step;
    const py = feet - (figs.length > 1 && i % 2 === 1 ? S.s : 0);
    unitFigure(scene, f.sprite, px, py, figs.length > 1 ? fh * 0.78 : fh, {
      maxScale: 2,
      onReady: (s) => {
        // Лист догрузился, когда экран уже перезапущен, — объект не нужен.
        if (!shade.scene || s.scene !== scene) {
          s.destroy();
          return;
        }
        clip(s);
        if (!o.open) s.setTint(0x0c0a08).setAlpha(0.85);
        else if (f.tint !== undefined) s.setTint(f.tint);
        scene.children.moveBelow(s, shade);
      },
    });
  });
  const frame = plate(scene, x, y, w, h, { fill: COLOR.bg, alpha: 0, border: o.open ? COLOR.border : '#3a3226', borderW: 4, r: R.l, hl: o.open ? 0.18 : 0 }).setName(o.name);
  const tx = left + S.l;
  const lineY = top + h - S.l - 28;
  const title = text(scene, tx, lineY - 28 - S.xs, o.title, T.title, o.open ? COLOR.title : COLOR.textTertiary, {
    fontFamily: FAMILY.heading,
    fontStyle: 'bold',
    shadow: { offsetX: 0, offsetY: 3, color: '#000000', blur: 8, fill: true },
  }).setOrigin(0, 1);
  ellipsize(title, w - 2 * S.l);
  if (!o.open) {
    chip(scene, tx, lineY, 'lock', lockLabel(o.lockId), 'neutral', { size: 's', align: 'left' }).setAlpha(0.9);
    pressable(scene, frame, w, h, () => lockedToast(scene, o.lockId));
  } else {
    if (o.status) chip(scene, tx, lineY, o.status.icon, o.status.text, o.status.tone, { size: 's', align: 'left' });
    pressable(scene, frame, w, h, o.onOpen);
    if (o.dot) dot(scene, left + w - S.m, top + S.m);
  }
  return { frame, focusX: figs.length ? fx : x, focusY: figs.length ? feet - fh / 2 : y };
}

/** Самый крупный враг этажа Башни — фигура баннера. */
function towerFigure(floor: number): { sprite: string; tint?: number } | undefined {
  try {
    const units = towerFloor(Math.max(1, Math.min(floor, GAME.tower.maxFloor)), GAME).enemies.filter((u): u is NonNullable<typeof u> => !!u);
    const u = units.reduce<(typeof units)[number] | undefined>((best, e) => (!best || e.stats.hp > best.stats.hp ? e : best), undefined);
    return u ? { sprite: u.visual.sprite, tint: unitTint(u.visual) } : undefined;
  } catch {
    return undefined;
  }
}

/** Башня испытаний: этаж забега или рекорд; точка — в забеге ждёт выбор. Нажатие гасит подсказку «Башня открыта». */
export function towerTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): ModeBanner {
  const save = session.save;
  const ts = towerStatus(save, GAME);
  const run = save.tower.run;
  // Забег-рогалик (docs/design/tower-roguelite.md): идёт забег — его этаж, иначе рекорд.
  const next = run ? run.floor + 1 : ts.floor + 1;
  const fig = towerFigure(next);
  return modeBanner(scene, x, y, w, h, {
    name: 'towerTile',
    title: 'Башня испытаний',
    open: ts.unlocked,
    lockId: 'tower',
    colors: [0x2a2340, 0x0c0a12],
    backdrop: { kind: 'battle', theme: themeOfTowerFloor(next), focusY: h * 0.5 + 40 },
    figures: fig ? [fig] : [],
    glow: 0xb48cff,
    status: { icon: 'tower', text: run ? `Этаж ${next}` : ts.floor ? `Рекорд ${ts.floor}` : 'Этаж 1', tone: run ? 'accent' : 'neutral' },
    dot: towerBadgeCount(save, GAME) > 0,
    onOpen: () => {
      markHint('tower_open');
      scene.scene.start('Tower');
    },
  });
}

/** Экспедиции: вернувшиеся / в пути; точка — вернулись (забрать) или ждёт решение. На картине — отряд. */
export function expeditionsTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): ModeBanner {
  const save = session.save;
  const open = isUnlocked('bounties');
  const done = finishedExpeditions(save, now());
  const active = save.bounties.active.length;
  const heroes = save.squad
    .map((id) => (id ? save.heroes.find((hh) => hh.id === id) : undefined))
    .filter((hh): hh is NonNullable<typeof hh> => !!hh)
    .slice(0, 3);
  return modeBanner(scene, x, y, w, h, {
    name: 'expeditionsTile',
    title: 'Экспедиции',
    open,
    lockId: 'bounties',
    colors: [0x2c3a22, 0x0e120a],
    backdrop: { kind: 'map', theme: themeOfChapter(currentStage(save, GAME)?.chapter), focusY: 980 },
    figures: heroes.map((hh) => ({ sprite: heroSprite(hh, GAME) })),
    figureH: 0.62,
    glow: 0xfff0c8,
    status: done
      ? { icon: 'flag', text: done > 1 ? `Вернулись: ${done}` : 'Отряд вернулся', tone: 'positive' }
      : active
        ? { icon: 'hourglass', text: `В пути: ${active}`, tone: 'neutral' }
        : { icon: 'flag', text: 'Отряд свободен', tone: 'neutral' },
    dot: expeditionsBadgeCount(save, now(), GAME) > 0,
    onOpen: () => scene.scene.start('Expeditions'),
  });
}

