import { describe, expect, it } from 'vitest';
import { detectHapticOut, GLOBAL_GAP_MS, HAPTICS, HapticEngine, haptic, loadHapticsOn, STEP_MS, type HapticDeps, type HapticId, type HapticOut } from '../src/game/haptics';

/** Выход-заглушка: записывает все вызовы. */
function fakeOut() {
  const calls: string[] = [];
  const out: HapticOut = {
    tg: {
      impactOccurred: (s) => calls.push(`impact:${s}`),
      notificationOccurred: (t) => calls.push(`notify:${t}`),
      selectionChanged: () => calls.push('select'),
    },
    vibrate: null,
  };
  return { out, calls };
}

function setup(over: Partial<HapticDeps> = {}) {
  const { out, calls } = fakeOut();
  let t = 1000;
  const pending: { fn: () => void; at: number }[] = [];
  const state = { on: true, paused: false };
  const eng = new HapticEngine({
    out: () => out,
    now: () => t,
    enabled: () => state.on,
    paused: () => state.paused,
    later: (fn, ms) => pending.push({ fn, at: t + ms }),
    ...over,
  });
  const advance = (ms: number) => {
    t += ms;
    for (const p of pending.splice(0)) {
      if (p.at <= t) p.fn();
      else pending.push(p);
    }
  };
  return { eng, calls, state, advance };
}

describe('вибрация (haptics.ts)', () => {
  it('таблица: у каждого момента есть импульсы и зазор не меньше общего', () => {
    for (const [id, def] of Object.entries(HAPTICS)) {
      expect(def.steps.length, id).toBeGreaterThan(0);
      expect(def.gap, id).toBeGreaterThanOrEqual(GLOBAL_GAP_MS - 10);
    }
  });

  it('момент вызывает нужный метод Telegram HapticFeedback', () => {
    const { eng, calls } = setup();
    expect(eng.fire('tap')).toBe(true);
    expect(calls).toEqual(['select']);
  });

  it('общий лимит частоты: второй импульс раньше GLOBAL_GAP_MS — пропущен', () => {
    const { eng, calls, advance } = setup();
    expect(eng.fire('tap')).toBe(true);
    advance(GLOBAL_GAP_MS - 20);
    expect(eng.fire('cardFlip')).toBe(false);
    advance(30);
    expect(eng.fire('cardFlip')).toBe(true);
    expect(calls).toEqual(['select', 'impact:light']);
  });

  it('в бою — один импульс на класс событий за окно (ульта бьёт по пятерым — одна вибрация)', () => {
    const { eng, calls, advance } = setup();
    let n = 0;
    for (let i = 0; i < 5; i++) {
      if (eng.fire('ultHit')) n++;
      advance(80);
    }
    expect(n).toBe(1);
    advance(HAPTICS.ultHit.gap);
    expect(eng.fire('ultHit')).toBe(true);
    expect(calls.filter((c) => c === 'impact:medium')).toHaveLength(2);
  });

  it('босс: успех, затем тяжёлый удар через STEP_MS', () => {
    const { eng, calls, advance } = setup();
    eng.fire('bossDown');
    expect(calls).toEqual(['notify:success']);
    advance(STEP_MS);
    expect(calls).toEqual(['notify:success', 'impact:heavy']);
  });

  it('тост-ошибка сразу после поломки при заточке — без второй вибрации', () => {
    const { eng, advance } = setup();
    eng.fire('refineFail');
    advance(200);
    expect(eng.fire('error')).toBe(false);
    advance(HAPTICS.error.quiet);
    expect(eng.fire('error')).toBe(true);
  });

  it('настройка выключена или игра на паузе — ничего', () => {
    const { eng, calls, state, advance } = setup();
    state.on = false;
    expect(eng.fire('victory')).toBe(false);
    state.on = true;
    state.paused = true;
    expect(eng.fire('victory')).toBe(false);
    expect(calls).toEqual([]);
    // Второй шаг момента не срабатывает, если игру успели свернуть.
    state.paused = false;
    eng.fire('bossDown');
    state.paused = true;
    advance(STEP_MS);
    expect(calls).toEqual(['notify:success']);
  });

  it('нет Telegram и vibrate — молча ничего; ошибка выхода не ломает игру', () => {
    const none = setup({ out: () => ({ tg: null, vibrate: null }) });
    expect(none.eng.fire('tap')).toBe(false);
    const broken = setup({
      out: () => ({
        tg: {
          impactOccurred: () => {
            throw new Error('нет');
          },
          notificationOccurred: () => undefined,
          selectionChanged: () => undefined,
        },
        vibrate: null,
      }),
    });
    expect(() => broken.eng.fire('cardFlip')).not.toThrow();
    // Публичный вызов в окружении тестов (нет window, Telegram, lifecycle).
    for (const id of Object.keys(HAPTICS) as HapticId[]) expect(() => haptic(id)).not.toThrow();
  });

  it('определение выхода: Telegram 6.1+, старый Telegram, Android, iOS, компьютер', () => {
    const hf = { impactOccurred: () => 0, notificationOccurred: () => 0, selectionChanged: () => 0 };
    const tg = (ver: number, platform = 'android') => ({ Telegram: { WebApp: { HapticFeedback: hf, platform, isVersionAtLeast: (v: string) => ver >= Number(v) } } });
    expect(detectHapticOut(tg(7)).tg).toBe(hf);
    expect(detectHapticOut(tg(6)).tg).toBeNull();
    // SDK подключён, но страница открыта не в Telegram.
    expect(detectHapticOut(tg(7, 'unknown')).tg).toBeNull();
    const vib: number[][] = [];
    const nav = (ua: string) => ({ userAgent: ua, vibrate: (p: number | number[]) => vib.push([p].flat()) > 0, userActivation: { hasBeenActive: true } });
    const android = detectHapticOut({ navigator: nav('Mozilla/5.0 (Linux; Android 14)') });
    expect(android.tg).toBeNull();
    android.vibrate?.(12);
    expect(vib).toEqual([[12]]);
    expect(detectHapticOut({ navigator: nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)') }).vibrate).toBeNull();
    expect(detectHapticOut({ navigator: nav('Mozilla/5.0 (Windows NT 10.0)') }).vibrate).toBeNull();
    expect(detectHapticOut({})).toEqual({ tg: null, vibrate: null });
    // До первого касания Chrome блокирует vibrate (и ругается в консоль) — не зовём.
    const cold = detectHapticOut({ navigator: { ...nav('Android'), userActivation: { hasBeenActive: false } } });
    expect(cold.vibrate?.(12)).toBe(false);
    expect(vib).toHaveLength(1);
  });

  it('настройка: по умолчанию вкл, «0» — выкл, сломанное хранилище — вкл', () => {
    const kv = (v: string | null) => ({ getItem: () => v, setItem: () => undefined });
    expect(loadHapticsOn(kv(null))).toBe(true);
    expect(loadHapticsOn(kv('0'))).toBe(false);
    expect(loadHapticsOn(kv('1'))).toBe(true);
    expect(loadHapticsOn(null)).toBe(true);
    expect(
      loadHapticsOn({
        getItem: () => {
          throw new Error('запрещено');
        },
        setItem: () => undefined,
      }),
    ).toBe(true);
  });
});
