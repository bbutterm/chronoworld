import Phaser from 'phaser';
import { GAME_W, HEADER_H } from './layout';
import { commit, session, shiftTime, timeShiftMs } from './session';
import { button, toast } from './ui';
import { C, FS } from './theme';
import { worldPoint } from './viewport';

/**
 * Режим тестировщика: вверху каждого экрана две кнопки — «+300 гемов» и «+12 ч» (игровые часы уходят вперёд: сундук
 * офлайн-наград, экспедиции, новый день заданий и лавки). Доступен всем (по просьбе владельца), но по умолчанию
 * спрятан (правило 12, docs/design/ui-polish-research.md §3) и включается так:
 * - долгое нажатие (1,2 с) на пустое место шапки любого экрана — включить / выключить (тост, экран перерисуется);
 * - ?tester=1 в адресе — включить, ?tester=0 — выключить.
 * Выбор запоминается в localStorage (TESTER_KEY). TESTER_MODE = false — режима нет совсем (кнопок и жеста нет).
 */
export const TESTER_MODE = true;

/** Флаг в localStorage: '1' — режим тестировщика включён. */
export const TESTER_KEY = 'chronoworld.tester';
/** Сколько держать палец на шапке, мс. */
const HOLD_MS = 1200;
/** Палец сдвинулся дальше — это не долгое нажатие (ед. мира). */
const HOLD_SLOP = 30;

function readFlag(): boolean {
  try {
    return localStorage.getItem(TESTER_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(TESTER_KEY, '1');
    else localStorage.removeItem(TESTER_KEY);
  } catch {
    /* хранилище недоступно — режим только до перезагрузки */
  }
}

/** Режим без хранилища (приватное окно): последнее переключение жестом. */
let memo: boolean | null = null;

export function testerOn(): boolean {
  if (!TESTER_MODE) return false;
  try {
    const q = new URLSearchParams(location.search).get('tester');
    if (q === '1' || q === '0') {
      // Адрес главнее: запоминаем (после перезагрузки без параметра режим тот же).
      if (readFlag() !== (q === '1')) writeFlag(q === '1');
      if (memo === null) return q === '1';
    }
  } catch {
    /* нет location — тесты */
  }
  return memo ?? readFlag();
}

/** Включить / выключить режим (жест на шапке). */
export function setTesterOn(on: boolean): void {
  memo = on;
  writeFlag(on);
}

/** Сцены, где уже слушаем долгое нажатие (screen() зовётся один раз за create; restart — заново). */
const listening = new WeakSet<Phaser.Scene>();

/**
 * Долгое нажатие на пустое место шапки (или полосы над ней) — переключить режим тестировщика. Слушатель общий для
 * сцены и ничего не перехватывает: нажатие на кнопку, значок или окно жест не запускает.
 */
function holdToToggle(scene: Phaser.Scene): void {
  if (listening.has(scene)) return;
  listening.add(scene);
  // Таймер — реального времени, не часы сцены: на слабом телефоне (и в headless-браузере) кадры редкие, и часы сцены
  // отставали бы от пальца.
  let timer = 0;
  let start: Phaser.Math.Vector2 | null = null;
  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    start = null;
  };
  const down = (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
    cancel();
    if (over.length > 0) return;
    const w = worldPoint(scene, p);
    if (w.y > HEADER_H) return;
    start = w;
    timer = window.setTimeout(() => {
      timer = 0;
      start = null;
      if (!scene.sys.isActive()) return;
      const on = !testerOn();
      setTesterOn(on);
      scene.scene.restart();
      scene.events.once(Phaser.Scenes.Events.CREATE, () => toast(scene, on ? 'Режим тестировщика включён' : 'Режим тестировщика выключен', C.title, 2000));
    }, HOLD_MS);
  };
  const move = (p: Phaser.Input.Pointer) => {
    if (!start) return;
    const w = worldPoint(scene, p);
    if (Math.abs(w.x - start.x) > HOLD_SLOP || Math.abs(w.y - start.y) > HOLD_SLOP) cancel();
  };
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, down);
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, move);
  scene.input.on(Phaser.Input.Events.POINTER_UP, cancel);
  scene.input.on(Phaser.Input.Events.GAME_OUT, cancel);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    cancel();
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, down);
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, move);
    scene.input.off(Phaser.Input.Events.POINTER_UP, cancel);
    scene.input.off(Phaser.Input.Events.GAME_OUT, cancel);
    listening.delete(scene);
  });
}

const GEMS = 300;
const HOURS = 12;

/**
 * Кнопки тестировщика. band — высота полосы над шапкой (screen.ts topBand): на вытянутых экранах кнопки там слева
 * (валюта справа), на 9:16 — узкой строкой у верхнего края шапки, над названием экрана (MT-20 / NB-14 / LT-21: на нижней
 * кромке шапки они закрывали названия этапов, баннер главы и «Инвентарь»). Нажатие перезапускает экран.
 * Режим выключен — кнопок нет, слушается только жест включения (долгое нажатие на шапку).
 */
export function testerButtons(scene: Phaser.Scene, band: number, bandMin: number): void {
  if (!TESTER_MODE) return;
  holdToToggle(scene);
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
