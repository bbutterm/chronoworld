import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deserialize,
  HERO_STORY_BRANCH_FROM,
  heroPeakLevel,
  heroStoryBranches,
  heroStoryGateLabel,
  heroStoryBranchLevels,
  heroStoryCommonLevels,
  heroStoryLevels,
  heroStoryPieces,
  heroStoryUnread,
  heroStoryUnreadTotal,
  HERO_STORY_MAX,
  LORE_LIMITS,
  markHeroStoryRead,
  newGame,
  newlyOpenedStories,
  parseLore,
  serialize,
  validateLore,
  type HeroState,
  type Lore,
  type SaveState,
} from '../src/core';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const raw = readFileSync(join(ROOT, 'data/lore/hero_stories.json'), 'utf8');
const parsed = parseLore([{ file: 'data/lore/hero_stories.json', data: raw }]);
const lore = parsed.lore;

/** Все этапы кампании пройдены — сюжетные замки кусочков (unlockAfterStage) сняты. */
const ALL_CLEARED = ctx.content.stages.map((s) => s.id);

/**
 * Сохранение, где у героя alan несколько копий с заданными уровнями (и, если задано, ветками второй профессии). cleared —
 * пройденные этапы (по умолчанию вся кампания: проверяется условие по уровню).
 */
function withAlan(levels: number[], branches: (string | undefined)[] = [], cleared: string[] = ALL_CLEARED): SaveState {
  const base0 = newGame(ctx, 0);
  const save = { ...base0, campaign: { ...base0.campaign, cleared } };
  const base = save.heroes.find((h) => h.templateId === 'alan')!;
  const others = save.heroes.filter((h) => h.templateId !== 'alan');
  const copies: HeroState[] = levels.map((level, i) => ({
    ...base,
    id: i === 0 ? base.id : `${base.id}_c${i}`,
    level,
    ...(branches[i] ? { rarity: 'gold', branch: branches[i] } : {}),
  }));
  return { ...save, heroes: [...others, ...copies] };
}
const openKeys = (s: SaveState) => heroStoryPieces(s, 'alan', lore).filter((p) => p.open).map((p) => p.key);

describe('история героя кусочками: данные', () => {
  it('файл читается без ошибок; у каждого героя общие пороги 10–50 и по обеим веткам 60–100', () => {
    expect(parsed.problems).toEqual([]);
    const lint = validateLore(lore, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards });
    expect(lint.errors).toEqual([]);
    for (const t of Object.values(ctx.content.heroes)) {
      const cap = ctx.cards.rarities.find((r) => r.id === t.maxRarity)!.maxLevel;
      const list = lore.heroStories[t.id] ?? [];
      expect(list.filter((p) => !p.branch).map((p) => p.level), t.id).toEqual(heroStoryCommonLevels(cap));
      expect(t.branches.length, t.id).toBe(2);
      for (const b of t.branches) expect(list.filter((p) => p.branch === b.job).map((p) => p.level), `${t.id} ${b.job}`).toEqual(heroStoryBranchLevels(cap));
      // Ветка — только с 60, общих кусочков с 60 нет.
      for (const p of list) expect(!!p.branch, `${t.id} ${p.level}`).toBe(p.level >= HERO_STORY_BRANCH_FROM);
    }
    // Красный предел — 100: 5 общих + 2 × 5 по веткам = 15 кусочков у каждого из 12 героев.
    expect(heroStoryLevels(100)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(heroStoryCommonLevels(100)).toEqual([10, 20, 30, 40, 50]);
    expect(heroStoryBranchLevels(100)).toEqual([60, 70, 80, 90, 100]);
    expect(heroStoryLevels(250).at(-1)).toBe(HERO_STORY_MAX);
    expect(Object.values(lore.heroStories).flat()).toHaveLength(Object.keys(ctx.content.heroes).length * 15);
  });

  it('заголовок ≤ 60, текст ≤ 500, заголовки героя не повторяются, текст — по-русски', () => {
    for (const [id, list] of Object.entries(lore.heroStories)) {
      const titles = new Set<string>();
      for (const p of list) {
        expect(p.title.length, `${id} ${p.level}`).toBeLessThanOrEqual(LORE_LIMITS.storyTitle);
        expect(p.text.length, `${id} ${p.level}`).toBeLessThanOrEqual(LORE_LIMITS.storyText);
        expect(p.text, `${id} ${p.level}`).toMatch(/[а-яё]/i);
        expect(titles.has(p.title), `${id}: заголовок «${p.title}» повторяется`).toBe(false);
        titles.add(p.title);
      }
    }
  });

  it('без спойлеров раньше времени: уровень по кривой И этап кампании после соответствующей сцены (BUG-167)', () => {
    // Место этапа на маршруте: (номер главы, номер этапа внутри главы).
    const pos = (stageId: string) => {
      const st = ctx.content.stages.find((s) => s.id === stageId)!;
      const ch = ctx.content.chapters.find((c) => c.id === st.chapter)!;
      return ch.order * 1000 + st.index;
    };
    const end = (order: number) => {
      const ch = ctx.content.chapters.find((c) => c.order === order)!;
      return Math.max(...ctx.content.stages.filter((s) => s.chapter === ch.id).map((s) => pos(s.id)));
    };
    // Сцены кампании, после которых игрок знает то же, что кусочек.
    const REVEAL_ANSGAR = pos('ch7_s10'); // летопись Альдебарана: «оруженосец Ансгар» (финал главы 7)
    const REVEAL_BROTHER = pos('ch8_s16'); // Бенедикт — Верховный жрец (8-15), Серый — брат (8-15), Ансгар на галерее (8-16)
    for (const [id, list] of Object.entries(lore.heroStories)) {
      for (const p of list) {
        const at = `${id} ${p.branch ?? 'общий'} ${p.level}`;
        const gate = p.unlockAfterStage ? pos(p.unlockAfterStage) : 0;
        // Имя Ансгара — с летописи Альдебарана (конец гл. 7).
        if (/Ансгар/.test(p.text)) {
          expect(p.level, at).toBeGreaterThanOrEqual(80);
          expect(gate, `${at}: Ансгар — не раньше конца главы 7`).toBeGreaterThanOrEqual(REVEAL_ANSGAR);
        }
        // Бенедикт — Верховный жрец, Серый — брат Вики, сын Тиль — гл. 8.
        if (/Верховн|Тиль|брат[^.]*Серый|Серый[^.]*брат|он — Серый/.test(p.text)) {
          expect(p.level, at).toBeGreaterThanOrEqual(90);
          expect(gate, `${at}: раскрытие главы 8 — не раньше сцены 8-16`).toBeGreaterThan(REVEAL_BROTHER - 1);
        }
        // Финал: Владыка мёртвых, Бафомет, посвящение, события Нифльхейма (кроме прошлого Тео: его послали петь у Врат).
        if (/Владык|Бафомет|посвят|посвящ|Мира/.test(p.text) || (p.branch && /Нифльхейм/.test(p.text))) {
          expect(p.level, at).toBe(100);
          expect(gate, `${at}: финал — только после главы 10`).toBe(end(10));
        }
        // Гласт Хейм изнутри — не раньше гл. 8 (до неё — только имя из летописи Альдебарана); похороны отряда — финал гл. 8.
        if (/В Гласт Хейме|В соборе Гласт Хейма|хорон/.test(p.text) && p.level >= 60) {
          expect(p.level, at).toBeGreaterThanOrEqual(90);
          expect(gate, `${at}: Гласт Хейм изнутри — после главы 8`).toBeGreaterThanOrEqual(end(8));
        }
        // События Альдебарана (часовая башня, архив, метель) — не раньше, чем отряд там был.
        if (p.level >= 60 && /(В|в) (часовой башне|архиве) Альдебарана|Альдебаран забыл|под Альдебараном|В Альдебаране/.test(p.text))
          expect(gate, `${at}: Альдебаран — после главы 7`).toBeGreaterThanOrEqual(end(7));
        // Кусочки с 60 без замка не бывает: правило по уровню покрывает все ветки.
        if (p.level >= 60) expect(p.unlockAfterStage, at).toBeTruthy();
      }
    }
  });

  it('открытие по уровню не обгоняет кампанию: Вика ур. 100 в начале главы 7 не читает поворот главы 8 и финал', () => {
    const s0 = newGame(ctx, 0);
    const vika = s0.heroes.find((h) => h.templateId === 'vika') ?? { ...s0.heroes[0], templateId: 'vika' };
    const beforeCh7End = ctx.content.stages.filter((st) => {
      const ch = ctx.content.chapters.find((c) => c.id === st.chapter)!;
      return ch.order <= 6;
    });
    const at = (cleared: string[]): SaveState => ({
      ...s0,
      heroes: [...s0.heroes.filter((h) => h.templateId !== 'vika'), { ...vika, level: 100, rarity: 'red', branch: 'priest' }],
      campaign: { ...s0.campaign, cleared },
    });
    const early = heroStoryPieces(at(beforeCh7End.map((st) => st.id)), 'vika', lore);
    const p = (key: string) => early.find((x) => x.key === key)!;
    expect(p('priest:60').open).toBe(true);
    expect(p('priest:70').open).toBe(true);
    for (const k of ['priest:80', 'priest:90', 'priest:100']) {
      expect(p(k).open, k).toBe(false);
      expect(p(k).levelReached, k).toBe(true);
      expect(p(k).stageReached, k).toBe(false);
    }
    expect(heroStoryGateLabel(p('priest:90').unlockAfterStage!, ctx.content)).toBe('после главы 8');
    expect(heroStoryGateLabel(p('priest:100').unlockAfterStage!, ctx.content)).toBe('после главы 10');
    expect(heroStoryGateLabel('ch8_s16', ctx.content)).toBe('после этапа 8-16');
    // Глава 8 пройдена — открыт 90, финал ещё нет.
    const ch8 = ctx.content.stages.filter((st) => ctx.content.chapters.find((c) => c.id === st.chapter)!.order <= 8).map((st) => st.id);
    const mid = heroStoryPieces(at(ch8), 'vika', lore);
    expect(mid.find((x) => x.key === 'priest:90')!.open).toBe(true);
    expect(mid.find((x) => x.key === 'priest:100')!.open).toBe(false);
    // Этап пройден, уровня нет — закрыто; прочитанное раньше не закрывается.
    const low = { ...at(ALL_CLEARED), heroes: at(ALL_CLEARED).heroes.map((h) => (h.templateId === 'vika' ? { ...h, level: 85 } : h)) };
    expect(heroStoryPieces(low, 'vika', lore).find((x) => x.key === 'priest:90')!.open).toBe(false);
    const readEarly = { ...at([]), heroStoryRead: { 'vika:priest': [90] } };
    expect(heroStoryPieces(readEarly, 'vika', lore).find((x) => x.key === 'priest:90')!.open).toBe(true);
    // Прохождение этапа открывает кусочек (тост «Открыта история» после боя возможен через newlyOpenedStories).
    expect(newlyOpenedStories(at(beforeCh7End.map((st) => st.id)), at(ch8), 'vika', lore).map((x) => `${x.branch}:${x.level}`)).toEqual(['priest:80', 'priest:90']);
    // content:check ловит несуществующий этап.
    const bad: Lore = { ...lore, heroStories: { ...lore.heroStories, vika: lore.heroStories.vika.map((x) => (x.level === 90 ? { ...x, unlockAfterStage: 'ch99_s1' } : x)) } };
    expect(validateLore(bad, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards }).errors.join('\n')).toMatch(/unlockAfterStage = "ch99_s1" — нет такого этапа/);
  });

  it('гильдии первой профессии (ур. 40–50) — канон RO: у героев одного класса общий город гильдии', () => {
    const guild: Record<string, RegExp> = { swordman: /Излуд/, mage: /Гефен/, archer: /Пайон/, acolyte: /собор/, thief: /пирамид|Моррок/, merchant: /Альберт/ };
    for (const t of Object.values(ctx.content.heroes)) {
      const p40 = lore.heroStories[t.id].find((p) => p.level === 40 && !p.branch)!;
      const p50 = lore.heroStories[t.id].find((p) => p.level === 50 && !p.branch)!;
      expect(`${p40.text} ${p50.text}`, t.id).toMatch(guild[t.job]);
    }
  });

  it('content:check ловит пропущенный порог, лишний порог и длину сверх предела', () => {
    const broken: Lore = { ...lore, heroStories: { ...lore.heroStories, alan: lore.heroStories.alan.filter((p) => p.level !== 30).concat({ level: 105, title: 'x', text: 'y' }) } };
    const errs = validateLore(broken, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards }).errors.join('\n');
    expect(errs).toMatch(/alan — нет кусочков истории для уровней 30/);
    expect(errs).toMatch(/alan — лишние пороги 105/);
    // Ветка: пропущенный порог, чужая ветка, общий кусочек на 60.
    const branchBroken: Lore = {
      ...lore,
      heroStories: {
        ...lore.heroStories,
        alan: lore.heroStories.alan
          .filter((p) => !(p.branch === 'crusader' && p.level === 80))
          .concat({ level: 70, branch: 'wizard', title: 'x2', text: 'y' }, { level: 60, title: 'x3', text: 'y' }),
      },
    };
    const berrs = validateLore(branchBroken, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards }).errors.join('\n');
    expect(berrs).toMatch(/alan — нет кусочков истории ветки crusader для уровней 80/);
    expect(berrs).toMatch(/alan — ур\. 70: ветки .* \(wizard\) у героя нет/);
    expect(berrs).toMatch(/alan — лишние пороги 60/);
    const long = JSON.parse(raw);
    long.entries.alan[0].text = 'а'.repeat(501);
    expect(parseLore([{ file: 'data/lore/hero_stories.json', data: long }]).problems.join('\n')).toMatch(/не длиннее 500/);
    // Нет файла — проверки полноты нет (лор необязателен).
    expect(validateLore({ ...lore, heroStories: {} }, { content: ctx.content, items: ctx.equipment.items, cards: ctx.cards }).errors).toEqual([]);
  });
});

describe('история героя кусочками: открытие и прочтение', () => {
  it('кусочек открыт, когда самая высокая копия героя дошла до порога', () => {
    const s = withAlan([9, 25, 3]);
    expect(heroPeakLevel(s, 'alan')).toBe(25);
    const pieces = heroStoryPieces(s, 'alan', lore);
    expect(pieces.filter((p) => p.open).map((p) => p.level)).toEqual([10, 20]);
    expect(pieces.every((p) => !p.read)).toBe(true);
    expect(heroStoryUnread(s, 'alan', lore)).toBe(2);
    // Героя нет — закрыто всё.
    expect(heroStoryPieces({ ...s, heroes: s.heroes.filter((h) => h.templateId !== 'alan') }, 'alan', lore).some((p) => p.open)).toBe(false);
  });

  it('прочтение: помечает все открытые, повторно — тот же объект; счётчик «новое» обнуляется', () => {
    const s = withAlan([20]);
    const read = markHeroStoryRead(s, 'alan', lore);
    expect(read.heroStoryRead).toEqual({ alan: [10, 20] });
    expect(heroStoryUnread(read, 'alan', lore)).toBe(0);
    expect(markHeroStoryRead(read, 'alan', lore)).toBe(read);
    // Новый уровень — новый непрочитанный кусочек, прочитанные остаются.
    const up = { ...read, heroes: read.heroes.map((h) => (h.templateId === 'alan' ? { ...h, level: 34 } : h)) };
    expect(heroStoryUnread(up, 'alan', lore)).toBe(1);
    expect(markHeroStoryRead(up, 'alan', lore).heroStoryRead).toEqual({ alan: [10, 20, 30] });
  });

  it('прочитанный кусочек не закрывается, если копию отдали в корм', () => {
    const read = markHeroStoryRead(withAlan([40, 1]), 'alan', lore);
    const eaten = { ...read, heroes: read.heroes.filter((h) => !(h.templateId === 'alan' && h.level === 40)) };
    expect(heroStoryPieces(eaten, 'alan', lore).filter((p) => p.open).map((p) => p.level)).toEqual([10, 20, 30, 40]);
  });

  it('newlyOpenedStories — кусочки, открытые повышением уровня (для тоста)', () => {
    const before = withAlan([19]);
    const after = withAlan([20]);
    expect(newlyOpenedStories(before, after, 'alan', lore).map((p) => p.level)).toEqual([20]);
    expect(newlyOpenedStories(after, withAlan([21]), 'alan', lore)).toEqual([]);
  });

  it('общий счётчик — по полученным героям; поле сохранения переживает serialize/deserialize', () => {
    const s = withAlan([10]);
    const n = heroStoryUnreadTotal(s, lore);
    expect(n).toBeGreaterThanOrEqual(1);
    const read = markHeroStoryRead(s, 'alan', lore);
    expect(heroStoryUnreadTotal(read, lore)).toBe(n - 1);
    const back = deserialize(serialize(read));
    expect(back.heroStoryRead).toEqual({ alan: [10] });
    // Старое сохранение без поля — читается, ничего не прочитано.
    expect(deserialize(serialize(s)).heroStoryRead).toBeUndefined();
  });
});

describe('история героя: ветки второй профессии (с ур. 60)', () => {
  it('без ветки кусочки 60–100 закрыты даже на ур. 100; общие открыты', () => {
    const s = withAlan([100]);
    expect(openKeys(s)).toEqual(['10', '20', '30', '40', '50']);
    const pieces = heroStoryPieces(s, 'alan', lore);
    expect(pieces.filter((p) => p.branch).every((p) => p.path === 'other' && !p.open)).toBe(true);
  });

  it('копия на ветке открывает только кусочки своей ветки до своего уровня; своя ветка — первой в списке', () => {
    const s = withAlan([75], ['crusader']);
    expect(heroPeakLevel(s, 'alan', 'crusader')).toBe(75);
    expect(heroPeakLevel(s, 'alan', 'knight')).toBe(0);
    expect(heroStoryBranches(s, 'alan')).toEqual(['crusader']);
    expect(openKeys(s)).toEqual(['10', '20', '30', '40', '50', 'crusader:60', 'crusader:70']);
    const pieces = heroStoryPieces(s, 'alan', lore);
    expect(pieces.map((p) => p.branch ?? '').filter((b, i, a) => a.indexOf(b) === i)).toEqual(['', 'crusader', 'knight']);
    expect(pieces.find((p) => p.key === 'crusader:80')!.path).toBe('mine');
    expect(pieces.find((p) => p.key === 'knight:60')!.path).toBe('other');
  });

  it('смена ветки: прочитанное прежней ветки остаётся (дневник всех путей), новая ветка — непрочитанная', () => {
    const knight = withAlan([72], ['knight']);
    const read = markHeroStoryRead(knight, 'alan', lore);
    expect(read.heroStoryRead).toEqual({ alan: [10, 20, 30, 40, 50], 'alan:knight': [60, 70] });
    const switched = { ...read, heroes: read.heroes.map((h) => (h.templateId === 'alan' ? { ...h, branch: 'crusader' } : h)) };
    expect(openKeys(switched)).toEqual(['10', '20', '30', '40', '50', 'crusader:60', 'crusader:70', 'knight:60', 'knight:70']);
    const pieces = heroStoryPieces(switched, 'alan', lore);
    expect(pieces.filter((p) => p.path === 'other' && p.open).every((p) => p.read)).toBe(true);
    expect(heroStoryUnread(switched, 'alan', lore)).toBe(2);
    expect(newlyOpenedStories(read, switched, 'alan', lore).map((p) => `${p.branch}:${p.level}`)).toEqual(['crusader:60', 'crusader:70']);
    const both = markHeroStoryRead(switched, 'alan', lore);
    expect(both.heroStoryRead?.['alan:crusader']).toEqual([60, 70]);
    expect(heroStoryUnread(both, 'alan', lore)).toBe(0);
    // Сохранение с ключами веток переживает serialize/deserialize.
    expect(deserialize(serialize(both)).heroStoryRead).toEqual(both.heroStoryRead);
  });

  it('две копии на разных ветках — каждая открывает свою ветку; повышение уровня открывает кусочек ветки (тост)', () => {
    const s = withAlan([69, 81], ['knight', 'crusader']);
    expect(heroStoryBranches(s, 'alan')).toEqual(['crusader', 'knight']);
    expect(openKeys(s)).toEqual(['10', '20', '30', '40', '50', 'crusader:60', 'crusader:70', 'crusader:80', 'knight:60']);
    const up = withAlan([70, 81], ['knight', 'crusader']);
    expect(newlyOpenedStories(s, up, 'alan', lore).map((p) => [p.branch, p.level])).toEqual([['knight', 70]]);
  });

  it('старые прочитанные уровни 60–100 без ветки (сохранения до веток) ничего не открывают', () => {
    const s = { ...withAlan([55]), heroStoryRead: { alan: [10, 20, 30, 40, 50, 60, 70] } };
    expect(openKeys(s)).toEqual(['10', '20', '30', '40', '50']);
    expect(heroStoryUnread(s, 'alan', lore)).toBe(0);
  });
});
