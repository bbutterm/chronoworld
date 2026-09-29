import { describe, expect, it } from 'vitest';
import {
  actClaimAllExpeditions,
  addHeroCard,
  autoParty,
  busyHeroes,
  claimAllExpeditions,
  claimExpedition,
  deserialize,
  expectedExpeditionLoot,
  expeditionSeed,
  expeditionStatus,
  finishedExpeditions,
  heroPower,
  idleExpeditions,
  lootHours,
  MetaError,
  migrateBountiesToExpeditions,
  MIGRATIONS,
  newGame,
  rollExpeditionLoot,
  SAVE_VERSION,
  serialize,
  SHARD_TO_GEMS,
  startExpedition,
  validateExpeditions,
  type CardRarity,
  type SaveState,
  groupDigits,
} from '../src/core';
import { expeditionsBadgeCount } from '../src/game/flow';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const D1 = '2026-09-26';
const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 26, 8);
const LOCS = ctx.meta.expeditions.locations;
const loc = (id: string) => LOCS.find((l) => l.id === id)!;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MetaError);
    return (e as MetaError).code;
  }
  return undefined;
}

/** Новая игра с пройденной кампанией до этапа stageId включительно. */
function clearedTo(stageId: string, s: SaveState = newGame(ctx, T0, D1)): SaveState {
  const i = ctx.content.stages.findIndex((x) => x.id === stageId);
  return { ...s, campaign: { cleared: ctx.content.stages.slice(0, i + 1).map((x) => x.id) } };
}

/** Добавить запасные карточки (вне отряда). */
/** Запас героев: [шаблон или «шаблон/ветка» (герои v2), редкость, уровень]. */
function withBench(s: SaveState, cards: [string, CardRarity, number?][]): SaveState {
  for (const [card, r, level] of cards) {
    const [t, branch] = card.split('/');
    const add = addHeroCard(s, t, r, { level: level ?? 1 });
    s = branch ? { ...add.save, heroes: add.save.heroes.map((h) => (h.id === add.hero.id ? { ...h, branch } : h)) } : add.save;
  }
  return s;
}

const power = (s: SaveState, id: string) => heroPower(s.heroes.find((h) => h.id === id)!, ctx, s);
const sumPower = (s: SaveState, ids: readonly string[]) => ids.reduce((n, id) => n + power(s, id), 0);

describe('K9 экспедиции: конфиг', () => {
  it('9 локаций открываются по ходу кампании (4 — главы 1–3, по одной на главы 4–6, 8 и 10), сроки 1 / 4 / 8 ч, пороги мощи растут', () => {
    // Маршрут из 10 глав: Гласт Хейм — глава 8 (новая локация), Долина Гьёлль переехала в Нифльхейм (глава 10).
    expect(LOCS.map((l) => l.id)).toEqual(['ant_hell', 'payon_cave', 'morroc_pyramid', 'clock_tower', 'sphinx_dungeon', 'kitsune_shrine', 'ghost_ship', 'glast_heim', 'gyoll_valley']);
    expect(LOCS.slice(4).map((l) => l.stage)).toEqual(['ch4_s1', 'ch5_s1', 'ch6_s1', 'ch8_s1', 'ch10_s1']);
    expect(ctx.meta.expeditions.durations.map((d) => d.hours)).toEqual([1, 4, 8]);
    const order = LOCS.map((l) => ctx.content.stages.findIndex((s) => s.id === l.stage));
    expect(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1]))).toBe(true);
    expect(LOCS.every((l, i) => i === 0 || l.power > LOCS[i - 1].power)).toBe(true);
    // Первая локация — там же, где открывается сама функция (data/unlocks.json → bounties).
    expect(LOCS[0].stage).toBe(ctx.unlocks!.features.find((f) => f.id === 'bounties')!.stage);
  });

  it('validateExpeditions: неизвестные этап, монстр и предмет — ошибки с именем файла', () => {
    const bad = structuredClone(ctx.meta.expeditions);
    bad.locations[0] = { ...bad.locations[0], stage: 'ch9_s9', monster: 'mob_nope', loot: [{ kind: 'item', chance: 0.1, count: 1, items: ['no_item'] }] };
    const problems: string[] = [];
    validateExpeditions(bad, ctx.content, ctx.equipment.items, problems);
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.startsWith('data/expeditions.json: локация ant_hell'))).toBe(true);
    const ok: string[] = [];
    validateExpeditions(ctx.meta.expeditions, ctx.content, ctx.equipment.items, ok);
    expect(ok).toEqual([]);
  });

  it('длинные экспедиции выгоднее в час; за сутки (3 × 4 ч + 8 ч) четыре локации глав 1–3 дают ≈ бюджет доски поручений', () => {
    for (const l of LOCS) {
      const perHour = (h: number) => expectedExpeditionLoot(l, h, ctx).gold / h;
      expect(perHour(4)).toBeGreaterThan(perHour(1));
      expect(perHour(8)).toBeGreaterThan(perHour(4));
    }
    expect(lootHours(8, ctx)).toBeCloseTo(9.6);
    const day = { gold: 0, jobExp: 0, gems: 0, heroCards: 0, items: 0, scrolls: 0 };
    for (const l of LOCS.slice(0, 4)) {
      for (const h of [4, 4, 4, 8]) {
        const e = expectedExpeditionLoot(l, h, ctx);
        for (const k of Object.keys(day) as (keyof typeof day)[]) day[k] += e[k];
      }
    }
    // Числа — docs/content/meta.md (раздел K9) и docs/content/balance.md: гемы ≈ доске поручений; карты героя (герои v2)
    // по ценности ≈ прежним осколкам (5–12 в день ≈ 0.2–0.4 синей карты: синяя = 3 зелёные копии ≈ 30 осколков);
    // золото и опыт — побочный доход (≈ 0.5% золота недели), пара предметов в день, свиток — раз в неделю-две.
    expect(day.gems).toBeGreaterThan(25);
    expect(day.gems).toBeLessThan(40);
    expect(day.heroCards).toBeGreaterThan(0.15);
    expect(day.heroCards).toBeLessThan(0.45);
    expect(day.gold).toBeGreaterThan(3500);
    expect(day.gold).toBeLessThan(5500);
    expect(day.items).toBeGreaterThan(0.5);
    expect(day.items).toBeLessThan(2);
    expect(day.scrolls).toBeLessThan(0.3);
  });

  it('локации глав 4–7 (LT-05): золото и опыт растут с главой, гемов мало (добавка к бюджету ≤ 15 в день на все четыре)', () => {
    const late = LOCS.slice(4);
    late.forEach((l, i) => {
      expect(l.perHour.gold, l.id).toBeGreaterThan((i === 0 ? LOCS[3] : late[i - 1]).perHour.gold * 1.4);
      expect(l.perHour.jobExp, l.id).toBeGreaterThan(l.perHour.gold);
    });
    let gems = 0;
    for (const l of late) for (const h of [4, 4, 4, 8]) gems += expectedExpeditionLoot(l, h, ctx).gems;
    expect(gems).toBeLessThanOrEqual(15);
  });
});

describe('K9 экспедиции: отправка', () => {
  it('закрытая и неизвестная локация, неверный срок', () => {
    const s = newGame(ctx, T0, D1);
    expect(codeOf(() => startExpedition(s, 'ant_hell', 4, T0, ctx))).toBe('location_locked');
    expect(() => startExpedition(s, 'ant_hell', 4, T0, ctx)).toThrow(/Откроется на этапе 1-12/i); // глава 1 — 18 этапов: ch1_s8 двенадцатый
    const open = clearedTo('ch1_s8');
    expect(codeOf(() => startExpedition(open, 'nowhere', 4, T0, ctx))).toBe('unknown_location');
    expect(codeOf(() => startExpedition(open, 'ant_hell', 3, T0, ctx))).toBe('invalid_duration');
    expect(codeOf(() => startExpedition(open, 'payon_cave', 4, T0, ctx))).toBe('location_locked');
  });

  it('одно нажатие: отряд собирается сам, мощь ≥ порога, время и добыча — снимком', () => {
    const s = clearedTo('ch1_s8');
    const pick = autoParty(s, 'ant_hell', ctx);
    expect(pick.ok).toBe(true);
    expect(pick.power).toBeGreaterThanOrEqual(loc('ant_hell').power);
    expect(pick.power).toBe(sumPower(s, pick.heroIds));
    const next = startExpedition(s, 'ant_hell', 4, T0, ctx);
    const e = next.bounties.active[0];
    expect(e).toMatchObject({ location: 'ant_hell', hours: 4, heroIds: pick.heroIds, power: pick.power, startedAt: T0, endsAt: T0 + 4 * H });
    expect(e.rewards).toEqual(rollExpeditionLoot(loc('ant_hell'), 4, expeditionSeed(s, 'ant_hell', T0), ctx));
    expect(e.rewards.gold).toBe(Math.round(loc('ant_hell').perHour.gold * 4.4));
    // Повторно в ту же локацию — нельзя, пока не забрали.
    expect(codeOf(() => startExpedition(next, 'ant_hell', 1, T0, ctx))).toBe('location_busy');
    // Детерминизм: то же сохранение и время — то же самое.
    expect(startExpedition(s, 'ant_hell', 4, T0, ctx)).toEqual(next);
  });

  it('порог мощи: не хватает — ok: false, показана наибольшая возможная мощь; отправка — not_enough_power', () => {
    const s = clearedTo('ch3_s1');
    const pick = autoParty(s, 'clock_tower', ctx);
    expect(pick.ok).toBe(false);
    expect(pick.heroIds).toEqual([]);
    const top5 = [...s.heroes].map((h) => power(s, h.id)).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
    expect(pick.power).toBe(top5);
    expect(pick.need).toBe(loc('clock_tower').power);
    expect(codeOf(() => startExpedition(s, 'clock_tower', 8, T0, ctx))).toBe('not_enough_power');
    expect(() => startExpedition(s, 'clock_tower', 8, T0, ctx)).toThrow(`${groupDigits(pick.power)} / нужно ${groupDigits(pick.need)}`); // числа — с разрядами (LT-07)
  });

  it('автоподбор: сначала те, кого нельзя отдать в корм (отряд, сюжетные), копии — последними; лишних нет', () => {
    // Сильный запас: две копии Ирис-Рыцаря (корм друг для друга) и уникальная карточка.
    let s = withBench(clearedTo('ch2_s1'), [['iris/knight', 'purple', 20], ['iris/knight', 'purple', 20], ['kai/wizard', 'purple', 20]]);
    const [s1, s2, kai] = s.heroes.slice(-3).map((h) => h.id);
    const pick = autoParty(s, 'ant_hell', ctx);
    expect(pick.ok).toBe(true);
    // Порог Муравейника набирают сюжетные герои отряда — запасных не трогаем.
    const keepers = new Set(s.squad);
    expect(pick.heroIds.every((id) => keepers.has(id))).toBe(true);
    // Лишних нет: без любого участника порог не набирается.
    for (const id of pick.heroIds) expect(pick.power - power(s, id)).toBeLessThan(pick.need);
    // Отряд ушёл в Муравейник — дальше запас: уникальная карточка раньше копий.
    s = startExpedition(s, 'ant_hell', 4, T0, ctx);
    const payon = autoParty(s, 'payon_cave', ctx);
    expect(payon.ok).toBe(true);
    if (payon.heroIds.includes(s1) || payon.heroIds.includes(s2)) expect(payon.heroIds).toContain(kai);
    // Герой — только в одной экспедиции.
    expect(payon.heroIds.filter((id) => busyHeroes(s).includes(id))).toEqual([]);
  });

  it('сильные герои бережутся: хватает слабого — сильного не берут', () => {
    const s = withBench(clearedTo('ch1_s8'), [['iris/knight', 'purple', 30]]);
    const strong = s.heroes[s.heroes.length - 1].id;
    const pick = autoParty(s, 'ant_hell', ctx);
    expect(pick.ok).toBe(true);
    expect(pick.heroIds).not.toContain(strong);
  });

  it('ручная группа (для скриптов): те же проверки', () => {
    const s = clearedTo('ch1_s8');
    const ids = s.heroes.map((h) => h.id);
    expect(codeOf(() => startExpedition(s, 'ant_hell', 1, T0, ctx, []))).toBe('too_many_heroes');
    expect(codeOf(() => startExpedition(s, 'ant_hell', 1, T0, ctx, ['a', 'b', 'c', 'd', 'e', 'f']))).toBe('too_many_heroes');
    expect(codeOf(() => startExpedition(s, 'ant_hell', 1, T0, ctx, [ids[0], ids[0]]))).toBe('duplicate_hero');
    expect(codeOf(() => startExpedition(s, 'ant_hell', 1, T0, ctx, ['ghost']))).toBe('unknown_hero');
    const weakest = [...ids].sort((a, b) => power(s, a) - power(s, b))[0];
    expect(codeOf(() => startExpedition(s, 'ant_hell', 1, T0, ctx, [weakest]))).toBe('not_enough_power');
    const all = startExpedition(s, 'ant_hell', 1, T0, ctx, ids);
    expect(all.bounties.active[0].power).toBe(sumPower(s, ids));
    const s2 = clearedTo('ch2_s1', all);
    expect(codeOf(() => startExpedition(s2, 'payon_cave', 1, T0, ctx, [ids[0]]))).toBe('hero_busy');
  });
});

describe('K9 экспедиции: добыча и получение', () => {
  it('rollExpeditionLoot детерминирован, у разных отправок — свои броски', () => {
    const l = loc('clock_tower');
    const a = rollExpeditionLoot(l, 8, 123, ctx);
    expect(rollExpeditionLoot(l, 8, 123, ctx)).toEqual(a);
    const many = Array.from({ length: 200 }, (_, i) => rollExpeditionLoot(l, 8, expeditionSeed({ createdAt: 1 }, l.id, i * H), ctx));
    expect(new Set(many.map((r) => JSON.stringify(r))).size).toBeGreaterThan(10);
    // Все предметы — из темы локации.
    const theme = new Set(l.loot.flatMap((x) => x.items ?? []));
    expect(many.flatMap((r) => r.items).every((id) => theme.has(id))).toBe(true);
    // Среднее по 200 отправкам близко к ожиданию.
    const e = expectedExpeditionLoot(l, 8, ctx);
    const avg = many.reduce((n, r) => n + r.gems, 0) / many.length;
    expect(avg).toBeGreaterThan(e.gems * 0.6);
    expect(avg).toBeLessThan(e.gems * 1.4);
  });

  it('забрать: только после возвращения; награда, герои свободны, bounties_done + 1', () => {
    const s0 = clearedTo('ch1_s8');
    const s = startExpedition(s0, 'ant_hell', 1, T0, ctx);
    const e = s.bounties.active[0];
    expect(codeOf(() => claimExpedition(s, 'ant_hell', T0 + H - 1, ctx))).toBe('expedition_not_finished');
    expect(codeOf(() => claimExpedition(s0, 'ant_hell', T0, ctx))).toBe('expedition_not_running');
    expect(codeOf(() => claimExpedition(s, 'nowhere', T0, ctx))).toBe('unknown_location');
    const r = claimExpedition(s, 'ant_hell', T0 + H, ctx);
    expect(r.save.bounties.active).toEqual([]);
    expect(busyHeroes(r.save)).toEqual([]);
    expect(r.save.resources.gold).toBe(s.resources.gold + e.rewards.gold);
    expect(r.save.resources.heroExp).toBe(s.resources.heroExp + e.rewards.jobExp);
    expect(r.save.currency.gems).toBe(s.currency.gems + e.rewards.gems);
    expect(r.added.map((i) => i.itemId)).toEqual(e.rewards.items);
    expect(r.save.achievements.counters.bounties_done).toBe(1);
    expect(r.events[0]).toEqual({ type: 'expeditionDone', location: 'ant_hell', heroIds: e.heroIds });
  });

  it('свитки, осколки и предметы из снимка добычи выдаются; локацию убрали из конфига — забрать всё равно можно', () => {
    const s0 = clearedTo('ch1_s8');
    const hero = s0.heroes[0].id;
    const s: SaveState = {
      ...s0,
      bounties: {
        active: [
          { location: 'old_place', hours: 1, heroIds: [hero], power: 1, startedAt: 0, endsAt: 10, rewards: { gold: 1, jobExp: 2, gems: 3, heroCards: { blue: 1, purple: 1 }, scrolls: 2, items: ['knife', 'gone_item'] } },
        ],
      },
    };
    const r = claimExpedition(s, 'old_place', 10, ctx);
    expect(r.save.currency.scrolls).toBe(s.currency.scrolls + 2);
    expect(r.save.heroes.slice(s.heroes.length).map((h) => h.rarity)).toEqual(['blue', 'purple']);
    expect(r.rewards.items).toEqual(['knife']);
    expect(r.added).toHaveLength(1);
  });

  it('«Забрать всё»: только вернувшиеся, сумма как по одной; нечего — тот же save; статус и значок главной', () => {
    let s = clearedTo('ch2_s6', withBench(newGame(ctx, T0, D1), [['iris/knight', 'purple', 30], ['kai/wizard', 'purple', 30], ['teo/monk', 'purple', 30]]));
    expect(idleExpeditions(s, ctx)).toBeGreaterThanOrEqual(2);
    expect(expeditionsBadgeCount(s, T0, ctx)).toBe(idleExpeditions(s, ctx));
    s = startExpedition(s, 'ant_hell', 1, T0, ctx);
    s = startExpedition(s, 'payon_cave', 8, T0, ctx);
    const view = expeditionStatus(s, T0 + H, ctx);
    expect(view.map((v) => v.location.id)).toEqual(LOCS.map((l) => l.id));
    expect(view[0].active!.done).toBe(true);
    expect(view[1].active!.remainingMs).toBe(7 * H);
    expect(view[3]).toMatchObject({ unlocked: false, lockedText: 'Откроется на этапе 3-1', active: null, party: null });
    expect(finishedExpeditions(s, T0 + H)).toBe(1);
    const r = claimAllExpeditions(s, T0 + H, ctx);
    expect(r.claimed).toEqual(['ant_hell']);
    expect(r.rewards).toEqual(claimExpedition(s, 'ant_hell', T0 + H, ctx).rewards);
    expect(r.save.bounties.active.map((e) => e.location)).toEqual(['payon_cave']);
    expect(claimAllExpeditions(r.save, T0 + H, ctx).save).toBe(r.save);
    expect(actClaimAllExpeditions(r.save, D1, T0 + H, ctx).claimed).toEqual([]);
    const both = claimAllExpeditions(s, T0 + 8 * H, ctx);
    expect(both.claimed).toEqual(['ant_hell', 'payon_cave']);
    expect(both.save.achievements.counters.bounties_done).toBe(2);
  });
});

describe('миграция сохранения v5 → v6 (поручения → экспедиции)', () => {
  const v5 = (bounties: unknown) => {
    const s = JSON.parse(serialize(newGame(ctx, T0, D1)));
    return { ...s, version: 5, bounties };
  };

  it('поручения в работе: герои свободны, награда — письмом (осколки — гемами), сообщение игроку', () => {
    const old = v5({
      board: [{ id: 'b3', templateId: 'patrol', rarity: 'common', durationMinutes: 30, heroCount: 1, role: null, rewards: { gold: 100, jobExp: 60, gems: 0 } }],
      lastRefreshDay: '2026-09-25',
      refreshesUsed: 1,
      active: [
        { id: 'b1', templateId: 'hunt', rarity: 'rare', durationMinutes: 240, heroCount: 1, role: null, rewards: { gold: 600, jobExp: 1080, gems: 10, shards: 2 }, heroIds: ['h1'], startedAt: 0, endsAt: 1 },
        { id: 'b2', templateId: 'herbs', rarity: 'common', durationMinutes: 60, heroCount: 1, role: null, rewards: { gold: 150, jobExp: 90, gems: 0 }, heroIds: ['h2'], startedAt: 0, endsAt: T0 * 2 },
      ],
    });
    const copy = structuredClone(old);
    const out = MIGRATIONS[5](old);
    expect(old).toEqual(copy);
    expect(out.version).toBe(6);
    expect(out.bounties).toEqual({ active: [] });
    expect(out.mail.seq).toBe(1);
    expect(out.mail.letters[0]).toMatchObject({
      id: 'm1',
      title: 'Поручения стали экспедициями',
      day: '2026-09-25',
      rewards: { gold: 750, jobExp: 1170, gems: 10 + 2 * SHARD_TO_GEMS },
      read: false,
      claimed: false,
    });
    expect(out.notices).toEqual([expect.stringMatching(/экспедициями.*\(2\)/)]);
    // Через deserialize — валидное сохранение текущей версии.
    const s = deserialize(JSON.stringify(old));
    expect(s.version).toBe(SAVE_VERSION);
    expect(busyHeroes(s)).toEqual([]);
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('без поручений в работе — ни письма, ни сообщения; битое поле не роняет', () => {
    const out = migrateBountiesToExpeditions(v5({ board: [], lastRefreshDay: '1970-01-01', refreshesUsed: 0, active: [] }));
    expect(out.bounties).toEqual({ active: [] });
    expect(out.mail.letters).toEqual([]);
    expect(out.notices).toBeUndefined();
    expect(migrateBountiesToExpeditions({ version: 5, bounties: 'x' }).bounties).toEqual({ active: [] });
    expect(migrateBountiesToExpeditions({ version: 5, bounties: { active: [{ rewards: { gold: -5, gems: 'x' } }] } }).mail).toBeUndefined();
  });
});
