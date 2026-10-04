import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAY,
  deserialize,
  emptyExpeditions,
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
const fixtureV1 = readFileSync(join(import.meta.dirname, 'fixtures/save-v1.json'), 'utf8');
const fixtureV2 = readFileSync(join(import.meta.dirname, 'fixtures/save-v2.json'), 'utf8');
const V2_DEFAULTS = {
  daily: { day: DEFAULT_DAY, fastRewardsUsed: 0, quests: {}, claimedQuests: [], activityClaimed: [] },
  tower: { floor: 0 },
  inventory: { items: [] },
};
/**
 * v4 (карточки героев) у старых сохранений v0–v2 (фикстуры: Алан — Мечник 3, Бэлла — Новичок, Вик, Грета, Дорн):
 * герои → сюжетные карточки по имени (Бэлла → Бран, Вик → Вика), тот же уровень, опыт в пул, свиток и сообщение.
 */
const V4_FROM_FIXTURE = {
  heroes: [
    { id: 'h1', templateId: 'alan', rarity: 'green', level: 3 },
    { id: 'h2', templateId: 'bran', rarity: 'green', level: 10 },
    { id: 'h3', templateId: 'vika', rarity: 'green', level: 1 },
    { id: 'h4', templateId: 'greta', rarity: 'green', level: 1 },
    { id: 'h5', templateId: 'dorn', rarity: 'green', level: 1 },
  ],
};
const V3_DEFAULTS = {
  presets: [],
  // v6: доска поручений (v3) по цепочке миграций становится пустыми экспедициями.
  bounties: { active: [] },
  // Поле без смены версии: в старых сохранениях его нет — пусто.
  seenScenes: [],
};

function played() {
  const s = newGame(ctx, 1000);
  s.heroes[0] = { ...s.heroes[0], rarity: 'blue', level: 24, locked: true };
  s.heroes.push({ id: 'h4', templateId: 'iris', rarity: 'green', level: 3, isNew: true, companion: true });
  s.resources.heroExp = 1234;
  s.heroes.push({ id: 'h5', templateId: 'alan', rarity: 'purple', level: 41, branch: 'crusader', branchChanges: 1 });
  s.heroSeq = 5;
  s.pendingPicks = [{ rarity: 'purple', source: 'login_7' }];
  s.currency.scrolls = 3;
  s.summon = { seq: 2, total: 11, sincePurple: 5, sinceBlue: 3, firstTenDone: true, freeDay: '2026-09-26', freeUsed: 1, welcomeGiven: true, discovered: ['alan', 'bran', 'vika', 'iris'] };
  s.squad = [s.heroes[0].id, null, s.heroes[2].id, null, null];
  s.campaign.cleared = ['1-1', '1-2'];
  s.resources.gold = 321;
  s.offline.lastClaimAt = 5000;
  s.battleSeq = 7;
  s.daily = { day: '2026-09-26', fastRewardsUsed: 2, quests: { stage_win: 3 }, claimedQuests: ['win_stages'], activityClaimed: [20] };
  s.currency.gems = 15;
  s.tower.floor = 4;
  s.inventory.items = [{ id: 'i1', itemId: 'sword_common', equippedBy: 'h1' }];
  s.presets = [{ id: 'p1', name: 'Штурм', squad: ['h1', null, null, null, null] }];
  s.bounties = {
    active: [
      { location: 'ant_hell', hours: 1, heroIds: ['h1'], power: 900, startedAt: 10, endsAt: 3_600_010, rewards: { gold: 5, jobExp: 0, gems: 1, heroCards: { blue: 1, purple: 0 }, scrolls: 0, items: ['knife'] } },
    ],
  };
  s.achievements = { counters: { battles_won: 3, stages_cleared: 2 }, claimed: ['first_stage'] };
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
    expect(s.heroes.map((h) => h.templateId)).toEqual(ctx.progression.heroes.start);
    expect(s.heroes.every((h) => h.rarity === 'green' && h.level === 1)).toBe(true);
    expect(s).toMatchObject({ ...V2_DEFAULTS, currency: { gems: 0, scrolls: 0 }, resources: { gold: 0, heroExp: 0 } });
    expect(s).not.toHaveProperty('shards');
    expect(s.summon).toMatchObject({ seq: 0, total: 0, sincePurple: 0, sinceBlue: 0, firstTenDone: false, welcomeGiven: false, discovered: ctx.progression.heroes.start });
    expect(s).toMatchObject({ ...V3_DEFAULTS, achievements: { counters: {}, claimed: [] } });
    expect(s.bounties).toEqual(emptyExpeditions());
  });

  it('newGame с днём: суточные счётчики на этот день', () => {
    const s = newGame(ctx, 1, '2026-09-26');
    expect(s.daily.day).toBe('2026-09-26');
    expect(SaveStateSchema.parse(s)).toEqual(s);
  });

  it('неверный день в сохранении → SaveError', () => {
    const bad = JSON.parse(serialize(newGame(ctx, 1)));
    bad.daily.day = '26.09.2026';
    expectSaveError(JSON.stringify(bad), /daily\.day/);
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
    badHero.heroes[2].level = 0;
    expectSaveError(JSON.stringify(badHero), /heroes\.2\.level/);
    const badRarity = JSON.parse(serialize(newGame(ctx, 1)));
    badRarity.heroes[0].rarity = 'pink';
    expectSaveError(JSON.stringify(badRarity), /heroes\.0\.rarity/);

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
    // Опыт героев (jobExp 40 + 5) — в общий пул.
    expect(s.resources).toEqual({ gold: 250, heroExp: 45 });
    expect(s.offline).toEqual({ lastClaimAt: raw.lastOfflineAt });
    expect(s.battleSeq).toBe(0);
    expect(s.squad).toEqual(raw.squad);
    expect(s.campaign.cleared).toEqual(['1-1', '1-2']);
    expect(s).toMatchObject(V4_FROM_FIXTURE);
    // v7 (герои v2): осколков в сохранении больше нет.
    expect(s).not.toHaveProperty('shards');
    expect(s).not.toHaveProperty('gold');
    expect(s).not.toHaveProperty('lastOfflineAt');
    expect(s).toMatchObject(V2_DEFAULTS);
    expect(s).toMatchObject(V3_DEFAULTS);
    // Компенсация — свиток призыва; Таверна не открыта (ch1_s5 не пройден) — подарка нет.
    expect(s.currency).toEqual({ gems: 0, scrolls: 1 });
    expect(s.summon).toMatchObject({ welcomeGiven: false, discovered: ['alan', 'bran', 'vika', 'greta', 'dorn'] });
    expect(s.notices).toHaveLength(1);
    expect(s.achievements).toEqual({ counters: { stages_cleared: 2, hero_max_level: 10 }, claimed: [] });
    // После миграции сохраняется уже в текущем формате.
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('миграция: сохранение версии 1 (фикстура) поднимается до текущей с полями по умолчанию', () => {
    const raw = JSON.parse(fixtureV1);
    expect(raw.version).toBe(1);
    const s = deserialize(fixtureV1);
    expect(s.version).toBe(SAVE_VERSION);
    const { heroes: _h, resources: _r, ...rest } = raw;
    expect(s).toMatchObject({
      ...rest,
      version: SAVE_VERSION,
      ...V2_DEFAULTS,
      ...V3_DEFAULTS,
      ...V4_FROM_FIXTURE,
      resources: { gold: 250, heroExp: 45 },
      currency: { gems: 0, scrolls: 1 },
      // Максимумы из самого сохранения: 2 пройденных этапа, лучший уровень 10 (h2 и история h1).
      achievements: { counters: { stages_cleared: 2, hero_max_level: 10 }, claimed: [] },
    });
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('миграция: сохранение версии 2 (фикстура) поднимается до текущей, поля v2 не меняются', () => {
    const raw = JSON.parse(fixtureV2);
    expect(raw.version).toBe(2);
    const s = deserialize(fixtureV2);
    const { heroes: _h, resources: _r, currency: _c, ...rest } = raw;
    expect(s).toMatchObject({
      ...rest,
      version: SAVE_VERSION,
      ...V3_DEFAULTS,
      heroes: V4_FROM_FIXTURE.heroes.map((h) => (h.id === 'h2' ? { ...h, level: 8 } : h)),
      resources: { gold: 250, heroExp: 45 },
      currency: { gems: 30, scrolls: 1 },
      achievements: { counters: { stages_cleared: 3, tower_floor: 4, hero_max_level: 10 }, claimed: [] },
    });
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('миграция 2 → 3 не меняет исходный объект и не затирает уже существующие поля', () => {
    const raw = JSON.parse(fixtureV2);
    const copy = structuredClone(raw);
    const presets = [{ id: 'p1', name: 'x', squad: [null, null, null, null, null] }];
    const out = MIGRATIONS[2]({ ...raw, presets });
    expect(raw).toEqual(copy);
    expect(out.presets).toBe(presets);
    // Формат v3–v5 (доска поручений); v6 превращает её в экспедиции.
    expect(out.bounties).toEqual({ board: [], lastRefreshDay: DEFAULT_DAY, refreshesUsed: 0, active: [] });
    // Битые поля старого сохранения не роняют миграцию — счётчики просто не выводятся.
    expect(MIGRATIONS[2]({ version: 2, heroes: 'x', tower: null }).achievements).toEqual({ counters: {}, claimed: [] });
  });

  it('v6: битая экспедиция → SaveError с путём', () => {
    const bad = JSON.parse(serialize(played()));
    bad.bounties.active[0].heroIds = [];
    expectSaveError(JSON.stringify(bad), /bounties\.active\.0\.heroIds/);
    const bad2 = JSON.parse(serialize(played()));
    bad2.presets[0].squad = ['h1'];
    expectSaveError(JSON.stringify(bad2), /presets\.0\.squad/);
  });

  it('миграция 1 → 2 не меняет исходный объект и не затирает уже существующие поля', () => {
    const raw = JSON.parse(fixtureV1);
    const copy = structuredClone(raw);
    const out = MIGRATIONS[1]({ ...raw, currency: { gems: 7 } });
    expect(raw).toEqual(copy);
    expect(out.currency).toEqual({ gems: 7 });
    expect(out.tower).toEqual({ floor: 0 });
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
  it('loadOrNew передаёт день в новую игру', () => {
    expect(loadOrNew(new MemoryStorage(), ctx, 1, '2026-01-02').save.daily.day).toBe('2026-01-02');
  });

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

describe('deserialize: логические противоречия', () => {
  const ctx2 = loadGameContext();
  const base = () => JSON.parse(serialize(newGame(ctx2, 0)));
  it('герой дважды в отряде', () => {
    const s = base();
    s.squad[1] = s.squad[0];
    expect(() => deserialize(JSON.stringify(s))).toThrow(/дважды/);
  });
  it('предмет на неизвестном герое и повтор id предмета', () => {
    const s = base();
    s.inventory.items = [{ id: 'it1', itemId: 'x', equippedBy: 'ghost' }];
    expect(() => deserialize(JSON.stringify(s))).toThrow(/неизвестного героя/);
    s.inventory.items = [
      { id: 'it1', itemId: 'x', equippedBy: null },
      { id: 'it1', itemId: 'y', equippedBy: null },
    ];
    expect(() => deserialize(JSON.stringify(s))).toThrow(/дважды/);
  });
});
