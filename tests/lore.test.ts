import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bestiary, chronicleKeys, emptyLore, firstSentence, heroEntries, itemEntries, newGame, parseLore, unseenCount, validateLore, worldEntries, type Lore } from '../src/core';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const check = (lore: Lore) => validateLore(lore, { content: ctx.content, items: ctx.equipment.items });
const firstMonster = ctx.content.stages[0].enemies.find((e) => !!e)!.unit;
const anItem = Object.values(ctx.equipment.items)[0].id;
const aHero = Object.keys(ctx.content.heroes)[0];

describe('лор: схема и сборка', () => {
  it('файлы data/lore проходят схему и ссылки (как в content:check)', () => {
    const dir = join(ROOT, 'data/lore');
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: `data/lore/${f}`, data: readFileSync(join(dir, f), 'utf8') })) : [];
    const { lore, problems } = parseLore(files);
    expect(problems).toEqual([]);
    expect(check(lore).errors).toEqual([]);
  });

  it('нет файлов, пустой файл и пустые entries — пустой лор без ошибок', () => {
    expect(parseLore([]).lore).toEqual(emptyLore());
    const r = parseLore([
      { file: 'data/lore/monsters.json', data: '' },
      { file: 'data/lore/items.json', data: '  \n' },
      { file: 'data/lore/heroes.json', data: { entries: {} } },
      { file: 'data/lore/jobs.json', data: {} },
    ]);
    expect(r.problems).toEqual([]);
    expect(r.lore).toEqual(emptyLore());
  });

  it('формат писателя читается целиком', () => {
    const { lore, problems } = parseLore([
      { file: '../../data/lore/monsters.json', data: JSON.stringify({ $comment: 'x', entries: { [firstMonster]: { title: 'Розовое желе', text: 'Прыгает. Кусается.', quote: 'Пуи!' } } }) },
      { file: 'data/lore/items.json', data: { entries: { [anItem]: 'Старый клинок.' } } },
      { file: 'data/lore/heroes.json', data: { entries: { [aHero]: { story: 'Жил-был.', quirks: ['Храпит'] } } } },
      { file: 'data/lore/jobs.json', data: { entries: { swordman: 'Гильдия мечников.' } } },
      { file: 'data/lore/world.json', data: { chapters: { chapter1: { title: 'Луга', location: 'Пронтера', text: 'Текст.' } }, world: [{ id: 'midgard', title: 'Мидгард', text: 'Мир.' }] } },
    ]);
    expect(problems).toEqual([]);
    expect(lore.monsters[firstMonster].quote).toBe('Пуи!');
    expect(lore.items[anItem]).toBe('Старый клинок.');
    expect(lore.heroes[aHero].quirks).toEqual(['Храпит']);
    expect(lore.jobs.swordman).toBe('Гильдия мечников.');
    expect(lore.world[0].id).toBe('midgard');
    expect(check(lore)).toEqual({ errors: [], warnings: [] });
  });

  it('битый JSON и нарушение схемы — ошибка с именем файла, остальное читается', () => {
    const r = parseLore([
      { file: 'data/lore/monsters.json', data: '{ oops' },
      { file: 'data/lore/items.json', data: { entries: { [anItem]: 5 } } },
      { file: 'data/lore/jobs.json', data: { entries: { swordman: 'ok' } } },
    ]);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain('data/lore/monsters.json');
    expect(r.problems[1]).toContain('data/lore/items.json');
    expect(r.lore.jobs.swordman).toBe('ok');
  });

  it('неизвестные id — ошибки; длинные тексты и монстр вне кампании — предупреждения', () => {
    const lore = emptyLore();
    lore.monsters = { no_such_unit: { title: 't', text: 'x' }, [firstMonster]: { title: 't', text: 'x'.repeat(800), quote: 'q'.repeat(200) } };
    lore.items = { no_such_item: 'x' };
    lore.heroes = { no_such_hero: { story: 's', quirks: [] } };
    lore.jobs = { no_such_job: 'x' };
    lore.chapters = { chapter99: { title: 't', location: 'l', text: 'x' } };
    lore.world = [
      { id: 'a', title: 't', text: 'x', unlockAfterStage: 'nope' },
      { id: 'a', title: 't', text: 'x' },
    ];
    const r = check(lore);
    expect(r.errors).toHaveLength(7);
    expect(r.warnings.filter((w) => w.includes(firstMonster))).toHaveLength(2);
    const offCampaign = Object.values(ctx.content.units).find((u) => u.kind !== 'hero' && !ctx.content.stages.some((s) => s.enemies.some((e) => e?.unit === u.id)));
    if (offCampaign) {
      const w = check({ ...emptyLore(), monsters: { [offCampaign.id]: { title: 't', text: 'x' } } });
      expect(w.errors).toEqual([]);
      expect(w.warnings[0]).toContain('не встречается на этапах');
    }
  });

  it('первая фраза', () => {
    expect(firstSentence('Прыгает по лугам. Кусается больно!')).toBe('Прыгает по лугам.');
    expect(firstSentence('Без точки')).toBe('Без точки');
  });
});

describe('Летопись: открытие записей по прогрессу', () => {
  const fresh = newGame(ctx, 0);
  const stage1 = ctx.content.stages[0];
  const cleared1 = { ...fresh, campaign: { cleared: [stage1.id] } };

  it('бестиарий: все монстры кампании по первому появлению, закрыты у нового игрока', () => {
    const list = bestiary(fresh, ctx.content);
    expect(list.length).toBeGreaterThan(20);
    expect(list[0].unitId).toBe(firstMonster);
    expect(list.every((m) => !m.open)).toBe(true);
    expect(list.every((m) => m.unit.kind !== 'hero' && m.stages.length > 0)).toBe(true);
    expect(new Set(list.map((m) => m.unitId)).size).toBe(list.length);
  });

  it('бестиарий: после победы на этапе открыты ровно его монстры; «где встречается» — метки этапов', () => {
    const list = bestiary(cleared1, ctx.content);
    const onStage = new Set(stage1.enemies.filter((e) => !!e).map((e) => e!.unit));
    for (const m of list) expect(m.open).toBe(onStage.has(m.unitId));
    expect(list[0].stages[0]).toBe('1-1');
    // Монстр, который встречается на нескольких этапах, открыт и после победы только на последнем из них.
    const multi = bestiary(fresh, ctx.content).find((m) => m.stages.length > 1)!;
    const lastStage = [...ctx.content.stages].reverse().find((s) => s.enemies.some((e) => e?.unit === multi.unitId))!;
    const later = bestiary({ ...fresh, campaign: { cleared: [lastStage.id] } }, ctx.content).find((m) => m.unitId === multi.unitId)!;
    expect(later.open).toBe(true);
  });

  it('предметы: открыты предметы глав до главы игрока и те, что есть в инвентаре', () => {
    const list = itemEntries(fresh, ctx);
    expect(list).toHaveLength(Object.keys(ctx.equipment.items).length);
    for (const e of list) expect(e.open).toBe(e.item.minChapter <= 1);
    const late = list.find((e) => e.item.minChapter > 1)!;
    const withItem = { ...fresh, inventory: { items: [{ id: 'x1', itemId: late.item.id, equippedBy: null }] } };
    const again = itemEntries(withItem, ctx).find((e) => e.item.id === late.item.id)!;
    expect(again).toMatchObject({ open: true, owned: true });
  });

  it('герои: все карточки, owned — полученные', () => {
    const list = heroEntries(fresh, ctx.content);
    expect(list).toHaveLength(Object.keys(ctx.content.heroes).length);
    const owned = new Set(fresh.heroes.map((h) => h.templateId));
    for (const h of list) expect(h.owned).toBe(owned.has(h.templateId));
  });

  it('мир: первая глава открыта, следующая — после последнего этапа предыдущей; записи — после unlockAfterStage', () => {
    const lore = emptyLore();
    lore.chapters = {
      chapter1: { title: 'a', location: 'l', text: 't' },
      chapter2: { title: 'b', location: 'l', text: 't' },
    };
    lore.world = [
      { id: 'always', title: 'x', text: 't' },
      { id: 'later', title: 'y', text: 't', unlockAfterStage: stage1.id },
    ];
    const open = (save: typeof fresh) => Object.fromEntries(worldEntries(save, ctx.content, lore).map((w) => [w.id, w.open]));
    expect(open(fresh)).toEqual({ chapter1: true, chapter2: false, always: true, later: false });
    expect(open(cleared1)).toMatchObject({ chapter2: false, later: true });
    const lastOf1 = ctx.content.chapters[0].stages.at(-1)!.id;
    expect(open({ ...fresh, campaign: { cleared: [lastOf1] } }).chapter2).toBe(true);
  });

  it('новые записи: только открытые с текстом; прочитанные не считаются', () => {
    const lore = emptyLore();
    lore.monsters = { [firstMonster]: { title: 't', text: 'x' } };
    lore.world = [{ id: 'w', title: 'x', text: 't' }];
    lore.items = { [anItem]: 'x' };
    lore.heroes = { [fresh.heroes[0].templateId]: { story: 's', quirks: [] } };
    const k0 = chronicleKeys(fresh, ctx, lore);
    expect(k0.bestiary).toEqual([]);
    expect(k0.world).toEqual(['world:w']);
    expect(k0.heroes).toEqual([`heroes:${fresh.heroes[0].templateId}`]);
    const k1 = chronicleKeys(cleared1, ctx, lore);
    expect(k1.bestiary).toEqual([`bestiary:${firstMonster}`]);
    const n = unseenCount(k1, new Set(['world:w']));
    expect(n.world).toBe(0);
    expect(n.bestiary).toBe(1);
    expect(n.total).toBe(n.bestiary + n.items + n.heroes);
  });
});
