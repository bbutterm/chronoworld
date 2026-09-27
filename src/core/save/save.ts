import { z } from 'zod';
import { heroName, heroRole } from '../heroes/card';
import { migrateV3toV4 } from '../heroes/migrate';
import { addHeroCard, duplicateCardsInSquad, placeInSquad } from '../heroes/roster';
import type { GameContext } from '../progression/types';
import { DEFAULT_DAY, emptyBounties, emptyDaily, emptySummon, SAVE_VERSION, SaveStateSchema, type SaveState } from './schema';

/**
 * Новая игра: сюжетные карточки progression.heroes.start — зелёные, ур. 1; отряд — передние с первого слота,
 * задние (стрелки, лекари) с последнего; кампания не начата. Время — параметром (ядро не читает часы).
 * day — текущий день игрока 'YYYY-MM-DD' для суточных счётчиков (по умолчанию DEFAULT_DAY;
 * при первом действии с новым днём счётчики всё равно сбросятся через rollDay).
 */
export function newGame(ctx: GameContext, now: number, day: string = DEFAULT_DAY): SaveState {
  let save: SaveState = {
    version: SAVE_VERSION,
    createdAt: now,
    heroes: [],
    squad: [null, null, null, null, null],
    campaign: { cleared: [] },
    resources: { gold: ctx.progression.newGame.gold, heroExp: 0 },
    offline: { lastClaimAt: now },
    battleSeq: 0,
    daily: emptyDaily(day),
    currency: { gems: 0, scrolls: 0 },
    tower: { floor: 0 },
    inventory: { items: [] },
    presets: [],
    bounties: emptyBounties(),
    achievements: { counters: {}, claimed: [] },
    shards: {},
    summon: emptySummon(),
    seenScenes: [],
  };
  for (const templateId of ctx.progression.heroes.start) save = addHeroCard(save, templateId, ctx.content.heroes[templateId]?.baseRarity ?? 'green').save;
  // В отряд: передние — с первого слота, задние — с последнего, лекари — в самый тыл (как авто-расстановка).
  const healersFirst = [...save.heroes].sort((a, b) => Number(heroRole(b, ctx) === 'healer') - Number(heroRole(a, ctx) === 'healer'));
  for (const hero of healersFirst) save = { ...save, squad: placeInSquad(save.squad, hero, save, ctx) };
  return save;
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
  /**
   * Версия 3 → 4 (карточки героев, docs/design/heroes.md): герой-профессия → сюжетная карточка того же уровня,
   * опыт → общий пул, свиток призыва в компенсацию и сообщение игроку (notices). Подробно — heroes/migrate.ts.
   */
  3: (old) => migrateV3toV4(old),
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

/**
 * P11 (T4-15). Вернуть в разобранный объект parsed ключи из исходного raw, которых в parsed нет
 * (рекурсивно по вложенным объектам и массивам). Меняет parsed на месте и возвращает его.
 */
export function keepUnknownFields(parsed: unknown, raw: unknown): unknown {
  if (Array.isArray(parsed) && Array.isArray(raw)) {
    for (let i = 0; i < parsed.length; i++) parsed[i] = keepUnknownFields(parsed[i], raw[i]);
  } else if (isRecord(parsed) && isRecord(raw)) {
    for (const k of Object.keys(raw)) parsed[k] = k in parsed ? keepUnknownFields(parsed[k], raw[k]) : raw[k];
  }
  return parsed;
}

/**
 * P11 (T4-01). Ревизия записанного сохранения (поле revision) без полной проверки; нет текста, не JSON
 * или нет поля — 0.
 */
export function saveRevision(text: string | null | undefined): number {
  if (!text) return 0;
  try {
    const r = (JSON.parse(text) as { revision?: unknown })?.revision;
    return typeof r === 'number' && Number.isInteger(r) && r > 0 ? r : 0;
  } catch {
    return 0;
  }
}

/**
 * P11 (T4-04). Привести загруженное сохранение в соответствие с текущим контентом, чтобы экраны не падали:
 * - v4: экземпляр неизвестной карточки (шаблона больше нет в data/heroes) убирается вместе со ссылками на него
 *   (отряд, пресеты, поручения, надетые предметы); редкость выше maxRarity шаблона — maxRarity; уровень выше предела
 *   редкости — предел;
 * - второй экземпляр одной карточки в отряде убирается из отряда (правило «одна копия карточки в отряде»);
 * - предметы, которых нет в ctx.equipment.items (если контекст с экипировкой), убираются;
 * - save.notices (сообщения миграции) → warnings, поле убирается.
 * Каждая правка — строка в warnings (понятный русский текст). Ничего не правили — тот же объект save.
 */
export function sanitizeSave(
  save: SaveState,
  ctx: GameContext & { equipment?: { items: Record<string, unknown> } },
): { save: SaveState; warnings: string[] } {
  const warnings: string[] = [...(save.notices ?? [])];
  let changed = save.notices !== undefined;
  const templates = ctx.content.heroes;
  const rarities = ctx.cards.rarities.map((r) => r.id);
  const gone = new Set<string>();
  const heroes = save.heroes.flatMap((h) => {
    const t = templates[h.templateId];
    if (!t) {
      changed = true;
      gone.add(h.id);
      warnings.push(`Карточки «${h.templateId}» больше нет в игре — она убрана.`);
      return [];
    }
    let { rarity, level } = h;
    if (rarities.indexOf(rarity) > rarities.indexOf(t.maxRarity)) rarity = t.maxRarity;
    const cap = ctx.cards.rarities[rarities.indexOf(rarity)].maxLevel;
    if (level > cap) level = cap;
    if (rarity === h.rarity && level === h.level) return [h];
    changed = true;
    warnings.push(`${t.name}: редкость и уровень приведены к правилам карточки.`);
    return [{ ...h, rarity, level }];
  });
  const drop = (id: string | null) => (id !== null && gone.has(id) ? null : id);
  let squad = save.squad.map(drop);
  const dups = duplicateCardsInSquad({ heroes }, squad);
  if (dups.length) {
    changed = true;
    squad = squad.map((id) => (id !== null && dups.includes(id) ? null : id));
    warnings.push(`Из отряда убраны повторные копии карточек: ${dups.map((id) => heroName(heroes.find((h) => h.id === id)!, ctx)).join(', ')}.`);
  }
  const known = ctx.equipment?.items;
  let items = save.inventory.items;
  if (known) {
    const kept = items.filter((it) => known[it.itemId]);
    if (kept.length !== items.length) {
      changed = true;
      warnings.push(`Из инвентаря убраны предметы, которых больше нет в игре: ${items.length - kept.length}.`);
      items = kept;
    }
  }
  if (gone.size) items = items.map((it) => (it.equippedBy && gone.has(it.equippedBy) ? { ...it, equippedBy: null } : it));
  if (!changed) return { save, warnings };
  const { notices: _n, ...rest } = save;
  return {
    save: {
      ...rest,
      heroes,
      squad,
      presets: gone.size ? save.presets.map((p) => ({ ...p, squad: p.squad.map(drop) })) : save.presets,
      bounties: gone.size
        ? { ...save.bounties, active: save.bounties.active.map((b) => ({ ...b, heroIds: b.heroIds.filter((id) => !gone.has(id)) })).filter((b) => b.heroIds.length > 0) }
        : save.bounties,
      inventory: { ...save.inventory, items },
    },
    warnings,
  };
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
    throw new SaveError('newer_version',
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
  // P11 (T4-15): поля, которых эта сборка не знает (добавлены более новой), возвращаются на место —
  // схема их отбрасывает, а следующая запись иначе стёрла бы их навсегда.
  const save = keepUnknownFields(parsed.data, cur) as SaveState;
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
  /** Почему пришлось начать заново (только при source = reset). error.kind = newer_version — сохранение новее сборки. */
  error?: SaveError;
  /** Прочитанный текст как есть (для резервной копии перед перезаписью, T4-02). */
  raw?: string;
  /** P11 (T4-04). Что поправлено при загрузке (sanitizeSave), для предупреждения игроку. */
  warnings?: string[];
}

/**
 * Загрузить игру из хранилища или начать новую. Никогда не бросает: битое сохранение → новая игра + ошибка
 * (source = reset). В хранилище ничего не пишет — битые данные остаются, пока вызывающий не сделает persist().
 * Прочитанное сохранение проходит sanitizeSave (T4-04): неизвестные карточки/предметы убираются, сообщения миграции — в warnings.
 */
export function loadOrNew(storage: SaveStorage, ctx: GameContext, now: number, day: string = DEFAULT_DAY): LoadResult {
  let text: string | null;
  try {
    text = storage.load();
  } catch (e) {
    return { save: newGame(ctx, now, day), source: 'reset', error: new SaveError('read_failed', `Не удалось прочитать сохранение: ${e instanceof Error ? e.message : String(e)}.`) };
  }
  if (text === null) return { save: newGame(ctx, now, day), source: 'new' };
  let save: SaveState;
  try {
    save = deserialize(text);
  } catch (e) {
    const error = e instanceof SaveError ? e : new SaveError(`Сохранение не читается: ${e instanceof Error ? e.message : String(e)}.`);
    return { save: newGame(ctx, now, day), source: 'reset', error, raw: text };
  }
  const fixed = sanitizeSave(save, ctx as GameContext & { equipment?: { items: Record<string, unknown> } });
  return { save: fixed.save, source: 'loaded', raw: text, ...(fixed.warnings.length ? { warnings: fixed.warnings } : {}) };
}

/** Записать игру в хранилище. */
export function persist(storage: SaveStorage, save: SaveState): void {
  storage.save(serialize(save));
}

/** Вид ошибки сохранения: newer_version — формат новее сборки (не затирать!), read_failed — хранилище не читается. */
export type SaveErrorKind = 'corrupt' | 'newer_version' | 'read_failed';

export class SaveError extends Error {
  override name = 'SaveError';
  readonly kind: SaveErrorKind;
  constructor(kindOrMessage: SaveErrorKind | string, message?: string) {
    super(message ?? kindOrMessage);
    this.kind = message === undefined ? 'corrupt' : (kindOrMessage as SaveErrorKind);
  }
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
