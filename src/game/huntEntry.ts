import Phaser from 'phaser';
import { huntStatus } from '../core';
import { GAME } from './content';
import { session, today } from './session';
import { skinIcon } from './skin';
import { buildingTile, type BuildingTile } from './tavernEntry';
import { C } from './theme';

/**
 * Вход в «Охоту на босса» со страницы «Приключения»: плитка-«здание» (buildingTile, раскладка — в AdventureScene). Закрыта — тусклая с замком и «Откроется на этапе 2-1», касание — тост; открыта — попытки на сегодня
 * (кончились — «Босс вернётся завтра»), значок — сколько попыток осталось.
 */
export function huntTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): BuildingTile {
  const st = huntStatus(session.save, today(), GAME);
  return buildingTile(scene, x, y, w, h, {
    name: 'huntTile',
    title: 'Охота на босса',
    art: (size, tint) => scene.add.image(0, 0, skinIcon('swords')).setDisplaySize(size * 0.5, size * 0.5).setTint(tint),
    open: st.unlocked,
    status: st.unlocked && st.attemptsLeft > 0 ? { text: `Попыток ${st.attemptsLeft} из ${st.attemptsPerDay}`, color: C.success } : { text: 'Новый MVP завтра', color: C.muted },
    note: 'MVP дня из RO: стихия, фазы, карты MVP',
    lockId: 'hunt',
    onOpen: () => scene.scene.start('Hunt'),
    badge: st.unlocked ? st.attemptsLeft : 0,
  });
}
