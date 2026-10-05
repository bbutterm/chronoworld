import Phaser from 'phaser';
import { eventsBadges, pendingPicks, touchEvents } from '../core';
import { mailCount } from './navBadges';
import { GAME } from './content';
import { pulse } from './juice';
import { badge, HEADER_H } from './screen';
import { commit, session, today } from './session';
import { SKIN_TINT, skinIcon } from './skin';
import { heroCardIcon } from './heroCard';
import { roundIcon, ROUND_ICON } from './homeBuildings';
import { S } from './theme';
import { minimumTouchSize } from './viewport';

/**
 * Вход в события новичка, почту и контракт героя с главной: круглые иконки в шапке слева от шестерёнки (как значки
 * событий AFK Arena). HomeScene зовёт одной строкой (homeEventIcons) и ставит плашку игрока левее.
 * Красное число: сколько наград событий можно забрать / сколько писем не прочитано или с вложением.
 */

/** Засчитать сегодняшний вход (touchEvents) и доставить системные письма; изменилось — записать. */
export function touchToday(): void {
  const next = touchEvents(session.save, today(), GAME);
  if (next !== session.save) commit(next);
}

/** Сколько писем ждут внимания: непрочитанные или с незабранным вложением. */
export function mailBadge(): number {
  return mailCount(session.save);
}

/** Конверт (своей иконки в скине нет). size — ширина. */
export function envelopeIcon(scene: Phaser.Scene, x: number, y: number, size: number, color: number = SKIN_TINT.gold): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const w = size;
  const h = size * 0.68;
  g.lineStyle(Math.max(3, size / 14), color, 1);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, size / 12);
  g.beginPath();
  g.moveTo(-w / 2 + 4, -h / 2 + 4);
  g.lineTo(0, h * 0.08);
  g.lineTo(w / 2 - 4, -h / 2 + 4);
  g.strokePath();
  return g;
}

/** Шаг иконок в шапке (цель нажатия ROUND_ICON.hit) и сдвиг значка к правому верхнему краю круга. */
const BADGE_D = ROUND_ICON.size / 2 - 8;

/**
 * Иконки «Почта», «Контракт героя» и «События» в шапке главной: круглые, как шестерёнка, справа налево от неё
 * (объект `settings`), по центру шапки по высоте; без шестерёнки — от правого края. Значки — дисциплина §2.4:
 * красное число — только письма и награды, которые можно забрать. События закончились и всё забрано — иконки нет.
 * Возвращает левый край занятого места (плашка игрока не заходит за него).
 */
export function homeEventIcons(scene: Phaser.Scene): number {
  touchToday();
  const day = today();
  const gear = scene.children.getByName('settings') as Phaser.GameObjects.Container | null;
  const step = Math.max(ROUND_ICON.hit, minimumTouchSize());
  let x = (gear ? gear.x - gear.width / 2 - S.xxs : 960) - step / 2;
  const y = HEADER_H / 2;
  const mark = (cx: number, n: number) => badge(scene, cx + BADGE_D, y - BADGE_D, n);

  roundIcon(scene, x, y, 'mailIcon', (s) => envelopeIcon(scene, 0, 2, s), () => scene.scene.start('Mail'));
  mark(x, mailBadge());

  // «Контракт героя» ждёт выбора — карта героя с числом (слева от почты).
  const picks = pendingPicks(session.save);
  if (picks.length) {
    x -= step;
    const pk = roundIcon(scene, x, y, 'contractIcon', (s) => heroCardIcon(scene, 0, 0, s * 1.1, picks[0].rarity, undefined, { pick: true }), () =>
      scene.scene.start('HeroPick', { back: { to: 'Home' } }),
    );
    mark(x, picks.length);
    pulse(scene, pk, 1.06, 700);
  }
  const b = eventsBadges(session.save, day, GAME);
  if (b.loginVisible || b.newbieVisible) {
    x -= step;
    const ev = roundIcon(scene, x, y, 'eventsIcon', (s) => scene.add.image(0, 0, skinIcon('gift')).setDisplaySize(s, s).setTint(SKIN_TINT.gold), () =>
      scene.scene.start('Events', { tab: b.login > 0 || !b.newbieVisible ? 'login' : 'newbie' }),
    );
    const n = b.login + b.newbie;
    if (n > 0) {
      mark(x, n);
      pulse(scene, ev, 1.06, 700);
    }
  }
  return x - step / 2;
}
