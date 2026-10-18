import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import {
  BUMP,
  DECOR_CAP,
  HEARTBEAT_CAP,
  MOMENTS,
  MOMENT_TITLE_FROM,
  REWARD_FLY_MS,
  decorStats,
  heartbeat,
  moment,
  momentTimeline,
  pulse,
  rewardFly,
  snapMs,
  type MomentKind,
} from '../src/game/juice';
import { SFX } from '../src/game/audioCatalog';
import { HAPTICS } from '../src/game/haptics';
import { setReducedMotion } from '../src/game/state';
import { E, M } from '../src/game/theme';

/** Твин-заглушка: записывает конфиг, умеет «закончиться». */
interface FakeTween {
  cfg: Record<string, unknown>;
  targets: unknown[];
  destroyed: boolean;
  isDestroyed(): boolean;
  isFinished(): boolean;
  stop(): void;
}

/** Игровой объект-заглушка: любые set*-методы возвращают сам объект и записывают значения. */
function fakeObj(): Record<string, unknown> {
  const o: Record<string, unknown> = { scene: {}, scaleX: 1, scale: 1, alpha: 1, x: 0, y: 0, width: 100, height: 50, handlers: {} as Record<string, () => void> };
  const p: Record<string, unknown> = new Proxy(o, {
    get(t, k: string | symbol) {
      if (typeof k === 'symbol') return undefined;
      if (k in t) return t[k];
      if (k === 'setScale') return (s: number) => ((t.scale = t.scaleX = s), p);
      if (k === 'setAlpha') return (a: number) => ((t.alpha = a), p);
      if (k === 'setDepth') return (d: number) => ((t.depth = d), p);
      if (k === 'destroy') return () => ((t.scene = undefined), p);
      if (k === 'on') return (ev: string, fn: () => void) => (((t.handlers as Record<string, () => void>)[ev] = fn), p);
      if (k === 'getData') return (key: string) => t[`data:${key}`];
      if (k === 'setData') return (key: string, v: unknown) => ((t[`data:${key}`] = v), p);
      return () => p;
    },
  });
  return p;
}

/** Часы моментов (realNow → performance.now) — двигает runTimers. */
let clock = 0;

function fakeScene() {
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const listeners = new Map<string, Set<() => void>>();
  const on = (ev: string, fn: () => void) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)?.add(fn);
  };
  const tweens: FakeTween[] = [];
  const timers: { ms: number; fn: () => void; removed: boolean }[] = [];
  const shutdown: (() => void)[] = [];
  const made: Record<string, unknown>[] = [];
  const mk = () => {
    const o = fakeObj();
    made.push(o);
    return o;
  };
  const tween = (cfg: Record<string, unknown>): FakeTween => {
    const t: FakeTween = {
      cfg,
      targets: Array.isArray(cfg.targets) ? cfg.targets : [cfg.targets],
      destroyed: false,
      isDestroyed: () => t.destroyed,
      isFinished: () => false,
      stop: () => {
        t.destroyed = true;
      },
    };
    tweens.push(t);
    return t;
  };
  const scene = {
    sys: {},
    events: {
      once: (ev: string, fn: () => void) => (ev === 'shutdown' ? shutdown.push(fn) : on(ev, fn)),
      on,
      off: (ev: string, fn: () => void) => listeners.get(ev)?.delete(fn),
    },
    tweens: { add: tween, addCounter: tween, killTweensOf: () => undefined },
    time: {
      delayedCall: (ms: number, fn: () => void) => {
        const t = { ms, fn, removed: false, remove: () => (t.removed = true) };
        timers.push(t);
        return t;
      },
    },
    textures: { exists: () => true },
    add: { rectangle: mk, image: mk, text: mk, circle: mk },
  } as unknown as Phaser.Scene;
  /** Прогнать таймеры сцены до t мс (по порядку) и кадр по настоящему времени t (realLater момента). */
  const runTimers = (upTo: number) => {
    for (const t of [...timers].sort((a, b) => a.ms - b.ms)) if (!t.removed && t.ms <= upTo) (t.removed = true), t.fn();
    clock = upTo;
    // Колбэк кадра может завести новый realLater — кадр повторяется, пока что-то срабатывает.
    for (let i = 0; i < 10; i++) {
      const before = [...(listeners.get('postupdate') ?? [])];
      for (const fn of before) fn();
      if ((listeners.get('postupdate')?.size ?? 0) === before.length && before.every((fn) => listeners.get('postupdate')?.has(fn))) break;
    }
  };
  /** Подписчики кадра (realLater) — сколько ждут. */
  const pending = () => listeners.get('postupdate')?.size ?? 0;
  return { scene, tweens, timers, runTimers, pending, made, shutdown };
}

describe('juice: токены движения', () => {

  it('snapMs прилипает к ближайшему токену', () => {
    expect(snapMs(380)).toBe(M.slow);
    expect(snapMs(450)).toBe(M.slow);
    expect(snapMs(700)).toBe(M.emphasis);
    expect(snapMs(800)).toBe(M.count);
    expect(snapMs(10)).toBe(M.press);
    expect(snapMs(5000)).toBe(M.count);
    for (const v of Object.values(M)) expect(snapMs(v)).toBe(v);
  });

  it('полёт наград укладывается в секунду', () => {
    expect(REWARD_FLY_MS).toBeLessThanOrEqual(1000);
  });
});

describe('juice: моменты', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    setReducedMotion(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  const kinds = Object.keys(MOMENTS) as MomentKind[];

  it('у каждого момента есть звук из каталога и вибрация с тяжёлым ударом', () => {
    expect(kinds.sort()).toEqual(['ascend', 'firstClear', 'newChapter', 'summonRare', 'victory']);
    for (const k of kinds) {
      const d = MOMENTS[k];
      if (d.sfx) expect(SFX[d.sfx], k).toBeTruthy();
      const h = HAPTICS[d.haptic];
      expect(h, k).toBeTruthy();
      expect(h.steps.some((s) => 'impact' in s && s.impact === 'heavy'), k).toBe(true);
      expect(d.title.length).toBeGreaterThan(0);
    }
  });

  it('расписание по §4.6: затемнение M.base, заголовок M.slow, уход M.base, весь момент ≤ 2 с', () => {
    const v = momentTimeline('victory');
    expect(v).toMatchObject({ dim: M.base, titleAt: M.base, title: M.slow, settled: M.base + M.slow, out: M.base });
    expect(v.end).toBeLessThanOrEqual(2000);
    // Редкий призыв: фон гаснет медленнее.
    expect(momentTimeline('summonRare').dim).toBe(M.slow);
    expect(momentTimeline('victory', 0).closeAt).toBe(v.settled);
  });

  it('«Уменьшить анимацию»: ни одного объекта, колбэки сразу и по разу', () => {
    setReducedMotion(true);
    const f = fakeScene();
    const onSettled = vi.fn();
    const onDone = vi.fn();
    const h = moment(f.scene, 'victory', { onSettled, onDone });
    expect(f.made).toHaveLength(0);
    expect(f.tweens).toHaveLength(0);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(h.settled).toBe(true);
    h.skip();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('заголовок «падает» 1.4 → 1 с E.pop за M.slow; тап — пропуск, колбэки по разу', () => {
    const f = fakeScene();
    const onSettled = vi.fn();
    const onDone = vi.fn();
    const h = moment(f.scene, 'victory', { onSettled, onDone, sound: false });
    const titleTw = f.tweens.find((t) => t.cfg.ease === E.pop);
    expect(titleTw?.cfg).toMatchObject({ duration: M.slow, delay: M.base, scale: 1, alpha: 1 });
    // Заголовок создан крупнее и прозрачным.
    const title = titleTw?.targets[0] as { scale: number; alpha: number };
    expect(title.scale).toBeCloseTo(MOMENT_TITLE_FROM);
    expect(title.alpha).toBe(0);
    expect(onSettled).not.toHaveBeenCalled();
    // Тап по затемнению (первый созданный объект).
    const dim = f.made[0] as { handlers: Record<string, () => void> };
    dim.handlers.pointerdown();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(h.closed).toBe(true);
    dim.handlers.pointerdown();
    h.close();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('сам по себе: встал по расписанию, ушёл после паузы; keep — остаётся и отдаёт ввод', () => {
    const f = fakeScene();
    const onDone = vi.fn();
    const h = moment(f.scene, 'ascend', { onDone, hold: M.emphasis, sound: false });
    const tl = momentTimeline('ascend', M.emphasis);
    f.runTimers(tl.settled);
    expect(h.settled).toBe(true);
    expect(h.closed).toBe(false);
    f.runTimers(tl.settled + tl.closeAt);
    expect(h.closed).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);

    const g = fakeScene();
    const kept = vi.fn();
    const k = moment(g.scene, 'newChapter', { keep: true, onDone: kept, sound: false });
    g.runTimers(10_000);
    expect(k.settled).toBe(true);
    expect(k.closed).toBe(false);
    expect(kept).toHaveBeenCalledTimes(1);
    k.close();
    expect(k.closed).toBe(true);
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('«встал» и уход — по настоящему времени: часы сцены не идут, а момент всё равно встаёт и уходит', () => {
    const f = fakeScene();
    const onDone = vi.fn();
    const h = moment(f.scene, 'victory', { onDone, sound: false });
    // Ни одного delayedCall сцены: расписание — realLater (кадр + performance.now).
    expect(f.timers).toHaveLength(0);
    const tl = momentTimeline('victory');
    f.runTimers(tl.settled - 1);
    expect(h.settled).toBe(false);
    f.runTimers(tl.settled);
    expect(h.settled).toBe(true);
    // Заголовок доведён до конца, даже если твин отстал.
    const title = f.made[2] as { scale: number; alpha: number };
    expect(title.alpha).toBe(1);
    f.runTimers(tl.closeAt);
    expect(h.closed).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    // Подписки на кадр сняты.
    expect(f.pending()).toBe(0);
  });

  it('depth: слои момента на заданной глубине; keep без анимации — неподвижное конечное состояние', () => {
    const f = fakeScene();
    moment(f.scene, 'newChapter', { keep: true, depth: 1, subtitle: 'Пайон', sound: false });
    const depths = f.made.map((o) => (o as { depth: number }).depth);
    // Затемнение 1, лучи 2, заголовок и подзаголовок 3 — под содержимым экрана (окна, подсказки — выше).
    expect(depths.slice(0, 4)).toEqual([1, 2, 3, 3]);

    setReducedMotion(true);
    const g = fakeScene();
    const onSettled = vi.fn();
    const k = moment(g.scene, 'newChapter', { keep: true, depth: 1, dimAfter: 0.4, onSettled, sound: false });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(g.tweens).toHaveLength(0);
    // Затемнение (сразу на dimAfter) и заголовок — видимы.
    const dim = g.made[0] as { alpha: number; scene: unknown };
    expect(dim.alpha).toBe(0.4);
    expect(g.made.some((o) => o !== dim && (o as { alpha: number }).alpha === 1)).toBe(true);
    k.close();
    expect(k.closed).toBe(true);
    expect(dim.scene).toBeUndefined();
    setReducedMotion(false);
  });
});

describe('juice: награды и декоративные твины', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    setReducedMotion(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rewardFly: без анимации — сразу; иначе ≤ 8 иконок, первая долетевшая — подскок «таблетки» на 1.15', () => {
    setReducedMotion(true);
    const off = fakeScene();
    const done = vi.fn();
    rewardFly(off.scene, { x: 0, y: 0 }, { x: 10, y: 10 }, { key: 'item_gold' }, { n: 5, onFirst: done, onDone: done });
    expect(done).toHaveBeenCalledTimes(2);
    expect(off.made).toHaveLength(0);

    setReducedMotion(false);
    const f = fakeScene();
    const box = fakeObj();
    const first = vi.fn();
    const all = vi.fn();
    rewardFly(f.scene, { x: 0, y: 0 }, { x: 10, y: 10, box: box as unknown as Phaser.GameObjects.Container }, [{ key: 'a' }, { key: 'b' }], { n: 20, onFirst: first, onDone: all });
    expect(f.made).toHaveLength(8);
    // Вылет: M.fast, разброс 40 мс.
    const out = f.tweens.slice(0, 8);
    expect(out.every((t) => t.cfg.duration === M.fast && t.cfg.ease === E.out)).toBe(true);
    expect(out[7].cfg.delay).toBe(7 * 40);
    // Каждая долетает: вылет → полёт (M.slow) → конец.
    for (let i = 0; i < 8; i++) (out[i].cfg.onComplete as () => void)();
    const fly = f.tweens.slice(8, 16);
    expect(fly.every((t) => t.cfg.duration === M.slow && t.cfg.ease === E.in)).toBe(true);
    (fly[0].cfg.onComplete as () => void)();
    expect(first).toHaveBeenCalledTimes(1);
    const bumpTw = f.tweens.find((t) => t.targets[0] === box);
    expect(bumpTw?.cfg.scale).toBeCloseTo(BUMP);
    for (const t of fly.slice(1)) (t.cfg.onComplete as () => void)();
    expect(all).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('пульсы: не больше DECOR_CAP на сцену; уничтоженные освобождают место; новая жизнь сцены — с нуля', () => {
    const f = fakeScene();
    const objs = Array.from({ length: DECOR_CAP + 5 }, () => fakeObj());
    for (const o of objs) pulse(f.scene, o as unknown as Phaser.GameObjects.GameObject, 1.05, 700);
    expect(f.tweens).toHaveLength(DECOR_CAP);
    expect(decorStats(f.scene).tweens).toBe(DECOR_CAP);
    // Период прилип к шкале.
    expect(f.tweens[0].cfg).toMatchObject({ duration: M.emphasis, ease: E.inOut, repeat: -1 });
    (objs[0] as { destroy(): void }).destroy();
    pulse(f.scene, objs[DECOR_CAP] as unknown as Phaser.GameObjects.GameObject);
    expect(f.tweens).toHaveLength(DECOR_CAP + 1);
    for (const fn of f.shutdown) fn();
    expect(decorStats(f.scene).tweens).toBe(0);
  });

  it('«сердцебиение» значков — один общий твин на сцену, не больше HEARTBEAT_CAP значков', () => {
    const f = fakeScene();
    const objs = Array.from({ length: HEARTBEAT_CAP + 4 }, () => fakeObj());
    for (const o of objs) heartbeat(f.scene, o as unknown as Phaser.GameObjects.Container);
    heartbeat(f.scene, objs[0] as unknown as Phaser.GameObjects.Container);
    expect(f.tweens).toHaveLength(1);
    expect(decorStats(f.scene)).toEqual({ tweens: 1, beats: HEARTBEAT_CAP });
    // Удар масштабирует все значки от их базы.
    (f.tweens[0].cfg.onUpdate as (t: { getValue(): number }) => void)({ getValue: () => 1 });
    expect((objs[3] as { scale: number }).scale).toBeCloseTo(1.18);
    expect((objs[HEARTBEAT_CAP + 1] as { scale: number }).scale).toBe(1);
  });
});
