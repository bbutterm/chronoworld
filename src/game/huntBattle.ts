import Phaser from 'phaser';
import { huntScore, huntTier, type BattleEvent, type HuntOutcome } from '../core';
import { GAME } from './content';
import { formatNumber } from './flow';
import { GAME_W } from './layout';
import { SKIN } from './skin';
import { text } from './ui';

/**
 * «Охота на босса» в бою (BattleScene, режим hunt): крупный счётчик урона по боссу между кнопками скорости и
 * «Пропустить», под ним — достигнутый порог и сколько до следующего. Счёт идёт по событиям лога (урон по щиту — тоже
 * урон), итог совпадает с ядром (huntDamage). BattleScene зовёт hit() на каждое событие damage.
 * MVP-охота (rank задан): порог считается по результату (доля ОЗ уровня × зачёт уровня, hunt.ts huntScore), в конце
 * победы — «MVP!» (как в RO).
 */
export interface HuntHud {
  hit(e: Extract<BattleEvent, { type: 'damage' }>): void;
  /** Итог боя: показать урон ядра (на случай «Пропустить»), за победу над MVP — «MVP!». */
  finish(outcome: HuntOutcome): void;
}

const Y = 392;
/** MVP: строка счёта под рядом кнопок (кнопки — y 360 ± 55, панель героев — ниже 500). */
const MVP_Y = 458;

export function huntHud(scene: Phaser.Scene, bossUid: string, maxHp: number, rank?: number): HuntHud {
  const tiers = GAME.hunt.tiers;
  const mvp = rank !== undefined;
  let total = 0;
  let prevHp = maxHp;
  let shown = -1;
  // MVP: между скоростью и «Пропустить» — кнопка «Авто» (ульта вручную), счёт — одной строкой под кнопками; ход к
  // победе и так видно по полосе здоровья MVP сверху.
  const label = text(scene, GAME_W / 2, Y - 60, 'Урон по боссу', 26, SKIN.cream, { stroke: '#000000', strokeThickness: 5 }).setVisible(!mvp);
  const num = text(scene, GAME_W / 2, Y, '0', 64, SKIN.goldLight, { fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 10 }).setVisible(!mvp);
  const tierText = text(scene, GAME_W / 2, mvp ? MVP_Y : Y + 56, '', mvp ? 30 : 26, '#ffffff', { stroke: '#000000', strokeThickness: 5, ...(mvp ? { fontStyle: 'bold' } : {}) });
  label.setDepth(50);
  num.setDepth(50);
  tierText.setDepth(50);

  const draw = (animate: boolean, killed = false) => {
    const score = mvp ? huntScore(total, killed, rank, GAME) : total;
    const tier = huntTier(score, GAME.hunt);
    num.setText(formatNumber(total));
    if (mvp) {
      const left = Math.max(0, maxHp - total);
      tierText.setText(`Урон ${formatNumber(total)} · ${tier >= 0 ? `порог ${tier + 1}` : 'порог не взят'}${killed ? ' · MVP повержен!' : ` · до победы ${formatNumber(left)}`}`);
    } else {
      const next = tiers[tier + 1];
      tierText.setText(`${tier >= 0 ? `Порог ${tier + 1}` : 'Порог не взят'}${next ? ` · до ${tier + 2}-го ${formatNumber(next.damage - total)}` : ' · высший!'}`);
    }
    if (tier !== shown) {
      if (animate && shown !== -1 && tier > shown) {
        scene.tweens.add({ targets: mvp ? tierText : num, scale: { from: 1.35, to: 1 }, duration: 260, ease: 'Back.easeOut' });
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
    finish(outcome) {
      total = outcome.damage;
      draw(false, outcome.killed);
      if (!outcome.killed) return;
      // «MVP!» — как надпись над победителем MVP в RO.
      const big = text(scene, GAME_W / 2, Y + 170, 'MVP!', 150, '#ffe14a', { fontStyle: 'bold', stroke: '#6a1a08', strokeThickness: 16 }).setDepth(60);
      scene.tweens.add({ targets: big, scale: { from: 2.2, to: 1 }, alpha: { from: 0, to: 1 }, duration: 380, ease: 'Back.easeOut' });
    },
  };
}
