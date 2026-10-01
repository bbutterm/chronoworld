// Общий таймлайн промо: одно время `time` (MotionValue Framer Motion, секунды) — от него считается каждый кадр.
// Анимации таймлайна — чистые функции времени (пружины — генератор `spring` Framer Motion, вычисляемый в момент t),
// поэтому seek(t) даёт один и тот же кадр и в браузере, и при рендере mp4 (render.mjs).
import { motionValue, spring } from 'framer-motion';
import { useLayoutEffect, useRef } from 'react';

export const DUR = 35;
export const time = motionValue(0);


/** Режим рендера (?render=1): без часов, интерфейса и звука — кадры ставит render.mjs через window.seek(t). */
const Q = new URLSearchParams(location.search);
export const RENDER = Q.has('render');
/** ?t=12.3 — открыть на паузе в момент t (проверка кадра). */
const START = Q.has('t') ? Number(Q.get('t')) : null;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
/** Доля пути 0…1 между a и b. */
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const easeOut = (k) => 1 - (1 - k) ** 3;
export const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

const springs = new Map();
/** Пружина Framer Motion, вычисленная в момент dt (секунды после старта): 0 → 1 с перелётом. */
export function sp(dt, stiffness = 260, damping = 16) {
  if (dt <= 0) return 0;
  const key = `${stiffness}|${damping}`;
  let g = springs.get(key);
  if (!g) {
    g = spring({ keyframes: [0, 1], stiffness, damping, restDelta: 0.0002, restSpeed: 0.0005 });
    springs.set(key, g);
  }
  return g.next(dt * 1000).value;
}

/** Детерминированный «шум» по номеру — для частиц и тряски. */
export function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Привязать стиль элемента к времени: fn(t) → объект стилей. Подписка на MotionValue — без перерисовки React,
 * стиль ставится синхронно при каждом seek/кадре.
 */
export function useTL(fn) {
  const ref = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useLayoutEffect(() => {
    const apply = (t) => {
      const el = ref.current;
      if (!el) return;
      const s = fnRef.current(t, el);
      if (s) for (const k in s) el.style[k] = s[k];
    };
    apply(time.get());
    return time.on('change', apply);
  }, []);
  return ref;
}

// ---- Удары: вспышка, тряска и звук на сменах сцен -------------------------------------------------------------

/** t — момент удара, f — сила (вспышка и тряска), s — звук (public/audio/<s>.m4a|ogg), red — красная вспышка. */
export const IMPACTS = [
  { t: 0.85, f: 0.9, s: 'charge_break' }, // логотип
  { t: 3.0, f: 0.4, s: 'hit_sword' },
  { t: 3.75, f: 1, s: 'crit' }, // Удар Асуры
  { t: 4.3, f: 0.5, s: 'hit_blunt' },
  { t: 6.4, f: 0.5, s: 'hit_sword' },
  { t: 6.85, f: 0.8, s: 'crit' }, // Владыка Вермилиона
  { t: 8.25, f: 1.15, s: 'charge_break', red: true }, // «Сбито!»
  { t: 9.6, f: 0.3, s: 'hit_sword' },
  { t: 11.5, f: 0.25, s: 'coin' },
  { t: 12.4, f: 0.3, s: 'hit_sword' },
  { t: 13.7, f: 0.5, s: 'job_change' },
  { t: 15.4, f: 0.45, s: 'level_up' },
  { t: 17.8, f: 0.3, s: 'hit_sword' },
  { t: 18.9, f: 0.7, s: 'chest_open' }, // призыв
  { t: 20.4, f: 0.9, s: 'mon_dracula_attack', red: true },
  { t: 21.6, f: 0.8, s: 'hit_blunt', red: true },
  { t: 22.8, f: 0.9, s: 'mon_baphomet__attack', red: true },
  { t: 24.65, f: 0.6, s: 'chest_open' }, // карта MVP
  { t: 26.0, f: 0.25, s: 'hit_sword' },
  { t: 28.6, f: 0.4, s: 'hit_sword' },
  { t: 29.05, f: 0.25, s: 'coin' }, // карты веером
  { t: 31.2, f: 0.8, s: 'charge_break' },
  { t: 33.15, f: 0.3, s: 'coin' }, // «Играть»
];

/** Сила вспышки в момент t (0…1). */
export function flashAt(t) {
  let v = 0;
  for (const i of IMPACTS) {
    const d = t - i.t;
    if (d >= 0 && d < 0.5) v = Math.max(v, i.f * 0.85 * (1 - d / 0.5) ** 2);
  }
  return v;
}
export function redAt(t) {
  let v = 0;
  for (const i of IMPACTS) {
    const d = t - i.t;
    if (i.red && d >= 0 && d < 0.9) v = Math.max(v, (1 - d / 0.9) ** 1.5);
  }
  return v;
}
/** Смещение тряски (в долях ширины сцены) в момент t. */
export function shakeAt(t) {
  let x = 0;
  let y = 0;
  let r = 0;
  IMPACTS.forEach((i, n) => {
    const d = t - i.t;
    if (d < 0 || d > 0.45) return;
    const a = i.f * (1 - d / 0.45) ** 2 * 0.022;
    x += Math.sin(d * 70 + n) * a;
    y += Math.cos(d * 83 + n * 2) * a;
    r += Math.sin(d * 55 + n * 3) * a * 40;
  });
  return { x, y, r };
}

// ---- Часы -------------------------------------------------------------------------------------------------------

export const clock = {
  playing: !RENDER && START == null,
  listeners: new Set(),
  set(p) {
    this.playing = p;
    this.listeners.forEach((f) => f(p));
  },
};

export function seek(t) {
  time.set(((t % DUR) + DUR) % DUR);
}

if (START != null) seek(START);
