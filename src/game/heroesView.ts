/**
 * H4 «Герои»: чистые помощники экранов коллекции, карточки и вознесения (без Phaser — их проверяет
 * tests/game-heroes.test.ts). Фильтры и сортировка коллекции, порядок листания карточек, прибавка статов за уровень,
 * превью вознесения, откуда берутся копии, подписи слотов корма.
 */
import {
  ascendPlan,
  ascendRequirement,
  activeForm,
  autoFodder,
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

/**
 * Коллекция с копиями одним местом (как в AFK): по одной плитке на героя — лучший экземпляр в порядке списка
 * (первый встреченный) и сколько экземпляров героя в списке. Порядок — как у heroes.
 */
export function groupCopies(heroes: readonly HeroState[]): { hero: HeroState; copies: number; ids: string[] }[] {
  const out = new Map<string, { hero: HeroState; copies: number; ids: string[] }>();
  for (const h of heroes) {
    const g = out.get(h.templateId);
    if (g) {
      g.copies++;
      g.ids.push(h.id);
    } else out.set(h.templateId, { hero: h, copies: 1, ids: [h.id] });
  }
  return [...out.values()];
}

/**
 * Счётчик копий на карточке героя: всего экземпляров героя (кроме этого) и, если следующее вознесение берёт копии
 * этого же героя, — сколько подходящих свободных есть из нужного числа: «Копий: 3 · в корм син. 1/2».
 */
export function copyCounter(save: SaveState, heroId: string, ctx: GameContext): { others: number; have?: number; need?: number; rarity?: CardRarity; text: string } {
  const hero = save.heroes.find((h) => h.id === heroId);
  if (!hero) return { others: 0, text: '' };
  const others = save.heroes.filter((h) => h.templateId === hero.templateId && h.id !== hero.id).length;
  const req = ascendRequirement(save, heroId, ctx);
  const same = req?.fodder.find((f) => f.kind === 'same');
  if (!same) return { others, text: `Копий: ${others}` };
  const have = Math.min(same.count, same.candidates.length);
  // NB-11: одно слово и один счёт — «копии» (запасные карты этого героя), сколько подходит к вознесению из нужных.
  return { others, have, need: same.count, rarity: same.rarity, text: `Копий: ${others} · к вознесению ${have}/${same.count}` };
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
 * Подпись «чего не хватает» под «Улучшить»: «до уровня не хватает 1 234 опыта» / «… 56 золота»; можно — null.
 * На пределе — «Предел редкости — вознесите героя».
 */
export function levelShortage(info: LevelUpInfo): string | null {
  if (info.blocker === 'max_level') return 'Предел редкости — вознесите героя';
  if (!info.cost || info.canLevel) return null;
  if (info.blocker === 'not_enough_exp') return `до уровня не хватает ${formatNumber(info.cost.exp - info.pool)} опыта`;
  if (info.blocker === 'not_enough_gold') return `до уровня не хватает ${formatNumber(info.cost.gold - info.gold)} золота`;
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

/**
 * Превью вознесения: что станет с карточкой на следующей редкости (null — максимум). choice — ветка, выбранная на
 * экране вознесения (переход на фиолетовый и выше, если у героя ещё нет ветки); не выбрана — превью без ветки, как
 * реально получится (LT-08: фиолетовый без ветки станет золотым без ветки, профессию не меняет).
 */
export function ascendPreview(hero: HeroState, ctx: GameContext, choice?: string): AscendPreview | null {
  const t = heroTemplate(ctx, hero.templateId);
  const to = nextRarity(hero.rarity);
  if (!to || rarityIndex(hero.rarity) >= rarityIndex(t.maxRarity)) return null;
  const pick = choice && t.branches.some((b) => b.job === choice) ? choice : undefined;
  const branch = hero.branch ?? (rarityIndex(to) >= rarityIndex(BRANCH_RARITY) ? pick : undefined);
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
    `Таверна — там выпадает и ${name} (любой герой: ${ctx.summon.rates.map((r) => `${rarityDef(ctx, r.rarity).name.toLowerCase()} ${Math.round(r.chance * 100)}%`).join(', ')})`,
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

/** Подпись пустого слота корма в две строки: кто («Алан» / «Любой») и редкость строчными («синий»). */
export function fodderSlotCaption(slot: Pick<FodderSlotView, 'kind' | 'rarity'>, target: HeroState, ctx: GameContext): { who: string; rarity: string } {
  const who = slot.kind === 'same' ? heroTemplate(ctx, target.templateId).name : 'Любой';
  return { who, rarity: rarityDef(ctx, slot.rarity).name.toLowerCase() };
}

/** Почему карточку нельзя отдать в корм — короткой меткой для плитки (как fodderBlocker ядра): null — свободна. */
export function fodderTag(save: SaveState, heroId: string): 'закреплён' | 'в отряде' | 'в пресете' | 'в экспедиции' | null {
  const h = save.heroes.find((x) => x.id === heroId);
  if (!h) return null;
  if (h.locked) return 'закреплён';
  if (save.squad.includes(h.id)) return 'в отряде';
  if (save.presets.some((p) => p.squad.includes(h.id))) return 'в пресете';
  if (save.bounties.active.some((b) => b.heroIds.includes(h.id))) return 'в экспедиции';
  return null;
}

export interface FodderOption {
  id: string;
  level: number;
  /** Уже лежит в другом слоте. */
  chosen: boolean;
  /** Занята (закреплена, в отряде…) — в корм нельзя, пока не освободить. */
  tag: ReturnType<typeof fodderTag>;
}

/**
 * Окно выбора корма для группы слотов group: все подходящие карточки игрока (кроме цели) — свободные первыми (слабые
 * первыми, как предлагает ядро), затем занятые с меткой «в отряде» / «закреплён» (их выбрать нельзя — ядро их не
 * примет, merge.ts fodderBlocker).
 */
export function fodderOptions(save: SaveState, req: { heroId: string; fodder: readonly FodderSlotView[] }, group: number, chosen: readonly string[]): FodderOption[] {
  const g = req.fodder[group];
  const target = save.heroes.find((h) => h.id === req.heroId);
  if (!g || !target) return [];
  const free = g.candidates.map((id) => save.heroes.find((h) => h.id === id)!).filter(Boolean);
  const busy = save.heroes
    .filter((h) => h.id !== target.id && h.rarity === g.rarity && (g.kind === 'any' || h.templateId === target.templateId) && !g.candidates.includes(h.id))
    .sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : 1));
  return [
    ...free.map((h) => ({ id: h.id, level: h.level, chosen: chosen.includes(h.id), tag: null })),
    ...busy.map((h) => ({ id: h.id, level: h.level, chosen: false, tag: fodderTag(save, h.id) })),
  ];
}

/** Мощь «было → станет» при вознесении (powerOf — heroPower с экипировкой; ветка — выбранная на экране, иначе без ветки). */
export function ascendPower(hero: HeroState, ctx: GameContext, powerOf: (h: HeroState) => number, branch?: string): { from: number; to: number } | null {
  const prev = ascendPreview(hero, ctx, branch);
  if (!prev) return null;
  const t = heroTemplate(ctx, hero.templateId);
  const pick = branch && t.branches.some((b) => b.job === branch) ? branch : undefined;
  const nextBranch = hero.branch ?? (rarityIndex(prev.to) >= rarityIndex(BRANCH_RARITY) ? pick : undefined);
  const after: HeroState = { ...hero, rarity: prev.to, ...(nextBranch ? { branch: nextBranch } : {}) };
  return { from: powerOf(hero), to: powerOf(after) };
}

/**
 * Состояние кнопки «Вознести» и понятная причина, если нельзя (первая по важности): нет копий → не выбран корм →
 * не хватает золота → не выбрана ветка. reason — строка для игрока; ready — можно нажимать.
 */
export function ascendButtonState(
  save: SaveState,
  heroId: string,
  chosen: readonly string[],
  ctx: GameContext,
  opts: { branchChosen?: boolean } = {},
): { ready: boolean; reason: string | null } {
  const hero = save.heroes.find((h) => h.id === heroId);
  const req = ascendRequirement(save, heroId, ctx);
  if (!hero || !req) return { ready: false, reason: 'Максимальная редкость' };
  const slots = fodderSlots(req);
  const placed = placeFodder(req, chosen);
  const empty = slots.filter((_, i) => placed[i] === null);
  // Каких карт нет совсем (свободных подходящих меньше, чем пустых слотов группы).
  for (let g = 0; g < req.fodder.length; g++) {
    const f = req.fodder[g];
    const emptyHere = empty.filter((s) => s.group === g).length;
    const left = f.candidates.filter((id) => !chosen.includes(id)).length;
    if (emptyHere > left) {
      const c = fodderSlotCaption(f, hero, ctx);
      const n = emptyHere - left;
      return { ready: false, reason: `Не хватает ${n} ${n === 1 ? 'карты' : 'карт'}: ${c.who === 'Любой' ? 'любой' : c.who}, ${c.rarity}` };
    }
  }
  if (empty.length) return { ready: false, reason: `Положите в корм ещё ${empty.length} ${empty.length === 1 ? 'карту' : 'карты'} — или «Авто»` };
  if (save.resources.gold < req.gold) return { ready: false, reason: `Не хватает золота: ${formatNumber(req.gold - save.resources.gold)}` };
  if (needsBranchPick(hero, req.to) && !opts.branchChosen) return { ready: false, reason: 'Выберите ветку второй профессии' };
  return { ready: true, reason: null };
}

/**
 * Короткая подпись под «Вознести» на карточке героя (LT-07 — точная причина): «копии готовы!» / «нужны копии» /
 * «нужно 20 000 золота»; null — вознести некуда. ready — копии и золото есть.
 */
export function ascendHint(save: SaveState, heroId: string, ctx: GameContext): { ready: boolean; text: string } | null {
  const req = ascendRequirement(save, heroId, ctx);
  if (!req) return null;
  if (!req.fodder.every((f) => f.candidates.length >= f.count) || !autoFodder(save, heroId, ctx)) return { ready: false, text: 'нужны копии' };
  if (save.resources.gold < req.gold) return { ready: false, text: `нужно ${formatNumber(req.gold)} золота` };
  return { ready: true, text: 'копии готовы!' };
}

/**
 * Выбирать ли ветку на экране вознесения: у героя ещё нет ветки, а новая редкость — фиолетовая или выше (синий →
 * фиолетовый и фиолетовый без ветки после «Вознести всех» → золотой; ядро примет её в actAscend opts.branch).
 */
export function needsBranchPick(hero: Pick<HeroState, 'branch'>, to: CardRarity): boolean {
  return !hero.branch && rarityIndex(to) >= rarityIndex(BRANCH_RARITY);
}

/** Есть ли в корме ценные карточки (синие и выше) — перед вознесением спросить подтверждение. */
export function valuableFodder(save: SaveState, chosen: readonly string[]): HeroState[] {
  return save.heroes.filter((h) => chosen.includes(h.id) && rarityIndex(h.rarity) >= rarityIndex('blue'));
}

/** Все редкости по порядку (для фильтра). */
export const RARITY_ORDER: readonly CardRarity[] = CARD_RARITIES;

/** Инвентарь → «Карты героев»: вкладка и фильтр редкости на сессию. */
export const inventoryUi: { tab: 'gear' | 'cards'; view: 'table' | 'grid'; rarity: CardRarity | null; template: string | null } = {
  tab: 'gear',
  view: 'table',
  rarity: null,
  template: null,
};

/**
 * Все экземпляры героев по отдельности (каждая копия — своя карта): редкость по убыванию, затем имя героя, затем
 * уровень по убыванию, затем id. rarity и templateId — фильтры (null — все).
 */
export function heroCardsList(save: Pick<SaveState, 'heroes'>, ctx: GameContext, rarity: CardRarity | null = null, templateId: string | null = null): HeroState[] {
  const name = (h: HeroState) => ctx.content.heroes[h.templateId]?.name ?? h.templateId;
  return save.heroes
    .filter((h) => ctx.content.heroes[h.templateId] && (!rarity || h.rarity === rarity) && (!templateId || h.templateId === templateId))
    .sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || name(a).localeCompare(name(b), 'ru') || b.level - a.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const RARITY_PLURAL_LOWER: Record<CardRarity, string> = { green: 'зелёных', blue: 'синих', purple: 'фиолетовых', gold: 'золотых', red: 'красных' };

/** Сводка карт: «Всего карт: 14 · зелёных 8 · синих 4 · фиолетовых 2» (редкости без карт не пишутся). */
export function heroCardsSummary(save: Pick<SaveState, 'heroes'>, ctx: GameContext): string {
  const list = heroCardsList(save, ctx);
  const parts = CARD_RARITIES.map((r) => [r, list.filter((h) => h.rarity === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${RARITY_PLURAL_LOWER[r]} ${n}`);
  return [`Всего карт: ${list.length}`, ...parts].join(' · ');
}

/** Строка таблицы «Карты героев»: сколько карт каждой редкости у героя. */
export interface HeroCardsRow {
  templateId: string;
  name: string;
  /** Линия (первая профессия): иконка и название класса. */
  line: string;
  counts: Record<CardRarity, number>;
  total: number;
  /** Лучшая редкость среди карт героя (null — карт нет). */
  best: CardRarity | null;
  /** Хотя бы один экземпляр можно вознести прямо сейчас — хватает копий (золото не учитывается). */
  ascendable: boolean;
}

export interface HeroCardsTable {
  rows: HeroCardsRow[];
  /** Суммы по столбцам (все герои, без фильтра). */
  totals: Record<CardRarity, number>;
  total: number;
}

const zeroCounts = (): Record<CardRarity, number> => Object.fromEntries(CARD_RARITIES.map((r) => [r, 0])) as Record<CardRarity, number>;

/**
 * Таблица «Карты героев»: по строке на каждого героя игры (все 12). Порядок — лучшая редкость ↓, число карт ↓, имя;
 * герои без карт — внизу. rarity — фильтр: только герои, у кого есть карты этой редкости (итоги — всегда по всем).
 */
export function heroCardsTable(save: SaveState, ctx: GameContext, rarity: CardRarity | null = null): HeroCardsTable {
  const totals = zeroCounts();
  const byTemplate = new Map<string, HeroState[]>();
  for (const h of save.heroes) {
    if (!ctx.content.heroes[h.templateId]) continue;
    totals[h.rarity]++;
    const list = byTemplate.get(h.templateId) ?? [];
    list.push(h);
    byTemplate.set(h.templateId, list);
  }
  const rows: HeroCardsRow[] = Object.values(ctx.content.heroes).map((t) => {
    const own = byTemplate.get(t.id) ?? [];
    const counts = zeroCounts();
    for (const h of own) counts[h.rarity]++;
    const best = [...CARD_RARITIES].reverse().find((r) => counts[r] > 0) ?? null;
    const ascendable = own.some((h) => !!ascendPlan(save, h.id, ctx)?.complete);
    return { templateId: t.id, name: t.name, line: t.line, counts, total: own.length, best, ascendable };
  });
  const rank = (r: HeroCardsRow) => (r.best ? rarityIndex(r.best) : -1);
  rows.sort((a, b) => rank(b) - rank(a) || b.total - a.total || a.name.localeCompare(b.name, 'ru'));
  return {
    rows: rarity ? rows.filter((r) => r.counts[rarity] > 0) : rows,
    totals,
    total: CARD_RARITIES.reduce((n, r) => n + totals[r], 0),
  };
}

/** Сколько уровней можно поднять подряд — подпись «×N» (0 — нельзя). */
export function affordableLevels(save: SaveState, heroId: string, ctx: GameContext): number {
  return levelUpInfo(save, heroId, ctx).affordable;
}
