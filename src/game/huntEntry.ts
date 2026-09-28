import Phaser from 'phaser';
import { heroesWithGearUpgrades, huntStatus, towerStatus } from '../core';
import { GAME } from './content';
import { formatNumber, levelUpReady } from './flow';
import { pickHomeHint } from './hints';
import { GAME_W } from './layout';
import { card, cornerBadge } from './screen';
import { session, today } from './session';
import { medallion } from './decor';
import { SKIN, SKIN_TINT, skinIcon } from './skin';
import { C, FS, OUTLINE, TITLE_STYLE } from './theme';
import { pressable, text } from './ui';
import { lockedToast, lockLabel } from './unlockBanner';

/** Плитка на главной: полоса под «В кампанию», над навигацией. */
const Y = 1640;
const W = 780;
const H = 140;

/**
 * Вход в «Охоту на босса» с главной: широкая плитка под кнопкой кампании. HomeScene ставит её одной строкой (huntTile).
 * Пока на главной ждёт подсказка обучения, которой нужна эта полоса («В кампанию» у новичка, «Улучшить» / «Экипировка» над вкладкой
 * «Герои»), плитки нет — подсказки одноразовые, плитка появится после них. Закрыта — тусклая с замком («Откроется на этапе 2-1», касание — тост); открыта — босс дня, попытки и лучший урон,
 * значок — сколько попыток осталось.
 */
export function huntTile(scene: Phaser.Scene, x = GAME_W / 2, y = Y): void {
  const st = huntStatus(session.save, today(), GAME);
  if (hintInBand()) return;
  const bg = pressable(scene, card(scene, x, y, W, H), W, H, () => (st.unlocked ? scene.scene.start('Hunt') : lockedToast(scene, 'hunt')));
  bg.setName('huntTile');
  const left = x - W / 2;
  medallion(scene, left + 70, y, 104, 'swords', st.unlocked ? SKIN_TINT.gold : SKIN_TINT.creamDim);
  text(scene, left + 140, y - 28, 'Охота на босса', FS.h2, st.unlocked ? C.title : SKIN.creamDim, TITLE_STYLE).setOrigin(0, 0.5);
  const sub = !st.unlocked
    ? lockLabel('hunt')
    : st.attemptsLeft > 0
      ? `${st.boss.def.name} · попыток ${st.attemptsLeft} из ${st.attemptsPerDay}`
      : `Лучший урон ${formatNumber(st.best)} · босс вернётся завтра`;
  text(scene, left + 140, y + 28, sub, FS.small, st.unlocked ? (st.attemptsLeft > 0 ? C.success : C.muted) : C.dim, OUTLINE).setOrigin(0, 0.5);
  if (!st.unlocked) {
    bg.setAlpha(0.75);
    scene.add.image(x + W / 2 - 40, y - H / 2 + 34, skinIcon('lock')).setDisplaySize(44, 44).setTint(SKIN_TINT.creamDim);
  } else cornerBadge(scene, x, y, W, H, st.attemptsLeft);
}

/**
 * Подсказка главной, плашка которой встаёт на полосу плитки (HomeScene.updateHint: home_campaign — под кнопкой кампании,
 * level_up / equip_gear — над вкладкой «Герои»). Сундук не учитываем: его подсказка выше и не мешает.
 */
function hintInBand(): boolean {
  const save = session.save;
  const id = pickHomeHint({
    cleared: save.campaign.cleared.length,
    chestHasIncome: false,
    levelUpReady: levelUpReady(save, GAME).length > 0,
    towerUnlocked: towerStatus(save, GAME).unlocked,
    gearUpgrade: heroesWithGearUpgrades(save, GAME).length > 0,
  });
  return id === 'home_campaign' || id === 'level_up' || id === 'equip_gear';
}
