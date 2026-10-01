import Phaser from 'phaser';
import { achievementStatus, finishedExpeditions, questStatus, towerStatus } from '../core';
import { GAME } from './content';
import { claimableAchievements, claimableCount, expeditionsBadgeCount, towerBadgeCount } from './flow';
import { markHint } from './hints';
import { now, session, today } from './session';
import { skinIcon, type SkinIcon } from './skin';
import { dot } from './screen';
import { buildingTile, type BuildingTile } from './tavernEntry';
import { C } from './theme';
import { isUnlocked } from './unlockBanner';

/**
 * Плитки-«здания» страниц «Город» (Задания, Достижения — рядом с Таверной и Лавкой) и «Приключения» (Башня,
 * Экспедиции — рядом с Охотой): тот же buildingTile, что у Таверны. Каждая ставится одной строкой; значки — те же
 * счётчики flow.ts, что зажигают точку вкладки (navBadges.ts). Дисциплина §2.4: число — только у наград к получению
 * (Задания, Достижения); у Башни и Экспедиций — точка без числа и только по событию (вернулись, ждёт выбор).
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

/** Точка в правом верхнем углу плитки (там же, где число cornerBadge). */
function tileDot(scene: Phaser.Scene, x: number, y: number, w: number, h: number, on: boolean): void {
  if (on) dot(scene, x + w / 2 - 18, y - h / 2 + 14).setName('tileDot');
}

/** Башня испытаний: рекорд / этаж забега; точка — в забеге ждёт выбор. Нажатие гасит подсказку «Башня открыта». */
export function towerTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile {
  const save = session.save;
  const ts = towerStatus(save, GAME);
  const t = buildingTile(scene, x, y, w, h, {
    name: 'towerTile',
    title: 'Башня испытаний',
    art: glyph(scene, 'tower'),
    open: ts.unlocked,
    // Забег-рогалик (docs/design/tower-roguelite.md): идёт забег — его этаж, иначе рекорд.
    status: { text: save.tower.run ? `Идёт забег: этаж ${save.tower.run.floor + 1}` : ts.floor === 0 ? 'Забег ещё не начат' : `Рекорд: этаж ${ts.floor}`, color: C.gold },
    note: 'Забег вверх: карты меняют правила боя',
    lockId: 'tower',
    onOpen: () => {
      markHint('tower_open');
      scene.scene.start('Tower');
    },
  });
  tileDot(scene, x, y, w, h, ts.unlocked && towerBadgeCount(save, GAME) > 0);
  return t;
}

/** Экспедиции: вернувшиеся / в пути; точка — вернулись (забрать) или в пути ждёт решение. */
export function expeditionsTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile {
  const save = session.save;
  const open = isUnlocked('bounties');
  const done = finishedExpeditions(save, now());
  const active = save.bounties.active.length;
  const t = buildingTile(scene, x, y, w, h, {
    name: 'expeditionsTile',
    title: 'Экспедиции',
    art: glyph(scene, 'flag'),
    open,
    status: { text: done ? `Вернулись: ${done}` : active ? `В пути: ${active}` : 'Отправьте отряд', color: done ? C.success : C.muted },
    note: 'Отряд уходит сам и приносит добычу',
    lockId: 'bounties',
    onOpen: () => scene.scene.start('Expeditions'),
  });
  tileDot(scene, x, y, w, h, open && expeditionsBadgeCount(save, now(), GAME) > 0);
  return t;
}
