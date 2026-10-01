import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGameContext, ROOT } from '../scripts/lib/content-node';
import { buildRegistry, type SpritesV2 } from '../src/pipeline/sprites';
import {
  animTimeScale,
  chestFlight,
  DIORAMA_H,
  DIORAMA_W,
  ENEMY_SLOTS,
  ENEMY_SPAWN_DX,
  enemyPool,
  HERO_SLOTS,
  MAX_ENEMIES,
  MAX_ENEMY_CELL_H,
  planWave,
  squadLineup,
  T,
  ULT_EVERY,
  ultHeroFor,
  waveUnits,
  type LineupHero,
} from '../src/game/idleDioramaPlan';

/** Диорама «Отряд в походе» на странице «Город» (src/game/idleDiorama.ts): чистая часть — idleDioramaPlan.ts. */

const ctx = loadGameContext();
const SPRITES = buildRegistry(undefined, JSON.parse(readFileSync(join(ROOT, 'assets/sprites/sprites.json'), 'utf8')) as SpritesV2);
const spriteOf = (u: string) => ctx.content.units[u]?.visual.sprite;
const cellH = (sp: string) => SPRITES[sp]?.cell[1];

describe('враги волн — с текущего этапа', () => {
  it('каждый этап кампании даёт 1–3 монстра с лёгкими листами, из этого этапа или его главы', () => {
    for (const st of ctx.content.stages) {
      const pool = enemyPool(ctx.content.stages, st.id, spriteOf, cellH);
      expect(pool.length, st.id).toBeGreaterThan(0);
      expect(pool.length).toBeLessThanOrEqual(MAX_ENEMIES);
      expect(new Set(pool).size).toBe(pool.length);
      const chapterUnits = new Set(ctx.content.stages.filter((s) => s.chapter === st.chapter).flatMap((s) => s.enemies.filter((e) => e).map((e) => e!.unit)));
      for (const u of pool) {
        expect(chapterUnits.has(u), `${st.id}: ${u}`).toBe(true);
        expect(cellH(spriteOf(u)!), `${st.id}: ${u}`).toBeLessThanOrEqual(MAX_ENEMY_CELL_H);
      }
    }
  });

  it('обычный этап — монстры именно этого этапа; этап с одним боссом — монстры соседнего этапа главы', () => {
    const stages = [
      { id: 'a1', chapter: 'c', enemies: [{ unit: 'poring' }, null, { unit: 'fabre' }, { unit: 'poring' }, null] },
      { id: 'a2', chapter: 'c', enemies: [{ unit: 'boss' }, null, null, null, null] },
      { id: 'b1', chapter: 'd', enemies: [{ unit: 'orc' }, null, null, null, null] },
    ];
    const sprite = (u: string) => u;
    const cell = (sp: string) => (sp === 'boss' ? 256 : 224);
    expect(enemyPool(stages, 'a1', sprite, cell)).toEqual(['poring', 'fabre']);
    expect(enemyPool(stages, 'a2', sprite, cell)).toEqual(['poring', 'fabre']);
    expect(enemyPool(stages, 'b1', sprite, cell)).toEqual(['orc']);
    // Нет лёгких нигде в главе — юниты этапа как есть; неизвестный этап — пусто.
    expect(enemyPool([stages[1]], 'a2', sprite, cell)).toEqual(['boss']);
    expect(enemyPool(stages, 'zz', sprite, cell)).toEqual([]);
  });

  it('волна — 1–3 монстра из пула, волны отличаются', () => {
    const pool = ['a', 'b', 'c'];
    const sizes = new Set<number>();
    for (let w = 0; w < 30; w++) {
      const u = waveUnits(pool, w);
      expect(u.length).toBeGreaterThanOrEqual(1);
      expect(u.length).toBeLessThanOrEqual(MAX_ENEMIES);
      for (const x of u) expect(pool).toContain(x);
      sizes.add(u.length);
    }
    expect(sizes.size).toBeGreaterThan(1);
    expect(waveUnits([], 3)).toEqual([]);
    expect(waveUnits(['a'], 1).every((x) => x === 'a')).toBe(true);
  });
});

describe('отряд в диораме', () => {
  const def = (sprite: string, atk: number, ult?: string) => ({ visual: { sprite }, stats: { atk }, skills: { ult } });

  it('герои — по слотам отряда, пустые и неизвестные пропущены, не больше пяти', () => {
    const defs = { h1: def('knight_m', 120, 'bash'), h2: def('priest_f', 80), h3: def('archer_f', 99.6, 'double') };
    const l = squadLineup(['h1', null, 'h3', 'gone', 'h2'], defs);
    expect(l.map((h) => [h.heroId, h.slot, h.sprite])).toEqual([
      ['h1', 0, 'knight_m'],
      ['h3', 2, 'archer_f'],
      ['h2', 4, 'priest_f'],
    ]);
    expect(l[1].atk).toBe(100);
    expect(l[2].ult).toBeUndefined();
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`x${i}`, def('s', 1)]));
    expect(squadLineup(Object.keys(many), many)).toHaveLength(5);
  });

  it('ульта — каждая третья волна, герои с ультой по очереди', () => {
    const l = [{ ult: 'a' }, {}, { ult: 'c' }];
    const ults = Array.from({ length: 12 }, (_, w) => ultHeroFor(w, l));
    expect(ults.filter((u) => u !== null)).toHaveLength(12 / ULT_EVERY);
    expect(ults.filter((u) => u !== null)).toEqual([0, 2, 0, 2]);
    expect(ultHeroFor(2, [{}, {}])).toBeNull();
  });

  it('раскладка: точки героев слева, монстров справа, всё внутри полосы (и место появления монстра тоже)', () => {
    for (const p of HERO_SLOTS) {
      expect(p.x).toBeGreaterThan(40);
      expect(p.x).toBeLessThan(DIORAMA_W / 2);
      expect(p.y).toBeLessThan(DIORAMA_H);
    }
    for (const p of ENEMY_SLOTS) {
      expect(p.x).toBeGreaterThan(DIORAMA_W / 2);
      expect(p.x + ENEMY_SPAWN_DX).toBeLessThan(DIORAMA_W - 40);
      expect(p.y).toBeLessThan(DIORAMA_H);
    }
  });
});

describe('сценарий волны', () => {
  const heroes: Pick<LineupHero, 'atk' | 'slot'>[] = [
    { atk: 100, slot: 0 },
    { atk: 60, slot: 2 },
    { atk: 80, slot: 4 },
  ];

  it('все монстры падают ровно один раз, после выхода; события по времени; волна кончается после последнего падения', () => {
    for (let wave = 0; wave < 40; wave++) {
      for (let n = 1; n <= 3; n++) {
        const ult = wave % 3 === 2 ? 1 : null;
        const p = planWave({ heroes, enemies: n, wave, ult });
        const killed = new Map<number, number>();
        let last = 0;
        let lastKill = 0;
        for (const e of p.events) {
          expect(e.at).toBeGreaterThanOrEqual(last);
          expect(e.at).toBeGreaterThanOrEqual(T.walkIn);
          last = e.at;
          if (e.type === 'attack' && e.kill) killed.set(e.target, (killed.get(e.target) ?? 0) + 1);
          if (e.type === 'ult') for (const t of e.targets) killed.set(t, (killed.get(t) ?? 0) + 1);
          if ((e.type === 'attack' && e.kill) || e.type === 'ult') lastKill = e.at + T.hit;
        }
        expect([...killed.keys()].sort()).toEqual(Array.from({ length: n }, (_, i) => i));
        expect([...killed.values()].every((c) => c === 1)).toBe(true);
        expect(p.end).toBe(lastKill + T.death + T.rest);
        // Ульта в своей волне — ровно одна, у нужного героя.
        const ults = p.events.filter((e) => e.type === 'ult');
        expect(ults.length).toBe(ult === null ? 0 : 1);
        if (ults[0]?.type === 'ult') expect(ults[0].hero).toBe(1);
      }
    }
  });

  it('удары по живым целям, монстры отвечают по фронту, урон около атаки героя (ульта ×3)', () => {
    const p = planWave({ heroes, enemies: 3, wave: 7, ult: null, enemyAtk: 40 });
    const dead = new Set<number>();
    for (const e of p.events) {
      if (e.type === 'attack') {
        expect(dead.has(e.target)).toBe(false);
        expect(e.dmg).toBeGreaterThanOrEqual(Math.floor(heroes[e.hero].atk * 0.85));
        expect(e.dmg).toBeLessThanOrEqual(Math.ceil(heroes[e.hero].atk * 1.15));
        if (e.kill) dead.add(e.target);
      }
      if (e.type === 'enemyAttack') {
        expect(heroes[e.hero].slot).toBeLessThanOrEqual(1);
        expect(e.dmg).toBeGreaterThanOrEqual(34);
        expect(e.dmg).toBeLessThanOrEqual(46);
      }
    }
    expect(p.events.some((e) => e.type === 'enemyAttack')).toBe(true);
    const u = planWave({ heroes, enemies: 2, wave: 2, ult: 0 }).events.find((e) => e.type === 'ult');
    expect(u?.dmg).toBeGreaterThanOrEqual(255);
  });

  it('одна волна — один сценарий; волна недолгая (≤ 8 с); без героев или монстров — пусто', () => {
    expect(planWave({ heroes, enemies: 2, wave: 5, ult: null })).toEqual(planWave({ heroes, enemies: 2, wave: 5, ult: null }));
    for (let w = 0; w < 30; w++) expect(planWave({ heroes: heroes.slice(0, 1), enemies: 3, wave: w, ult: null }).end).toBeLessThanOrEqual(8000);
    expect(planWave({ heroes: [], enemies: 2, wave: 0, ult: null }).events).toEqual([]);
    expect(planWave({ heroes, enemies: 0, wave: 0, ult: null }).events).toEqual([]);
  });
});

describe('анимации и сундук', () => {
  it('кадры листов — не чаще 10 в секунду', () => {
    expect(animTimeScale(80)).toBeCloseTo(0.8);
    expect(animTimeScale(90)).toBeCloseTo(0.9);
    expect(animTimeScale(150)).toBe(1);
    expect(animTimeScale(0)).toBe(1);
    for (const ms of [40, 80, 90, 100, 150]) expect(ms / animTimeScale(ms)).toBeGreaterThanOrEqual(100);
  });

  it('к сундуку летят монетки; предмет — только если в сундуке правда прибавился; сундук не копится — ничего', () => {
    expect(chestFlight(null, null, 0)).toEqual({ coins: 0, exp: false, item: null });
    expect(chestFlight({ gold: 10, items: [] }, { gold: 10, items: [] }, 0)).toEqual({ coins: 1, exp: false, item: null });
    expect(chestFlight({ gold: 10, items: [] }, { gold: 30, items: [] }, 1)).toEqual({ coins: 2, exp: true, item: null });
    expect(chestFlight({ gold: 10, items: ['a'] }, { gold: 30, items: ['a', 'b'] }, 2).item).toBe('b');
    // Первый показ (prev нет) — предмет не «выдумываем».
    expect(chestFlight(null, { gold: 30, items: ['a'] }, 0).item).toBeNull();
  });
});
