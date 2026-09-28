/**
 * H4 «Герои»: чистые помощники экранов коллекции, карточки и вознесения (без Phaser — их проверяет
 * tests/game-heroes.test.ts). Фильтры и сортировка коллекции, порядок листания карточек, прибавка статов за уровень,
 * превью вознесения, откуда берутся копии, подписи слотов корма.
 */
import {
  ascendRequirement,
  activeForm,
  BRANCH_RARITY,
  CARD_RARITIES,
  cardStats,
  heroLine,
  heroRole,
  heroTemplate,
  levelUpInfo,
  maxLevelOf,
  nextRarity,
  rarityDef,
  rarityForLevel,
  rarityIndex,
  type CardRarity,
  type FodderSlotView,
  type GameContext,
  type HeroState,
  type LevelUpInfo,
  type SaveState,
  type Stats,
} from '../core';
import { formatNumber } from './flow';

export type HeroSort = 'power' | 'level' | 'rarity';
export const SORT_LABELS: Record<HeroSort, string> = { power: 'Сила', level: 'Уровень', rarity: 'Редкость' };
export const SORT_ORDER: HeroSort[] = ['power', 'level', 'rarity'];

export interface HeroFilter {
  /** Линия (первая профессия ветки) или null — все. */
  line: string | null;
  role: string | null;
  rarity: CardRarity | null;
}

/** Состояние экрана «Герои» на сессию: фильтры, сортировка, «коллекция», порядок листания карточек. */
export const heroesUi: { filter: HeroFilter; sort: HeroSort; showMissing: boolean; order: string[]; tab: 'skills' | 'gear' | 'story' | null } = {
  filter: { line: null, role: null, rarity: null },
  sort: 'power',
  showMissing: false,
  order: [],
  tab: null,
};

/** Подходит ли карточка под фильтр (линия — шаблона, роль — текущей формы). */
export function matchesFilter(hero: HeroState, filter: HeroFilter, ctx: GameContext): boolean {
  if (!ctx.content.heroes[hero.templateId]) return false;
  if (filter.line && heroLine(hero, ctx) !== filter.line) return false;
  if (filter.role && heroRole(hero, ctx) !== filter.role) return false;
  if (filter.rarity && hero.rarity !== filter.rarity) return false;
  return true;
}

/**
 * Отфильтровать и отсортировать карточки игрока: по убыванию выбранного ключа (сила / уровень / редкость), дальше —
 * редкость, уровень, сила, имя шаблона, id. powerOf — мощь героя (heroPower с экипировкой; в тестах — любая функция).
 */
export function sortHeroes(heroes: readonly HeroState[], sort: HeroSort, ctx: GameContext, powerOf: (h: HeroState) => number): HeroState[] {
  const power = new Map(heroes.map((h) => [h.id, powerOf(h)]));
  const keys: Record<HeroSort, (h: HeroState) => number> = {
    power: (h) => power.get(h.id) ?? 0,
    level: (h) => h.level,
    rarity: (h) => rarityIndex(h.rarity),
  };
  const chain: HeroSort[] = [sort, ...SORT_ORDER.filter((k) => k !== sort)];
  return [...heroes].sort((a, b) => {
    for (const k of chain) {
      const d = keys[k](b) - keys[k](a);
      if (d) return d;
    }
    const na = ctx.content.heroes[a.templateId]?.name ?? a.templateId;
    const nb = ctx.content.heroes[b.templateId]?.name ?? b.templateId;
    return na.localeCompare(nb, 'ru') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** Карточки коллекции под фильтром по порядку сортировки. */
export function collectionHeroes(save: SaveState, filter: HeroFilter, sort: HeroSort, ctx: GameContext, powerOf: (h: HeroState) => number): HeroState[] {
  return sortHeroes(save.heroes.filter((h) => matchesFilter(h, filter, ctx)), sort, ctx, powerOf);
}

/**
 * Шаблоны, которых у игрока нет (серые в «коллекции»), под фильтром (роль — базовой формы, редкость — базовая):
 * сначала сюжетные по порядку сюжета, потом призывные по редкости и имени.
 */
export function missingTemplates(save: SaveState, filter: HeroFilter, ctx: GameContext): string[] {
  const owned = new Set(save.heroes.map((h) => h.templateId));
  const story = [...ctx.progression.heroes.start, ...ctx.progression.heroes.recruits.map((r) => r.template)];
  return Object.values(ctx.content.heroes)
    .filter((t) => !owned.has(t.id))
    .filter((t) => (!filter.line || t.line === filter.line) && (!filter.role || t.role === filter.role) && (!filter.rarity || t.baseRarity === filter.rarity))
    .sort((a, b) => {
      const sa = a.source === 'story' ? 0 : 1;
      const sb = b.source === 'story' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (sa === 0) return story.indexOf(a.id) - story.indexOf(b.id);
      return rarityIndex(a.baseRarity) - rarityIndex(b.baseRarity) || a.name.localeCompare(b.name, 'ru');
    })
    .map((t) => t.id);
}

/** Сколько разных шаблонов собрано и всего: «12/25». */
export function collectionCount(save: SaveState, ctx: GameContext): { owned: number; total: number } {
  const ids = Object.keys(ctx.content.heroes);
  const owned = new Set(save.heroes.map((h) => h.templateId).filter((t) => ids.includes(t)));
  return { owned: owned.size, total: ids.length };
}

/** Соседние карточки при листании: предыдущая и следующая в порядке списка (по кругу); нет списка — null. */
export function browseNeighbours(order: readonly string[], heroId: string, alive: (id: string) => boolean): { prev: string | null; next: string | null } {
  const list = order.filter(alive);
  const i = list.indexOf(heroId);
  if (i < 0 || list.length < 2) return { prev: null, next: null };
  return { prev: list[(i - 1 + list.length) % list.length], next: list[(i + 1) % list.length] };
}

type StatKey = 'hp' | 'atk' | 'def' | 'spd';
const KEYS: StatKey[] = ['hp', 'atk', 'def', 'spd'];

/** Статы карточки на уровне level и редкости rarity (без экипировки). */
export function statsAt(hero: HeroState, level: number, rarity: CardRarity, ctx: GameContext, branch: string | undefined = hero.branch): Stats {
  return cardStats(heroTemplate(ctx, hero.templateId), level, rarity, ctx, branch);
}

/** Разница статов b − a по четырём ключам. */
export function statDelta(a: Stats, b: Stats): Record<StatKey, number> {
  return Object.fromEntries(KEYS.map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)])) as Record<StatKey, number>;
}

/** Прибавка статов за следующий уровень (на пределе — null). */
export function nextLevelDelta(hero: HeroState, ctx: GameContext): Record<StatKey, number> | null {
  if (hero.level >= maxLevelOf(ctx, hero.rarity)) return null;
  return statDelta(statsAt(hero, hero.level, hero.rarity, ctx), statsAt(hero, hero.level + 1, hero.rarity, ctx));
}

/**
 * Подпись «чего не хватает» под «Улучшить»: «до апа не хватает 1 234 опыта» / «… 56 золота»; можно — null.
 * На пределе — «Предел редкости — вознесите героя».
 */
export function levelShortage(info: LevelUpInfo): string | null {
  if (info.blocker === 'max_level') return 'Предел редкости — вознесите героя';
  if (!info.cost || info.canLevel) return null;
  if (info.blocker === 'not_enough_exp') return `до апа не хватает ${formatNumber(info.cost.exp - info.pool)} опыта`;
  if (info.blocker === 'not_enough_gold') return `до апа не хватает ${formatNumber(info.cost.gold - info.gold)} золота`;
  return null;
}

/** Навык, закрытый уровнем: какая редкость нужна (уровень выше предела текущей редкости) — «нужен Синий»; иначе null. */
export function skillRarityGate(unlockLevel: number, rarity: CardRarity, ctx: GameContext): { rarity: CardRarity; name: string } | null {
  if (unlockLevel <= maxLevelOf(ctx, rarity)) return null;
  const need = rarityForLevel(ctx, unlockLevel, rarity);
  return { rarity: need, name: rarityDef(ctx, need).name };
}

export interface AscendPreview {
  from: CardRarity;
  to: CardRarity;
  maxLevel: { from: number; to: number };
  stats: { from: Stats; to: Stats };
  statMult: { from: number; to: number };
  skillPower: { from: number; to: number };
  /** Новая профессия (сюжетные на фиолетовом). */
  newJob?: string;
  /** Навыки, которые откроются сразу (новая форма) или станут доступны по уровню до нового предела. */
  newSkills: { skill: string; level: number; now: boolean }[];
}

/** Превью вознесения: что станет с карточкой на следующей редкости (null — максимум). */
export function ascendPreview(hero: HeroState, ctx: GameContext): AscendPreview | null {
  const t = heroTemplate(ctx, hero.templateId);
  const to = nextRarity(hero.rarity);
  if (!to || rarityIndex(hero.rarity) >= rarityIndex(t.maxRarity)) return null;
  // V1: на переходе с выбором ветки превью — по первой ветке (экран выбора ветки — пакет V2).
  const branch = hero.branch ?? (rarityIndex(to) >= rarityIndex(BRANCH_RARITY) ? t.branches[0]?.job : undefined);
  const f0 = activeForm(t, hero);
  const f1 = activeForm(t, { rarity: to, branch });
  const cap0 = maxLevelOf(ctx, hero.rarity);
  const cap1 = maxLevelOf(ctx, to);
  // Новая профессия — все её навыки до нового предела (открытые уровнем — сразу); иначе — навыки, которые станут
  // достижимы уровнем между старым и новым пределом.
  const jobChanged = f1.job !== f0.job;
  const newSkills = [...f1.skills]
    .sort((a, b) => a.level - b.level)
    .filter((s) => s.level <= cap1 && (jobChanged || s.level > cap0))
    .map((s) => ({ skill: s.skill, level: s.level, now: jobChanged && s.level <= hero.level }));
  const r0 = rarityDef(ctx, hero.rarity);
  const r1 = rarityDef(ctx, to);
  return {
    from: hero.rarity,
    to,
    maxLevel: { from: cap0, to: cap1 },
    stats: { from: statsAt(hero, hero.level, hero.rarity, ctx), to: statsAt(hero, hero.level, to, ctx, branch) },
    statMult: { from: r0.statMult, to: r1.statMult },
    skillPower: { from: r0.skillPower, to: r1.skillPower },
    ...(jobChanged ? { newJob: f1.job } : {}),
    newSkills,
  };
}

/**
 * Откуда копии героя (строки для карточки и экрана вознесения): Таверна, сюжет, карты героя из наград
 * (этапы, сундук, охота, экспедиции, события — случайный герой), Лавка.
 */
export function copySources(_save: SaveState, templateId: string, ctx: GameContext): string[] {
  const hc = ctx.cards.heroCards;
  const name = ctx.content.heroes[templateId]?.name ?? templateId;
  const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 1000) / 10}%`;
  return [
    `Копии ${name}: Таверна (любой герой — ${ctx.summon.rates.map((r) => `${rarityDef(ctx, r.rarity).name.toLowerCase()} ${Math.round(r.chance * 100)}%`).join(', ')})`,
    `Карты героя (случайный герой): первое прохождение этапа — ${pct(hc.firstClear.blue)} синяя, босс главы — ${pct(hc.bossFirstClear.blue)}`,
    'Сундук, охота, экспедиции, достижения, Лавка, события',
  ];
}

/** Подпись слота корма: «Ирис · Зелёный» (та же) / «Любой герой · Фиолетовый» (любая). */
export function fodderSlotLabel(slot: Pick<FodderSlotView, 'kind' | 'rarity'>, target: HeroState, ctx: GameContext): string {
  const t = heroTemplate(ctx, target.templateId);
  const who = slot.kind === 'same' ? t.name : 'Любой герой';
  return `${who} · ${rarityDef(ctx, slot.rarity).name}`;
}

/** Слоты корма развёрнуто (по одному на карточку): [{kind, rarity, index}] — «та же» первыми, как раскладывает ядро. */
export function fodderSlots(req: { fodder: readonly FodderSlotView[] }): { kind: 'same' | 'any'; rarity: CardRarity; group: number }[] {
  const out: { kind: 'same' | 'any'; rarity: CardRarity; group: number }[] = [];
  req.fodder.forEach((f, g) => {
    for (let i = 0; i < f.count; i++) out.push({ kind: f.kind, rarity: f.rarity, group: g });
  });
  return out.sort((a, b) => (a.kind === 'same' ? 0 : 1) - (b.kind === 'same' ? 0 : 1));
}

/**
 * Разложить выбранный корм по слотам (для показа): каждому слоту — подходящая карточка из chosen (по кандидатам его
 * группы), «та же» первыми. Возвращает id по слотам (null — пусто).
 */
export function placeFodder(req: { fodder: readonly FodderSlotView[] }, chosen: readonly string[]): (string | null)[] {
  const slots = fodderSlots(req);
  const left = [...chosen];
  return slots.map((s) => {
    const i = left.findIndex((id) => req.fodder[s.group].candidates.includes(id));
    if (i < 0) return null;
    return left.splice(i, 1)[0];
  });
}

/** Готово ли вознесение: нет блокеров и (у призывных) все слоты корма заполнены. */
export function ascendReadyWith(save: SaveState, heroId: string, chosen: readonly string[], ctx: GameContext): boolean {
  const req = ascendRequirement(save, heroId, ctx);
  if (!req || req.blockers.length) return false;
  if (!req.fodder.length) return true;
  return placeFodder(req, chosen).every((x) => x !== null);
}

/** Есть ли в корме ценные карточки (синие и выше) — перед вознесением спросить подтверждение. */
export function valuableFodder(save: SaveState, chosen: readonly string[]): HeroState[] {
  return save.heroes.filter((h) => chosen.includes(h.id) && rarityIndex(h.rarity) >= rarityIndex('blue'));
}

/** Все редкости по порядку (для фильтра). */
export const RARITY_ORDER: readonly CardRarity[] = CARD_RARITIES;

/** Сколько уровней можно поднять подряд — подпись «×N» (0 — нельзя). */
export function affordableLevels(save: SaveState, heroId: string, ctx: GameContext): number {
  return levelUpInfo(save, heroId, ctx).affordable;
}
