import { enemySquad, getStage } from '../campaign/campaign';
import type { UnitDef } from '../content/schema';
import { buildUnit } from '../heroes/card';
import { BRANCH_RARITY, CARD_RARITIES, rarityIndex, type CardRarity } from '../heroes/schema';
import type { HeroState, SaveState } from '../save/schema';
import type { FeatureContext, PowerConfig } from './config';
import { recommendedFactor, recommendedPower, unitPower } from './power';

/**
 * Уровни врагов и рекомендуемый уровень героев (запрос владельца: «чтоб было видно, какие примерно должны быть герои, чтобы
 * победить, а не только мощь»). Только отображение: бой, награды и мощь не меняются. Калибровка — docs/content/balance.md, 4а.
 *
 * «Медианный герой» уровня L редкости R — медиана по всем формам карточек data/heroes (12 героев; с фиолетового — по веткам
 * второй профессии) без экипировки: отдельно по hp·atk и по мощи (unitPower).
 *
 * - Уровень врага: L, при котором hp·atk медианного героя ближе всего (по отношению) к hp·atk врага / enemyScale
 *   (босс рассчитан на весь отряд — ещё / bossScale и × поправка босс-этапа², см. unitLevel).
 *   Редкость R — полосы этапа (power.levels.bands); у башни и охоты её передаёт экран (progressLevelBand — полоса
 *   текущего этапа игрока). Босс охоты считается целиком (с запасом hp на урон) — «рейдовый» уровень выше отряда.
 * - Рекомендуемый уровень этапа: наименьший L, при котором squad медианных героев редкости R набирают мощь ≥ рекомендуемой
 *   (recommendedPower) — поэтому число согласовано с «Рекомендуемой мощью». L выше предела редкости — редкость выше.
 */

export type LevelBand = NonNullable<PowerConfig['levels']>['bands'][number];

/** Потолок поиска уровня врага (враги могут быть «выше» красных героев ур. 100 — число показывается как есть). */
export const MAX_ENEMY_LEVEL = 300;

const DEFAULT_BAND: LevelBand = { fromStage: '', rarity: 'green', squad: 5 };

interface Baseline {
  hpAtk: number;
  power: number;
}

const cache = new WeakMap<object, WeakMap<object, Map<string, Baseline>>>();

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Медианный герой уровня level редкости rarity: hp·atk и мощь (без экипировки). Кэшируется по контенту. */
export function baselineHero(level: number, rarity: CardRarity, ctx: FeatureContext): Baseline {
  let byPower = cache.get(ctx.content.heroes);
  if (!byPower) cache.set(ctx.content.heroes, (byPower = new WeakMap()));
  let map = byPower.get(ctx.features.power);
  if (!map) byPower.set(ctx.features.power, (map = new Map()));
  const key = `${rarity}:${level}`;
  const hit = map.get(key);
  if (hit) return hit;
  const hpAtk: number[] = [];
  const power: number[] = [];
  for (const t of Object.values(ctx.content.heroes)) {
    const branches = rarityIndex(rarity) >= rarityIndex(BRANCH_RARITY) && t.branches.length ? t.branches.map((b) => b.job) : [undefined];
    for (const branch of branches) {
      const hero: HeroState = { id: `baseline_${t.id}`, templateId: t.id, rarity, level, ...(branch ? { branch } : {}) };
      const u = buildUnit(hero, ctx);
      hpAtk.push(u.stats.hp * u.stats.atk);
      power.push(unitPower(u, ctx));
    }
  }
  const out = hpAtk.length ? { hpAtk: median(hpAtk), power: median(power) } : { hpAtk: 1, power: 1 };
  map.set(key, out);
  return out;
}

/** Уровень героя редкости rarity, чей hp·atk ближе всего к hpAtk (по отношению; 1…MAX_ENEMY_LEVEL). */
export function levelForHpAtk(hpAtk: number, rarity: CardRarity, ctx: FeatureContext): number {
  if (!(hpAtk > 0)) return 1;
  // Медиана монотонных по L рядов монотонна — двоичный поиск наибольшего L с baseline ≤ hpAtk.
  let lo = 1;
  let hi = MAX_ENEMY_LEVEL;
  if (baselineHero(1, rarity, ctx).hpAtk >= hpAtk) return 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (baselineHero(mid, rarity, ctx).hpAtk <= hpAtk) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= MAX_ENEMY_LEVEL) return MAX_ENEMY_LEVEL;
  const below = baselineHero(lo, rarity, ctx).hpAtk;
  const above = baselineHero(lo + 1, rarity, ctx).hpAtk;
  return Math.log(hpAtk / below) <= Math.log(above / hpAtk) ? lo : lo + 1;
}

/** Масштаб врагов power.levels.enemyScale (нет — 1). */
export function enemyScale(ctx: FeatureContext): number {
  return ctx.features.power.levels?.enemyScale ?? 1;
}

/** Масштаб боссов power.levels.bossScale (нет — 1). */
export function bossScale(ctx: FeatureContext): number {
  return ctx.features.power.levels?.bossScale ?? 1;
}

/**
 * Уровень врага: герой редкости rarity, у которого hp·atk = hp·atk врага / enemyScale. Босс (kind boss) рассчитан на весь
 * отряд: ещё / bossScale и × bossFactor² — поправка босс-этапа recommendedFactor (та же, что у рекомендуемой мощи; мощь
 * линейна по статам, hp·atk квадратична). Замер (balance.md, 4а): с ней bossScale у всех боссов 4–5, без неё — 4…8.
 * У рядовых врагов поправку не берём: у этапов из 3 врагов она > 1 (им нужен отряд сильнее суммы), но каждый враг
 * от этого не крепче. Башня и охота — bossFactor 1.
 * LT-03: hp·atk × supportFactor (лекари и юниты, что лечат/щитуют/усиливают союзников, — power.levels.roleScale,
 * supportScale); у врагов этапа кампании — не ниже stageFloor × рекомендуемого уровня этапа, босс — не ниже свиты.
 */
export function unitLevel(unit: UnitDef, rarity: CardRarity, ctx: FeatureContext, bossFactor = 1): number {
  const own = rawUnitLevel(unit, rarity, ctx, bossFactor);
  // Враг этапа кампании (id `<этап>_<слот>`, как у enemySquad) — нижняя граница этапа, босс — не ниже свиты. Так уровень
  // одинаков на подготовке (stageLevels) и в бою (экран боя зовёт unitLevel по одному юниту).
  const at = campaignSlot(unit, ctx);
  if (!at) return own;
  const floor = stageFloorLevel(at.stageId, rarity, ctx);
  let level = Math.max(own, floor);
  if (unit.kind === 'boss') {
    for (const e of enemySquad(at.stageId, ctx)) if (e && e.kind !== 'boss') level = Math.max(level, rawUnitLevel(e, rarity, ctx, bossFactor), floor);
  }
  return level;
}

/**
 * Множитель «поддержки» (LT-03): роль (power.levels.roleScale) и навыки лечения/щита/усиления других союзников (supportScale).
 * У боссов — 1 (босс рассчитан целиком, bossScale).
 */
export function supportFactor(unit: UnitDef, ctx: FeatureContext): number {
  const lv = ctx.features.power.levels;
  const role = lv?.roleScale?.[unit.role] ?? 1;
  const skills = ctx.content.skills;
  const ids = [unit.skills.basic, unit.skills.ult, ...(unit.skills.actives ?? []), ...(unit.skills.passives ?? [])];
  const helps = ids.some((id) => {
    const sk = id ? skills[id] : undefined;
    // Только помощь другим (щит «себе» — живучесть, она уже в hp); босс рассчитан целиком (bossScale), его не трогаем.
    return !!sk && sk.target.side === 'ally' && sk.target.pick !== 'self' && sk.effects.some((e) => e.type === 'heal' || e.type === 'shield' || (e.type === 'status' && Object.values(e.status.stats ?? {}).some((v) => (v ?? 0) > 0)));
  });
  return unit.kind === 'boss' ? 1 : Math.max(role, helps ? (lv?.supportScale ?? 1) : 1);
}

/** Уровень врага только по его статам (hp·atk × поддержка / масштаб), без границ этапа. */
function rawUnitLevel(unit: UnitDef, rarity: CardRarity, ctx: FeatureContext, bossFactor: number): number {
  const k = unit.kind === 'boss' ? (enemyScale(ctx) * bossScale(ctx)) / (bossFactor * bossFactor) : enemyScale(ctx);
  return levelForHpAtk((unit.stats.hp * unit.stats.atk * supportFactor(unit, ctx)) / k, rarity, ctx);
}

/** Этап и слот врага кампании по id `<этап>_<слот>` (enemySquad); иначе null (башня, охота, тестовые юниты). */
function campaignSlot(unit: UnitDef, ctx: FeatureContext): { stageId: string; slot: number } | null {
  const m = /^(.+)_(\d+)$/.exec(unit.id);
  if (!m || !ctx.content.stages.some((s) => s.id === m[1])) return null;
  return { stageId: m[1], slot: Number(m[2]) };
}

/**
 * Нижняя граница уровня врага этапа (power.levels.stageFloor × рекомендуемый уровень героев). Рекомендуемая редкость выше
 * редкости полосы (rarity) — граница от предела уровня редкости полосы. Нет stageFloor — 1.
 */
export function stageFloorLevel(stageId: string, rarity: CardRarity, ctx: FeatureContext): number {
  const share = ctx.features.power.levels?.stageFloor;
  if (!share) return 1;
  const rec = recommendedHeroLevel(stageId, ctx);
  const level = rec.rarity === rarity ? rec.level : rarityIndex(rec.rarity) > rarityIndex(rarity) ? ctx.cards.rarities[rarityIndex(rarity)].maxLevel : 1;
  return Math.max(1, Math.round(level * share));
}

/** Полоса этапа (power.levels.bands): последняя с fromStage не позже этапа. Нет полос — зелёные, отряд 5. */
export function levelBand(stageId: string, ctx: FeatureContext): LevelBand {
  const bands = ctx.features.power.levels?.bands ?? [];
  const idx = getStage(ctx, stageId).globalIndex;
  let band = bands[0] ?? DEFAULT_BAND;
  for (const b of bands) {
    const from = ctx.content.stages.find((s) => s.id === b.fromStage);
    if (from && from.globalIndex <= idx) band = b;
  }
  return band;
}

/** Полоса, по которой игроку показывают уровни вне кампании (башня, охота): следующий этап кампании (всё пройдено — последний). */
export function progressLevelBand(save: Pick<SaveState, 'campaign'>, ctx: FeatureContext): LevelBand {
  const stages = ctx.content.stages;
  if (!stages.length) return ctx.features.power.levels?.bands[0] ?? DEFAULT_BAND;
  const next = stages.find((s) => !save.campaign.cleared.includes(s.id)) ?? stages[stages.length - 1];
  return levelBand(next.id, ctx);
}

export interface RecommendedLevel {
  /** Уровень героев. */
  level: number;
  /** Их редкость (полоса этапа; поднята, если уровень выше её предела). */
  rarity: CardRarity;
  /** Сколько героев в расчёте. */
  squad: number;
}

/** Наименьший уровень, при котором squad медианных героев редкости rarity набирают мощь ≥ power (не выше предела редкости — иначе null). */
function levelForSquadPower(power: number, rarity: CardRarity, squad: number, ctx: FeatureContext): number | null {
  const max = ctx.cards.rarities[rarityIndex(rarity)].maxLevel;
  if (squad * baselineHero(1, rarity, ctx).power >= power) return 1;
  if (squad * baselineHero(max, rarity, ctx).power < power) return null;
  let lo = 1;
  let hi = max;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (squad * baselineHero(mid, rarity, ctx).power >= power) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * «Рекомендуем: герои ур. N (синие)»: наименьший уровень, при котором отряд полосы этапа (squad героев её редкости) набирает
 * мощь ≥ recommendedPower. Уровень выше предела редкости — берётся следующая редкость (у красных — предел 100 и выше не растёт).
 */
export function recommendedHeroLevel(stageId: string, ctx: FeatureContext): RecommendedLevel {
  const band = levelBand(stageId, ctx);
  const power = recommendedPower(stageId, ctx);
  for (const rarity of CARD_RARITIES.slice(rarityIndex(band.rarity))) {
    const level = levelForSquadPower(power, rarity, band.squad, ctx);
    if (level !== null) return { level, rarity, squad: band.squad };
  }
  const red = CARD_RARITIES[CARD_RARITIES.length - 1];
  return { level: ctx.cards.rarities[rarityIndex(red)].maxLevel, rarity: red, squad: band.squad };
}

/** Уровни врагов по слотам (null — пустой слот). */
export function unitLevels(units: readonly (UnitDef | null)[], rarity: CardRarity, ctx: FeatureContext, bossFactor = 1): (number | null)[] {
  return units.map((u) => (u ? unitLevel(u, rarity, ctx, bossFactor) : null));
}

export interface EnemyLevels {
  /** Уровни врагов по слотам (null — пусто). */
  enemies: (number | null)[];
  /** Медиана уровней врагов без босса («враги ур. ~N»); только босс — его уровень, никого — 1. */
  typical: number;
  /** Уровень босса (самого высокого юнита kind boss), если он есть. */
  boss?: number;
}

/** Уровни отряда врагов (башня: rarity — progressLevelBand игрока, bossFactor 1). */
export function enemyLevels(units: readonly (UnitDef | null)[], rarity: CardRarity, ctx: FeatureContext, bossFactor = 1): EnemyLevels {
  const enemies = unitLevels(units, rarity, ctx, bossFactor);
  const mobs = enemies.filter((l, i): l is number => l !== null && units[i]?.kind !== 'boss');
  const bosses = units.flatMap((u, i) => (u && u.kind === 'boss' ? [enemies[i]!] : []));
  const boss = bosses.length ? Math.max(...bosses) : undefined;
  return { enemies, typical: mobs.length ? Math.round(median(mobs)) : (boss ?? 1), ...(boss !== undefined ? { boss } : {}) };
}

export interface StageLevels extends EnemyLevels {
  recommended: RecommendedLevel;
  /** Редкость полосы этапа (по ней считаны уровни врагов). */
  rarity: CardRarity;
}

/** Всё об уровнях этапа для экранов: рекомендуемый уровень, уровни врагов по слотам enemySquad, типичный, босс. */
export function stageLevels(stageId: string, ctx: FeatureContext): StageLevels {
  const band = levelBand(stageId, ctx);
  return {
    recommended: recommendedHeroLevel(stageId, ctx),
    rarity: band.rarity,
    ...enemyLevels(enemySquad(stageId, ctx), band.rarity, ctx, recommendedFactor(stageId, ctx)),
  };
}

/** Средний уровень героев отряда (save.squad), округлён; пустой отряд — 0. */
export function squadAverageLevel(save: Pick<SaveState, 'squad' | 'heroes'>): number {
  const levels = save.squad.flatMap((id) => {
    const h = id === null ? undefined : save.heroes.find((x) => x.id === id);
    return h ? [h.level] : [];
  });
  return levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 0;
}

/** Цвет уровня врага против среднего уровня отряда: red — выше больше чем на 5, yellow — выше, white — не выше. */
export type LevelTone = 'red' | 'yellow' | 'white';

export function levelTone(enemyLevel: number, squadLevel: number): LevelTone {
  if (enemyLevel > squadLevel + 5) return 'red';
  if (enemyLevel > squadLevel) return 'yellow';
  return 'white';
}

/** Проверка power.levels.bands для content:check: этапы существуют, идут по порядку кампании, первая полоса — с первого этапа. */
export function lintLevelBands(ctx: FeatureContext): string[] {
  const bands = ctx.features.power.levels?.bands;
  if (!bands) return [];
  const problems: string[] = [];
  let prev = -1;
  bands.forEach((b, i) => {
    const stage = ctx.content.stages.find((s) => s.id === b.fromStage);
    const where = `data/progression.json: power.levels.bands[${i}]`;
    if (!stage) problems.push(`${where} — этап ${b.fromStage} не найден`);
    else if (stage.globalIndex <= prev) problems.push(`${where} — этап ${b.fromStage} не позже предыдущей полосы (полосы — по порядку кампании)`);
    else prev = stage.globalIndex;
    if (i === 0 && stage && stage.globalIndex !== 0) problems.push(`${where} — первая полоса должна начинаться с первого этапа кампании`);
  });
  return problems;
}
