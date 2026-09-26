import { MemoryStorage, type SaveStorage } from '../core';

export const SAVE_KEY = 'chronoworld.save.v1';

/**
 * Сохранение в localStorage браузера. Любой доступ обёрнут в try/catch: в приватном режиме,
 * при заблокированных cookies/данных сайта или переполнении квоты хранилище молча переключается
 * на память (прогресс живёт до перезагрузки), а `available` становится false — UI может предупредить игрока.
 */
export class LocalStorageAdapter implements SaveStorage {
  available: boolean;
  /** Последняя ошибка доступа к localStorage (для отладки/сообщения игроку). */
  lastError: unknown = null;
  private readonly memory = new MemoryStorage();
  private readonly storage: Storage | null;

  constructor(
    private readonly key: string = SAVE_KEY,
    storage?: Storage | null,
  ) {
    let s: Storage | null = null;
    try {
      s = storage !== undefined ? storage : typeof localStorage !== 'undefined' ? localStorage : null;
      if (s) {
        // Проверка записью: в некоторых браузерах доступ есть, а setItem бросает.
        const probe = `${key}.__probe`;
        s.setItem(probe, '1');
        s.removeItem(probe);
      }
    } catch (e) {
      this.lastError = e;
      s = null;
    }
    this.storage = s;
    this.available = s !== null;
  }

  load(): string | null {
    if (this.storage && this.available) {
      try {
        return this.storage.getItem(this.key);
      } catch (e) {
        this.fail(e);
      }
    }
    return this.memory.load();
  }

  save(text: string): void {
    this.memory.save(text);
    if (this.storage && this.available) {
      try {
        this.storage.setItem(this.key, text);
      } catch (e) {
        this.fail(e);
      }
    }
  }

  clear(): void {
    this.memory.clear();
    if (this.storage && this.available) {
      try {
        this.storage.removeItem(this.key);
      } catch (e) {
        this.fail(e);
      }
    }
  }

  private fail(e: unknown): void {
    this.lastError = e;
    this.available = false;
  }
}
