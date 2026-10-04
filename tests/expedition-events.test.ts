import { describe, expect, it } from 'vitest';
import {
  addHeroCard,
  choiceExpectation,
  choiceOdds,
  chooseExpeditionEvent,
  claimExpedition,
  deserialize,
  eventParty,
  eventsForLocation,
  expeditionEventCount,
  expeditionEventViews,
  fillEventText,
  noFitLead,
  MetaError,
  newGame,
  parseExpeditionEvents,
  pendingExpeditionEvents,
  rollExpeditionEvents,
  Rng,
  serialize,
  startExpedition,
  validateExpeditionEvents,
  type EventHero,
  type ExpeditionEventsConfig,
  type SaveState,
} from '../src/core';
import { loadFullContext, readRawGameData } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const cfg = ctx.expeditionEvents!;
const D1 = '2026-09-30';
const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 30, 8);
const LOCS = ctx.meta.expeditions.locations;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MetaError);
    return (e as MetaError).code;
  }
  return undefined;
}

/** Новая игра с кампанией до stageId и запасом героев (шаблоны). */
function game(stageId: string, bench: string[] = []): SaveState {
  let s = newGame(ctx, T0, D1);
  const i = ctx.content.stages.findIndex((x) => x.id === stageId);
  s = { ...s, campaign: { cleared: ctx.content.stages.slice(0, i + 1).map((x) => x.id) } };
  for (const t of bench) s = addHeroCard(s, t, 'purple', { level: 30 }).save;
  return s;
}

/** Подменить события экспедиции в локации (для точечных проверок). */
function withEvents(s: SaveState, location: string, events: { id: string; at: number }[]): SaveState {
  return { ...s, bounties: { ...s.bounties, active: s.bounties.active.map((e) => (e.location === location ? { ...e, events } : e)) } };
}

/** Подменить отряд экспедиции (без проверки мощи). */
function withParty(s: SaveState, location: string, heroIds: string[]): SaveState {
  return { ...s, bounties: { ...s.bounties, active: s.bounties.active.map((e) => (e.location === location ? { ...e, heroIds } : e)) } };
}

/** Контекст с изменённым конфигом событий. */
function ctxWith(edit: (c: ExpeditionEventsConfig) => void): typeof ctx {
  const c = structuredClone(cfg);
  edit(c);
  return { ...ctx, expeditionEvents: c };
}

const hero = (templateId: string): EventHero => {
  const t = ctx.content.heroes[templateId];
  return { id: templateId, templateId, name: t.name, line: t.line, role: t.role, gender: t.gender === 'f' ? 'f' : 'm' };
};

describe('события экспедиций: контент', () => {
  it('≥ 40 событий: у каждой локации ≥ 3 своих, общих 6–8; ссылки целы', () => {
    expect(cfg.events.length).toBeGreaterThanOrEqual(40);
    for (const loc of LOCS) expect(cfg.events.filter((e) => e.locations.includes(loc.id)).length, loc.id).toBeGreaterThanOrEqual(3);
    const common = cfg.events.filter((e) => !e.locations.length).length;
    expect(common).toBeGreaterThanOrEqual(6);
    expect(common).toBeLessThanOrEqual(8);
    const problems: string[] = [];
    validateExpeditionEvents(cfg, LOCS, ctx, problems);
    expect(problems).toEqual([]);
  });

  it('проверки ссылок и схемы ловят ошибки', () => {
    const bad = structuredClone(cfg);
    bad.events[0].locations = ['nowhere'];
    bad.events[1].choices[0].requires = { hero: ['nobody'] };
    const problems: string[] = [];
    validateExpeditionEvents(bad, LOCS, ctx, problems);
    expect(problems.join('\n')).toMatch(/nowhere/);
    expect(problems.join('\n')).toMatch(/nobody/);
    const raw = structuredClone(readRawGameData().expeditionEvents) as { events: { choices: { default?: boolean }[] }[] };
    raw.events[0].choices.forEach((c) => delete c.default);
    expect(() => parseExpeditionEvents(raw)).toThrow(/default/);
  });

  it('подстановки: {hero}, {partner}, род', () => {
    expect(fillEventText('{hero} [нашёл|нашла] ключ, {partner} рядом', hero('zara'), hero('bran'))).toBe('Зара нашла ключ, Бран рядом');
    expect(fillEventText('{hero} [нашёл|нашла]', hero('dorn'))).toBe('Дорн нашёл');
  });

  it('BUG-186: нужного героя нет — перед исходом пояснение, кто взялся вместо; подходит — без пояснения', () => {
    const name = (id: string) => ctx.content.heroes[id]?.name ?? id;
    const iris = hero('iris');
    expect(noFitLead({ role: ['healer'] }, iris, name)).toBe(`Лекаря в отряде нет — за дело берётся ${iris.name}. `);
    expect(noFitLead({ line: ['merchant'] }, hero('kai'), name)).toMatch(/^Торговца в отряде нет — за дело берётся Кай\. $/);
    expect(noFitLead({ hero: ['otto'] }, iris, name)).toBe(`${name('otto')} не в отряде — за дело берётся ${iris.name}. `);
    expect(noFitLead({ hero: ['iris'] }, iris, name)).toBe('');
    expect(noFitLead(undefined, iris, name)).toBe('');
    // В текстах исходов вариантов с требованием нет зашитых имён героев (действует {hero}).
    const names = Object.values(ctx.content.heroes).map((h) => h.name);
    for (const e of cfg.events)
      for (const c of e.choices.filter((x) => x.requires))
        for (const o of [c.success, c.fail]) for (const n of names) expect(o?.text ?? '', `${e.id}/${c.id}`).not.toMatch(new RegExp(`(^|[^А-Яа-яё])${n}([^А-Яа-яё]|$)`));
  });
});

describe('события экспедиций: отправка и решения', () => {
  it('1 ч — одно событие, 4 ч — два, 8 ч — три; время внутри срока; детерминизм', () => {
    expect([1, 4, 8].map((h) => expeditionEventCount(h, cfg))).toEqual([1, 2, 3]);
    const s = game('ch1_s8');
    for (const h of [1, 4, 8]) {
      const e = startExpedition(s, 'ant_hell', h, T0, ctx).bounties.active[0];
      expect(e.events).toHaveLength(h === 1 ? 1 : h === 4 ? 2 : 3);
      for (const ev of e.events!) {
        expect(ev.at).toBeGreaterThan(e.startedAt);
        expect(ev.at).toBeLessThan(e.endsAt);
        expect(eventsForLocation('ant_hell', cfg).some((d) => d.id === ev.id)).toBe(true);
      }
      expect(new Set(e.events!.map((x) => x.id)).size).toBe(e.events!.length);
      expect(startExpedition(s, 'ant_hell', h, T0, ctx)).toEqual(startExpedition(s, 'ant_hell', h, T0, ctx));
    }
    // Разные отправки — разные события (хотя бы где-то).
    const sets = new Set(Array.from({ length: 12 }, (_, k) => startExpedition(s, 'ant_hell', 8, T0 + k * 1000, ctx).bounties.active[0].events!.map((x) => x.id).join()));
    expect(sets.size).toBeGreaterThan(3);
    // Свои события локации выпадают чаще общих.
    const own = Array.from({ length: 200 }, (_, k) => rollExpeditionEvents('ant_hell', 0, 8 * H, 8, k, cfg))
      .flat()
      .filter((ev) => cfg.events.find((d) => d.id === ev.id)!.locations.length).length;
    expect(own / 600).toBeGreaterThan(0.4);
  });

  it('событие ждёт решения, когда случилось; выбор сохраняется, переиграть нельзя', () => {
    const s = startExpedition(game('ch1_s8'), 'ant_hell', 8, T0, ctx);
    const e = s.bounties.active[0];
    const [first] = e.events!;
    expect(pendingExpeditionEvents(s, first.at - 1)).toBe(0);
    expect(expeditionEventViews(s, 'ant_hell', first.at - 1, ctx)).toEqual([]);
    expect(pendingExpeditionEvents(s, first.at)).toBe(1);
    expect(pendingExpeditionEvents(s, e.endsAt)).toBe(3);
    const def = cfg.events.find((d) => d.id === first.id)!;
    expect(codeOf(() => chooseExpeditionEvent(s, 'ant_hell', 0, def.choices[0].id, first.at - 1, ctx))).toBe('event_not_ready');
    expect(codeOf(() => chooseExpeditionEvent(s, 'ant_hell', 0, 'nope', first.at, ctx))).toBe('unknown_choice');
    expect(codeOf(() => chooseExpeditionEvent(s, 'ant_hell', 7, def.choices[0].id, first.at, ctx))).toBe('unknown_event');
    expect(codeOf(() => chooseExpeditionEvent(s, 'payon_cave', 0, def.choices[0].id, first.at, ctx))).toBe('expedition_not_running');
    const next = chooseExpeditionEvent(s, 'ant_hell', 0, def.choices[0].id, first.at, ctx);
    expect(next.bounties.active[0].events![0].choice).toBe(def.choices[0].id);
    expect(chooseExpeditionEvent(s, 'ant_hell', 0, def.choices[0].id, first.at + 5 * H, ctx)).toEqual(next);
    expect(codeOf(() => chooseExpeditionEvent(next, 'ant_hell', 0, def.choices[1].id, first.at, ctx))).toBe('event_resolved');
    const [view] = expeditionEventViews(next, 'ant_hell', first.at, ctx);
    expect(view.pending).toBe(false);
    expect(view.outcome!.choice).toBe(def.choices[0].label);
    expect(view.text).not.toMatch(/\{|\[/);
    expect(pendingExpeditionEvents(next, e.endsAt)).toBe(2);
  });

  it('требование класса: герой есть — chanceWith и он действует; нет — только chance', () => {
    const ev = cfg.events.find((d) => d.id === 'ant_caravan_crate')!;
    const pick = ev.choices.find((c) => c.id === 'pick')!;
    expect(pick.requires?.line).toEqual(['thief']);
    const withThief = choiceOdds(pick, [hero('alan'), hero('zara')]);
    expect(withThief.chance).toBe(pick.chanceWith);
    expect(withThief.fits.map((h) => h.templateId)).toEqual(['zara']);
    const noThief = choiceOdds(pick, [hero('alan'), hero('vika')]);
    expect(noThief).toEqual({ chance: pick.chance, fits: [] });
    expect(choiceExpectation(pick, [hero('zara')], cfg)).toBeGreaterThan(choiceExpectation(pick, [hero('alan')], cfg));

    // В игре: вор в отряде — он и действует; шанс в окне — chanceWith.
    const s0 = game('ch1_s8', ['zara']);
    const zara = s0.heroes.find((h) => h.templateId === 'zara')!.id;
    let s = withParty(startExpedition(s0, 'ant_hell', 1, T0, ctx), 'ant_hell', [zara, s0.heroes[0].id]);
    s = withEvents(s, 'ant_hell', [{ id: 'ant_caravan_crate', at: T0 + 1000 }]);
    const [v] = expeditionEventViews(s, 'ant_hell', T0 + 1000, ctx);
    const pv = v.choices.find((c) => c.id === 'pick')!;
    expect(pv).toMatchObject({ chance: pick.chanceWith, missing: false });
    expect(pv.hero!.id).toBe(zara);
    const done = chooseExpeditionEvent(s, 'ant_hell', 0, 'pick', T0 + 1000, ctx).bounties.active[0].events![0];
    expect(done.actor).toBe(zara);
    // Без вора — «только шанс».
    let s2 = withParty(startExpedition(s0, 'ant_hell', 1, T0, ctx), 'ant_hell', [s0.heroes[0].id]);
    s2 = withEvents(s2, 'ant_hell', [{ id: 'ant_caravan_crate', at: T0 + 1000 }]);
    const pv2 = expeditionEventViews(s2, 'ant_hell', T0 + 1000, ctx)[0].choices.find((c) => c.id === 'pick')!;
    expect(pv2).toMatchObject({ chance: pick.chance, missing: true, hero: null });
    // BUG-186: без вора действует другой герой — исход начинается с пояснения, кто взялся вместо.
    const out2 = expeditionEventViews(chooseExpeditionEvent(s2, 'ant_hell', 0, 'pick', T0 + 1000, ctx), 'ant_hell', T0 + 1000, ctx)[0].outcome!;
    expect(out2.text).toMatch(/^Вора в отряде нет — за дело берётся \S+\. /);
    const out1 = expeditionEventViews(chooseExpeditionEvent(s, 'ant_hell', 0, 'pick', T0 + 1000, ctx), 'ant_hell', T0 + 1000, ctx)[0].outcome!;
    expect(out1.text).not.toMatch(/в отряде нет/);
  });

  it('шанс детерминирован: доля успехов по многим отправкам ≈ chance', () => {
    const s0 = game('ch1_s8');
    const ids = [s0.heroes[0].id];
    let ok = 0;
    const N = 300;
    for (let k = 0; k < N; k++) {
      let s = withParty(startExpedition(s0, 'ant_hell', 1, T0 + k, ctx), 'ant_hell', ids);
      s = withEvents(s, 'ant_hell', [{ id: 'ant_egg_hall', at: T0 + k }]);
      if (chooseExpeditionEvent(s, 'ant_hell', 0, 'crawl', T0 + k, ctx).bounties.active[0].events![0].ok) ok++;
    }
    expect(ok / N).toBeGreaterThan(0.5);
    expect(ok / N).toBeLessThan(0.7);
  });
});

describe('события экспедиций: получение', () => {
  it('не решил — вариант по умолчанию: добыча как в снимке, рассказ помечен «само»', () => {
    const s = startExpedition(game('ch1_s8'), 'ant_hell', 8, T0, ctx);
    const e = s.bounties.active[0];
    const r = claimExpedition(s, 'ant_hell', e.endsAt, ctx);
    expect(r.rewards).toEqual(e.rewards);
    expect(r.save.resources.gold).toBe(s.resources.gold + e.rewards.gold);
    expect(r.story).toHaveLength(3);
    for (const line of r.story) {
      expect(line.auto).toBe(true);
      expect(line.gold).toBe(0);
      expect(line.text).not.toMatch(/\{|\}/);
    }
  });

  it('выбор с наградой: золото и опыт — ступень от куска добычи; предмет — из добычи локации; рана — минус', () => {
    // Все шансы — 1, чтобы проверить суммы.
    const c = ctxWith((x) => x.events.forEach((ev) => ev.choices.forEach((ch) => ((ch.chance = 1), (ch.chanceWith = 1)))));
    let s = startExpedition(game('ch1_s8'), 'ant_hell', 4, T0, c);
    s = withEvents(s, 'ant_hell', [
      { id: 'ant_egg_hall', at: T0 + 1000 },
      { id: 'ant_caravan_crate', at: T0 + 2000 },
    ]);
    s = chooseExpeditionEvent(s, 'ant_hell', 0, 'crawl', T0 + 1000, c); // small
    s = chooseExpeditionEvent(s, 'ant_hell', 1, 'fight', T0 + 2000, c); // small + предмет
    const e = s.bounties.active[0];
    const r = claimExpedition(s, 'ant_hell', e.endsAt, c);
    const slice = e.rewards.gold / 2;
    expect(r.rewards.gold).toBe(e.rewards.gold + 2 * Math.round(slice * cfg.tiers.small));
    expect(r.rewards.jobExp).toBe(e.rewards.jobExp + 2 * Math.round((e.rewards.jobExp / 2) * cfg.tiers.small));
    expect(r.rewards.items).toHaveLength(e.rewards.items.length + 1);
    const common = LOCS.find((l) => l.id === 'ant_hell')!.loot.find((l) => l.kind === 'item')!.items!;
    expect(common).toContain(r.rewards.items[r.rewards.items.length - 1]);
    expect(r.story.map((l) => [l.auto, l.ok])).toEqual([
      [false, true],
      [false, true],
    ]);

    // Неудача с раной: минус кусок, раненый — тот, кто действовал.
    const f = ctxWith((x) => x.events.forEach((ev) => ev.choices.forEach((ch) => ((ch.chance = 0), (ch.chanceWith = 0)))));
    let s2 = startExpedition(game('ch1_s8'), 'ant_hell', 1, T0, f);
    s2 = withEvents(s2, 'ant_hell', [{ id: 'ant_caravan_crate', at: T0 + 1000 }]);
    s2 = chooseExpeditionEvent(s2, 'ant_hell', 0, 'fight', T0 + 1000, f);
    const e2 = s2.bounties.active[0];
    const r2 = claimExpedition(s2, 'ant_hell', e2.endsAt, f);
    expect(r2.rewards.gold).toBe(e2.rewards.gold + Math.round(e2.rewards.gold * cfg.tiers.loss));
    expect(r2.story[0].wounded).toBe(e2.events![0].actor);
    expect(r2.save.heroes.map((h) => h.id)).toEqual(s2.heroes.map((h) => h.id));
  });

  it('Летопись и «сблизились» записываются в экспедиции; лимит записей', () => {
    const c = ctxWith((x) => {
      x.journalMax = 5;
      x.events.forEach((ev) => ev.choices.forEach((ch) => ((ch.chance = 1), (ch.chanceWith = 1))));
    });
    let s = game('ch1_s8', ['bran', 'zara']);
    for (let k = 0; k < 3; k++) {
      s = startExpedition(s, 'ant_hell', 1, T0 + k * 2 * H, c);
      s = withParty(s, 'ant_hell', s.heroes.slice(0, 3).map((h) => h.id));
      s = withEvents(s, 'ant_hell', [{ id: 'road_night_owl', at: T0 + k * 2 * H + 1000 }]);
      s = chooseExpeditionEvent(s, 'ant_hell', 0, 'talk', T0 + k * 2 * H + 1000, c);
      // Решённое игроком — в Летопись сразу; при «Забрать» не дублируется.
      expect(s.bounties.journal).toHaveLength(k + 1);
      s = claimExpedition(s, 'ant_hell', T0 + k * 2 * H + H, c).save;
      expect(s.bounties.journal).toHaveLength(k + 1);
    }
    expect(s.bounties.bonds).toHaveLength(3);
    // Не решил — запись при «Забрать»; лимит journalMax — последние.
    for (let k = 3; k < 6; k++) {
      s = startExpedition(s, 'ant_hell', 1, T0 + k * 2 * H, c);
      s = withEvents(s, 'ant_hell', [{ id: 'ant_queen_song', at: T0 + k * 2 * H + 1000 }]);
      s = claimExpedition(s, 'ant_hell', T0 + k * 2 * H + H, c).save;
    }
    expect(s.bounties.journal).toHaveLength(5);
    expect(s.bounties.journal![4].text).toMatch(/замирают/);
    const [a, b] = s.bounties.bonds![0].heroes;
    expect(a).not.toBe(b);
    expect(s.bounties.journal![0].text).not.toMatch(/\{/);
    // Переживает сохранение.
    expect(deserialize(serialize(s)).bounties).toEqual(s.bounties);
  });

  it('старое сохранение: идущая экспедиция без событий читается и забирается как раньше', () => {
    const s = startExpedition(game('ch1_s8'), 'ant_hell', 4, T0, ctx);
    const { events: _drop, ...old } = s.bounties.active[0];
    const legacy = JSON.parse(serialize(s)) as SaveState;
    legacy.bounties = { active: [old] };
    const loaded = deserialize(JSON.stringify(legacy));
    expect(loaded.bounties.active[0].events).toBeUndefined();
    expect(pendingExpeditionEvents(loaded, old.endsAt)).toBe(0);
    expect(expeditionEventViews(loaded, 'ant_hell', old.endsAt, ctx)).toEqual([]);
    const r = claimExpedition(loaded, 'ant_hell', old.endsAt, ctx);
    expect(r.rewards).toEqual(old.rewards);
    expect(r.story).toEqual([]);
    expect(r.save.bounties.journal).toBeUndefined();
    // Событие, которого больше нет в data, не ломает получение.
    const gone = withEvents(s, 'ant_hell', [{ id: 'removed_event', at: T0 + 1 }]);
    expect(claimExpedition(gone, 'ant_hell', old.endsAt, ctx).rewards).toEqual(old.rewards);
    // Без конфига событий — экспедиции как раньше.
    const { expeditionEvents: _e, ...bare } = ctx;
    expect(startExpedition(game('ch1_s8'), 'ant_hell', 4, T0, bare).bounties.active[0].events).toBeUndefined();
  });
});

describe('события экспедиций: баланс', () => {
  /**
   * Добыча с событиями к прежней: разумный игрок выбирает лучший по ожиданию вариант для своего отряда, ленивый — ничего
   * (вариант по умолчанию). Кусок = снимок / число событий, поэтому доля прибавки = средняя ступень выбранных вариантов.
   * Отряды — случайные 2–5 героев из 12 карточек, все локации, срок 8 ч.
   */
  it('разумный выбор: +10…20% золота и опыта; по умолчанию — прежняя добыча', () => {
    const heroes = Object.keys(ctx.content.heroes).map(hero);
    const rng = new Rng(20260930);
    let best = 0;
    let def = 0;
    let n = 0;
    for (let it = 0; it < 800; it++) {
      const size = 2 + rng.int(4);
      const pool = [...heroes];
      const party = Array.from({ length: size }, () => pool.splice(rng.int(pool.length), 1)[0]);
      for (const loc of LOCS) {
        for (const ev of rollExpeditionEvents(loc.id, 0, 8 * H, 8, rng.int(2 ** 31), cfg)) {
          const d = cfg.events.find((x) => x.id === ev.id)!;
          best += Math.max(...d.choices.map((c) => choiceExpectation(c, party, cfg)));
          def += choiceExpectation(d.choices.find((c) => c.default)!, party, cfg);
          n++;
        }
      }
    }
    const bonus = best / n;
    console.log(`события экспедиций: разумный выбор +${(bonus * 100).toFixed(1)}%, по умолчанию +${((def / n) * 100).toFixed(1)}%`);
    expect(def / n).toBe(0);
    expect(bonus).toBeGreaterThanOrEqual(0.1);
    expect(bonus).toBeLessThanOrEqual(0.2);
  });

  it('в каждом событии есть вариант лучше осторожного хотя бы для кого-то, и нет «всегда выгодного» без риска', () => {
    const heroes = Object.keys(ctx.content.heroes).map(hero);
    for (const d of cfg.events) {
      const gain = Math.max(...d.choices.map((c) => choiceExpectation(c, heroes, cfg)));
      expect(gain, d.id).toBeGreaterThan(0);
      for (const c of d.choices) {
        if (c.default) continue;
        // Надёжность — только с нужным героем: без требований шанс < 1.
        if (!c.requires) expect(c.chance, `${d.id}/${c.id}`).toBeLessThan(1);
      }
    }
  });

  it('party в экспедиции — только существующие герои', () => {
    const s = game('ch1_s8');
    expect(eventParty(s, [s.heroes[0].id, 'ghost'], ctx).map((h) => h.id)).toEqual([s.heroes[0].id]);
  });

  it('шанс помощи раненому учитывает лекаря выбранной профессии, а не стартовую роль', () => {
    let s = game('ch2_s1', ['greta', 'vika']);
    const greta = s.heroes.find((h) => h.templateId === 'greta')!;
    const vika = s.heroes.find((h) => h.templateId === 'vika' && h.rarity === 'purple')!;
    s = { ...s, heroes: s.heroes.map((h) => h.id === greta.id ? { ...h, branch: 'alchemist' } : h.id === vika.id ? { ...h, branch: 'monk' } : h) };
    const choice = cfg.events.find((e) => e.id === 'road_wounded_stranger')!.choices.find((c) => c.id === 'heal')!;
    const alchemist = eventParty(s, [greta.id], ctx);
    const monk = eventParty(s, [vika.id], ctx);
    expect(choiceOdds(choice, alchemist)).toMatchObject({ chance: choice.chanceWith, fits: [{ id: greta.id, role: 'healer' }] });
    expect(choiceOdds(choice, monk)).toEqual({ chance: choice.chance, fits: [] });
    expect(noFitLead(choice.requires, alchemist[0], (id) => ctx.content.heroes[id].name)).toBe('');
    expect(noFitLead(choice.requires, monk[0], (id) => ctx.content.heroes[id].name)).toMatch(/^Лекаря в отряде нет/);
  });

  it('защита от мародёров доступна танку новой ветки; без фиолетовой редкости действует первая профессия', () => {
    const s = game('ch2_s1', ['iris']);
    const iris = s.heroes.find((h) => h.templateId === 'iris')!;
    const choice = cfg.events.find((e) => e.id === 'road_marauders')!.choices.find((c) => c.id === 'storm')!;
    const withIris = (rarity: 'blue' | 'purple') => eventParty({ ...s, heroes: [{ ...iris, rarity, branch: 'crusader' }] }, [iris.id], ctx);
    expect(choiceOdds(choice, withIris('purple'))).toMatchObject({ chance: choice.chanceWith, fits: [{ id: iris.id, role: 'tank' }] });
    expect(choiceOdds(choice, withIris('blue'))).toEqual({ chance: choice.chance, fits: [] });
  });
});
