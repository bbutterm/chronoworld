import Phaser from 'phaser';
import { huntStatus } from '../core';
import { GAME } from './content';
import { modeBanner, type ModeBanner } from './featureTiles';
import { unitTint } from './screen';
import { session, today } from './session';

/**
 * Вход в «Охоту на MVP» со страницы «Приключения»: баннер режима (modeBanner, раскладка — в AdventureScene) с MVP
 * дня в багровом ореоле. Закрыт — силуэт босса, замок и «Откроется на этапе 2-1», касание — тост; открыт — чип
 * попыток на сегодня (кончились — «Завтра»). Попытки дня — постоянное состояние, не повод для точки (§2.4).
 */
export function huntTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): ModeBanner {
  const st = huntStatus(session.save, today(), GAME);
  const def = st.boss.def;
  const left = st.attemptsLeft;
  return modeBanner(scene, x, y, w, h, {
    name: 'huntTile',
    title: 'Охота на MVP',
    open: st.unlocked,
    lockId: 'hunt',
    colors: [0x4a1712, 0x120605],
    figures: def ? [{ sprite: def.visual.sprite, tint: unitTint(def.visual) }] : [],
    figureH: 0.72,
    glow: 0xd64545,
    rays: 0xffb070,
    status: left > 0 ? { icon: 'swords', text: `Попыток ${left}`, tone: 'positive' } : { icon: 'hourglass', text: 'MVP завтра', tone: 'neutral' },
    onOpen: () => scene.scene.start('Hunt'),
  });
}
