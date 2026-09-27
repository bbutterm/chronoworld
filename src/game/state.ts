import phase0 from '../../data/phase0.json';
import type { SquadIds } from '../core';

/** Отряды живут в памяти до перезапуска — сохранение появится в фазе 1. */
export const squads: { A: SquadIds; B: SquadIds } = {
  A: [...phase0.defaultSquadA],
  B: [...phase0.defaultSquadB],
};

export const playbackSpeeds: number[] = phase0.playback.speeds;

/** Выбранная скорость боя живёт в localStorage отдельно от сохранения игры (это настройка, не прогресс). */
export const SPEED_KEY = 'chronoworld.battleSpeed';

function loadSpeed(): number {
  try {
    const v = Number(globalThis.localStorage?.getItem(SPEED_KEY));
    if (playbackSpeeds.includes(v)) return v;
  } catch {
    // Хранилище недоступно (приватный режим, тесты в Node) — скорость по умолчанию.
  }
  return playbackSpeeds[0];
}

export const playback = { speed: loadSpeed() };

/** Сменить скорость боя и запомнить выбор (ошибки хранилища не мешают игре). */
export function setPlaybackSpeed(speed: number): void {
  playback.speed = speed;
  try {
    globalThis.localStorage?.setItem(SPEED_KEY, String(speed));
  } catch {
    // Не запомнили — не страшно.
  }
}

/**
 * R. «Авто: следующий этап» (как авто-бой в AFK-играх): после победы в кампании через AUTO_DELAY_MS
 * сам запускается следующий открытый этап. Настройка, не прогресс — живёт в localStorage.
 */
export const AUTO_KEY = 'chronoworld.autoAdvance';
export const AUTO_DELAY_MS = 2000;

function loadAuto(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
}

export const autoAdvance = { on: loadAuto() };

export function setAutoAdvance(on: boolean): void {
  autoAdvance.on = on;
  try {
    globalThis.localStorage?.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    // Не запомнили — не страшно.
  }
}

/** Следующая скорость по кругу (1x → 2x → … → 1x). */
export function nextPlaybackSpeed(): number {
  const i = playbackSpeeds.indexOf(playback.speed);
  return playbackSpeeds[(i + 1) % playbackSpeeds.length];
}

/**
 * U. Ограничение частоты кадров (настройка, не прогресс — localStorage): 60 — как у экрана, 30 — вдвое меньше
 * работы CPU/GPU и нагрева на слабых телефонах. Бой считается по времени, так что на 30 он не замедляется.
 */
export const FPS_KEY = 'chronoworld.fpsCap';
export const FPS_CAPS = [60, 30] as const;
export type FpsCap = (typeof FPS_CAPS)[number];

function loadFps(): FpsCap {
  try {
    const v = Number(globalThis.localStorage?.getItem(FPS_KEY));
    if ((FPS_CAPS as readonly number[]).includes(v)) return v as FpsCap;
  } catch {
    // Хранилище недоступно — по умолчанию.
  }
  return 60;
}

export const fps = { cap: loadFps() };

export function setFpsCap(cap: FpsCap): void {
  fps.cap = cap;
  try {
    globalThis.localStorage?.setItem(FPS_KEY, String(cap));
  } catch {
    // Не запомнили — не страшно.
  }
}

/** Следующее значение по кругу (60 → 30 → 60). */
export const nextFpsCap = (): FpsCap => FPS_CAPS[(FPS_CAPS.indexOf(fps.cap) + 1) % FPS_CAPS.length];

/**
 * «Уменьшить анимацию» (настройка, не прогресс — localStorage): без полёта наград, отсчёта чисел, пульса
 * и «выезда» списков (juice.ts). Нет сохранённого выбора — как в системе (prefers-reduced-motion).
 */
export const MOTION_KEY = 'chronoworld.reduceMotion';

function loadReducedMotion(): boolean {
  try {
    const v = globalThis.localStorage?.getItem(MOTION_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    // Хранилище недоступно — берём системную настройку.
  }
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const motion = { reduced: loadReducedMotion() };

export function setReducedMotion(on: boolean): void {
  motion.reduced = on;
  try {
    globalThis.localStorage?.setItem(MOTION_KEY, on ? '1' : '0');
  } catch {
    // Не запомнили — не страшно.
  }
}
