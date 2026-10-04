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
  /**
   * С какой стороны в кадрах прилетает эффект ('right' — щит Удара щитом и метеор летят справа сверху): если кастер с
   * другой стороны, кадр отражается, чтобы удар шёл от кастера (у ульты героя слева — слева).
   */
  from?: 'left' | 'right';
}

/** Fields consumed by the game; provenance remains in the source catalog. */
export function projectAnimatedEffect(effect: {
  id: string; file: string; cell: number[]; columns: number; frames: number;
  ms: number; delayMs: number; anchor: number[];
}): AnimatedEffect {
  return {
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
    from: (effect as { from?: 'left' | 'right' }).from,
  };
}

export function projectEffectsCatalog<T extends { effects: Parameters<typeof projectAnimatedEffect>[0][]; skills?: unknown }>(catalog: T) {
  return { effects: catalog.effects.map(projectAnimatedEffect), skills: catalog.skills ?? {} };
}
