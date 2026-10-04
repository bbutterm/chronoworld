import type { Stats, UnitDef } from '../content/schema';
import type { Gender, JobDef } from '../progression/schema';
import { GameRuleError, type GameContext } from '../progression/types';
import type { HeroState } from '../save/schema';
import { BRANCH_RARITY, rarityIndex, CARD_RARITIES, type CardRarity, type CardSkill, type CardStatMods, type HeroBranch, type HeroTemplate, type RarityDef } from './schema';

/**
 * Карточка героя: шаблон + экземпляр → имя, класс, роль, статы, навыки, юнит боя.
 * Статы: (статы линии на уровне L) × statMods формы × statMult редкости, где статы линии — baseStats + growth × (L − 1)
 * первой профессии линии (data/jobs; базы вторых профессий карточками не используются — docs/design/heroes.md, раздел 1).
 */

/** Шаблон карточки; нет — GameRuleError('unknown_template'). */
export function heroTemplate(ctx: GameContext, templateId: string): HeroTemplate {
  const t = ctx.content.heroes[templateId];
  if (!t) throw new GameRuleError('unknown_template', `Неизвестная карточка героя: ${templateId}`);
  return t;
}

/** Описание редкости из data/cards.json. */
export function rarityDef(ctx: GameContext, rarity: CardRarity): RarityDef {
  return ctx.cards.rarities[rarityIndex(rarity)];
}

/** Предел уровня редкости. */
export function maxLevelOf(ctx: GameContext, rarity: CardRarity): number {
  return rarityDef(ctx, rarity).maxLevel;
}

/** Следующая редкость (после красной — null). */
export function nextRarity(rarity: CardRarity): CardRarity | null {
  return CARD_RARITIES[rarityIndex(rarity) + 1] ?? null;
}

/** Самая низкая редкость, на которой возможен уровень level (не ниже min). */
export function rarityForLevel(ctx: GameContext, level: number, min: CardRarity = 'green'): CardRarity {
  for (const r of CARD_RARITIES.slice(rarityIndex(min))) if (maxLevelOf(ctx, r) >= level) return r;
  return 'red';
}

/** Первая профессия ветки (tier 1) для профессии jobId: для Рыцаря — Мечник. Новичок и неизвестные — сам jobId. */
export function lineOf(ctx: Pick<GameContext, 'content'>, jobId: string): string {
  let cur = ctx.content.jobs[jobId];
  const seen = new Set<string>();
  while (cur && cur.tier > 1 && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = cur.from.map((f) => ctx.content.jobs[f]).find((j) => j && j.tier < cur!.tier);
    if (!parent) break;
    cur = parent;
  }
  return cur?.id ?? jobId;
}

/** Форма героя сейчас: первая профессия (шаблон) или ветка второй профессии (фиолетовый и выше с выбранной веткой). */
export interface ActiveForm {
  job: string;
  role: HeroTemplate['role'];
  statMods: CardStatMods;
  skills: CardSkill[];
  /** Ульта формы (на энергии, с 1-го уровня; docs/design/battle-decisions.md §1). */
  ult?: string;
  /** Свой лист спрайта формы (или первой профессии шаблона). */
  sprite?: string;
  /** Ветка второй профессии (id профессии), если форма — ветка. */
  branch?: string;
  /** Строка возвышения ветки. */
  promotion?: string;
  bio?: string;
  advanced?: boolean;
  /** Профиль поведения формы в бою (переопределение профиля профессии). */
  behavior?: string;
}

/** Что нужно знать об экземпляре для формы: редкость и выбранная ветка. */
export type FormKey = Pick<HeroState, 'rarity'> & { branch?: string; level?: number };

/** Ветка шаблона по id профессии (нет такой — undefined). */
export function branchOf(t: HeroTemplate, job: string | undefined): HeroBranch | undefined {
  return job ? t.branches.find((b) => b.job === job) : undefined;
}

/** Действующая ветка: редкость ≥ BRANCH_RARITY и ветка есть у шаблона; иначе undefined. */
export function activeBranch(t: HeroTemplate, hero: FormKey): HeroBranch | undefined {
  if (rarityIndex(hero.rarity) < rarityIndex(BRANCH_RARITY)) return undefined;
  return branchOf(t, hero.branch);
}

export function baseForm(t: HeroTemplate): ActiveForm {
  return { job: t.job, role: t.role, statMods: t.statMods, skills: t.skills, ...(t.ult ? { ult: t.ult } : {}), ...(t.visual.sprite ? { sprite: t.visual.sprite } : {}), ...(t.behavior ? { behavior: t.behavior } : {}) };
}

export function branchForm(b: HeroBranch): ActiveForm {
  return {
    job: b.job,
    role: b.role,
    statMods: b.statMods,
    skills: b.skills,
    ...(b.ult ? { ult: b.ult } : {}),
    branch: b.job,
    promotion: b.promotion,
    bio: b.bio,
    ...(b.visual.sprite ? { sprite: b.visual.sprite } : {}),
    ...(b.behavior ? { behavior: b.behavior } : {}),
  };
}

/** Форма экземпляра: ветка (фиолетовый и выше с выбранной веткой) или первая профессия. */
export function activeForm(t: HeroTemplate, hero: FormKey): ActiveForm {
  const b = activeBranch(t, hero);
  if (!b) return baseForm(t);
  const a = b.advanced;
  if (a && hero.level !== undefined && hero.level >= a.minLevel && rarityIndex(hero.rarity) >= rarityIndex(a.minRarity)) {
    return { ...branchForm(a), branch: b.job, advanced: true };
  }
  return branchForm(b);
}

/** Фиолетовый и выше без выбранной ветки — «Выберите ветку!» (выбор бесплатный, branch.ts chooseBranch). */
export function needsBranch(hero: Pick<HeroState, 'templateId' | 'rarity' | 'branch'>, ctx: GameContext): boolean {
  const t = ctx.content.heroes[hero.templateId];
  return !!t && rarityIndex(hero.rarity) >= rarityIndex(BRANCH_RARITY) && !activeBranch(t, hero);
}

type HeroKey = Pick<HeroState, 'templateId' | 'rarity'> & { branch?: string; level?: number };
const tmpl = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext) => heroTemplate(ctx, hero.templateId);

export const heroName = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext): string => ctx.content.heroes[hero.templateId]?.name ?? hero.templateId;
export const heroGender = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext): Gender => ctx.content.heroes[hero.templateId]?.gender ?? 'm';
/** Название профессии по полу героя: у героинь — nameF («Жрица»), если задано (data/jobs). Одно место для всех экранов. */
export function jobTitle(ctx: GameContext, job: string, gender: Gender = 'm'): string {
  const j = ctx.content.jobs[job];
  if (!j) return job;
  return gender === 'f' && j.nameF ? j.nameF : j.name;
}
/** Класс (id профессии) героя сейчас — с учётом ветки. */
export const heroJobId = (hero: HeroKey, ctx: GameContext): string => activeForm(tmpl(hero, ctx), hero).job;
export const heroRole = (hero: HeroKey, ctx: GameContext): HeroTemplate['role'] => activeForm(tmpl(hero, ctx), hero).role;
/** Свой лист спрайта героя сейчас (ветка или первая профессия); undefined — лист класса по полу (решает UI по реестру листов). */
export const heroSpriteOverride = (hero: HeroKey, ctx: GameContext): string | undefined =>
  ctx.content.heroes[hero.templateId] ? activeForm(tmpl(hero, ctx), hero).sprite : undefined;
/** Линия героя (первая профессия ветки). */
export const heroLine = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext): string => tmpl(hero, ctx).line;

function jobOf(ctx: GameContext, jobId: string): JobDef {
  const job = ctx.content.jobs[jobId];
  if (!job) throw new GameRuleError('unknown_job', `Неизвестная профессия: ${jobId}`);
  return job;
}

/** Статы героя шаблона t на уровне level, редкости rarity и ветке branch (без экипировки), округление до целых. */
export function cardStats(t: HeroTemplate, level: number, rarity: CardRarity, ctx: GameContext, branch?: string): Stats {
  const line = jobOf(ctx, t.line);
  const mods = activeForm(t, { rarity, branch, level }).statMods;
  const mult = rarityDef(ctx, rarity).statMult;
  const k = Math.max(0, level - 1);
  const b = line.baseStats;
  const stat = (key: 'hp' | 'atk' | 'def' | 'spd') => Math.round((b[key] + line.growth[key] * k) * (mods[key] ?? 1) * mult);
  return { hp: stat('hp'), atk: stat('atk'), def: stat('def'), spd: stat('spd'), ...(b.moveSpeed ? { moveSpeed: b.moveSpeed } : {}) };
}

/** Статы экземпляра (без экипировки). */
export function heroStats(hero: HeroState, ctx: GameContext): Stats {
  return cardStats(tmpl(hero, ctx), hero.level, hero.rarity, ctx, hero.branch);
}

export interface CardSkillView {
  skill: string;
  /** Уровень открытия. */
  level: number;
  unlocked: boolean;
  /** Пассивка (есть trigger). */
  passive: boolean;
}

/** Все навыки текущей формы по порядку открытия (открытые и закрытые). */
export function heroSkillList(hero: HeroState, ctx: GameContext): CardSkillView[] {
  const form = activeForm(tmpl(hero, ctx), hero);
  return [...form.skills]
    .sort((a, b) => a.level - b.level)
    .map((s) => ({ skill: s.skill, level: s.level, unlocked: s.level <= hero.level, passive: !!ctx.content.skills[s.skill]?.trigger }));
}

export interface HeroSkills {
  basic: string;
  /** Активные навыки по порядку открытия (в бою — по перезарядке и приоритету). */
  actives: string[];
  passives: string[];
}

/** Открытые навыки: обычная атака класса + навыки формы до уровня героя. */
export function heroSkills(hero: HeroState, ctx: GameContext): HeroSkills {
  const job = jobOf(ctx, heroJobId(hero, ctx));
  const open = heroSkillList(hero, ctx).filter((s) => s.unlocked);
  return { basic: job.basic, actives: open.filter((s) => !s.passive).map((s) => s.skill), passives: open.filter((s) => s.passive).map((s) => s.skill) };
}

/** Прибавка экипировки к статам героя (сумма статов надетых предметов). */
export interface StatBonus {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

/**
 * K6. Необязательная часть контекста: прибавки экипировки по id героя. Заполняет equipment/withGear(ctx, save),
 * чтобы playStage/skipStage (они вызывают buildUnit(hero, ctx)) учитывали экипировку без знания о save.inventory.
 */
export interface GearLookup {
  heroGear?: Readonly<Record<string, StatBonus>>;
}

/**
 * Карточка игрока → юнит боя. id юнита = id героя. Вид — класс формы (visual профессии); свой лист карточки и лист
 * по полу подставляет UI (flow.ts heroSprite — он знает реестр листов). Экипировка — явный gear, иначе ctx.heroGear[hero.id]. skillPower — «сила навыков» редкости.
 */
export function buildUnit(hero: HeroState, ctx: GameContext & GearLookup, gear?: StatBonus): UnitDef {
  const t = tmpl(hero, ctx);
  const form = activeForm(t, hero);
  const job = jobOf(ctx, form.job);
  const skills = heroSkills(hero, ctx);
  const base = heroStats(hero, ctx);
  const g = gear ?? ctx.heroGear?.[hero.id];
  const stats: Stats = g ? { ...base, hp: base.hp + g.hp, atk: base.atk + g.atk, def: base.def + g.def, spd: base.spd + g.spd } : base;
  const power = rarityDef(ctx, hero.rarity).skillPower;
  // Профиль поведения в бою: форма (ветка / первая профессия шаблона) → профессия (docs/design/battle-behavior.md §2.1).
  const behavior = form.behavior ?? job.behavior;
  return {
    id: hero.id,
    name: t.name,
    kind: 'hero',
    role: form.role,
    stats,
    // Ульта формы — с 1-го уровня, на энергии (battle.ts fireUlt; ручной режим держит её до касания).
    skills: { basic: skills.basic, actives: skills.actives, passives: skills.passives, ...(form.ult ? { ult: form.ult } : {}) },
    visual: job.visual,
    ...(power !== 1 ? { skillPower: power } : {}),
    ...(behavior ? { behavior } : {}),
    // Энергия на ульту героя (combat.json energy.hero): от времени, ходов и ударов по ОЗ.
    ...(ctx.combat.energy.hero ? { energy: ctx.combat.energy.hero } : {}),
  };
}

/** Ветка для экранов: класс, название, роль, навыки, строка возвышения, лист. */
export interface BranchView {
  job: string;
  jobName: string;
  role: HeroTemplate['role'];
  skills: CardSkill[];
  /** Ульта ветки. */
  ult?: string;
  promotion: string;
  /** История формы после возвышения (может не быть). */
  bio?: string;
  sprite?: string;
  advanced?: BranchView & { minRarity: CardRarity; minLevel: number };
}

export function branchView(b: HeroBranch, ctx: GameContext, gender: Gender = 'm'): BranchView {
  return {
    job: b.job,
    jobName: jobTitle(ctx, b.job, gender),
    ...(b.advanced ? { advanced: { ...branchView(b.advanced, ctx, gender), minRarity: b.advanced.minRarity, minLevel: b.advanced.minLevel } } : {}),
    role: b.role,
    skills: b.skills,
    ...(b.ult ? { ult: b.ult } : {}),
    promotion: b.promotion,
    ...(b.bio ? { bio: b.bio } : {}),
    ...(b.visual.sprite ? { sprite: b.visual.sprite } : {}),
  };
}

/** Обе ветки героя (для превью на синем, выбора на вознесении и «Сменить ветку»). */
export function branchOptions(templateId: string, ctx: GameContext): BranchView[] {
  const t = heroTemplate(ctx, templateId);
  return t.branches.map((b) => branchView(b, ctx, t.gender));
}

/** Pure recipient preview; persisted branch remains the second-profession ID. */
export function branchPreview(templateId: string, branch: string, ctx: GameContext, recipient?: HeroState) {
  const hero: HeroState = { ...(recipient ?? { id: 'preview', level: 1, rarity: BRANCH_RARITY }), templateId, branch,
    rarity: recipient && rarityIndex(recipient.rarity) >= rarityIndex(BRANCH_RARITY) ? recipient.rarity : BRANCH_RARITY };
  const form = activeForm(heroTemplate(ctx, templateId), hero);
  return { hero, form, card: heroCard(hero, ctx) };
}

/** Всё о герое для экранов «Герои» / «Герой» одним объектом. */
export interface HeroCard {
  heroId: string;
  templateId: string;
  name: string;
  gender: Gender;
  source: HeroTemplate['source'];
  /** Класс сейчас (с учётом ветки) и его название. */
  job: string;
  jobName: string;
  line: string;
  role: HeroTemplate['role'];
  rarity: RarityDef;
  maxRarity: CardRarity;
  level: number;
  maxLevel: number;
  stats: Stats;
  skills: CardSkillView[];
  /** Ульта текущей формы (id навыка): открыта с 1-го уровня, срабатывает на полной энергии. */
  ult?: string;
  /** Выбранная ветка (действует с фиолетового): id профессии. */
  branch?: string;
  /** Фиолетовый и выше без ветки — «Выберите ветку!». */
  needsBranch: boolean;
  /** Обе ветки героя (превью «на фиолетовом: Рыцарь или Крестоносец», выбор, смена). */
  branches: BranchView[];
  /** Редкость, на которой выбирается ветка (если герой ещё ниже неё) — для подписи «с фиолетового». */
  branchAt?: CardRarity;
  advanced: boolean;
  formBio?: string;
  promotion?: string;
  bio: string;
  hook: string;
  locked: boolean;
  isNew: boolean;
}

export function heroCard(hero: HeroState, ctx: GameContext): HeroCard {
  const t = tmpl(hero, ctx);
  const form = activeForm(t, hero);
  const below = rarityIndex(hero.rarity) < rarityIndex(BRANCH_RARITY);
  return {
    heroId: hero.id,
    templateId: t.id,
    name: t.name,
    gender: t.gender,
    source: t.source,
    job: form.job,
    jobName: jobTitle(ctx, form.job, t.gender),
    line: t.line,
    role: form.role,
    rarity: rarityDef(ctx, hero.rarity),
    maxRarity: t.maxRarity,
    level: hero.level,
    maxLevel: maxLevelOf(ctx, hero.rarity),
    stats: heroStats(hero, ctx),
    skills: heroSkillList(hero, ctx),
    ...(form.ult ? { ult: form.ult } : {}),
    ...(form.branch ? { branch: form.branch } : {}),
    needsBranch: needsBranch(hero, ctx),
    branches: t.branches.map((b) => branchView(b, ctx, t.gender)),
    ...(below ? { branchAt: BRANCH_RARITY } : {}),
    advanced: !!form.advanced,
    formBio: form.bio,
    promotion: form.promotion,
    bio: t.bio,
    hook: t.hook,
    locked: !!hero.locked,
    isNew: !!hero.isNew,
  };
}

/** Порядок сюжетных героев: стартовые, затем рекруты (hero1…heroN в сюжете). */
export function storyOrder(ctx: GameContext): string[] {
  return [...ctx.progression.heroes.start, ...ctx.progression.heroes.recruits.map((r) => r.template)];
}

/** id нового экземпляра: h<наибольший номер + 1> (номера съеденных кормом карточек не переиспользуются, пока есть старшие). */
export function newHeroId(heroes: readonly Pick<HeroState, 'id'>[]): string {
  let max = 0;
  for (const h of heroes) {
    const m = /^h(\d+)$/.exec(h.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `h${max + 1}`;
}
