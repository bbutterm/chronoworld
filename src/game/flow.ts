/**
 * Чистые помощники экранов (без Phaser) — их проверяют тесты tests/game-flow.test.ts.
 */
import {
  availableJobChanges,
  canEquip,
  expBankStatus,
  heroesWithGearUpgrades,
  misplacedInFront,
  type GearContext,
  getJob,
  heroGender,
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
export type AutoStop = 'defeat' | 'chapter_end' | 'no_next' | 'replay' | 'job_change';

/**
 * R. Авто-прохождение кампании: какой этап запустить после боя на stageId, или почему остановиться.
 * Идёт только по новым этапам. Останавливается на поражении, на конце главы, если следующий этап
 * закрыт/отсутствует и если он уже пройден (повтор старого этапа не запускает цепочку повторов).
 */
export function autoNextStage(save: SaveState, stageId: string, win: boolean, ctx: GameContext): { next: StageInfo | null; stop: AutoStop | null } {
  if (!win) return { next: null, stop: 'defeat' };
  // Кто-то готов сменить профессию — сначала это (иначе авто уведёт игрока дальше мимо важного выбора).
  if (jobChangeReadyCount(save, ctx) > 0) return { next: null, stop: 'job_change' };
  const cur = ctx.content.stages.find((s) => s.id === stageId);
  const next = nextOpenStage(save, stageId, ctx);
  if (!next) return { next: null, stop: 'no_next' };
  if (cur && next.chapter !== cur.chapter) return { next: null, stop: 'chapter_end' };
  if (stageStatus(save, next.id, ctx) === 'cleared') return { next: null, stop: 'replay' };
  return { next, stop: null };
}

/** Первый герой, который может сменить профессию прямо сейчас (или undefined). */
export function firstJobChangeReady(save: SaveState, ctx: GameContext): HeroState | undefined {
  return save.heroes.find((h) => ctx.content.jobs[h.job] && availableJobChanges(h, ctx).length > 0);
}

/** Готовый к смене профессии герой, кроме exceptId (для «Ещё герой готов к профессии»). */
export function otherJobChangeReady(save: SaveState, ctx: GameContext, exceptId?: string): HeroState | undefined {
  return save.heroes.find((h) => h.id !== exceptId && ctx.content.jobs[h.job] && availableJobChanges(h, ctx).length > 0);
}

/**
 * Названия навыков, открытых сменой профессии (события skillUnlocked новой профессии). Событий нет —
 * навыки новой профессии, доступные на текущем джобе героя.
 */
export function jobChangeSkills(events: readonly (TowerEvent | MetaEvent)[], hero: HeroState, ctx: GameContext): string[] {
  const name = (id: string) => ctx.content.skills[id]?.name ?? id;
  const unlocked = events.flatMap((e) => (e.type === 'skillUnlocked' && e.heroId === hero.id && e.job === hero.job ? [name(e.skill)] : []));
  if (unlocked.length) return unlocked;
  const job = ctx.content.jobs[hero.job];
  return job ? job.skills.filter((s) => s.jobLevel <= hero.jobLevel).map((s) => name(s.skill)) : [];
}

/** Строка «Смена профессии доступна!» устарела, если сейчас никто не готов (профессию уже сменили). */
export function dropStaleJobReady(lines: string[], save: SaveState, ctx: GameContext): string[] {
  return jobChangeReadyCount(save, ctx) > 0 ? lines : lines.filter((l) => !l.startsWith('Смена профессии доступна'));
}

/** R. Сколько героев могут сменить профессию прямо сейчас (значок вкладки «Герои»). */
export function jobChangeReadyCount(save: SaveState, ctx: GameContext): number {
  return save.heroes.filter((h) => ctx.content.jobs[h.job] && availableJobChanges(h, ctx).length > 0).length;
}

/**
 * P10 (T1-08). Значок вкладки «Герои»: сколько героев ждут внимания — готовы сменить профессию или
 * могут надеть вещь получше из инвентаря (каждый герой считается один раз).
 */
export function heroesBadgeCount(save: SaveState, ctx: GearContext & GameContext): number {
  const ids = new Set(heroesWithGearUpgrades(save, ctx));
  for (const h of save.heroes) if (ctx.content.jobs[h.job] && availableJobChanges(h, ctx).length > 0) ids.add(h.id);
  return ids.size;
}

/** Этап, на который стоит вести игрока: первый не пройденный открытый, иначе последний. */
export function currentStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const stages = ctx.content.stages;
  return stages.find((s) => stageStatus(save, s.id, ctx) === 'open') ?? stages[stages.length - 1];
}

/** Строки для экрана итогов/тоста по событиям прогрессии (без повторов «доступна смена профессии»). */
export function describeEvents(events: readonly (TowerEvent | MetaEvent)[], save: SaveState, ctx: GameContext): string[] {
  const heroName = (id: string) => save.heroes.find((h) => h.id === id)?.name ?? id;
  const skillName = (id: string) => ctx.content.skills[id]?.name ?? id;
  const jobName = (id: string) => ctx.content.jobs[id]?.name ?? id;
  const lines: string[] = [];
  // Несколько level-up подряд у одного героя — одна строка с итоговым уровнем.
  const levels = new Map<string, { from: number; to: number }>();
  for (const e of events) {
    if (e.type !== 'levelUp') continue;
    const l = levels.get(e.heroId);
    levels.set(e.heroId, { from: Math.min(l?.from ?? Infinity, e.jobLevel - 1), to: Math.max(l?.to ?? 0, e.jobLevel) });
  }
  // T1-23: «уровень профессии было → стало» — новичку видно, что это повышение.
  for (const [heroId, l] of levels) lines.push(`${heroName(heroId)}: ур. профессии ${l.from} → ${l.to}`);
  for (const e of events) {
    if (e.type === 'skillUnlocked') lines.push(`${heroName(e.heroId)}: новый навык «${skillName(e.skill)}»`);
    if (e.type === 'heroJoined') lines.unshift(`Новый герой в отряде: ${e.name}!`);
    if (e.type === 'jobChanged') lines.push(`${heroName(e.heroId)}: ${jobName(e.from)} → ${jobName(e.to)}`);
    if (e.type === 'stageUnlocked') {
      const s = ctx.content.stages.find((x) => x.id === e.stageId);
      if (s) lines.push(`Открыт этап ${s.globalIndex + 1}: ${s.name}`);
    }
  }
  const gems = events.reduce((sum, e) => sum + (e.type === 'gems' ? e.amount : 0), 0);
  if (gems > 0) lines.unshift(`Гемы +${formatNumber(gems)}`);
  const jobReady = events.filter((e) => e.type === 'jobChangeAvailable');
  if (jobReady.length) lines.push(`Смена профессии доступна! (${jobReady.map((e) => heroName(e.heroId)).join(', ')})`);
  return lines;
}

/**
 * P10 (T1-09). Порядок строк итогов: сначала ключевые события — новый герой, смена профессии, новые навыки,
 * рост уровня, — затем остальное (открытые этапы, гемы…). Внутри группы порядок сохраняется.
 */
export function keyEventsFirst(lines: readonly string[]): string[] {
  const rank = (l: string) =>
    l.startsWith('Новый герой') ? 0 : l.startsWith('Смена профессии') ? 1 : l.includes('новый навык') ? 2 : l.includes('ур. профессии') ? 3 : l.includes(' → ') ? 1 : 4;
  return lines.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l);
}

/** Десятичная дробь по-русски: 1.5 → «1,5» (digits — знаков после запятой; без него — как есть). */
export function decimal(n: number, digits?: number): string {
  return (digits === undefined ? String(n) : n.toFixed(digits)).replace('.', ',');
}

/** T1-23: «Ур. профессии 4 / 10» (без max — «Ур. профессии 4»). */
export function jobLevelText(level: number, max?: number): string {
  return `Ур. профессии ${level}${max === undefined ? '' : ` / ${max}`}`;
}

/**
 * P10 (T1-02). Подсказка «опыт копится» по героям save: кто стоит на максимуме профессии и копит опыт в запас.
 * full — у кого-то запас полон (дальнейший опыт пропадает): текст-предупреждение. null — никто не копит.
 */
export function expBankNote(save: SaveState, ctx: GameContext): { text: string; full: boolean } | null {
  const banking = save.heroes.filter((h) => ctx.content.jobs[h.job] && expBankStatus(h, ctx).banking);
  if (!banking.length) return null;
  const full = banking.filter((h) => expBankStatus(h, ctx).full);
  if (full.length) return { text: `Запас опыта полон (${full.map((h) => h.name).join(', ')}) — смените профессию, иначе опыт сгорает`, full: true };
  return { text: `Опыт копится — смените профессию (${banking.map((h) => h.name).join(', ')})`, full: false };
}

/** P10 (T1-02). Подпись к полосе опыта героя на максимуме: запас опыта или «макс.». */
export function expBankLabel(hero: HeroState, ctx: GameContext): { text: string; full: boolean } | null {
  const st = expBankStatus(hero, ctx);
  if (!st.banking) return null;
  return st.full ? { text: 'запас полон!', full: true } : { text: `в запасе ${formatNumber(st.banked)} / ${formatNumber(st.cap)}`, full: false };
}

/**
 * P10 (T1-07). Совет после поражения на этапе — по делу, по порядку пользы:
 * вещи получше в инвентаре → смена профессии (только если доступна) → стрелки во фронте → свободные слоты
 * при запасных героях → прокачка. action — куда ведёт кнопка совета.
 */
export function defeatAdvice(save: SaveState, ctx: GearContext & GameContext): { text: string; action: 'Heroes' | 'Squad' | 'Campaign' | 'Home' } {
  if (heroesWithGearUpgrades(save, ctx).length) return { text: 'В инвентаре есть вещи получше — «Герои» → «Надеть лучшее».', action: 'Heroes' };
  if (jobChangeReadyCount(save, ctx) > 0) return { text: 'Смена профессии доступна — она сильно усилит героя («Герои»).', action: 'Heroes' };
  if (misplacedInFront(save, ctx).length) return { text: 'Стрелки и лекари стоят во фронте — «Отряд» → «Переставить».', action: 'Squad' };
  const free = save.heroes.filter((h) => !save.squad.includes(h.id)).length;
  if (free > 0 && save.squad.includes(null)) return { text: 'В отряде есть пустые места — возьмите всех героев («Отряд»).', action: 'Squad' };
  return { text: 'Прокачайте героев: повторите пройденные этапы и заберите сундук на главной.', action: 'Home' };
}

/** Навык профессии, ещё не открытый у героя: имя и уровень открытия. */
export function lockedJobSkills(jobId: string, jobLevel: number, ctx: GameContext): { skill: string; jobLevel: number }[] {
  return getJob(ctx, jobId)
    .skills.filter((s) => s.jobLevel > jobLevel)
    .sort((a, b) => a.jobLevel - b.jobLevel);
}

/**
 * id спрайта героя — от его текущей профессии и пола: `<спрайт профессии>_f` / `_m`, если такой лист есть в реестре,
 * иначе базовый лист профессии (он одного пола — см. genderedSpriteId). has — проверка реестра (для тестов).
 */
export function heroSprite(hero: HeroState, ctx: GameContext, has: (id: string) => boolean = hasSprite): string {
  return heroJobSprite(hero, hero.job, ctx, has);
}

/** Как выглядел бы герой в профессии jobId (варианты на экране смены профессии): лист профессии по полу героя. */
export function heroJobSprite(hero: HeroState, jobId: string, ctx: GameContext, has: (id: string) => boolean = hasSprite): string {
  const base = ctx.content.jobs[jobId]?.visual.sprite ?? jobId;
  return genderedSpriteId(base, heroGender(hero, ctx.progression.heroes), has);
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
  const name = (id: string | null) => (id === null ? null : (save.heroes.find((h) => h.id === id)?.name ?? id));
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
    case 'hero_level_up':
      return 'Campaign';
    case 'offline_claim':
    case 'fast_rewards':
      return 'Home';
    case 'job_change':
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
export function metaRewardsText(r: MetaRewards, jobExpSuffix = ''): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${formatNumber(r.gold)} зол.`);
  if (r.jobExp) parts.push(`${formatNumber(r.jobExp)} опыта${jobExpSuffix}`);
  if (r.gems) parts.push(`${formatNumber(r.gems)} гем.`);
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
      return h ? ctx.content.jobs[h.job]?.role === bounty.role : false;
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
