/**
 * «Летопись»: какие записи открыты по прогрессу игрока. Чистые функции от сохранения и контента.
 * - Бестиарий: монстры и боссы этапов кампании (по первому появлению); запись открыта после первой победы на любом
 *   этапе, где монстр встречается (save.campaign.cleared).
 * - Предметы: открыт, если он есть у игрока (инвентарь, в том числе надетый) или его minChapter ≤ глава игрока
 *   (progressChapter) — учёта «когда-либо был» в сохранении нет.
 * - Герои: все карточки data/heroes; история и черты — у полученных.
 * - Мир: главы с записью в world.json — открыта первая и каждая, чей предыдущий этап пройден; записи мира — после
 *   unlockAfterStage (нет поля — сразу).
 */
import { progressChapter } from '../equipment/gates';
import type { ItemDef } from '../equipment/schema';
import type { SaveState } from '../save/schema';
import type { Content, UnitDef } from '../types';
import { stageLabel } from '../unlocks/unlocks';
import type { ChapterLore, Lore, WorldEntry } from './schema';

type ChronicleSave = Pick<SaveState, 'campaign' | 'inventory' | 'heroes'>;

export interface ChronicleContext {
  content: Content;
  equipment: { items: Record<string, ItemDef> };
}

export interface BestiaryEntry {
  unitId: string;
  unit: UnitDef;
  /** Этапы, где встречается, по порядку кампании («2-5»). */
  stages: string[];
  open: boolean;
}

/** Все монстры и боссы кампании по первому появлению; open — хотя бы один их этап пройден. */
export function bestiary(save: Pick<SaveState, 'campaign'>, content: Content): BestiaryEntry[] {
  const cleared = new Set(save.campaign.cleared);
  const byUnit = new Map<string, BestiaryEntry>();
  for (const st of content.stages) {
    for (const e of st.enemies) {
      const unit = e && content.units[e.unit];
      if (!e || !unit || unit.kind === 'hero') continue;
      let entry = byUnit.get(e.unit);
      if (!entry) byUnit.set(e.unit, (entry = { unitId: e.unit, unit, stages: [], open: false }));
      const label = stageLabel(st.id, content);
      if (!entry.stages.includes(label)) entry.stages.push(label);
      if (cleared.has(st.id)) entry.open = true;
    }
  }
  return [...byUnit.values()];
}

export interface ItemEntry {
  item: ItemDef;
  /** Есть у игрока сейчас. */
  owned: boolean;
  open: boolean;
}

const SLOT_ORDER = ['weapon', 'armor', 'helmet', 'boots'];
const RARITY_ORDER = ['common', 'rare', 'epic'];

/** Все предметы: по главе появления, слоту, редкости. */
export function itemEntries(save: Pick<SaveState, 'campaign' | 'inventory'>, ctx: ChronicleContext): ItemEntry[] {
  const owned = new Set(save.inventory.items.map((i) => i.itemId));
  const chapter = progressChapter(save, ctx);
  const order = (list: string[], v: string) => (list.indexOf(v) + 1 || 99);
  return Object.values(ctx.equipment.items)
    .map((item) => ({ item, owned: owned.has(item.id), open: owned.has(item.id) || item.minChapter <= chapter }))
    .sort(
      (a, b) =>
        a.item.minChapter - b.item.minChapter ||
        order(SLOT_ORDER, a.item.slot) - order(SLOT_ORDER, b.item.slot) ||
        order(RARITY_ORDER, a.item.rarity) - order(RARITY_ORDER, b.item.rarity) ||
        a.item.name.localeCompare(b.item.name, 'ru'),
    );
}

export interface HeroEntry {
  templateId: string;
  owned: boolean;
}

/** Все карточки героев (порядок data/heroes); owned — есть хотя бы один экземпляр. */
export function heroEntries(save: Pick<SaveState, 'heroes'>, content: Content): HeroEntry[] {
  const owned = new Set(save.heroes.map((h) => h.templateId));
  return Object.keys(content.heroes).map((templateId) => ({ templateId, owned: owned.has(templateId) }));
}

export type WorldItem =
  | { kind: 'chapter'; id: string; chapterName: string; lore: ChapterLore; open: boolean }
  | { kind: 'world'; id: string; entry: WorldEntry; open: boolean; unlockLabel?: string };

/** Главы (у которых есть запись лора) по порядку кампании, затем записи мира. */
export function worldEntries(save: Pick<SaveState, 'campaign'>, content: Content, lore: Lore): WorldItem[] {
  const cleared = new Set(save.campaign.cleared);
  const out: WorldItem[] = [];
  content.chapters.forEach((ch, i) => {
    const l = lore.chapters[ch.id];
    if (!l) return;
    const prev = i === 0 ? undefined : content.chapters[i - 1].stages.at(-1)?.id;
    out.push({ kind: 'chapter', id: ch.id, chapterName: ch.name, lore: l, open: !prev || cleared.has(prev) });
  });
  for (const w of lore.world) {
    const open = !w.unlockAfterStage || cleared.has(w.unlockAfterStage);
    out.push({ kind: 'world', id: w.id, entry: w, open, ...(w.unlockAfterStage ? { unlockLabel: stageLabel(w.unlockAfterStage, content) } : {}) });
  }
  return out;
}

export type ChronicleTab = 'world' | 'bestiary' | 'items' | 'heroes';

/**
 * Ключи открытых записей, которые стоит прочитать (для красного кружка «новое»): записи мира, монстры и предметы
 * с текстом лора, полученные герои с историей. Ключ — `<вкладка>:<id>`.
 */
export function chronicleKeys(save: ChronicleSave, ctx: ChronicleContext, lore: Lore): Record<ChronicleTab, string[]> {
  return {
    world: worldEntries(save, ctx.content, lore)
      .filter((w) => w.open)
      .map((w) => `world:${w.id}`),
    bestiary: bestiary(save, ctx.content)
      .filter((m) => m.open && lore.monsters[m.unitId])
      .map((m) => `bestiary:${m.unitId}`),
    items: itemEntries(save, ctx)
      .filter((e) => e.open && lore.items[e.item.id])
      .map((e) => `items:${e.item.id}`),
    heroes: heroEntries(save, ctx.content)
      .filter((h) => h.owned && lore.heroes[h.templateId])
      .map((h) => `heroes:${h.templateId}`),
  };
}

/** Сколько открытых записей ещё не видели (по вкладкам и всего). */
export function unseenCount(keys: Record<ChronicleTab, string[]>, seen: ReadonlySet<string>): Record<ChronicleTab, number> & { total: number } {
  const n = (list: string[]) => list.filter((k) => !seen.has(k)).length;
  const r = { world: n(keys.world), bestiary: n(keys.bestiary), items: n(keys.items), heroes: n(keys.heroes) };
  return { ...r, total: r.world + r.bestiary + r.items + r.heroes };
}
