import { resolveBehavior } from './behavior';
import { COMBAT } from './config';
import { defenseElement, elementMult, skillElement } from './elements';
import { calcDamage, calcHeal } from './formulas';
import { Rng } from './rng';
import { dist, inRow, selectTargets } from './targeting';
import type {
  ActiveStatus,
  BattleEvent,
  BattleInput,
  BattleResult,
  CombatConfig,
  Content,
  Effect,
  Side,
  SkillDef,
  Squad,
  StatMod,
  PhaseActionDef,
  Unit,
  UnitDef,
  UnitReport,
  UnitSnapshot,

} from './types';

export interface BattleOptions {
  combat?: CombatConfig;
  /** false — не копить лог (для массовых прогонов симулятора). */
  log?: boolean;
  /**
   * false — бой «как до профилей поведения» (docs/design/battle-behavior.md): без правил профилей, провокации, связи,
   * фаз боссов и ярости; от профиля остаётся только «ассасин остаётся в тылу». Для сравнения баланса (sim --behavior off).
   */
  behavior?: boolean;
  /**
   * Ульта вручную (docs/design/battle-decisions.md §1): ульты стороны A срабатывают только по вводу inputs. Нет — из
   * combat.player, иначе авто (как всегда: idle, офлайн, «Пропустить бой», скрипты баланса).
   */
  manualUlt?: boolean;
  /** Вводы игрока (ульта героя, смена режима); вместе с seed задают бой. */
  inputs?: BattleInput[];
}

class BattleEnded extends Error {}

/** Круг удара мага: центр и радиус (единицы поля). */
type Area = { x: number; y: number; r: number };

/** Живой свиты фаз босса на сторону — не больше (иначе куча). */
const MAX_SUMMONS = 4;

/** Позиция слота на поле: сторона A из конфига, B — зеркально по ширине поля. */
export function slotPosition(side: Side, slot: number, cfg: CombatConfig = COMBAT): { x: number; y: number } {
  const [x, y] = cfg.field.slotsA[slot];
  return side === 'A' ? { x, y } : { x: cfg.field.width - x, y };
}

export function createUnits(squad: Squad, side: Side, content: Content, cfg: CombatConfig = COMBAT, behaviorOn = true): Unit[] {
  const units: Unit[] = [];
  squad.forEach((entry, slot) => {
    if (!entry) return;
    const def = typeof entry === 'string' ? content.units[entry] : entry;
    if (!def) throw new Error(`Неизвестный юнит: ${String(entry)}`);
    units.push(makeUnit(def, side, slot, `${side}${slot}`, content, cfg, behaviorOn));
  });
  return units;
}

/** Юнит боя из описания: слот задаёт место на поле и ряд, uid — имя в логе (у призванных свои, B5, B6…). */
export function makeUnit(def: UnitDef, side: Side, slot: number, uid: string, content: Content, cfg: CombatConfig = COMBAT, behaviorOn = true): Unit {
  const unitId = def.id;
  const skill = (id: string) => {
    const s = content.skills[id];
    if (!s) throw new Error(`Юнит ${unitId}: неизвестный навык ${id}`);
    return s;
  };
  const basic = skill(def.skills.basic);
  const { x, y } = slotPosition(side, slot, cfg);
  const bh = resolveBehavior(def, basic.range !== 'melee', cfg, behaviorOn);
  return {
    uid,
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
    behavior: bh.id,
    bh: bh.profile,
  };
}

/**
 * Ульта бойца для ручного режима: skills.ult (на полной энергии), у героя без неё — активный навык с самой долгой
 * перезарядкой не короче combat.json manual.minCooldown (равенство — открытый позже). null — ульты нет.
 */
export function ultSkillOf(def: UnitDef, skills: Record<string, SkillDef>, cfg: CombatConfig = COMBAT): SkillDef | null {
  if (def.skills.ult) return skills[def.skills.ult] ?? null;
  const min = cfg.manual?.minCooldown ?? 10;
  let best: SkillDef | null = null;
  let bestCd = -1;
  for (const id of def.skills.actives) {
    const s = skills[id];
    if (!s) continue;
    const cd = s.cooldown ?? cfg.skills?.defaultCooldown ?? 8;
    if (cd >= min && cd >= bestCd) {
      best = s;
      bestCd = cd;
    }
  }
  return best;
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

  const on = opts.behavior ?? true;
  const a = createUnits(squadA, 'A', content, cfg, on);
  const b = createUnits(squadB, 'B', content, cfg, on);
  const all = [...a, ...b];

  // ---------- ульта вручную (docs/design/battle-decisions.md §1) ----------
  /** Ульта героев стороны A (ручной режим держит её до ввода). */
  const ultOf = new Map<Unit, SkillDef>();
  for (const u of a) {
    const s = ultSkillOf(u.def, content.skills, cfg);
    if (s) ultOf.set(u, s);
  }
  let manual = opts.manualUlt ?? cfg.player?.manualUlt ?? false;
  const inputs = (opts.inputs ?? cfg.player?.inputs ?? []).map((x, i) => ({ x, i })).sort((p, q) => p.x.t - q.x.t || p.i - q.i).map((p) => p.x);
  let inputAt = 0;
  /** Взведённые ульты (касание было, ждут возможности) и о чьей готовности уже сказали событием ready. */
  const armed = new Set<Unit>();
  const readyShown = new Set<Unit>();
  const manualOn = (u: Unit) => manual && u.side === 'A' && ultOf.has(u);

  const snapshots = all.map((u) => ({
    uid: u.uid,
    side: u.side,
    slot: u.slot,
    unitId: u.unitId,
    maxHp: u.maxHp,
    x: u.x,
    y: u.y,
  }));
  const log: BattleEvent[] = [];
  const report: Record<string, UnitReport> = {};
  for (const u of all) {
    report[u.uid] = {
      uid: u.uid,
      unitId: u.unitId,
      damageDealt: 0,
      healingDone: 0,
      shieldGiven: 0,
      damageTaken: 0,
      ults: 0,
      skills: 0,
      alive: true,
    };
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
  /** Стихии — только с профилями (снимки боёв behavior: false не меняются). */
  const elements = on ? cfg.elements : undefined;

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

  const applyDamage = (src: Unit | null, srcUid: string, target: Unit, dmg: number, dot = false, redirect?: string, elem?: 'weak' | 'resist') => {
    // Трус на бегу подставляет спину: урон больше (бой не затягивается от побега).
    if (fleeing.size > 0 && redirect === undefined && fleeing.has(target)) dmg = Math.round(dmg * (1 + target.bh.coward!.damageTaken));
    // Связь (Самопожертвование): доля урона по союзнику уходит защитнику; перенаправленный урон дальше не перенаправляется.
    if (links.size > 0 && redirect === undefined) {
      const l = links.get(target);
      if (l && linkHolds(target, l)) {
        const part = Math.floor(dmg * l.pct);
        if (part > 0) {
          dmg -= part;
          applyDamage(src, srcUid, l.guard, part, dot, target.uid);
          if (!target.alive) return;
        }
      }
    }
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    const hpLoss = Math.min(target.hp, dmg - absorbed);
    target.hp -= hpLoss;
    if (report[srcUid]) report[srcUid].damageDealt += absorbed + hpLoss;
    report[target.uid].damageTaken += absorbed + hpLoss;
    // Энергия за полученный удар — только за урон по ОЗ (как в AFK: энергия от потерянного здоровья). Удар, целиком
    // принятый щитом, ульту не заряжает — иначе щит-ульта («Песчаная стена») перезаряжала сама себя (LT-01).
    if (target.hp > 0 && !dot && hpLoss > 0) addEnergy(target, cfg.energy.perHitTaken);
    emit({
      t,
      type: 'damage',
      source: srcUid,
      target: target.uid,
      amount: dmg,
      absorbed,
      hp: target.hp,
      shield: target.shield,
      energy: target.energy,
      ...(dot ? { dot } : {}),
      ...(redirect ? { redirect } : {}),
      ...(elem ? { elem } : {}),
    });
    // Порог фазы босса: фаза встаёт в очередь и срабатывает в начале следующего тика (не посреди чужого навыка).
    if (target.hp > 0 && hpLoss > 0 && target.def.phases && on) checkPhases(target);
    if (target.hp <= 0) kill(target, src);
    else if (!dot) trigger(target, 'hit');
  };

  const applyEffect = (u: Unit, e: Effect, target: Unit, skill?: SkillDef) => {
    // Q: исполнитель мог погибнуть посреди навыка (контратака цели) — остаток навыка не срабатывает.
    if (!target.alive || !u.alive) return;
    // «Сила навыков» редкости карточки (золотой/красный) — множитель урона/лечения/щита навыков, кроме обычной атаки.
    const sp = skill && skill.id !== u.def.skills.basic ? (u.def.skillPower ?? 1) : 1;
    switch (e.type) {
      case 'damage': {
        let dmg = rage(calcDamage(stat(u, 'atk'), e.k * sp, stat(target, 'def'), rng, cfg));
        // Стихии (с профилями): множитель по стихии навыка и защите цели.
        const m = elements && skill ? elementMult(elements, skillElement(skill), defenseElement(target.def)) : 1;
        if (m !== 1) dmg = Math.max(1, Math.round(dmg * m));
        applyDamage(u, u.uid, target, dmg, false, undefined, m > 1 ? 'weak' : m < 1 ? 'resist' : undefined);
        return;
      }
      case 'heal': {
        const amount = Math.min(Math.round(mend(calcHeal(stat(u, 'atk'), e.k * sp)) * healRepeat(u, target)), target.maxHp - target.hp);
        target.hp += amount;
        report[u.uid].healingDone += amount;
        emit({
          t,
          type: 'heal',
          source: u.uid,
          target: target.uid,
          amount,
          hp: target.hp,
        });
        return;
      }
      case 'shield': {
        // LT-01: щиты складываются, но не выше потолка (доля макс. ОЗ носителя, combat.json shieldCapPctMaxHp) —
        // иначе щит, заряжаемый от получаемого урона, растёт быстрее урона отряда и бой уходит в «время вышло».
        const cap = Math.floor(target.maxHp * (cfg.shieldCapPctMaxHp ?? 0.5));
        // В ярости (combat.json enrage) щиты слабеют так же, как лечение.
        const want = Math.round(mend(Math.floor(target.maxHp * e.pctMaxHp * sp)) * healRepeat(u, target));
        // Живучесть врагов (combat.json sustain): щит от них не складывается — только догоняет прежний до своей величины.
        const amount = Math.max(0, noStack(u) ? Math.min(want, cap) - target.shield : Math.min(want, cap - target.shield));
        target.shield += amount;
        report[u.uid].shieldGiven += amount;
        emit({
          t,
          type: 'buff',
          source: u.uid,
          target: target.uid,
          kind: 'shield',
          amount,
          shield: target.shield,
        });
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
        emit({
          t,
          type: 'status',
          source: u.uid,
          target: target.uid,
          status: e.status.id,
          name: e.status.name,
          turns: e.status.turns,
          // Аура продлевает статус каждый ход барда — продление сцена не рисует заново.
          action: auraNow && prev ? 'refresh' : 'apply',
          seconds,
          ...(on && e.status.taunt ? { taunt: true } : {}),
        });
        // Развеивание контрмага сбивает каст; сбитый навык уходит в перезарядку (иначе враг тут же начинает его снова).
        if (on && e.status.interrupt && target.casting) {
          const c = target.casting.skill;
          target.casting = null;
          target.readyAt[c.id] = round2(t + cooldownOf(c));
          emit({
            t,
            type: 'cast',
            unit: target.uid,
            skill: c.id,
            name: c.name,
            duration: 0,
            action: 'interrupt',
            reason: 'dispel',
          });
        }
        if (e.status.stun) {
          // Оглушение сбивает каст; навык не уходит в перезарядку.
          if (target.casting) {
            const c = target.casting.skill;
            target.casting = null;
            emit({
              t,
              type: 'cast',
              unit: target.uid,
              skill: c.id,
              name: c.name,
              duration: 0,
              action: 'interrupt',
              reason: 'stun',
            });
          }
          // Оглушённый останавливается там, где стоит (T2-06).
          if (target.moving) {
            target.moving = null;
            const at: [number, number] = [round2(target.x), round2(target.y)];
            emit({
              t,
              type: 'move',
              unit: target.uid,
              from: at,
              to: at,
              duration: 0,
              kind: 'walk',
            });
          }
        }
        return;
      }
      case 'link': {
        // Без профилей (behavior: false) связи нет — как до неё.
        if (!on || target === u) return;
        // Одна связь у защитника: новая рвёт прежнюю.
        for (const [ward, l] of links) if (l.guard === u) breakLink(ward, l);
        const prev = links.get(target);
        if (prev) breakLink(target, prev);
        const seconds = round2(e.turns * turnSeconds);
        links.set(target, {
          guard: u,
          pct: e.pct,
          until: round2(t + seconds),
          breakAt: e.breakAtHpPct,
        });
        emit({
          t,
          type: 'link',
          unit: u.uid,
          target: target.uid,
          action: 'apply',
          pct: e.pct,
          seconds,
        });
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
          if (prev !== target && !u.bh.dive?.stay)
            returns.set(u, {
              at: round2(t + cfg.movement.dashSeconds + diveReturnSeconds),
              x: u.x,
              y: u.y,
              prev,
            });
          else dived.add(u);
        }
        emit({
          t,
          type: 'move',
          unit: u.uid,
          from: [round2(u.x), round2(u.y)],
          to,
          duration: cfg.movement.dashSeconds,
          kind: 'dash',
        });
        u.x = to[0];
        u.y = to[1];
        u.moving = null;
        if (u.range !== Infinity) setEngage(u, target);
        return;
      }
    }
  };

  /** Применяет навык: цели выбираются заново на каждый удар при pick=random. */
  const useSkill = (u: Unit, skill: SkillDef, preset?: Unit[], area?: Area): Unit[] => {
    const hit: Unit[] = [];
    for (let i = 0; i < skill.hits && u.alive; i++) {
      const targets = preset && i === 0 ? preset : area ? areaTargets(u, skill, area) : pickFor(u, skill);
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
  const flying: {
    land: number;
    seq: number;
    u: Unit;
    skill: SkillDef;
    targets: Unit[];
  }[] = [];
  let flySeq = 0;
  const projectileSeconds = cfg.projectileSeconds ?? 0;

  /** Применить атаку сразу или отправить снаряд (дальняя атака по врагу, не рывок). */
  const launch = (u: Unit, skill: SkillDef, targets: Unit[], area?: Area) => {
    // Удар по кругу падает сразу в конце каста (круг на земле уже показал, куда).
    // Сбивающий каст навык (Развеивание) — тоже сразу: иначе каст врага успевает кончиться, пока летит снаряд.
    const projectile = !area && !(on && interrupts(skill)) && projectileSeconds > 0 && skill.range === 'ranged' && skill.target.side === 'enemy' && !skill.effects.some((e) => e.type === 'dash');
    if (!projectile) {
      useSkill(u, skill, targets, area);
      return;
    }
    flying.push({
      land: round2(t + projectileSeconds),
      seq: flySeq++,
      u,
      skill,
      targets,
    });
  };

  const landProjectiles = () => {
    if (flying.length === 0 || !flying.some((f) => f.land <= t + 1e-9)) return;
    const due = flying.filter((f) => f.land <= t + 1e-9).sort((x, y) => x.land - y.land || x.seq - y.seq);
    if (due.length === 0) return;
    for (const f of due) flying.splice(flying.indexOf(f), 1);
    for (const f of due) {
      if (!f.u.alive) continue;
      useSkill(
        f.u,
        f.skill,
        f.targets.filter((x) => x.alive),
      );
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
      // Аура (с профилями): только союзники в круге вокруг исполнителя.
      const aura = on && p.aura ? p.aura.radius : 0;
      if (aura > 0) targets = targets.filter((x) => x === u || dist(u, x) <= aura + x.body);
      if (targets.length === 0) continue;
      passiveDepth++;
      if (aura > 0) auraNow = true;
      try {
        emit({ t, type: 'passive', unit: u.uid, skill: p.id, name: p.name });
        useSkill(u, p, targets);
      } finally {
        passiveDepth--;
        auraNow = false;
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
    // Провокация: ближний под статусом идёт к стражу (лимит бойцов на цель не действует).
    const tau = tauntOf(u);
    if (tau) {
      if (u.engage !== tau) setEngage(u, tau);
      return;
    }
    // Страж держит перехваченного, пока тот жив и лезет к нашему тылу (или бьётся со стражем).
    const ic = intercepting.get(u);
    if (ic) {
      if (ic.alive && (ic.engage === u || threatens(ic, u.side))) {
        if (u.engage !== ic) setEngage(u, ic);
        return;
      }
      intercepting.delete(u);
    }
    // Защитник (крестоносец) идёт к тому, кто бьёт союзника под его связью (без связи — самого раненого союзника).
    if (u.bh.protect && (tickNo + u.slot) % 3 === 0) {
      const ward = wardOf(u);
      let foe: Unit | null = null;
      if (ward) for (const x of enemies(u)) if (x.alive && x.range !== Infinity && x.engage === ward && (!foe || dist(x, ward) < dist(foe, ward))) foe = x;
      if (foe && foe !== u.engage && meleeOn(foe, u) < maxPerTarget) {
        setEngage(u, foe);
        return;
      }
    }
    const think = (tickNo + u.slot) % 3 === 0;
    // Торговец добивает: враг рядом почти мёртв, а текущая цель ещё крепкая.
    if (u.bh.execute && think) {
      const x = executeTarget(u);
      if (x && x !== u.engage) {
        setEngage(u, x);
        return;
      }
    }
    // Стая: новую цель (в начале боя, после убийства) — ту, что уже бьют сородичи.
    if (u.bh.pack && !u.engage?.alive) {
      const x = packTarget(u);
      if (x && x !== u.engage) {
        setEngage(u, x);
        return;
      }
    }
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
    // Вор обходит щит: сначала — враг не с ролью avoidRole (босс — не щит, его не обходят), с которым ещё никто из наших ближних не сражается
    // (не в общую свалку); такого нет — как все.
    const avoid = u.bh.flank?.avoidRole;
    if (avoid) {
      const free = cands.find((x) => (x.def.role !== avoid || x.def.kind === 'boss') && meleeOn(x, u) === 0);
      if (free) {
        setEngage(u, free);
        return;
      }
    }
    // Таран: из свободных целей — в самую гущу (больше врагов рядом).
    if (u.bh.cluster) {
      let top: Unit | null = null;
      let topN = -1;
      for (const x of cands) {
        if (meleeOn(x, u) >= maxPerTarget) continue;
        const n = neighbours(x, u.bh.cluster.radius);
        if (n > topN) {
          topN = n;
          top = x;
        }
      }
      if (top) {
        setEngage(u, top);
        return;
      }
    }
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
      let prev = r.prev?.alive && !inRear(r.prev) ? r.prev : null;
      let near = prev ? findSpot(u, standX(prev), standY(prev), u.side === 'A' ? -1 : 1, 0, reach(u, prev) * 0.9, prev, 0) : null;
      // С профилями: место у прежнего противника вышло за его спиной (в нашем тылу) — назад на место прыжка, не глубже
      // в чужой тыл (QA: Мастеринг не «стоит на Маге»).
      if (on && prev && near && (u.side === 'B' ? near.x < standX(prev) : near.x > standX(prev))) {
        prev = null;
        near = null;
      }
      const spot = near
        ? near
        : clearance(u, null, r.x, r.y) >= minSep
          ? { x: round2(r.x), y: round2(r.y) }
          : findSpot(u, r.x, r.y, u.side === 'A' ? -1 : 1, 0, minSep, null, 0);
      u.moving = null;
      emit({
        t,
        type: 'move',
        unit: u.uid,
        from: [round2(u.x), round2(u.y)],
        to: [spot.x, spot.y],
        duration: cfg.movement.dashSeconds,
        kind: 'dash',
      });
      // Рывок назад виден dashSeconds — ближний удар только после приземления (иначе сцена рисует удар издалека).
      if (on) landsAt.set(u, round2(t + cfg.movement.dashSeconds));
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
  const findSpot = (u: Unit, ax: number, ay: number, dirX: number, dirY: number, r: number, target: Unit | null, prefer: number, sep = minSep) => {
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
      if (gap >= sep) return c;
      if (gap > fallbackGap) {
        fallbackGap = gap;
        fallback = c;
      }
    }
    return (
      fallback ?? {
        x: round2(clampX(cands[0].x)),
        y: round2(clampY(cands[0].y)),
      }
    );
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
      emit({
        t,
        type: 'move',
        unit: u.uid,
        from: at,
        to: at,
        duration: 0,
        kind: 'walk',
      });
    }
  };

  const planStep = (u: Unit, target: Unit) => {
    plans.delete(u);
    if (dist(u, target) <= reach(u, target)) {
      // Проверка наложения — раз в 3 тика (0.3 с): незаметно глазу, дешевле для массовых прогонов.
      if (tickNo % 3 === 0) separate(u, target);
      return;
    }
    // С профилями: цель прыгнула в тыл и через миг прыгнет назад (не «ассасин») — не гонюсь, жду на месте.
    if (on && returns.has(target)) return;
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
    let dirX = u.side === 'A' ? -1 : 1;
    let dirY = 0;
    if (u.bh.flank) {
      // Вор встаёт сбоку от цели — со своей стороны (сверху/снизу, откуда подходит: меньше беготни); если там тесно
      // (ближе minSeparation к другим), а с другой стороны свободно — с другой.
      const ang = (u.bh.flank.angle * Math.PI) / 180;
      dirX *= Math.cos(ang);
      const r = reach(u, target) * 0.9;
      const sq = cfg.movement.crowdSquash ?? 1;
      const gap = (s: number) => {
        const x = ax + dirX * r;
        const y = ay + s * Math.sin(ang) * r * sq;
        return inBounds(x, y) ? clearance(u, target, x, y) : -Infinity;
      };
      const mine = u.y <= ay ? -1 : 1;
      dirY = (gap(mine) < minSep && gap(-mine) >= minSep ? -mine : mine) * Math.sin(ang);
    }
    const spot = findSpot(u, ax, ay, dirX, dirY, reach(u, target) * 0.9, target, crowd);
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

  const startMove = (u: Unit, x: number, y: number, reason?: 'kite' | 'follow' | 'flee') => {
    const toX = round2(clampX(x));
    const toY = round2(clampY(y));
    const len = Math.hypot(toX - u.x, toY - u.y);
    if (len < 1) return;
    dived.delete(u);
    u.moving = { toX, toY };
    emit({
      t,
      type: 'move',
      unit: u.uid,
      from: [round2(u.x), round2(u.y)],
      to: [toX, toY],
      duration: round2(len / u.moveSpeed),
      kind: 'walk',
      ...(reason ? { reason } : {}),
    });
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

  // ---------- профили поведения (docs/design/battle-behavior.md) ----------
  // Правила — чистые функции состояния боя: выборы сортировкой с «равенство — меньший слот», без rng; счётчики — в Map
  // внутри боя. Решения движения — раз в 3 тика со сдвигом по слоту (разные бойцы думают в разные тики).

  const byUid = new Map<string, Unit>();
  for (const u of all) byUid.set(u.uid, u);
  const hasDash = (s: SkillDef) => s.effects.some((e) => e.type === 'dash');
  /** К своему краю поля по x: A — влево, B — вправо. */
  const backDir = (u: Unit) => (u.side === 'A' ? -1 : 1);

  /** Провокация: живой враг, наложивший статус taunt, — носитель бьёт его. */
  function tauntOf(u: Unit): Unit | null {
    if (!on || u.statuses.length === 0) return null;
    for (const s of u.statuses) {
      if (!s.def.taunt) continue;
      const src = byUid.get(s.source);
      if (src?.alive && src.side !== u.side) return src;
    }
    return null;
  }

  /** Фокус стрелка: самый слабый враг; прежняя цель держится, пока новая не слабее на долю margin. */
  const focusOn = new Map<Unit, Unit>();
  const focusTarget = (u: Unit): Unit | null => {
    const f = u.bh.focus!;
    const score = f.pick === 'lowestHpPct' ? (x: Unit) => x.hp / x.maxHp : (x: Unit) => x.hp;
    let best: Unit | null = null;
    for (const x of enemies(u)) {
      if (!x.alive) continue;
      if (!best || score(x) < score(best) || (score(x) === score(best) && x.slot < best.slot)) best = x;
    }
    if (!best) return null;
    const cur = focusOn.get(u);
    if (cur && cur.alive && cur !== best && score(best) >= score(cur) * (1 - f.margin)) return cur;
    focusOn.set(u, best);
    return best;
  };

  /** Место цели в приоритете прыжка ассасина (меньше — важнее). */
  const diveRank = (x: Unit, priority: readonly string[]) => {
    for (let i = 0; i < priority.length; i++) {
      const k = priority[i];
      if (k === 'ranged' ? x.range === Infinity : x.def.role === k) return i;
    }
    return priority.length;
  };

  /** Цели навыка с учётом профиля: провокация → прыжок ассасина к лекарю/стрелку → фокус стрелка → селектор навыка. */
  function pickFor(u: Unit, skill: SkillDef): Unit[] {
    const tg = skill.target;
    if (on && tg.side === 'enemy' && tg.pick !== 'all' && tg.pick !== 'self') {
      const tau = tauntOf(u);
      if (tau) {
        if (tg.count <= 1) return [tau];
        return [tau, ...selectTargets(u, tg, allies(u), enemies(u), rng, cfg).filter((x) => x !== tau)].slice(0, tg.count);
      }
      // Ульта героя, пока враг заряжает удар, — в заряжающего (сбить).
      if (chargers.length > 0 && ultOf.get(u) === skill) {
        const ch = chargingFoe(u);
        if (ch) {
          if (tg.count <= 1) return [ch];
          return [ch, ...selectTargets(u, tg, allies(u), enemies(u), rng, cfg).filter((x) => x !== ch)].slice(0, tg.count);
        }
      }
      const dive = u.bh.dive;
      if (dive && dive.priority.length > 0 && tg.pick !== 'random' && hasDash(skill)) {
        let best: Unit | null = null;
        let rank = Infinity;
        for (const x of selectTargets(u, { ...tg, count: 99 }, allies(u), enemies(u), rng, cfg)) {
          const r = diveRank(x, dive.priority);
          if (r < rank) {
            rank = r;
            best = x;
          }
        }
        if (best) return [best];
      }
      // Контрмаг: навык, сбивающий каст, — во врага, который сейчас кастует.
      if (u.bh.counter && tg.count === 1 && interrupts(skill)) {
        const x = casterToStop(u, skill);
        if (x) return [x];
      }
      // Таран: рывок — в самую гущу.
      if (u.bh.cluster && tg.pick === 'nearest' && hasDash(skill)) {
        let top: Unit | null = null;
        let topN = -1;
        for (const x of selectTargets(u, { ...tg, count: 99 }, allies(u), enemies(u), rng, cfg)) {
          const n = neighbours(x, u.bh.cluster.radius);
          if (n > topN) {
            topN = n;
            top = x;
          }
        }
        if (top) return [top];
      }
      if (u.bh.focus && tg.pick === 'nearest' && tg.count === 1 && !hasDash(skill)) {
        const x = focusTarget(u);
        if (x) return [x];
      }
    }
    return selectTargets(u, tg, allies(u), enemies(u), rng, cfg);
  }

  /** Паника лекаря: союзник ниже panicPct ОЗ — лечащие активные навыки раньше остальных. */
  function panicking(u: Unit): boolean {
    const pct = u.bh.panicPct ?? 0;
    for (const o of allies(u)) if (o.alive && o.hp < o.maxHp * pct) return true;
    return false;
  }
  const healOrder = new Map<Unit, SkillDef[]>();
  function healFirst(u: Unit): SkillDef[] {
    let order = healOrder.get(u);
    if (!order) {
      const heals = u.actives.filter((s) => s.effects.some((e) => e.type === 'heal'));
      order = [...heals, ...u.actives.filter((s) => !heals.includes(s))];
      healOrder.set(u, order);
    }
    return order;
  }

  /** Где юнит стоял в начале боя (слот). */
  const homes = new Map<Unit, { x: number; y: number }>();
  for (const u of all) homes.set(u, { x: u.x, y: u.y });

  /** Отходы стрелка: сколько было и когда можно снова. */
  const kites = new Map<Unit, { n: number; readyAt: number }>();
  /** Отход (кайт): ближний враг подошёл к дальнему бойцу, который его цель, — отойти на step к своему краю. */
  const tryKite = (u: Unit): boolean => {
    const k = u.bh.kite!;
    const st = kites.get(u) ?? { n: 0, readyAt: 0 };
    if (st.n >= k.max || t + 1e-9 < st.readyAt || tauntOf(u)) return false;
    let threat: Unit | null = null;
    let td = Infinity;
    for (const x of enemies(u)) {
      if (!x.alive || x.range === Infinity || x.engage !== u || stunned(x)) continue;
      const d = dist(x, u);
      if (d <= reach(x, u) + k.trigger && d < td) {
        td = d;
        threat = x;
      }
    }
    if (!threat) return false;
    const d = td || 1;
    let dx = (u.x - threat.x) / d + backDir(u);
    // По высоте — вполовину: стрелок пятится к своему краю, а не убегает вверх/вниз из строя.
    let dy = ((u.y - threat.y) / d) * 0.5;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n;
    dy /= n;
    // Отходит на свободное место — втрое дальше обычного зазора от других фигур (не к соседу по тылу, не в новую кучу).
    const kiteSep = minSep * 3;
    const spot = findSpot(u, u.x, u.y, dx, dy, k.step, null, 0, kiteSep);
    if (clearance(u, null, spot.x, spot.y) < kiteSep) return false;
    // Упёрся в край или угол — не пятится на месте.
    if (Math.hypot(spot.x - threat.x, spot.y - threat.y) - d < k.minGain) return false;
    u.moving = null;
    startMove(u, spot.x, spot.y, 'kite');
    if (!u.moving) return false;
    st.n++;
    st.readyAt = round2(t + k.cooldown);
    kites.set(u, st);
    return true;
  };

  /** Якорь лекаря: свой самый крепкий ближний (танк по роли, иначе наибольший maxHp; равенство — меньший слот). */
  const anchorOf = (u: Unit): Unit | null => {
    let best: Unit | null = null;
    for (const o of allies(u)) {
      if (o === u || !o.alive || o.range === Infinity) continue;
      if (!best) {
        best = o;
        continue;
      }
      const ot = o.def.role === 'tank';
      const bt = best.def.role === 'tank';
      if (ot !== bt) {
        if (ot) best = o;
        continue;
      }
      if (o.maxHp > best.maxHp || (o.maxHp === best.maxHp && o.slot < best.slot)) best = o;
    }
    return best;
  };

  /** Лекарь за танком: встать на followDist позади якоря (не дальше maxDrift вперёд от слота), если отстал больше followSlack. */
  const followAnchor = (u: Unit) => {
    // На лекаря идёт враг ближнего боя — не шагает к фронту навстречу (отход решает kite).
    for (const x of enemies(u)) if (x.alive && x.engage === u && x.range !== Infinity) return;
    const an = anchorOf(u);
    if (!an) return;
    const A = u.bh.anchor!;
    const home = homes.get(u)!;
    let x = standX(an) + backDir(u) * A.followDist;
    const y = home.y + (standY(an) - home.y) * A.yShare;
    // Вперёд (к врагу) от своего слота — не дальше maxDrift.
    x = u.side === 'A' ? Math.min(x, home.x + A.maxDrift) : Math.max(x, home.x - A.maxDrift);
    if (Math.hypot(x - u.x, y - u.y) <= A.followSlack) return;
    const spot = clearance(u, null, x, y) >= minSep ? { x: round2(clampX(x)), y: round2(clampY(y)) } : findSpot(u, x, y, backDir(u), 0, minSep, null, 0);
    if (Math.hypot(spot.x - u.x, spot.y - u.y) < A.followSlack / 2) return;
    startMove(u, spot.x, spot.y, 'follow');
  };

  /** Движение дальних бойцов с профилем: отход от ближнего, иначе — за якорем. */
  const planRanged = (u: Unit) => {
    if (!u.alive || u.casting || stunned(u)) return;
    if ((tickNo + u.slot) % 3 !== 0) return;
    if (u.bh.kite && tryKite(u)) return;
    // За танком встаёт лекарь заднего ряда; поставленный во фронт держит своё место (его туда поставил игрок).
    if (u.bh.anchor && !u.moving && !inRow(u, 'front', cfg)) followAnchor(u);
    if (u.bh.center && !u.moving && !fleeing.has(u)) followCenter(u);
  };
  const rangedMovers = on ? all.filter((u) => u.range === Infinity && (u.bh.kite || u.bh.anchor || u.bh.center)) : [];

  /** Связи крестоносца: союзник → защитник, доля, до какого времени, при какой доле ОЗ защитника рвётся. */
  const links = new Map<Unit, { guard: Unit; pct: number; until: number; breakAt: number }>();
  const breakLink = (ward: Unit, l: { guard: Unit }) => {
    links.delete(ward);
    emit({
      t,
      type: 'link',
      unit: l.guard.uid,
      target: ward.uid,
      action: 'break',
    });
  };
  /** Связь действует: оба живы, время не вышло, защитник выше порога. */
  const linkHolds = (ward: Unit, l: { guard: Unit; until: number; breakAt: number }) =>
    ward.alive && l.guard.alive && t + 1e-9 < l.until && l.guard.hp > l.guard.maxHp * l.breakAt;
  const expireLinks = () => {
    for (const [ward, l] of [...links]) if (!linkHolds(ward, l)) breakLink(ward, l);
  };
  /** Кого закрывает защитник: союзник под его связью, иначе самый раненый союзник (не он сам). */
  const wardOf = (u: Unit): Unit | null => {
    for (const [ward, l] of links) if (l.guard === u && ward.alive) return ward;
    let best: Unit | null = null;
    for (const o of allies(u)) if (o !== u && o.alive && o.hp < o.maxHp && (!best || o.hp / o.maxHp < best.hp / best.maxHp)) best = o;
    return best;
  };


  // ---------- шаги 4–5: маг, контрмаг, бард, стая, трус, таран, торговец (docs/design/battle-behavior.md) ----------

  /** Сколько живых бойцов стороны x (включая x) стоят не дальше radius от места x. */
  const neighbours = (x: Unit, radius: number) => {
    let n = 0;
    for (const o of allies(x)) if (o.alive && Math.hypot(standX(o) - standX(x), standY(o) - standY(x)) <= radius + o.body) n++;
    return n;
  };

  /**
   * Точка удара мага: центр — враг с наибольшим числом врагов в радиусе (по местам, куда они идут; равенство — ближе к
   * магу, затем меньший слот), круг ложится на середину скопления. Лучшее скопление меньше minCluster — null (как раньше).
   */
  const areaSpot = (u: Unit, radius: number, minCluster: number): Area | null => {
    let best: Unit | null = null;
    let bn = 0;
    let bd = Infinity;
    for (const c of enemies(u)) {
      if (!c.alive) continue;
      const n = neighbours(c, radius);
      const d = dist(u, c);
      if (n > bn || (n === bn && d < bd - 1e-9)) {
        best = c;
        bn = n;
        bd = d;
      }
    }
    if (!best || bn < minCluster) return null;
    const bx = standX(best);
    const by = standY(best);
    let sx = 0;
    let sy = 0;
    let k = 0;
    for (const o of enemies(u)) {
      if (!o.alive || Math.hypot(standX(o) - bx, standY(o) - by) > radius + o.body) continue;
      sx += standX(o);
      sy += standY(o);
      k++;
    }
    let x = sx / k;
    let y = sy / k;
    let m = 0;
    for (const o of enemies(u)) if (o.alive && Math.hypot(standX(o) - x, standY(o) - y) <= radius + o.body) m++;
    if (m < bn) {
      x = bx;
      y = by;
    }
    return { x: round2(x), y: round2(y), r: radius };
  };

  /** Цели удара по кругу — враги в круге сейчас (вышедший не задет); pick random — случайный из них на каждый удар. */
  const areaTargets = (u: Unit, skill: SkillDef, a: Area): Unit[] => {
    const inside: Unit[] = [];
    for (const o of enemies(u)) if (o.alive && Math.hypot(o.x - a.x, o.y - a.y) <= a.r + o.body) inside.push(o);
    if (inside.length === 0 || skill.target.pick !== 'random') return inside;
    return selectTargets(u, { ...skill.target, row: 'any' }, allies(u), inside, rng, cfg);
  };

  /** Навык сбивает каст (статус с interrupt). */
  const interrupts = (s: SkillDef) => s.effects.some((e) => e.type === 'status' && !!e.status.interrupt);
  /** Идёт выбор целей в конце каста (цель должна кастовать сейчас), а не в начале (каст врага не кончится раньше нашего). */
  let castEnding = false;
  /** Кого сбить: враг, чей каст ещё идёт к нашему удару; босс раньше, затем чей каст кончится позже; равенство — меньший слот. */
  const casterToStop = (u: Unit, skill: SkillDef): Unit | null => {
    const need = castEnding ? t : t + skill.castTime;
    let best: Unit | null = null;
    for (const x of enemies(u)) {
      if (!x.alive || !x.casting || x.casting.until + 1e-9 < need) continue;
      if (!best) {
        best = x;
        continue;
      }
      const xb = x.def.kind === 'boss';
      const bb = best.def.kind === 'boss';
      if (xb !== bb ? xb : x.casting.until > best.casting!.until + 1e-9) best = x;
    }
    return best;
  };
  /** У врага есть навык с кастом (есть что сбивать). Кэш по юниту; фаза с новым навыком сбрасывает. */
  const castsOf = new Map<Unit, boolean>();
  const canCast = (x: Unit) => {
    let v = castsOf.get(x);
    if (v === undefined) {
      v = x.actives.some((s) => s.castTime > 0) || (!!x.ult && x.ult.castTime > 0);
      castsOf.set(x, v);
    }
    return v;
  };
  /** С какого времени контрмаг держит готовый навык-сбиватель. */
  const holdSince = new Map<Unit, number>();
  /** Держать навык-сбиватель: у врагов есть касты, но сейчас сбивать некого — ждать до hold секунд. */
  const holdInterrupt = (u: Unit, skill: SkillDef): boolean => {
    if (!interrupts(skill) || casterToStop(u, skill)) return false;
    let foesCast = false;
    for (const x of enemies(u))
      if (x.alive && canCast(x)) {
        foesCast = true;
        break;
      }
    if (!foesCast) return false;
    const since = holdSince.get(u);
    if (since === undefined) {
      holdSince.set(u, t);
      return u.bh.counter!.hold > 0;
    }
    return t + 1e-9 < since + u.bh.counter!.hold;
  };

  /** Аура: сейчас идёт пассивка-аура (продление статуса — refresh, не apply). */
  let auraNow = false;

  /** Бард в центре своих: середина живых союзников, сдвинутая к своему краю; не шагает навстречу ближнему врагу. */
  const followCenter = (u: Unit) => {
    for (const x of enemies(u)) if (x.alive && x.engage === u && x.range !== Infinity) return;
    const C = u.bh.center!;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const o of allies(u)) {
      if (o === u || !o.alive) continue;
      sx += standX(o);
      sy += standY(o);
      n++;
    }
    if (n === 0) return;
    const x = sx / n + backDir(u) * C.backOffset;
    const y = sy / n;
    if (Math.hypot(x - u.x, y - u.y) <= C.followSlack) return;
    const spot = clearance(u, null, x, y) >= minSep ? { x: round2(clampX(x)), y: round2(clampY(y)) } : findSpot(u, x, y, backDir(u), 0, minSep, null, 0);
    if (Math.hypot(spot.x - u.x, spot.y - u.y) < C.followSlack / 2) return;
    startMove(u, spot.x, spot.y, 'follow');
  };

  /** Торговец: почти мёртвый враг рядом (самый раненый по доле), если своя цель ещё выше половины ОЗ. */
  const executeTarget = (u: Unit): Unit | null => {
    const ex = u.bh.execute!;
    const cur = u.engage;
    if (cur?.alive && cur.hp < cur.maxHp * 0.5) return null;
    let best: Unit | null = null;
    for (const x of enemies(u)) {
      if (!x.alive || x.hp >= x.maxHp * ex.pct || dist(u, x) > ex.radius + x.body + u.body) continue;
      if (!best || x.hp / x.maxHp < best.hp / best.maxHp) best = x;
    }
    return best;
  };

  /** Стая: сколько сородичей по стае (кроме u) сражаются с x. */
  const packMates = (u: Unit, x: Unit) => {
    let n = 0;
    for (const o of allies(u)) if (o !== u && o.alive && o.bh.pack && o.engage === x && o.range !== Infinity) n++;
    return n;
  };
  /** Стая: цель, которую уже бьют сородичи (меньше limit), — больше сородичей, затем ближе. Уже со стаей — null. */
  const packTarget = (u: Unit): Unit | null => {
    const lim = u.bh.pack!.limit;
    const cur = u.engage;
    if (cur?.alive && packMates(u, cur) > 0) return null;
    let best: Unit | null = null;
    let bn = 0;
    let bd = Infinity;
    for (const x of enemies(u)) {
      if (!x.alive || deep(x)) continue;
      const n = packMates(u, x);
      if (n === 0 || n >= lim || meleeOn(x, u) >= Math.max(lim, maxPerTarget)) continue;
      const d = dist(u, x);
      if (n > bn || (n === bn && d < bd)) {
        best = x;
        bn = n;
        bd = d;
      }
    }
    return best;
  };

  /** Трусы: кто бежит (до какого времени) и кто уже бегал (раз за бой). */
  const cowards = on ? all.filter((u) => u.bh.coward) : [];
  const fleeing = new Map<Unit, number>();
  const fled = new Set<Unit>();
  const aliveOn = (u: Unit) => {
    let n = 0;
    for (const o of allies(u)) if (o.alive) n++;
    return n;
  };
  /** Трус ниже порога ОЗ бежит к своему лекарю (иначе к своему краю поля); последний живой не бежит, бегущий — возвращается. */
  const cowardice = () => {
    for (const u of cowards) {
      if (!u.alive) {
        fleeing.delete(u);
        continue;
      }
      const until = fleeing.get(u);
      if (until !== undefined) {
        if (t + 1e-9 >= until || aliveOn(u) <= 1) fleeing.delete(u);
        continue;
      }
      const c = u.bh.coward!;
      if (fled.has(u) || u.hp >= u.maxHp * c.hpPct || stunned(u) || u.casting || aliveOn(u) <= 1) continue;
      let healer: Unit | null = null;
      for (const o of allies(u)) if (o !== u && o.alive && o.def.role === 'healer' && (!healer || dist(u, o) < dist(u, healer))) healer = o;
      const x = healer ? standX(healer) + backDir(u) * minSep : slotPosition(u.side, cfg.slots.back[0], cfg).x + backDir(u) * 60;
      const y = healer ? standY(healer) : u.y;
      const spot = clearance(u, null, x, y) >= minSep ? { x: round2(clampX(x)), y: round2(clampY(y)) } : findSpot(u, x, y, backDir(u), 0, minSep, null, 0);
      fled.add(u);
      fleeing.set(u, round2(t + c.seconds));
      u.moving = null;
      if (u.range !== Infinity) setEngage(u, null);
      startMove(u, spot.x, spot.y, 'flee');
    }
  };

  /** Живучесть врагов (combat.json sustain): повторное лечение одной цели слабеет, щиты не складываются. */
  const sustain = on ? cfg.sustain : undefined;
  const healLog = new Map<Unit, { t: number; n: number }>();
  function healRepeat(u: Unit, target: Unit): number {
    if (!sustain || !sustain.kinds.includes(u.def.kind)) return 1;
    const h = healLog.get(target);
    const n = h && t - h.t <= sustain.window + 1e-9 ? h.n + 1 : 0;
    healLog.set(target, { t, n });
    return Math.max(sustain.floor, sustain.repeat ** n);
  }
  function noStack(u: Unit): boolean {
    return !!sustain && !sustain.stackShields && sustain.kinds.includes(u.def.kind);
  }

  // ---------- ярость и фазы боссов (docs/design/battle-behavior.md §2.5) ----------

  /** Мягкая ярость всех после afterSeconds: урон × (1 + perSecond × секунд сверх порога) — бои не тянутся до таймера. */
  const enrage = on ? cfg.enrage : undefined;
  let enraged = false;
  function rage(d: number): number {
    if (!enrage || t <= enrage.afterSeconds) return d;
    return Math.max(1, Math.round(d * (1 + enrage.perSecond * (t - enrage.afterSeconds))));
  }
  /** Лечение в ярости слабеет (healPerSecond за секунду сверх порога). */
  function mend(h: number): number {
    if (!enrage?.healPerSecond || t <= enrage.afterSeconds) return h;
    return Math.max(0, Math.round(h * Math.max(0, 1 - enrage.healPerSecond * (t - enrage.afterSeconds))));
  }

  /** Юниты с фазами, сработавшие фазы (по юниту) и очередь фаз к началу следующего тика. */
  const phased = on ? all.filter((u) => u.def.phases && u.def.phases.length > 0) : [];
  const phaseDone = new Map<Unit, Set<number>>();
  const phaseQueue: { u: Unit; i: number }[] = [];
  const queuePhase = (u: Unit, i: number) => {
    let done = phaseDone.get(u);
    if (!done) phaseDone.set(u, (done = new Set()));
    if (done.has(i)) return;
    done.add(i);
    phaseQueue.push({ u, i });
  };
  /** Порог ОЗ пересечён — фаза в очередь; удар через два порога — обе, по порядку phases. */
  function checkPhases(u: Unit) {
    const ph = u.def.phases!;
    for (let i = 0; i < ph.length; i++) {
      const p = ph[i];
      if (p.atHpPct !== undefined && u.hp <= u.maxHp * p.atHpPct) queuePhase(u, i);
    }
  }
  const timePhases = () => {
    for (const u of phased) {
      if (!u.alive) continue;
      const ph = u.def.phases!;
      for (let i = 0; i < ph.length; i++) if (ph[i].atSeconds !== undefined && t + 1e-9 >= ph[i].atSeconds!) queuePhase(u, i);
    }
  };
  const runPhases = () => {
    for (const { u, i } of phaseQueue.splice(0)) {
      if (!u.alive) continue;
      const p = u.def.phases![i];
      emit({ t, type: 'phase', unit: u.uid, index: i, title: p.title, ...(p.bark ? { bark: p.bark } : {}) });
      for (const act of p.actions) phaseAction(u, act);
    }
  };
  const phaseAction = (u: Unit, act: PhaseActionDef) => {
    switch (act.type) {
      case 'addActive': {
        // Новый навык готов сразу.
        const s = content.skills[act.skill];
        if (!s || u.actives.includes(s)) return;
        u.actives = orderActives([...u.actives, s]);
        healOrder.delete(u);
        castsOf.delete(u);
        return;
      }
      case 'status':
        applyEffect(u, { type: 'status', status: act.status, chance: 1 }, u);
        return;
      case 'energy':
        addEnergy(u, act.amount);
        emit({ t, type: 'energy', unit: u.uid, energy: u.energy });
        return;
      case 'shield':
        applyEffect(u, { type: 'shield', pctMaxHp: act.pctMaxHp }, u);
        return;
      case 'summon':
        summon(u, act);
        return;
    }
  };

  /** Призванные посреди боя: снимки для сцены; uid — B5, B6… (после слотов). Живой свиты — не больше MAX_SUMMONS. */
  const spawned: (UnitSnapshot & { t: number })[] = [];
  let spawnSeq = 0;
  const summon = (boss: Unit, s: Extract<PhaseActionDef, { type: 'summon' }>) => {
    const base = content.units[s.unit];
    if (!base) return;
    const side = boss.side === 'A' ? a : b;
    // Свободный слот своей стороны: сначала задний ряд, потом передний; нет — призыв пропадает.
    const order = [...cfg.slots.back, ...cfg.slots.front];
    for (let k = 0; k < s.count; k++) {
      let live = 0;
      for (const x of side) if (x.alive && x.summoned) live++;
      if (live >= MAX_SUMMONS) return;
      const slot = order.find((sl) => !side.some((x) => x.alive && x.slot === sl));
      if (slot === undefined) return;
      // Сила свиты — доля статов босса (множитель этапа уже в них).
      const def: UnitDef = {
        ...base,
        stats: {
          ...base.stats,
          hp: Math.max(1, Math.round(boss.maxHp * s.hp)),
          atk: Math.round(boss.base.atk * s.atk),
          def: Math.round(boss.base.def * (s.def ?? s.atk)),
        },
        phases: undefined,
      };
      const uid = `${boss.side}${cfg.slots.count + spawnSeq++}`;
      const u = makeUnit(def, boss.side, slot, uid, content, cfg, on);
      u.summoned = true;
      side.push(u);
      all.push(u);
      byUid.set(uid, u);
      homes.set(u, { x: u.x, y: u.y });
      if (u.range === Infinity && (u.bh.kite || u.bh.anchor || u.bh.center)) rangedMovers.push(u);
      report[uid] = { uid, unitId: base.id, damageDealt: 0, healingDone: 0, shieldGiven: 0, damageTaken: 0, ults: 0, skills: 0, alive: true };
      spawned.push({ uid, side: u.side, slot, unitId: base.id, maxHp: u.maxHp, x: u.x, y: u.y, t });
      emit({ t, type: 'spawn', unit: uid, unitId: base.id, source: boss.uid, x: u.x, y: u.y, maxHp: u.maxHp });
    }
  };

  /** Стражи (профиль с intercept) и их перехваты: страж → враг, которого перехватил; когда страж снова готов. */
  const guards = on ? all.filter((u) => u.range !== Infinity && u.bh.intercept) : [];
  const intercepting = new Map<Unit, Unit>();
  const interceptReady = new Map<Unit, number>();
  /** Враг ближнего боя сражается с нашим дальним бойцом (прошёл линию или прыгнул в тыл). */
  const threatens = (x: Unit, side: Side) => x.alive && x.range !== Infinity && !!x.engage?.alive && x.engage.side === side && x.engage.range === Infinity;
  /**
   * Перехват: враг ближнего боя у нашего дальнего бойца (в пределах radius) — ближайший свободный страж рывком встаёт
   * между ними и сражается с ним. На одного врага — один страж; страж — не чаще cooldown.
   */
  const intercepts = () => {
    for (const x of all) {
      if (!x.alive || x.range === Infinity || stunned(x)) continue;
      const side: Side = x.side === 'A' ? 'B' : 'A';
      if (!threatens(x, side)) continue;
      const ward = x.engage!;
      if (dist(x, ward) > reach(x, ward) + 1 && !deep(x)) continue;
      let covered = false;
      for (const g of guards) if (g.alive && g.side === side && g.engage === x) covered = true;
      if (covered) continue;
      let best: Unit | null = null;
      let bd = Infinity;
      for (const g of guards) {
        if (g.side !== side || !g.alive || g.casting || stunned(g) || tauntOf(g)) continue;
        if (t + 1e-9 < (interceptReady.get(g) ?? 0)) continue;
        const cur = intercepting.get(g);
        if (cur && cur.alive && cur !== x) continue;
        const d = dist(g, x);
        if (d > g.bh.intercept!.radius) continue;
        if (d < bd) {
          bd = d;
          best = g;
        }
      }
      if (!best) continue;
      // Точка между врагом и союзником: веер у врага в сторону союзника.
      const d = dist(x, ward) || 1;
      const spot = findSpot(best, x.x, x.y, (ward.x - x.x) / d, (ward.y - x.y) / d, reach(best, x) * 0.9, x, 0);
      best.moving = null;
      emit({
        t,
        type: 'move',
        unit: best.uid,
        from: [round2(best.x), round2(best.y)],
        to: [spot.x, spot.y],
        duration: cfg.movement.dashSeconds,
        kind: 'dash',
        reason: 'intercept',
      });
      best.x = spot.x;
      best.y = spot.y;
      landsAt.set(best, round2(t + cfg.movement.dashSeconds));
      returns.delete(best);
      dived.delete(best);
      setEngage(best, x);
      intercepting.set(best, x);
      interceptReady.set(best, round2(t + best.bh.intercept!.cooldown));
    }
  };

  /** Приземление после рывка назад (diveBack): до него ближний удар не наносится (с профилями; без них — как раньше). */
  const landsAt = new Map<Unit, number>();
  const skillReady = (u: Unit, skill: SkillDef) =>
    !u.moving && (skill.range === 'ranged' || (!!u.engage?.alive && dist(u, u.engage) <= reach(u, u.engage) + 0.5 && !(t + 1e-9 < (landsAt.get(u) ?? 0))));

  /** true — юнит походил; false — не может сейчас (бежит или не дошёл), ждёт с полной шкалой. */
  const act = (u: Unit): boolean => {
    // Трус бежит — не бьёт (шкала ждёт полной).
    if (fleeing.size > 0 && fleeing.has(u)) return false;
    // Оглушённый теряет ход, где бы ни стоял (T2-06).
    if (stunned(u)) {
      emit({ t, type: 'turn', unit: u.uid });
      trigger(u, 'turnStart');
      if (u.alive) emit({ t, type: 'skip', unit: u.uid, reason: 'stun' });
      return true;
    }
    const useUlt = !!u.ult && u.energy >= cfg.energy.max && skillReady(u, u.ult) && !manualOn(u);
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
      fireUlt(u, u.ult);
    } else if (skillReady(u, u.basic)) {
      basicAction(u, u.basic);
    }
    return true;
  };

  /** Ульта на энергии (skills.ult): энергия в ноль, событие ult, заряд врага в целях — сбит. */
  const fireUlt = (u: Unit, ult: SkillDef) => {
    u.energy = 0;
    report[u.uid].ults++;
    const targets = pickFor(u, ult);
    emit({
      t,
      type: 'ult',
      unit: u.uid,
      skill: ult.id,
      name: ult.name,
      targets: targets.map((x) => x.uid),
    });
    breakCharges(u, ult, targets);
    useSkill(u, ult, targets);
  };

  /**
   * Взведённая касанием ульта: срабатывает при первой возможности вне очереди хода (шкала обнуляется, как после хода).
   * Не может сейчас (оглушён, кастует, бежит, ближний не дошёл, нет целей) — ждёт следующего тика.
   */
  const fireManual = (u: Unit) => {
    if (!u.alive) {
      armed.delete(u);
      return;
    }
    if (stunned(u) || u.casting || (fleeing.size > 0 && fleeing.has(u))) return;
    const s = ultOf.get(u)!;
    if (u.ult === s) {
      if (u.energy < cfg.energy.max || !skillReady(u, s)) return;
      fireUlt(u, s);
    } else {
      if ((u.readyAt[s.id] ?? 0) > t + 1e-9 || !skillReady(u, s)) return;
      const targets = activeTargets(u, s);
      if (targets.length === 0 || !startActive(u, s, targets)) return;
    }
    armed.delete(u);
    readyShown.delete(u);
    u.gauge = 0;
  };

  /** Ульта готова (энергия полная / перезарядка прошла). */
  const ultReady = (u: Unit) => {
    const s = ultOf.get(u);
    if (!s || !u.alive) return false;
    return u.ult === s ? u.energy >= cfg.energy.max : (u.readyAt[s.id] ?? 0) <= t + 1e-9;
  };

  /** Вводы игрока к этому тику: смена режима, взвести ульту (если готова; иначе ввод пропадает). */
  const takeInputs = () => {
    while (inputAt < inputs.length && inputs[inputAt].t <= t + 1e-9) {
      const x = inputs[inputAt++];
      if ('auto' in x) {
        if (manual === !x.auto) continue;
        manual = !x.auto;
        emit({ t, type: 'mode', auto: x.auto });
        if (!manual) {
          armed.clear();
          readyShown.clear();
        }
        continue;
      }
      const u = a.find((q) => q.uid === x.uid);
      if (u && manualOn(u) && ultReady(u)) armed.add(u);
    }
  };

  /** Ручной режим: сказать о готовой ульте (ready) один раз; ульта перестала быть готовой (энергию отняли) — lost. */
  const announceReady = () => {
    for (const u of a) {
      if (!manualOn(u) || armed.has(u)) continue;
      const r = ultReady(u);
      if (r && !readyShown.has(u)) {
        readyShown.add(u);
        emit({ t, type: 'ready', unit: u.uid, skill: ultOf.get(u)!.id });
      } else if (!r && readyShown.has(u)) {
        readyShown.delete(u);
        if (u.alive) emit({ t, type: 'ready', unit: u.uid, skill: ultOf.get(u)!.id, lost: true });
      }
    }
  };

  // ---------- заряд босса (docs/design/battle-decisions.md §4) ----------

  const chargers = on ? all.filter((u) => u.def.charge && content.skills[u.def.charge.skill]) : [];
  /** Когда начать следующий заряд (Infinity — заряд идёт). */
  const nextCharge = new Map<Unit, number>(chargers.map((u) => [u, u.def.charge!.first]));
  const brokenStatus = { id: 'charge_broken', name: 'Сбит', turns: cfg.charge?.stunTurns ?? 3, stun: true };

  /** Враг, который сейчас заряжает удар (босс раньше, равенство — меньший слот). */
  const chargingFoe = (u: Unit): Unit | null => {
    for (const x of enemies(u)) if (x.alive && x.casting?.charge) return x;
    return null;
  };

  /** Начать заряд, когда пришло время (не оглушён, не кастует, не идёт); после удара/сбития — следующий через every. */
  const chargeTick = () => {
    for (const u of chargers) {
      if (!u.alive) continue;
      const next = nextCharge.get(u)!;
      if (next === Infinity) {
        if (!u.casting?.charge) nextCharge.set(u, round2(t + u.def.charge!.every));
        continue;
      }
      if (t + 1e-9 < next || u.casting || u.moving || stunned(u) || (fleeing.size > 0 && fleeing.has(u))) continue;
      const skill = content.skills[u.def.charge!.skill];
      u.casting = { skill, until: round2(t + skill.castTime), charge: true };
      nextCharge.set(u, Infinity);
      emit({ t, type: 'cast', unit: u.uid, skill: skill.id, name: skill.name, duration: skill.castTime, action: 'start', charge: true });
    }
  };

  /** Ульта героя попала в заряжающего врага — «Сбито!»: каст пропал, враг оглушён. */
  const breakCharges = (u: Unit, skill: SkillDef, targets: readonly Unit[]) => {
    if (chargers.length === 0 || ultOf.get(u) !== skill) return;
    for (const x of targets) {
      if (!x.alive || !x.casting?.charge) continue;
      const c = x.casting.skill;
      x.casting = null;
      emit({ t, type: 'cast', unit: x.uid, skill: c.id, name: c.name, duration: 0, action: 'interrupt', reason: 'break' });
      applyEffect(u, { type: 'status', status: brokenStatus, chance: 1 }, x);
    }
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
    const out = pickFor(u, skill);
    return heal ? wounded(out) : out;
  };

  const cooldownOf = (skill: SkillDef) => skill.cooldown ?? cfg.skills?.defaultCooldown ?? 8;

  const fireActive = (u: Unit, skill: SkillDef, targets: Unit[], area?: Area) => {
    const cd = cooldownOf(skill);
    u.readyAt[skill.id] = round2(t + cd);
    if (u.bh.counter) holdSince.delete(u);
    report[u.uid].skills++;
    addEnergy(u, cfg.energy.perBasicAction);
    const kind = skill.effects.some((e) => e.type === 'heal') ? 'heal' : skill.range === 'melee' ? 'melee' : 'ranged';
    emit({
      t,
      type: 'attack',
      unit: u.uid,
      skill: skill.id,
      targets: targets.map((x) => x.uid),
      kind,
      energy: u.energy,
      name: skill.name,
      cooldown: cd,
    });
    breakCharges(u, skill, targets);
    launch(u, skill, targets, area);
  };

  /** Готовый активный навык с наибольшим приоритетом, у которого есть цели. null — готовых нет. */
  const pickActive = (u: Unit): { skill: SkillDef; targets: Unit[] } | null => {
    for (const skill of u.bh.panicPct !== undefined && panicking(u) ? healFirst(u) : u.actives) {
      if ((u.readyAt[skill.id] ?? 0) > t + 1e-9) continue;
      if (manual && manualOn(u) && ultOf.get(u) === skill) continue;
      if (u.bh.counter && holdInterrupt(u, skill)) continue;
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
    // Маг: удар по кругу там, где больше всего врагов (скопление меньше minCluster — как раньше).
    const ch = skill.area && chargers.length > 0 && ultOf.get(u) === skill ? chargingFoe(u) : null;
    const area =
      skill.area && u.bh.area && skill.target.side === 'enemy'
        ? ch
          ? { x: round2(ch.x), y: round2(ch.y), r: skill.area.radius }
          : areaSpot(u, skill.area.radius, u.bh.area.minCluster)
        : null;
    if (skill.castTime > 0) {
      u.casting = { skill, until: round2(t + skill.castTime), ...(area ? { at: [area.x, area.y] as [number, number], radius: area.r } : {}) };
      emit({
        t,
        type: 'cast',
        unit: u.uid,
        skill: skill.id,
        name: skill.name,
        duration: skill.castTime,
        action: 'start',
        ...(area ? { at: [area.x, area.y] as [number, number], radius: area.r } : {}),
      });
      if (u.bh.counter && interrupts(skill)) holdSince.delete(u);
    } else if (area) {
      const hit = areaTargets(u, skill, area);
      if (hit.length === 0) return false;
      fireActive(u, skill, hit, area);
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
    const area: Area | undefined = c.at && c.radius ? { x: c.at[0], y: c.at[1], r: c.radius } : undefined;
    castEnding = true;
    const targets = area ? areaTargets(u, c.skill, area) : activeTargets(u, c.skill);
    castEnding = false;
    // Круг опустел (все вышли) — удар пропал; перезарядка половинная, чтобы маг не зацикливался на начале каста.
    if (area && targets.length === 0) u.readyAt[c.skill.id] = round2(t + cooldownOf(c.skill) / 2);
    if (targets.length === 0) {
      emit({
        t,
        type: 'cast',
        unit: u.uid,
        skill: c.skill.id,
        name: c.skill.name,
        duration: 0,
        action: 'interrupt',
        reason: 'noTarget',
      });
      return;
    }
    fireActive(u, c.skill, targets, area);
  };

  const basicAction = (u: Unit, skill: SkillDef) => {
    // Ближний бой бьёт того, с кем сражается; остальные выбирают цель навыком.
    let targets = skill.range === 'melee' && u.engage?.alive ? [u.engage] : pickFor(u, skill);
    if (targets.length === 0 && skill.fallback) {
      const fb = content.skills[skill.fallback];
      return basicAction(u, fb);
    }
    if (targets.length === 0) return;
    addEnergy(u, cfg.energy.perBasicAction);
    const kind = skill.effects.some((e) => e.type === 'heal') ? 'heal' : skill.range === 'melee' ? 'melee' : 'ranged';
    emit({
      t,
      type: 'attack',
      unit: u.uid,
      skill: skill.id,
      targets: targets.map((x) => x.uid),
      kind,
      energy: u.energy,
    });
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
        applyDamage(null, s.source, u, rage(Math.max(1, Math.floor(s.sourceAtk * s.def.dot!.k))), true);
      }
    }
    if (!expiring) return;
    for (const u of all) {
      if (!u.alive) continue;
      for (const s of [...u.statuses]) {
        if (s.until > t + 1e-9) continue;
        u.statuses = u.statuses.filter((x) => x !== s);
        emit({
          t,
          type: 'status',
          source: s.source,
          target: u.uid,
          status: s.def.id,
          name: s.def.name,
          turns: 0,
          action: 'expire',
        });
      }
    }
  };

  const maxTicks = Math.round(cfg.timeLimitSeconds / cfg.tickSeconds);

  try {
    checkEnd();
    // Ауры бардов видны с начала боя (круг под исполнителем).
    if (on) for (const u of all) for (const p of u.passives) if (p.aura) emit({ t, type: 'aura', unit: u.uid, skill: p.id, radius: p.aura.radius });
    for (const u of all) trigger(u, 'battleStart');
    for (let tick = 1; tick <= maxTicks; tick++) {
      t = Math.round(tick * cfg.tickSeconds * 1000) / 1000;
      tickNo = tick;

      if (on) {
        if (enrage && !enraged && t + 1e-9 >= enrage.afterSeconds) {
          enraged = true;
          emit({ t, type: 'enrage', afterSeconds: enrage.afterSeconds, perSecond: enrage.perSecond });
        }
        if (phased.length > 0) timePhases();
        if (phaseQueue.length > 0) runPhases();
      }
      if (inputAt < inputs.length) takeInputs();
      landProjectiles();
      tickStatuses();
      for (const u of all) if (u.alive && !stunned(u)) stepMove(u);
      diveBack();
      if (cowards.length > 0 && tickNo % 3 === 0) cowardice();
      const melee = all.filter((u) => u.alive && u.range !== Infinity && !(fleeing.size > 0 && fleeing.has(u)));
      for (const u of melee) pickEngage(u);
      if (guards.length > 0 && tickNo % 3 === 0) intercepts();
      if (links.size > 0) expireLinks();
      for (const u of melee) checkStuck(u);
      for (const u of melee) planMove(u);
      for (const u of rangedMovers) planRanged(u);

      for (const u of all) if (u.alive && u.casting) finishCast(u);
      if (chargers.length > 0) chargeTick();
      if (armed.size > 0) for (const u of a) if (armed.has(u)) fireManual(u);

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
      if (manual) announceReady();
    }
    t = cfg.timeLimitSeconds;
    winner = 'B';
    reason = 'timeout';
  } catch (err) {
    if (!(err instanceof BattleEnded)) throw err;
  }

  emit({ t, type: 'end', winner, reason });

  return { seed, winner, reason, duration: t, units: snapshots, ...(spawned.length > 0 ? { spawned } : {}), log, report };
}
