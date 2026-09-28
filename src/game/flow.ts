/**
 * Чистые помощники экранов (без Phaser) — их проверяют тесты tests/game-flow.test.ts.
 */
import {
  ascendRequirement,
  canEquip,
  heroesWithGearUpgrades,
  groupDigits,
  heroPower,
  needsBranch,
  pendingPicks,
  heroGender,
  heroJobId,
  heroName,
  heroSpriteOverride,
  levelUpInfo,
  misplacedInFront,
  type GearContext,
  RARITIES,
  SLOTS,
  squadPower,
  finishedExpeditions,
  idleExpeditions,
  type ExpeditionContext,
  type ExpectedLoot,
  towerFloor,
  towerStatus,
  unitPower,
  type TowerContext,
  recommendedPower as coreRecommendedPower,
  levelTone,
  squadAverageLevel,
  type CardRarity,
  type LevelTone,
  type RecommendedLevel,
  stageStatus,
  type AchievementView,
  type ActivityKind,
  type EquipmentContext,
  type FeatureContext,
  type GameContext,
  type HeroState,
  type ItemDef,
  type ItemInstance,
  type ItemStats,
  type EventRewardEvent,
  type MetaEvent,
  type MetaRewards,
  type Preset,
  type QuestStatus,
  type Rarity,
  type SaveState,
  type Slot,
  type StageInfo,
  type TowerEvent,
} from '../core';
import { genderedSpriteId } from '../pipeline/sprites';
import { hasSprite } from './spriteRegistry';
import { plural } from './skillFacts';
import { C } from './theme';

export const ROLE_NAMES: Record<string, string> = { tank: 'Танк', damage: 'Урон', healer: 'Лекарь', support: 'Поддержка' };

/** Локальная дата 'YYYY-MM-DD' (для ежедневных механик). */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Seed боя этапа — детерминирован из сохранения: одно и то же сохранение даёт один и тот же бой. */
export function stageSeed(save: SaveState): number {
  return (save.createdAt ^ Math.imul(save.battleSeq + 1, 0x9e3779b1)) >>> 0;
}

/**
 * Поставить героя в слот отряда. Герой уникален: если он уже стоит в другом слоте, герои меняются местами.
 * heroId = null — убрать героя из слота. Возвращает новый массив.
 */
export function assignSlot(squad: (string | null)[], slot: number, heroId: string | null): (string | null)[] {
  const next = [...squad];
  if (heroId === null) {
    next[slot] = null;
    return next;
  }
  const existing = next.indexOf(heroId);
  if (existing >= 0) next[existing] = next[slot];
  next[slot] = heroId;
  return next;
}

/** Следующий этап кампании после stageId, если он открыт (иначе null). */
export function nextOpenStage(save: SaveState, stageId: string, ctx: GameContext): StageInfo | null {
  const cur = ctx.content.stages.find((s) => s.id === stageId);
  const next = cur ? ctx.content.stages[cur.globalIndex + 1] : undefined;
  if (!next) return null;
  return stageStatus(save, next.id, ctx) === 'locked' ? null : next;
}

/** R. Почему авто-прохождение остановилось (null — идёт дальше). */
export type AutoStop = 'defeat' | 'chapter_end' | 'no_next' | 'replay';

/**
 * R. Авто-прохождение кампании: какой этап запустить после боя на stageId, или почему остановиться.
 * Идёт только по новым этапам. Останавливается на поражении, на конце главы, если следующий этап
 * закрыт/отсутствует и если он уже пройден (повтор старого этапа не запускает цепочку повторов).
 */
export function autoNextStage(save: SaveState, stageId: string, win: boolean, ctx: GameContext): { next: StageInfo | null; stop: AutoStop | null } {
  if (!win) return { next: null, stop: 'defeat' };
  const cur = ctx.content.stages.find((s) => s.id === stageId);
  const next = nextOpenStage(save, stageId, ctx);
  if (!next) return { next: null, stop: 'no_next' };
  if (cur && next.chapter !== cur.chapter) return { next: null, stop: 'chapter_end' };
  if (stageStatus(save, next.id, ctx) === 'cleared') return { next: null, stop: 'replay' };
  return { next, stop: null };
}

/** Герои отряда, которых можно «Улучшить» прямо сейчас (хватает опыта пула и золота, не предел). */
export function levelUpReady(save: SaveState, ctx: GameContext): HeroState[] {
  return save.heroes.filter((h) => save.squad.includes(h.id) && ctx.content.heroes[h.templateId] && levelUpInfo(save, h.id, ctx).canLevel);
}

/** Карточки, которые можно вознести прямо сейчас (сюжетные — хватает осколков, золота и уровня; призывные — есть корм). */
export function ascendReady(save: SaveState, ctx: GameContext): HeroState[] {
  return save.heroes.filter((h) => {
    if (!ctx.content.heroes[h.templateId]) return false;
    const req = ascendRequirement(save, h.id, ctx);
    return !!req && req.blockers.length === 0 && req.fodder.every((f) => f.candidates.length >= f.count);
  });
}

/**
 * P10 (T1-08). Значок вкладки «Герои»: сколько героев ждут внимания — можно вознести или могут надеть вещь получше
 * из инвентаря (каждый герой считается один раз). «Улучшить» не считается — оно доступно почти всегда.
 */
export function heroesBadgeCount(save: SaveState, ctx: GearContext & GameContext): number {
  // MT-06 / NB-11: считаем героев (как плитки в «Героях» — копии одной плиткой), а не карты: копия-корм с «вещью
  // получше» не повод для значка. Герой в счёте, если его можно вознести или ему нужна ветка (любая его карта), или
  // его основной карте (в отряде, иначе самой сильной) есть что надеть получше.
  const gear = new Set(heroesWithGearUpgrades(save, ctx));
  const ready = new Set(ascendReady(save, ctx).map((h) => h.id));
  const byTemplate = new Map<string, HeroState[]>();
  for (const h of save.heroes) {
    if (!ctx.content.heroes[h.templateId]) continue;
    const list = byTemplate.get(h.templateId);
    if (list) list.push(h);
    else byTemplate.set(h.templateId, [h]);
  }
  let n = 0;
  for (const list of byTemplate.values()) {
    const main = list.find((h) => save.squad.includes(h.id)) ?? [...list].sort((a, b) => heroPower(b, ctx, save) - heroPower(a, ctx, save))[0];
    if (gear.has(main.id) || list.some((h) => ready.has(h.id) || needsBranch(h, ctx))) n++;
  }
  return n + pendingPicks(save).length;
}

/**
 * Значок вкладки «Герои»: красный кружок с числом (heroesBadgeCount — вознести, вещь получше) важнее; иначе, если
 * кто-то из отряда может «Улучшить» за опыт из запаса, — зелёная стрелка «можно поднять уровень» (крючок AFK).
 */
export type HeroesNavBadge = { kind: 'count'; count: number } | { kind: 'levelUp' } | null;

export function heroesNavBadge(save: SaveState, ctx: GearContext & GameContext): HeroesNavBadge {
  const count = heroesBadgeCount(save, ctx);
  if (count > 0) return { kind: 'count', count };
  return levelUpReady(save, ctx).length > 0 ? { kind: 'levelUp' } : null;
}

/** Этап, на который стоит вести игрока: первый не пройденный открытый, иначе последний. */
export function currentStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const stages = ctx.content.stages;
  return stages.find((s) => stageStatus(save, s.id, ctx) === 'open') ?? stages[stages.length - 1];
}

/** Строки для экрана итогов/тоста по событиям прогрессии. */
export function describeEvents(events: readonly (TowerEvent | MetaEvent | EventRewardEvent)[], save: SaveState, ctx: GameContext): string[] {
  const nameOf = (id: string) => {
    const h = save.heroes.find((x) => x.id === id);
    return h ? heroName(h, ctx) : id;
  };
  const skillName = (id: string) => ctx.content.skills[id]?.name ?? id;
  const jobName = (id: string) => ctx.content.jobs[id]?.name ?? id;
  const rarityName = (id: string) => ctx.cards.rarities.find((r) => r.id === id)?.name ?? id;
  const lines: string[] = [];
  // Несколько level-up подряд у одного героя — одна строка с итоговым уровнем.
  const levels = new Map<string, { from: number; to: number }>();
  for (const e of events) {
    if (e.type !== 'levelUp') continue;
    const l = levels.get(e.heroId);
    levels.set(e.heroId, { from: Math.min(l?.from ?? Infinity, e.level - 1), to: Math.max(l?.to ?? 0, e.level) });
  }
  for (const [heroId, l] of levels) lines.push(`${nameOf(heroId)}: ур. ${l.from} → ${l.to}`);
  for (const e of events) {
    if (e.type === 'skillUnlocked') lines.push(`${nameOf(e.heroId)}: новый навык «${skillName(e.skill)}»`);
    if (e.type === 'heroJoined') lines.unshift(e.copy ? `${e.name}: пришла копия героя (для вознесения)` : `Новый герой в отряде: ${e.name}!`);
    if (e.type === 'ascended') lines.push(`${nameOf(e.heroId)}: ${rarityName(e.from)} → ${rarityName(e.to)}${e.jobChanged ? ` — теперь ${jobName(e.job)}!` : ''}`);
    if (e.type === 'heroCard') lines.push(`Карта героя: ${e.name} (${rarityName(e.rarity)})`);
    if (e.type === 'heroPick') lines.push(`Контракт героя: ${rarityName(e.rarity).toLowerCase()} герой на выбор — «Герои»`);
    if (e.type === 'branchChosen') lines.push(`${nameOf(e.heroId)}: ветка — ${jobName(e.branch)}${e.gems ? ` (−${formatNumber(e.gems)} гемов)` : ''}`);
    if (e.type === 'blessedOre') lines.push(`Благословенная руда ×${e.count}`);
    if (e.type === 'tavernUnlocked') lines.unshift(`Открыта Таверна! Подарок: гемы +${formatNumber(e.gems)}, свитки призыва +${e.scrolls}`);
    if (e.type === 'stageUnlocked') {
      const s = ctx.content.stages.find((x) => x.id === e.stageId);
      if (s) lines.push(`Открыт этап ${stageNo(s, ctx)}: ${s.name}`);
    }
  }
  const gems = events.reduce((sum, e) => sum + (e.type === 'gems' ? e.amount : 0), 0);
  if (gems > 0) lines.unshift(`Гемы +${formatNumber(gems)}`);
  return lines;
}

/**
 * P10 (T1-09). Порядок строк итогов: сначала ключевые события — новый герой, Таверна, вознесение, новые навыки,
 * рост уровня, — затем остальное (осколки, открытые этапы, гемы…). Внутри группы порядок сохраняется.
 */
export function keyEventsFirst(lines: readonly string[]): string[] {
  const rank = (l: string) =>
    l.startsWith('Новый герой') ? 0 : l.startsWith('Открыта Таверна') ? 1 : l.includes(' → ') && !l.includes(': ур. ') ? 1 : l.includes('новый навык') ? 2 : l.includes(': ур. ') ? 3 : 4;
  return lines.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l);
}

/** Десятичная дробь по-русски: 1.5 → «1,5» (digits — знаков после запятой; без него — как есть). */
export function decimal(n: number, digits?: number): string {
  return (digits === undefined ? String(n) : n.toFixed(digits)).replace('.', ',');
}

/** «Ур. 4 / 20» (без max — «Ур. 4»). */
export function levelText(level: number, max?: number): string {
  return `Ур. ${level}${max === undefined ? '' : ` / ${max}`}`;
}

/** Опыт в запасе (пул) и сколько уровней он даст отряду: подпись для экранов. */
export function poolText(save: SaveState): string {
  return `Опыт в запасе: ${formatNumber(save.resources.heroExp)}`;
}

/**
 * P10 (T1-07). Совет после поражения на этапе — по делу, по порядку пользы:
 * вещи получше в инвентаре → «Улучшить» (хватает опыта) → вознесение → стрелки во фронте → свободные слоты при
 * запасных героях → прокачка. action — куда ведёт кнопка совета.
 */
export function defeatAdvice(save: SaveState, ctx: GearContext & GameContext): { text: string; action: 'Heroes' | 'Squad' | 'Campaign' } {
  if (heroesWithGearUpgrades(save, ctx).length) return { text: 'В инвентаре есть вещи получше — «Герои» → «Надеть лучшее».', action: 'Heroes' };
  if (levelUpReady(save, ctx).length) return { text: 'Опыта хватает на новый уровень — «Герои» → герой → «Улучшить».', action: 'Heroes' };
  if (ascendReady(save, ctx).length) return { text: 'Герой готов к вознесению — оно сильно его усилит («Герои»).', action: 'Heroes' };
  if (misplacedInFront(save, ctx).length) return { text: 'Стрелки и лекари стоят во фронте — «Отряд» → «Переставить».', action: 'Squad' };
  const free = save.heroes.filter((h) => !save.squad.includes(h.id)).length;
  if (free > 0 && save.squad.includes(null)) return { text: 'В отряде есть пустые места — возьмите всех героев («Отряд»).', action: 'Squad' };
  return { text: 'Прокачайте героев: повторите пройденные этапы и заберите сундук в кампании, затем «Улучшить».', action: 'Campaign' };
}

/**
 * id спрайта героя: свой лист карточки (visual.sprite формы или шаблона: knight_m, priest_f…), если он есть в реестре;
 * иначе лист класса карточки (с учётом формы) по полу — `<спрайт класса>_f` / `_m`, если такой есть, иначе базовый лист
 * класса (он одного пола — см. genderedSpriteId). has — проверка реестра (для тестов).
 */
export function heroSprite(hero: HeroState, ctx: GameContext, has: (id: string) => boolean = hasSprite): string {
  const own = heroSpriteOverride(hero, ctx);
  if (own && has(own)) return own;
  const job = ctx.content.heroes[hero.templateId] ? heroJobId(hero, ctx) : 'novice';
  const base = ctx.content.jobs[job]?.visual.sprite ?? job;
  return genderedSpriteId(base, heroGender(hero, ctx), has);
}

// ---------- K2. Мощь ----------

/** Сравнение мощи отряда с противником: не слабее / чуть слабее (до 20%) / намного слабее. */
export type PowerTone = 'ahead' | 'close' | 'behind';

export function powerTone(squad: number, enemy: number): PowerTone {
  if (squad >= enemy) return 'ahead';
  return squad >= enemy * 0.8 ? 'close' : 'behind';
}

export const POWER_COLORS: Record<PowerTone, string> = { ahead: C.positive, close: C.gold, behind: C.dangerStrong };
/** Числовые цвета тех же тонов (обводки, подложки плашек). */
export const POWER_TINTS: Record<PowerTone, number> = { ahead: 0x3fae4f, close: 0xd6a92a, behind: 0xc2402f };
/** Короткий вердикт на плашке «мощь отряда против этапа» («крючок»: вот-вот хватит). */
export const POWER_VERDICT: Record<PowerTone, string> = { ahead: 'Сил хватает', close: 'Чуть не хватает', behind: 'Слабее' };

/**
 * Рекомендуемая мощь этапа — из баланса (`recommendedPower` ядра, `data/progression.json` → power.recommended):
 * отряд с такой мощью проходит этап с первых попыток; модель игрока не проигрывает ниже 0,85 от неё.
 */
export function recommendedPower(stageId: string, ctx: FeatureContext): number {
  return coreRecommendedPower(stageId, ctx);
}

// ---------- Уровни врагов (core/features/levels.ts) ----------

/** Цвет уровня врага против среднего уровня отряда: выше больше чем на 5 — красный, выше — жёлтый, иначе белый. */
export const LEVEL_COLORS: Record<LevelTone, string> = { red: C.dangerStrong, yellow: C.gold, white: C.text };

/** Редкость во множественном числе — для «герои ур. 18 (синие)». */
export const RARITY_PLURAL: Record<CardRarity, string> = { green: 'зелёные', blue: 'синие', purple: 'фиолетовые', gold: 'золотые', red: 'красные' };

/** Цвет уровня врага для отряда из сохранения (средний уровень героев в save.squad). */
export function enemyLevelColor(level: number, save: Pick<SaveState, 'squad' | 'heroes'>): string {
  return LEVEL_COLORS[levelTone(level, squadAverageLevel(save))];
}

/** «ур. 18» — подпись уровня врага. */
export function levelLabel(level: number): string {
  return `ур. ${level}`;
}

/** «герои ур. 18 (синие)» — рекомендуемый уровень этапа (под «Нужно N» на экране этапа). */
export function recommendText(rec: Pick<RecommendedLevel, 'level' | 'rarity'>): string {
  return `герои ур. ${rec.level} (${RARITY_PLURAL[rec.rarity]})`;
}

/** Мощь текущего отряда против рекомендуемой мощи этапа: числа, тон (цвет) и подпись для плашек. */
export interface PowerCheck {
  squad: number;
  recommended: number;
  tone: PowerTone;
  verdict: string;
}

export function powerCheck(save: SaveState, stageId: string, ctx: FeatureContext & EquipmentContext): PowerCheck {
  const squad = squadPower(save, ctx);
  const recommended = recommendedPower(stageId, ctx);
  const tone = powerTone(squad, recommended);
  return { squad, recommended, tone, verdict: POWER_VERDICT[tone] };
}

// ---------- Плашка игрока (шапка главной) ----------

/**
 * «Уровень лагеря» — уровень игрока, выведенный из прогресса (своего поля в сохранении нет): опыт лагеря =
 * CAMP_EXP.stage за каждый пройденный этап + CAMP_EXP.floor за этаж башни + CAMP_EXP.heroLevel за каждый уровень
 * героев сверх первого. Уровень L → L+1 стоит campLevelCost(L) (растёт линейно): первые уровни — за пару этапов.
 */
export const CAMP_EXP = { stage: 100, floor: 40, heroLevel: 10 } as const;

export function campLevelCost(level: number): number {
  return 200 + 100 * (level - 1);
}

export interface CampLevel {
  level: number;
  /** Опыт внутри текущего уровня и сколько нужно до следующего. */
  exp: number;
  need: number;
  /** Весь опыт лагеря. */
  total: number;
}

export function campLevel(save: SaveState): CampLevel {
  const stages = new Set(save.campaign.cleared).size;
  const heroLevels = save.heroes.reduce((sum, h) => sum + Math.max(0, h.level - 1), 0);
  const total = stages * CAMP_EXP.stage + save.tower.floor * CAMP_EXP.floor + heroLevels * CAMP_EXP.heroLevel;
  let level = 1;
  let rest = total;
  while (rest >= campLevelCost(level)) {
    rest -= campLevelCost(level);
    level++;
  }
  return { level, exp: rest, need: campLevelCost(level), total };
}

/** Лицо лагеря (аватар в шапке главной): первый герой отряда, иначе самый прокачанный. */
export function leadHero(save: SaveState): HeroState | undefined {
  for (const id of save.squad) {
    const h = id === null ? undefined : save.heroes.find((x) => x.id === id);
    if (h) return h;
  }
  return [...save.heroes].sort((a, b) => b.level - a.level)[0];
}

/** Число с разбивкой по разрядам: 12345 → «12 345». */
export function formatNumber(n: number): string {
  // LT-13: разряды — неразрывным пробелом (core groupDigits): перенос строки внутри числа невозможен.
  return groupDigits(n);
}

/**
 * MT-05 / NB-10: номер этапа «глава-этап», как в AFK Arena («2-5») — один формат на карте, в «В бой», в баннерах и
 * замках. Номер в главе — по месту в списке главы (index), а не по id: этапы вставляют в середину главы.
 */
export function stageNo(stage: { chapter: string; index: number }, ctx: { content: { chapters: readonly { id: string }[] } }): string {
  const ch = ctx.content.chapters.findIndex((c) => c.id === stage.chapter);
  return `${ch + 1}-${stage.index + 1}`;
}

// ---------- K6. Экипировка ----------

export const SLOT_NAMES: Record<Slot, string> = { weapon: 'Оружие', armor: 'Доспех', helmet: 'Шлем', boots: 'Обувь' };
export const RARITY_NAMES: Record<Rarity, string> = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический' };
export const RARITY_COLORS: Record<Rarity, string> = { common: '#e6e2d6', rare: '#6fb8ff', epic: '#d890ff' };
export const RARITY_TINTS: Record<Rarity, number> = { common: 0x8a8f99, rare: 0x3d7fd6, epic: 0x9a4fd0 };

export const STAT_KEYS = ['hp', 'atk', 'def', 'spd'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
/** Короткие подписи статов — одни на все экраны: ОЗ (очки здоровья), АТК, ЗАЩ, СКР (скорость). */
export const STAT_LABELS: Record<StatKey, string> = { hp: 'ОЗ', atk: 'АТК', def: 'ЗАЩ', spd: 'СКР' };

/** «ОЗ 450 · АТК 40 · ЗАЩ 12 · СКР 95» — все четыре стата (или только keys). */
export function statsLine(stats: Partial<Record<StatKey, number>>, sep = ' · ', keys: readonly StatKey[] = STAT_KEYS): string {
  return keys.map((k) => `${STAT_LABELS[k]} ${stats[k] ?? 0}`).join(sep);
}

/** «+18 АТК · +3 СКР» (нулевые статы не пишем). */
export function itemStatsText(stats: ItemStats): string {
  const parts = STAT_KEYS.filter((k) => (stats[k] ?? 0) > 0).map((k) => `+${stats[k]} ${STAT_LABELS[k]}`);
  return parts.length ? parts.join(' · ') : 'без статов';
}

/** Разница статов при замене current на candidate (только ненулевые, по порядку ОЗ АТК ЗАЩ СКР). */
export function statDiff(current: ItemStats | undefined, candidate: ItemStats): { stat: string; delta: number }[] {
  return STAT_KEYS.map((k) => ({ stat: STAT_LABELS[k], delta: (candidate[k] ?? 0) - (current?.[k] ?? 0) })).filter((d) => d.delta !== 0);
}

/** «+4 АТК  −2 СКР» или «без изменений». */
export function diffText(diff: { stat: string; delta: number }[]): string {
  if (!diff.length) return 'без изменений';
  return diff.map((d) => `${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)} ${d.stat}`).join('  ');
}

export interface InventoryRow {
  instance: ItemInstance;
  /** Нет описания — предмет пропал из data/items (статов не даёт, не надевается). */
  def?: ItemDef;
  /** Имя героя, на котором предмет, или null. */
  wornBy: string | null;
}

/**
 * Предметы инвентаря для экрана: фильтр по слоту, сначала эпические, потом по слоту и имени.
 * Неизвестные контенту предметы — в конце.
 */
export function inventoryRows(save: SaveState, ctx: EquipmentContext, slot?: Slot): InventoryRow[] {
  const name = (id: string | null) => {
    const h = id === null ? undefined : save.heroes.find((x) => x.id === id);
    return id === null ? null : h ? heroName(h, ctx) : id;
  };
  const rows = save.inventory.items
    .map((instance): InventoryRow => ({ instance, def: ctx.equipment.items[instance.itemId], wornBy: name(instance.equippedBy) }))
    .filter((r) => !slot || r.def?.slot === slot);
  const rank = (r: InventoryRow) => (r.def ? RARITIES.length - RARITIES.indexOf(r.def.rarity) : 99);
  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      SLOTS.indexOf(a.def?.slot ?? 'boots') - SLOTS.indexOf(b.def?.slot ?? 'boots') ||
      (a.def?.name ?? a.instance.itemId).localeCompare(b.def?.name ?? b.instance.itemId, 'ru') ||
      a.instance.id.localeCompare(b.instance.id),
  );
}

/** Можно ли надеть предмет из строки инвентаря на героя: причина отказа или null. */
export function equipBlocker(row: InventoryRow, hero: HeroState, ctx: GameContext): string | null {
  if (!row.def) return 'предмета больше нет в игре';
  if (!canEquip(hero, row.def, ctx)) return `только для: ${(row.def.jobs ?? []).map((j) => ctx.content.jobs[j]?.name ?? j).join(', ')}`;
  return null;
}

// ---------- K5. Задания ----------

/** Сколько наград можно забрать сейчас: выполненные задания + достигнутые пороги активности. */
export function claimableCount(status: QuestStatus): number {
  return status.quests.filter((q) => q.done && !q.claimed).length + status.milestones.filter((m) => m.reached && !m.claimed).length;
}

/** Время до локальной полуночи (сброс заданий и быстрых наград): «5 ч 12 мин». */
export function untilReset(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const min = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 60000));
  return `${Math.floor(min / 60)} ч ${min % 60} мин`;
}

/** Куда вести игрока, чтобы выполнить задание. */
export function questDestination(event: ActivityKind): 'Campaign' | 'Tavern' | 'Heroes' | 'Tower' {
  switch (event) {
    case 'stage_win':
    case 'stage_attempt':
    // Сундук и быстрые награды — на странице «Кампания».
    case 'offline_claim':
    case 'fast_rewards':
      return 'Campaign';
    case 'summon':
      return 'Tavern';
    case 'hero_level_up':
    case 'hero_ascend':
      return 'Heroes';
    case 'tower_attempt':
      return 'Tower';
  }
}

// ---------- K8. Пресеты ----------

/** Имя нового пресета: «Отряд N» с наименьшим свободным N. */
export function nextPresetName(presets: readonly Pick<Preset, 'name'>[]): string {
  const names = new Set(presets.map((p) => p.name));
  let n = 1;
  while (names.has(`Отряд ${n}`)) n++;
  return `Отряд ${n}`;
}

/** Совпадает ли пресет с текущим отрядом (подсветка «выбран»). */
export function presetMatches(preset: Pick<Preset, 'squad'>, squad: readonly (string | null)[]): boolean {
  return preset.squad.length === squad.length && preset.squad.every((id, i) => id === squad[i]);
}

// ---------- K9. Экспедиции ----------

/** Длительность: «30 мин», «2 ч», «1 ч 30 мин». */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (h === 0) return `${m} мин`;
  return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
}

/** Обратный отсчёт: «1:05:09», «4:07»; 0 — «готово». */
export function countdownText(ms: number): string {
  if (ms <= 0) return 'готово';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

/** «5 гемов», «1 гем», «22 гема». */
export function gemsText(n: number): string {
  return `${formatNumber(n)} ${plural(n, 'гем', 'гема', 'гемов')}`;
}

/** «10 очков», «1 очко», «3 очка» (задания, события). */
export function pointsText(n: number): string {
  return `${formatNumber(n)} ${plural(n, 'очко', 'очка', 'очков')}`;
}

/** «3 дня», «1 день», «5 дней». */
export function daysText(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

/** Награда K10 одной строкой: «300 золота · 50 опыта · 5 гемов» (нулевые не пишем; MT-19 — без «зол./гем.»). */
export function metaRewardsText(r: Omit<MetaRewards, 'heroCards'> & { heroCards?: MetaRewards['heroCards'] }, jobExpSuffix = ''): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${formatNumber(r.gold)} золота`);
  if (r.jobExp) parts.push(`${formatNumber(r.jobExp)} опыта${jobExpSuffix}`);
  if (r.gems) parts.push(gemsText(r.gems));
  const cards = (r.heroCards?.blue ?? 0) + (r.heroCards?.purple ?? 0);
  if (cards > 0) parts.push(cards >= 1 && Number.isInteger(cards) ? `${cards} ${plural(cards, 'карта', 'карты', 'карт')} героя` : `карта героя ${Math.round(cards * 100)}%`);
  return parts.join(' · ') || '—';
}

/** Что даст экспедиция (до отправки): «≈ 660 золота · 880 опыта» и находки «гемы, карты героя, предметы» — по средним. */
export function expectedLootText(e: ExpectedLoot): { base: string; finds: string } {
  const finds: string[] = [];
  if (e.gems > 0) finds.push(`гемы ≈${Math.max(1, Math.round(e.gems))}`);
  if (e.heroCards > 0) finds.push('карты героя');
  if (e.items > 0) finds.push('снаряжение');
  if (e.scrolls > 0) finds.push('свитки');
  return { base: `${formatNumber(e.gold)} золота · ${formatNumber(e.jobExp)} опыта`, finds: finds.length ? `Находки: ${finds.join(', ')}` : '' };
}

/**
 * Красный кружок плитки «Экспедиции» (главная): вернувшиеся (забрать) + открытые свободные локации, куда хватает мощи
 * отправить отряд (простаивают). Как в AFK: кружок, пока экспедиции не «работают» целиком.
 */
export function expeditionsBadgeCount(save: SaveState, now: number, ctx: ExpeditionContext): number {
  return finishedExpeditions(save, now) + idleExpeditions(save, ctx);
}

// ---------- K10. Достижения ----------

/** Сколько достижений можно забрать. */
export function claimableAchievements(views: readonly AchievementView[]): number {
  return views.filter((a) => a.done && !a.claimed).length;
}

/** Порядок на экране: готовые к получению, затем в процессе (ближе к цели — выше), полученные — в конце. */
export function sortAchievements(views: readonly AchievementView[]): AchievementView[] {
  const group = (a: AchievementView) => (a.claimed ? 2 : a.done ? 0 : 1);
  return views
    .map((a, i) => ({ a, i }))
    .sort((x, y) => group(x.a) - group(y.a) || (group(x.a) === 1 ? y.a.progress / y.a.target - x.a.progress / x.a.target : 0) || x.i - y.i)
    .map((x) => x.a);
}

// ---------- K4. Башня ----------

/**
 * Красный кружок плитки «Башня»: башня открыта, следующий этаж есть и мощь отряда не ниже мощи этажа
 * (тот же расчёт, что на экране башни: squadPower против суммы unitPower врагов) — «можно брать этаж».
 * Отряд вырос (уровни, вещи, новые герои) — кружок появляется снова. 1 или 0.
 */
export function towerBadgeCount(save: SaveState, ctx: TowerContext & FeatureContext & Partial<Pick<EquipmentContext, 'equipment'>>): number {
  const ts = towerStatus(save, ctx);
  if (!ts.unlocked || ts.next === null) return 0;
  const enemy = towerFloor(ts.next, ctx).enemies.reduce((s, u) => s + (u ? unitPower(u, ctx) : 0), 0);
  return squadPower(save, ctx) >= enemy ? 1 : 0;
}
