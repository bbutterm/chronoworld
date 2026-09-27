import type { Stats, UnitDef } from '../content/schema';
import type { Gender, JobDef } from '../progression/schema';
import { GameRuleError, type GameContext } from '../progression/types';
import type { HeroState } from '../save/schema';
import { rarityIndex, CARD_RARITIES, type CardRarity, type CardSkill, type CardStatMods, type CardTrack, type HeroTemplate, type RarityDef } from './schema';

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

/** Дорожка роста: сюжетные — story; призывные — first (первая профессия) или second (вторая). */
export function cardTrack(t: HeroTemplate, ctx: Pick<GameContext, 'content'>): CardTrack {
  if (t.source === 'story') return 'story';
  return (ctx.content.jobs[t.job]?.tier ?? 1) >= 2 ? 'second' : 'first';
}

/** Активная форма карточки на редкости rarity: у сюжетных с формой — вторая профессия, иначе — сам шаблон. */
export interface ActiveForm {
  job: string;
  role: HeroTemplate['role'];
  statMods: CardStatMods;
  skills: CardSkill[];
  /** Свой лист спрайта формы (или базовой формы шаблона). */
  sprite?: string;
  /** Редкость, с которой действует форма (undefined — базовая форма шаблона). */
  fromRarity?: CardRarity;
}

export function activeForm(t: HeroTemplate, rarity: CardRarity): ActiveForm {
  let form: ActiveForm = { job: t.job, role: t.role, statMods: t.statMods, skills: t.skills, ...(t.visual.sprite ? { sprite: t.visual.sprite } : {}) };
  for (const f of t.forms) {
    if (rarityIndex(f.rarity) <= rarityIndex(rarity)) {
      form = { job: f.job, role: f.role ?? t.role, statMods: f.statMods, skills: f.skills, fromRarity: f.rarity, ...(f.visual.sprite ? { sprite: f.visual.sprite } : {}) };
    }
  }
  return form;
}

const tmpl = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext) => heroTemplate(ctx, hero.templateId);

export const heroName = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext): string => ctx.content.heroes[hero.templateId]?.name ?? hero.templateId;
export const heroGender = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext): Gender => ctx.content.heroes[hero.templateId]?.gender ?? 'm';
/** Класс (id профессии) карточки сейчас — с учётом формы. */
export const heroJobId = (hero: Pick<HeroState, 'templateId' | 'rarity'>, ctx: GameContext): string => activeForm(tmpl(hero, ctx), hero.rarity).job;
export const heroRole = (hero: Pick<HeroState, 'templateId' | 'rarity'>, ctx: GameContext): HeroTemplate['role'] => activeForm(tmpl(hero, ctx), hero.rarity).role;
/** Свой лист спрайта карточки сейчас (форма или шаблон); undefined — лист класса по полу (решает UI по реестру листов). */
export const heroSpriteOverride = (hero: Pick<HeroState, 'templateId' | 'rarity'>, ctx: GameContext): string | undefined =>
  ctx.content.heroes[hero.templateId] ? activeForm(tmpl(hero, ctx), hero.rarity).sprite : undefined;
/** Линия карточки (первая профессия ветки). */
export const heroLine = (hero: Pick<HeroState, 'templateId'>, ctx: GameContext): string => tmpl(hero, ctx).line;

function jobOf(ctx: GameContext, jobId: string): JobDef {
  const job = ctx.content.jobs[jobId];
  if (!job) throw new GameRuleError('unknown_job', `Неизвестная профессия: ${jobId}`);
  return job;
}

/** Статы карточки шаблона t на уровне level и редкости rarity (без экипировки), округление до целых. */
export function cardStats(t: HeroTemplate, level: number, rarity: CardRarity, ctx: GameContext): Stats {
  const line = jobOf(ctx, t.line);
  const mods = activeForm(t, rarity).statMods;
  const mult = rarityDef(ctx, rarity).statMult;
  const k = Math.max(0, level - 1);
  const b = line.baseStats;
  const stat = (key: 'hp' | 'atk' | 'def' | 'spd') => Math.round((b[key] + line.growth[key] * k) * (mods[key] ?? 1) * mult);
  return { hp: stat('hp'), atk: stat('atk'), def: stat('def'), spd: stat('spd'), ...(b.moveSpeed ? { moveSpeed: b.moveSpeed } : {}) };
}

/** Статы экземпляра (без экипировки). */
export function heroStats(hero: HeroState, ctx: GameContext): Stats {
  return cardStats(tmpl(hero, ctx), hero.level, hero.rarity, ctx);
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
  const form = activeForm(tmpl(hero, ctx), hero.rarity);
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
  const form = activeForm(t, hero.rarity);
  const job = jobOf(ctx, form.job);
  const skills = heroSkills(hero, ctx);
  const base = heroStats(hero, ctx);
  const g = gear ?? ctx.heroGear?.[hero.id];
  const stats: Stats = g ? { ...base, hp: base.hp + g.hp, atk: base.atk + g.atk, def: base.def + g.def, spd: base.spd + g.spd } : base;
  const power = rarityDef(ctx, hero.rarity).skillPower;
  return {
    id: hero.id,
    name: t.name,
    kind: 'hero',
    role: form.role,
    stats,
    skills: { basic: skills.basic, actives: skills.actives, passives: skills.passives },
    visual: job.visual,
    ...(power !== 1 ? { skillPower: power } : {}),
  };
}

/** Всё о карточке для экранов «Герои» / «Герой» (H4) одним объектом. */
export interface HeroCard {
  heroId: string;
  templateId: string;
  name: string;
  gender: Gender;
  source: HeroTemplate['source'];
  track: CardTrack;
  /** Класс сейчас (с учётом формы) и его название. */
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
  /** Класс второй формы (сюжетные), если ещё не открыт: { rarity, job, jobName }. */
  nextForm?: { rarity: CardRarity; job: string; jobName: string };
  bio: string;
  hook: string;
  locked: boolean;
  isNew: boolean;
}

export function heroCard(hero: HeroState, ctx: GameContext): HeroCard {
  const t = tmpl(hero, ctx);
  const form = activeForm(t, hero.rarity);
  const next = t.forms.find((f) => rarityIndex(f.rarity) > rarityIndex(hero.rarity));
  return {
    heroId: hero.id,
    templateId: t.id,
    name: t.name,
    gender: t.gender,
    source: t.source,
    track: cardTrack(t, ctx),
    job: form.job,
    jobName: ctx.content.jobs[form.job]?.name ?? form.job,
    line: t.line,
    role: form.role,
    rarity: rarityDef(ctx, hero.rarity),
    maxRarity: t.maxRarity,
    level: hero.level,
    maxLevel: maxLevelOf(ctx, hero.rarity),
    stats: heroStats(hero, ctx),
    skills: heroSkillList(hero, ctx),
    ...(next ? { nextForm: { rarity: next.rarity, job: next.job, jobName: ctx.content.jobs[next.job]?.name ?? next.job } } : {}),
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
