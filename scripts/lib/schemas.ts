import { z } from 'zod';
import { CardsConfigSchema, DropsConfigSchema, EventsConfigSchema, ExpeditionsConfigSchema, ChapterSchema, HuntConfigSchema, HeroTemplateSchema, JobSchema, SkillSchema, StorySchema, SummonConfigSchema, ShopConfigSchema, TowerConfigSchema, UnitSchema, UnlocksConfigSchema, MonstersLoreSchema, ItemsLoreSchema, HeroesLoreSchema, HeroStoriesLoreSchema, JobsLoreSchema, WorldLoreSchema, LinesLoreSchema } from '../../src/core';
import { MonsterSoundsSchema } from '../../src/game/monsterSounds';

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
    'data/schema/hero.schema.json': gen(HeroTemplateSchema, 'Карточка героя (шаблон)'),
    'data/schema/cards.schema.json': gen(CardsConfigSchema, 'Редкости, уровень и вознесение карточек'),
    'data/schema/summon.schema.json': gen(SummonConfigSchema, 'Таверна (призыв карточек)'),
    'data/schema/unlocks.schema.json': gen(UnlocksConfigSchema, 'Открытие функций по этапам кампании'),
    'data/schema/events.schema.json': gen(EventsConfigSchema, 'События новичка и системные письма'),
    'data/schema/hunt.schema.json': gen(HuntConfigSchema, 'Охота на босса'),
    'data/schema/shop.schema.json': gen(ShopConfigSchema, 'Лавка (товары и обновление)'),
    'data/schema/drops.schema.json': gen(DropsConfigSchema, 'Выпадение предметов и трофеи сундука'),
    'data/schema/expeditions.schema.json': gen(ExpeditionsConfigSchema, 'Экспедиции по локациям и лимиты пресетов'),
    'data/schema/lore-monsters.schema.json': gen(MonstersLoreSchema, 'Летопись: бестиарий (id юнита → запись)'),
    'data/schema/lore-items.schema.json': gen(ItemsLoreSchema, 'Летопись: легенды предметов (id предмета → строка)'),
    'data/schema/lore-heroes.schema.json': gen(HeroesLoreSchema, 'Летопись: истории героев (id карточки → история и черты)'),
    'data/schema/lore-hero-stories.schema.json': gen(HeroStoriesLoreSchema, 'Летопись: история героя кусочками (id карточки → кусочки по уровням 10, 20, … 100)'),
    'data/schema/lore-jobs.schema.json': gen(JobsLoreSchema, 'Летопись: профессии (id профессии → текст)'),
    'data/schema/lore-world.schema.json': gen(WorldLoreSchema, 'Летопись: главы и записи о мире'),
    'data/schema/monster-sounds.schema.json': gen(MonsterSoundsSchema, 'Звуки монстров RO (лист спрайта → атака и смерть)'),
    'data/schema/lore-lines.schema.json': gen(LinesLoreSchema, 'Строки-комментарии (заточка, поражение, Башня, экспедиции, загрузка)'),
  };
}
