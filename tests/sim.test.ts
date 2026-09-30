import { describe, expect, it } from 'vitest';
import { parseSquad, runSeries } from '../src/core';
import { loadContent, loadFullContext } from '../scripts/lib/content-node';
import { smoothSquads } from '../scripts/lib/player-model';

const GAME = loadContent();
const SQUAD = parseSquad('guard,warrior,archer,mage,priest');
/**
 * Герои с профилями поведения (docs/design/battle-behavior.md §5): страж, стрелок, лекарь, маг, охотница против
 * тарана, ассасина, монаха, мага и кузнеца — фиолетовые ур. 45. Меряет правила профилей (кайт, якорь, фокус, прыжки).
 */
const FULL = loadFullContext();
const HEROES = smoothSquads(FULL, 45, [['alan', 'bran', 'vika', 'lira', 'meilin']])[0];
const FOES = smoothSquads(FULL, 45, [['iris', 'zara', 'teo', 'kai', 'otto']])[0];

/** Процессорное время (мс) потока (Node ≥ 22.19 / 23.9), иначе процесса, потраченное на fn. */
function cpuMs(fn: () => unknown): number {
  const p = process as NodeJS.Process & { threadCpuUsage?: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage };
  const read = (prev?: NodeJS.CpuUsage) => (p.threadCpuUsage ? p.threadCpuUsage(prev) : process.cpuUsage(prev));
  const start = read();
  fn();
  const d = read(start);
  return (d.user + d.system) / 1000;
}

/** Эталонная нагрузка того же рода, что бой: объекты, массивы, сортировка, арифметика. */
function calibration(): number {
  let acc = 0;
  for (let round = 0; round < 1000; round++) {
    const units = Array.from({ length: 200 }, (_, i) => ({ id: i, hp: (i * 7919 + round) % 1000, spd: (i * 104729) % 97 }));
    for (let t = 0; t < 20; t++) {
      units.sort((a, b) => b.spd - a.spd || a.id - b.id);
      for (const u of units) {
        u.hp = Math.max(0, u.hp - ((u.spd * 31 + t) % 17));
        acc += Math.sqrt(u.hp + 1);
      }
    }
  }
  return acc;
}

describe('симулятор', () => {
  it('parseSquad: пустые слоты и добивка до 5', () => {
    expect(parseSquad('guard,-,mage')).toEqual(['guard', null, 'mage', null, null]);
    expect(() => parseSquad('a,b,c,d,e,f')).toThrow();
  });

  it('1000 боёв быстрее 2 секунд', () => {
    // Меряем процессорное время своего потока, а не настенные часы: под нагрузкой (параллельные тесты, e2e,
    // сборка) поток ждёт ядро, и wall clock растёт без всякой регрессии. Прогрев (JIT) — вне замера.
    runSeries(GAME, SQUAD, SQUAD, 30);
    const battles = cpuMs(() => expect(runSeries(GAME, SQUAD, SQUAD, 1000).n).toBe(1000));
    if (battles < 2000) return;
    // Медленная машина (или соседи по SMT-ядру): сравниваем с эталонной нагрузкой в том же процессе.
    // Сейчас бои ≈ 12 эталонов (эталон ≈ 110 мс CPU); регрессия примерно в 2 раза выйдет за 25.
    const calib = Math.min(cpuMs(calibration), cpuMs(calibration));
    expect(battles / calib, `бои ${battles.toFixed(0)} мс CPU, эталон ${calib.toFixed(0)} мс`).toBeLessThan(25);
  });

  it('профили поведения: 1000 боёв героев не дороже +25% к тем же боям без профилей', () => {
    // docs/design/battle-behavior.md §5: бюджет правил — +25%. Сравнение в одном процессе (под нагрузкой оба замера
    // замедляются одинаково); лучший из двух замеров каждого вида. Сейчас ≈ 1.0: бои с профилями короче (≈ 35 с против
    // 50 с), тик дороже на ≈ 40% (плотнее бой: те же удары за меньше тиков).
    const on = { combat: FULL.combat };
    const off = { combat: FULL.combat, behavior: false };
    runSeries(FULL.content, HEROES, FOES, 30, 1, on);
    runSeries(FULL.content, HEROES, FOES, 30, 1, off);
    const t = (opts: typeof on) => Math.min(...[0, 1].map(() => cpuMs(() => expect(runSeries(FULL.content, HEROES, FOES, 500, 1, opts).n).toBe(500))));
    const withRules = t(on);
    const without = t(off);
    expect(withRules / without, `с профилями ${withRules.toFixed(0)} мс CPU, без ${without.toFixed(0)} мс`).toBeLessThan(1.25);
  });

  it('результаты серии воспроизводимы', () => {
    expect(runSeries(GAME, SQUAD, SQUAD, 50, 1)).toEqual(runSeries(GAME, SQUAD, SQUAD, 50, 1));
  });
});
