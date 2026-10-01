import Phaser from 'phaser';
import { achievementStatus, finishedExpeditions, questStatus, towerStatus } from '../core';
import { GAME } from './content';
import { claimableAchievements, claimableCount, expeditionsBadgeCount, towerBadgeCount } from './flow';
import { markHint } from './hints';
import { now, session, today } from './session';
import { skinIcon, type SkinIcon } from './skin';
import { buildingTile, type BuildingTile } from './tavernEntry';
import { C } from './theme';
import { isUnlocked } from './unlockBanner';

/**
 * Плитки-«здания» страниц «Город» (Задания, Достижения — рядом с Таверной и Лавкой) и «Приключения» (Башня,
 * Экспедиции — рядом с Охотой): тот же buildingTile, что у Таверны. Каждая ставится одной строкой; значки — те же
 * счётчики flow.ts, что складываются в красный кружок вкладки (navBadges.ts).
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

/** Башня испытаний: взятый этаж, значок — следующий этаж по силам. Нажатие гасит подсказку «Башня открыта». */
export function towerTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile {
  const save = session.save;
  const ts = towerStatus(save, GAME);
  return buildingTile(scene, x, y, w, h, {
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
    badge: ts.unlocked ? towerBadgeCount(save, GAME) : 0,
  });
}

/** Экспедиции: вернувшиеся / в пути, значок — вернувшиеся и свободные локации, куда хватает мощи. */
export function expeditionsTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile {
  const save = session.save;
  const open = isUnlocked('bounties');
  const done = finishedExpeditions(save, now());
  const active = save.bounties.active.length;
  return buildingTile(scene, x, y, w, h, {
    name: 'expeditionsTile',
    title: 'Экспедиции',
    art: glyph(scene, 'flag'),
    open,
    status: { text: done ? `Вернулись: ${done}` : active ? `В пути: ${active}` : 'Отправьте отряд', color: done ? C.success : C.muted },
    note: 'Отряд уходит сам и приносит добычу',
    lockId: 'bounties',
    onOpen: () => scene.scene.start('Expeditions'),
    badge: open ? expeditionsBadgeCount(save, now(), GAME) : 0,
  });
}
