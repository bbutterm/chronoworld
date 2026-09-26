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

/** Следующая скорость по кругу (1x → 2x → … → 1x). */
export function nextPlaybackSpeed(): number {
  const i = playbackSpeeds.indexOf(playback.speed);
  return playbackSpeeds[(i + 1) % playbackSpeeds.length];
}
