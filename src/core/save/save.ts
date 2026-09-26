import { NotImplementedError, type GameContext } from '../progression/types';
import { SAVE_VERSION, type SaveState } from './schema';

/**
 * Новая игра: progression.heroes.count героев стартовой профессии, джоб 1,
 * отряд — первые 5 героев по слотам, кампания не начата. Время — параметром (ядро не читает часы).
 */
export function newGame(ctx: GameContext, now: number): SaveState {
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
  };
}

/** T-C. В строку JSON (стабильный порядок ключей не обязателен). */
export function serialize(save: SaveState): string {
  void save;
  throw new NotImplementedError('serialize — T-C');
}

/**
 * T-C. Из строки: JSON.parse → миграции по полю version (MIGRATIONS[v] переводит v → v+1)
 * → SaveStateSchema.parse. Битые данные → SaveError с понятным текстом; версия новее SAVE_VERSION → SaveError.
 */
export function deserialize(text: string): SaveState {
  void text;
  throw new NotImplementedError('deserialize — T-C');
}

export class SaveError extends Error {}

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
