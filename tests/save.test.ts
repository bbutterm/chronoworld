import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deserialize,
  loadOrNew,
  MemoryStorage,
  MIGRATIONS,
  newGame,
  persist,
  SAVE_VERSION,
  SaveError,
  SaveStateSchema,
  serialize,
  type SaveStorage,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';
import { LocalStorageAdapter, SAVE_KEY } from '../src/game/storage';

const ctx = loadGameContext();
const fixtureV0 = readFileSync(join(import.meta.dirname, 'fixtures/save-v0.json'), 'utf8');

function played() {
  const s = newGame(ctx, 1000);
  s.heroes[0] = { ...s.heroes[0], job: 'swordman', jobLevel: 4, jobExp: 17, jobHistory: [{ job: 'novice', jobLevel: 10 }] };
  s.squad = [s.heroes[0].id, null, s.heroes[2].id, null, null];
  s.campaign.cleared = ['1-1', '1-2'];
  s.resources.gold = 321;
  s.offline.lastClaimAt = 5000;
  s.battleSeq = 7;
  return s;
}

function expectSaveError(text: string, re: RegExp) {
  let err: unknown;
  try {
    deserialize(text);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SaveError);
  expect((err as Error).message).toMatch(re);
}

describe('сохранение', () => {
  it('newGame валиден и детерминирован', () => {
    const s = newGame(ctx, 123);
    expect(SaveStateSchema.parse(s)).toEqual(s);
    expect(newGame(ctx, 123)).toEqual(s);
    expect(s.heroes).toHaveLength(ctx.progression.heroes.count);
  });

  it('serialize → deserialize — то же состояние', () => {
    for (const s of [newGame(ctx, 42), played()]) {
      const text = serialize(s);
      expect(typeof text).toBe('string');
      expect(deserialize(text)).toEqual(s);
      expect(serialize(deserialize(text))).toBe(text);
    }
  });

  it('битый JSON → SaveError с понятным текстом', () => {
    expectSaveError('{"version":1, герои', /не JSON/);
    expectSaveError('', /не JSON/);
    expectSaveError('[1,2,3]', /ожидался объект/);
    expectSaveError('null', /ожидался объект/);
  });

  it('чужая структура → SaveError с путём до проблемного поля', () => {
    expectSaveError('{"hello":"world"}', /нет поля version/);
    expectSaveError('{"version":"1"}', /неверная версия/);

    const noGold = JSON.parse(serialize(newGame(ctx, 1)));
    delete noGold.resources.gold;
    expectSaveError(JSON.stringify(noGold), /resources\.gold/);

    const badHero = JSON.parse(serialize(newGame(ctx, 1)));
    badHero.heroes[2].jobLevel = 0;
    expectSaveError(JSON.stringify(badHero), /heroes\.2\.jobLevel/);

    const shortSquad = JSON.parse(serialize(newGame(ctx, 1)));
    shortSquad.squad = ['h1'];
    expectSaveError(JSON.stringify(shortSquad), /squad/);
  });

  it('отряд со ссылкой на несуществующего героя или дубли героев → SaveError', () => {
    const ghost = newGame(ctx, 1);
    ghost.squad[1] = 'h999';
    expectSaveError(serialize(ghost), /слоте отряда 2.*h999/);

    const dup = newGame(ctx, 1);
    dup.heroes[1] = { ...dup.heroes[1], id: dup.heroes[0].id };
    expectSaveError(serialize(dup), /встречается дважды/);
  });

  it('версия новее SAVE_VERSION → SaveError', () => {
    const future = { ...JSON.parse(serialize(newGame(ctx, 1))), version: SAVE_VERSION + 1 };
    expectSaveError(JSON.stringify(future), /более новой версией/);
  });

  it('миграции есть для каждой версии ниже текущей', () => {
    for (let v = 0; v < SAVE_VERSION; v++) expect(typeof MIGRATIONS[v]).toBe('function');
  });

  it('миграция: сохранение версии 0 (фикстура) поднимается до текущей', () => {
    const raw = JSON.parse(fixtureV0);
    expect(raw.version).toBe(0);
    const s = deserialize(fixtureV0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.createdAt).toBe(raw.createdAt);
    expect(s.resources).toEqual({ gold: 250 });
    expect(s.offline).toEqual({ lastClaimAt: raw.lastOfflineAt });
    expect(s.battleSeq).toBe(0);
    expect(s.squad).toEqual(raw.squad);
    expect(s.campaign.cleared).toEqual(['1-1', '1-2']);
    expect(s.heroes.map((h) => h.jobHistory)).toEqual(raw.heroes.map(() => []));
    expect(s.heroes[0]).toMatchObject({ id: 'h1', job: 'swordman', jobLevel: 3, jobExp: 40 });
    expect(s).not.toHaveProperty('gold');
    expect(s).not.toHaveProperty('lastOfflineAt');
    // После миграции сохраняется уже в текущем формате.
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('миграция v0 без времени офлайна берёт createdAt', () => {
    const raw = JSON.parse(fixtureV0);
    delete raw.lastOfflineAt;
    expect(deserialize(JSON.stringify(raw)).offline.lastClaimAt).toBe(raw.createdAt);
  });

  it('битое сохранение версии 0 → SaveError, а не падение миграции', () => {
    expectSaveError('{"version":0}', /Сохранение повреждено/);
  });
});

describe('loadOrNew / persist', () => {
  it('пустое хранилище → новая игра', () => {
    const r = loadOrNew(new MemoryStorage(), ctx, 777);
    expect(r.source).toBe('new');
    expect(r.error).toBeUndefined();
    expect(r.save).toEqual(newGame(ctx, 777));
  });

  it('persist → loadOrNew возвращает сохранённое', () => {
    const storage = new MemoryStorage();
    const s = played();
    persist(storage, s);
    const r = loadOrNew(storage, ctx, 999_999);
    expect(r.source).toBe('loaded');
    expect(r.save).toEqual(s);
  });

  it('старое сохранение загружается с миграцией', () => {
    const storage = new MemoryStorage();
    storage.save(fixtureV0);
    const r = loadOrNew(storage, ctx, 1);
    expect(r.source).toBe('loaded');
    expect(r.save.version).toBe(SAVE_VERSION);
  });

  it('битое сохранение → новая игра и ошибка, без исключения и без затирания данных', () => {
    const storage = new MemoryStorage();
    storage.save('{broken');
    const r = loadOrNew(storage, ctx, 555);
    expect(r.source).toBe('reset');
    expect(r.error).toBeInstanceOf(SaveError);
    expect(r.save).toEqual(newGame(ctx, 555));
    expect(storage.load()).toBe('{broken');
  });

  it('хранилище бросает при чтении → новая игра и ошибка', () => {
    const throwing: SaveStorage = {
      load: () => {
        throw new Error('SecurityError');
      },
      save: () => {},
      clear: () => {},
    };
    const r = loadOrNew(throwing, ctx, 1);
    expect(r.source).toBe('reset');
    expect(r.error?.message).toMatch(/SecurityError/);
  });
});

class FakeStorage implements Storage {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    if (this.failGet) throw new Error('SecurityError');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

describe('LocalStorageAdapter', () => {
  it('пишет и читает по ключу chronoworld.save.v1', () => {
    const ls = new FakeStorage();
    const a = new LocalStorageAdapter(undefined, ls);
    expect(SAVE_KEY).toBe('chronoworld.save.v1');
    expect(a.available).toBe(true);
    expect(a.load()).toBeNull();
    a.save('x');
    expect(ls.data.get(SAVE_KEY)).toBe('x');
    expect(new LocalStorageAdapter(undefined, ls).load()).toBe('x');
    a.clear();
    expect(a.load()).toBeNull();
    expect(ls.data.size).toBe(0);
  });

  it('localStorage недоступен (нет в окружении или запись запрещена) → память, available = false', () => {
    const none = new LocalStorageAdapter(undefined, null);
    expect(none.available).toBe(false);
    none.save('a');
    expect(none.load()).toBe('a');

    const blocked = new FakeStorage();
    blocked.failSet = true;
    const b = new LocalStorageAdapter(undefined, blocked);
    expect(b.available).toBe(false);
    b.save('b');
    expect(b.load()).toBe('b');
  });

  it('ошибка во время игры → переключение на память без потери последнего сохранения', () => {
    const ls = new FakeStorage();
    const a = new LocalStorageAdapter(undefined, ls);
    a.save('1');
    ls.failSet = true;
    a.save('2');
    expect(a.available).toBe(false);
    ls.failGet = true;
    expect(a.load()).toBe('2');
  });

  it('без window.localStorage (Node) не падает', () => {
    const a = new LocalStorageAdapter();
    expect(typeof a.available).toBe('boolean');
    a.save('z');
    expect(a.load()).toBe('z');
  });
});
