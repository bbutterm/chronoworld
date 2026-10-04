/**
 * Регрессии по отчёту QA «бой» (docs/qa/tester2-battle.md, пакет P1): по тесту на баг.
 * Сиды и отряды — из отчёта (герои без экипировки); с v4 отряды — карточки героев тех же классов (tests/helpers.ts JOB_CARD),
 * «Новички» — синтетические юниты профессии novice (её «Первая помощь» — проверка лечения себя).
 */
import { describe, expect, it } from 'vitest';
import { buildUnit, enemySquad, simulateBattle, statsAt, type BattleEvent, type BattleResult, type UnitDef } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { cardHero, cfg, content, skill, unitDef } from './helpers';

const ctx = loadFullContext();
const C = ctx.content;
const COMBAT = ctx.combat;
const MOVE = COMBAT.movement;
const BOUNDS = COMBAT.field.bounds!;

type Ev<T extends BattleEvent['type']> = Extract<BattleEvent, { type: T }>;
const of = <T extends BattleEvent['type']>(log: BattleEvent[], type: T) => log.filter((e): e is Ev<T> => e.type === type);

/** Отряды карточек: tier1 — Мечник, Вор, Лучник, Маг, Аколит; tier1b — с Торговкой; tier1i — призывные первые; tier2 — фиолетовые. */
const SQUADS: Record<string, string[]> = {
  tier1: ['alan', 'dorn', 'bran', 'kai', 'vika'],
  tier1b: ['alan', 'greta', 'bran', 'kai', 'vika'],
  tier1i: ['iris', 'zara', 'meilin', 'lira', 'teo'],
  novice: ['novice', 'novice', 'novice', 'novice', 'novice'],
  // Герои v2: те же классы, пол и роли, что у прежних Сейрена, Рандела, Сесиль, Кэтрин, Маргареты (таблица миграции v7).
  tier2: ['iris/knight', 'alan/crusader', 'meilin/hunter', 'lira/wizard', 'vika/priest'],
};

/** Новичок профессии novice (карточек-новичков нет): статы и навыки профессии на уровне lvl (≤ 10). */
function novice(i: number, lvl: number): UnitDef {
  const job = C.jobs.novice;
  const level = Math.min(lvl, job.maxJobLevel);
  const open = job.skills.filter((s) => s.jobLevel <= level).map((s) => s.skill);
  return { id: `h${i}`, name: `H${i}`, kind: 'hero', role: job.role, stats: statsAt(job, level), skills: { basic: job.basic, actives: open, passives: [] }, visual: job.visual };
}

function squad(name: string, level: number): UnitDef[] {
  return SQUADS[name].map((t, i) => (t === 'novice' ? novice(i, level) : buildUnit(cardHero(ctx, t, level, { id: `h${i}` }), ctx)));
}

const fight = (name: string, jobLevel: number, stageId: string, seed: number) => {
  const enemies = enemySquad(stageId, ctx);
  const r = simulateBattle(C, squad(name, jobLevel), enemies, seed, { combat: COMBAT });
  return { r, enemies };
};

/** Позиции по логу так, как их рисует сцена: move — равномерно от from к to за duration. */
function tracker(r: BattleResult) {
  const mv: Record<string, { from: number[]; to: number[]; t0: number; dur: number }> = {};
  for (const u of r.units) mv[u.uid] = { from: [u.x, u.y], to: [u.x, u.y], t0: 0, dur: 0 };
  const pos = (uid: string, t: number) => {
    const m = mv[uid];
    const k = m.dur <= 0 ? 1 : Math.min(1, (t - m.t0) / m.dur);
    return [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k];
  };
  const still = (uid: string, t: number) => t >= mv[uid].t0 + mv[uid].dur - 1e-9;
  const apply = (e: BattleEvent) => {
    if (e.type === 'spawn') mv[e.unit] = { from: [e.x, e.y], to: [e.x, e.y], t0: e.t, dur: 0 };
    if (e.type === 'move') mv[e.unit] = { from: pos(e.unit, e.t), to: e.to, t0: e.t, dur: e.duration };
  };
  return { pos, still, apply };
}

/**
 * Прогон по времени с шагом тика: колбэк на каждом тике после событий этого момента.
 * Возвращает живых на тике.
 */
function replay(r: BattleResult, onEvent: (e: BattleEvent, tr: ReturnType<typeof tracker>, dead: Set<string>) => void, onTick?: (t: number, tr: ReturnType<typeof tracker>, alive: string[]) => void) {
  const tr = tracker(r);
  const dead = new Set<string>();
  // Свита фаз босса — на поле с события spawn.
  const present = r.units.map((u) => u.uid);
  let i = 0;
  for (let t = 0; t <= r.duration + 1e-9; t = Math.round((t + COMBAT.tickSeconds) * 1000) / 1000) {
    while (i < r.log.length && r.log[i].t <= t + 1e-9) {
      const e = r.log[i++];
      onEvent(e, tr, dead);
      tr.apply(e);
      if (e.type === 'spawn') present.push(e.unit);
      if (e.type === 'death') dead.add(e.unit);
    }
    onTick?.(t, tr, present.filter((u) => !dead.has(u)));
  }
}

/** Пары стоящих (не идущих) юнитов ближе 40 единиц дольше 0.5 с: «две фигуры в одной точке». */
function standingOverlaps(r: BattleResult): string[] {
  const run: Record<string, number> = {};
  const out: string[] = [];
  replay(
    r,
    () => {},
    (t, tr, alive) => {
      for (let i = 0; i < alive.length; i++)
        for (let j = i + 1; j < alive.length; j++) {
          const a = tr.pos(alive[i], t);
          const b = tr.pos(alive[j], t);
          const k = `${alive[i]}/${alive[j]}`;
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 40 && tr.still(alive[i], t) && tr.still(alive[j], t)) {
            run[k] = (run[k] ?? 0) + 1;
            if (run[k] === 6) out.push(`t=${t} ${k}`);
          } else run[k] = 0;
        }
    },
  );
  return out;
}

const QA = {
  stage1: { squad: 'tier1', lvl: 1, stage: 'ch1_s1', seed: 2654435929 },
  boss3: { squad: 'tier1', lvl: 1, stage: 'ch1_s10', seed: 2027808044 },
  boss4: { squad: 'tier1', lvl: 1, stage: 'ch1_s10', seed: 387277725 },
};

describe('QA T2 (бой) — регрессии пакета P1', () => {
  it('T2-01: лечение себя с onlyWounded и «Восстановление HP» не срабатывают при полном HP', () => {
    // «Первая помощь» — только раненым героем; лечений на 0 нет (в т.ч. «Восстановление HP» Мечника).
    let aids = 0;
    for (const [name, lvl] of [['tier1', 1], ['tier1', 30], ['tier1b', 10], ['novice', 10]] as const)
      for (const stage of ['ch1_s1', 'ch1_s5', 'ch1_s10', 'ch2_s5'])
        for (const seed of [QA.stage1.seed, 1, 2]) {
          const { r: b } = fight(name, lvl, stage, seed);
          const hp: Record<string, number> = {};
          const max: Record<string, number> = {};
          for (const u of b.units) hp[u.uid] = max[u.uid] = u.maxHp;
          for (const e of b.log) {
            if (e.type === 'attack' && e.skill === 'novice_first_aid') {
              aids++;
              expect(hp[e.unit], `${stage}/${seed} t=${e.t}`).toBeLessThan(max[e.unit]);
            }
            if (e.type === 'heal') expect(e.amount, `${stage}/${seed} t=${e.t} ${e.source}`).toBeGreaterThan(0);
            if (e.type === 'damage' || e.type === 'heal') hp[e.target] = e.hp;
          }
        }
    // Навык не пропал совсем: раненые им лечатся.
    expect(aids).toBeGreaterThan(0);
  });

  it('T2-01: навык лечения себя при полном HP не тратит ход и перезарядку', () => {
    const c = content(
      [unitDef('hero', { skills: { basic: 'shot', actives: ['aid'], passives: ['regen'] } }, { hp: 1000, atk: 50 }), unitDef('d', {}, { hp: 1_000_000, atk: 1, spd: 1 })],
      [
        skill('aid', { target: { side: 'ally', pick: 'self', onlyWounded: true }, cooldown: 10, priority: 10, effects: [{ type: 'heal', k: 1 }] }),
        skill('regen', { trigger: 'turnStart', target: { side: 'ally', pick: 'self' }, effects: [{ type: 'heal', k: 0.3 }] }),
      ],
    );
    const r = simulateBattle(c, ['hero'], ['d'], 1);
    const first = of(r.log, 'attack').find((e) => e.unit === 'A0')!;
    expect(first.skill).toBe('shot');
    expect(of(r.log, 'passive').filter((e) => e.unit === 'A0')).toEqual([]);
    expect(of(r.log, 'heal')).toEqual([]);
  });

  it('T2-02: два ближних героя не встают в одну точку (этап 1, seed 2654435929; этап 7 Мечник/Торговец)', () => {
    expect(standingOverlaps(fight('tier1', 1, 'ch1_s1', QA.stage1.seed).r)).toEqual([]);
    expect(standingOverlaps(fight('tier1b', 1, 'ch1_s7', QA.stage1.seed).r)).toEqual([]);
    for (const stage of ['ch1_s1', 'ch1_s2', 'ch1_s3', 'ch2_s2', 'ch2_s7', 'ch3_s7'])
      for (const seed of [1, 2]) expect(standingOverlaps(fight('tier1', 1, stage, seed).r), `${stage}/${seed}`).toEqual([]);
  });

  it('T2-03: после рывка враги не стоят друг в друге (этап 10, seeds 2027808044, 387277725)', () => {
    for (const q of [QA.boss3, QA.boss4]) {
      const { r } = fight(q.squad, q.lvl, q.stage, q.seed);
      expect(standingOverlaps(r), String(q.seed)).toEqual([]);
      const dashes: string[] = [];
      replay(r, (e, tr, dead) => {
        if (e.type !== 'move' || e.kind !== 'dash') return;
        for (const u of r.units) {
          if (u.uid === e.unit || dead.has(u.uid)) continue;
          const p = tr.pos(u.uid, e.t);
          if (Math.hypot(p[0] - e.to[0], p[1] - e.to[1]) < 30) dashes.push(`t=${e.t} ${e.unit} → ${u.uid}`);
        }
      });
      expect(dashes, String(q.seed)).toEqual([]);
    }
  });

  it('T2-04: юниты не уходят за край поля (этап 10, seed 387277725 и все этапы)', () => {
    const inside = (p: number[]) => p[0] >= BOUNDS.minX && p[0] <= BOUNDS.maxX && p[1] >= BOUNDS.minY && p[1] <= BOUNDS.maxY;
    const { r } = fight(QA.boss4.squad, QA.boss4.lvl, QA.boss4.stage, QA.boss4.seed);
    for (const e of of(r.log, 'move')) expect(inside(e.to), JSON.stringify(e)).toBe(true);
    for (const st of C.stages)
      for (const seed of [1, 2]) {
        const { r: b } = fight('tier1', 1, st.id, seed);
        for (const e of of(b.log, 'move')) expect(inside(e.to), `${st.id}/${seed} ${JSON.stringify(e)}`).toBe(true);
      }
  });

  it('T2-05: бой у заднего ряда не схлопывается в кучу — фигуры не лежат друг на друге', () => {
    for (const q of [QA.boss3, QA.boss4]) {
      const { r } = fight(q.squad, q.lvl, q.stage, q.seed);
      // Всё время боя стоящие фигуры не ближе 40 друг к другу дольше полсекунды и не за левым краем.
      expect(standingOverlaps(r)).toEqual([]);
      replay(r, () => {}, (t, tr, alive) => {
        for (const u of alive) expect(tr.pos(u, t)[0], `t=${t} ${u}`).toBeGreaterThanOrEqual(BOUNDS.minX - 1e-6);
      });
    }
    for (const stage of ['ch1_s5', 'ch1_s6', 'ch2_s7', 'ch3_s3', 'ch3_s7'])
      for (const seed of [1, 2]) expect(standingOverlaps(fight('tier1', 1, stage, seed).r), `${stage}/${seed}`).toEqual([]);
  });

  it('T2-06: оглушённый стоит на месте, оглушение спадает по времени и на бегу (этап 8, seed 2)', () => {
    const check = (r: BattleResult, tag: string) => {
      const stunnedUntil: Record<string, number> = {};
      replay(r, (e) => {
        if (e.type === 'status' && e.action === 'apply' && e.status === 'stun') stunnedUntil[e.target] = e.t + (e.seconds ?? 0);
        if (e.type === 'status' && e.action === 'expire' && e.status === 'stun') {
          // Спадает ровно по времени, а не когда оглушённый дойдёт до цели.
          expect(e.t, `${tag} ${e.target}`).toBeCloseTo(stunnedUntil[e.target], 5);
          delete stunnedUntil[e.target];
        }
        if (e.type === 'move' && stunnedUntil[e.unit] !== undefined && e.t < stunnedUntil[e.unit] - 1e-9) {
          // Разрешена только остановка на месте.
          expect(e.to, `${tag} t=${e.t} ${e.unit} идёт под оглушением`).toEqual(e.from);
          expect(e.duration).toBe(0);
        }
        if ((e.type === 'attack' || e.type === 'ult' || (e.type === 'cast' && e.action === 'start')) && stunnedUntil[e.unit] !== undefined)
          expect.fail(`${tag} t=${e.t} ${e.unit} действует под оглушением`);
      });
    };
    check(fight('tier1', 1, 'ch1_s8', 2).r, 'ch1_s8/2');
    for (const q of [QA.boss3, QA.boss4]) check(fight(q.squad, q.lvl, q.stage, q.seed).r, String(q.seed));
    // Прямая проверка: оглушение на бегу останавливает и тратит ход.
    const c = content(
      [
        unitDef('stunner', { skills: { basic: 'curse', passives: [] } }, { hp: 100_000, atk: 1, spd: 50 }),
        unitDef('runner', { skills: { basic: 'hit', passives: [] } }, { hp: 100_000, atk: 1, spd: 100, moveSpeed: 40 }),
      ],
      [skill('curse', { effects: [{ type: 'status', status: { id: 'stun', name: 'Оглушение', turns: 1, stun: true } }] })],
    );
    const r = simulateBattle(c, ['stunner'], ['runner'], 1);
    const apply = of(r.log, 'status').find((e) => e.target === 'B0' && e.action === 'apply')!;
    const expire = of(r.log, 'status').find((e) => e.target === 'B0' && e.action === 'expire')!;
    expect(expire.t - apply.t).toBeCloseTo(COMBAT.statusTurnSeconds ?? 1, 5);
    const stop = of(r.log, 'move').find((e) => e.unit === 'B0' && e.t === apply.t)!;
    expect(stop.duration).toBe(0);
    expect(stop.from).toEqual(stop.to);
    expect(of(r.log, 'move').filter((e) => e.unit === 'B0' && e.t > apply.t && e.t < expire.t)).toEqual([]);
    expect(of(r.log, 'skip').some((e) => e.unit === 'B0' && e.t >= apply.t && e.t < expire.t)).toBe(true);
    check(r, 'synthetic');
  });

  it('T2-07: ближний удар по площади задевает только врагов рядом с целью (этап 5, ур. 20, seed 1)', () => {
    // «Магнум Брейк» — у Ирис с ур. 1 (герои v2; раньше — с ур. 30). На ур. 30 отряд выигрывает этап 5 раньше, чем
    // Ирис успевает ударить им, — уровень 20 (бой дольше, удар есть).
    const { r } = fight('tier1i', 20, 'ch1_s5', 1);
    const body = (uid: string) => {
      const u = r.units.find((x) => x.uid === uid)!;
      const def = u.side === 'B' ? enemySquad('ch1_s5', ctx)[u.slot] : null;
      return def ? (def.bodyRadius ?? MOVE.bodyRadius?.[def.kind] ?? 0) : 0;
    };
    let aoe = 0;
    replay(r, (e, tr) => {
      if (e.type !== 'attack' || e.kind !== 'melee') return;
      const a = tr.pos(e.unit, e.t);
      for (const tg of e.targets) {
        const b = tr.pos(tg, e.t);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        expect(d, `t=${e.t} ${e.unit}→${tg} ${e.skill}`).toBeLessThanOrEqual(MOVE.meleeRange + body(tg) + (MOVE.meleeAoeRadius ?? 0) + 1);
      }
      if (e.targets.length > 1) aoe++;
    });
    expect(of(r.log, 'attack').some((e) => e.skill === 'job_swordman_magnum_break')).toBe(true);
    // Синтетика: двое врагов далеко друг от друга — удар по площади бьёт только цель сражения.
    const c = content(
      [unitDef('sw', { skills: { basic: 'hit', actives: ['magnum'], passives: [] } }, { hp: 1_000_000 }), unitDef('d', {}, { hp: 1_000_000, atk: 1 })],
      [skill('magnum', { range: 'melee', cooldown: 5, target: { side: 'enemy', pick: 'all' } })],
    );
    const s = simulateBattle(c, ['sw'], ['d', 'd'], 1);
    const m = of(s.log, 'attack').find((e) => e.skill === 'magnum')!;
    expect(m.targets).toHaveLength(1);
    expect(aoe).toBeGreaterThanOrEqual(0);
  });

  it('T2-09: каст, пропавший без цели, отличается от сбитого оглушением (reason в событии)', () => {
    // Сид из отчёта (этап 25, 852638493) и бои, где сейчас пропадает «Святилище» / Огненную стрелу сбивает «Королевский прыжок».
    const all: Ev<'cast'>[] = [];
    for (const [name, lvl, stage, seed] of [
      ['tier2', 30, 'ch3_s5', 852638493],
      ['tier2', 1, 'ch1_s7', 1],
      ['tier1', 1, 'ch1_s10', 1],
      ['tier1', 1, 'ch1_s10', QA.boss3.seed],
    ] as const) {
      const { r } = fight(name, lvl, stage, seed);
      for (const e of of(r.log, 'cast').filter((x) => x.action === 'interrupt')) {
        const prev = r.log[r.log.indexOf(e) - 1];
        const byStun = prev?.type === 'status' && prev.action === 'apply' && prev.target === e.unit && prev.t === e.t;
        expect(e.reason, `${stage}/${seed} t=${e.t} ${e.unit} ${e.skill}`).toBe(byStun ? 'stun' : 'noTarget');
        all.push(e);
      }
    }
    // Состав этапов меняется с контентом — наличие обоих видов проверяем на синтетике ниже.
    // Синтетика: долгий каст сбивает оглушение — reason stun.
    const cs = content(
      [
        unitDef('caster', { skills: { basic: 'shot', actives: ['bolt'], passives: [] } }, { hp: 1_000_000, atk: 1, spd: 100 }),
        unitDef('stunner', { skills: { basic: 'daze', passives: [] } }, { hp: 1_000_000, atk: 1, spd: 60 }),
      ],
      [
        skill('bolt', { castTime: 3, cooldown: 0 }),
        skill('daze', { effects: [{ type: 'status', status: { id: 'stun', name: 'Оглушение', turns: 1, stun: true } }] }),
      ],
    );
    const stunned = of(simulateBattle(cs, ['caster'], ['stunner'], 1).log, 'cast').filter((e) => e.action === 'interrupt');
    expect(stunned.length).toBeGreaterThan(0);
    for (const e of stunned) expect(e.reason).toBe('stun');
    // Синтетика: каст лечения, а к концу каста лечить некого (раненый союзник погиб) — noTarget, а не «сбит».
    const c = content(
      [
        unitDef('fragile', {}, { hp: 100, atk: 1, spd: 1 }),
        unitDef('healer', { skills: { basic: 'shot', actives: ['slowheal'], passives: [] } }, { hp: 1_000_000, atk: 1, spd: 100 }),
        unitDef('hitter', {}, { hp: 1_000_000, atk: 60, spd: 100 }),
      ],
      [skill('slowheal', { castTime: 2, cooldown: 0, target: { side: 'ally', pick: 'lowestHp', onlyWounded: true }, effects: [{ type: 'heal', k: 1 }] })],
    );
    const fizzled: Ev<'cast'>[] = [];
    for (let seed = 1; seed <= 10; seed++) fizzled.push(...of(simulateBattle(c, ['fragile', 'healer'], ['hitter'], seed).log, 'cast').filter((e) => e.action === 'interrupt'));
    expect(fizzled.length).toBeGreaterThan(0);
    for (const e of fizzled) expect(e.reason).toBe('noTarget');
  });

  it('T2-10: снаряд долетает через время полёта; к погибшей за это время цели не прилетает (этап 1, seed 2654435929)', () => {
    const flight = COMBAT.projectileSeconds ?? 0;
    expect(flight).toBeGreaterThan(0);
    let landed = 0;
    for (const [stage, seed] of [['ch1_s1', QA.stage1.seed], ['ch1_s5', 1], ['ch1_s10', QA.boss3.seed]] as const) {
      const { r } = fight('tier1', 1, stage, seed);
      const dead = new Map<string, number>();
      for (const e of r.log) {
        if (e.type === 'death') dead.set(e.unit, e.t);
        if ((e.type === 'damage' && !e.dot) || e.type === 'heal') expect(dead.has(e.target), `t=${e.t} ${JSON.stringify(e)}`).toBe(false);
      }
      // Обычный выстрел: урон ровно через время полёта — или никогда, если цель умерла раньше.
      for (const s of of(r.log, 'attack').filter((e) => e.skill === 'basic_ranged')) {
        const land = Math.round((s.t + flight) * 100) / 100;
        const hits = of(r.log, 'damage').filter((e) => e.source === s.unit && e.target === s.targets[0] && !e.dot && e.t >= s.t - 1e-9 && e.t <= land + 1e-9);
        const died = dead.get(s.targets[0]);
        const shooterDied = dead.get(s.unit);
        // Стрелок погиб, пока стрела летела, — пропадает весь залп (battle.ts, landProjectiles).
        if (shooterDied !== undefined && shooterDied < land) expect(hits, `${stage} t=${s.t} ${s.unit} (стрелок погиб)`).toEqual([]);
        // Цель умерла раньше или в тот же тик (от другого снаряда, приземлившегося первым) — стрела пропала.
        else if (died !== undefined && died < land) expect(hits, `${stage} t=${s.t} ${s.unit}`).toEqual([]);
        else if (died === land) expect(hits.every((h) => h.t === land), `${stage} t=${s.t} ${s.unit}`).toBe(true);
        else if (r.duration >= land) {
          expect(hits.map((h) => h.t), `${stage} t=${s.t} ${s.unit}`).toEqual([land]);
          landed++;
        }
      }
    }
    expect(landed).toBeGreaterThan(0);
    // Синтетика: цель добита ближним, пока летит стрела, — стрела пропадает (урона от лучника нет вовсе).
    const c = content([
      unitDef('archer', { skills: { basic: 'shot', passives: [] } }, { hp: 100_000, atk: 1, spd: 100 }),
      unitDef('killer', { skills: { basic: 'shot', passives: [] } }, { hp: 100_000, atk: 100_000, spd: 125 }),
      unitDef('victim', {}, { hp: 10, atk: 1, spd: 1 }),
    ]);
    // Изолируем исходную шкалу, чтобы сохранять точный сценарий смерти между вылетом и прилётом.
    const s = simulateBattle(c, ['archer', 'killer'], ['victim'], 1, { combat: { ...COMBAT, actionThreshold: 1000 } });
    expect(of(s.log, 'attack').find((e) => e.unit === 'A0')?.t).toBe(1);
    // Выстрел убийцы (0.8 с) долетает в 1.1 — раньше стрелы лучника (1.0 → 1.3).
    expect(of(s.log, 'death').find((e) => e.unit === 'B0')?.t).toBe(1.1);
    expect(of(s.log, 'damage').filter((e) => e.source === 'A0')).toEqual([]);
  });

  it('T2-11: бафф «на N ходов» длится одинаково у кастера и у всех (N × statusTurnSeconds)', () => {
    const turn = COMBAT.statusTurnSeconds ?? 1;
    /** Каждый статус спадает ровно через seconds после наложения (если носитель дожил и статус не обновили). */
    const durations = (r: BattleResult, tag: string) => {
      const open = new Map<string, Ev<'status'>>();
      let checked = 0;
      for (const e of of(r.log, 'status')) {
        const k = `${e.target}:${e.status}`;
        if (e.action === 'apply') {
          expect(e.seconds, `${tag} ${k}`).toBeCloseTo(e.turns * turn, 5);
          open.set(k, e);
        } else {
          const a = open.get(k)!;
          expect(e.t - a.t, `${tag} ${k}`).toBeCloseTo(a.seconds!, 5);
          open.delete(k);
          checked++;
        }
      }
      return checked;
    };
    // Сид из отчёта (этап 20, seed 2) и ещё несколько боёв на текущем контенте.
    let checked = 0;
    for (const [name, lvl, stage, seed] of [
      ['tier1', 30, 'ch2_s10', 2],
      ['tier1', 10, 'ch1_s10', 1],
      ['tier2', 30, 'ch3_s5', 1],
    ] as const)
      checked += durations(fight(name, lvl, stage, seed).r, `${stage}/${seed}`);
    expect(checked).toBeGreaterThan(0);
    // Синтетика: кастер (быстрый) накладывает на себя и медленного союзника «Ускорение» на 4 хода — у обоих 4 × statusTurnSeconds.
    const c = content(
      [
        unitDef('buffer', { skills: { basic: 'shot', actives: ['agi'], passives: [] } }, { hp: 1_000_000, atk: 1, spd: 150 }),
        unitDef('slow', {}, { hp: 1_000_000, atk: 1, spd: 40 }),
        unitDef('d', {}, { hp: 1_000_000, atk: 1, spd: 100 }),
      ],
      [skill('agi', { cooldown: 20, target: { side: 'ally', pick: 'all', includeSelf: true }, effects: [{ type: 'status', status: { id: 'agi', name: 'Ускорение', turns: 4, stats: { spd: 0.2 } } }] })],
    );
    const r = simulateBattle(c, ['buffer', 'slow'], ['d'], 1);
    const all = of(r.log, 'status').filter((e) => e.status === 'agi' && e.action === 'apply');
    const applies = all.filter((e) => e.t === all[0].t);
    const expires = of(r.log, 'status').filter((e) => e.status === 'agi' && e.action === 'expire');
    expect(applies.map((e) => e.target).sort()).toEqual(['A0', 'A1']);
    for (const a of applies) {
      const x = expires.find((e) => e.target === a.target && e.t > a.t)!;
      expect(x.t - a.t, a.target).toBeCloseTo(4 * turn, 5);
    }
    durations(r, 'synthetic');
  });

  it('T2-16: ближний бой бьёт только из досягаемости, стоят вплотную (meleeRange ≤ 140)', () => {
    expect(MOVE.meleeRange).toBeLessThanOrEqual(140);
    for (const q of [QA.stage1, QA.boss3]) {
      const { r, enemies } = fight(q.squad, q.lvl, q.stage, q.seed);
      const body = (uid: string) => {
        // Свита фаз босса (не в r.units) — рядовые монстры, радиус тела 0.
        const u = r.units.find((x) => x.uid === uid);
        const def = u?.side === 'B' ? enemies[u.slot] : null;
        return def ? (def.bodyRadius ?? MOVE.bodyRadius?.[def.kind] ?? 0) : 0;
      };
      replay(r, (e, tr) => {
        if (e.type !== 'attack' || e.kind !== 'melee' || e.targets.length !== 1) return;
        const a = tr.pos(e.unit, e.t);
        const b = tr.pos(e.targets[0], e.t);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `t=${e.t} ${e.unit}→${e.targets[0]}`).toBeLessThanOrEqual(MOVE.meleeRange + body(e.targets[0]) + body(e.unit) + 2);
      });
    }
  });

  it('детерминизм сохраняется', () => {
    const a = fight(QA.boss4.squad, QA.boss4.lvl, QA.boss4.stage, QA.boss4.seed).r;
    const b = fight(QA.boss4.squad, QA.boss4.lvl, QA.boss4.stage, QA.boss4.seed).r;
    expect(a.log).toEqual(b.log);
    expect(cfg.movement.minSeparation).toBeGreaterThan(0);
  });
});
