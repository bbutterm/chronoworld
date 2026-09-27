/**
 * Заглушки звуков, синтезированные кодом (в духе jsfxr): пока владелец не положил файлы в assets/audio/, игра
 * не молчит. Всё — чистые функции без Web Audio: на выходе моно-сэмплы Float32 (−1…1), детерминированно
 * (свой генератор шума), поэтому проверяется в тестах. Рендер ленивый — при первом проигрывании звука.
 *
 * Звуки: 22 050 Гц, 0.03–2 с. Музыка и фон: 16 000 Гц, бесшовные петли 10–25 с (тихие, без резких звуков).
 */
import { SFX, type AmbienceId, type MusicId, type SfxId } from './audioCatalog';

export const SFX_RATE = 22050;
export const LOOP_RATE = 16000;

export interface Pcm {
  rate: number;
  data: Float32Array;
  /** Петля (музыка, фон). */
  loop?: boolean;
}

// ---------- примитивы ----------

type Wave = 'sine' | 'tri' | 'square' | 'saw';
const TAU = Math.PI * 2;

function osc(w: Wave, ph: number): number {
  const x = ph - Math.floor(ph);
  switch (w) {
    case 'sine':
      return Math.sin(TAU * x);
    case 'tri':
      return 4 * Math.abs(x - 0.5) - 1;
    case 'square':
      return x < 0.5 ? 0.6 : -0.6;
    case 'saw':
      return (2 * x - 1) * 0.7;
  }
}

/** Детерминированный шум (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface Env {
  /** Начало, с. */
  at?: number;
  /** Длительность, с. */
  dur: number;
  gain?: number;
  /** Атака, с. */
  attack?: number;
  /** Постоянная экспоненциального затухания, с (нет — держится до конца). */
  decay?: number;
}

interface ToneOpts extends Env {
  /** Частота, Гц. */
  f: number;
  /** Конечная частота (плавный экспоненциальный переход). */
  to?: number;
  wave?: Wave;
  /** Вибрато: глубина (доля частоты) и частота, Гц. */
  vib?: [number, number];
  /** Обертоны: [множитель частоты, громкость] (колокольчик, «металл»). */
  harm?: [number, number][];
}

/** Тон в буфер. wrap — петля: хвост за концом буфера переходит в начало. */
function tone(b: Float32Array, rate: number, o: ToneOpts, wrap = false): void {
  const start = Math.round((o.at ?? 0) * rate);
  const n = Math.round(o.dur * rate);
  const w = o.wave ?? 'sine';
  const ratio = (o.to ?? o.f) / o.f;
  // Всё пошагово (множители вместо pow/exp на каждый сэмпл): музыка рендерится на телефоне.
  const fMul = ratio === 1 ? 1 : Math.pow(ratio, 1 / n);
  const aN = Math.max(1, Math.round((o.attack ?? 0.002) * rate));
  const dMul = o.decay ? Math.exp(-1 / (o.decay * rate)) : 1;
  const tailN = Math.round(0.012 * rate);
  const gain = o.gain ?? 1;
  const harm = o.harm;
  const hPh = harm ? harm.map(() => 0) : [];
  // Вибрато — вращающийся вектор (cos, sin) вместо sin на каждый сэмпл.
  const vDepth = o.vib ? o.vib[0] : 0;
  const vStep = o.vib ? (TAU * o.vib[1]) / rate : 0;
  const vc = Math.cos(vStep);
  const vs = Math.sin(vStep);
  let vx = 1;
  let vy = 0;
  let f = o.f;
  let dEnv = 1;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    let idx = start + i;
    if (idx >= b.length) {
      if (!wrap) break;
      idx %= b.length;
    }
    let e = i < aN ? i / aN : (dEnv *= dMul);
    const left = n - i;
    if (left < tailN) e *= left / tailN;
    let fi = f;
    if (vDepth) {
      fi *= 1 + vDepth * vy;
      const nx = vx * vc - vy * vs;
      vy = vx * vs + vy * vc;
      vx = nx;
    }
    f *= fMul;
    ph += fi / rate;
    if (ph >= 1) ph -= Math.floor(ph);
    let s = osc(w, ph);
    if (harm) {
      for (let k = 0; k < harm.length; k++) {
        hPh[k] += (fi * harm[k][0]) / rate;
        if (hPh[k] >= 1) hPh[k] -= Math.floor(hPh[k]);
        s += Math.sin(TAU * hPh[k]) * harm[k][1];
      }
    }
    b[idx] += s * e * gain;
  }
}

interface NoiseOpts extends Env {
  /** Срез фильтра низких частот, Гц (и конечный — «свист» вихря). */
  lp?: number;
  lpTo?: number;
  /** Срез фильтра высоких частот, Гц. */
  hp?: number;
  seed?: number;
}

function noise(b: Float32Array, rate: number, o: NoiseOpts, wrap = false): void {
  const start = Math.round((o.at ?? 0) * rate);
  const n = Math.round(o.dur * rate);
  const r = rng(o.seed ?? 7);
  let lp = 0;
  let hpLow = 0;
  const lp0 = Math.min(o.lp ?? rate / 2, rate / 2);
  const lp1 = Math.min(o.lpTo ?? lp0, rate / 2);
  const fMul = lp1 === lp0 ? 1 : Math.pow(lp1 / lp0, 1 / n);
  let fc = lp0;
  let a = Math.min(1, 1 - Math.exp((-TAU * fc) / rate));
  const aHp = o.hp ? 1 - Math.exp((-TAU * o.hp) / rate) : 0;
  const aN = Math.max(1, Math.round((o.attack ?? 0.002) * rate));
  const dMul = o.decay ? Math.exp(-1 / (o.decay * rate)) : 1;
  const tailN = Math.round(0.012 * rate);
  const gain = o.gain ?? 1;
  let dEnv = 1;
  for (let i = 0; i < n; i++) {
    let idx = start + i;
    if (idx >= b.length) {
      if (!wrap) break;
      idx %= b.length;
    }
    if (fMul !== 1 && (i & 31) === 0) {
      fc = lp0 * Math.pow(fMul, i);
      a = Math.min(1, 1 - Math.exp((-TAU * fc) / rate));
    }
    lp += a * (r() * 2 - 1 - lp);
    let s = lp;
    if (aHp) {
      hpLow += aHp * (s - hpLow);
      s -= hpLow;
    }
    let e = i < aN ? i / aN : (dEnv *= dMul);
    const left = n - i;
    if (left < tailN) e *= left / tailN;
    b[idx] += s * e * gain;
  }
}

const make = (sec: number, rate = SFX_RATE) => new Float32Array(Math.max(1, Math.ceil(sec * rate)));

/** Пик → peak, мягкое ограничение (без цифрового хруста). */
function finish(b: Float32Array, peak = 0.85): Float32Array {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  const k = m > 0 ? peak / m : 0;
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * k * 1.2) / Math.tanh(1.2);
  return b;
}

/** Арпеджио: ноты (midi) подряд через step секунд. */
function arp(b: Float32Array, notes: number[], step: number, o: Partial<ToneOpts> & { dur: number }, rate = SFX_RATE): void {
  notes.forEach((m, i) => tone(b, rate, { wave: 'tri', decay: o.dur / 3, ...o, f: midi(m), at: (o.at ?? 0) + i * step }));
}

const BELL: [number, number][] = [
  [2, 0.35],
  [3.01, 0.15],
  [4.2, 0.08],
];

// ---------- звуки ----------

const RECIPES: Record<SfxId, () => Float32Array> = {
  ui_tap: () => {
    const b = make(0.05);
    tone(b, SFX_RATE, { f: 1700, to: 1200, dur: 0.05, decay: 0.012 });
    noise(b, SFX_RATE, { dur: 0.012, gain: 0.25, hp: 3000 });
    return finish(b, 0.7);
  },
  ui_tab: () => {
    const b = make(0.09);
    tone(b, SFX_RATE, { f: 900, dur: 0.04, decay: 0.015, wave: 'tri' });
    tone(b, SFX_RATE, { f: 1350, at: 0.035, dur: 0.055, decay: 0.02, wave: 'tri' });
    return finish(b, 0.7);
  },
  ui_back: () => {
    const b = make(0.1);
    tone(b, SFX_RATE, { f: 900, to: 480, dur: 0.1, decay: 0.035, wave: 'tri' });
    return finish(b, 0.7);
  },
  ui_open: () => {
    const b = make(0.16);
    tone(b, SFX_RATE, { f: 420, to: 980, dur: 0.14, attack: 0.01, decay: 0.05 });
    noise(b, SFX_RATE, { dur: 0.1, gain: 0.15, lp: 800, lpTo: 4000, attack: 0.02, decay: 0.04 });
    return finish(b, 0.7);
  },
  ui_toggle: () => {
    const b = make(0.05);
    tone(b, SFX_RATE, { f: 2200, dur: 0.02, decay: 0.006 });
    tone(b, SFX_RATE, { f: 1600, at: 0.02, dur: 0.03, decay: 0.008 });
    return finish(b, 0.6);
  },
  ui_error: () => {
    const b = make(0.24);
    tone(b, SFX_RATE, { f: 196, dur: 0.1, wave: 'square', decay: 0.06 });
    tone(b, SFX_RATE, { f: 165, at: 0.11, dur: 0.12, wave: 'square', decay: 0.07 });
    return finish(b, 0.6);
  },
  ui_notify: () => {
    const b = make(0.4);
    tone(b, SFX_RATE, { f: midi(81), dur: 0.3, decay: 0.1, harm: BELL });
    tone(b, SFX_RATE, { f: midi(88), at: 0.08, dur: 0.32, decay: 0.12, harm: BELL });
    return finish(b, 0.6);
  },
  claim: () => {
    const b = make(0.5);
    arp(b, [84, 88, 91], 0.06, { dur: 0.3, harm: BELL, wave: 'sine' });
    noise(b, SFX_RATE, { dur: 0.25, gain: 0.08, hp: 6000, decay: 0.08 });
    return finish(b);
  },
  coin: () => {
    const b = make(0.3);
    tone(b, SFX_RATE, { f: 988, dur: 0.06, wave: 'square', decay: 0.05 });
    tone(b, SFX_RATE, { f: 1319, at: 0.055, dur: 0.24, wave: 'square', decay: 0.08 });
    return finish(b, 0.6);
  },
  gem: () => {
    const b = make(0.45);
    tone(b, SFX_RATE, { f: 1568, dur: 0.4, decay: 0.12, harm: BELL });
    tone(b, SFX_RATE, { f: 2093, at: 0.04, dur: 0.38, decay: 0.1, gain: 0.6, harm: BELL });
    return finish(b, 0.6);
  },
  chest_open: () => {
    const b = make(1.0);
    // Скрип крышки, глухой стук, затем россыпь искр.
    tone(b, SFX_RATE, { f: 180, to: 260, dur: 0.22, wave: 'saw', gain: 0.25, vib: [0.08, 23], attack: 0.03 });
    noise(b, SFX_RATE, { at: 0.2, dur: 0.12, lp: 400, gain: 0.9, decay: 0.04 });
    tone(b, SFX_RATE, { at: 0.2, f: 110, to: 60, dur: 0.15, decay: 0.05 });
    arp(b, [84, 88, 91, 96, 100], 0.05, { at: 0.3, dur: 0.45, harm: BELL, wave: 'sine', gain: 0.6 });
    noise(b, SFX_RATE, { at: 0.3, dur: 0.6, hp: 7000, gain: 0.12, decay: 0.2, seed: 3 });
    return finish(b);
  },
  quest_done: () => {
    const b = make(0.7);
    arp(b, [76, 79, 84], 0.09, { dur: 0.4, wave: 'tri' });
    tone(b, SFX_RATE, { at: 0.27, f: midi(88), dur: 0.4, decay: 0.15, harm: BELL });
    return finish(b);
  },
  unlock: () => {
    const b = make(1.0);
    tone(b, SFX_RATE, { f: 300, to: 1200, dur: 0.5, attack: 0.2, decay: 0.3, vib: [0.02, 7] });
    arp(b, [79, 84, 88, 91, 96], 0.06, { at: 0.35, dur: 0.5, harm: BELL, wave: 'sine', gain: 0.7 });
    return finish(b);
  },
  equip: () => {
    const b = make(0.25);
    noise(b, SFX_RATE, { dur: 0.03, hp: 2500, gain: 0.5, decay: 0.01 });
    tone(b, SFX_RATE, { f: 1180, dur: 0.2, decay: 0.05, harm: [[1.48, 0.5], [2.3, 0.3]] });
    return finish(b, 0.7);
  },
  level_up: () => {
    const b = make(1.1);
    arp(b, [72, 76, 79, 84, 88], 0.07, { dur: 0.35, wave: 'square', gain: 0.35, decay: 0.12 });
    tone(b, SFX_RATE, { at: 0.35, f: midi(84), dur: 0.7, decay: 0.3, wave: 'tri', vib: [0.006, 6] });
    tone(b, SFX_RATE, { at: 0.35, f: midi(91), dur: 0.7, decay: 0.3, wave: 'tri', gain: 0.6 });
    noise(b, SFX_RATE, { at: 0.35, dur: 0.7, hp: 6000, gain: 0.1, decay: 0.25, seed: 11 });
    return finish(b);
  },
  job_change: () => {
    const b = make(1.8);
    // Фанфара: «та-та-та-таа» и мажорный аккорд с блеском.
    const n = [67, 67, 67, 72];
    n.forEach((m, i) => tone(b, SFX_RATE, { at: i * 0.12, f: midi(m), dur: i === 3 ? 1.2 : 0.11, wave: 'saw', gain: 0.35, decay: i === 3 ? 0.5 : 0.08, vib: i === 3 ? [0.008, 5] : undefined }));
    for (const m of [60, 64, 67, 76]) tone(b, SFX_RATE, { at: 0.36, f: midi(m), dur: 1.3, wave: 'tri', gain: 0.35, attack: 0.03, decay: 0.55 });
    arp(b, [84, 88, 91, 96], 0.05, { at: 0.4, dur: 0.6, harm: BELL, wave: 'sine', gain: 0.4 });
    return finish(b);
  },
  rarity_up: () => {
    const b = make(1.2);
    tone(b, SFX_RATE, { f: 220, to: 880, dur: 0.45, attack: 0.3, wave: 'saw', gain: 0.25 });
    noise(b, SFX_RATE, { dur: 0.45, lp: 500, lpTo: 6000, attack: 0.3, gain: 0.3 });
    for (const m of [72, 76, 79, 84]) tone(b, SFX_RATE, { at: 0.44, f: midi(m), dur: 0.75, decay: 0.3, harm: BELL, gain: 0.5 });
    return finish(b);
  },
  summon_pull: () => {
    const b = make(0.8);
    noise(b, SFX_RATE, { dur: 0.8, lp: 300, lpTo: 3000, attack: 0.35, decay: 0.25, gain: 1 });
    tone(b, SFX_RATE, { f: 110, to: 330, dur: 0.8, attack: 0.3, decay: 0.3, gain: 0.3, vib: [0.03, 9] });
    return finish(b, 0.8);
  },
  summon_tension: () => {
    // Длинное нарастание 1.6 с (таверна обрывает его на открытии — короче у обычных героев).
    const b = make(1.6);
    noise(b, SFX_RATE, { dur: 1.6, lp: 200, lpTo: 5000, attack: 1.5, gain: 0.6 });
    for (let i = 0; i < 24; i++) tone(b, SFX_RATE, { at: i * (1.6 / 24) * (1 - i / 60), f: 90, to: 60, dur: 0.06, decay: 0.02, gain: 0.2 + i / 30 });
    tone(b, SFX_RATE, { f: 220, to: 880, dur: 1.6, attack: 1.4, wave: 'saw', gain: 0.15 });
    return finish(b, 0.8);
  },
  summon_common: () => {
    const b = make(0.5);
    tone(b, SFX_RATE, { f: midi(76), dur: 0.4, decay: 0.12, harm: BELL });
    noise(b, SFX_RATE, { dur: 0.1, lp: 2000, gain: 0.3, decay: 0.03 });
    return finish(b, 0.7);
  },
  summon_rare: () => {
    const b = make(0.8);
    arp(b, [79, 86], 0.08, { dur: 0.6, harm: BELL, wave: 'sine', decay: 0.2 });
    noise(b, SFX_RATE, { dur: 0.5, hp: 5000, gain: 0.15, decay: 0.15 });
    return finish(b, 0.8);
  },
  summon_epic: () => {
    const b = make(1.3);
    noise(b, SFX_RATE, { dur: 0.2, lp: 600, gain: 0.8, decay: 0.06 });
    for (const m of [69, 76, 81, 84]) tone(b, SFX_RATE, { at: 0.05, f: midi(m), dur: 1.2, decay: 0.45, harm: BELL, gain: 0.45, vib: [0.004, 5] });
    noise(b, SFX_RATE, { at: 0.1, dur: 1.1, hp: 6000, gain: 0.15, decay: 0.4, seed: 5 });
    return finish(b);
  },
  summon_legendary: () => {
    const b = make(2.2);
    // Удар, золотой аккорд с колоколами и долгий блеск.
    noise(b, SFX_RATE, { dur: 0.35, lp: 300, gain: 1, decay: 0.12 });
    tone(b, SFX_RATE, { f: 80, to: 40, dur: 0.5, decay: 0.2, gain: 0.9 });
    for (const m of [60, 67, 72, 76, 79, 84]) tone(b, SFX_RATE, { at: 0.08, f: midi(m), dur: 2.0, attack: 0.02, decay: 0.8, wave: 'tri', gain: 0.35, vib: [0.005, 5] });
    arp(b, [84, 88, 91, 96, 100, 103], 0.07, { at: 0.2, dur: 1.0, harm: BELL, wave: 'sine', gain: 0.45 });
    noise(b, SFX_RATE, { at: 0.1, dur: 2.0, hp: 7000, gain: 0.18, decay: 0.7, seed: 9 });
    return finish(b, 0.9);
  },
  swing: () => {
    const b = make(0.16);
    noise(b, SFX_RATE, { dur: 0.16, lp: 800, lpTo: 3500, attack: 0.06, decay: 0.05, hp: 400 });
    return finish(b, 0.6);
  },
  hit_sword: () => {
    const b = make(0.22);
    noise(b, SFX_RATE, { dur: 0.06, hp: 1500, gain: 0.9, decay: 0.02 });
    tone(b, SFX_RATE, { f: 2300, dur: 0.2, decay: 0.05, gain: 0.35, harm: [[1.37, 0.6], [2.1, 0.3]] });
    tone(b, SFX_RATE, { f: 140, to: 70, dur: 0.08, decay: 0.03, gain: 0.7 });
    return finish(b);
  },
  hit_dagger: () => {
    const b = make(0.14);
    noise(b, SFX_RATE, { dur: 0.04, hp: 2500, gain: 0.9, decay: 0.012 });
    tone(b, SFX_RATE, { f: 3100, dur: 0.12, decay: 0.03, gain: 0.3, harm: [[1.5, 0.4]] });
    return finish(b, 0.8);
  },
  hit_blunt: () => {
    const b = make(0.22);
    tone(b, SFX_RATE, { f: 160, to: 55, dur: 0.2, decay: 0.06 });
    noise(b, SFX_RATE, { dur: 0.08, lp: 1200, gain: 0.8, decay: 0.025 });
    return finish(b);
  },
  hit_arrow: () => {
    const b = make(0.12);
    noise(b, SFX_RATE, { dur: 0.03, lp: 3000, gain: 0.9, decay: 0.01 });
    tone(b, SFX_RATE, { f: 700, to: 350, dur: 0.1, decay: 0.03, wave: 'tri' });
    return finish(b, 0.8);
  },
  hit_claw: () => {
    const b = make(0.18);
    tone(b, SFX_RATE, { f: 320, to: 110, dur: 0.16, decay: 0.05, wave: 'tri' });
    noise(b, SFX_RATE, { dur: 0.06, lp: 1500, gain: 0.6, decay: 0.02 });
    return finish(b, 0.8);
  },
  hit_magic: () => {
    const b = make(0.25);
    tone(b, SFX_RATE, { f: 1600, to: 400, dur: 0.22, decay: 0.07 });
    noise(b, SFX_RATE, { dur: 0.15, hp: 3000, gain: 0.3, decay: 0.05 });
    return finish(b, 0.8);
  },
  crit: () => {
    const b = make(0.35);
    noise(b, SFX_RATE, { dur: 0.1, lp: 5000, gain: 1, decay: 0.03 });
    tone(b, SFX_RATE, { f: 120, to: 45, dur: 0.3, decay: 0.1, gain: 1 });
    tone(b, SFX_RATE, { f: 1800, dur: 0.25, decay: 0.06, gain: 0.3, harm: [[1.41, 0.5]] });
    return finish(b, 0.9);
  },
  bow_shot: () => {
    const b = make(0.2);
    tone(b, SFX_RATE, { f: 330, to: 180, dur: 0.12, decay: 0.04, wave: 'tri' });
    noise(b, SFX_RATE, { at: 0.02, dur: 0.16, lp: 1500, lpTo: 5000, gain: 0.4, attack: 0.02, decay: 0.05 });
    return finish(b, 0.7);
  },
  cast_start: () => {
    const b = make(0.5);
    tone(b, SFX_RATE, { f: 300, to: 600, dur: 0.5, attack: 0.15, decay: 0.2, vib: [0.03, 8] });
    tone(b, SFX_RATE, { f: 450, to: 900, dur: 0.5, attack: 0.15, decay: 0.2, gain: 0.4 });
    return finish(b, 0.6);
  },
  cast_fire: () => {
    const b = make(0.6);
    noise(b, SFX_RATE, { dur: 0.6, lp: 400, lpTo: 2500, attack: 0.08, decay: 0.2, gain: 1 });
    noise(b, SFX_RATE, { dur: 0.5, hp: 4000, gain: 0.2, decay: 0.15, seed: 21 });
    tone(b, SFX_RATE, { f: 90, to: 60, dur: 0.4, decay: 0.15, gain: 0.5 });
    return finish(b);
  },
  cast_ice: () => {
    const b = make(0.6);
    for (const [f, at] of [[2637, 0], [3136, 0.04], [3951, 0.08], [2349, 0.12]] as const) tone(b, SFX_RATE, { at, f, dur: 0.4, decay: 0.1, harm: BELL, gain: 0.4 });
    noise(b, SFX_RATE, { dur: 0.5, hp: 5000, gain: 0.3, decay: 0.15 });
    return finish(b);
  },
  cast_wind: () => {
    const b = make(0.5);
    noise(b, SFX_RATE, { dur: 0.08, gain: 1, decay: 0.02 });
    noise(b, SFX_RATE, { at: 0.06, dur: 0.4, lp: 1200, gain: 0.6, decay: 0.12, seed: 31 });
    tone(b, SFX_RATE, { f: 60, dur: 0.4, wave: 'saw', decay: 0.12, gain: 0.4, vib: [0.3, 37] });
    return finish(b);
  },
  cast_earth: () => {
    const b = make(0.6);
    noise(b, SFX_RATE, { dur: 0.6, lp: 180, gain: 1, attack: 0.02, decay: 0.2 });
    tone(b, SFX_RATE, { f: 70, to: 35, dur: 0.5, decay: 0.18 });
    noise(b, SFX_RATE, { at: 0.1, dur: 0.1, lp: 1500, gain: 0.4, decay: 0.03, seed: 41 });
    return finish(b);
  },
  cast_holy: () => {
    const b = make(0.8);
    for (const m of [76, 80, 83, 88]) tone(b, SFX_RATE, { f: midi(m), dur: 0.75, attack: 0.03, decay: 0.3, harm: BELL, gain: 0.4 });
    noise(b, SFX_RATE, { dur: 0.7, hp: 6000, gain: 0.15, attack: 0.05, decay: 0.25 });
    return finish(b);
  },
  cast_dark: () => {
    const b = make(0.7);
    tone(b, SFX_RATE, { f: 220, to: 70, dur: 0.6, wave: 'saw', decay: 0.25, gain: 0.5 });
    tone(b, SFX_RATE, { f: 227, to: 72, dur: 0.6, wave: 'saw', decay: 0.25, gain: 0.5 });
    noise(b, SFX_RATE, { dur: 0.6, lp: 600, gain: 0.4, attack: 0.1, decay: 0.2 });
    return finish(b);
  },
  cast_poison: () => {
    const b = make(0.6);
    const r = rng(51);
    for (let i = 0; i < 7; i++) {
      const f = 250 + r() * 400;
      tone(b, SFX_RATE, { at: i * 0.07, f, to: f * 1.8, dur: 0.07, decay: 0.03, gain: 0.7 });
    }
    noise(b, SFX_RATE, { dur: 0.5, lp: 900, gain: 0.25, decay: 0.2 });
    return finish(b, 0.8);
  },
  cast_neutral: () => {
    const b = make(0.45);
    tone(b, SFX_RATE, { f: 500, to: 1500, dur: 0.15, decay: 0.08 });
    tone(b, SFX_RATE, { at: 0.12, f: 1500, to: 300, dur: 0.3, decay: 0.1, wave: 'tri', gain: 0.6 });
    noise(b, SFX_RATE, { dur: 0.3, hp: 3500, gain: 0.2, decay: 0.1 });
    return finish(b, 0.8);
  },
  ult: () => {
    const b = make(0.7);
    tone(b, SFX_RATE, { f: 110, to: 440, dur: 0.6, attack: 0.45, wave: 'saw', gain: 0.4 });
    noise(b, SFX_RATE, { dur: 0.6, lp: 300, lpTo: 6000, attack: 0.5, gain: 0.5 });
    tone(b, SFX_RATE, { at: 0.5, f: midi(88), dur: 0.2, decay: 0.08, harm: BELL, gain: 0.6 });
    return finish(b, 0.9);
  },
  heal: () => {
    const b = make(0.8);
    // Heal из RO: светлое «дзинь» вверх и мерцание.
    arp(b, [76, 80, 83, 88], 0.05, { dur: 0.55, harm: BELL, wave: 'sine', decay: 0.18, gain: 0.6 });
    noise(b, SFX_RATE, { dur: 0.6, hp: 6500, gain: 0.12, attack: 0.05, decay: 0.2 });
    return finish(b, 0.8);
  },
  buff: () => {
    const b = make(0.55);
    tone(b, SFX_RATE, { f: 440, to: 1320, dur: 0.3, attack: 0.05, decay: 0.12, wave: 'tri' });
    tone(b, SFX_RATE, { at: 0.2, f: midi(88), dur: 0.35, decay: 0.12, harm: BELL, gain: 0.5 });
    return finish(b, 0.7);
  },
  debuff: () => {
    const b = make(0.5);
    tone(b, SFX_RATE, { f: 700, to: 180, dur: 0.45, decay: 0.18, wave: 'tri', vib: [0.04, 11] });
    return finish(b, 0.7);
  },
  shield: () => {
    const b = make(0.5);
    tone(b, SFX_RATE, { f: 330, dur: 0.45, attack: 0.03, decay: 0.2, harm: [[2, 0.5], [3.02, 0.3], [5.1, 0.15]] });
    noise(b, SFX_RATE, { dur: 0.1, hp: 3000, gain: 0.3, decay: 0.03 });
    return finish(b, 0.7);
  },
  stun: () => {
    const b = make(0.6);
    for (let i = 0; i < 3; i++) tone(b, SFX_RATE, { at: i * 0.16, f: 2400, to: 3400, dur: 0.1, decay: 0.05, gain: 0.6 });
    tone(b, SFX_RATE, { f: 150, to: 70, dur: 0.12, decay: 0.04 });
    return finish(b, 0.7);
  },
  death_monster: () => {
    const b = make(0.45);
    // «Пуф»: пузырь лопнул и сдулся (поринг).
    tone(b, SFX_RATE, { f: 900, to: 150, dur: 0.35, decay: 0.12, wave: 'tri' });
    noise(b, SFX_RATE, { at: 0.02, dur: 0.25, lp: 2500, lpTo: 400, gain: 0.6, decay: 0.08 });
    return finish(b, 0.8);
  },
  death_hero: () => {
    const b = make(0.9);
    tone(b, SFX_RATE, { f: midi(64), to: midi(52), dur: 0.8, decay: 0.35, wave: 'tri' });
    tone(b, SFX_RATE, { f: midi(67), to: midi(55), dur: 0.8, decay: 0.35, wave: 'tri', gain: 0.5 });
    noise(b, SFX_RATE, { dur: 0.15, lp: 500, gain: 0.5, decay: 0.05 });
    return finish(b, 0.8);
  },
  boss_intro: () => {
    const b = make(1.8);
    for (const at of [0, 0.22, 0.44]) {
      tone(b, SFX_RATE, { at, f: 90, to: 45, dur: 0.3, decay: 0.1 });
      noise(b, SFX_RATE, { at, dur: 0.12, lp: 600, gain: 0.5, decay: 0.04, seed: 61 + at * 10 });
    }
    tone(b, SFX_RATE, { at: 0.66, f: midi(43), dur: 1.1, attack: 0.08, decay: 0.6, wave: 'saw', gain: 0.4, vib: [0.006, 5] });
    tone(b, SFX_RATE, { at: 0.66, f: midi(50), dur: 1.1, attack: 0.08, decay: 0.6, wave: 'saw', gain: 0.35 });
    return finish(b, 0.9);
  },
  boss_death: () => {
    const b = make(1.5);
    noise(b, SFX_RATE, { dur: 1.2, lp: 2000, lpTo: 150, gain: 1, decay: 0.4 });
    tone(b, SFX_RATE, { f: 200, to: 35, dur: 1.2, decay: 0.45 });
    arp(b, [72, 76, 79, 84], 0.09, { at: 0.5, dur: 0.8, harm: BELL, wave: 'sine', gain: 0.35 });
    return finish(b, 0.9);
  },
  battle_start: () => {
    const b = make(0.9);
    tone(b, SFX_RATE, { f: midi(55), dur: 0.25, attack: 0.03, decay: 0.2, wave: 'saw', gain: 0.5 });
    tone(b, SFX_RATE, { at: 0.22, f: midi(60), dur: 0.6, attack: 0.03, decay: 0.3, wave: 'saw', gain: 0.5, vib: [0.006, 5] });
    return finish(b, 0.8);
  },
  victory: () => {
    const b = make(2.0);
    const mel: [number, number, number][] = [
      [72, 0, 0.14],
      [76, 0.14, 0.14],
      [79, 0.28, 0.14],
      [84, 0.42, 0.3],
      [79, 0.72, 0.14],
      [84, 0.86, 1.0],
    ];
    for (const [m, at, dur] of mel) tone(b, SFX_RATE, { at, f: midi(m), dur, wave: 'square', gain: 0.35, decay: dur * 0.8 });
    for (const m of [48, 60, 64, 67]) tone(b, SFX_RATE, { at: 0.86, f: midi(m), dur: 1.1, wave: 'tri', gain: 0.35, attack: 0.02, decay: 0.5 });
    noise(b, SFX_RATE, { at: 0.86, dur: 0.9, hp: 7000, gain: 0.1, decay: 0.3 });
    return finish(b);
  },
  defeat: () => {
    const b = make(2.0);
    const mel: [number, number, number][] = [
      [67, 0, 0.3],
      [66, 0.3, 0.3],
      [65, 0.6, 0.3],
      [64, 0.9, 1.0],
    ];
    for (const [m, at, dur] of mel) tone(b, SFX_RATE, { at, f: midi(m), dur, wave: 'tri', gain: 0.5, decay: dur * 0.9, vib: [0.006, 5] });
    for (const m of [40, 52, 55]) tone(b, SFX_RATE, { at: 0.9, f: midi(m), dur: 1.05, wave: 'tri', gain: 0.35, decay: 0.5 });
    return finish(b, 0.8);
  },
};

/** Сэмплы заглушки звука id (рендерится при каждом вызове — кэширует audio.ts). */
export function synthSfx(id: SfxId): Pcm {
  return { rate: SFX_RATE, data: RECIPES[id]() };
}

/** Есть ли рецепт у каждого звука каталога (тест). */
export const hasRecipe = (id: string): boolean => id in RECIPES && id in SFX;

// ---------- музыка ----------

interface MusicSpec {
  bpm: number;
  /** Тоника (midi). */
  root: number;
  /** Лад: ступени в полутонах от тоники. */
  scale: number[];
  /** Гармония: ступени лада по тактам. */
  chords: number[];
  bars: number;
  lead: 'box' | 'lute' | 'bell' | 'none';
  /** Доля восьмых с нотой мелодии. */
  density: number;
  bass: 'none' | 'half' | 'pulse';
  drums: 'none' | 'soft' | 'march' | 'heavy';
  /** Педаль тоники в басу (склеп, босс). */
  drone?: boolean;
  seed: number;
}

const PENTA = [0, 2, 4, 7, 9];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

const MUSIC_SPECS: Record<MusicId, MusicSpec> = {
  home: { bpm: 76, root: 60, scale: MAJOR, chords: [0, 5, 3, 4, 0, 5, 3, 4], bars: 8, lead: 'box', density: 0.45, bass: 'half', drums: 'none', seed: 1 },
  tavern: { bpm: 100, root: 55, scale: MAJOR, chords: [0, 3, 4, 0, 0, 3, 4, 0], bars: 8, lead: 'lute', density: 0.6, bass: 'half', drums: 'soft', seed: 2 },
  map_meadow: { bpm: 84, root: 62, scale: MAJOR, chords: [0, 4, 5, 3, 0, 4, 3, 4], bars: 8, lead: 'lute', density: 0.5, bass: 'half', drums: 'none', seed: 3 },
  map_swamp: { bpm: 70, root: 57, scale: DORIAN, chords: [0, 3, 0, 6, 0, 3, 6, 4], bars: 8, lead: 'bell', density: 0.3, bass: 'half', drums: 'none', seed: 4 },
  map_crypt: { bpm: 64, root: 50, scale: HARM_MINOR, chords: [0, 5, 3, 4, 0, 5, 3, 4], bars: 8, lead: 'bell', density: 0.25, bass: 'half', drums: 'none', drone: true, seed: 5 },
  battle_meadow: { bpm: 112, root: 57, scale: MINOR, chords: [0, 5, 2, 6, 0, 5, 3, 4], bars: 8, lead: 'lute', density: 0.55, bass: 'pulse', drums: 'march', seed: 6 },
  battle_swamp: { bpm: 106, root: 53, scale: DORIAN, chords: [0, 6, 0, 3, 0, 6, 3, 4], bars: 8, lead: 'lute', density: 0.45, bass: 'pulse', drums: 'march', seed: 7 },
  battle_crypt: { bpm: 104, root: 50, scale: HARM_MINOR, chords: [0, 5, 3, 4, 0, 5, 1, 4], bars: 8, lead: 'bell', density: 0.45, bass: 'pulse', drums: 'march', drone: true, seed: 8 },
  boss: { bpm: 124, root: 50, scale: PHRYGIAN, chords: [0, 1, 0, 6, 0, 1, 5, 4], bars: 8, lead: 'lute', density: 0.5, bass: 'pulse', drums: 'heavy', drone: true, seed: 9 },
};

/** Нота ступени deg лада (ступени за пределами лада — через октаву). */
function degree(spec: MusicSpec, deg: number, octave = 0): number {
  const n = spec.scale.length;
  const o = Math.floor(deg / n);
  return spec.root + spec.scale[((deg % n) + n) % n] + 12 * (o + octave);
}

/** Бесшовная петля музыки id (тихая заглушка: пэд, бас, мелодия музыкальной шкатулки/лютни, мягкие барабаны). */
export function synthMusic(id: MusicId): Pcm {
  const job = musicJob(id);
  for (const step of job.steps) step();
  return job.pcm;
}

/**
 * Рендер музыки по шагам (такт за шагом, последний — нормализация): audio.ts выполняет их между кадрами,
 * чтобы смена экрана не «подвисала» на телефоне. pcm готов после последнего шага.
 */
export function musicJob(id: MusicId): { pcm: Pcm; steps: (() => void)[] } {
  const spec = MUSIC_SPECS[id];
  const rate = LOOP_RATE;
  const beat = 60 / spec.bpm;
  const barLen = beat * 4;
  const b = make(barLen * spec.bars, rate);
  const r = rng(spec.seed * 101);
  const penta = spec.scale === MAJOR ? PENTA : null;
  const steps: (() => void)[] = [];
  const pcm: Pcm = { rate, data: b, loop: true };
  for (let bar = 0; bar < spec.bars; bar++) steps.push(() => renderBar(bar));
  steps.push(() => finish(b, 0.7));
  return { pcm, steps };

  function renderBar(bar: number): void {
    const c = spec.chords[bar % spec.chords.length];
    const t0 = bar * barLen;
    // Пэд: трезвучие, мягкая атака, через край такта (петля — в начало).
    for (const k of [0, 2, 4]) tone(b, rate, { at: t0, f: midi(degree(spec, c + k, 0)), dur: barLen * 1.15, attack: barLen * 0.3, decay: barLen * 0.8, gain: 0.09, wave: 'tri', vib: [0.003, 4 + k] }, true);
    // Бас.
    if (spec.bass === 'half') for (let h = 0; h < 2; h++) tone(b, rate, { at: t0 + h * barLen * 0.5, f: midi(degree(spec, c, -2)), dur: barLen * 0.5, decay: barLen * 0.3, gain: 0.22, wave: 'tri' }, true);
    if (spec.bass === 'pulse') for (let e = 0; e < 8; e++) tone(b, rate, { at: t0 + e * beat * 0.5, f: midi(degree(spec, c + (e === 6 ? 4 : 0), -2)), dur: beat * 0.45, decay: beat * 0.2, gain: 0.2, wave: 'tri' }, true);
    if (spec.drone) tone(b, rate, { at: t0, f: midi(spec.root - 24), dur: barLen, attack: 0.05, gain: 0.07, wave: 'saw' }, true);
    // Мелодия по восьмым: ноты аккорда и лада, плавные шаги.
    if (spec.lead !== 'none') {
      let last = c + 7;
      for (let e = 0; e < 8; e++) {
        const strong = e % 2 === 0;
        if (r() > spec.density * (strong ? 1.3 : 0.7)) continue;
        const step = [-2, -1, 0, 1, 1, 2][Math.floor(r() * 6)];
        last = Math.max(c + 3, Math.min(c + 11, last + step));
        let m = degree(spec, last, 1);
        if (penta) m = spec.root + 12 + nearest(penta, m - spec.root - 12);
        const at = t0 + e * beat * 0.5;
        if (spec.lead === 'box') tone(b, rate, { at, f: midi(m), dur: beat * 1.5, decay: beat * 0.5, gain: 0.16, harm: BELL }, true);
        else if (spec.lead === 'bell') tone(b, rate, { at, f: midi(m), dur: beat * 2, decay: beat * 0.8, gain: 0.13, harm: BELL }, true);
        else tone(b, rate, { at, f: midi(m), dur: beat * 0.8, decay: beat * 0.18, gain: 0.17, wave: 'tri', harm: [[2, 0.25]] }, true);
      }
    }
    // Барабаны: бочка, мягкий «шейкер», малый на 2 и 4.
    if (spec.drums !== 'none') {
      for (let q = 0; q < 4; q++) {
        const at = t0 + q * beat;
        const kick = spec.drums === 'soft' ? q === 0 || q === 2 : true;
        if (kick) tone(b, rate, { at, f: 110, to: 45, dur: 0.18, decay: 0.06, gain: spec.drums === 'heavy' ? 0.45 : 0.3 }, true);
        if (spec.drums !== 'soft' && (q === 1 || q === 3)) noise(b, rate, { at, dur: 0.14, lp: 3500, hp: 600, decay: 0.05, gain: 0.16, seed: bar * 4 + q }, true);
        for (const h of [0, 0.5]) noise(b, rate, { at: at + h * beat, dur: 0.05, hp: 5000, decay: 0.015, gain: 0.05, seed: 900 + bar * 8 + q * 2 + h * 2 }, true);
      }
    }
  }
}

function nearest(set: number[], semis: number): number {
  const o = Math.floor(semis / 12);
  const s = ((semis % 12) + 12) % 12;
  let best = set[0];
  for (const v of set) if (Math.abs(v - s) < Math.abs(best - s)) best = v;
  return best + 12 * o;
}

// ---------- фоновые звуки ----------

/** Склеить конец с началом (перекрёстное затухание fade с): петля без щелчка. */
function loopify(b: Float32Array, rate: number, fade: number): Float32Array {
  const f = Math.min(Math.floor(fade * rate), Math.floor(b.length / 2));
  const n = b.length - f;
  const out = b.slice(0, n);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = b[i] * k + b[n + i] * (1 - k);
  }
  return out;
}

export function synthAmbience(id: AmbienceId): Pcm {
  const rate = LOOP_RATE;
  const len = 10;
  const b = make(len + 1, rate);
  const r = rng(id.length * 77);
  // Ветер: шум с медленно «дышащим» фильтром.
  for (let k = 0; k < 5; k++) noise(b, rate, { at: k * 2.1, dur: 3.2, lp: id === 'amb_crypt' ? 250 : 500, lpTo: id === 'amb_crypt' ? 400 : 900, attack: 1.2, decay: 1.2, gain: 0.5, seed: 100 + k });
  if (id === 'amb_meadow') {
    for (let i = 0; i < 9; i++) {
      const at = r() * len;
      const f = 2800 + r() * 1800;
      for (let j = 0; j < 2 + Math.floor(r() * 3); j++) tone(b, rate, { at: at + j * 0.11, f, to: f * (1.2 + r() * 0.3), dur: 0.07, decay: 0.03, gain: 0.12 });
    }
  } else if (id === 'amb_swamp') {
    for (let i = 0; i < 14; i++) {
      const f = 180 + r() * 300;
      tone(b, rate, { at: r() * len, f, to: f * 2.2, dur: 0.06, decay: 0.02, gain: 0.25 });
    }
    for (let i = 0; i < 4; i++) {
      const at = r() * (len - 1);
      for (let j = 0; j < 3; j++) tone(b, rate, { at: at + j * 0.09, f: 95, dur: 0.08, wave: 'square', decay: 0.03, gain: 0.12 });
    }
  } else {
    tone(b, rate, { f: 55, dur: len + 1, attack: 1, gain: 0.12, vib: [0.01, 0.2] });
    for (let i = 0; i < 7; i++) {
      const f = 1200 + r() * 900;
      tone(b, rate, { at: r() * len, f, to: f * 0.6, dur: 0.12, decay: 0.03, gain: 0.25 });
    }
  }
  return { rate, data: finish(loopify(b, rate, 1), 0.5), loop: true };
}
