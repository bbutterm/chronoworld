import Phaser from 'phaser';
import { huntStatus, type HuntStatus } from '../core';
import { GAME } from './content';
import { modeBanner, type ModeBanner } from './featureTiles';
import { unitTint } from './screen';
import { session, today } from './session';

/**
 * Вход в «Охоту на MVP» со страницы «Приключения»: баннер режима (modeBanner, раскладка — в AdventureScene) с MVP
 * дня в багровом ореоле. Закрыт — силуэт босса, замок и «Откроется на этапе 2-1», касание — тост; открыт — текущий уровень и
 * попытки на сегодня в общем подвале режимов (кончились — «попытки завтра»). Попытки дня — постоянное состояние, не повод для точки (§2.4).
 */
export function huntTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): ModeBanner {
  const st = huntStatus(session.save, today(), GAME);
  const def = st.boss.def;
  return modeBanner(scene, x, y, w, h, {
    name: 'huntTile',
    title: 'Охота на MVP',
    actionFooter: true,
    open: st.unlocked,
    lockId: 'hunt',
    colors: [0x4a1712, 0x120605],
    figures: def ? [{ sprite: def.visual.sprite, tint: unitTint(def.visual) }] : [],
    figureH: 0.72,
    glow: 0xd64545,
    rays: 0xffb070,
    status: huntEntryStatus(st),
    onOpen: () => scene.scene.start('Hunt'),
  });
}

/** Current available rank and attempts, without a permanent alert or a false fight CTA. */
export function huntEntryStatus(st: Pick<HuntStatus, 'mvp' | 'rank' | 'attemptsLeft'>) {
  const rank = st.mvp ? `Уровень ${st.rank + 1} · ` : '';
  return {
    text: `${rank}${st.attemptsLeft > 0 ? `попыток ${st.attemptsLeft}` : 'попытки завтра'}`,
    tone: 'neutral' as const,
  };
}
