import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGameContext, campaignSceneLines, enemySquad, growthStep, recommendedPower, resolveStageEnemies,
  simulateBattle, unitPower, type ChapterDef, type StoryDef,
} from '../src/core';
import { loadFullContext, readRawGameData, ROOT } from '../scripts/lib/content-node';
import { CHOICE_SQUADS, CHOICE_STAGE, choiceSample, choiceSquad, type ChoiceMode } from '../scripts/chapter3-choice-calibrate';

const ctx = loadFullContext();
const stage = ctx.content.stages.find((s) => s.id === CHOICE_STAGE)!;
const binding = stage.campaignChoice!;
const source = ctx.story.scenes.find((s) => s.id === 'ch3o_s15_after')!;
const result = ctx.story.scenes.find((s) => s.id === 'ch3o_s6_after')!;
const rawChapter = JSON.parse(readFileSync(join(ROOT, 'data/campaign/chapter3.json'), 'utf8')) as ChapterDef;
const ORIGINAL_BASE = [
  { unit: 'orc_high', mult: 0.4291 }, { unit: 'orc_high', mult: 0.4291 },
  { unit: 'orc_archer', mult: 1.3089 }, { unit: 'orc_chonchon', mult: 1.3089 }, { unit: 'orc_archer', mult: 1.3089 },
];
const ORIGINAL_IDS = ['ch3_s1', 'ch3_s11', 'ch3_s2', 'ch3_s12', 'ch3_s3', 'ch3_s13', 'ch3_s4', 'ch3_s14', 'ch3_s5',
  'ch3_s15', 'ch3_s6', 'ch3_s16', 'ch3_s7', 'ch3_s17', 'ch3_s8', 'ch3_s18', 'ch3_s9', 'ch3_s10'];

describe('локальный пилот выбора главы 3: границы контента', () => {
  it('сохраняет все исходные этапы, их порядок, базовые enemies, награды, находки и offlinePerMinute', () => {
    expect(rawChapter.stages.map((s) => s.id)).toEqual(ORIGINAL_IDS);
    // Снимок всех полей stages до пилота; исключено только новое поле привязки выбора. 19.10: золото этапов и сундука ×1.5
    // по просьбе владельца — снимок пересчитан (остальные поля не менялись).
    const stages = rawChapter.stages.map(({ campaignChoice: _choice, ...s }) => s);
    expect(createHash('sha256').update(JSON.stringify(stages)).digest('hex'))
      .toBe('f6df2c320ef0a64db61902fb3274659a23e129debbcb9502053796fa9616583e');
    expect(stage.enemies).toEqual(ORIGINAL_BASE);
    expect(growthStep(stage, ctx)).toBe(25);
    expect(ctx.content.stages.find((s) => s.id === 'ch3_s10')!.enemies[2]?.unit).toBe('orc_lord');
  });

  it('связывает единственный выбор с последующим этапом по порядку массива, а не по номеру ID', () => {
    expect(ctx.content.stages.filter((s) => s.campaignChoice).map((s) => s.id)).toEqual([CHOICE_STAGE]);
    expect(binding).toMatchObject({ id: 'ch3_rescue', sceneId: source.id, afterStageId: 'ch3_s15' });
    expect(source.choice?.options.map((o) => o.id)).toEqual(['evacuate', 'block']);
    expect(binding.variants.map((v) => v.optionId)).toEqual(['evacuate', 'block']);
    expect(ctx.content.stages.find((s) => s.id === binding.afterStageId)!.globalIndex + 1).toBe(stage.globalIndex);
    expect(result).toMatchObject({ chapter: 'chapter3', trigger: 'afterStage', stageId: CHOICE_STAGE });
  });

  it('меняет только два слота одной ветки, не меняет базу и не вводит бонусов', () => {
    const base = JSON.stringify(stage.enemies);
    const block = resolveStageEnemies(stage, { ch3_rescue: 'block' });
    expect(binding.variants[0].enemies).toEqual(ORIGINAL_BASE);
    expect(block.map((e) => e?.unit)).toEqual(['orc_skeleton', 'orc_high', 'orc_archer', 'orc_zombie', 'orc_archer']);
    for (const slot of [1, 2, 4]) expect(block[slot]).toEqual(stage.enemies[slot]);
    for (const variant of binding.variants) {
      expect(variant.enemies).toHaveLength(5);
      for (const enemy of variant.enemies) {
        expect(enemy!.mult).toBeGreaterThan(0);
        expect(ctx.content.units[enemy!.unit].kind).toBe('monster');
      }
    }
    expect(JSON.stringify(stage.enemies)).toBe(base);
    for (const option of source.choice!.options) expect(Object.keys(option).sort()).toEqual(['id', 'reply', 'text']);
  });

  it('пропуск, неизвестное значение и evacuate дают исходные статы, навыки и детерминированный лог', () => {
    const base = enemySquad(CHOICE_STAGE, ctx);
    for (const choices of [undefined, { ch3_rescue: 'default' }, { ch3_rescue: 'evacuate' }, { ch3_rescue: 'unknown' }]) {
      expect(enemySquad(CHOICE_STAGE, ctx, choices)).toEqual(base);
      expect(resolveStageEnemies(stage, choices)).toEqual(ORIGINAL_BASE);
    }
    const squad = choiceSquad(ctx, 0, 12);
    const battle = simulateBattle(ctx.content, squad, base, 1701, { combat: ctx.combat });
    expect(simulateBattle(ctx.content, squad, enemySquad(CHOICE_STAGE, ctx, { ch3_rescue: 'evacuate' }), 1701, { combat: ctx.combat })).toEqual(battle);
    for (const other of ctx.content.stages.filter((s) => s.id !== CHOICE_STAGE)) {
      expect(enemySquad(other.id, ctx, { ch3_rescue: 'block' })).toEqual(enemySquad(other.id, ctx));
    }
  });

  it('все реплики укладываются в лимит, у результата видны только свои 2–3 строки', () => {
    expect(source.lines).toHaveLength(6);
    expect(result.lines).toHaveLength(6);
    for (const scene of [source, result]) for (const line of [...scene.lines, ...(scene.choice?.options.flatMap((o) => o.reply) ?? [])]) {
      expect(line.text.length).toBeLessThanOrEqual(120);
      expect(ctx.story.chapters.chapter3.speakers[line.speaker]).toBeDefined();
    }
    for (const option of ['evacuate', 'block', 'default']) {
      const lines = campaignSceneLines({ campaignChoices: { ch3_rescue: option } }, result);
      expect(lines).toHaveLength(option === 'default' ? 2 : 3);
      expect(lines.every((line) => !line.when || line.when.is === option)).toBe(true);
    }
    expect(campaignSceneLines({}, result).map((l) => l.text)).toEqual([
      'Раненые наверху. Нижний караул отступил. Дальше — вместе.',
      'Живые наверху. Теперь поможем тем, кто остался внизу.',
    ]);
  });

  it('ловит испорченные ссылки варианта, порядок этапов и неизвестное условие', () => {
    const raw = readRawGameData();
    const chapter = raw.chapters!.find((f) => (f.data as ChapterDef).id === 'chapter3')!;
    const original = structuredClone(chapter.data) as ChapterDef;
    const target = () => (chapter.data as ChapterDef).stages.find((s) => s.id === CHOICE_STAGE)!;
    target().campaignChoice!.variants[1].enemies[0]!.unit = 'missing_pilot_enemy';
    expect(() => buildGameContext(raw)).toThrow(/missing_pilot_enemy/);
    chapter.data = structuredClone(original);
    target().campaignChoice!.afterStageId = 'ch3_s10';
    expect(() => buildGameContext(raw)).toThrow();
    chapter.data = structuredClone(original);
    target().campaignChoice!.variants[1].optionId = 'default';
    expect(() => buildGameContext(raw)).toThrow();
    chapter.data = structuredClone(original);
    const story = raw.stories!.find((f) => (f.data as StoryDef).chapter === 'chapter3')!.data as StoryDef;
    story.scenes.find((s) => s.id === result.id)!.lines[0].when!.is = 'missing_pilot_option';
    expect(() => buildGameContext(raw)).toThrow(/missing_pilot_option/);
  });

  it('отклоняет второй источник с тем же choice ID', () => {
    const raw = readRawGameData();
    const story = raw.stories!.find((f) => (f.data as StoryDef).chapter === 'chapter3')!.data as StoryDef;
    story.scenes.find((s) => s.id === 'ch3o_s16_after')!.choice = structuredClone(source.choice);
    expect(() => buildGameContext(raw)).toThrow(/выбор ch3_rescue уже занят/);
  });

  it('отклоняет несовпадение кнопок сцены и вариантов боя', () => {
    const raw = readRawGameData();
    const chapter = raw.chapters!.find((f) => (f.data as ChapterDef).id === 'chapter3')!.data as ChapterDef;
    chapter.stages.find((s) => s.id === CHOICE_STAGE)!.campaignChoice!.variants[1].optionId = 'missing_pilot_option';
    expect(() => buildGameContext(raw)).toThrow(/варианты выбора не совпадают/);
  });

  it('отклоняет условие по неизвестному choice ID', () => {
    const raw = readRawGameData();
    const story = raw.stories!.find((f) => (f.data as StoryDef).chapter === 'chapter3')!.data as StoryDef;
    story.scenes.find((s) => s.id === result.id)!.lines[0].when!.choice = 'missing_pilot_choice';
    expect(() => buildGameContext(raw)).toThrow(/missing_pilot_choice/);
  });

  it.each(['slots', 'mult'] as const)('отклоняет нарушение схемы варианта: %s', (kind) => {
    const raw = readRawGameData();
    const chapter = raw.chapters!.find((f) => (f.data as ChapterDef).id === 'chapter3')!.data as ChapterDef;
    const enemies = chapter.stages.find((s) => s.id === CHOICE_STAGE)!.campaignChoice!.variants[1].enemies;
    if (kind === 'slots') enemies.pop();
    else enemies[0]!.mult = 0;
    expect(() => buildGameContext(raw)).toThrow(/campaignChoice\.variants\.1\.enemies/);
  });
});

describe('локальный пилот выбора главы 3: парный баланс', () => {
  it('сохраняет сравнимый порог силы для четырёх отрядов в авто и при фиксированных ручных касаниях', () => {
    const base = enemySquad(CHOICE_STAGE, ctx);
    const block = enemySquad(CHOICE_STAGE, ctx, { ch3_rescue: 'block' });
    const levels = [6, 9, 10, 11, 12, 13, 14, 15, 18];
    const deltas: number[] = [];
    const blockThresholds: number[] = [];
    for (let i = 0; i < CHOICE_SQUADS.length; i++) for (const mode of ['auto', 'manual'] as ChoiceMode[]) {
      const samples = levels.map((level) => {
        const squad = choiceSquad(ctx, i, level);
        const a = choiceSample(ctx, squad, base, mode, 16, 2001);
        const b = choiceSample(ctx, squad, block, mode, 16, 2001);
        deltas.push(b.winRate - a.winRate);
        return { level, a, b, power: squad.reduce((n, u) => n + unitPower(u, ctx), 0) };
      });
      const thresholdA = samples.find((s) => s.a.winRate >= 0.5);
      const thresholdB = samples.find((s) => s.b.winRate >= 0.5);
      expect(thresholdA, `${CHOICE_SQUADS[i].id}/${mode}: base`).toBeDefined();
      expect(thresholdB, `${CHOICE_SQUADS[i].id}/${mode}: block`).toBeDefined();
      // Допускается тактический обмен выгодой: другой элемент/поведение, но не новая стена прогрессии.
      const ratio = thresholdB!.power / thresholdA!.power;
      expect(ratio, `${CHOICE_SQUADS[i].id}/${mode}`).toBeGreaterThanOrEqual(0.9);
      expect(ratio, `${CHOICE_SQUADS[i].id}/${mode}`).toBeLessThanOrEqual(1.1);
      blockThresholds.push(thresholdB!.power);
    }
    const bias = deltas.reduce((n, d) => n + d, 0) / deltas.length;
    expect(Math.abs(bias)).toBeLessThan(0.16);
    expect(deltas.reduce((n, d) => n + Math.abs(d), 0) / deltas.length).toBeLessThan(0.2);
    const median = [...blockThresholds].sort((a, b) => a - b)[blockThresholds.length / 2];
    // Рекомендация — измеренный ориентир состава, не обещание победы каждому отряду.
    expect(recommendedPower(CHOICE_STAGE, ctx, { ch3_rescue: 'block' }) / median).toBeGreaterThanOrEqual(0.9);
    expect(recommendedPower(CHOICE_STAGE, ctx, { ch3_rescue: 'block' }) / median).toBeLessThanOrEqual(1.1);
  }, 30000);
});
