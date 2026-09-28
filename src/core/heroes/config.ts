import { z } from 'zod';
import type { GameContext } from '../progression/types';
import type { UnlocksConfig } from '../unlocks/schema';
import { CardsConfigSchema, rarityIndex, CARD_RARITIES, SummonConfigSchema, type CardsConfig, type CardRarity, type SummonConfig } from './schema';

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/** Разобрать data/cards.json и data/summon.json (ядро файлы не читает). Ошибка — Error с именем файла. */
export function parseHeroesConfig(cardsJson: unknown, summonJson: unknown, unlocks?: UnlocksConfig): { cards: CardsConfig; summon: SummonConfig } {
  const c = CardsConfigSchema.safeParse(cardsJson);
  if (!c.success) throw new Error(`data/cards.json: ${describe(c.error)}`);
  const s = SummonConfigSchema.safeParse(summonJson);
  if (!s.success) throw new Error(`data/summon.json: ${describe(s.error)}`);
  // Этап открытия Таверны — из единой таблицы data/unlocks.json (строка tavern); без таблицы — из summon.json.
  const fromTable = unlocks?.features.find((f) => f.id === 'tavern')?.stage;
  if (fromTable && s.data.unlockAfterStage) throw new Error('data/summon.json: unlockAfterStage — этап открытия Таверны задаётся в data/unlocks.json (tavern), уберите поле');
  const stage = fromTable ?? s.data.unlockAfterStage;
  if (!stage) throw new Error('data/unlocks.json: нет строки tavern — этап открытия Таверны не задан');
  return { cards: c.data, summon: { ...s.data, unlockAfterStage: stage } };
}

/**
 * Пул Таверны для редкости rarity: все герои (и сюжетные — копии им в рост; решение владельца 28.09: Грета и Дорн в
 * пуле с открытия Таверны), у которых maxRarity не ниже rarity. Отсортирован по id.
 */
export function summonPool(ctx: GameContext, rarity: CardRarity): string[] {
  if (!ctx.summon.rates.some((r) => r.rarity === rarity)) return [];
  return Object.values(ctx.content.heroes)
    .filter((t) => rarityIndex(t.maxRarity) >= rarityIndex(rarity) && rarityIndex(t.baseRarity) <= rarityIndex(rarity))
    .map((t) => t.id)
    .sort();
}

/**
 * Перекрёстные проверки героев с прогрессией, кампанией и Таверной (content:check ✗):
 * - progression.heroes.start / recruits — сюжетные шаблоны, без повторов; afterStage — существующий этап;
 * - у каждой выпадающей редкости Таверны пул не пуст; unlockAfterStage существует;
 * - для каждого шаблона есть правила вознесения на всём пути baseRarity → maxRarity.
 */
export function validateHeroesConfig(ctx: GameContext, problems: string[]): void {
  const { heroes } = ctx.content;
  const stageIds = new Set(ctx.content.stages.map((s) => s.id));
  const story = [...ctx.progression.heroes.start, ...ctx.progression.heroes.recruits.map((r) => r.template)];
  const seen = new Set<string>();
  for (const id of story) {
    const t = heroes[id];
    if (!t) problems.push(`data/progression.json: heroes — карточка ${id} не найдена в data/heroes`);
    else if (t.source !== 'story') problems.push(`data/progression.json: heroes — карточка ${id} не сюжетная (source: ${t.source})`);
    if (seen.has(id)) problems.push(`data/progression.json: heroes — карточка ${id} указана дважды`);
    seen.add(id);
  }
  for (const r of ctx.progression.heroes.recruits) {
    if (stageIds.size && !stageIds.has(r.afterStage)) problems.push(`data/progression.json: heroes.recruits — этап ${r.afterStage} не найден`);
  }
  for (const t of Object.values(heroes)) {
    if (t.source === 'story' && !seen.has(t.id)) problems.push(`карточка ${t.id}: сюжетная, но её нет в progression.heroes (start/recruits) — игрок её не получит`);
    for (let i = rarityIndex(t.baseRarity); i < rarityIndex(t.maxRarity); i++) {
      const from = CARD_RARITIES[i];
      if (!ctx.cards.merge.some((m) => m.from === from)) problems.push(`карточка ${t.id}: нет правила вознесения ${from} → ${CARD_RARITIES[i + 1]} (data/cards.json → merge)`);
    }
  }
  if (stageIds.size && !stageIds.has(ctx.summon.unlockAfterStage)) problems.push(`data/unlocks.json: tavern — этап ${ctx.summon.unlockAfterStage} не найден`);
  for (const r of ctx.summon.rates) {
    if (r.chance > 0 && summonPool(ctx, r.rarity).length === 0) problems.push(`data/summon.json: редкость ${r.rarity} выпадает (шанс ${r.chance}), но нет героев, которые бывают этой редкости`);
  }
}
