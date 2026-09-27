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

/** Дистанция удара ближнего бойца по цели: его дальность + «радиус тела» цели (боссы крупнее). */
export const reach = (u: Unit, target: Unit): number => u.range + target.body;

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

  const applyEffect = (u: Unit, e: Effect, target: Unit) => {
    // Q: исполнитель мог погибнуть посреди навыка (контратака цели) — остаток навыка не срабатывает.
    if (!target.alive || !u.alive) return;
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
        // Оглушение сбивает каст; навык не уходит в перезарядку.
        if (e.status.stun && target.casting) {
          const c = target.casting.skill;
          target.casting = null;
          emit({ t, type: 'cast', unit: target.uid, skill: c.id, name: c.name, duration: 0, action: 'interrupt' });
        }
        return;
      }
      case 'energy':
        addEnergy(target, e.amount);
        emit({ t, type: 'energy', unit: target.uid, energy: target.energy });
        return;
      case 'dash': {
        // Встать вплотную к цели со стороны, откуда пришёл, и сражаться с ней.
        const d = dist(u, target) || 1;
        const r = cfg.movement.meleeRange * 0.8 + target.body;
        const to: [number, number] = [round2(target.x + ((u.x - target.x) / d) * r), round2(target.y + ((u.y - target.y) / d) * r)];
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

  /** Ближний боец выбирает, с кем сражаться: первая цель обычной атаки. */
  const pickEngage = (u: Unit) => {
    if (u.engage?.alive) return;
    const targets = selectTargets(u, u.basic.target, allies(u), enemies(u), rng, cfg);
    setEngage(u, targets.find((x) => x.side !== u.side) ?? null);
  };

  /**
   * Не может дойти до цели дольше retargetSeconds — берёт ближайшего живого врага
   * (кроме недостижимой цели; если других нет — продолжает идти к ней).
   */
  const checkStuck = (u: Unit) => {
    const target = u.engage;
    if (!target?.alive) return;
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

  const planMove = (u: Unit) => {
    const target = u.engage;
    if (!target || u.moving || u.casting || dist(u, target) <= reach(u, target)) return;
    // Цель уже бежит ко мне — жду на месте, иначе бойцы разминутся.
    if (target.moving && target.engage === u) return;
    // Два ближних бойца нацелены друг на друга — оба идут навстречу и встречаются посередине
    // (с учётом скорости), чтобы ни одна сторона не получала преимущества от порядка обработки.
    if (target.engage === u && target.range !== Infinity) {
      const d = dist(u, target);
      const travel = d - Math.min(reach(u, target), reach(target, u)) * 0.9;
      const share = u.moveSpeed / (u.moveSpeed + target.moveSpeed);
      const dx = (target.x - u.x) / d;
      const dy = (target.y - u.y) / d;
      startMove(u, u.x + dx * travel * share, u.y + dy * travel * share);
      startMove(target, target.x - dx * travel * (1 - share), target.y - dy * travel * (1 - share));
      return;
    }
    const ax = target.moving ? target.moving.toX : target.x;
    const ay = target.moving ? target.moving.toY : target.y;
    // Несколько бойцов у одной цели встают веером со своей стороны (A — слева, B — справа),
    // место в веере закреплено за бойцом по слоту — не пересекаются и не перебегают.
    // Веер сжат по вертикали (crowdSquash): толпа у цели плотная, все точки остаются в досягаемости.
    const crowd = allies(u)
      .filter((o) => o.alive && o.engage === target && o.range !== Infinity)
      .sort((x, y) => x.slot - y.slot)
      .indexOf(u);
    const angles = cfg.movement.stackAngles;
    const ang = ((angles[Math.max(0, crowd) % angles.length] ?? 0) * Math.PI) / 180;
    const dx = u.side === 'A' ? -1 : 1;
    const dy = 0;
    const r = reach(u, target) * 0.9;
    const toX = round2(ax + (dx * Math.cos(ang) - dy * Math.sin(ang)) * r);
    const toY = round2(ay + (dx * Math.sin(ang) + dy * Math.cos(ang)) * r * (cfg.movement.crowdSquash ?? 1));
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
    !u.moving && (skill.range === 'ranged' || (!!u.engage?.alive && dist(u, u.engage) <= reach(u, u.engage) + 0.5));

  /** true — юнит походил; false — не может сейчас (бежит или не дошёл), ждёт с полной шкалой. */
  const act = (u: Unit): boolean => {
    const useUlt = !!u.ult && u.energy >= cfg.energy.max && skillReady(u, u.ult);
    // Готовый навык дальнего действия можно применить и не дойдя до цели.
    const hasActive = !u.moving && u.actives.some((s) => (u.readyAt[s.id] ?? 0) <= t + 1e-9 && skillReady(u, s));
    if (!useUlt && !hasActive && !skillReady(u, u.basic)) return false;

    emit({ t, type: 'turn', unit: u.uid });
    trigger(u, 'turnStart');

    // Статусы носителя: урон за ход и оглушение.
    for (const s of [...u.statuses]) {
      if (s.def.dot && u.alive) applyDamage(null, s.source, u, Math.max(1, Math.floor(s.sourceAtk * s.def.dot.k)), true);
    }
    if (!u.alive) return true;
    const stunned = u.statuses.some((s) => s.def.stun);
    if (stunned) emit({ t, type: 'skip', unit: u.uid, reason: 'stun' });
    else if (!useUlt && tryActive(u)) {
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
    tickStatuses(u);
    return true;
  };

  /** Цели активного навыка: ближний бьёт цель сражения (если дошёл), остальные — по селектору. Пусто — навык сейчас бесполезен. */
  const activeTargets = (u: Unit, skill: SkillDef): Unit[] => {
    if (skill.range === 'melee') {
      const e = u.engage;
      if (!e?.alive || dist(u, e) > reach(u, e) + 0.5) return [];
      // Одиночный удар — по цели сражения; удар по площади (pick all, count > 1) — по селектору, когда дошёл.
      const aoe = skill.target.pick === 'all' || skill.target.count > 1;
      return aoe ? selectTargets(u, skill.target, allies(u), enemies(u), rng, cfg) : [e];
    }
    return selectTargets(u, skill.target, allies(u), enemies(u), rng, cfg);
  };

  const cooldownOf = (skill: SkillDef) => skill.cooldown ?? cfg.skills?.defaultCooldown ?? 8;

  const fireActive = (u: Unit, skill: SkillDef, targets: Unit[]) => {
    const cd = cooldownOf(skill);
    u.readyAt[skill.id] = round2(t + cd);
    report[u.uid].skills++;
    addEnergy(u, cfg.energy.perBasicAction);
    const kind = skill.effects.some((e) => e.type === 'heal') ? 'heal' : skill.range === 'melee' ? 'melee' : 'ranged';
    emit({ t, type: 'attack', unit: u.uid, skill: skill.id, targets: targets.map((x) => x.uid), kind, energy: u.energy, name: skill.name, cooldown: cd });
    useSkill(u, skill, targets);
  };

  /** Готовый активный навык с наибольшим приоритетом: применяет или начинает каст. false — готовых нет. */
  const tryActive = (u: Unit): boolean => {
    for (const skill of u.actives) {
      if ((u.readyAt[skill.id] ?? 0) > t + 1e-9) continue;
      const targets = activeTargets(u, skill);
      if (targets.length === 0) continue;
      if (skill.castTime > 0) {
        u.casting = { skill, until: round2(t + skill.castTime) };
        emit({ t, type: 'cast', unit: u.uid, skill: skill.id, name: skill.name, duration: skill.castTime, action: 'start' });
      } else fireActive(u, skill, targets);
      return true;
    }
    return false;
  };

  /** Каст закончился: цели выбираются в конце (кто-то мог умереть). Целей нет — каст пропал, перезарядка не идёт. */
  const finishCast = (u: Unit) => {
    const c = u.casting;
    if (!c || t + 1e-9 < c.until) return;
    u.casting = null;
    u.gauge = 0;
    const targets = activeTargets(u, c.skill);
    if (targets.length === 0) {
      emit({ t, type: 'cast', unit: u.uid, skill: c.skill.id, name: c.skill.name, duration: 0, action: 'interrupt' });
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
