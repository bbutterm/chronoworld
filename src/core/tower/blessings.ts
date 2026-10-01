import { defenseElement, elementMult, skillElement, type Element } from '../elements';
import type { BattleHookApi, BattleHooks, SkillDef, StatusDef, Unit } from '../types';
import type { Blessing, BlessingEffect, BlessingFamily, TowerRunConfig } from './runSchema';

/**
 * Благословения Башни в бою (docs/design/tower-roguelite.md §3): эффекты карт забега → хуки боя (BattleOptions.hooks).
 * battle.ts зовёт хуки в нескольких точках; вся логика карт — здесь. Без карт и ран хуков нет — бой прежний.
 */

type Kind = BlessingEffect['kind'];
type Of<K extends Kind> = Extract<BlessingEffect, { kind: K }>;

/** Эффект и карта, откуда он (для подписи «bless» в логе). */
export interface SourcedEffect {
  effect: BlessingEffect;
  card: string;
}

/** Виды с бонусом: сколько карт вида у отряда и сработал ли бонус. */
export interface FamilyState {
  family: BlessingFamily;
  count: number;
  active: boolean;
}

export function familyStates(cards: readonly string[], cfg: TowerRunConfig): FamilyState[] {
  return cfg.families.map((family) => {
    const count = cards.filter((id) => cfg.blessings.find((b) => b.id === id)?.family === family.id).length;
    return { family, count, active: count >= family.need };
  });
}

/** Все эффекты карт забега (и бонусов видов), с картой-источником. Неизвестные id карт пропускаются. */
export function runEffects(cards: readonly string[], cfg: TowerRunConfig): SourcedEffect[] {
  const out: SourcedEffect[] = [];
  for (const id of cards) {
    const b = cfg.blessings.find((x) => x.id === id);
    if (b) for (const effect of b.effects) out.push({ effect, card: b.id });
  }
  for (const f of familyStates(cards, cfg)) if (f.active) for (const effect of f.family.bonus) out.push({ effect, card: `family_${f.family.id}` });
  return out;
}

export const blessingById = (cfg: TowerRunConfig, id: string): Blessing | undefined => cfg.blessings.find((b) => b.id === id);

/** Эффекты, которые работают в бою (забеговые — recruit, reviveRun, afterHeal, greed — нет). */
const RUN_KINDS: ReadonlySet<Kind> = new Set(['recruit', 'reviveRun', 'afterHeal', 'greed']);

export interface BlessingBattle {
  hooks: BattleHooks;
  /** После боя: ОЗ героев стороны A (id юнита → тысячные доли; 0 — пал). */
  endHp(): Record<string, number>;
}

/**
 * Хуки боя для забега: hp — ОЗ героев на входе (id юнита → тысячные), effects — эффекты карт. null — хуки не нужны
 * (ни ран, ни боевых эффектов): бой ровно прежний.
 */
export function blessingBattle(effects: readonly SourcedEffect[], hp: Readonly<Record<string, number>> = {}): BlessingBattle | null {
  const fx = effects.filter((e) => !RUN_KINDS.has(e.effect.kind));
  const wounded = Object.values(hp).some((v) => v < 1000);
  const final: Record<string, number> = {};
  const endHp = () => ({ ...final });
  const recordEnd = (api: BattleHookApi) => {
    for (const u of api.a) final[u.unitId] = u.alive && u.hp > 0 ? Math.max(1, Math.min(1000, Math.round((u.hp / u.maxHp) * 1000))) : 0;
  };
  if (fx.length === 0 && !wounded) {
    // Хуков нет: ОЗ после боя читаем из итога сцены/ядра по-другому невозможно — нужен только end.
    return { hooks: { end: recordEnd }, endHp };
  }

  const all = <K extends Kind>(k: K): { e: Of<K>; card: string }[] => fx.filter((x) => x.effect.kind === k).map((x) => ({ e: x.effect as Of<K>, card: x.card }));
  const first = <K extends Kind>(k: K) => all(k)[0];
  const sum = <K extends Kind>(k: K, get: (e: Of<K>) => number, cap = Infinity) => Math.min(cap, all(k).reduce((s, x) => s + get(x.e), 0));

  const firstStrike = first('firstStrike');
  const strikeMult = Math.max(1, ...all('firstStrike').map((x) => x.e.mult));
  const startShield = sum('startShield', (e) => e.pct);
  const killHeal = sum('killHeal', (e) => e.pct);
  const revives = all('reviveOnce');
  const splashes = all('splash');
  const echo = sum('echo', (e) => e.pct);
  const rage = sum('allyDeathRage', (e) => e.atkPct);
  const bomb = first('cowardBomb');
  const bombPct = sum('cowardBomb', (e) => e.pct);
  const element: Element | undefined = all('element').at(-1)?.e.element;
  const execute = Math.max(0, ...all('execute').map((x) => x.e.pct));
  const regens = all('regen');
  const atk = sum('atk', (e) => e.pct);
  const healTaken = Math.max(-0.9, sum('healTaken', (e) => e.pct));
  const hpLoss = sum('startHpLoss', (e) => e.pct, 0.9);
  const lastStand = first('lastStand');
  const lastAtk = sum('lastStand', (e) => e.atkPct);
  const lastShield = sum('lastStand', (e) => e.shieldPct);
  const guardFront = sum('rowGuard', (e) => (e.row === 'front' ? e.pct : 0), 0.9);
  const guardBack = sum('rowGuard', (e) => (e.row === 'back' ? e.pct : 0), 0.9);
  const swift = first('swiftStart');
  const poisons = all('poison');
  const stuns = all('stun');
  const skillShield = sum('skillShield', (e) => e.pct, 0.9);
  const dodge = first('dodgeFirst');
  const double = first('doubleHit');
  const doubleChance = sum('doubleHit', (e) => e.chance, 1);
  const ultReset = first('ultReset');
  const meteors = all('meteor');
  const killHaste = first('killHaste');
  const ultHaste = first('ultHaste');
  const ultHastePct = sum('ultHaste', (e) => e.pct, 1);
  const cardOf = <K extends Kind>(k: K) => first(k)?.card ?? '';

  // Состояние на бой.
  const struck = new Set<Unit>();
  const dodged = new Set<Unit>();
  const bombs = new Set<Unit>();
  const resetDone = new Set<Unit>();
  const echoAt = new Set<string>();
  let revivesLeft = revives.length;
  let lastStood = false;
  let meteorAt = -Infinity;
  const regenNext = regens.map((r) => r.e.every);

  const bless = (api: BattleHookApi, unit: Unit, card: string, text: string) => api.emit({ t: api.t, type: 'bless', unit: unit.uid, card, text });
  const isBasic = (u: Unit, skill: SkillDef | undefined) => !skill || skill.id === u.def.skills.basic;
  const heroHeal = (v: number) => v * (1 + healTaken);
  const status = (id: string, name: string, turns: number, extra: Partial<StatusDef>): StatusDef => ({ id, name, turns, ...extra });

  const hooks: BattleHooks = {
    start(api) {
      for (const u of api.a) {
        const p = hp[u.unitId];
        if (p !== undefined && p < 1000) u.hp = Math.max(1, Math.round((u.maxHp * p) / 1000));
        if (hpLoss > 0) u.hp = Math.max(1, u.hp - Math.round(u.hp * hpLoss));
        if (atk !== 0) u.base.atk = Math.max(1, Math.round(u.base.atk * (1 + atk)));
        if (swift) u.gauge = api.combat.actionThreshold;
      }
      if (startShield > 0) for (const u of api.a) api.shield(u, u, heroHeal(u.maxHp * startShield));
      if (hpLoss > 0 && api.a[0]) bless(api, api.a[0], cardOf('startHpLoss'), 'Сделка!');
      if (swift && api.a[0]) bless(api, api.a[0], swift.card, 'Первый ход!');
    },

    damage(api, src, target, dmg, skill) {
      if (src.side === 'A' && target.side === 'B') {
        const basic = isBasic(src, skill);
        if (element && api.combat.elements && (!skill || skillElement(skill) === 'neutral')) {
          dmg *= elementMult(api.combat.elements, element, defenseElement(target.def));
        }
        if (firstStrike && !struck.has(target)) {
          struck.add(target);
          dmg *= strikeMult;
          bless(api, target, firstStrike.card, 'Крит!');
        }
        if (double && basic && api.random() < doubleChance) {
          dmg *= 2;
          bless(api, target, double.card, 'Дважды!');
        }
        const left = target.hp - dmg;
        if (execute > 0 && target.def.kind !== 'boss' && left > 0 && left < target.maxHp * execute) {
          dmg = target.hp + target.shield;
          bless(api, target, cardOf('execute'), 'Добит!');
        } else if (bomb && target.bh.coward && target.def.kind !== 'boss' && !bombs.has(target) && left > 0 && left < target.maxHp * target.bh.coward.hpPct) {
          bombs.add(target);
          dmg = target.hp + target.shield;
        }
        // Побочные удары (соседи, отскок, яд, оглушение) — по живым, кроме самой цели.
        for (const s of splashes) {
          const on = s.e.on === 'basic' ? basic : !basic && (!s.e.element || (skill && skillElement(skill) === s.e.element));
          if (!on) continue;
          for (const o of api.b) {
            if (o === target || !o.alive || Math.hypot(o.x - target.x, o.y - target.y) > s.e.radius + o.body) continue;
            api.damage(src, src.uid, o, dmg * s.e.pct);
          }
        }
        if (echo > 0 && !basic) {
          const key = `${src.uid}@${api.t}`;
          if (!echoAt.has(key)) {
            echoAt.add(key);
            const others = api.b.filter((o) => o.alive && o !== target);
            if (others.length) api.damage(src, src.uid, others[Math.floor(api.random() * others.length)], dmg * echo);
          }
        }
        if (basic && target.alive) {
          for (const p of poisons) if (api.random() < p.e.chance) api.status(src, target, status('bless_poison', 'Яд', p.e.turns, { dot: { k: p.e.k } }));
          for (const s of stuns) if (target.alive && api.random() < s.e.chance) api.status(src, target, status('bless_stun', 'Оглушение', s.e.turns, { stun: true }));
        }
        return dmg;
      }
      if (target.side === 'A' && src.side === 'B') {
        if (dodge && !dodged.has(target)) {
          dodged.add(target);
          bless(api, target, dodge.card, 'Промах!');
          return 0;
        }
        if (skillShield > 0 && !isBasic(src, skill)) dmg *= 1 - skillShield;
        const guard = target.slot < 2 ? guardFront : guardBack;
        if (guard > 0) dmg *= 1 - guard;
        if (meteors.length && api.t - meteorAt >= 3) {
          for (const m of meteors) {
            if (api.random() >= m.e.chance) continue;
            meteorAt = api.t;
            bless(api, target, m.card, 'Метеоры!');
            for (const o of api.b) if (o.alive) api.damage(target, target.uid, o, target.base.atk * m.e.k);
            break;
          }
        }
        return dmg;
      }
      return dmg;
    },

    heal(_api, _src, target, amount) {
      return target.side === 'A' && healTaken !== 0 ? heroHeal(amount) : amount;
    },

    dying(api, target) {
      if (target.side !== 'A' || revivesLeft <= 0) return false;
      const r = revives.find((x) => !x.e.healer) ?? revives[0];
      let savior: Unit = target;
      if (!revives.some((x) => !x.e.healer)) {
        const h = api.a.find((u) => u !== target && u.alive && u.hp > 0 && (u.def.role === 'healer' || u.def.role === 'support'));
        if (!h) return false;
        savior = h;
      }
      revivesLeft--;
      const hpPct = Math.max(...revives.map((x) => x.e.hpPct));
      target.hp = Math.max(1, Math.round(target.maxHp * hpPct));
      api.emit({ t: api.t, type: 'heal', source: savior.uid, target: target.uid, amount: target.hp, hp: target.hp });
      bless(api, target, r.card, 'Встаёт!');
      return true;
    },

    death(api, target, killer) {
      if (target.side === 'B') {
        if (killHeal > 0) {
          const src = killer && killer.side === 'A' && killer.alive ? killer : api.a.find((u) => u.alive);
          if (src) for (const u of api.a) if (u.alive) api.heal(src, u, heroHeal(u.maxHp * killHeal));
        }
        if (killHaste && killer && killer.side === 'A' && killer.alive) killer.gauge = api.combat.actionThreshold;
        if (bomb && bombs.has(target)) {
          bless(api, target, bomb.card, 'Взрыв!');
          for (const o of api.b) {
            if (!o.alive || Math.hypot(o.x - target.x, o.y - target.y) > bomb.e.radius + o.body) continue;
            api.damage(null, target.uid, o, target.maxHp * bombPct);
          }
        }
        return;
      }
      const alive = api.a.filter((u) => u.alive);
      if (rage > 0 && alive.length) {
        for (const u of alive) u.base.atk = Math.round(u.base.atk * (1 + rage));
        bless(api, alive[0], cardOf('allyDeathRage'), 'Месть!');
      }
      if (lastStand && !lastStood && alive.length === 1) {
        lastStood = true;
        const u = alive[0];
        u.base.atk = Math.round(u.base.atk * (1 + lastAtk));
        bless(api, u, lastStand.card, 'Последний герой!');
        if (lastShield > 0) api.shield(u, u, heroHeal(u.maxHp * lastShield));
      }
    },

    skill(api, u, skill) {
      if (u.side !== 'A' || api.ultOf(u) !== skill) return;
      if (ultReset && !resetDone.has(u)) {
        resetDone.add(u);
        if (u.ult === skill) u.energy = api.combat.energy.max;
        else u.readyAt[skill.id] = api.t;
        bless(api, u, ultReset.card, 'Ещё раз!');
      }
      if (ultHaste) for (const o of api.a) if (o !== u && o.alive) o.gauge = Math.min(api.combat.actionThreshold, o.gauge + api.combat.actionThreshold * ultHastePct);
    },

    tick(api) {
      regens.forEach((r, i) => {
        if (api.t + 1e-9 < regenNext[i]) return;
        regenNext[i] = Math.round((regenNext[i] + r.e.every) * 1000) / 1000;
        for (const u of api.a) if (u.alive && u.hp < u.maxHp) api.heal(u, u, heroHeal(u.maxHp * r.e.pct));
      });
    },

    end: recordEnd,
  };
  return { hooks, endHp };
}
