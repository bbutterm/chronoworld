import { z } from 'zod';
import type { Content, UnitDef } from './types';
import type { CombatConfig } from './types';

/**
 * Профили поведения в бою (docs/design/battle-behavior.md): как боец выбирает цель и где стоит. Профиль не добавляет
 * урона — меняет, кого и откуда бьют. Числа — только в data/combat.json → behaviors (одно место для баланса); правила
 * исполняет симулятор (src/core/battle.ts), здесь — схема, разрешение профиля юнита и проверка ссылок.
 * Всё детерминировано: выборы — сортировкой с «равенство — меньший слот», без rng.
 */

const role = z.enum(['tank', 'damage', 'healer', 'support']);

export const BehaviorProfileSchema = z.object({
  $comment: z.string().optional(),
  /** Название для людей («Стрелок», «Страж»). */
  name: z.string().min(1),
  /**
   * Фокус: обычная атака и одиночные навыки с pick nearest бьют врага с наименьшим hp (или долей hp) в любом ряду.
   * Цель держится, пока жива и не появился враг слабее на долю margin.
   */
  focus: z.object({ pick: z.enum(['lowestHp', 'lowestHpPct']), margin: z.number().min(0).max(1) }).optional(),
  /**
   * Отход (кайт) дальнего бойца: ближний враг, чья цель — он, подошёл на досягаемость + trigger — отходит на step к своему
   * краю поля. Не чаще cooldown секунд, не больше max раз за бой, только если дальше от врага хотя бы на minGain.
   */
  kite: z
    .object({
      step: z.number().positive(),
      trigger: z.number().nonnegative(),
      cooldown: z.number().nonnegative(),
      max: z.number().int().nonnegative(),
      minGain: z.number().nonnegative(),
    })
    .optional(),
  /**
   * Якорь (лекарь): стоит за своим самым крепким ближним (танк по роли, иначе ближний с наибольшим maxHp) на followDist к
   * своему краю, идёт следом, если отстал больше чем на followSlack; не дальше maxDrift вперёд от своего слота; по высоте — на долю yShare от своего слота к якорю (строй не сбивается в одну линию).
   */
  anchor: z.object({ followDist: z.number().nonnegative(), followSlack: z.number().positive(), maxDrift: z.number().positive(), yShare: z.number().min(0).max(1) }).optional(),
  /** Паника: союзник ниже этой доли ОЗ — лечащие активные навыки идут раньше остальных. */
  panicPct: z.number().min(0).max(1).optional(),
  /**
   * Прыжок в тыл (навык с dash): stay — остаётся в тылу (иначе бьёт и прыгает назад); priority — кого из тыла выбирать:
   * healer, support (по роли), ranged (дальний бой), tank, damage; пусто — по селектору навыка.
   */
  dive: z.object({ stay: z.boolean(), priority: z.array(z.enum(['healer', 'support', 'ranged', 'tank', 'damage'])).default([]) }).optional(),
  /** Заход сбоку: встаёт у цели под углом angle (градусы от своей стороны, 90 — сбоку); avoidRole — такую цель берёт последней. */
  flank: z.object({ angle: z.number().min(0).max(180), avoidRole: role.optional() }).optional(),
  /**
   * Перехват (страж): ближний враг дошёл до нашего дальнего бойца (или прыгнул в тыл) — ближайший свободный страж не дальше
   * radius от врага рывком встаёт между ними и сражается с ним. Не чаще cooldown секунд на стража.
   */
  intercept: z.object({ radius: z.number().positive(), cooldown: z.number().nonnegative() }).optional(),
  /** Защитник: цель сражения — враг, ближайший к союзнику под своей связью (без связи — к самому раненому союзнику). */
  protect: z.boolean().optional(),
});

export type BehaviorProfile = z.infer<typeof BehaviorProfileSchema>;

/** Ярость всех после afterSeconds боя: урон × (1 + perSecond × секунд сверх порога) — бои не тянутся до таймера. */
export const EnrageSchema = z.object({ afterSeconds: z.number().positive(), perSecond: z.number().nonnegative() });
export type EnrageConfig = z.infer<typeof EnrageSchema>;

/** Часть data/combat.json про поведение — проверяется content:check. */
export const BehaviorConfigSchema = z.object({
  behaviors: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), BehaviorProfileSchema),
  /** Профиль по умолчанию: ключ `<kind>_<role>_<melee|ranged>`, затем `<kind>` (hero, monster, boss); нет — line. */
  behaviorDefaults: z.record(z.string(), z.string()).default({}),
  enrage: EnrageSchema.optional(),
});

/** Нулевой профиль: поведение боя до профилей (ближний держит линию, дальний стоит на слоте). */
export const LINE: BehaviorProfile = { name: 'Держит линию' };

/** id профиля юнита: свой (behavior) → по умолчанию по виду, роли и дальности → line. */
export function behaviorId(def: Pick<UnitDef, 'behavior' | 'kind' | 'role'>, ranged: boolean, cfg: CombatConfig): string {
  const lib = cfg.behaviors ?? {};
  if (def.behavior && lib[def.behavior]) return def.behavior;
  const d = cfg.behaviorDefaults ?? {};
  return d[`${def.kind}_${def.role}_${ranged ? 'ranged' : 'melee'}`] ?? d[def.kind] ?? 'line';
}

/**
 * Профиль юнита для боя. on = false — бой «как до профилей» (BattleOptions.behavior false): от профиля остаётся только
 * «прыгнув в тыл, остаётся там» (раньше — список combat.json movement.diveStay).
 */
export function resolveBehavior(def: Pick<UnitDef, 'behavior' | 'kind' | 'role'>, ranged: boolean, cfg: CombatConfig, on = true): { id: string; profile: BehaviorProfile } {
  const id = behaviorId(def, ranged, cfg);
  const p = cfg.behaviors?.[id] ?? LINE;
  if (on) return { id, profile: p };
  return { id: 'line', profile: p.dive?.stay ? { name: LINE.name, dive: { stay: true, priority: [] } } : LINE };
}

/** Проверка профилей: ✗ — неизвестный профиль у юнита/профессии/героя, битая библиотека; ⚠ — профиль без смысла. */
export function lintBehaviors(content: Content, cfg: CombatConfig): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = BehaviorConfigSchema.safeParse({ behaviors: cfg.behaviors ?? {}, behaviorDefaults: cfg.behaviorDefaults ?? {}, enrage: cfg.enrage });
  if (!parsed.success) for (const i of parsed.error.issues) errors.push(`data/combat.json: ${i.path.join('.')} — ${i.message}`);
  const lib = cfg.behaviors ?? {};
  const known = (owner: string, id: string | undefined) => {
    if (id && !lib[id]) errors.push(`${owner}: неизвестный профиль поведения «${id}» (data/combat.json → behaviors)`);
  };
  for (const [k, v] of Object.entries(cfg.behaviorDefaults ?? {})) known(`data/combat.json behaviorDefaults.${k}`, v);
  const hasDash = (skills: (string | undefined)[]) => skills.some((s) => s && content.skills[s]?.effects.some((e) => e.type === 'dash'));
  for (const u of Object.values(content.units)) {
    known(`юнит ${u.id}`, u.behavior);
    const p = u.behavior ? lib[u.behavior] : undefined;
    if (p?.dive && !hasDash([u.skills.ult, ...u.skills.actives])) warnings.push(`юнит ${u.id}: профиль ${u.behavior} с прыжком, а навыка с dash нет`);
    for (const [i, ph] of (u.phases ?? []).entries()) {
      if (u.kind !== 'boss' && !u.barks) warnings.push(`юнит ${u.id}: фазы (phases) — у рядового монстра (не босс и не мини-босс с репликами)`);
      if (ph.bark && !u.barks?.[ph.bark]) warnings.push(`юнит ${u.id}: phases[${i}] — реплики ${ph.bark} нет в barks`);
      for (const a of ph.actions) {
        if (a.type === 'addActive') {
          const s = content.skills[a.skill];
          if (!s) errors.push(`юнит ${u.id}: phases[${i}] — навыка ${a.skill} нет`);
          else if (s.trigger) errors.push(`юнит ${u.id}: phases[${i}] — ${a.skill} пассивка, а нужен активный навык`);
        }
        if (a.type === 'summon' && !content.units[a.unit]) errors.push(`юнит ${u.id}: phases[${i}] — призыв неизвестного юнита ${a.unit}`);
        if (a.type === 'summon' && content.units[a.unit]?.phases) errors.push(`юнит ${u.id}: phases[${i}] — призванный ${a.unit} сам с фазами`);
      }
    }
  }
  for (const j of Object.values(content.jobs)) known(`профессия ${j.id}`, j.behavior);
  for (const t of Object.values(content.heroes)) {
    known(`карточка ${t.id}`, t.behavior);
    t.branches.forEach((b) => known(`карточка ${t.id} ветка ${b.job}`, b.behavior));
  }
  return { errors, warnings };
}
