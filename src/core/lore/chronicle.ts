/**
 * «Летопись»: какие записи открыты по прогрессу игрока. Чистые функции от сохранения и контента.
 * - Бестиарий: монстры и боссы этапов кампании (по первому появлению); запись открыта после первой победы на любом
 *   этапе, где монстр встречается (save.campaign.cleared). Затем — монстры Башни (открыт, когда взят этаж с ним:
 *   save.tower.floor) и боссы Охоты (открыт после первого боя с ним: save.hunt.best).
 * - Находки: находки этапов (pages.ts → findingEntries).
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
import type { HuntConfig } from '../hunt/schema';
import type { TowerConfig } from '../tower/schema';
import { findingEntries } from './pages';
import type { ChapterLore, Lore, WorldEntry } from './schema';

type ChronicleSave = Pick<SaveState, 'campaign' | 'inventory' | 'heroes' | 'findings'> & Partial<Pick<SaveState, 'tower' | 'hunt'>>;

export interface ChronicleContext {
  content: Content;
  equipment: { items: Record<string, ItemDef> };
  /** Башня и Охота — их монстры тоже в бестиарии (нет — только кампания). */
  tower?: TowerConfig;
  hunt?: HuntConfig;
}

/** Где ещё встречаются монстры, кроме кампании. */
export interface BestiaryExtras {
  tower?: TowerConfig;
  hunt?: HuntConfig;
}

/**
 * id юнитов этажа n Башни — то же правило выбора раскладки, что towerFloor (src/core/tower/tower.ts; совпадение
 * проверяет tests/lore.test.ts), но без сборки врагов (там id копий — tower_f<N>_<слот>).
 */
export function towerFloorUnits(n: number, cfg: TowerConfig): string[] {
  let band = cfg.bands[0];
  for (const b of cfg.bands) if (b.fromFloor <= n) band = b;
  if (!band) return [];
  let layout;
  if (n % cfg.bossEvery === 0) {
    const firstBoss = Math.ceil(band.fromFloor / cfg.bossEvery) * cfg.bossEvery;
    layout = band.bossLayouts[((n - firstBoss) / cfg.bossEvery) % band.bossLayouts.length];
  } else layout = band.layouts[(n - band.fromFloor) % band.layouts.length];
  return (layout ?? []).flatMap((e) => (e ? [e.unit] : []));
}

/** Все юниты Башни и Охоты (для проверки лора: такие монстры в бестиарии есть). */
export function extraBestiaryUnits(extras: BestiaryExtras): Set<string> {
  const out = new Set<string>();
  if (extras.tower) for (let n = 1; n <= extras.tower.maxFloor; n++) for (const u of towerFloorUnits(n, extras.tower)) out.add(u);
  for (const b of extras.hunt?.bosses ?? []) out.add(b.unit);
  return out;
}

export interface BestiaryEntry {
  unitId: string;
  unit: UnitDef;
  /** Этапы, где встречается, по порядку кампании («2-5»). */
  stages: string[];
  open: boolean;
}

/**
 * Все монстры и боссы кампании по первому появлению; open — хотя бы один их этап пройден. Затем — новые монстры Башни
 * («Башня, этаж N», open — этаж взят) и боссы Охоты («Охота», open — был бой с ним).
 */
export function bestiary(save: Pick<SaveState, 'campaign'> & Partial<Pick<SaveState, 'tower' | 'hunt'>>, content: Content, extras: BestiaryExtras = {}): BestiaryEntry[] {
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
  const add = (unitId: string, label: string, open: boolean) => {
    const unit = content.units[unitId];
    if (!unit || unit.kind === 'hero') return;
    let entry = byUnit.get(unitId);
    if (!entry) byUnit.set(unitId, (entry = { unitId, unit, stages: [], open: false }));
    if (!entry.stages.includes(label)) entry.stages.push(label);
    if (open) entry.open = true;
  };
  if (extras.tower) {
    const top = save.tower?.floor ?? 0;
    // Подпись — первый этаж с монстром (следующие этажи того же монстра не перечисляем: их десятки).
    const firstFloor = new Map<string, number>();
    for (let n = 1; n <= extras.tower.maxFloor; n++) for (const u of towerFloorUnits(n, extras.tower)) if (!firstFloor.has(u)) firstFloor.set(u, n);
    for (const [u, n] of firstFloor) add(u, `Башня, этаж ${n}`, n <= top);
  }
  for (const b of extras.hunt?.bosses ?? []) add(b.unit, 'Охота', save.hunt?.best[b.unit] !== undefined);
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
  /** Глава: запись world.json (lore) и/или тексты главы в data/campaign (эпизод, легенда, летопись). */
  | { kind: 'chapter'; id: string; chapterName: string; lore?: ChapterLore; open: boolean }
  | { kind: 'world'; id: string; entry: WorldEntry; open: boolean; unlockLabel?: string };

/** Главы (у которых есть запись лора или тексты эпизода/легенды/летописи) по порядку кампании, затем записи мира. */
export function worldEntries(save: Pick<SaveState, 'campaign'>, content: Content, lore: Lore): WorldItem[] {
  const cleared = new Set(save.campaign.cleared);
  const out: WorldItem[] = [];
  content.chapters.forEach((ch, i) => {
    const l = lore.chapters[ch.id];
    if (!l && !ch.episode && !ch.legend && !ch.chronicle) return;
    const prev = i === 0 ? undefined : content.chapters[i - 1].stages.at(-1)?.id;
    out.push({ kind: 'chapter', id: ch.id, chapterName: ch.name, ...(l ? { lore: l } : {}), open: !prev || cleared.has(prev) });
  });
  for (const w of lore.world) {
    const open = !w.unlockAfterStage || cleared.has(w.unlockAfterStage);
    out.push({ kind: 'world', id: w.id, entry: w, open, ...(w.unlockAfterStage ? { unlockLabel: stageLabel(w.unlockAfterStage, content) } : {}) });
  }
  return out;
}

export type ChronicleTab = 'world' | 'findings' | 'bestiary' | 'items' | 'heroes';

/**
 * Ключи открытых записей, которые стоит прочитать (для красного кружка «новое»): записи мира, монстры и предметы
 * с текстом лора, полученные герои с историей. Ключ — `<вкладка>:<id>`.
 */
export function chronicleKeys(save: ChronicleSave, ctx: ChronicleContext, lore: Lore): Record<ChronicleTab, string[]> {
  return {
    world: worldEntries(save, ctx.content, lore)
      .filter((w) => w.open)
      .map((w) => `world:${w.id}`),
    findings: findingEntries(save, ctx.content)
      .filter((f) => f.found)
      .map((f) => `findings:${f.finding.id}`),
    bestiary: bestiary(save, ctx.content, ctx)
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
  const r = { world: n(keys.world), findings: n(keys.findings), bestiary: n(keys.bestiary), items: n(keys.items), heroes: n(keys.heroes) };
  return { ...r, total: r.world + r.findings + r.bestiary + r.items + r.heroes };
}
