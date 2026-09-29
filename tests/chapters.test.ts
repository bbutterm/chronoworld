import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chapterTheme, enemySquad, growthStep, newGame, playStage, stageLabel, stageStatus, type SaveState } from '../src/core';
import { loadGameContext, ROOT } from '../scripts/lib/content-node';
import { loadFullContext, SMOOTH_SQUADS, smoothSquads, stageThreshold } from '../scripts/lib/player-model';

const ctx = loadGameContext();
const stages = ctx.content.stages;
const clearedUpTo = (n: number): SaveState => ({ ...newGame(ctx, 0), campaign: { cleared: stages.slice(0, n).map((s) => s.id) } });

/** Главы по order и их этапы — структурные проверки идут по всем главам: новой главе хватает корректного файла data/campaign. */
const chapters = ctx.content.chapters;
const chapterStages = (id: string) => stages.filter((s) => s.chapter === id);
/** Главы, выпущенные в прод: их состав и id этапов лежат в сохранениях игроков — проверяются точно. */
const RELEASED = ['chapter1', 'chapter2', 'chapter3'];

describe('K3 главы 2–3', () => {
  it('главы идут по order без повторов; выпущенные главы 1–3 — на своих местах', () => {
    const orders = chapters.map((c) => c.order);
    orders.forEach((o, i) => i > 0 && expect(o, chapters[i].id).toBeGreaterThan(orders[i - 1]));
    expect(chapters.slice(0, RELEASED.length).map((c) => [c.id, c.order])).toEqual([
      ['chapter1', 1],
      ['chapter2', 2],
      ['chapter3', 3],
    ]);
  });

  it('этапы склеены в одну цепочку: главы по порядку, globalIndex и index без дыр, в каждой главе один босс — последний этап', () => {
    // Этапы идут главами подряд в порядке глав.
    expect([...new Set(stages.map((s) => s.chapter))]).toEqual(chapters.map((c) => c.id));
    stages.forEach((s, i) => expect(s.globalIndex).toBe(i));
    expect(new Set(stages.map((s) => s.id)).size).toBe(stages.length);
    const prefixes = new Set<string>();
    for (const c of chapters) {
      const ch = chapterStages(c.id);
      expect(ch.length, c.id).toBeGreaterThan(0);
      // id этапов главы — <префикс>_s<N> с общим префиксом (ch4_s1…; вставленный перед боссом этап — ch4_s11), префикс у главы свой.
      const prefix = /^(.+)_s\d+$/.exec(ch[0].id)?.[1];
      expect(prefix, `${c.id}: id этапов вида <префикс>_s<N>`).toBeDefined();
      expect(prefixes.has(prefix!), `${c.id}: префикс ${prefix} уже занят`).toBe(false);
      prefixes.add(prefix!);
      ch.forEach((s, i) => {
        expect(s.index).toBe(i);
        expect(s.id, s.id).toMatch(new RegExp(`^${prefix}_s\\d+$`));
        expect(s.boss, s.id).toBe(i === ch.length - 1);
      });
    }
  });

  it('выпущенные главы 1–3: id этапов ch<N>_s1…s10 на месте (id в сохранениях игроков); главы растянуты до 18 этапов', () => {
    // Глава 1 (28.09, «растянуть главу 1», docs/design/chapter1.md), главы 2–3 (29.09, «растянуть главы до 18 этапов»):
    // выпущенные ch<N>_s1…s10 не переименованы и идут в прежнем порядке, босс ch<N>_s10 — последний; вставные ch<N>_s11…s18 —
    // между ними (помечены inserted: не двигают рост силы врагов, поэтому следующие главы не усилились).
    for (const [n, c] of RELEASED.entries()) {
      const ids = chapterStages(c).map((s) => s.id);
      const released = Array.from({ length: 10 }, (_, i) => `ch${n + 1}_s${i + 1}`);
      expect(ids.filter((id) => released.includes(id)), c).toEqual(released);
      expect(ids.filter((id) => !released.includes(id)).sort(), c).toEqual(Array.from({ length: 8 }, (_, i) => `ch${n + 1}_s${i + 11}`).sort());
      expect(ids, c).toHaveLength(18);
      expect(ids.at(-1), c).toBe(`ch${n + 1}_s10`);
      for (const s of chapterStages(c)) expect(!!s.inserted, s.id).toBe(!released.includes(s.id));
    }
    // Ступень роста врагов выпущенных этапов — прежняя (как globalIndex до вставки): ch<N>_s<k> → (N−1)·10 + k − 1.
    for (const [n, c] of RELEASED.entries())
      for (const s of chapterStages(c).filter((x) => !x.inserted)) expect(growthStep(s, ctx), s.id).toBe(n * 10 + Number(s.id.split('_s')[1]) - 1);
    // Вставной этап растёт как предыдущий обычный: ch1_s11 (после ch1_s2) — ступень 1.
    expect(growthStep(stages.find((s) => s.id === 'ch1_s11')!, ctx)).toBe(1);
    // ch2_s11 (после ch2_s1) — ступень 10, ch3_s18 (после ch3_s8) — ступень 27.
    expect(growthStep(stages.find((s) => s.id === 'ch2_s11')!, ctx)).toBe(10);
    expect(growthStep(stages.find((s) => s.id === 'ch3_s18')!, ctx)).toBe(27);
  });

  it('боссы глав 2–3 — мини-боссы: Древняя ива (mob2_boss, лист ивы) и Верховный жрец (mob3_boss, лист Тёмного жреца)', () => {
    const boss = (id: string) => stages.find((s) => s.id === id)!.enemies.filter((e) => e && ctx.content.units[e.unit].kind === 'boss').map((e) => e!.unit);
    expect(boss('ch2_s10')).toEqual(['mob2_boss']);
    expect(boss('ch3_s10')).toEqual(['mob3_boss']);
    expect(ctx.content.units.mob2_boss.visual.sprite).toBe('tank');
    expect(ctx.content.units.mob3_boss.visual.sprite).toBe('dark_priest');
  });

  it('в главах 1–3 нет MVP RO: листов Золотого жука, Героя орков, Бафомета, Тёмного лорда и других MVP', () => {
    const mvp = ['elite', 'boss1', 'boss2', 'dark_lord', 'osiris', 'drake', 'moonlight_flower', 'mistress'];
    for (const s of stages.filter((x) => RELEASED.includes(x.chapter)))
      for (const e of s.enemies) if (e) expect(mvp, `${s.id}: ${e.unit}`).not.toContain(ctx.content.units[e.unit].visual.sprite);
  });

  it('новые монстры глав 2–3 используют спрайты v2 и свои навыки', () => {
    // Любой лист реестра v2 (глава 3 — листы RO Рейдрика, Мимика, Гаргульи, Тёмного жреца).
    const v2 = (JSON.parse(readFileSync(join(ROOT, 'assets/sprites/sprites.json'), 'utf8')) as { sprites: { id: string }[] }).sprites.map((s) => s.id);
    for (const u of Object.values(ctx.content.units).filter((x) => /^mob[23]_/.test(x.id) && x.kind === 'monster')) {
      expect(v2).toContain(u.visual.sprite);
      expect(ctx.content.skills[u.skills.basic]).toBeDefined();
      if (u.skills.ult) expect(ctx.content.skills[u.skills.ult]).toBeDefined();
    }
  });

  it('сила врагов внутри глав 2–3 растёт без провалов: Σhp и Σatk этапа не меньше предыдущего (QA T5-21)', () => {
    // Глава 1 подобрана по доле побед: у босса (Мастеринг) Σatk ниже 9-го этапа — осознанно. Главы 4+ — по силе в бою
    // (следующий тест): Σ не видит лечения и щитов, и главы 4–7 с Σ по правилу давали обрывы «0 из 10 / 10 из 10» (QA LT-02).
    const later = chapters.slice(1, 3).map((c) => c.id);
    expect(later).toEqual(['chapter2', 'chapter3']);
    for (const ch of later) {
      const sums = stages
        .filter((s) => s.chapter === ch)
        .map((s) => {
          const en = enemySquad(s.id, ctx).filter((u) => u !== null);
          return { id: s.id, hp: en.reduce((a, u) => a + u!.stats.hp, 0), atk: en.reduce((a, u) => a + u!.stats.atk, 0) };
        });
      for (let i = 1; i < sums.length; i++) {
        expect(sums[i].hp, `${sums[i].id} Σhp`).toBeGreaterThanOrEqual(sums[i - 1].hp);
        expect(sums[i].atk, `${sums[i].id} Σatk`).toBeGreaterThanOrEqual(sums[i - 1].atk);
      }
    }
  });

  it('главы 4+ (QA LT-02, T5-21): сила этапа по бою растёт плавно — ни стен, ни провалов относительно тренда главы', () => {
    // Сила этапа для отряда — 1 / k*, k* — множитель статов врагов, при котором отряд побеждает через раз (scripts/balance-smooth.ts,
    // docs/content/balance.md, 6а). Пять эталонных отрядов (фиолетовые ур. 45, SMOOTH_SQUADS); профиль каждого нормирован на
    // его среднее, сила этапа — наибольшая из пяти. В главе — геометрический тренд по рядовым этапам (растёт); каждый рядовой
    // этап — в пределах ±15% тренда (до правки LT-02: −35% и +91% между соседями: 42 → 43, 60 → 61); босс — ступенька ×1…1.35.
    const full = loadFullContext();
    const squads = smoothSquads(full, 45, SMOOTH_SQUADS);
    const late = chapters.slice(3).map((c) => c.id);
    const ids = stages.filter((st) => late.includes(st.chapter)).map((st) => st.id);
    const profiles = squads.map((sq) => ids.map((id) => Math.log(1 / stageThreshold(full, sq, enemySquad(id, full), 6, 8))));
    const geo = profiles.map((p) => p.reduce((a, b) => a + b, 0) / p.length);
    const d = new Map(ids.map((id, i) => [id, Math.max(...profiles.map((p, j) => p[i] - geo[j]))]));
    for (const ch of late) {
      const list = chapterStages(ch);
      const reg = list.filter((x) => !x.boss).map((x) => d.get(x.id)!);
      const n = reg.length;
      const xm = (n - 1) / 2;
      const ym = reg.reduce((a, b) => a + b, 0) / n;
      const slope = reg.reduce((a, y, i) => a + (i - xm) * (y - ym), 0) / reg.reduce((a, _, i) => a + (i - xm) ** 2, 0);
      const trend = (i: number) => ym + slope * (i - xm);
      expect(Math.exp(slope), `${ch}: рост силы за этап`).toBeGreaterThan(1);
      list.forEach((x, i) => {
        const r = Math.exp(d.get(x.id)! - trend(Math.min(i, n - 1)));
        if (x.boss) {
          expect(r, `${x.id}: босс / тренд`).toBeGreaterThanOrEqual(1);
          expect(r, `${x.id}: босс / тренд`).toBeLessThanOrEqual(1.35);
        } else {
          expect(r, `${x.id}: этап / тренд`).toBeLessThanOrEqual(1.15);
          expect(r, `${x.id}: этап / тренд`).toBeGreaterThanOrEqual(0.85);
        }
      });
    }
  }, 600_000);

  it('монстры глав 2–3 на общих листах перекрашены: не совпадают с главой 1 и друг с другом (QA T5-04, частично)', () => {
    const look = (id: string) => `${ctx.content.units[id].visual.sprite}|${ctx.content.units[id].visual.tint ?? ''}`;
    const ch1 = new Set(stages.filter((s) => s.chapter === 'chapter1').flatMap((s) => s.enemies.filter((e) => e).map((e) => look(e!.unit))));
    const later = Object.values(ctx.content.units).filter((u) => /^mob[23]_/.test(u.id) && u.kind === 'monster');
    for (const u of later) expect(ch1.has(look(u.id)), u.id).toBe(false);
    expect(new Set(later.map((u) => look(u.id))).size).toBe(later.length);
  });

  it('монстры главы 2 не на листах монстров главы 1 (кроме ивы и кузнечика) и не на своих листах главы 3', () => {
    // Ива и Рокер — перекрашены (tint, см. тест выше): Трясинная ива и Болотный кузнечик вместо жуков на листе Золотого жука.
    const sheets = (ch: string) =>
      new Set(stages.filter((s) => s.chapter === ch).flatMap((s) => s.enemies.filter((e) => e).map((e) => e!.unit)).filter((id) => /^mob2_/.test(id)).map((id) => ctx.content.units[id].visual.sprite));
    const ch2 = sheets('chapter2');
    const ch1 = new Set(stages.filter((s) => s.chapter === 'chapter1').flatMap((s) => s.enemies.filter((e) => e).map((e) => ctx.content.units[e!.unit].visual.sprite)));
    expect([...ch2].filter((sp) => ch1.has(sp)).sort()).toEqual(['rocker', 'tank']);
    for (const own of ['dark_priest', 'gargoyle', 'raydric', 'mimic', 'dark_lord']) expect(ch2.has(own), own).toBe(false);
  });

  it('переход через границу глав открывает следующий этап (на каждой границе)', () => {
    const ch1 = chapterStages('chapter1').length;
    expect(stageStatus(clearedUpTo(ch1 - 1), 'ch2_s1', ctx)).toBe('locked');
    expect(stageStatus(clearedUpTo(ch1), 'ch2_s1', ctx)).toBe('open');
    expect(stageStatus(clearedUpTo(ch1 + chapterStages('chapter2').length), 'ch3_s1', ctx)).toBe('open');
    for (const c of chapters.slice(1)) {
      const first = chapterStages(c.id)[0];
      expect(stageStatus(clearedUpTo(first.globalIndex - 1), first.id, ctx), first.id).toBe('locked');
      expect(stageStatus(clearedUpTo(first.globalIndex), first.id, ctx), first.id).toBe('open');
    }
  });

  it('сила врагов растёт по ступеням этапов (вставные этапы главы 1 не в счёт), награды и офлайн-доход — дальше главы 1', () => {
    const g = ctx.progression.campaign.enemyStatGrowthPerStage;
    const e = enemySquad('ch3_s1', ctx)[0]!;
    const slot = stages.find((s) => s.id === 'ch3_s1')!.enemies[0]!;
    // ch3_s1 — 37-й по порядку (главы 1–2 — по 18 этапов), но ступень роста прежняя — 20: глава 3 не усилилась.
    expect(e.stats.hp).toBe(Math.round(ctx.content.units[slot.unit].stats.hp * slot.mult * Math.pow(1 + g, 20)));
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].offlinePerMinute.gold).toBeGreaterThan(stages[i - 1].offlinePerMinute.gold);
      expect(stages[i].offlinePerMinute.jobExp).toBeGreaterThan(stages[i - 1].offlinePerMinute.jobExp);
    }
    const regular = stages.filter((s) => !s.boss);
    for (let i = 1; i < regular.length; i++) {
      expect(regular[i].rewards.gold).toBeGreaterThan(regular[i - 1].rewards.gold);
      expect(regular[i].rewards.jobExp).toBeGreaterThan(regular[i - 1].rewards.jobExp);
    }
  });

  it('каждый этап глав 2+ играется без ошибок', () => {
    for (const s of stages.filter((x) => x.chapter !== 'chapter1')) {
      const out = playStage(clearedUpTo(s.globalIndex), s.id, s.globalIndex + 1, ctx);
      expect(['A', 'B']).toContain(out.result.winner);
      expect(out.save.battleSeq).toBe(1);
    }
  });
});

describe('маршрут из 10 глав (docs/design/lore-route.md §0, §4.2)', () => {
  it('номер главы — order: по возрастанию, в пределах 1…10, заголовок «Глава N.» совпадает с маршрутом', () => {
    for (const c of chapters) {
      expect(c.order, c.id).toBeGreaterThanOrEqual(1);
      expect(c.order, c.id).toBeLessThanOrEqual(10);
      expect(c.id, 'id главы — chapter<order>').toBe(`chapter${c.order}`);
      expect(c.name.startsWith(`Глава ${c.order}. `), `${c.id}: ${c.name}`).toBe(true);
    }
    // Глава 9 (Лабиринтный лес) ещё не написана: после главы 8 идёт 10-я, номера этапов — «10-K».
    expect(chapters.find((c) => c.id === 'chapter8')?.name).toBe('Глава 8. Гласт Хейм');
    expect(chapters.find((c) => c.id === 'chapter10')?.name).toBe('Глава 10. Нифльхейм');
    expect(stageLabel('ch10_s1', ctx.content)).toBe('10-1');
    expect(stageLabel('ch8_s18', ctx.content)).toBe('8-18');
  });

  it('главы 8 и 10: 18 этапов ch<N>_s1…s18 подряд, босс — s18; по 10 ступеней роста на главу, как у глав 1–7', () => {
    for (const [c, n] of [['chapter8', 8], ['chapter10', 10]] as const) {
      const ids = chapterStages(c).map((s) => s.id);
      expect(ids, c).toEqual(Array.from({ length: 18 }, (_, i) => `ch${n}_s${i + 1}`));
      expect(chapterStages(c).filter((s) => !s.inserted), c).toHaveLength(10);
    }
    // Ступень роста: главы 1–7 — по 10 обычных этапов, поэтому гл. 8 начинает с 70-й, гл. 10 (пока без гл. 9) — с 80-й.
    // Когда появится глава 9 с 10 обычными этапами, гл. 10 сдвинется на 10 ступеней (×2.16) — mult гл. 10 пересчитать.
    expect(growthStep(stages.find((s) => s.id === 'ch8_s1')!, ctx)).toBe(70);
    expect(growthStep(stages.find((s) => s.id === 'ch10_s1')!, ctx)).toBe(80);
  });

  it('боссы: Гласт Хейм — Тёмный лорд (s18) и мини-босс Верховный жрец (s15); Нифльхейм — Владыка мёртвых (s18) и Страж моста (s9)', () => {
    const units = (id: string) => stages.find((s) => s.id === id)!.enemies.flatMap((e) => (e ? [e.unit] : []));
    expect(units('ch8_s18')).toContain('mob7_boss');
    expect(ctx.content.units.mob7_boss.visual.sprite).toBe('dark_lord');
    expect(units('ch8_s15')).toContain('mob3_boss');
    expect(units('ch10_s18')).toContain('mob_lord_of_death');
    expect(ctx.content.units.mob_lord_of_death.kind).toBe('boss');
    expect(units('ch10_s9')).toContain('mob7_bridge_warden');
    // Тёмный лорд больше не босс Нифльхейма.
    for (const s of chapterStages('chapter10')) expect(units(s.id), s.id).not.toContain('mob7_boss');
  });

  it('тема главы (фон и музыка) — по содержимому, а не по месту: Гласт Хейм — склеп, Нифльхейм — Нифльхейм, слоты 2/3/7 — свои', () => {
    const theme = (id: string) => chapterTheme(chapters.find((c) => c.id === id));
    expect(theme('chapter8')).toBe('crypt');
    expect(theme('chapter10')).toBe('niflheim');
    expect(theme('chapter2')).toBe('sewer');
    expect(theme('chapter3')).toBe('orc');
    expect(theme('chapter7')).toBe('clocktower');
    expect(theme('chapter1')).toBe('meadow');
    expect(chapterTheme(undefined)).toBe('meadow');
  });
});
