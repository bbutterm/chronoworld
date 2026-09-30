/**
 * Профили поведения, шаги 4–5 (docs/design/battle-behavior.md): маг бьёт по кругу скопления, контрмаг сбивает касты,
 * аура барда/танцовщицы, трусы, стаи, таран; живучесть врагов (combat.json sustain); «один seed — один лог».
 * Шаги 1–3 — tests/behavior.test.ts, tests/behavior-steps.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildUnit, enemySquad, simulateBattle, type BattleEvent, type BattleResult, type CombatConfig, type Squad, type UnitDef } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { compSquad } from './behavior-scenarios';
import { SMOOTH_SQUADS, smoothSquads } from '../scripts/lib/player-model';

const ctx = loadFullContext();
const SQ = smoothSquads(ctx, 45, SMOOTH_SQUADS);

/** Отряд героев: templateId/ветка, фиолетовые level. */
const heroes = (ids: string[], level = 60) =>
  ids.map((id, i) => {
    const [templateId, branch] = id.split('/');
    return buildUnit({ id: `h${i}`, templateId, rarity: 'purple', level, ...(branch ? { branch } : {}) }, ctx);
  });

type Move = Extract<BattleEvent, { type: 'move' }>;

/**
 * Позиции по логу до события idx: stand — где юнит будет стоять (конец последнего шага, как standX в бою), at(t) — где он
 * сейчас (шаг равномерный: from → to за duration, как в симуляторе и сцене).
 */
function positions(r: BattleResult, idx: number) {
  const mv = new Map<string, { from: [number, number]; to: [number, number]; t0: number; dur: number }>();
  for (const u of r.units) mv.set(u.uid, { from: [u.x, u.y], to: [u.x, u.y], t0: 0, dur: 0 });
  const dead = new Set<string>();
  for (let i = 0; i < idx; i++) {
    const e = r.log[i];
    if (e.type === 'spawn') mv.set(e.unit, { from: [e.x, e.y], to: [e.x, e.y], t0: e.t, dur: 0 });
    // Рывок в ядре — сразу в точку (duration у него — для сцены).
    if (e.type === 'move') mv.set(e.unit, { from: e.from, to: e.to, t0: e.t, dur: e.kind === 'dash' ? 0 : e.duration });
    if (e.type === 'death') dead.add(e.unit);
  }
  return {
    alive: (uid: string) => mv.has(uid) && !dead.has(uid),
    stand: (uid: string) => mv.get(uid)!.to,
    at: (uid: string, t: number) => {
      const m = mv.get(uid)!;
      const k = m.dur <= 0 ? 1 : Math.min(1, Math.max(0, (t - m.t0) / m.dur));
      return [m.from[0] + (m.to[0] - m.from[0]) * k, m.from[1] + (m.to[1] - m.from[1]) * k] as [number, number];
    },
    uids: () => [...mv.keys()],
  };
}

/** Радиус тела юнита боя (как makeUnit). */
const bodyOf = (squad: Squad, uid: string, cfg: CombatConfig = ctx.combat) => {
  const d = squad[Number(uid.slice(1))] as UnitDef | undefined;
  return d ? (d.bodyRadius ?? cfg.movement.bodyRadius?.[d.kind] ?? 0) : 0;
};
const hyp = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('шаг 4: маг, контрмаг, аура', () => {
  it('маг: круг — на самом плотном скоплении врагов, задеты ровно те, кто в круге в момент удара', () => {
    const squad = heroes(['alan/knight', 'vika/priest', 'kai/wizard', 'kai', 'lira/wizard']);
    let casts = 0;
    for (const name of ['ch4_s10', 'ch6_s10', 'ch9_s18'])
      for (let seed = 1; seed <= 3; seed++) {
        const foes = compSquad(ctx, name);
        const r = simulateBattle(ctx.content, squad, foes, seed, { combat: ctx.combat });
        r.log.forEach((e, i) => {
          if (e.type !== 'cast' || e.action !== 'start' || !e.at) return;
          casts++;
          const skill = ctx.content.skills[e.skill];
          expect(e.radius).toBe(skill.area!.radius);
          const p = positions(r, i);
          const foesAlive = p.uids().filter((u) => u.startsWith('B') && p.alive(u));
          const around = (c: [number, number]) => foesAlive.filter((u) => hyp(p.stand(u), c) <= e.radius! + bodyOf(foes, u) + 0.5).length;
          const densest = Math.max(...foesAlive.map((u) => around(p.stand(u))));
          expect(around(e.at), `${name}#${seed} t=${e.t}`).toBeGreaterThanOrEqual(densest);
          // Удар — следующее attack этого навыка у кастера (или каст пропал / сорван — следующее событие каста).
          const j = r.log.findIndex((x, k) => k > i && ((x.type === 'attack' && x.unit === e.unit && x.skill === e.skill) || (x.type === 'cast' && x.unit === e.unit)));
          if (j < 0 || r.log[j].type !== 'attack') return;
          const hit = r.log[j] as Extract<BattleEvent, { type: 'attack' }>;
          const q = positions(r, j);
          const inside = q.uids().filter((u) => u.startsWith('B') && q.alive(u) && hyp(q.at(u, hit.t), e.at!) <= e.radius! + bodyOf(foes, u) + 1);
          for (const u of hit.targets) expect(inside, `${name}#${seed} t=${hit.t} ${u} вне круга`).toContain(u);
          if (skill.target.pick !== 'random') expect([...hit.targets].sort()).toEqual([...inside].sort());
        });
      }
    expect(casts, 'маги вообще бьют по кругу').toBeGreaterThan(10);
  });

  it('контрмаг: Развеивание сбивает каст босса («Сбито!»), бьёт именно кастующего', () => {
    const squad = heroes(['alan/knight', 'vika/priest', 'bran', 'kai', 'lira/sage']);
    let dispels = 0;
    for (const name of ['ch1_s10', 'ch4_s10', 'ch9_s18'])
      for (let seed = 1; seed <= 4; seed++) {
        const r = simulateBattle(ctx.content, squad, compSquad(ctx, name), seed, { combat: ctx.combat });
        r.log.forEach((e, i) => {
          if (e.type !== 'cast' || e.reason !== 'dispel') return;
          dispels++;
          // Сбил тот, кто только что Развеял именно его.
          const hit = r.log.slice(0, i).reverse().find((x) => x.type === 'attack' && x.skill === 'job_sage_dispell');
          expect(hit && hit.type === 'attack' && hit.t === e.t && hit.targets.includes(e.unit), `${name}#${seed} t=${e.t}`).toBe(true);
          // Сбитый навык ушёл в перезарядку: тот же каст не начинается сразу снова.
          const again = r.log.find((x, k) => k > i && x.type === 'cast' && x.action === 'start' && x.unit === e.unit && x.skill === e.skill);
          const cd = ctx.content.skills[e.skill].cooldown ?? ctx.combat.skills!.defaultCooldown;
          if (again) expect(again.t - e.t).toBeGreaterThanOrEqual(cd - 1e-9);
        });
      }
    expect(dispels, 'касты боссов сбиваются').toBeGreaterThan(3);
  });

  it('аура барда и танцовщицы: круг с начала боя, бафф — только союзникам в круге, продление без повторного «наложения»', () => {
    const squad = heroes(['alan/knight', 'vika/priest', 'bran/bard', 'kai', 'meilin/dancer']);
    let inCircle = 0;
    let refresh = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const r = simulateBattle(ctx.content, squad, compSquad(ctx, 'ch5_s10'), seed, { combat: ctx.combat });
      const auras = r.log.filter((e): e is Extract<BattleEvent, { type: 'aura' }> => e.type === 'aura');
      expect(auras.map((a) => `${a.unit}:${a.skill}:${a.radius}`)).toEqual(['A2:job_bard_poem_of_bragi:300', 'A4:job_dancer_fortune_kiss:300']);
      r.log.forEach((e, i) => {
        if (e.type !== 'status' || e.action === 'expire' || !['poem_of_bragi', 'fortune_kiss'].includes(e.status)) return;
        const p = positions(r, i);
        expect(hyp(p.at(e.source, e.t), p.at(e.target, e.t)), `${seed} t=${e.t} ${e.source}→${e.target}`).toBeLessThanOrEqual(300 + 1);
        inCircle++;
        if (e.action === 'refresh') refresh++;
      });
    }
    expect(inCircle).toBeGreaterThan(50);
    expect(refresh).toBeGreaterThan(20);
  });
});

describe('шаг 5: трусы, стаи, таран', () => {
  it('трус бежит один раз за бой, не последним, и пока бежит — не бьёт', () => {
    let flees = 0;
    for (const stage of ['ch2_s7', 'ch2_s17', 'ch2_s18', 'ch1_s5'])
      for (const sq of SQ.slice(0, 3))
        for (let seed = 1; seed <= 3; seed++) {
          const foes = enemySquad(stage, ctx);
          const r = simulateBattle(ctx.content, [...sq], foes, seed, { combat: ctx.combat });
          const byUnit = new Map<string, Move[]>();
          for (const e of r.log) if (e.type === 'move' && e.reason === 'flee') byUnit.set(e.unit, [...(byUnit.get(e.unit) ?? []), e]);
          for (const [uid, list] of byUnit) {
            flees += list.length;
            expect(list.length, `${stage}#${seed} ${uid}`).toBe(1);
            const f = list[0];
            const coward = (foes[Number(uid.slice(1))] as UnitDef).behavior;
            expect(coward).toBe('coward');
            const fi = r.log.indexOf(f);
            const deadBefore = new Set(r.log.slice(0, fi).filter((e) => e.type === 'death').map((e) => (e as { unit: string }).unit));
            const mates = r.units.filter((u) => u.side === 'B' && !deadBefore.has(u.uid));
            expect(mates.length, 'последний живой не бежит').toBeGreaterThan(1);
            const secs = ctx.combat.behaviors!.coward.coward!.seconds;
            // Пока бежит (и пока у своих есть кто-то ещё) — не бьёт.
            const lastMateDeath = r.log.find((e) => e.type === 'death' && e.t > f.t && e.t < f.t + secs && mates.filter((m) => m.uid !== uid).every((m) => r.log.some((d) => d.type === 'death' && d.unit === m.uid && d.t <= e.t)));
            const until = Math.min(f.t + secs, lastMateDeath?.t ?? Infinity);
            const hits = r.log.filter((e) => e.type === 'attack' && e.unit === uid && e.t > f.t && e.t < until - 1e-9);
            expect(hits, `${stage}#${seed} ${uid} бьёт на бегу`).toEqual([]);
          }
        }
    expect(flees, 'трусы вообще бегут').toBeGreaterThan(5);
  });

  it('бегущий получает больше урона в спину (+20%): тот же бой без прибавки — первый удар на бегу меньше в 1,2 раза', () => {
    const base = ctx.combat.behaviors!.coward;
    const flat = { ...ctx.combat, behaviors: { ...ctx.combat.behaviors!, coward: { ...base, coward: { ...base.coward!, damageTaken: 0 } } } } as CombatConfig;
    let checked = 0;
    for (const stage of ['ch2_s7', 'ch2_s17', 'ch2_s18'])
      for (let seed = 1; seed <= 4; seed++) {
        const foes = enemySquad(stage, ctx);
        const r = simulateBattle(ctx.content, [...SQ[0]], foes, seed, { combat: ctx.combat });
        const r0 = simulateBattle(ctx.content, [...SQ[0]], foes, seed, { combat: flat });
        const f = r.log.find((e): e is Move => e.type === 'move' && e.reason === 'flee');
        if (!f) continue;
        const fi = r.log.indexOf(f);
        const i = r.log.findIndex((e, k) => k > fi && e.type === 'damage' && e.target === f.unit && !e.redirect);
        if (i < 0) continue;
        // До этого удара бои одинаковые (прибавка ещё ни на что не влияла).
        expect(JSON.stringify(r0.log.slice(0, i))).toBe(JSON.stringify(r.log.slice(0, i)));
        const hit = r.log[i] as Extract<BattleEvent, { type: 'damage' }>;
        const plain = r0.log[i] as Extract<BattleEvent, { type: 'damage' }>;
        expect(hit.amount).toBe(Math.round(plain.amount * (1 + base.coward!.damageTaken)));
        checked++;
      }
    expect(checked).toBeGreaterThan(2);
  });

  it('стая: сородичи чаще бьют одного героя, чем без правила стаи', () => {
    const cfgNo = { ...ctx.combat, behaviors: { ...ctx.combat.behaviors!, pack: { name: 'Стая (выкл.)' } } } as CombatConfig;
    const share = (cfg: CombatConfig) => {
      let same = 0;
      let all = 0;
      // Поринги главы 1, крысы Тару главы 2, орки-зомби главы 3.
      for (const [name, sq] of [['ch1_s10', SQ[0]], ['ch1_s10', SQ[1]], ['ch2_s3', SQ[2]], ['ch2_s13', SQ[0]], ['ch3_s16', SQ[1]], ['ch3_s18', SQ[3]]] as const)
        for (let seed = 1; seed <= 4; seed++) {
          const foes = name === 'ch1_s10' ? compSquad(ctx, name) : enemySquad(name, ctx);
          const r = simulateBattle(ctx.content, [...sq], foes, seed, { combat: cfg });
          const pack = new Set(r.units.filter((u) => u.side === 'B' && (foes[u.slot] as UnitDef).behavior === 'pack').map((u) => u.uid));
          const recent: { t: number; unit: string; target: string }[] = [];
          for (const e of r.log) {
            if (e.type !== 'attack' || !pack.has(e.unit) || e.kind !== 'melee') continue;
            all++;
            if (recent.some((x) => x.unit !== e.unit && x.target === e.targets[0] && e.t - x.t <= 1.5)) same++;
            recent.push({ t: e.t, unit: e.unit, target: e.targets[0] });
          }
        }
      return same / all;
    };
    expect(share(ctx.combat)).toBeGreaterThan(share(cfgNo));
  });

  it('таран (Рыцарь-Ирис): Атака с разбега — во врага фронта, у которого больше всего соседей', () => {
    const squad = heroes(['iris/knight', 'alan/knight', 'bran', 'kai', 'vika/priest']);
    let charges = 0;
    for (const name of ['ch3_s15', 'ch6_s10', 'ch8_s15'])
      for (let seed = 1; seed <= 3; seed++) {
        const foes = compSquad(ctx, name);
        const r = simulateBattle(ctx.content, squad, foes, seed, { combat: ctx.combat });
        r.log.forEach((e, i) => {
          if (e.type !== 'attack' || e.unit !== 'A0' || e.skill !== 'job_knight_charge_attack') return;
          charges++;
          // Рывок (move dash) уже в логе после attack — позиции берём до него.
          const p = positions(r, i);
          const alive = p.uids().filter((u) => u.startsWith('B') && p.alive(u));
          const front = alive.filter((u) => Number(u.slice(1)) < 2);
          const pool = front.length > 0 ? front : alive;
          const n = (u: string) => alive.filter((o) => hyp(p.stand(o), p.stand(u)) <= 200 + bodyOf(foes, o) + 0.5).length;
          expect(n(e.targets[0]), `${name}#${seed} t=${e.t}`).toBe(Math.max(...pool.map(n)));
        });
      }
    expect(charges).toBeGreaterThan(5);
  });
});

describe('живучесть врагов (combat.json sustain)', () => {
  it('лечение и щиты врагов меньше, чем без правила (повторное лечение одной цели слабеет, щиты не складываются)', () => {
    const noSustain = { ...ctx.combat, sustain: undefined } as CombatConfig;
    const sum = (cfg: CombatConfig) => {
      let v = 0;
      for (const name of ['ch5_s10', 'ch6_s10', 'ch9_s10'])
        for (let seed = 1; seed <= 3; seed++) {
          const r = simulateBattle(ctx.content, [...SQ[0]], compSquad(ctx, name), seed, { combat: cfg, log: false });
          for (const u of Object.values(r.report)) if (u.uid.startsWith('B')) v += (u.healingDone + u.shieldGiven) / r.duration;
        }
      return v;
    };
    expect(sum(ctx.combat)).toBeLessThan(sum(noSustain) * 0.85);
  });

  it('повторное лечение одной цели врагом в пределах окна — слабее: тот же бой без правила лечит её сильнее', () => {
    const s = ctx.combat.sustain!;
    const noSustain = { ...ctx.combat, sustain: undefined } as CombatConfig;
    let checked = 0;
    for (const name of ['ch6_s10', 'ch9_s10'])
      for (let seed = 1; seed <= 4; seed++) {
        const r = simulateBattle(ctx.content, [...SQ[0]], compSquad(ctx, name), seed, { combat: ctx.combat });
        const r0 = simulateBattle(ctx.content, [...SQ[0]], compSquad(ctx, name), seed, { combat: noSustain });
        const last = new Map<string, number>();
        const i = r.log.findIndex((e) => {
          if (e.type === 'buff' && e.source.startsWith('B')) return true;
          if (e.type !== 'heal' || !e.source.startsWith('B')) return false;
          const prev = last.get(e.target);
          last.set(e.target, e.t);
          return prev !== undefined && e.t - prev <= s.window;
        });
        if (i < 0 || r.log[i].type !== 'heal' || JSON.stringify(r.log.slice(0, i)) !== JSON.stringify(r0.log.slice(0, i))) continue;
        const a = r.log[i] as Extract<BattleEvent, { type: 'heal' }>;
        const b = r0.log[i] as Extract<BattleEvent, { type: 'heal' }>;
        expect(b.type).toBe('heal');
        expect(a.amount).toBeLessThanOrEqual(Math.ceil(b.amount * s.repeat) + 1);
        checked++;
      }
    expect(checked).toBeGreaterThan(1);
  });
});

describe('детерминизм шагов 4–5', () => {
  const cases: [string, Squad, Squad][] = [
    ['маги', heroes(['alan/knight', 'vika/priest', 'kai/wizard', 'kai', 'lira/wizard']), compSquad(ctx, 'ch6_s10')],
    ['контрмаг', heroes(['alan/knight', 'vika/priest', 'bran', 'kai', 'lira/sage']), compSquad(ctx, 'ch4_s10')],
    ['ауры', heroes(['alan/knight', 'vika/priest', 'bran/bard', 'kai', 'meilin/dancer']), compSquad(ctx, 'ch5_s10')],
    ['таран и торговцы', heroes(['iris/knight', 'otto/blacksmith', 'greta/blacksmith', 'greta', 'kai/wizard']), compSquad(ctx, 'ch9_s18')],
    ['трусы', [...SQ[0]], enemySquad('ch2_s17', ctx)],
    ['стая', [...SQ[1]], compSquad(ctx, 'ch1_s10')],
  ];
  for (const [name, a, b] of cases)
    it(`один seed — один лог: ${name}`, () => {
      for (const seed of [3, 11]) {
        const x = simulateBattle(ctx.content, a, b, seed, { combat: ctx.combat });
        const y = simulateBattle(ctx.content, a, b, seed, { combat: ctx.combat });
        expect(y.log).toEqual(x.log);
      }
    });
});
