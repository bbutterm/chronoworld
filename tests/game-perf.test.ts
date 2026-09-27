import { describe, expect, it } from 'vitest';
import { ease, Pool, Scheduler, TextStyleCache } from '../src/game/perf';

class Obj {
  active = false;
  visible = false;
  constructor(readonly id: number) {}
  setActive(v: boolean) {
    this.active = v;
    return this;
  }
  setVisible(v: boolean) {
    this.visible = v;
    return this;
  }
}

describe('Pool', () => {
  it('переиспользует отпущенные объекты вместо создания новых', () => {
    let n = 0;
    const pool = new Pool(() => new Obj(n++));
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.created).toBe(2);
    pool.release(a);
    expect(a.visible).toBe(false);
    expect(a.active).toBe(false);
    const c = pool.acquire();
    expect(c).toBe(a);
    expect(c.visible).toBe(true);
    expect(pool.created).toBe(2);
    expect(pool.active).toEqual([b, a]);
  });

  it('при переполнении вытесняет самый старый и сообщает об этом', () => {
    let n = 0;
    const evicted: number[] = [];
    const pool = new Pool(() => new Obj(n++), 2, (o) => evicted.push(o.id));
    const a = pool.acquire();
    pool.acquire();
    const c = pool.acquire();
    expect(evicted).toEqual([0]);
    expect(c).toBe(a);
    expect(pool.active.length).toBe(2);
    expect(pool.created).toBe(2);
  });

  it('повторный release безопасен', () => {
    const pool = new Pool(() => new Obj(0));
    const a = pool.acquire();
    pool.release(a);
    pool.release(a);
    expect(pool.freeCount).toBe(1);
  });
});

describe('ease — те же кривые, что у твинов Phaser', () => {
  it('Quad.easeOut, Quad.easeIn, Back.easeOut', () => {
    for (const v of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(ease.quadOut(v)).toBeCloseTo(v * (2 - v));
      expect(ease.quadIn(v)).toBeCloseTo(v * v);
      // Phaser: --v * v * ((s + 1) * v + s) + 1
      let u = v;
      const s = 1.70158;
      expect(ease.backOut(v)).toBeCloseTo(--u * u * ((s + 1) * u + s) + 1);
    }
    expect(ease.backOut(0)).toBeCloseTo(0);
    expect(ease.backOut(1)).toBeCloseTo(1);
  });
});

describe('Scheduler', () => {
  it('срабатывает по накопленному времени, в порядке добавления, со следующего шага', () => {
    const s = new Scheduler();
    const out: string[] = [];
    s.after(100, () => out.push('a'));
    s.after(50, () => out.push('b'));
    s.after(100, () => out.push('c'));
    s.step(60);
    expect(out).toEqual(['b']);
    s.step(40);
    expect(out).toEqual(['b', 'a', 'c']);
    expect(s.size).toBe(0);
  });

  it('добавленное из колбэка ждёт следующего шага', () => {
    const s = new Scheduler();
    const out: number[] = [];
    s.after(10, () => s.after(1, () => out.push(2)));
    s.step(10);
    expect(out).toEqual([]);
    s.step(1);
    expect(out).toEqual([2]);
  });

  it('clear отменяет всё', () => {
    const s = new Scheduler();
    let hit = false;
    s.after(5, () => (hit = true));
    s.clear();
    s.step(100);
    expect(hit).toBe(false);
  });
});

describe('TextStyleCache', () => {
  it('один объект стиля на сочетание параметров; замер шрифта общий для цветов', () => {
    const c = new TextStyleCache('Arial');
    const a = c.get(40, '#fff', '#000', 6, true);
    expect(c.get(40, '#fff', '#000', 6, true)).toBe(a);
    expect(a.metrics).toBeUndefined();
    c.remember(a, { ascent: 30, descent: 8, fontSize: 38 });
    expect(a.metrics).toEqual({ ascent: 30, descent: 8, fontSize: 38 });
    // Другой цвет и обводка, тот же шрифт — замер уже есть.
    expect(c.get(40, '#f00', '#5a2a00', 8, true).metrics).toEqual(a.metrics);
    // Другой размер — нужен свой замер.
    expect(c.get(52, '#fff', '#000', 6, true).metrics).toBeUndefined();
    expect(c.size).toBe(3);
  });
});
