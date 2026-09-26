import { COMBAT, HEROES } from './config';
import { calcDamage, calcHeal } from './formulas';
import { Rng } from './rng';
import {
  backRow,
  frontRow,
  lowestHp,
  neighbor,
  pickBasicTarget,
  randomAlive,
} from './targeting';
import type {
  BattleEvent,
  BattleResult,
  CombatConfig,
  Effect,
  HeroesConfig,
  Side,
  Squad,
  Unit,
  UnitReport,
} from './types';

export interface BattleOptions {
  heroes?: HeroesConfig;
  combat?: CombatConfig;
  /** false — не копить лог (для массовых прогонов симулятора). */
  log?: boolean;
}

class BattleEnded extends Error {}

export function createUnits(squad: Squad, side: Side, heroes: HeroesConfig): Unit[] {
  const units: Unit[] = [];
  squad.forEach((heroId, slot) => {
    if (!heroId) return;
    const def = heroes[heroId];
    if (!def) throw new Error(`Неизвестный герой: ${heroId}`);
    units.push({
      uid: `${side}${slot}`,
      side,
      slot,
      heroId,
      def,
      maxHp: def.stats.hp,
      hp: def.stats.hp,
      atk: def.stats.atk,
      armor: def.stats.def,
      spd: def.stats.spd,
      energy: 0,
      gauge: 0,
      shield: 0,
      alive: true,
    });
  });
  return units;
}

/**
 * Детерминированный авто-бой. A — атакующая сторона (игрок), B — защищающаяся.
 * Одинаковые отряды, конфиги и seed дают одинаковый лог.
 */
export function simulateBattle(squadA: Squad, squadB: Squad, seed: number, opts: BattleOptions = {}): BattleResult {
  const heroes = opts.heroes ?? HEROES;
  const cfg = opts.combat ?? COMBAT;
  const keepLog = opts.log ?? true;
  const rng = new Rng(seed);

  const a = createUnits(squadA, 'A', heroes);
  const b = createUnits(squadB, 'B', heroes);
  const all = [...a, ...b];
  const log: BattleEvent[] = [];
  const report: Record<string, UnitReport> = {};
  for (const u of all) {
    report[u.uid] = {
      uid: u.uid,
      heroId: u.heroId,
      damageDealt: 0,
      healingDone: 0,
      shieldGiven: 0,
      damageTaken: 0,
      ults: 0,
      alive: true,
    };
  }

  let t = 0;
  let winner: Side = 'B';
  let reason: 'wipe' | 'timeout' = 'timeout';

  const emit = (e: BattleEvent) => {
    if (keepLog) log.push(e);
  };
  const allies = (u: Unit) => (u.side === 'A' ? a : b);
  const enemies = (u: Unit) => (u.side === 'A' ? b : a);
  const addEnergy = (u: Unit, v: number) => {
    u.energy = Math.min(cfg.energy.max, u.energy + v);
  };

  const checkEnd = () => {
    const aAlive = a.some((u) => u.alive);
    const bAlive = b.some((u) => u.alive);
    if (aAlive && bAlive) return;
    winner = aAlive ? 'A' : 'B';
    reason = 'wipe';
    throw new BattleEnded();
  };

  const dealDamage = (src: Unit, target: Unit, k: number) => {
    if (!target.alive) return;
    const dmg = calcDamage(src.atk, k, target.armor, rng, cfg);
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    const hpLoss = Math.min(target.hp, dmg - absorbed);
    target.hp -= hpLoss;
    report[src.uid].damageDealt += absorbed + hpLoss;
    report[target.uid].damageTaken += absorbed + hpLoss;
    if (target.hp > 0) addEnergy(target, cfg.energy.perHitTaken);
    emit({
      t,
      type: 'damage',
      source: src.uid,
      target: target.uid,
      amount: dmg,
      absorbed,
      hp: target.hp,
      shield: target.shield,
      energy: target.energy,
    });
    if (target.hp <= 0) {
      target.alive = false;
      report[target.uid].alive = false;
      emit({ t, type: 'death', unit: target.uid });
      checkEnd();
    }
  };

  const heal = (src: Unit, target: Unit, k: number) => {
    if (!target.alive) return;
    const amount = Math.min(calcHeal(src.atk, k), target.maxHp - target.hp);
    target.hp += amount;
    report[src.uid].healingDone += amount;
    emit({ t, type: 'heal', source: src.uid, target: target.uid, amount, hp: target.hp });
  };

  const applyEffect = (u: Unit, e: Effect) => {
    const foes = enemies(u);
    switch (e.type) {
      case 'damage': {
        if (e.target === 'enemyRandom') {
          for (let i = 0; i < (e.hits ?? 1); i++) {
            const target = randomAlive(foes, rng);
            if (target) dealDamage(u, target, e.k);
          }
          return;
        }
        let targets: Unit[] = [];
        if (e.target === 'enemyAll') targets = foes.filter((x) => x.alive);
        else if (e.target === 'enemyFrontRow') {
          targets = frontRow(foes, cfg);
          if (targets.length === 0) targets = backRow(foes, cfg);
        } else if (e.target === 'enemyLowestHp') {
          const target = lowestHp(foes);
          targets = target ? [target] : [];
        } else throw new Error(`Цель ${e.target} не подходит для урона`);
        for (let i = 0; i < (e.hits ?? 1); i++) for (const target of targets) dealDamage(u, target, e.k);
        return;
      }
      case 'heal': {
        if (e.target !== 'allyAll') throw new Error(`Цель ${e.target} не подходит для лечения`);
        for (const target of allies(u).filter((x) => x.alive)) heal(u, target, e.k);
        return;
      }
      case 'shield': {
        if (e.target !== 'selfAndNeighbor') throw new Error(`Цель ${e.target} не подходит для щита`);
        const targets = [u, neighbor(u, allies(u), cfg)].filter((x): x is Unit => !!x);
        for (const target of targets) {
          const amount = Math.floor(target.maxHp * e.pctMaxHp);
          target.shield += amount;
          report[u.uid].shieldGiven += amount;
          emit({ t, type: 'buff', source: u.uid, target: target.uid, kind: 'shield', amount, shield: target.shield });
        }
        return;
      }
    }
  };

  const act = (u: Unit) => {
    emit({ t, type: 'turn', unit: u.uid });
    if (u.energy >= cfg.energy.max) {
      u.energy = 0;
      report[u.uid].ults++;
      emit({ t, type: 'ult', unit: u.uid, name: u.def.ult.name });
      for (const e of u.def.ult.effects) applyEffect(u, e);
      return;
    }
    const pick = pickBasicTarget(u, allies(u), enemies(u), cfg);
    if (!pick) return;
    addEnergy(u, cfg.energy.perBasicAction);
    const kind = pick.heal ? 'heal' : u.def.attack === 'melee' ? 'melee' : 'ranged';
    emit({ t, type: 'attack', unit: u.uid, targets: [pick.target.uid], kind, energy: u.energy });
    if (pick.heal) heal(u, pick.target, cfg.basicHeal.k);
    else dealDamage(u, pick.target, cfg.basicAttack.k);
  };

  const sideOrder = (s: Side) => (s === 'A' ? 0 : 1);
  const maxTicks = Math.round(cfg.timeLimitSeconds / cfg.tickSeconds);

  try {
    checkEnd();
    for (let tick = 1; tick <= maxTicks; tick++) {
      t = Math.round(tick * cfg.tickSeconds * 1000) / 1000;
      const ready: Unit[] = [];
      for (const u of all) {
        if (!u.alive) continue;
        u.gauge += u.spd;
        if (u.gauge >= cfg.actionThreshold) ready.push(u);
      }
      // Кто сильнее перешагнул порог — ходит раньше; при равенстве атакующая сторона, затем меньший слот.
      ready.sort((x, y) => y.gauge - x.gauge || sideOrder(x.side) - sideOrder(y.side) || x.slot - y.slot);
      for (const u of ready) {
        if (!u.alive) continue;
        u.gauge = 0;
        act(u);
      }
    }
    t = cfg.timeLimitSeconds;
    winner = 'B';
    reason = 'timeout';
  } catch (err) {
    if (!(err instanceof BattleEnded)) throw err;
  }

  emit({ t, type: 'end', winner, reason });

  return {
    seed,
    winner,
    reason,
    duration: t,
    units: all.map((u) => ({ uid: u.uid, side: u.side, slot: u.slot, heroId: u.heroId, maxHp: u.maxHp })),
    log,
    report,
  };
}
