/**
 * Мелочи для производительности боя на слабых телефонах (Telegram Mini App, Android WebView).
 * Без Phaser — чтобы проверять в тестах. Цифры и рекомендации: docs/content/performance.md.
 */

/** То, что пул умеет прятать и показывать (игровые объекты Phaser). */
export interface Poolable {
  setActive(value: boolean): unknown;
  setVisible(value: boolean): unknown;
}

/**
 * Пул переиспользуемых объектов: вместо create/destroy на каждую цифру урона или вспышку —
 * спрятать и отдать снова. limit — сколько объектов может быть занято одновременно: при переполнении
 * самый старый занятый возвращается в пул (onEvict вызывается перед этим — снять его с анимации).
 */
export class Pool<T extends Poolable> {
  /** Занятые объекты, от старых к новым. */
  readonly active: T[] = [];
  private readonly free: T[] = [];
  /** Сколько объектов пул создал за всё время (для замеров). */
  created = 0;

  constructor(
    private readonly make: () => T,
    private readonly limit = Infinity,
    private readonly onEvict?: (obj: T) => void,
  ) {}

  acquire(): T {
    if (this.active.length >= this.limit) {
      const oldest = this.active[0];
      this.onEvict?.(oldest);
      this.release(oldest);
    }
    let obj = this.free.pop();
    if (!obj) {
      obj = this.make();
      this.created++;
    }
    obj.setActive(true);
    obj.setVisible(true);
    this.active.push(obj);
    return obj;
  }

  release(obj: T): void {
    const i = this.active.indexOf(obj);
    if (i < 0) return;
    this.active.splice(i, 1);
    obj.setVisible(false);
    obj.setActive(false);
    this.free.push(obj);
  }

  get freeCount(): number {
    return this.free.length;
  }

  /** Забыть все объекты (их уничтожает сама сцена при выключении). */
  clear(): void {
    this.active.length = 0;
    this.free.length = 0;
  }
}

/** Кривые как у твинов Phaser (Quad.easeOut, Quad.easeIn, Back.easeOut) — чтобы вид не изменился. */
export const ease = {
  quadOut: (v: number) => v * (2 - v),
  quadIn: (v: number) => v * v,
  backOut: (v: number, overshoot = 1.70158) => {
    const u = v - 1;
    return u * u * ((overshoot + 1) * u + overshoot) + 1;
  },
};

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Метрики шрифта, как их отдаёт Phaser (TextStyle.getTextMetrics). */
export interface FontMetrics {
  ascent: number;
  descent: number;
  fontSize: number;
}

export interface CachedTextStyle {
  fontFamily: string;
  fontSize: string;
  color: string;
  align: 'center';
  stroke: string;
  strokeThickness: number;
  fontStyle: string;
  /** Заполняется после первого замера: Phaser тогда не сканирует пиксели заново (MeasureText дорогой). */
  metrics?: FontMetrics;
}

/**
 * Кэш стилей всплывающих надписей: один объект стиля на сочетание параметров и один замер шрифта
 * на размер/начертание (замер общий для всех цветов и обводок).
 */
export class TextStyleCache {
  private readonly styles = new Map<string, CachedTextStyle>();
  private readonly metrics = new Map<string, FontMetrics>();

  constructor(private readonly fontFamily: string) {}

  get(size: number, color: string, stroke: string, strokeThickness: number, bold: boolean): CachedTextStyle {
    const key = `${size}|${color}|${stroke}|${strokeThickness}|${bold ? 1 : 0}`;
    let s = this.styles.get(key);
    if (!s) {
      s = { fontFamily: this.fontFamily, fontSize: `${size}px`, color, align: 'center', stroke, strokeThickness, fontStyle: bold ? 'bold' : 'normal' };
      this.styles.set(key, s);
    }
    if (!s.metrics) {
      const m = this.metrics.get(fontKey(s));
      if (m) s.metrics = m;
    }
    return s;
  }

  /** Запомнить замер шрифта этого стиля (после первого текста с ним). */
  remember(style: CachedTextStyle, m: FontMetrics): void {
    const k = fontKey(style);
    if (!this.metrics.has(k)) this.metrics.set(k, { ascent: m.ascent, descent: m.descent, fontSize: m.fontSize });
    style.metrics ??= this.metrics.get(k);
  }

  get size(): number {
    return this.styles.size;
  }
}

const fontKey = (s: CachedTextStyle) => `${s.fontStyle} ${s.fontSize} ${s.fontFamily}`;

interface Scheduled {
  left: number;
  fn: () => void;
}
const noop = () => {};

/**
 * Очередь отложенных действий сцены (замена this.time.delayedCall для частых событий боя):
 * без TimerEvent на каждый удар, записи переиспользуются. Время — мс боя (с учётом скорости), шаг — из update.
 * Как у часов Phaser: добавленное во время шага начинает отсчёт со следующего шага; срабатывают в порядке добавления.
 */
export class Scheduler {
  private readonly items: Scheduled[] = [];
  private readonly pending: Scheduled[] = [];
  private readonly spare: Scheduled[] = [];

  after(ms: number, fn: () => void): void {
    const e = this.spare.pop() ?? { left: 0, fn: noop };
    e.left = ms;
    e.fn = fn;
    this.pending.push(e);
  }

  step(dt: number): void {
    for (const e of this.pending) this.items.push(e);
    this.pending.length = 0;
    const n = this.items.length;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const e = this.items[i];
      e.left -= dt;
      if (e.left > 0) {
        this.items[w++] = e;
        continue;
      }
      const fn = e.fn;
      e.fn = noop;
      this.spare.push(e);
      fn();
    }
    this.items.length = w;
  }

  get size(): number {
    return this.items.length + this.pending.length;
  }

  /** Выполнить всё отложенное сразу (и то, что отложат сами вызовы), по порядку. Для «Пропустить». */
  flush(maxRounds = 64): void {
    for (let i = 0; i < maxRounds && this.size > 0; i++) this.step(Number.POSITIVE_INFINITY);
    this.clear();
  }

  clear(): void {
    this.items.length = 0;
    this.pending.length = 0;
  }
}
