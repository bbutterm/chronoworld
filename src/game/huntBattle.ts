import Phaser from 'phaser';
import { huntScore, huntTier, type BattleEvent, type HuntOutcome } from '../core';
import { GAME } from './content';
import { formatNumber } from './flow';
import { GAME_W } from './layout';
import { topBand } from './screen';
import { COLOR, E, FAMILY, M, T } from './theme';
import { text } from './ui';

/**
 * «Охота на босса» в бою (BattleScene, режим hunt): счётчик урона по боссу и достигнутый порог — под полоской ОЗ
 * босса и полосой его заряда, по центру. Счёт идёт по событиям лога (урон по щиту — тоже урон), итог совпадает с
 * ядром (huntDamage). BattleScene зовёт hit() на каждое событие damage.
 * MVP-охота (rank задан): порог считается по результату (доля ОЗ уровня × зачёт уровня, hunt.ts huntScore), счёт —
 * одной строкой «Снято 42% · порог 3» (ход к победе и так видно по полосе ОЗ); в конце победы — «MVP!» (как в RO).
 */
export interface HuntHud {
  hit(e: Extract<BattleEvent, { type: 'damage' }>): void;
  /** Итог боя: показать урон ядра (на случай «Пропустить»), за победу над MVP — «MVP!». */
  finish(outcome: HuntOutcome): void;
}

/**
 * Полоска ОЗ босса в BattleScene: центр верхней полосы HUD_Y (72) − topBand + BOSS_BAR_DY (170); под ней — полоса
 * заряда (+37) и реплики босса. Итерация 5 подняла полоску к верхней полосе — счётчик идёт за ней, а не на старом
 * y 392 (на вытянутых экранах между ними оставалась дыра, на 9:16 счётчик налезал на реплики босса).
 */
export function huntHudY(band = topBand()): { bar: number; main: number; sub: number } {
  const bar = 72 - band + 170;
  // Заряд — до bar + 45; ниже — крупное число и строка порога.
  const main = bar + 100;
  return { bar, main, sub: main + 54 };
}

export function huntHud(scene: Phaser.Scene, bossUid: string, maxHp: number, rank?: number): HuntHud {
  const tiers = GAME.hunt.tiers;
  const mvp = rank !== undefined;
  // Сцена знает своё место полоски (bossBarY) — берём его, если есть; иначе считаем так же, как она.
  const sceneBar = (scene as unknown as { bossBarY?: number }).bossBarY;
  const base = huntHudY();
  const shift = typeof sceneBar === 'number' ? sceneBar - base.bar : 0;
  const Y = { main: base.main + shift, sub: base.sub + shift };
  let total = 0;
  let prevHp = maxHp;
  let shown = -1;
  const shadow = (t: Phaser.GameObjects.Text) => t.setShadow(0, 3, 'rgba(0,0,0,0.85)', 6, true, true);
  const num = shadow(text(scene, GAME_W / 2, Y.main, '0', T.title, COLOR.gold, { fontFamily: FAMILY.heading, fontStyle: 'bold' })).setVisible(!mvp);
  const tierText = shadow(text(scene, GAME_W / 2, mvp ? Y.main - 20 : Y.sub, '', T.caption, COLOR.textPrimary, { fontStyle: 'bold' }));
  num.setDepth(50).setName('huntDamage');
  tierText.setDepth(50).setName('huntTier');

  const draw = (animate: boolean, killed = false) => {
    const score = mvp ? huntScore(total, killed, rank, GAME) : total;
    const tier = huntTier(score, GAME.hunt);
    num.setText(formatNumber(total));
    if (mvp) {
      // BUG-185: «Урон» здесь был зачётом (доля ОЗ × зачёт уровня) и обгонял ОЗ MVP — теперь доля снятых ОЗ и порог наград.
      const pct = killed ? 100 : Math.min(99, Math.floor((total / Math.max(1, maxHp)) * 100));
      const tierPart = tier >= 0 ? `порог ${tier + 1}` : 'порог не взят';
      tierText.setText(killed ? `MVP повержен · ${tierPart}` : `Снято ${pct}% · ${tierPart}`);
    } else {
      const next = tiers[tier + 1];
      tierText.setText(`${tier >= 0 ? `Порог ${tier + 1}` : 'Порог не взят'}${next ? ` · до ${tier + 2}-го ${formatNumber(next.damage - total)}` : ' · высший!'}`);
    }
    if (tier !== shown) {
      if (animate && shown !== -1 && tier > shown) {
        scene.tweens.add({ targets: mvp ? tierText : num, scale: { from: 1.35, to: 1 }, duration: M.slow, ease: E.pop });
        tierText.setColor(COLOR.title);
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
      const big = text(scene, GAME_W / 2, Y.sub + 200, 'MVP!', Math.round(T.display * 1.7), COLOR.gold, { fontFamily: FAMILY.heading, fontStyle: 'bold', stroke: '#6a1a08', strokeThickness: 16 }).setDepth(60);
      scene.tweens.add({ targets: big, scale: { from: 2.2, to: 1 }, alpha: { from: 0, to: 1 }, duration: M.slow, ease: E.pop });
    },
  };
}
