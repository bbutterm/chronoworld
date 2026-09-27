import catalog from '../../assets/effects/effects.json';

/** Compact runtime view of the capture catalog. The static fx_* textures remain fallback assets. */
export interface AnimatedEffect {
  id: string;
  file: string;
  cell: [number, number];
  columns: number;
  frames: number;
  ms: number;
  delayMs: number;
  anchor: [number, number];
}

const effects = new Map<string, AnimatedEffect>(catalog.effects.map((effect) => [effect.id, {
  id: effect.id,
  file: effect.file,
  cell: [effect.cell[0], effect.cell[1]],
  columns: effect.columns,
  frames: effect.frames,
  ms: effect.ms,
  delayMs: effect.delayMs,
  anchor: [effect.anchor[0], effect.anchor[1]],
}]));

export const animatedFxKey = (id: string): string => `anim_${id}`;
export const animatedEffect = (id: string): AnimatedEffect | undefined => effects.get(id);
export function selectedAnimatedEffect(id: string, kind: 'flash' | 'projectile', loaded: boolean): AnimatedEffect | undefined {
  if (!loaded || (kind === 'projectile' && id !== 'fx_arrow')) return undefined;
  return animatedEffect(id);
}
export const animatedFxDuration = (effect: AnimatedEffect): number => effect.delayMs + effect.frames * effect.ms;

/** -1 means the effect is still in its authored pre-roll delay. */
export function animatedFrameAt(effect: AnimatedEffect, elapsedMs: number): number {
  if (elapsedMs < effect.delayMs) return -1;
  return Math.min(effect.frames - 1, Math.max(0, Math.floor((elapsedMs - effect.delayMs) / effect.ms + 1e-7)));
}

/** BootScene loads the atlases under distinct keys, leaving existing still-image keys untouched. */
export function queueAnimatedFx(queue: (key: string, file: string, width: number, height: number) => void): void {
  for (const effect of effects.values()) queue(animatedFxKey(effect.id), effect.file, effect.cell[0], effect.cell[1]);
}
