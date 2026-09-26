/**
 * Чистые помощники экранов (без Phaser) — их проверяют тесты tests/game-flow.test.ts.
 */
import {
  canEquip,
  getJob,
  RARITIES,
  SLOTS,
  stageStatus,
  type ActivityKind,
  type EquipmentContext,
  type GameContext,
  type HeroState,
  type ItemDef,
  type ItemInstance,
  type ItemStats,
  type QuestStatus,
  type Rarity,
  type SaveState,
  type Slot,
  type StageInfo,
  type TowerEvent,
} from '../core';

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

/** Этап, на который стоит вести игрока: первый не пройденный открытый, иначе последний. */
export function currentStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const stages = ctx.content.stages;
  return stages.find((s) => stageStatus(save, s.id, ctx) === 'open') ?? stages[stages.length - 1];
}

/** Строки для экрана итогов/тоста по событиям прогрессии (без повторов «доступна смена профессии»). */
export function describeEvents(events: readonly TowerEvent[], save: SaveState, ctx: GameContext): string[] {
  const heroName = (id: string) => save.heroes.find((h) => h.id === id)?.name ?? id;
  const skillName = (id: string) => ctx.content.skills[id]?.name ?? id;
  const jobName = (id: string) => ctx.content.jobs[id]?.name ?? id;
  const lines: string[] = [];
  // Несколько level-up подряд у одного героя — одна строка с итоговым уровнем.
  const levels = new Map<string, number>();
  for (const e of events) if (e.type === 'levelUp') levels.set(e.heroId, Math.max(levels.get(e.heroId) ?? 0, e.jobLevel));
  for (const [heroId, level] of levels) lines.push(`${heroName(heroId)}: джоб ${level}`);
  for (const e of events) {
    if (e.type === 'skillUnlocked') lines.push(`${heroName(e.heroId)}: новый навык «${skillName(e.skill)}»`);
    if (e.type === 'jobChanged') lines.push(`${heroName(e.heroId)}: ${jobName(e.from)} → ${jobName(e.to)}`);
    if (e.type === 'stageUnlocked') {
      const s = ctx.content.stages.find((x) => x.id === e.stageId);
      if (s) lines.push(`Открыт этап ${s.globalIndex + 1}: ${s.name}`);
    }
  }
  const gems = events.reduce((sum, e) => sum + (e.type === 'gems' ? e.amount : 0), 0);
  if (gems > 0) lines.unshift(`Гемы +${gems}`);
  const jobReady = events.filter((e) => e.type === 'jobChangeAvailable');
  if (jobReady.length) lines.push(`Смена профессии доступна! (${jobReady.map((e) => heroName(e.heroId)).join(', ')})`);
  return lines;
}

/** Навык профессии, ещё не открытый у героя: имя и уровень открытия. */
export function lockedJobSkills(jobId: string, jobLevel: number, ctx: GameContext): { skill: string; jobLevel: number }[] {
  return getJob(ctx, jobId)
    .skills.filter((s) => s.jobLevel > jobLevel)
    .sort((a, b) => a.jobLevel - b.jobLevel);
}

/** id спрайта героя — от его текущей профессии. */
export function heroSprite(hero: HeroState, ctx: GameContext): string {
  return ctx.content.jobs[hero.job]?.visual.sprite ?? hero.job;
}

// ---------- K2. Мощь ----------

/** Сравнение мощи отряда с противником: не слабее / чуть слабее (до 20%) / намного слабее. */
export type PowerTone = 'ahead' | 'close' | 'behind';

export function powerTone(squad: number, enemy: number): PowerTone {
  if (squad >= enemy) return 'ahead';
  return squad >= enemy * 0.8 ? 'close' : 'behind';
}

export const POWER_COLORS: Record<PowerTone, string> = { ahead: '#7dff8f', close: '#ffd84a', behind: '#ff7a6a' };

/** Число с разбивкой по разрядам: 12345 → «12 345». */
export function formatNumber(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ---------- K6. Экипировка ----------

export const SLOT_NAMES: Record<Slot, string> = { weapon: 'Оружие', armor: 'Доспех', helmet: 'Шлем', boots: 'Обувь' };
export const RARITY_NAMES: Record<Rarity, string> = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический' };
export const RARITY_COLORS: Record<Rarity, string> = { common: '#e6e2d6', rare: '#6fb8ff', epic: '#d890ff' };
export const RARITY_TINTS: Record<Rarity, number> = { common: 0x8a8f99, rare: 0x3d7fd6, epic: 0x9a4fd0 };

const STAT_KEYS = ['hp', 'atk', 'def', 'spd'] as const;
const STAT_LABELS: Record<(typeof STAT_KEYS)[number], string> = { hp: 'HP', atk: 'ATK', def: 'DEF', spd: 'SPD' };

/** «+18 ATK · +3 SPD» (нулевые статы не пишем). */
export function itemStatsText(stats: ItemStats): string {
  const parts = STAT_KEYS.filter((k) => (stats[k] ?? 0) > 0).map((k) => `+${stats[k]} ${STAT_LABELS[k]}`);
  return parts.length ? parts.join(' · ') : 'без статов';
}

/** Разница статов при замене current на candidate (только ненулевые, по порядку HP ATK DEF SPD). */
export function statDiff(current: ItemStats | undefined, candidate: ItemStats): { stat: string; delta: number }[] {
  return STAT_KEYS.map((k) => ({ stat: STAT_LABELS[k], delta: (candidate[k] ?? 0) - (current?.[k] ?? 0) })).filter((d) => d.delta !== 0);
}

/** «+4 ATK  −2 SPD» или «без изменений». */
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
