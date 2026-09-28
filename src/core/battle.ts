import { COMBAT } from './config';
import { calcDamage, calcHeal } from './formulas';
import { Rng } from './rng';
import { dist, inRow, selectTargets } from './targeting';
import type {
  ActiveStatus,
  BattleEvent,
  BattleResult,
  CombatConfig,
  Content,
  Effect,
  Side,
  SkillDef,
  Squad,
  StatMod,
  Unit,
  UnitReport,
} from './types';

export interface BattleOptions {
  combat?: CombatConfig;
  /** false — не копить лог (для массовых прогонов симулятора). */
  log?: boolean;
}

class BattleEnded extends Error {}

/** Позиция слота на поле: сторона A из конфига, B — зеркально по ширине поля. */
export function slotPosition(side: Side, slot: number, cfg: CombatConfig = COMBAT): { x: number; y: number } {
  const [x, y] = cfg.field.slotsA[slot];
  return side === 'A' ? { x, y } : { x: cfg.field.width - x, y };
}

export function createUnits(squad: Squad, side: Side, content: Content, cfg: CombatConfig = COMBAT): Unit[] {
  const units: Unit[] = [];
  squad.forEach((entry, slot) => {
    if (!entry) return;
    const def = typeof entry === 'string' ? content.units[entry] : entry;
    if (!def) throw new Error(`Неизвестный юнит: ${String(entry)}`);
    const unitId = def.id;
    const skill = (id: string) => {
      const s = content.skills[id];
      if (!s) throw new Error(`Юнит ${unitId}: неизвестный навык ${id}`);
      return s;
    };
    const basic = skill(def.skills.basic);
    const { x, y } = slotPosition(side, slot, cfg);
    units.push({
      uid: `${side}${slot}`,
      side,
      slot,
      unitId,
      def,
      basic,
      ult: def.skills.ult ? skill(def.skills.ult) : undefined,
      actives: orderActives(def.skills.actives.map(skill)),
      readyAt: {},
      casting: null,
      passives: def.skills.passives.map(skill),
      maxHp: def.stats.hp,
      hp: def.stats.hp,
      base: { atk: def.stats.atk, def: def.stats.def, spd: def.stats.spd },
      energy: 0,
      gauge: 0,
      shield: 0,
      alive: true,
      statuses: [],
      x,
      y,
      moveSpeed: def.stats.moveSpeed ?? cfg.movement.moveSpeed,
      range: basic.range === 'melee' ? cfg.movement.meleeRange : Infinity,
      body: def.bodyRadius ?? cfg.movement.bodyRadius?.[def.kind] ?? 0,
      engage: null,
      moving: null,
    });
  });
  return units;
}

/** Порядок активных навыков: больший priority раньше, при равенстве — открытый позже (стоит дальше в списке). */
export function orderActives(skills: SkillDef[]): SkillDef[] {
  return skills
    .map((s, i) => ({ s, i }))
    .sort((x, y) => y.s.priority - x.s.priority || y.i - x.i)
    .map((x) => x.s);
}

/** Стат с учётом статусов: база × (1 + сумма модификаторов), не меньше 0. */
export function stat(u: Unit, key: StatMod): number {
  const mod = u.statuses.reduce((sum, s) => sum + (s.def.stats?.[key] ?? 0), 0);
  return Math.max(0, u.base[key] * (1 + mod));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Дистанция удара ближнего бойца по цели: его дальность + «радиус тела» цели и свой (боссы крупнее).
 * Симметрична: крупный боец не подпускает мелкого вплотную, к его телу (T2-05: герой не встаёт в спрайт босса).
 */
export const reach = (u: Unit, target: Unit): number => u.range + target.body + u.body;

/**
 * Детерминированный авто-бой. A — атакующая сторона (игрок), B — защищающаяся.
 * Одинаковые контент, отряды, конфиг и seed дают одинаковый лог.
 */
export function simulateBattle(content: Content, squadA: Squad, squadB: Squad, seed: number, opts: BattleOptions = {}): BattleResult {
  const cfg = opts.combat ?? COMBAT;
  const keepLog = opts.log ?? true;
  const rng = new Rng(seed);

  const a = createUnits(squadA, 'A', content, cfg);
  const b = createUnits(squadB, 'B', content, cfg);
  const all = [...a, ...b];
  const snapshots = all.map((u) => ({ uid: u.uid, side: u.side, slot: u.slot, unitId: u.unitId, maxHp: u.maxHp, x: u.x, y: u.y }));
  const log: BattleEvent[] = [];
  const report: Record<string, UnitReport> = {};
  for (const u of all) {
    report[u.uid] = { uid: u.uid, unitId: u.unitId, damageDealt: 0, healingDone: 0, shieldGiven: 0, damageTaken: 0, ults: 0, skills: 0, alive: true };
  }

  let t = 0;
  let tickNo = 0;
  let winner: Side = 'B';
  let reason: 'wipe' | 'timeout' = 'timeout';
  /** Глубина срабатывания пассивок: пассивка не запускает другие пассивки. */
  let passiveDepth = 0;
  /** Секунд боя в одном «ходе» статуса. */
  const turnSeconds = cfg.statusTurnSeconds ?? 1;
  let statusSeq = 0;
  const stunned = (u: Unit) => u.statuses.some((s) => s.def.stun);

  const emit = (e: BattleEvent) => {
    if (keepLog) log.push(e);
  };
  const allies = (u: Unit) => (u.side === 'A' ? a : b);
  const enemies = (u: Unit) => (u.side === 'A' ? b : a);
  const addEnergy = (u: Unit, v: number) => {
    u.energy = Math.max(0, Math.min(cfg.energy.max, u.energy + v));
  };

  const checkEnd = () => {
    const aAlive = a.some((u) => u.alive);
    const bAlive = b.some((u) => u.alive);
    if (aAlive && bAlive) return;
    winner = aAlive ? 'A' : 'B';
    reason = 'wipe';
    throw new BattleEnded();
  };

  // ---------- эффекты ----------

  const kill = (target: Unit, killer: Unit | null) => {
    target.alive = false;
    target.statuses = [];
    target.moving = null;
    target.casting = null;
    report[target.uid].alive = false;
    emit({ t, type: 'death', unit: target.uid, killer: killer?.uid ?? null });
    if (killer) trigger(killer, 'kill');
    for (const ally of allies(target)) if (ally.alive) trigger(ally, 'allyDeath');
    checkEnd();
  };

  const applyDamage = (src: Unit | null, srcUid: string, target: Unit, dmg: number, dot = false) => {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    const hpLoss = Math.min(target.hp, dmg - absorbed);
    target.hp -= hpLoss;
    if (report[srcUid]) report[srcUid].damageDealt += absorbed + hpLoss;
    report[target.uid].damageTaken += absorbed + hpLoss;
    if (target.hp > 0 && !dot) addEnergy(target, cfg.energy.perHitTaken);
    emit({ t, type: 'damage', source: srcUid, target: target.uid, amount: dmg, absorbed, hp: target.hp, shield: target.shield, energy: target.energy, ...(dot ? { dot } : {}) });
    if (target.hp <= 0) kill(target, src);
    else if (!dot) trigger(target, 'hit');
  };

  const applyEffect = (u: Unit, e: Effect, target: Unit, skill?: SkillDef) => {
    // Q: исполнитель мог погибнуть посреди навыка (контратака цели) — остаток навыка не срабатывает.
    if (!target.alive || !u.alive) return;
    // «Сила навыков» редкости карточки (золотой/красный) — множитель урона/лечения/щита навыков, кроме обычной атаки.
    const sp = skill && skill.id !== u.def.skills.basic ? (u.def.skillPower ?? 1) : 1;
    switch (e.type) {
      case 'damage':
        applyDamage(u, u.uid, target, calcDamage(stat(u, 'atk'), e.k * sp, stat(target, 'def'), rng, cfg));
        return;
      case 'heal': {
        const amount = Math.min(calcHeal(stat(u, 'atk'), e.k * sp), target.maxHp - target.hp);
        target.hp += amount;
        report[u.uid].healingDone += amount;
        emit({ t, type: 'heal', source: u.uid, target: target.uid, amount, hp: target.hp });
        return;
      }
      case 'shield': {
        // LT-01: щиты складываются, но не выше потолка (доля макс. ОЗ носителя, combat.json shieldCapPctMaxHp) —
        // иначе щит, заряжаемый от получаемого урона, растёт быстрее урона отряда и бой уходит в «время вышло».
        const cap = Math.floor(target.maxHp * (cfg.shieldCapPctMaxHp ?? 0.5));
        const amount = Math.max(0, Math.min(Math.floor(target.maxHp * e.pctMaxHp * sp), cap - target.shield));
        target.shield += amount;
        report[u.uid].shieldGiven += amount;
        emit({ t, type: 'buff', source: u.uid, target: target.uid, kind: 'shield', amount, shield: target.shield });
        return;
      }
      case 'status': {
        if (e.chance < 1 && rng.next() >= e.chance) return;
        // Тот же статус не складывается — обновляется длительность.
        // Длительность — во времени боя (T2-11): «N ходов» = N × statusTurnSeconds у любого носителя,
        // наложенный на себя бафф не теряет ход сразу.
        // Обновление не сбивает ритм урона за ход (иначе частое обновление яда не давало бы ему тикать).
        const prev = target.statuses.find((s) => s.def.id === e.status.id);
        target.statuses = target.statuses.filter((s) => s !== prev);
        const seconds = round2(e.status.turns * turnSeconds);
        target.statuses.push({
          def: e.status,
          until: round2(t + seconds),
          nextTick: prev ? prev.nextTick : round2(t + turnSeconds),
          seq: prev ? prev.seq : statusSeq++,
          sourceAtk: stat(u, 'atk'),
          source: u.uid,
        });
        emit({ t, type: 'status', source: u.uid, target: target.uid, status: e.status.id, name: e.status.name, turns: e.status.turns, action: 'apply', seconds });
        if (e.status.stun) {
          // Оглушение сбивает каст; навык не уходит в перезарядку.
          if (target.casting) {
            const c = target.casting.skill;
            target.casting = null;
            emit({ t, type: 'cast', unit: target.uid, skill: c.id, name: c.name, duration: 0, action: 'interrupt', reason: 'stun' });
          }
          // Оглушённый останавливается там, где стоит (T2-06).
          if (target.moving) {
            target.moving = null;
            const at: [number, number] = [round2(target.x), round2(target.y)];
            emit({ t, type: 'move', unit: target.uid, from: at, to: at, duration: 0, kind: 'walk' });
          }
        }
        return;
      }
      case 'energy':
        addEnergy(target, e.amount);
        emit({ t, type: 'energy', unit: target.uid, energy: target.energy });
        return;
      case 'dash': {
        // Встать вплотную к цели со стороны, откуда пришёл, и сражаться с ней —
        // на свободное место в пределах поля (не в другого бойца, T2-03/T2-04).
        // Цель на бегу — к точке, где она остановится.
        const tx = standX(target);
        const ty = standY(target);
        const d = Math.hypot(u.x - tx, u.y - ty);
        const r = cfg.movement.meleeRange * 0.8 + target.body + u.body;
        const dirX = d > 0 ? (u.x - tx) / d : u.side === 'A' ? -1 : 1;
        const dirY = d > 0 ? (u.y - ty) / d : 0;
        const spot = findSpot(u, tx, ty, dirX, dirY, r, target, 0);
        const to: [number, number] = [spot.x, spot.y];
        // Прыжок в тыл (T2-05): не «ассасин» бьёт и возвращается к прежнему противнику, а не остаётся в тылу.
        const prev = u.engage?.alive ? u.engage : null;
        returns.delete(u);
        dived.delete(u);
        if (!inRow(target, 'front', cfg)) {
          if (prev !== target && !(skill && diveStay.has(skill.id)))
            returns.set(u, { at: round2(t + cfg.movement.dashSeconds + diveReturnSeconds), x: u.x, y: u.y, prev });
          else dived.add(u);
        }
        emit({ t, type: 'move', unit: u.uid, from: [round2(u.x), round2(u.y)], to, duration: cfg.movement.dashSeconds, kind: 'dash' });
        u.x = to[0];
        u.y = to[1];
        u.moving = null;
        if (u.range !== Infinity) setEngage(u, target);
        return;
      }
    }
  };

  /** Применяет навык: цели выбираются заново на каждый удар при pick=random. */
  const useSkill = (u: Unit, skill: SkillDef, preset?: Unit[]): Unit[] => {
    const hit: Unit[] = [];
    for (let i = 0; i < skill.hits && u.alive; i++) {
      const targets = preset && i === 0 ? preset : selectTargets(u, skill.target, allies(u), enemies(u), rng, cfg);
      for (const target of targets) {
        if (!hit.includes(target)) hit.push(target);
        for (const e of skill.effects) applyEffect(u, e, target, skill);
      }
    }
    return hit;
  };

  /**
   * Снаряды в полёте (T2-10): дальняя атака наносит эффекты через projectileSeconds.
   * К приземлению погибшие цели выбывают (снаряд пропадает); погиб стрелок — пропадает весь залп.
   */
  const flying: { land: number; seq: number; u: Unit; skill: SkillDef; targets: Unit[] }[] = [];
  let flySeq = 0;
  const projectileSeconds = cfg.projectileSeconds ?? 0;

  /** Применить атаку сразу или отправить снаряд (дальняя атака по врагу, не рывок). */
  const launch = (u: Unit, skill: SkillDef, targets: Unit[]) => {
    const projectile =
      projectileSeconds > 0 && skill.range === 'ranged' && skill.target.side === 'enemy' && !skill.effects.some((e) => e.type === 'dash');
    if (!projectile) {
      useSkill(u, skill, targets);
      return;
    }
    flying.push({ land: round2(t + projectileSeconds), seq: flySeq++, u, skill, targets });
  };

  const landProjectiles = () => {
    if (flying.length === 0 || !flying.some((f) => f.land <= t + 1e-9)) return;
    const due = flying.filter((f) => f.land <= t + 1e-9).sort((x, y) => x.land - y.land || x.seq - y.seq);
    if (due.length === 0) return;
    for (const f of due) flying.splice(flying.indexOf(f), 1);
    for (const f of due) {
      if (!f.u.alive) continue;
      useSkill(f.u, f.skill, f.targets.filter((x) => x.alive));
    }
  };

  /** Навык только лечит: полное HP — не цель (T2-01: пустое лечение не тратит ход, перезарядку и не шумит в логе). */
  const healOnly = (s: SkillDef) => s.effects.every((e) => e.type === 'heal');
  const wounded = (list: Unit[]) => list.filter((x) => x.hp < x.maxHp);

  function trigger(u: Unit, when: NonNullable<SkillDef['trigger']>) {
    if (passiveDepth > 0 || !u.alive) return;
    for (const p of u.passives) {
      if (p.trigger !== when) continue;
      if (p.chance < 1 && rng.next() >= p.chance) continue;
      let targets = selectTargets(u, p.target, allies(u), enemies(u), rng, cfg);
      if (healOnly(p)) targets = wounded(targets);
      if (targets.length === 0) continue;
      passiveDepth++;
      try {
        emit({ t, type: 'passive', unit: u.uid, skill: p.id, name: p.name });
        useSkill(u, p, targets);
      } finally {
        passiveDepth--;
      }
    }
  }

  // ---------- движение ----------

  /**
   * Застревание ближнего бойца: сколько секунд он не в досягаемости цели и не приближается к ней.
   * Хранится вне Unit, чтобы не менять общий тип.
   */
  const stuck = new Map<Unit, { time: number; lastDist: number }>();
  const retargetSeconds = cfg.movement.retargetSeconds ?? 3;

  const setEngage = (u: Unit, target: Unit | null) => {
    u.engage = target;
    stuck.delete(u);
  };

  /**
   * Ближний боец выбирает, с кем сражаться (T2-05 — строй вместо кучи): кандидаты — цели обычной атаки по порядку
   * селектора; враг, прыгнувший в наш тыл, — последним; берётся первый, у кого меньше maxMeleePerTarget
   * ближних противников, иначе — у кого их меньше всех.
   * Цель прыгнула в наш тыл не на меня — я не гонюсь за ней, если есть кто-то ещё (держу линию).
   */
  const pickEngage = (u: Unit) => {
    const cur = u.engage;
    if (cur?.alive && !(deep(cur) && cur.engage !== u && enemies(u).some((x) => x.alive && !deep(x)))) return;
    // Порядок: цели обычной атаки (по её селектору), затем остальные враги по близости.
    const pool = selectTargets(u, { ...u.basic.target, count: 99 }, allies(u), enemies(u), rng, cfg).filter((x) => x.side !== u.side);
    const rest = enemies(u)
      .filter((x) => x.alive && !pool.includes(x))
      .sort((x, y) => dist(u, x) - dist(u, y) || x.slot - y.slot);
    pool.push(...rest);
    if (pool.length === 0) {
      setEngage(u, null);
      return;
    }
    const front = pool.filter((x) => !deep(x));
    const cands = front.length > 0 ? front : pool;
    let best = cands[0];
    let bestN = Infinity;
    for (const x of cands) {
      const n = meleeOn(x, u);
      if (n < maxPerTarget) {
        best = x;
        break;
      }
      if (n < bestN) {
        bestN = n;
        best = x;
      }
    }
    setEngage(u, best);
  };

  /** Сколько ближних бойцов (кроме except) сражаются с target. */
  const meleeOn = (target: Unit, except: Unit) => {
    let n = 0;
    for (const o of enemies(target)) if (o !== except && o.alive && o.engage === target && o.range !== Infinity) n++;
    return n;
  };

  /** Прыгнул в тыл и остался там (до первого шага пешком). */
  const dived = new Set<Unit>();
  /** Юнит прыгнул в наш тыл и стоит за линией фронта чужой стороны. */
  const frontX = cfg.field.slotsA[cfg.slots.front[0]]?.[0] ?? 0;
  const deep = (o: Unit) => dived.has(o) && (o.side === 'B' ? standX(o) < frontX : standX(o) > cfg.field.width - frontX);
  /** Юнит отошёл в свой тыл (ближе к заднему ряду своей стороны, чем к переднему). */
  const rearX = (frontX + (cfg.field.slotsA[cfg.slots.back[0]]?.[0] ?? 0)) / 2;
  const inRear = (o: Unit) => (o.side === 'A' ? standX(o) < rearX : standX(o) > cfg.field.width - rearX);

  /** Прыгнувшие в тыл, которые вернутся к прежнему противнику. */
  const returns = new Map<Unit, { at: number; x: number; y: number; prev: Unit | null }>();
  const diveStay = new Set(cfg.movement.diveStay ?? []);
  const diveReturnSeconds = cfg.movement.diveReturnSeconds ?? 0.8;
  const maxPerTarget = cfg.movement.maxMeleePerTarget ?? Infinity;

  /** Возврат после прыжка в тыл: рывком к прежнему противнику (или на место прыжка, если тот погиб). */
  const diveBack = () => {
    if (returns.size === 0) return;
    for (const [u, r] of [...returns]) {
      if (!u.alive) {
        returns.delete(u);
        continue;
      }
      if (t + 1e-9 < r.at || stunned(u) || u.casting) continue;
      returns.delete(u);
      // Назад — к прежнему противнику, если он держит линию; иначе — на место прыжка.
      const prev = r.prev?.alive && !inRear(r.prev) ? r.prev : null;
      const spot = prev
        ? findSpot(u, standX(prev), standY(prev), u.side === 'A' ? -1 : 1, 0, reach(u, prev) * 0.9, prev, 0)
        : clearance(u, null, r.x, r.y) >= minSep
          ? { x: round2(r.x), y: round2(r.y) }
          : findSpot(u, r.x, r.y, u.side === 'A' ? -1 : 1, 0, minSep, null, 0);
      u.moving = null;
      emit({ t, type: 'move', unit: u.uid, from: [round2(u.x), round2(u.y)], to: [spot.x, spot.y], duration: cfg.movement.dashSeconds, kind: 'dash' });
      u.x = spot.x;
      u.y = spot.y;
      if (u.range !== Infinity) setEngage(u, prev);
    }
  };

  /**
   * Не может дойти до цели дольше retargetSeconds — берёт ближайшего живого врага
   * (кроме недостижимой цели; если других нет — продолжает идти к ней).
   */
  const checkStuck = (u: Unit) => {
    const target = u.engage;
    if (!target?.alive) return;
    // Оглушённый стоит не по своей воле — это не застревание.
    if (stunned(u)) return;
    const d = dist(u, target);
    if (d <= reach(u, target) + 0.5) {
      stuck.delete(u);
      return;
    }
    const s = stuck.get(u) ?? { time: 0, lastDist: Infinity };
    // Идёт к цели и расстояние сокращается — не застрял.
    if (d < s.lastDist - 1) s.lastDist = d;
    else s.time += cfg.tickSeconds;
    stuck.set(u, s);
    if (s.time + 1e-9 < retargetSeconds) return;
    const other = enemies(u)
      .filter((x) => x.alive && x !== target)
      .sort((x, y) => dist(u, x) - dist(u, y) || x.slot - y.slot)[0];
    if (other) {
      setEngage(u, other);
      u.moving = null;
    } else stuck.delete(u);
  };

  const bounds = cfg.field.bounds;
  const minSep = cfg.movement.minSeparation ?? 0;
  const inBounds = (x: number, y: number) => !bounds || (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
  const clampX = (x: number) => (bounds ? Math.min(bounds.maxX, Math.max(bounds.minX, x)) : x);
  const clampY = (y: number) => (bounds ? Math.min(bounds.maxY, Math.max(bounds.minY, y)) : y);

  /** Где юнит будет стоять: точка назначения, если идёт, иначе текущая позиция. */
  const standX = (o: Unit) => (o.moving ? o.moving.toX : o.x);
  const standY = (o: Unit) => (o.moving ? o.moving.toY : o.y);

  /** Расстояние от точки до ближайшего чужого места стоянки (кроме самого юнита и его цели). */
  const clearance = (u: Unit, target: Unit | null, x: number, y: number) => {
    let best = Infinity;
    for (const o of all) {
      if (o === u || o === target || !o.alive) continue;
      best = Math.min(best, Math.hypot(standX(o) - x, standY(o) - y) - o.body - u.body);
    }
    return best;
  };

  /**
   * Место у цели (T2-02…T2-05): веер stackAngles вокруг направления (dirX, dirY) на расстоянии r,
   * сжатый по вертикали (crowdSquash). Первым пробуется «своё» место (prefer — индекс в веере),
   * дальше — остальные, затем та же раскладка с другой стороны цели.
   * Берётся первая точка в пределах поля и не ближе minSeparation к другим бойцам;
   * если таких нет — самая свободная в пределах поля; если и таких нет — прижатая к краю.
   */
  const findSpot = (u: Unit, ax: number, ay: number, dirX: number, dirY: number, r: number, target: Unit | null, prefer: number) => {
    const angles = cfg.movement.stackAngles.length > 0 ? cfg.movement.stackAngles : [0];
    const squash = cfg.movement.crowdSquash ?? 1;
    const order = angles.map((_, i) => i);
    const first = Math.max(0, prefer) % angles.length;
    order.splice(order.indexOf(first), 1);
    order.unshift(first);
    const cands: { x: number; y: number }[] = [];
    for (const side of [1, -1])
      for (const i of order) {
        const ang = (angles[i] * Math.PI) / 180;
        const dx = side * dirX;
        const dy = side * dirY;
        cands.push({
          x: round2(ax + (dx * Math.cos(ang) - dy * Math.sin(ang)) * r),
          y: round2(ay + (dx * Math.sin(ang) + dy * Math.cos(ang)) * r * squash),
        });
      }
    let fallback: { x: number; y: number } | null = null;
    let fallbackGap = -1;
    for (const c of cands) {
      if (!inBounds(c.x, c.y)) continue;
      const gap = clearance(u, target, c.x, c.y);
      if (gap >= minSep) return c;
      if (gap > fallbackGap) {
        fallbackGap = gap;
        fallback = c;
      }
    }
    return fallback ?? { x: round2(clampX(cands[0].x)), y: round2(clampY(cands[0].y)) };
  };

  /** К какой цели и точке стоянки идёт боец (для перепланирования, если цель ушла). */
  const plans = new Map<Unit, { target: Unit; x: number; y: number }>();

  /**
   * Боец идёт к цели, а она сменилась или ушла со своей точки дальше чем на minSeparation, — путь пересчитывается
   * (раз в 3 тика), а не доходит до устаревшей точки (T2-05: меньше беготни через поле).
   */
  const stalePlan = (u: Unit, target: Unit) => {
    if (tickNo % 3 !== 0) return false;
    const p = plans.get(u);
    if (!p) return false;
    return p.target !== target || Math.hypot(standX(target) - p.x, standY(target) - p.y) > Math.max(minSep, 1);
  };

  const planMove = (u: Unit) => {
    const target = u.engage;
    if (!target || u.casting || stunned(u)) return;
    if (!u.moving) {
      planStep(u, target);
      return;
    }
    if (!stalePlan(u, target)) return;
    u.moving = null;
    planStep(u, target);
    // Новый путь не понадобился (уже в досягаемости) — остановка там, где стоит, чтобы сцена не дорисовала старый путь.
    if (!u.moving) {
      const at: [number, number] = [round2(u.x), round2(u.y)];
      emit({ t, type: 'move', unit: u.uid, from: at, to: at, duration: 0, kind: 'walk' });
    }
  };

  const planStep = (u: Unit, target: Unit) => {
    plans.delete(u);
    if (dist(u, target) <= reach(u, target)) {
      // Проверка наложения — раз в 3 тика (0.3 с): незаметно глазу, дешевле для массовых прогонов.
      if (tickNo % 3 === 0) separate(u, target);
      return;
    }
    // Цель уже бежит ко мне — жду на месте, иначе бойцы разминутся.
    if (target.moving && target.engage === u) return;
    // Два ближних бойца нацелены друг на друга — оба идут навстречу и встречаются посередине
    // (с учётом скорости), чтобы ни одна сторона не получала преимущества от порядка обработки.
    if (target.engage === u && target.range !== Infinity && !stunned(target) && !target.casting) {
      const d = dist(u, target);
      const travel = d - Math.min(reach(u, target), reach(target, u)) * 0.9;
      const share = u.moveSpeed / (u.moveSpeed + target.moveSpeed);
      const dx = (target.x - u.x) / d;
      const dy = (target.y - u.y) / d;
      startMove(u, u.x + dx * travel * share, u.y + dy * travel * share);
      plans.delete(target);
      startMove(target, target.x - dx * travel * (1 - share), target.y - dy * travel * (1 - share));
      return;
    }
    const ax = standX(target);
    const ay = standY(target);
    // Несколько бойцов у одной цели встают веером со своей стороны (A — слева, B — справа).
    // Первым пробуется место по слоту бойца (не перебегают), занятое другим — берётся соседнее свободное;
    // точка за краем поля — заходят с другой стороны цели.
    const crowd = allies(u)
      .filter((o) => o.alive && o.engage === target && o.range !== Infinity)
      .sort((x, y) => x.slot - y.slot)
      .indexOf(u);
    const spot = findSpot(u, ax, ay, u.side === 'A' ? -1 : 1, 0, reach(u, target) * 0.9, target, crowd);
    startMove(u, spot.x, spot.y);
    if (u.moving) plans.set(u, { target, x: ax, y: ay });
  };

  /**
   * Боец уже в досягаемости, но стоит в другом (T2-02/T2-03): тот, кто пришёл позже, отходит на свободное место у цели.
   * Кто уступает: ближний против стоящего дальнего — ближний; двое ближних — больший uid (детерминированно).
   */
  const separate = (u: Unit, target: Unit) => {
    if (minSep <= 0) return;
    const lim = (minSep * 0.6) ** 2;
    let tooClose = false;
    for (const o of all) {
      if (o === u || !o.alive) continue;
      const dx = standX(o) - u.x;
      const dy = standY(o) - u.y;
      if (dx * dx + dy * dy >= lim) continue;
      if (o.range === Infinity || o.moving || o.casting || stunned(o) || o.uid < u.uid) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) return;
    const d = dist(u, target) || 1;
    const dirX = (u.x - target.x) / d;
    const dirY = (u.y - target.y) / d;
    const spot = findSpot(u, target.x, target.y, dirX, dirY, reach(u, target) * 0.9, target, 1);
    // Цель тоже считается: можно стоять и «в ней» (после рывка на бегущую цель).
    if (clearance(u, null, spot.x, spot.y) <= clearance(u, null, u.x, u.y) + 1) return;
    startMove(u, spot.x, spot.y);
  };

  const startMove = (u: Unit, x: number, y: number) => {
    const toX = round2(clampX(x));
    const toY = round2(clampY(y));
    const len = Math.hypot(toX - u.x, toY - u.y);
    if (len < 1) return;
    dived.delete(u);
    u.moving = { toX, toY };
    emit({ t, type: 'move', unit: u.uid, from: [round2(u.x), round2(u.y)], to: [toX, toY], duration: round2(len / u.moveSpeed), kind: 'walk' });
  };

  const stepMove = (u: Unit) => {
    if (!u.moving) return;
    const step = u.moveSpeed * cfg.tickSeconds;
    const dx = u.moving.toX - u.x;
    const dy = u.moving.toY - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      u.x = u.moving.toX;
      u.y = u.moving.toY;
      u.moving = null;
    } else {
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
    }
  };

  // ---------- ход ----------

  const skillReady = (u: Unit, skill: SkillDef) =>
    !u.moving && (skill.range === 'ranged' || (!!u.engage?.alive && dist(u, u.engage) <= reach(u, u.engage) + 0.5));

  /** true — юнит походил; false — не может сейчас (бежит или не дошёл), ждёт с полной шкалой. */
  const act = (u: Unit): boolean => {
    // Оглушённый теряет ход, где бы ни стоял (T2-06).
    if (stunned(u)) {
      emit({ t, type: 'turn', unit: u.uid });
      trigger(u, 'turnStart');
      if (u.alive) emit({ t, type: 'skip', unit: u.uid, reason: 'stun' });
      return true;
    }
    const useUlt = !!u.ult && u.energy >= cfg.energy.max && skillReady(u, u.ult);
    // Готовый навык дальнего действия можно применить и не дойдя до цели. Навык без целей (лечение при полном HP)
    // не готов: ход на него не тратится (T2-01).
    const active = useUlt || u.moving ? null : pickActive(u);
    if (!useUlt && !active && !skillReady(u, u.basic)) return false;

    emit({ t, type: 'turn', unit: u.uid });
    trigger(u, 'turnStart');
    if (!u.alive) return true;

    if (active && startActive(u, active.skill, active.targets)) {
      // активный навык применён или начат каст
    } else if (useUlt && u.ult) {
      u.energy = 0;
      report[u.uid].ults++;
      const ult = u.ult;
      const targets = selectTargets(u, ult.target, allies(u), enemies(u), rng, cfg);
      emit({ t, type: 'ult', unit: u.uid, skill: ult.id, name: ult.name, targets: targets.map((x) => x.uid) });
      useSkill(u, ult, targets);
    } else if (skillReady(u, u.basic)) {
      basicAction(u, u.basic);
    }
    return true;
  };

  /**
   * Цели активного навыка: ближний бьёт цель сражения (если дошёл), остальные — по селектору. Пусто — навык сейчас бесполезен.
   * Навык только с лечением не выбирает целей с полным HP.
   */
  const activeTargets = (u: Unit, skill: SkillDef): Unit[] => {
    const heal = healOnly(skill);
    if (skill.range === 'melee') {
      const e = u.engage;
      if (!e?.alive || dist(u, e) > reach(u, e) + 0.5) return [];
      // Одиночный удар — по цели сражения; удар по площади (pick all, count > 1) — по селектору среди врагов
      // рядом с целью сражения (T2-07: не через всё поле), цель сражения — всегда среди задетых.
      const aoe = skill.target.pick === 'all' || skill.target.count > 1;
      if (!aoe || skill.target.side !== 'enemy') {
        const out = aoe ? selectTargets(u, skill.target, allies(u), enemies(u), rng, cfg) : [e];
        return heal ? wounded(out) : out;
      }
      const radius = cfg.movement.meleeAoeRadius ?? Infinity;
      const near = enemies(u).filter((x) => x === e || dist(x, e) <= radius + x.body);
      let out = selectTargets(u, skill.target, allies(u), near, rng, cfg);
      if (!out.includes(e)) {
        out = [e, ...out];
        if (skill.target.pick !== 'all') out = out.slice(0, skill.target.count);
      }
      return out;
    }
    const out = selectTargets(u, skill.target, allies(u), enemies(u), rng, cfg);
    return heal ? wounded(out) : out;
  };

  const cooldownOf = (skill: SkillDef) => skill.cooldown ?? cfg.skills?.defaultCooldown ?? 8;

  const fireActive = (u: Unit, skill: SkillDef, targets: Unit[]) => {
    const cd = cooldownOf(skill);
    u.readyAt[skill.id] = round2(t + cd);
    report[u.uid].skills++;
    addEnergy(u, cfg.energy.perBasicAction);
    const kind = skill.effects.some((e) => e.type === 'heal') ? 'heal' : skill.range === 'melee' ? 'melee' : 'ranged';
    emit({ t, type: 'attack', unit: u.uid, skill: skill.id, targets: targets.map((x) => x.uid), kind, energy: u.energy, name: skill.name, cooldown: cd });
    launch(u, skill, targets);
  };

  /** Готовый активный навык с наибольшим приоритетом, у которого есть цели. null — готовых нет. */
  const pickActive = (u: Unit): { skill: SkillDef; targets: Unit[] } | null => {
    for (const skill of u.actives) {
      if ((u.readyAt[skill.id] ?? 0) > t + 1e-9) continue;
      if (!skillReady(u, skill)) continue;
      const targets = activeTargets(u, skill);
      if (targets.length > 0) return { skill, targets };
    }
    return null;
  };

  /** Применяет выбранный навык или начинает каст. Цели проверяются заново (начало хода могло их изменить). */
  const startActive = (u: Unit, skill: SkillDef, picked: Unit[]): boolean => {
    let targets = picked.filter((x) => x.alive);
    if (healOnly(skill)) targets = wounded(targets);
    if (targets.length === 0) return false;
    if (skill.castTime > 0) {
      u.casting = { skill, until: round2(t + skill.castTime) };
      emit({ t, type: 'cast', unit: u.uid, skill: skill.id, name: skill.name, duration: skill.castTime, action: 'start' });
    } else fireActive(u, skill, targets);
    return true;
  };

  /**
   * Каст закончился: цели выбираются в конце (кто-то мог умереть). Целей нет — каст пропал (reason noTarget, T2-09),
   * перезарядка не идёт.
   */
  const finishCast = (u: Unit) => {
    const c = u.casting;
    if (!c || t + 1e-9 < c.until) return;
    u.casting = null;
    u.gauge = 0;
    const targets = activeTargets(u, c.skill);
    if (targets.length === 0) {
      emit({ t, type: 'cast', unit: u.uid, skill: c.skill.id, name: c.skill.name, duration: 0, action: 'interrupt', reason: 'noTarget' });
      return;
    }
    fireActive(u, c.skill, targets);
  };

  const basicAction = (u: Unit, skill: SkillDef) => {
    // Ближний бой бьёт того, с кем сражается; остальные выбирают цель навыком.
    let targets = skill.range === 'melee' && u.engage?.alive ? [u.engage] : selectTargets(u, skill.target, allies(u), enemies(u), rng, cfg);
    if (targets.length === 0 && skill.fallback) {
      const fb = content.skills[skill.fallback];
      return basicAction(u, fb);
    }
    if (targets.length === 0) return;
    addEnergy(u, cfg.energy.perBasicAction);
    const kind = skill.effects.some((e) => e.type === 'heal') ? 'heal' : skill.range === 'melee' ? 'melee' : 'ranged';
    emit({ t, type: 'attack', unit: u.uid, skill: skill.id, targets: targets.map((x) => x.uid), kind, energy: u.energy });
    launch(u, skill, targets);
  };

  /**
   * Статусы идут по времени боя (T2-11), а не по ходам носителя: урон за ход тикает раз в statusTurnSeconds,
   * статус спадает в until — и у бегущего, и у оглушённого (T2-06). Тики в один момент — в порядке наложения.
   */
  const tickStatuses = () => {
    let due: { u: Unit; s: ActiveStatus }[] | null = null;
    let expiring = false;
    for (const u of all) {
      if (!u.alive || u.statuses.length === 0) continue;
      for (const s of u.statuses) {
        if (s.def.dot && s.nextTick <= t + 1e-9 && s.nextTick <= s.until + 1e-9) (due ??= []).push({ u, s });
        if (s.until <= t + 1e-9) expiring = true;
      }
    }
    if (due) {
      due.sort((x, y) => x.s.nextTick - y.s.nextTick || x.s.seq - y.s.seq);
      for (const { u, s } of due) {
        if (!u.alive || !u.statuses.includes(s)) continue;
        s.nextTick = round2(s.nextTick + turnSeconds);
        applyDamage(null, s.source, u, Math.max(1, Math.floor(s.sourceAtk * s.def.dot!.k)), true);
      }
    }
    if (!expiring) return;
    for (const u of all) {
      if (!u.alive) continue;
      for (const s of [...u.statuses]) {
        if (s.until > t + 1e-9) continue;
        u.statuses = u.statuses.filter((x) => x !== s);
        emit({ t, type: 'status', source: s.source, target: u.uid, status: s.def.id, name: s.def.name, turns: 0, action: 'expire' });
      }
    }
  };

  const maxTicks = Math.round(cfg.timeLimitSeconds / cfg.tickSeconds);

  try {
    checkEnd();
    for (const u of all) trigger(u, 'battleStart');
    for (let tick = 1; tick <= maxTicks; tick++) {
      t = Math.round(tick * cfg.tickSeconds * 1000) / 1000;
      tickNo = tick;

      landProjectiles();
      tickStatuses();
      for (const u of all) if (u.alive && !stunned(u)) stepMove(u);
      diveBack();
      const melee = all.filter((u) => u.alive && u.range !== Infinity);
      for (const u of melee) pickEngage(u);
      for (const u of melee) checkStuck(u);
      for (const u of melee) planMove(u);

      for (const u of all) if (u.alive && u.casting) finishCast(u);

      const ready: Unit[] = [];
      for (const u of all) {
        if (!u.alive || u.casting) continue;
        u.gauge = Math.min(cfg.actionThreshold, u.gauge + stat(u, 'spd'));
        if (u.gauge >= cfg.actionThreshold) ready.push(u);
      }
      // Равенство шкалы решает seed.
      if (ready.length > 1) {
        const key = new Map(ready.map((u) => [u, rng.next()]));
        ready.sort((x, y) => key.get(x)! - key.get(y)!);
      }
      for (const u of ready) {
        if (!u.alive) continue;
        if (act(u)) u.gauge = 0;
      }
    }
    t = cfg.timeLimitSeconds;
    winner = 'B';
    reason = 'timeout';
  } catch (err) {
    if (!(err instanceof BattleEnded)) throw err;
  }

  emit({ t, type: 'end', winner, reason });

  return { seed, winner, reason, duration: t, units: snapshots, log, report };
}
