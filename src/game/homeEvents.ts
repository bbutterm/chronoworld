import Phaser from 'phaser';
import { eventsBadges, letterClaimable, mailStatus, pendingPicks, touchEvents } from '../core';
import { GAME } from './content';
import { pulse } from './juice';
import { badge, HEADER_H } from './screen';
import { commit, session, today } from './session';
import { SKIN_TINT, skinIcon } from './skin';
import { button } from './ui';
import { heroCardIcon } from './heroCard';

/**
 * Вход в события новичка и почту с главной: две иконки в шапке слева от шестерёнки (как значки событий AFK Arena).
 * HomeScene зовёт одной строкой (homeEventIcons) — раскладка главной живёт в самой сцене, эти иконки её не трогают.
 * Красный кружок: сколько наград событий можно забрать / сколько писем не прочитано или с вложением.
 */

/** Засчитать сегодняшний вход (touchEvents) и доставить системные письма; изменилось — записать. */
export function touchToday(): void {
  const next = touchEvents(session.save, today(), GAME);
  if (next !== session.save) commit(next);
}

/** Сколько писем ждут внимания: непрочитанные или с незабранным вложением. */
export function mailBadge(): number {
  return mailStatus(session.save).letters.filter((l) => !l.read || letterClaimable(l)).length;
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

/** Размер иконки в шапке (цель нажатия — не меньше TOUCH − 8). */
const SIZE = 92;
const GAP = 14;

/**
 * Иконки «События» и «Почта» в шапке главной: справа налево от шестерёнки настроек (объект `settings`), по центру
 * шапки по высоте. Шестерёнки нет — у правого края. События закончились и всё забрано — иконки «События» нет.
 */
export function homeEventIcons(scene: Phaser.Scene): void {
  touchToday();
  const day = today();
  const gear = scene.children.getByName('settings') as Phaser.GameObjects.Container | null;
  let x = (gear ? gear.x - 50 : 900) - GAP - SIZE / 2;
  const y = HEADER_H / 2;

  const mail = button(scene, x, y, SIZE, SIZE, 'k:buttonSquare_beige', '', () => scene.scene.start('Mail'), 30);
  mail.container.add(envelopeIcon(scene, 0, 2, 54));
  mail.container.setName('mailIcon');
  const m = mailBadge();
  if (m > 0) badge(scene, x + SIZE / 2 - 12, y - SIZE / 2 + 12, m);

  const b = eventsBadges(session.save, day, GAME);
  // «Контракт героя» ждёт выбора — иконка карты с красным кружком (слева от почты).
  const picks = pendingPicks(session.save);
  if (picks.length) {
    x -= SIZE + GAP;
    const px = x;
    const pk = button(scene, px, y, SIZE, SIZE, 'k:buttonSquare_beige', '', () => scene.scene.start('HeroPick', { back: { to: 'Home' } }), 30);
    pk.container.add(heroCardIcon(scene, 0, 0, 70, picks[0].rarity, undefined, { pick: true }));
    pk.container.setName('contractIcon');
    badge(scene, px + SIZE / 2 - 12, y - SIZE / 2 + 12, picks.length);
    pulse(scene, pk.container, 1.06, 700);
  }
  if (!b.loginVisible && !b.newbieVisible) return;
  x -= SIZE + GAP;
  const ev = button(scene, x, y, SIZE, SIZE, 'k:buttonSquare_beige', '', () => scene.scene.start('Events', { tab: b.login > 0 || !b.newbieVisible ? 'login' : 'newbie' }), 30);
  ev.container.add(scene.add.image(0, 0, skinIcon('gift')).setDisplaySize(58, 58).setTint(SKIN_TINT.gold));
  ev.container.setName('eventsIcon');
  const n = b.login + b.newbie;
  if (n > 0) {
    badge(scene, x + SIZE / 2 - 12, y - SIZE / 2 + 12, n);
    pulse(scene, ev.container, 1.06, 700);
  }
}
