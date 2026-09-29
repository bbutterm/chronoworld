import Phaser from 'phaser';
import { GAME_W } from './layout';
import { commit, session, shiftTime, timeShiftMs } from './session';
import { button, toast } from './ui';
import { C, FS } from './theme';

/**
 * Режим тестировщика (пока включён для всех, по просьбе владельца): вверху каждого экрана две кнопки —
 * «+300 гемов» и «+12 ч» (игровые часы уходят вперёд: сундук офлайн-наград, экспедиции, новый день заданий и лавки).
 * Выключить — TESTER_MODE = false или ?tester=0 в адресе.
 */
export const TESTER_MODE = true;

export function testerOn(): boolean {
  if (!TESTER_MODE) return false;
  try {
    return new URLSearchParams(location.search).get('tester') !== '0';
  } catch {
    return true;
  }
}

const GEMS = 300;
const HOURS = 12;

/**
 * Кнопки тестировщика. band — высота полосы над шапкой (screen.ts topBand): на вытянутых экранах кнопки там слева
 * (валюта справа), на 9:16 — узкой строкой у верхнего края шапки, над названием экрана (MT-20 / NB-14 / LT-21: на нижней
 * кромке шапки они закрывали названия этапов, баннер главы и «Инвентарь»). Нажатие перезапускает экран.
 */
export function testerButtons(scene: Phaser.Scene, band: number, bandMin: number): void {
  if (!testerOn()) return;
  const inBand = band >= bandMin;
  // 9:16: выше названия (оно по центру шапки, ~50…100) и левее валюты (справа, от ~780).
  const y = inBand ? -band / 2 : 22;
  const x0 = inBand ? 115 : GAME_W / 2 - 90;
  const mk = (x: number, label: string, onTap: () => void) => {
    const b = button(scene, x, y, inBand ? 190 : 170, inBand ? 60 : 40, 'ui_btn_secondary', label, onTap, inBand ? FS.caption : FS.caption - 6, { repeat: true });
    b.container.setDepth(8000).setAlpha(0.85).setName(`tester_${label}`);
  };
  mk(x0, `+${GEMS} гемов`, () => {
    const s = session.save;
    commit({ ...s, currency: { ...s.currency, gems: s.currency.gems + GEMS } });
    scene.scene.restart();
  });
  mk(x0 + (inBand ? 200 : 180), `+${HOURS} ч`, () => {
    shiftTime(HOURS * 3600_000);
    const h = Math.round(timeShiftMs() / 3600_000);
    scene.scene.restart();
    // После restart тост рисуем уже в новом экране.
    scene.events.once(Phaser.Scenes.Events.CREATE, () => toast(scene, `Часы игры впереди на ${h} ч`, C.title, 2000));
  });
}
