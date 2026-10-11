/**
 * Поздний бой не слипается в ком (ui-core 6): на 6-1 «Отмель у Излуда» отряд из пяти и трое врагов сходились в пятно
 * ~150×150 CSS — личный эллипс разведения (battleSpread.ts) был меньше самих фигур, а потолок смещения 100 не давал
 * развести больше трёх бойцов. Только отображение: позиции ядра берутся из лога как есть (tests/formation.ts
 * sampleBattle), разведение — spreadUnits/settleSpread, ширина фигуры — тело спрайта (battleSpritePresentation).
 *
 * Метрика — «слипшиеся пары»: тела двух живых бойцов (прямоугольники от ног вверх) перекрываются больше чем на SHARE
 * площади меньшего. Масштаб фигур — как на телефоне 460×1000 (герой ≈ 150 ед. поля в ширину).
 * До правки (эллипс 150×120 без учёта тел, потолок смещения 100, 6 итераций): семь фигур в одной точке — 3 пары;
 * по логу ядра 6-1 — 1.02 пары на тик боя, 6-2 — 0.89. После (эллипс по телам × 1.05, потолок 200, 10 итераций):
 * 2 пары; 0.50 и 0.23.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enemySquad, simulateBattle, type UnitDef } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { buildRegistry } from '../src/pipeline/sprites';
import { battleSpritePresentation } from '../src/game/battlePresentation';
import { settleSpread, type SpreadUnit } from '../src/game/battleSpread';
import { heroSquad, sampleBattle } from './formation';

const ctx = loadFullContext();
const registry = buildRegistry(undefined, JSON.parse(fs.readFileSync('assets/sprites/sprites.json', 'utf8')));
const FIELD_CX = ctx.combat.field.width / 2;
const SQUEEZE = 0.84;
const fieldX = (x: number) => FIELD_CX + (x - FIELD_CX) * SQUEEZE;
const BOUNDS = ctx.combat.field.bounds ?? { minX: 70, maxX: ctx.combat.field.width - 70, minY: 900, maxY: 1840 };
const ARENA = { minX: 0, maxX: 1080, minY: 520, maxY: 1660 };
/** Масштаб листа на телефоне (460×1000: фигура героя ≈ 150 ед. поля в ширину, как на снимках атласа). */
const PHONE_SCALE = 0.56;
/** Пара «слиплась», если тела перекрываются больше чем на эту долю меньшего. */
const SHARE = 0.3;

function body(def: UnitDef): { w: number; h: number } {
  const sprite = registry[def.visual.sprite];
  if (!sprite) return { w: 150, h: 250 };
  const p = battleSpritePresentation(sprite, sprite.scale * (def.visual.scale ?? 1) * PHONE_SCALE, ARENA);
  return { w: p.body.right - p.body.left, h: p.body.bottom - p.body.top };
}

function clumped(stageId: string, seeds: number): { perTick: number; maxOff: number } {
  const A = heroSquad(ctx, ['swordman', 'thief', 'archer', 'mage', 'acolyte'], 60);
  const B = enemySquad(stageId, ctx);
  let bad = 0;
  let ticks = 0;
  let maxOff = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulateBattle(ctx.content, A, B, seed, { combat: ctx.combat });
    const defs = new Map(r.units.map((u) => [u.uid, [...A, ...B].find((d) => d?.id === u.unitId) ?? ctx.content.units[u.unitId]]));
    const views = new Map<string, SpreadUnit & { w: number; h: number }>();
    for (const u of r.units) {
      const def = defs.get(u.uid)!;
      const b = body(def);
      views.set(u.uid, { pos: { x: u.x, y: u.y }, offX: 0, offY: 0, sx: u.x, sy: u.y, side: u.side, extra: def.kind === 'boss' ? 60 : 0, active: true, halfW: b.w / 2 / SQUEEZE, ...b });
    }
    sampleBattle(r, ctx.combat, (pts, uids) => {
      for (const v of views.values()) v.active = false;
      uids.forEach((uid, i) => {
        const v = views.get(uid);
        if (!v) return;
        v.active = true;
        v.pos.x = pts[i][0];
        v.pos.y = pts[i][1];
      });
      const live = [...views.values()].filter((v) => v.active);
      settleSpread(live, BOUNDS);
      ticks++;
      for (const v of live) maxOff = Math.max(maxOff, Math.abs(v.offX), Math.abs(v.offY));
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i];
          const c = live[j];
          // Тела — прямоугольники от ног вверх (вид 3/4: глубже стоящий выше на экране).
          const ax = fieldX(a.pos.x + a.offX);
          const cx = fieldX(c.pos.x + c.offX);
          const ay = a.pos.y + a.offY;
          const cy = c.pos.y + c.offY;
          const ox = Math.min(ax + a.w / 2, cx + c.w / 2) - Math.max(ax - a.w / 2, cx - c.w / 2);
          const oy = Math.min(ay, cy) - Math.max(ay - a.h, cy - c.h);
          if (ox > 0 && oy > 0 && ox * oy > SHARE * Math.min(a.w * a.h, c.w * c.h)) bad++;
        }
      }
    });
  }
  return { perTick: bad / Math.max(1, ticks), maxOff };
}

/** Слипшиеся пары среди живых видов после разведения (та же метрика, что в clumped). */
function badPairs(live: readonly (SpreadUnit & { w: number; h: number })[]): number {
  let bad = 0;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const c = live[j];
      const ax = fieldX(a.pos.x + a.offX);
      const cx = fieldX(c.pos.x + c.offX);
      const ay = a.pos.y + a.offY;
      const cy = c.pos.y + c.offY;
      const ox = Math.min(ax + a.w / 2, cx + c.w / 2) - Math.max(ax - a.w / 2, cx - c.w / 2);
      const oy = Math.min(ay, cy) - Math.max(ay - a.h, cy - c.h);
      if (ox > 0 && oy > 0 && ox * oy > SHARE * Math.min(a.w * a.h, c.w * c.h)) bad++;
    }
  }
  return bad;
}

/** Семь бойцов 6-1 (пятеро героев, Скелет-пират, Сворд-фиш, Марс) сошлись к одной цели, как на снимке атласа. */
function convergedFight(): (SpreadUnit & { w: number; h: number })[] {
  const heroes = heroSquad(ctx, ['swordman', 'thief', 'archer', 'mage', 'acolyte'], 60).filter((u): u is UnitDef => !!u);
  const foes = enemySquad('ch6_s1', ctx).filter((u): u is UnitDef => !!u);
  const at = (def: UnitDef, side: 'A' | 'B', x: number, y: number) => {
    const b = body(def);
    return { pos: { x, y }, offX: 0, offY: 0, sx: x, sy: y, side, extra: 0, active: true, halfW: b.w / 2 / SQUEEZE, ...b };
  };
  // Ближники обеих сторон — у одной точки (540, 1280) с разбросом в пару десятков единиц, стрелки — чуть позади.
  return [
    ...heroes.map((d, i) => at(d, 'A', 500 + (i % 3) * 15, 1250 + i * 18)),
    ...foes.map((d, i) => at(d, 'B', 560 + i * 12, 1260 + i * 22)),
  ];
}

describe('разведение фигур в позднем бою (ui-core 6)', () => {
  it('семь фигур в одной точке расходятся: слипшихся пар меньше, все в границах поля', () => {
    const units = convergedFight();
    expect(badPairs(units)).toBeGreaterThan(10);
    settleSpread(units, BOUNDS);
    const bad = badPairs(units);
    expect(bad).toBeLessThanOrEqual(2);
    for (const u of units) {
      expect(u.pos.x + u.offX).toBeGreaterThanOrEqual(BOUNDS.minX - 1e-6);
      expect(u.pos.x + u.offX).toBeLessThanOrEqual(BOUNDS.maxX + 1e-6);
      expect(u.pos.y + u.offY).toBeGreaterThanOrEqual(BOUNDS.minY - 1e-6);
      expect(u.pos.y + u.offY).toBeLessThanOrEqual(BOUNDS.maxY + 1e-6);
    }
  });

  for (const [stageId, limit] of [['ch6_s1', 0.65], ['ch6_s2', 0.45]] as const) {
    it(`${stageId}: по логу ядра слипшихся пар заметно меньше (до правки ≈ 1.0 и 0.9 на тик), смещение в пределах потолка`, () => {
      const s = clumped(stageId, 3);
      expect(s.perTick).toBeLessThan(limit);
      expect(s.maxOff).toBeLessThanOrEqual(200);
    });
  }
});
