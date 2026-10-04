import type { BranchView } from '../core/heroes/card';

export interface SkillTile {
  id: string;
  basic?: boolean;
  /** Уровень открытия (закрытый навык). */
  locked?: number;
  /** Нужна редкость (уровень выше предела текущей). */
  gate?: string;
  /** Навык другой ветки второй профессии. */
  form?: boolean;
  /** Своя подпись в листе вместо «Откроется на ур. N». */
  note?: string;
  lockedLabel?: string;
  /** Ульта формы (лист — «на полной энергии» вместо перезарядки). */
  ult?: boolean;
}

export function veteranSkillTiles(next: NonNullable<BranchView['advanced']>, rarity: string): SkillTile[] {
  const tile = (id: string, level: number): SkillTile => ({
    id, locked: level, lockedLabel: `Ветеран · ${rarity} · ур. ${level}`, note: `${rarity} · ур. ${level}`,
  });
  const tiles = next.skills.filter(s => s.level >= next.minLevel).map(s => tile(s.skill, s.level));
  if (next.ult) tiles.unshift({ ...tile(next.ult, next.minLevel), ult: true });
  return tiles;
}

export function skillTileStatus(r: SkillTile): string {
  return r.locked !== undefined ? (r.lockedLabel ?? `Ур. ${r.locked}${r.form ? ' · другая ветка' : ''}`)
    : r.basic ? 'Обычная атака' : r.ult ? 'Полная энергия' : r.note ?? 'Доступен';
}
