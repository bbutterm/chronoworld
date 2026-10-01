/**
 * Сохранения для промо-съёмки, собранные ядром. Печатает JSON { имя: строка сохранения } в stdout.
 *   npx tsx promo/src/saves.ts > promo/.work/saves.json
 * Кампания пройдена, все 12 героев (отряд — красные ур. 100 с ветками, остальные — золотые ур. 70), все сюжетные сцены
 * просмотрены (без диалогов поверх боя), вечера таверны 1–8 увидены, близость, карты MVP в запасе.
 */
import { addHeroCard, newGame, placeInSquad, serialize, type CardRarity, type SaveState } from '../../src/core';
import { loadFullContext } from '../../scripts/lib/content-node';
import { AUDIT, SQUADS } from './squads';

const ctx = loadFullContext();
const ALL: Record<string, string> = {
  alan: 'knight', iris: 'knight', bran: 'hunter', meilin: 'hunter', kai: 'wizard', lira: 'wizard',
  dorn: 'assassin', zara: 'assassin', vika: 'priest', teo: 'priest', greta: 'blacksmith', otto: 'blacksmith',
};

function build(squad: string[]): SaveState {
  const base = newGame(ctx, Date.now() - 20 * 86_400_000);
  let save: SaveState = {
    ...base,
    heroes: [],
    squad: [null, null, null, null, null],
    campaign: { ...base.campaign, cleared: ctx.content.stages.map((s) => s.id) },
  };
  const inSquad = new Map(squad.map((c) => c.split('/') as [string, string | undefined]));
  const add = (t: string, branch: string | undefined, rarity: CardRarity, level: number) => {
    const r = addHeroCard(save, t, rarity, { level });
    const hero = branch ? { ...r.hero, branch } : r.hero;
    save = { ...r.save, heroes: r.save.heroes.map((h) => (h.id === hero.id ? hero : h)) };
    return hero;
  };
  for (const c of squad) {
    const [t, branch] = c.split('/');
    const hero = add(t, branch, 'red', 100);
    save = { ...save, squad: placeInSquad(save.squad, hero, save, ctx) };
  }
  for (const [t, b] of Object.entries(ALL)) if (!inSquad.has(t)) add(t, b, 'gold', 70);
  const o = JSON.parse(serialize(save)) as SaveState & { seenUnlocks?: unknown };
  delete o.seenUnlocks;
  // Снаряжение лидера отряда: заточка и карты MVP в слотах (кадр «Инвентарь»), плюс запас в сумке.
  const lead = o.heroes.find((h) => h.id === o.squad.find(Boolean))!.id;
  const gear: [string, string | null, number, string?][] = [
    ['crescent_scythe', lead, 7, 'card_baphomet'], ['valkyrie_armor', lead, 5, 'card_osiris'], ['majestic_goat', lead, 4], ['valkyrie_boots', lead, 3],
    ['abyss_blade', null, 2], ['dark_lord_robe', null, 0], ['helm_of_darkness', null, 1], ['sleipnir', null, 0], ['pirate_saber', null, 0], ['kitsune_mask', null, 0],
  ];
  const items = gear.map(([itemId, by, refine, card], i) => ({ id: `promo_${i}`, itemId, equippedBy: by, refine, ...(card ? { card } : {}) }));
  const evenings = (ctx.story as any).tavern.evenings.map((e: any) => e.id) as string[];
  return {
    ...o,
    seenScenes: ctx.story.scenes.map((x) => x.id),
    storyQueue: [],
    pendingChapterDone: undefined,
    currency: { ...o.currency, gold: 1_284_000, gems: 2_450 },
    tavern: { seen: evenings.slice(0, 8), bond: { alan: 6, vika: 7, bran: 5, dorn: 4, greta: 5 }, quests: ['bq_bran'] },
    inventory: { ...(o as any).inventory, items },
    hunt: { day: '2026-01-01', used: 0, best: { mvp_osiris: 61000 }, level: 6, kills: { mvp_osiris: 2, mvp_baphomet: 1 }, cards: { card_osiris: 1, card_baphomet: 1 }, dry: 0 },
  } as SaveState;
}

const out: Record<string, string> = {};
for (const [name, squad] of Object.entries({ ...SQUADS, ...(process.env.PROMO_AUDIT ? AUDIT : {}) })) out[name] = serialize(build(squad));
process.stdout.write(JSON.stringify(out));
