import { z } from 'zod';
import { ChapterSchema, JobSchema, SkillSchema, StorySchema, TowerConfigSchema, UnitSchema } from '../../src/core';

/** JSON Schema для подсказок и проверки в редакторе (VS Code подхватывает по полю $schema). */
export function generateSchemas(): Record<string, string> {
  const gen = (schema: z.ZodType, title: string) =>
    JSON.stringify({ title, ...z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) }, null, 2) + '\n';
  return {
    'data/schema/unit.schema.json': gen(UnitSchema, 'Юнит (герой, монстр, босс)'),
    'data/schema/skill.schema.json': gen(SkillSchema, 'Навык (обычная атака, ульта, пассивка)'),
    'data/schema/job.schema.json': gen(JobSchema, 'Профессия (джоб)'),
    'data/schema/chapter.schema.json': gen(ChapterSchema, 'Глава кампании'),
    'data/schema/tower.schema.json': gen(TowerConfigSchema, 'Башня испытаний'),
    'data/schema/story.schema.json': gen(StorySchema, 'Сюжет главы'),
  };
}
