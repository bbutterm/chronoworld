/**
 * Чистые правила вида страницы «Кампания» (без Phaser — проверяются тестами): какие узлы тропы подписаны и как
 * читается наполнение сундука офлайн-наград.
 */

export type NodeStatus = 'locked' | 'open' | 'cleared';

/** Chapter-one goal follows story milestones, never the presence of a namesake summon. */
export function campaignObjective(chapterId: string, cleared: readonly string[]): string | null {
  if (chapterId !== 'chapter1' || cleared.includes('ch1_s10')) return null;
  if (cleared.includes('ch1_s15')) return 'Цель: вызволить Грету из желе';
  if (cleared.includes('ch1_s5')) return 'Цель: найти Грету в лесу';
  if (cleared.includes('ch1_s4')) return 'Цель: добраться до «Двух колоколов»';
  return 'Цель: узнать, что гонит порингов к деревне';
}

/**
 * Подпись с названием — только у текущего этапа и у босса (§5 «Кампания»): пройденные — номер и галка,
 * закрытые — номер и замок. Так на участке не больше двух подписей вместо десяти.
 */
export function nodeLabeled(status: NodeStatus, boss: boolean): boolean {
  return status === 'open' || boss;
}

/** Наполнение сундука: доля (0…1), полон ли, подпись полосы «2ч 05м / 12ч» или «Полон». */
export interface ChestFill {
  frac: number;
  full: boolean;
  label: string;
}

/**
 * minutes — накопленные минуты (offlineRewards), capHours — лимит сундука, fullInMs — до заполнения (offlineFullInMs;
 * null — сундук ещё не копит). Полон — когда ядро говорит «0 до заполнения».
 */
export function chestFill(minutes: number, capHours: number, fullInMs: number | null): ChestFill {
  const cap = Math.max(1, capHours * 60);
  const full = fullInMs !== null && fullInMs <= 0;
  const m = Math.max(0, Math.min(cap, Math.floor(minutes)));
  const frac = full ? 1 : m / cap;
  if (full) return { frac, full, label: 'Полон' };
  return { frac, full, label: `${Math.floor(m / 60)}ч ${String(m % 60).padStart(2, '0')}м / ${capHours}ч` };
}

/** Состояние картинки сундука по наполнению: пустой / наполняется / полный (≥ 90 % — уже «полный» сундук). */
export function chestArt(fill: ChestFill, hasIncome: boolean): 'empty' | 'filling' | 'full' {
  if (!hasIncome) return 'empty';
  return fill.full || fill.frac >= 0.9 ? 'full' : 'filling';
}
