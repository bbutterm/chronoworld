/**
 * Миграция сохранения v3 → v4 (docs/design/heroes.md, раздел 6; src/core/heroes/migrate.ts): герои-профессии →
 * сюжетные карточки того же уровня (по имени, в том числе старые Бэлла/Вик/Грег), опыт — в пул, «чужой» класс —
 * свой класс карточки + сообщение, лишние герои — призывная карточка линии, свиток в компенсацию, подарок Таверны.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserialize, heroCard, loadOrNew, MemoryStorage, MIGRATIONS, persist, SAVE_VERSION, serialize } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { saveProblems } from './invariants';

const ctx = loadFullContext();
const fixtureV3 = readFileSync(join(import.meta.dirname, 'fixtures/save-v3.json'), 'utf8');
const fixtureV0 = readFileSync(join(import.meta.dirname, 'fixtures/save-v0.json'), 'utf8');
const levelExp = (l: number) => Math.floor(100 * Math.pow(l, 1.5));

describe('миграция v3 → v4: герои становятся карточками', () => {
  const raw = JSON.parse(fixtureV3);
  const s = deserialize(fixtureV3);

  it('версия, ссылки и неизменные поля', () => {
    // Следом идут v5 (события и почта, tests/events.test.ts), v6 (экспедиции вместо поручений,
    // tests/meta-expeditions.test.ts) и v7 (герои v2, tests/heroes-migrate-v7.test.ts).
    expect(SAVE_VERSION).toBe(7);
    expect(MIGRATIONS[3](raw).version).toBe(4);
    expect(s.version).toBe(SAVE_VERSION);
    // v6: поручение в работе (Отто на патруле) — герой свободен, награда поручения — письмом в почте.
    expect(s.mail.seq).toBe(1);
    expect(s.mail.letters).toHaveLength(1);
    expect(s.mail.letters[0]).toMatchObject({ id: 'm1', title: 'Поручения стали экспедициями', rewards: { gold: 100, jobExp: 20 }, claimed: false, day: '2026-09-27' });
    // id героев не меняются — отряд, пресеты и надетые предметы остаются.
    expect(s.heroes.map((h) => h.id)).toEqual(raw.heroes.map((h: { id: string }) => h.id));
    expect(s.squad).toEqual(raw.squad);
    expect(s.presets).toEqual(raw.presets);
    expect(raw.bounties.active).toHaveLength(1);
    expect(s.bounties).toEqual({ active: [] });
    expect(s.inventory).toEqual(raw.inventory);
    expect(s.campaign).toEqual(raw.campaign);
    expect(s.tower).toEqual(raw.tower);
    expect(s.revision).toBe(17);
    expect(s.seenScenes).toEqual(['ch1_intro']);
    // В формате v4 поля героев — только карточка; v7 добавляет ветку сюжетному фиолетовому (Дорн — Разбойник).
    for (const h of s.heroes) expect(Object.keys(h).sort()).toEqual(h.id === 'h5' ? ['branch', 'id', 'level', 'rarity', 'templateId'] : ['id', 'level', 'rarity', 'templateId']);
  });

  it('по имени (в том числе старые Бэлла, Вик, Грег), тот же уровень, редкость по пределу', () => {
    expect(s.heroes.map((h) => [h.id, h.templateId, h.rarity, h.level])).toEqual([
      ['h1', 'alan', 'green', 12], // Мечник 12
      ['h2', 'bran', 'blue', 25], // Бэлла → Бран, Лучник 25 → синий
      ['h3', 'vika', 'blue', 40], // Вик → Вика, Маг 50 → синий, предел 40 (излишек — в пул)
      ['h4', 'greta', 'green', 3], // Грег → Грета, Новичок 3
      ['h5', 'dorn', 'purple', 48], // Разбойник 8 (вторая профессия) → фиолетовый, 40 + 8
      ['h6', 'kai', 'purple', 43], // шестой герой (Волшебник 3) → призывная карточка своей линии
    ]);
    expect(heroCard(s.heroes[4], ctx).job).toBe('rogue');
    // Кай (первая призывная) на фиолетовом — без ветки: «Выберите ветку!» (герои v2).
    expect(heroCard(s.heroes[5], ctx).needsBranch).toBe(true);
  });

  it('опыт героев и излишек уровней — в общий пул; компенсация — свиток; Таверна открыта — подарок', () => {
    let surplus = 0;
    for (let l = 40; l < 50; l++) surplus += levelExp(l);
    expect(s.resources).toEqual({ gold: 1200, heroExp: 50 + surplus + 300 + 7 });
    expect(s.currency).toEqual({ gems: 80 + 150, scrolls: 1 + 1 });
    expect(s.summon).toEqual({ seq: 0, total: 0, sincePurple: 0, sinceBlue: 0, firstTenDone: false, welcomeGiven: true, discovered: ['alan', 'bran', 'vika', 'greta', 'dorn', 'kai'] });
    // v7: осколков больше нет (у фикстуры их и не было — ни копий, ни сообщения).
    expect(s).not.toHaveProperty('shards');
    expect(s.achievements.counters).toEqual({ stages_cleared: 6, tower_floor: 6, jobs_changed: 6, hero_max_level: 50 });
    expect(s.achievements.claimed).toEqual(['first_stage', 'first_job']);
  });

  it('сообщение игроку: карточки + «чужой» класс (Вика была Магом) + экспедиции (v6); после загрузки — предупреждения, поле убрано', () => {
    expect(s.notices).toHaveLength(3);
    expect(s.notices![0]).toMatch(/герои стали карточками/);
    expect(s.notices![0]).toMatch(/свиток призыва/);
    expect(s.notices![1]).toBe('Классы сюжетных героев теперь постоянные: Вика теперь Аколит.');
    // v6: поручения → экспедиции (tests/meta-expeditions.test.ts).
    expect(s.notices![2]).toMatch(/экспедициями/);
    const storage = new MemoryStorage();
    storage.save(fixtureV3);
    const r = loadOrNew(storage, ctx, 1_758_970_000_000);
    expect(r.source).toBe('loaded');
    expect(r.warnings).toEqual(s.notices);
    expect(r.save.notices).toBeUndefined();
    // Сохранение целое и работоспособное.
    expect(saveProblems(r.save, ctx)).toEqual([]);
    persist(storage, r.save);
    expect(loadOrNew(storage, ctx, 0).warnings).toBeUndefined();
  });

  it('serialize/deserialize после миграции — то же самое; исходный объект миграция не меняет', () => {
    expect(deserialize(serialize(s))).toEqual(s);
    const copy = structuredClone(raw);
    MIGRATIONS[3](raw);
    expect(raw).toEqual(copy);
  });

  it('новичок и первая профессия без «чужого» класса — одно сообщение; v0 через цепочку миграций', () => {
    const v0 = deserialize(fixtureV0);
    expect(v0.heroes.map((h) => h.templateId)).toEqual(['alan', 'bran', 'vika', 'greta', 'dorn']);
    expect(v0.notices).toHaveLength(1);
    expect(v0.currency.scrolls).toBe(1);
    expect(v0.summon.welcomeGiven).toBe(false);
  });

  it('незнакомые имена — свободные сюжетные карточки по порядку; дубли имени — следующая свободная; битые поля не роняют', () => {
    const out = MIGRATIONS[3]({
      version: 3,
      heroes: [
        { id: 'a', name: 'Ларс', job: 'thief', jobLevel: 5 },
        { id: 'b', name: 'Алан', job: 'swordman', jobLevel: 2 },
        { id: 'c', name: 'Алан', job: 'priest', jobLevel: 1, jobHistory: [{ job: 'novice', jobLevel: 10 }, { job: 'acolyte', jobLevel: 50 }] },
        { id: 'd', name: 'Мира', job: 'unknown_job', jobLevel: 'x' },
      ],
      squad: ['a', 'b', 'c', 'd', null],
    });
    expect(out.heroes.map((h: { templateId: string; rarity: string; level: number }) => [h.templateId, h.rarity, h.level])).toEqual([
      ['bran', 'green', 5], // первая свободная после Алана по имени
      ['alan', 'green', 2],
      ['vika', 'purple', 41], // второй «Алан» (Жрец) — следующая свободная; вторая профессия → фиолетовый
      ['greta', 'green', 1],
    ]);
    expect(out.resources).toEqual({ gold: 0, heroExp: 0 });
    // «Чужие» классы в сообщении: Бран был Вором, Вика — Жрецом (линия аколита совпадает — не сообщаем).
    expect(out.notices[1]).toBe('Классы сюжетных героев теперь постоянные: Бран теперь Лучник.');
    expect(() => MIGRATIONS[3]({ version: 3 })).not.toThrow();
  });

  it('лишние герои одной линии — вторая копия карточки убирается из отряда', () => {
    const six = ['Алан', 'Бран', 'Вика', 'Грета', 'Дорн', 'Ларс', 'Эрик'].map((name, i) => ({ id: `h${i + 1}`, name, job: 'mage', jobLevel: 2 }));
    const out = MIGRATIONS[3]({ version: 3, heroes: six, squad: ['h6', 'h7', 'h1', null, null] });
    expect(out.heroes.slice(5).map((h: { templateId: string }) => h.templateId)).toEqual(['kai', 'kai']);
    expect(out.squad).toEqual(['h6', null, 'h1', null, null]);
  });
});
