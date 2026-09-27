/**
 * Чистые помощники экранов (без Phaser) — их проверяют тесты tests/game-flow.test.ts.
 */
import {
  ascendRequirement,
  canEquip,
  heroesWithGearUpgrades,
  heroGender,
  heroJobId,
  heroName,
  heroRole,
  levelUpInfo,
  misplacedInFront,
  type GearContext,
  RARITIES,
  SLOTS,
  stageStatus,
  type AchievementView,
  type ActivityKind,
  type Bounty,
  type EquipmentContext,
  type GameContext,
  type HeroState,
  type ItemDef,
  type ItemInstance,
  type ItemStats,
  type MetaContext,
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
  const ids = new Set(heroesWithGearUpgrades(save, ctx));
  for (const h of ascendReady(save, ctx)) ids.add(h.id);
  return ids.size;
}

/** Этап, на который стоит вести игрока: первый не пройденный открытый, иначе последний. */
export function currentStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const stages = ctx.content.stages;
  return stages.find((s) => stageStatus(save, s.id, ctx) === 'open') ?? stages[stages.length - 1];
}

/** Строки для экрана итогов/тоста по событиям прогрессии. */
export function describeEvents(events: readonly (TowerEvent | MetaEvent)[], save: SaveState, ctx: GameContext): string[] {
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
    if (e.type === 'heroJoined') lines.unshift(`Новый герой в отряде: ${e.name}!`);
    if (e.type === 'ascended') lines.push(`${nameOf(e.heroId)}: ${rarityName(e.from)} → ${rarityName(e.to)}${e.jobChanged ? ` — теперь ${jobName(e.job)}!` : ''}`);
    if (e.type === 'shards') lines.push(`Осколки героя ${ctx.content.heroes[e.templateId]?.name ?? e.templateId} +${e.count}`);
    if (e.type === 'tavernUnlocked') lines.unshift(`Открыта Таверна! Подарок: гемы +${formatNumber(e.gems)}, свитки призыва +${e.scrolls}`);
    if (e.type === 'stageUnlocked') {
      const s = ctx.content.stages.find((x) => x.id === e.stageId);
      if (s) lines.push(`Открыт этап ${s.globalIndex + 1}: ${s.name}`);
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
export function defeatAdvice(save: SaveState, ctx: GearContext & GameContext): { text: string; action: 'Heroes' | 'Squad' | 'Campaign' | 'Home' } {
  if (heroesWithGearUpgrades(save, ctx).length) return { text: 'В инвентаре есть вещи получше — «Герои» → «Надеть лучшее».', action: 'Heroes' };
  if (levelUpReady(save, ctx).length) return { text: 'Опыта хватает на новый уровень — «Герои» → герой → «Улучшить».', action: 'Heroes' };
  if (ascendReady(save, ctx).length) return { text: 'Герой готов к вознесению — оно сильно его усилит («Герои»).', action: 'Heroes' };
  if (misplacedInFront(save, ctx).length) return { text: 'Стрелки и лекари стоят во фронте — «Отряд» → «Переставить».', action: 'Squad' };
  const free = save.heroes.filter((h) => !save.squad.includes(h.id)).length;
  if (free > 0 && save.squad.includes(null)) return { text: 'В отряде есть пустые места — возьмите всех героев («Отряд»).', action: 'Squad' };
  return { text: 'Прокачайте героев: повторите пройденные этапы и заберите сундук на главной, затем «Улучшить».', action: 'Home' };
}

/**
 * id спрайта героя — от класса карточки (с учётом формы) и её пола: `<спрайт класса>_f` / `_m`, если такой лист есть
 * в реестре, иначе базовый лист класса (он одного пола — см. genderedSpriteId). visual.sprite шаблона побеждает.
 * has — проверка реестра (для тестов).
 */
export function heroSprite(hero: HeroState, ctx: GameContext, has: (id: string) => boolean = hasSprite): string {
  const own = ctx.content.heroes[hero.templateId]?.visual.sprite;
  if (own) return own;
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

/** Число с разбивкой по разрядам: 12345 → «12 345». */
export function formatNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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
export function questDestination(event: ActivityKind): 'Campaign' | 'Home' | 'Heroes' | 'Tower' {
  switch (event) {
    case 'stage_win':
    case 'stage_attempt':
      return 'Campaign';
    case 'offline_claim':
    case 'fast_rewards':
    case 'summon':
      return 'Home';
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

// ---------- K9. Поручения ----------

export const BOUNTY_RARITY_NAMES: Record<string, string> = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое' };
export const BOUNTY_RARITY_COLORS: Record<string, string> = { common: '#e6e2d6', rare: '#6fb8ff', epic: '#d890ff' };

/** Длительность поручения: «30 мин», «2 ч», «1 ч 30 мин». */
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

/** Награда K9/K10 одной строкой: «300 зол. · 50 опыта · 5 гем.» (нулевые не пишем). */
export function metaRewardsText(r: Omit<MetaRewards, 'shards'> & { shards?: number }, jobExpSuffix = ''): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${formatNumber(r.gold)} зол.`);
  if (r.jobExp) parts.push(`${formatNumber(r.jobExp)} опыта${jobExpSuffix}`);
  if (r.gems) parts.push(`${formatNumber(r.gems)} гем.`);
  if (r.shards) parts.push(`${formatNumber(r.shards)} оск.`);
  return parts.join(' · ') || '—';
}

/** Сколько поручений завершено и ждут «Забрать» (для значка на главной). */
export function finishedBounties(save: SaveState, now: number): number {
  return save.bounties.active.filter((b) => now >= b.endsAt).length;
}

/**
 * Можно ли отправить выбранных героев на поручение: причина отказа или null.
 * Проверки те же, что в startBounty (число героев, роль), — чтобы кнопка «Отправить» была неактивной заранее.
 */
export function bountyPickBlocker(bounty: Bounty, heroIds: readonly string[], save: SaveState, ctx: MetaContext): string | null {
  if (heroIds.length !== bounty.heroCount) return `Выберите героев: ${heroIds.length} / ${bounty.heroCount}`;
  if (bounty.role) {
    const ok = heroIds.some((id) => {
      const h = save.heroes.find((x) => x.id === id);
      return h && ctx.content.heroes[h.templateId] ? heroRole(h, ctx) === bounty.role : false;
    });
    if (!ok) return `Нужен герой с ролью «${ROLE_NAMES[bounty.role] ?? bounty.role}»`;
  }
  return null;
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
