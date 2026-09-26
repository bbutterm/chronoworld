import { z } from 'zod';
import type { GameContext } from '../progression/types';
import { DEFAULT_DAY, emptyBounties, emptyDaily, SAVE_VERSION, SaveStateSchema, type SaveState } from './schema';

/**
 * Новая игра: progression.heroes.count героев стартовой профессии, джоб 1,
 * отряд — первые 5 героев по слотам, кампания не начата. Время — параметром (ядро не читает часы).
 * day — текущий день игрока 'YYYY-MM-DD' для суточных счётчиков (по умолчанию DEFAULT_DAY;
 * при первом действии с новым днём счётчики всё равно сбросятся через rollDay).
 */
export function newGame(ctx: GameContext, now: number, day: string = DEFAULT_DAY): SaveState {
  const h = ctx.progression.heroes;
  const heroes = Array.from({ length: h.count }, (_, i) => ({
    id: `h${i + 1}`,
    name: h.names[i % h.names.length],
    job: h.startJob,
    jobLevel: 1,
    jobExp: 0,
    jobHistory: [],
  }));
  const squad = Array.from({ length: 5 }, (_, i) => heroes[i]?.id ?? null);
  return {
    version: SAVE_VERSION,
    createdAt: now,
    heroes,
    squad,
    campaign: { cleared: [] },
    resources: { gold: ctx.progression.newGame.gold },
    offline: { lastClaimAt: now },
    battleSeq: 0,
    daily: emptyDaily(day),
    currency: { gems: 0 },
    tower: { floor: 0 },
    inventory: { items: [] },
    presets: [],
    bounties: emptyBounties(),
    achievements: { counters: {}, claimed: [] },
  };
}

/** В строку JSON (стабильный порядок ключей не обязателен). */
export function serialize(save: SaveState): string {
  return JSON.stringify(save);
}

/**
 * Миграции форматов сохранения: MIGRATIONS[v] переводит объект версии v в версию v + 1.
 * Получает уже распарсенный JSON (структура не гарантирована) и возвращает новый объект, не меняя исходный.
 *
 * Версия 0 (прототип до T1): золото лежит в корне (`gold`), время сбора офлайна — `lastOfflineAt`
 * (может отсутствовать), у героев нет `jobHistory`, нет счётчика боёв `battleSeq`.
 */
export const MIGRATIONS: Record<number, (old: any) => any> = {
  0: (old) => {
    const { gold, lastOfflineAt, ...rest } = old;
    return {
      ...rest,
      version: 1,
      heroes: Array.isArray(old.heroes)
        ? old.heroes.map((h: any) => ({ ...h, jobHistory: Array.isArray(h?.jobHistory) ? h.jobHistory : [] }))
        : old.heroes,
      resources: { gold: gold ?? 0 },
      offline: { lastClaimAt: typeof lastOfflineAt === 'number' ? lastOfflineAt : old.createdAt },
      battleSeq: 0,
    };
  },
  /**
   * Версия 1 → 2 (K1/K5 + резерв K4/K6): добавлены daily (суточные счётчики на DEFAULT_DAY — сбросятся
   * при первом действии), currency.gems = 0, tower.floor = 0, inventory.items = [].
   * Уже существующие поля (например, из более поздней ветки) не перезаписываются.
   */
  1: (old) => ({
    ...old,
    version: 2,
    daily: old.daily ?? emptyDaily(DEFAULT_DAY),
    currency: old.currency ?? { gems: 0 },
    tower: old.tower ?? { floor: 0 },
    inventory: old.inventory ?? { items: [] },
  }),
  /**
   * Версия 2 → 3 (K8/K9/K10): presets = [], пустая доска поручений (обновится при первом ensureBoard),
   * achievements = { counters, claimed: [] }. Счётчики-«максимумы», которые видны из самого сохранения,
   * засчитываются сразу: stages_cleared (число пройденных этапов), tower_floor, hero_max_job_level —
   * чтобы старые игроки не начинали достижения с нуля. Накопительные счётчики (бои, смены профессий…) — с нуля.
   * Уже существующие поля не перезаписываются.
   */
  2: (old) => ({
    ...old,
    version: 3,
    presets: old.presets ?? [],
    bounties: old.bounties ?? emptyBounties(),
    achievements: old.achievements ?? { counters: derivedCounters(old), claimed: [] },
  }),
};

/** Счётчики достижений, которые можно восстановить из старого сохранения (структура не гарантирована). */
function derivedCounters(old: any): Record<string, number> {
  const out: Record<string, number> = {};
  const cleared = old?.campaign?.cleared;
  if (Array.isArray(cleared) && cleared.length > 0) out.stages_cleared = new Set(cleared).size;
  const floor = old?.tower?.floor;
  if (Number.isInteger(floor) && floor > 0) out.tower_floor = floor;
  if (Array.isArray(old?.heroes)) {
    let max = 0;
    for (const h of old.heroes) {
      if (Number.isInteger(h?.jobLevel) && h.jobLevel > max) max = h.jobLevel;
      if (Array.isArray(h?.jobHistory)) for (const j of h.jobHistory) if (Number.isInteger(j?.jobLevel) && j.jobLevel > max) max = j.jobLevel;
    }
    if (max > 0) out.hero_max_job_level = max;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeIssues(error: z.ZodError): string {
  const lines = error.issues.slice(0, 5).map((i) => {
    const path = i.path.length ? i.path.map(String).join('.') : '(корень)';
    return `${path}: ${i.message}`;
  });
  if (error.issues.length > 5) lines.push(`…и ещё ${error.issues.length - 5}`);
  return lines.join('; ');
}

/**
 * Из строки: JSON.parse → миграции по полю version (MIGRATIONS[v] переводит v → v+1)
 * → SaveStateSchema.parse → проверка ссылок (id героев и предметов уникальны; отряд, надетые предметы и поручения ссылаются на существующих героев; герой в отряде один раз).
 * Любая проблема → SaveError с понятным русским текстом.
 */
export function deserialize(text: string): SaveState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new SaveError(`Сохранение повреждено: это не JSON (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!isRecord(data)) throw new SaveError('Сохранение повреждено: ожидался объект с данными игры.');
  const version = data.version;
  if (version === undefined) throw new SaveError('Сохранение повреждено: нет поля version.');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new SaveError(`Сохранение повреждено: неверная версия ${JSON.stringify(version)}.`);
  }
  if (version > SAVE_VERSION) {
    throw new SaveError(
      `Сохранение сделано более новой версией игры (формат ${version}, поддерживается до ${SAVE_VERSION}). Обновите игру.`,
    );
  }
  let cur: unknown = data;
  for (let v = version; v < SAVE_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new SaveError(`Нет миграции сохранения с версии ${v} на ${v + 1}.`);
    try {
      cur = migrate(cur);
    } catch (e) {
      throw new SaveError(`Не удалось обновить сохранение с версии ${v}: ${e instanceof Error ? e.message : String(e)}.`);
    }
  }
  const parsed = SaveStateSchema.safeParse(cur);
  if (!parsed.success) throw new SaveError(`Сохранение повреждено: ${describeIssues(parsed.error)}.`);
  const save = parsed.data;
  const ids = new Set<string>();
  for (const h of save.heroes) {
    if (ids.has(h.id)) throw new SaveError(`Сохранение повреждено: герой ${h.id} встречается дважды.`);
    ids.add(h.id);
  }
  const inSquad = new Set<string>();
  save.squad.forEach((id, i) => {
    if (id === null) return;
    if (!ids.has(id)) throw new SaveError(`Сохранение повреждено: в слоте отряда ${i + 1} неизвестный герой ${id}.`);
    if (inSquad.has(id)) throw new SaveError(`Сохранение повреждено: герой ${id} стоит в отряде дважды.`);
    inSquad.add(id);
  });
  const itemIds = new Set<string>();
  for (const it of save.inventory.items) {
    if (itemIds.has(it.id)) throw new SaveError(`Сохранение повреждено: предмет ${it.id} встречается дважды.`);
    itemIds.add(it.id);
    if (it.equippedBy !== null && !ids.has(it.equippedBy)) {
      throw new SaveError(`Сохранение повреждено: предмет ${it.id} надет на неизвестного героя ${it.equippedBy}.`);
    }
  }
  for (const b of save.bounties.active) {
    for (const h of b.heroIds) {
      if (!ids.has(h)) throw new SaveError(`Сохранение повреждено: на поручении неизвестный герой ${h}.`);
    }
  }
  return save;
}

export interface LoadResult {
  save: SaveState;
  /** loaded — прочитали сохранение; new — сохранения не было; reset — сохранение битое, начата новая игра. */
  source: 'loaded' | 'new' | 'reset';
  /** Почему пришлось начать заново (только при source = reset). */
  error?: SaveError;
}

/**
 * Загрузить игру из хранилища или начать новую. Никогда не бросает: битое сохранение → новая игра + ошибка
 * (source = reset). В хранилище ничего не пишет — битые данные остаются, пока вызывающий не сделает persist().
 */
export function loadOrNew(storage: SaveStorage, ctx: GameContext, now: number, day: string = DEFAULT_DAY): LoadResult {
  let text: string | null;
  try {
    text = storage.load();
  } catch (e) {
    return { save: newGame(ctx, now, day), source: 'reset', error: new SaveError(`Не удалось прочитать сохранение: ${e instanceof Error ? e.message : String(e)}.`) };
  }
  if (text === null) return { save: newGame(ctx, now, day), source: 'new' };
  try {
    return { save: deserialize(text), source: 'loaded' };
  } catch (e) {
    const error = e instanceof SaveError ? e : new SaveError(`Сохранение не читается: ${e instanceof Error ? e.message : String(e)}.`);
    return { save: newGame(ctx, now, day), source: 'reset', error };
  }
}

/** Записать игру в хранилище. */
export function persist(storage: SaveStorage, save: SaveState): void {
  storage.save(serialize(save));
}

export class SaveError extends Error {
  override name = 'SaveError';
}

/** Хранилище сохранений (LocalStorage в игре, память в тестах, облако Telegram позже). */
export interface SaveStorage {
  load(): string | null;
  save(text: string): void;
  clear(): void;
}

export class MemoryStorage implements SaveStorage {
  private text: string | null = null;
  load() {
    return this.text;
  }
  save(text: string) {
    this.text = text;
  }
  clear() {
    this.text = null;
  }
}
