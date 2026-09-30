import { newGame, type SaveState } from '../core';
import { GAME } from './content';
import { localDay } from './flow';
import { SaveSlot } from './storage';

/**
 * Текущая игра: одно сохранение на всё приложение. Экраны читают `session.save`
 * и после каждого изменения зовут `commit(next)` — оно сразу пишется в localStorage.
 * P11: запись идёт через SaveSlot (ревизии против двух вкладок, резервные копии, только чтение для
 * сохранений более новой версии) — см. storage.ts.
 */
const slot = new SaveSlot();
/** Предупреждения для игрока, которые покажет ближайший экран (тостом). */
const warnings: string[] = [];

/**
 * Режим тестировщика (tester.ts): сдвиг игровых часов вперёд, мс. Хранится отдельно от сохранения, чтобы
 * отметки времени в сохранении и «сейчас» оставались согласованными после перезагрузки.
 */
const SHIFT_KEY = 'chronoworld.timeShift';
let timeShift = readShift();

function readShift(): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(SHIFT_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/** Сдвинуть игровые часы вперёд на ms (кнопка «+12 ч» тестировщика). */
export function shiftTime(ms: number): void {
  timeShift += ms;
  try {
    globalThis.localStorage?.setItem(SHIFT_KEY, String(timeShift));
  } catch {
    /* хранилище недоступно — сдвиг живёт до перезагрузки */
  }
}

/** Насколько сдвинуты часы (мс). */
export const timeShiftMs = () => timeShift;

export const now = () => Date.now() + timeShift;
/** День игрока по локальному времени — его получают все ежедневные механики (act*-обёртки, задания). */
export const today = () => localDay(new Date(now()));

function boot(): SaveState {
  const r = slot.boot(GAME, now(), today());
  warnings.push(...r.warnings);
  return r.save;
}

export const session = {
  save: boot(),
};

/** Сохранить новое состояние игры. */
export function commit(save: SaveState): void {
  const wasWritable = slot.storage.writable;
  const w = slot.write(save);
  if (!w.ok) {
    // Устаревшая вкладка: состояние не принимаем (экран закрыт плашкой, см. showStale).
    // Только чтение (сохранение новее сборки): играть можно, но ничего не пишется.
    if (w.reason === 'readonly') session.save = save;
    return;
  }
  session.save = w.save;
  if (wasWritable && !slot.storage.writable) {
    warnings.push(
      slot.storage.quotaExceeded
        ? 'Хранилище браузера переполнено — прогресс не записывается и живёт до перезагрузки.'
        : 'Не удалось записать сохранение (хранилище заблокировано). Прогресс живёт до перезагрузки.',
    );
  }
}

/** Префикс всех ключей игры в localStorage (сохранение, его резервные копии, настройки, подсказки, «прочитано»). */
export const GAME_KEY_PREFIX = 'chronoworld.';

/**
 * Настройки устройства — не прогресс (BUG-165, решение 30.09): «Начать заново» их не трогает. Звук и «Звуки боя»,
 * вибрация, скорость боя, предел FPS, «меньше движения».
 */
export const SETTINGS_KEYS: readonly string[] = ['chronoworld.audio', 'chronoworld.haptics', 'chronoworld.battleSpeed', 'chronoworld.fpsCap', 'chronoworld.reduceMotion'];

/**
 * «Начать заново» из настроек: как у нового игрока на чистом браузере. Сдвиг часов тестировщика — в ноль (новая игра
 * ставит отметки времени по настоящим часам), новая игра записывается поверх старой (ревизия растёт — другие вкладки
 * с игрой станут «устаревшими» и не перетрут её), все остальные ключи игры (резервные копии, подсказки, прочитанная
 * Летопись, Таверна) удаляются, кроме настроек устройства (SETTINGS_KEYS). Потом страница перезагружается — память
 * модулей тоже чистая, и игра открывается вступлением главы 1. Возвращает удалённые ключи (для тестов).
 */
export function startOver(storage: Storage | null | undefined = globalThis.localStorage, reload = true): string[] {
  timeShift = 0;
  commit(newGame(GAME, Date.now(), today()));
  const removed: string[] = [];
  try {
    if (storage) {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(GAME_KEY_PREFIX) && k !== slot.storage.key && !SETTINGS_KEYS.includes(k)) keys.push(k);
      }
      for (const k of keys) {
        storage.removeItem(k);
        removed.push(k);
      }
    }
  } catch {
    /* хранилище недоступно — чистить нечего */
  }
  if (reload && typeof location !== 'undefined') location.reload();
  return removed;
}

/** Забрать накопившиеся предупреждения (каждое показывается один раз). */
export function takeWarnings(): string[] {
  return warnings.splice(0);
}

/**
 * P11 (T4-01). Игра записана в другой вкладке: эту закрываем плашкой поверх всего (ввод в игру блокируется),
 * кнопка перезагружает страницу с актуальным сохранением.
 */
function showStale(): void {
  if (typeof document === 'undefined' || document.getElementById('stale-tab')) return;
  const el = document.createElement('div');
  el.id = 'stale-tab';
  el.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;' +
    'background:rgba(0,0,0,.85);color:#fff;font:18px sans-serif;text-align:center;padding:24px';
  const text = document.createElement('div');
  text.textContent = 'Игра открыта в другой вкладке. Здесь прогресс больше не сохраняется.';
  const btn = document.createElement('button');
  btn.textContent = 'Играть здесь';
  btn.style.cssText = 'font:18px sans-serif;padding:10px 24px;border-radius:8px;border:0;cursor:pointer';
  btn.onclick = () => location.reload();
  el.append(text, btn);
  document.body.append(el);
}

slot.watch(typeof window !== 'undefined' ? window : null, showStale);

/**
 * P11 (T4-08). Перезапустить экран, когда у игрока наступил новый день (полночь по локальному времени), —
 * ежедневные счётчики и кнопки «Забрать» не остаются вчерашними. Вызывать в create() экрана.
 */
export function restartOnNewDay(scene: { time: { addEvent(cfg: { delay: number; loop: boolean; callback: () => void }): unknown }; scene: { restart(): void } }): void {
  const day = today();
  scene.time.addEvent({ delay: 5000, loop: true, callback: () => today() !== day && scene.scene.restart() });
}
