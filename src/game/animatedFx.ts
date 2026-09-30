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
  /**
   * Смешивание: 'add' — как в клиенте RO (свечение складывается с фоном; в атласе цвет÷альфа, альфа = яркость — ADD
   * даёт ровно исходный кадр на чёрном), 'normal' — твёрдые предметы (камни, нож, колба, стрелы).
   */
  blend: 'add' | 'normal';
  /**
   * Масштаб атласа навыка на экране: единиц игры (поле 1080×1920) на пиксель клетки. Задан — роли навыка (hit, buff,
   * debuff, cast, ground, projectile) рисуют кадр в этом масштабе и непрозрачным, а не размером роли; нет — прежний размер.
   * Ориентир — фигуры RO ×3.2 (V2_SCALE): захват EffectViewer ≈ RO ×1.04.
   */
  scale?: number;
  /** Непрозрачность атласа навыка (пересвеченные захваты — снег Бури), по умолчанию 1. */
  alpha?: number;
  /**
   * Вырастает из земли за rise мс (масштаб по высоте от 0 от точки ног) и уходит обратно в последнюю четверть:
   * статичные камни RO (Земляной шип), у которых движение в клиенте — 3D, а в захвате его нет.
   */
  rise?: number;
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
  blend: (effect as { blend?: string }).blend === 'add' ? 'add' : 'normal',
  scale: (effect as { scale?: number }).scale,
  alpha: (effect as { alpha?: number }).alpha,
  rise: (effect as { rise?: number }).rise,
}]));

export const animatedFxKey = (id: string): string => `anim_${id}`;
/** Все анимированные эффекты каталога. */
export const animatedFxIds = (): string[] => [...effects.keys()];

/**
 * Роли атласа навыка (effects.json → skills) — по событию боя, не взаимозаменяемы:
 * - hit — на каждой цели в момент урона; buff — на союзнике при баффе/щите от навыка; debuff — на враге при статусе;
 * - cast — на кастере в начале каста/удара; ground — один раз по площади навыка (центр целей или под кастером);
 * - projectile — летит от кастера к цели (кадры крутятся по кругу всё время полёта, flyAtlas в skillSigs.ts):
 *   рецепты навыков (skillSigs) и общий путь снаряда (BattleScene) берут его вместо процедурного снаряда.
 */
export interface SkillFx {
  hit?: string;
  buff?: string;
  cast?: string;
  ground?: string;
  debuff?: string;
  projectile?: string;
}
const skillMap = (catalog as unknown as { skills?: Record<string, SkillFx> }).skills ?? {};
export const skillFx = (skillId: string | undefined): SkillFx | undefined => (skillId ? skillMap[skillId] : undefined);
export const animatedEffect = (id: string): AnimatedEffect | undefined => effects.get(id);

/**
 * Какие анимированные эффекты может показать бой (грузятся только они — все листы каталога вместе ≈ 100 МБ видеопамяти):
 * общие (удар, магия, лечение, щит, смерть… — всё, что не fx_job_*), эффекты навыков юнитов боя по каталогу
 * (hit/buff/cast/ground/debuff) и visual.hitFx / visual.projectile юнитов.
 */
export function battleFxIds(skillIds: Iterable<string | undefined>, extra: Iterable<string | undefined> = []): string[] {
  const out = new Set<string>();
  for (const id of effects.keys()) if (!id.startsWith('fx_job_')) out.add(id);
  for (const sk of skillIds) for (const id of Object.values(skillFx(sk) ?? {})) if (id && effects.has(id)) out.add(id);
  for (const id of extra) if (id && effects.has(id)) out.add(id);
  return [...out];
}
export function selectedAnimatedEffect(id: string, kind: 'flash' | 'projectile', loaded: boolean): AnimatedEffect | undefined {
  if (!loaded || (kind === 'projectile' && id !== 'fx_arrow')) return undefined;
  return animatedEffect(id);
}
export const animatedFxDuration = (effect: AnimatedEffect): number => effect.delayMs + effect.frames * effect.ms;

/** Кадр летящего атласа (projectile) через elapsedMs: кадры идут по кругу, без паузы delayMs. */
export const loopFrameAt = (effect: AnimatedEffect, elapsedMs: number): number =>
  effect.frames <= 1 ? 0 : Math.floor(Math.max(0, elapsedMs) / effect.ms + 1e-7) % effect.frames;

/** -1 means the effect is still in its authored pre-roll delay. */
export function animatedFrameAt(effect: AnimatedEffect, elapsedMs: number): number {
  if (elapsedMs < effect.delayMs) return -1;
  return Math.min(effect.frames - 1, Math.max(0, Math.floor((elapsedMs - effect.delayMs) / effect.ms + 1e-7)));
}

/** BootScene loads the atlases under distinct keys, leaving existing still-image keys untouched. */
export function queueAnimatedFx(queue: (key: string, file: string, width: number, height: number) => void): void {
  for (const effect of effects.values()) queue(animatedFxKey(effect.id), effect.file, effect.cell[0], effect.cell[1]);
}
