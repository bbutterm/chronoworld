import { loadOrNew, MemoryStorage, saveRevision, serialize, syncOfflineClock, type GameContext, type SaveState, type SaveStorage } from '../core';

export const SAVE_KEY = import.meta.env?.VITE_ADVANCE_LAB === '1' ? 'chronoworld.advanceLab.save.v1' : 'chronoworld.save.v1';
/** P11 (T4-02). Сколько резервных копий нечитаемых сохранений хранить (`<key>.backup.<время>`). */
export const BACKUPS_KEEP = 3;

/**
 * Сохранение в localStorage браузера. Любой доступ обёрнут в try/catch.
 * P11 (T4-03): чтение и запись проверяются раздельно — переполненное хранилище (запись бросает) по-прежнему
 * читается, поэтому сохранение загружается; `writable` = false, пока запись не пройдёт снова (каждая запись
 * пробует заново). Хранилища нет или чтение запрещено — всё живёт в памяти (`readable` = false).
 */
export class LocalStorageAdapter implements SaveStorage {
  /** localStorage читается. */
  readable: boolean;
  /** Последняя запись (или проба при запуске) прошла. */
  writable: boolean;
  /** Последняя ошибка доступа к localStorage (для отладки/сообщения игроку). */
  lastError: unknown = null;
  private readonly memory = new MemoryStorage();
  private readonly storage: Storage | null;
  /** Последняя запись не дошла до localStorage — свежие данные только в памяти. */
  private dirty = false;

  constructor(
    readonly key: string = SAVE_KEY,
    storage?: Storage | null,
  ) {
    let s: Storage | null = null;
    try {
      s = storage !== undefined ? storage : typeof localStorage !== 'undefined' ? localStorage : null;
      s?.getItem(key);
    } catch (e) {
      this.lastError = e;
      s = null;
    }
    this.storage = s;
    this.readable = s !== null;
    this.writable = false;
    if (s) {
      // Проба записью: в некоторых браузерах доступ есть, а setItem бросает (или квота исчерпана).
      try {
        const probe = `${key}.__probe`;
        s.setItem(probe, '1');
        s.removeItem(probe);
        this.writable = true;
      } catch (e) {
        this.lastError = e;
      }
    }
  }

  /** Совместимость: хранилище полностью рабочее (и читается, и пишется). */
  get available(): boolean {
    return this.readable && this.writable;
  }

  /** Ошибка похожа на переполнение квоты. */
  get quotaExceeded(): boolean {
    const e = this.lastError as { name?: string; message?: string } | null;
    return !!e && /quota/i.test(`${e.name ?? ''} ${e.message ?? ''}`);
  }

  /** Самые свежие данные этой вкладки: память, если последняя запись не дошла, иначе localStorage. */
  load(): string | null {
    if (this.dirty) return this.memory.load();
    return this.peek();
  }

  /** То, что сейчас лежит в localStorage (могла записать другая вкладка); без хранилища — память. */
  peek(): string | null {
    if (this.storage && this.readable) {
      try {
        return this.storage.getItem(this.key);
      } catch (e) {
        this.lastError = e;
        this.readable = false;
      }
    }
    return this.memory.load();
  }

  save(text: string): void {
    this.memory.save(text);
    this.dirty = true;
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, text);
      this.writable = true;
      this.dirty = false;
    } catch (e) {
      this.lastError = e;
      this.writable = false;
    }
  }

  clear(): void {
    this.memory.clear();
    this.dirty = false;
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
    } catch (e) {
      this.lastError = e;
    }
  }

  /**
   * P11 (T4-02). Резервная копия текста в `<key>.backup.<now>`; хранятся последние BACKUPS_KEEP.
   * Возвращает ключ копии или null (хранилища нет / запись не прошла).
   */
  backup(text: string, now: number): string | null {
    if (!this.storage) return null;
    const prefix = `${this.key}.backup.`;
    const key = `${prefix}${now}`;
    try {
      this.storage.setItem(key, text);
    } catch (e) {
      this.lastError = e;
      return null;
    }
    try {
      const keys: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k?.startsWith(prefix)) keys.push(k);
      }
      keys.sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
      for (const k of keys.slice(0, Math.max(0, keys.length - BACKUPS_KEEP))) this.storage.removeItem(k);
    } catch {
      // Лишние копии не удалились — не страшно.
    }
    return key;
  }

  /** Ключи резервных копий, от старых к новым. */
  backups(): string[] {
    if (!this.storage) return [];
    const prefix = `${this.key}.backup.`;
    const keys: string[] = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k?.startsWith(prefix)) keys.push(k);
      }
    } catch {
      return [];
    }
    return keys.sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
  }
}

export interface BootResult {
  save: SaveState;
  /** Предупреждения игроку (тостом). */
  warnings: string[];
}

export type WriteResult = { ok: true; save: SaveState } | { ok: false; reason: 'stale' | 'readonly' };

/**
 * P11. Слот сохранения вкладки: загрузка с защитой от потерь и запись с ревизиями.
 * - T4-01: каждая запись ставит revision = текущая + 1; перед записью слот перечитывает хранилище, и если там
 *   ревизия новее (писала другая вкладка) — не пишет, помечает себя stale и зовёт onStale; событие `storage`
 *   от другой вкладки с более новой ревизией — то же самое сразу.
 * - T4-02: нечитаемое сохранение перед заменой копируется в резервный ключ; сохранение более новой версии
 *   игры не трогается вообще (readOnly — запись отключена, игрок видит предупреждение).
 * - T4-03: переполненное хранилище читается — сохранение загружается, предупреждение о записи.
 * - T4-04/T4-06: загруженное сохранение проходит sanitizeSave (в loadOrNew) и syncOfflineClock.
 */
export class SaveSlot {
  revision = 0;
  stale = false;
  readOnly = false;
  private lastText: string | null = null;
  private staleHandler: (() => void) | null = null;

  constructor(readonly storage: LocalStorageAdapter = new LocalStorageAdapter()) {}

  boot(ctx: GameContext, now: number, day: string): BootResult {
    const r = loadOrNew(this.storage, ctx, now, day);
    const warnings: string[] = [...(r.warnings ?? [])];
    if (!this.storage.readable) warnings.push('Хранилище браузера недоступно — прогресс сохранится только до перезагрузки страницы.');
    else if (!this.storage.writable) {
      warnings.push(
        this.storage.quotaExceeded
          ? 'Хранилище браузера переполнено — сохранение загружено, но новый прогресс не записывается. Освободите место и перезапустите игру.'
          : 'Запись в хранилище браузера запрещена — сохранение загружено, но новый прогресс не записывается.',
      );
    }
    let save = r.save;
    if (r.source === 'reset') {
      this.revision = saveRevision(r.raw);
      if (r.error?.kind === 'newer_version') {
        this.readOnly = true;
        warnings.push(`${r.error.message} Сохранение не тронуто; пока открыта эта версия, прогресс не записывается.`);
        return { save, warnings };
      }
      const copy = r.raw !== undefined ? this.storage.backup(r.raw, now) : null;
      if (r.raw !== undefined && copy === null) {
        // Без копии затирать нельзя: оставляем старые данные как есть.
        this.readOnly = true;
        warnings.push(`Сохранение не удалось прочитать, а резервную копию сделать не получилось — оно не тронуто, прогресс не записывается. ${r.error?.message ?? ''}`.trim());
        return { save, warnings };
      }
      warnings.push(`Сохранение не удалось прочитать, начата новая игра${copy ? ` (копия старого — в ${copy})` : ''}. ${r.error?.message ?? ''}`.trim());
      const w = this.write(save);
      if (w.ok) save = w.save;
      return { save, warnings };
    }
    if (r.source === 'new') {
      // Новая игра записывается сразу, чтобы время сундука шло с первого запуска.
      const w = this.write(save);
      return { save: w.ok ? w.save : save, warnings };
    }
    this.revision = save.revision ?? 0;
    this.lastText = r.raw ?? null;
    if (r.warnings?.length && r.raw !== undefined) this.storage.backup(r.raw, now);
    const synced = syncOfflineClock(save, now, ctx);
    if (synced !== save || r.warnings?.length) {
      const w = this.write(synced);
      save = w.ok ? w.save : synced;
    }
    return { save, warnings };
  }

  /** Записать сохранение, если эта вкладка не устарела. Возвращает сохранение с новой ревизией. */
  write(save: SaveState): WriteResult {
    if (this.readOnly) return { ok: false, reason: 'readonly' };
    if (this.stale) return { ok: false, reason: 'stale' };
    const stored = this.storage.peek();
    if (stored !== this.lastText && saveRevision(stored) > this.revision) {
      this.markStale();
      return { ok: false, reason: 'stale' };
    }
    const next: SaveState = { ...save, revision: this.revision + 1 };
    const text = serialize(next);
    this.storage.save(text);
    this.revision = next.revision!;
    this.lastText = text;
    return { ok: true, save: next };
  }

  /**
   * Следить за записями других вкладок (событие `storage`). onStale — один раз, когда эта вкладка устарела.
   * Возвращает отписку.
   */
  watch(target: EventTarget | null | undefined, onStale: () => void): () => void {
    this.staleHandler = onStale;
    if (!target) return () => {};
    const handler = (e: Event) => {
      const { key, newValue } = e as StorageEvent;
      if (key !== this.storage.key || this.readOnly) return;
      if (saveRevision(newValue) > this.revision) this.markStale();
    };
    target.addEventListener('storage', handler);
    return () => target.removeEventListener('storage', handler);
  }

  private markStale(): void {
    if (this.stale) return;
    this.stale = true;
    this.staleHandler?.();
  }
}
