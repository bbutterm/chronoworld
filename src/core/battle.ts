import { COMBAT } from './config';
import { calcDamage, calcHeal } from './formulas';
import { Rng } from './rng';
import { dist, selectTargets } from './targeting';
import type {
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
      engage: null,
      moving: null,
    });
  });
  return units;
}

/** Стат с учётом статусов: база × (1 + сумма модификаторов), не меньше 0. */
export function stat(u: Unit, key: StatMod): number {
  const mod = u.statuses.reduce((sum, s) => sum + (s.def.stats?.[key] ?? 0), 0);
  return Math.max(0, u.base[key] * (1 + mod));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

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
    report[u.uid] = { uid: u.uid, unitId: u.unitId, damageDealt: 0, healingDone: 0, shieldGiven: 0, damageTaken: 0, ults: 0, alive: true };
  }

  let t = 0;
  let winner: Side = 'B';
  let reason: 'wipe' | 'timeout' = 'timeout';
  /** Глубина срабатывания пассивок: пассивка не запускает другие пассивки. */
  let passiveDepth = 0;

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

  const applyEffect = (u: Unit, e: Effect, target: Unit) => {
    if (!target.alive) return;
    switch (e.type) {
      case 'damage':
        applyDamage(u, u.uid, target, calcDamage(stat(u, 'atk'), e.k, stat(target, 'def'), rng, cfg));
        return;
      case 'heal': {
        const amount = Math.min(calcHeal(stat(u, 'atk'), e.k), target.maxHp - target.hp);
        target.hp += amount;
        report[u.uid].healingDone += amount;
        emit({ t, type: 'heal', source: u.uid, target: target.uid, amount, hp: target.hp });
        return;
      }
      case 'shield': {
        const amount = Math.floor(target.maxHp * e.pctMaxHp);
        target.shield += amount;
        report[u.uid].shieldGiven += amount;
        emit({ t, type: 'buff', source: u.uid, target: target.uid, kind: 'shield', amount, shield: target.shield });
        return;
      }
      case 'status': {
        if (e.chance < 1 && rng.next() >= e.chance) return;
        // Тот же статус не складывается — обновляется длительность.
        target.statuses = target.statuses.filter((s) => s.def.id !== e.status.id);
        target.statuses.push({ def: e.status, turnsLeft: e.status.turns, sourceAtk: stat(u, 'atk'), source: u.uid });
        emit({ t, type: 'status', source: u.uid, target: target.uid, status: e.status.id, name: e.status.name, turns: e.status.turns, action: 'apply' });
        return;
      }
      case 'energy':
        addEnergy(target, e.amount);
        emit({ t, type: 'energy', unit: target.uid, energy: target.energy });
        return;
      case 'dash': {
        // Встать вплотную к цели со стороны, откуда пришёл, и сражаться с ней.
        const d = dist(u, target) || 1;
        const r = cfg.movement.meleeRange * 0.8;
        const to: [number, number] = [round2(target.x + ((u.x - target.x) / d) * r), round2(target.y + ((u.y - target.y) / d) * r)];
        emit({ t, type: 'move', unit: u.uid, from: [round2(u.x), round2(u.y)], to, duration: cfg.movement.dashSeconds, kind: 'dash' });
        u.x = to[0];
        u.y = to[1];
        u.moving = null;
        if (u.range !== Infinity) u.engage = target;
        return;
      }
    }
  };

  /** Применяет навык: цели выбираются заново на каждый удар при pick=random. */
  const useSkill = (u: Unit, skill: SkillDef, preset?: Unit[]): Unit[] => {
    const hit: Unit[] = [];
    for (let i = 0; i < skill.hits; i++) {
      const targets = preset && i === 0 ? preset : selectTargets(u, skill.target, allies(u), enemies(u), rng, cfg);
      for (const target of targets) {
        if (!hit.includes(target)) hit.push(target);
        for (const e of skill.effects) applyEffect(u, e, target);
      }
    }
    return hit;
  };

  function trigger(u: Unit, when: NonNullable<SkillDef['trigger']>) {
    if (passiveDepth > 0 || !u.alive) return;
    for (const p of u.passives) {
      if (p.trigger !== when) continue;
      if (p.chance < 1 && rng.next() >= p.chance) continue;
      const targets = selectTargets(u, p.target, allies(u), enemies(u), rng, cfg);
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

  /** Ближний боец выбирает, с кем сражаться: первая цель обычной атаки. */
  const pickEngage = (u: Unit) => {
    if (u.engage?.alive) return;
    const targets = selectTargets(u, u.basic.target, allies(u), enemies(u), rng, cfg);
    u.engage = targets.find((x) => x.side !== u.side) ?? null;
  };

  const planMove = (u: Unit) => {
    const target = u.engage;
    if (!target || u.moving || dist(u, target) <= u.range) return;
    // Цель уже бежит ко мне — жду на месте, иначе бойцы разминутся.
    if (target.moving && target.engage === u) return;
    // Два ближних бойца нацелены друг на друга — оба идут навстречу и встречаются посередине
    // (с учётом скорости), чтобы ни одна сторона не получала преимущества от порядка обработки.
    if (target.engage === u && target.range !== Infinity) {
      const d = dist(u, target);
      const travel = d - Math.min(u.range, target.range) * 0.9;
      const share = u.moveSpeed / (u.moveSpeed + target.moveSpeed);
      const dx = (target.x - u.x) / d;
      const dy = (target.y - u.y) / d;
      startMove(u, u.x + dx * travel * share, u.y + dy * travel * share);
      startMove(target, target.x - dx * travel * (1 - share), target.y - dy * travel * (1 - share));
      return;
    }
    const ax = target.moving ? target.moving.toX : target.x;
    const ay = target.moving ? target.moving.toY : target.y;
    const d = Math.hypot(u.x - ax, u.y - ay) || 1;
    // Несколько бойцов у одной цели встают веером, а не друг в друга.
    const crowd = allies(u).filter((o) => o !== u && o.alive && o.engage === target && o.range !== Infinity).length;
    const angles = cfg.movement.stackAngles;
    const ang = ((angles[crowd % angles.length] ?? 0) * Math.PI) / 180;
    const dx = (u.x - ax) / d;
    const dy = (u.y - ay) / d;
    const r = u.range * 0.9;
    const toX = round2(ax + (dx * Math.cos(ang) - dy * Math.sin(ang)) * r);
    const toY = round2(ay + (dx * Math.sin(ang) + dy * Math.cos(ang)) * r);
    startMove(u, toX, toY);
  };

  const startMove = (u: Unit, x: number, y: number) => {
    const toX = round2(x);
    const toY = round2(y);
    const len = Math.hypot(toX - u.x, toY - u.y);
    if (len < 1) return;
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
    !u.moving && (skill.range === 'ranged' || (!!u.engage?.alive && dist(u, u.engage) <= u.range + 0.5));

  /** true — юнит походил; false — не может сейчас (бежит или не дошёл), ждёт с полной шкалой. */
  const act = (u: Unit): boolean => {
    const useUlt = !!u.ult && u.energy >= cfg.energy.max && skillReady(u, u.ult);
    if (!useUlt && !skillReady(u, u.basic)) return false;

    emit({ t, type: 'turn', unit: u.uid });
    trigger(u, 'turnStart');

    // Статусы носителя: урон за ход и оглушение.
    for (const s of [...u.statuses]) {
      if (s.def.dot && u.alive) applyDamage(null, s.source, u, Math.max(1, Math.floor(s.sourceAtk * s.def.dot.k)), true);
    }
    if (!u.alive) return true;
    const stunned = u.statuses.some((s) => s.def.stun);
    if (stunned) emit({ t, type: 'skip', unit: u.uid, reason: 'stun' });
    else if (useUlt && u.ult) {
      u.energy = 0;
      report[u.uid].ults++;
      const ult = u.ult;
      const targets = selectTargets(u, ult.target, allies(u), enemies(u), rng, cfg);
      emit({ t, type: 'ult', unit: u.uid, skill: ult.id, name: ult.name, targets: targets.map((x) => x.uid) });
      useSkill(u, ult, targets);
    } else {
      basicAction(u, u.basic);
    }
    tickStatuses(u);
    return true;
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
    useSkill(u, skill, targets);
  };

  const tickStatuses = (u: Unit) => {
    for (const s of [...u.statuses]) {
      s.turnsLeft--;
      if (s.turnsLeft <= 0) {
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

      for (const u of all) if (u.alive) stepMove(u);
      const melee = all.filter((u) => u.alive && u.range !== Infinity);
      for (const u of melee) pickEngage(u);
      for (const u of melee) planMove(u);

      const ready: Unit[] = [];
      for (const u of all) {
        if (!u.alive) continue;
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
