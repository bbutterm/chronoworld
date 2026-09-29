import { describe, expect, it } from 'vitest';
import {
  bestiary,
  ChapterSchema,
  chroniclePageId,
  collectFinding,
  deserialize,
  episodePageId,
  findingEntries,
  HeroTemplateSchema,
  markPageSeen,
  newGame,
  parseLore,
  pendingChronicle,
  pendingFinding,
  pendingIntro,
  serialize,
  towerFloor,
  towerFloorUnits,
  UnitSchema,
  validatePageTexts,
  type Content,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const fresh = newGame(ctx, 0);
const ch1 = ctx.content.chapters[0];
const ch1Stages = ctx.content.stages.filter((s) => s.chapter === ch1.id);
const last1 = ch1Stages.at(-1)!;

describe('тексты между этапами: эпизод, легенда, летопись', () => {
  it('глава 1 в data: эпизод, легенда, летопись и 3–4 находки', () => {
    expect(ch1.episode?.text.length).toBeGreaterThan(100);
    expect(ch1.legend?.text.length).toBeGreaterThan(50);
    expect(ch1.chronicle?.text.length).toBeGreaterThan(100);
    const n = ch1Stages.filter((s) => s.finding).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(4);
  });

  it('эпизод — при первом входе в главу, один раз', () => {
    const p = pendingIntro(fresh, ch1.id, ctx);
    expect(p).toMatchObject({ chapterId: ch1.id, number: 1 });
    expect(p?.episode?.title).toBe(ch1.episode!.title);
    expect(p?.legend).toEqual(ch1.legend);
    const seen = markPageSeen(fresh, episodePageId(ch1.id));
    expect(pendingIntro(seen, ch1.id, ctx)).toBeUndefined();
    expect(markPageSeen(seen, episodePageId(ch1.id))).toBe(seen);
    // Первый этап уже пройден (старое сохранение) — не показываем, текст ждёт в «Летописи».
    expect(pendingIntro({ ...fresh, campaign: { cleared: [ch1Stages[0].id] } }, ch1.id, ctx)).toBeUndefined();
    // Глава без текстов — нечего показывать.
    const bare = ctx.content.chapters.find((c) => !c.episode && !c.legend);
    if (bare) expect(pendingIntro(fresh, bare.id, ctx)).toBeUndefined();
  });

  it('летопись главы — после её последнего этапа, один раз', () => {
    expect(pendingChronicle(fresh, ch1.id, ctx.content)).toBeUndefined();
    const done = { ...fresh, campaign: { cleared: ch1Stages.map((s) => s.id) } };
    expect(pendingChronicle(done, ch1.id, ctx.content)).toEqual(ch1.chronicle);
    expect(pendingChronicle(markPageSeen(done, chroniclePageId(ch1.id)), ch1.id, ctx.content)).toBeUndefined();
    expect(last1.boss).toBe(true);
  });

  it('схема: пределы длины — ошибка', () => {
    const base = { id: 'c', name: 'Глава', order: 1, stages: [ch1.stages[0]] };
    expect(ChapterSchema.safeParse({ ...base, episode: { title: 'Э', text: 'x'.repeat(901) } }).success).toBe(false);
    expect(ChapterSchema.safeParse({ ...base, episode: { title: 'Э', text: 'x'.repeat(900) } }).success).toBe(true);
    expect(ChapterSchema.safeParse({ ...base, legend: { title: 'Л', text: 'x'.repeat(401) } }).success).toBe(false);
    expect(ChapterSchema.safeParse({ ...base, chronicle: { title: 'Л', text: 'x'.repeat(801) } }).success).toBe(false);
    const stage = { ...ch1.stages[0], finding: { id: 'f', title: 'Н', text: 'x'.repeat(301) } };
    expect(ChapterSchema.safeParse({ ...base, stages: [stage] }).success).toBe(false);
    const ok = ChapterSchema.parse({ ...base, stages: [{ ...stage, finding: { id: 'f', title: 'Н', text: 'т' } }] });
    expect(ok.stages[0].finding?.kind).toBe('note');
  });
});

describe('находки', () => {
  const withFinding = ch1Stages.find((s) => s.finding)!;
  const f = withFinding.finding!;

  it('показать после первой победы, если ещё нет в сохранении', () => {
    expect(pendingFinding(fresh, withFinding.id, false, ctx.content)).toBeUndefined();
    expect(pendingFinding(fresh, withFinding.id, true, ctx.content)).toEqual(f);
    const got = collectFinding(fresh, f.id);
    expect(got.findings).toEqual([f.id]);
    expect(collectFinding(got, f.id)).toBe(got);
    expect(pendingFinding(got, withFinding.id, true, ctx.content)).toBeUndefined();
    const plain = ch1Stages.find((s) => !s.finding)!;
    expect(pendingFinding(fresh, plain.id, true, ctx.content)).toBeUndefined();
  });

  it('«Летопись»: найдена — в сохранении или этап пройден', () => {
    const list = findingEntries(fresh, ctx.content);
    expect(list.every((e) => !e.found)).toBe(true);
    expect(list[0]).toMatchObject({ chapterId: ch1.id, chapterNumber: 1 });
    expect(findingEntries(collectFinding(fresh, f.id), ctx.content).find((e) => e.finding.id === f.id)?.found).toBe(true);
    const cleared = { ...fresh, campaign: { cleared: [withFinding.id] } };
    expect(findingEntries(cleared, ctx.content).filter((e) => e.found).map((e) => e.finding.id)).toEqual([f.id]);
  });

  it('сохранение: findings и seenPages переживают запись/чтение', () => {
    const s = markPageSeen(collectFinding(fresh, f.id), episodePageId(ch1.id));
    const back = deserialize(serialize(s));
    expect(back.findings).toEqual([f.id]);
    expect(back.seenPages).toEqual([episodePageId(ch1.id)]);
    expect(serialize(back)).toBe(serialize(s));
    expect(deserialize(serialize(fresh)).findings).toBeUndefined();
  });

  it('проверка: повтор id находки — ошибка, больше 4 в главе и barks не у босса — предупреждения', () => {
    expect(validatePageTexts(ctx.content)).toEqual({ errors: [], warnings: [] });
    const stages = ch1.stages.map((s, i) => (i < 5 ? { ...s, finding: { id: i === 1 ? 'dup' : i === 0 ? 'dup' : `f${i}`, title: 'Н', text: 'т', kind: 'note' as const } } : s));
    const monster = Object.values(ctx.content.units).find((u) => u.kind === 'monster')!;
    const content = {
      chapters: [{ ...ch1, stages }],
      units: { [monster.id]: { ...monster, barks: { start: 'Пи!' } } },
    } as unknown as Pick<Content, 'chapters' | 'units'>;
    const r = validatePageTexts(content);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('dup');
    expect(r.warnings.some((w) => w.includes('находок ') && w.includes('больше 4'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('barks'))).toBe(true);
  });
});

describe('реплики и строки', () => {
  it('Мастеринг: реплики боссов в пределах схемы', () => {
    const m = ctx.content.units.mob_mastering;
    expect(m.kind).toBe('boss');
    expect(m.barks?.start).toBeTruthy();
    expect(m.barks?.half).toBeTruthy();
    expect(m.barks?.defeat).toBeTruthy();
    expect(UnitSchema.safeParse({ ...m, barks: { start: 'x'.repeat(101) } }).success).toBe(false);
  });

  it('герой: tavernLine и ascendLines — необязательны, с пределом длины и только редкости выше зелёной', () => {
    const t = Object.values(ctx.content.heroes)[0];
    expect(HeroTemplateSchema.safeParse({ ...t, tavernLine: 'Садится в углу.', ascendLines: { purple: 'Строка.' } }).success).toBe(true);
    expect(HeroTemplateSchema.safeParse({ ...t, tavernLine: 'x'.repeat(121) }).success).toBe(false);
    expect(HeroTemplateSchema.safeParse({ ...t, ascendLines: { green: 'нет' } }).success).toBe(false);
  });

  it('lines.json: читается; неизвестный вид — ошибка файла', () => {
    const ok = parseLore([{ file: 'data/lore/lines.json', data: { defeat: ['Живы — значит, вернёмся.'] } }]);
    expect(ok.problems).toEqual([]);
    expect(ok.lore.lines.defeat).toEqual(['Живы — значит, вернёмся.']);
    expect(ok.lore.lines.loading).toEqual([]);
    const bad = parseLore([{ file: 'data/lore/lines.json', data: { victory: ['x'] } }]);
    expect(bad.problems).toHaveLength(1);
  });
});

describe('бестиарий: Башня и Охота', () => {
  it('towerFloorUnits совпадает с составом towerFloor', () => {
    for (let n = 1; n <= ctx.tower.maxFloor; n++) {
      const names = towerFloor(n, ctx).enemies.flatMap((e) => (e ? [e.name] : []));
      expect(towerFloorUnits(n, ctx.tower).map((u) => ctx.content.units[u].name)).toEqual(names);
    }
  });

  it('монстры Башни открываются по взятому этажу, боссы Охоты — после боя', () => {
    const campaignOnly = new Set(bestiary(fresh, ctx.content).map((m) => m.unitId));
    const all = bestiary(fresh, ctx.content, ctx);
    const extra = all.filter((m) => !campaignOnly.has(m.unitId));
    expect(extra.length).toBeGreaterThan(0);
    expect(all.every((m) => !m.open)).toBe(true);
    const towerOnly = extra.find((m) => m.stages[0].startsWith('Башня'));
    if (towerOnly) {
      const floor = Number(/этаж (\d+)/.exec(towerOnly.stages[0])![1]);
      const climbed = bestiary({ ...fresh, tower: { floor } }, ctx.content, ctx).find((m) => m.unitId === towerOnly.unitId)!;
      expect(climbed.open).toBe(true);
      const below = bestiary({ ...fresh, tower: { floor: floor - 1 } }, ctx.content, ctx).find((m) => m.unitId === towerOnly.unitId)!;
      expect(below.open).toBe(false);
    }
    const huntBoss = ctx.hunt.bosses.map((b) => b.unit).find((u) => !campaignOnly.has(u))!;
    const hunted = bestiary({ ...fresh, hunt: { day: '2026-01-01', used: 1, best: { [huntBoss]: 100 } } }, ctx.content, ctx).find((m) => m.unitId === huntBoss)!;
    expect(hunted.open).toBe(true);
    expect(hunted.stages).toContain('Охота');
  });
});
