import { z } from 'zod';
import type { Content, UnitDef } from './types';
import type { CombatConfig } from './types';
import { ElementsConfigSchema } from './elements';

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
  /**
   * Маг: навык с полем area бьёт по кругу там, где больше всего врагов (центр — враг с наибольшим числом соседей в радиусе
   * навыка), круг виден на земле всё время каста. Лучшее скопление меньше minCluster — навык бьёт как раньше.
   */
  area: z.object({ minCluster: z.number().int().positive() }).optional(),
  /**
   * Контрмаг: одиночный навык со статусом interrupt бьёт врага, который сейчас кастует (сбивает каст); если у врагов есть
   * касты, но сейчас никто не кастует, — держит такой навык готовым до hold секунд.
   */
  counter: z.object({ hold: z.number().nonnegative() }).optional(),
  /** Бард: стоит в центре живых союзников, сдвинувшись на backOffset к своему краю; идёт, если центр ушёл дальше followSlack. */
  center: z.object({ backOffset: z.number().nonnegative(), followSlack: z.number().positive() }).optional(),
  /**
   * Таран: цель сражения (в начале боя и после убийства) и рывок навыка с pick nearest — враг с наибольшим числом врагов
   * в радиусе radius (удары по площади задевают больше).
   */
  cluster: z.object({ radius: z.number().positive() }).optional(),
  /** Торговец: враг ниже доли pct ОЗ не дальше radius — добить (если текущая цель выше половины ОЗ). */
  execute: z.object({ pct: z.number().min(0).max(1), radius: z.number().positive() }).optional(),
  /** Стая: ближние со стаей бьют того, кого уже бьют сородичи по стае (не больше limit сородичей на цель). */
  pack: z.object({ limit: z.number().int().positive() }).optional(),
  /**
   * Трус: ниже доли hpPct ОЗ один раз за бой бежит к своим (к лекарю, иначе к своему краю поля) и seconds секунд не бьёт;
   * бегущий получает урон × (1 + damageTaken); последний живой своей стороны не бежит.
   */
  coward: z.object({ hpPct: z.number().min(0).max(1), seconds: z.number().positive(), damageTaken: z.number().nonnegative() }).optional(),
});

export type BehaviorProfile = z.infer<typeof BehaviorProfileSchema>;

/**
 * Ярость всех после afterSeconds боя: урон × (1 + perSecond × секунд сверх порога), лечение и щиты × (1 − healPerSecond × секунд
 * сверх порога, не меньше 0) — бои не тянутся до таймера («время вышло» при живом отряде — QA RN-22).
 */
export const EnrageSchema = z.object({ afterSeconds: z.number().positive(), perSecond: z.number().nonnegative(), healPerSecond: z.number().nonnegative().default(0) });
export type EnrageConfig = z.infer<typeof EnrageSchema>;

/**
 * Живучесть врагов (бои «на пределе» глав 6, 9, 10 уходили в «время вышло»): лечение и щиты от юнитов видов kinds одной цели
 * чаще чем раз в window секунд слабеет — каждое следующее × repeat (не ниже floor); щиты от них не складываются (новый
 * щит только догоняет прежний до своей величины), если stackShields false.
 */
export const SustainSchema = z.object({
  $comment: z.string().optional(),
  kinds: z.array(z.enum(['hero', 'monster', 'boss'])).min(1),
  window: z.number().positive(),
  repeat: z.number().min(0).max(1),
  floor: z.number().min(0).max(1),
  stackShields: z.boolean(),
});
export type SustainConfig = z.infer<typeof SustainSchema>;

/** Часть data/combat.json про поведение — проверяется content:check. */
export const BehaviorConfigSchema = z.object({
  behaviors: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), BehaviorProfileSchema),
  /** Профиль по умолчанию: ключ `<kind>_<role>_<melee|ranged>`, затем `<kind>` (hero, monster, boss); нет — line. */
  behaviorDefaults: z.record(z.string(), z.string()).default({}),
  enrage: EnrageSchema.optional(),
  sustain: SustainSchema.optional(),
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
  const parsed = BehaviorConfigSchema.safeParse({ behaviors: cfg.behaviors ?? {}, behaviorDefaults: cfg.behaviorDefaults ?? {}, enrage: cfg.enrage, sustain: cfg.sustain });
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
  for (const s of Object.values(content.skills)) {
    if (s.aura && s.trigger !== 'turnStart') errors.push(`навык ${s.id}: аура (aura) работает только у пассивки trigger turnStart`);
    if (s.area && (s.trigger || s.target.side !== 'enemy')) errors.push(`навык ${s.id}: удар по кругу (area) — только у активного навыка по врагам`);
  }
  for (const u of Object.values(content.units))
    if (u.kind === 'boss' && u.behavior && (lib[u.behavior]?.coward || lib[u.behavior]?.pack)) warnings.push(`юнит ${u.id}: босс с профилем ${u.behavior} (трус/стая — для рядовых)`);
  // Стихии и заряд босса (docs/design/battle-decisions.md).
  if (cfg.elements) {
    const el = ElementsConfigSchema.safeParse(cfg.elements);
    if (!el.success) for (const i of el.error.issues) errors.push(`data/combat.json: elements.${i.path.join('.')} — ${i.message}`);
  }
  for (const u of Object.values(content.units)) {
    if (!u.charge) continue;
    const s = content.skills[u.charge.skill];
    if (!s) errors.push(`юнит ${u.id}: заряд (charge) — навыка ${u.charge.skill} нет`);
    else if (s.castTime <= 0 || s.trigger || s.target.side !== 'enemy') errors.push(`юнит ${u.id}: заряд ${s.id} — нужен навык по врагам с кастом (castTime > 0)`);
    if (u.kind !== 'boss') warnings.push(`юнит ${u.id}: заряд (charge) — у рядового монстра`);
  }
  for (const j of Object.values(content.jobs)) known(`профессия ${j.id}`, j.behavior);
  for (const t of Object.values(content.heroes)) {
    known(`карточка ${t.id}`, t.behavior);
    t.branches.forEach((b) => known(`карточка ${t.id} ветка ${b.job}`, b.behavior));
  }
  return { errors, warnings };
}
