import phase0 from '../../data/phase0.json';
import type { Squad } from '../core';

/** Отряды живут в памяти до перезапуска — сохранение появится в фазе 1. */
export const squads: { A: Squad; B: Squad } = {
  A: [...phase0.defaultSquadA],
  B: [...phase0.defaultSquadB],
};

export const playbackSpeeds: number[] = phase0.playback.speeds;
export const playback = { speed: playbackSpeeds[0] };
