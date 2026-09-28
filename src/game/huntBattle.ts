import Phaser from 'phaser';
import type { BattleEvent, HuntOutcome } from '../core';
import { GAME } from './content';
import { formatNumber } from './flow';
import { GAME_W } from './layout';
import { SKIN } from './skin';
import { text } from './ui';

/**
 * «Охота на босса» в бою (BattleScene, режим hunt): крупный счётчик урона по боссу между кнопками скорости и
 * «Пропустить», под ним — достигнутый порог и сколько до следующего. Счёт идёт по событиям лога (урон по щиту — тоже
 * урон), итог совпадает с ядром (huntDamage). BattleScene зовёт hit() на каждое событие damage.
 */
export interface HuntHud {
  hit(e: Extract<BattleEvent, { type: 'damage' }>): void;
  /** Итог боя: показать урон ядра (на случай «Пропустить»). */
  finish(): void;
}

const Y = 392;

export function huntHud(scene: Phaser.Scene, outcome: HuntOutcome, bossUid: string, maxHp: number): HuntHud {
  const tiers = GAME.hunt.tiers;
  let total = 0;
  let prevHp = maxHp;
  let shown = -1;
  const label = text(scene, GAME_W / 2, Y - 60, 'Урон по боссу', 26, SKIN.cream, { stroke: '#000000', strokeThickness: 5 });
  const num = text(scene, GAME_W / 2, Y, '0', 64, SKIN.goldLight, { fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 10 });
  const tierText = text(scene, GAME_W / 2, Y + 56, '', 26, '#ffffff', { stroke: '#000000', strokeThickness: 5 });
  label.setDepth(50);
  num.setDepth(50);
  tierText.setDepth(50);

  const draw = (animate: boolean) => {
    let tier = -1;
    tiers.forEach((t, i) => {
      if (total >= t.damage) tier = i;
    });
    num.setText(formatNumber(total));
    const next = tiers[tier + 1];
    tierText.setText(`${tier >= 0 ? `Порог ${tier + 1}` : 'Порог не взят'}${next ? ` · до ${tier + 2}-го ${formatNumber(next.damage - total)}` : ' · высший!'}`);
    if (tier !== shown) {
      if (animate && shown !== -1 && tier > shown) {
        scene.tweens.add({ targets: num, scale: { from: 1.35, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        tierText.setColor(SKIN.goldLight);
      }
      shown = tier;
    }
  };
  draw(false);

  return {
    hit(e) {
      if (e.target !== bossUid) return;
      total += e.absorbed + Math.max(0, prevHp - e.hp);
      prevHp = e.hp;
      draw(true);
    },
    finish() {
      total = outcome.damage;
      draw(false);
    },
  };
}
