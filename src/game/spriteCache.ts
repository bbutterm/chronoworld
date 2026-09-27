/**
 * U. Учёт листов юнитов в памяти (без Phaser — проверяется в тестах): LRU с бюджетом памяти
 * и «удержаниями» — лист, который показывает активная сцена, выгружать нельзя.
 * Размер листа считаем как w×h×4 байт (так он лежит в памяти GPU). Подробности: docs/content/performance.md.
 */

/** Бюджет листов, которые можно держать про запас (переход «карточка героя ↔ бой» без перезагрузки). */
export const SHEET_BUDGET_BYTES = 60 * 1048576;

export const textureBytes = (w: number, h: number) => w * h * 4;

export class SheetLru {
  /** id → байты; порядок вставки = порядок использования (первый — самый давний). */
  private readonly entries = new Map<string, number>();
  /** id → сколько владельцев (сцен) его сейчас держат. */
  private readonly holds = new Map<string, number>();

  constructor(public budget = SHEET_BUDGET_BYTES) {}

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Лист загружен (или снова использован) — становится самым свежим. */
  add(id: string, bytes: number): void {
    this.entries.delete(id);
    this.entries.set(id, bytes);
  }

  touch(id: string): void {
    const b = this.entries.get(id);
    if (b === undefined) return;
    this.entries.delete(id);
    this.entries.set(id, b);
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  hold(id: string): void {
    this.holds.set(id, (this.holds.get(id) ?? 0) + 1);
  }

  release(id: string): void {
    const n = (this.holds.get(id) ?? 0) - 1;
    if (n > 0) this.holds.set(id, n);
    else this.holds.delete(id);
  }

  isHeld(id: string): boolean {
    return (this.holds.get(id) ?? 0) > 0;
  }

  get bytes(): number {
    let s = 0;
    for (const b of this.entries.values()) s += b;
    return s;
  }

  get size(): number {
    return this.entries.size;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Что выгрузить, чтобы уложиться в бюджет: самые давние из неудерживаемых. Возвращённые id уже убраны из учёта —
   * вызывающий удаляет их текстуры и анимации. Удерживаемые не трогаем, даже если бюджет превышен.
   */
  trim(): string[] {
    let total = this.bytes;
    const out: string[] = [];
    for (const [id, b] of this.entries) {
      if (total <= this.budget) break;
      if (this.isHeld(id)) continue;
      out.push(id);
      total -= b;
    }
    for (const id of out) this.entries.delete(id);
    return out;
  }
}
