/**
 * Сохранения для кадров поведения в бою (docs/design/battle-behavior.md, scripts/behavior-shots.mjs): отряд и этап, где
 * за бой (ядро, как в игре) случается нужное событие — отход стрелка, перехват стража, провокация, связь крестоносца, фаза
 * босса со свитой. Печатает JSON: [{ name, stageId, event, save }].
 *   npx tsx scripts/behavior-save.ts > /tmp/behavior.json
 *   npx tsx scripts/behavior-save.ts круг,аура,трус > /tmp/behavior2.json
 */
import { addHeroCard, maxLevelOf, newGame, placeInSquad, playStage, rarityForLevel, serialize, type BattleEvent, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const ctx = loadFullContext();
/** Сцена: имя, отряд (шаблон/ветка), уровень, этапы-кандидаты, какое событие ищем. */
const SCENES: { name: string; cards: string[]; level: number; stages: string[]; want: (e: BattleEvent) => boolean }[] = [
  { name: 'кайт', cards: ['alan/knight', 'iris/knight', 'bran/hunter', 'meilin/hunter', 'vika/priest'], level: 40, stages: ['ch4_s13', 'ch4_s12', 'ch5_s12', 'ch4_s18', 'ch3_s12'], want: (e) => e.type === 'move' && e.reason === 'kite' },
  { name: 'страж', cards: ['alan/knight', 'vika/monk', 'bran/hunter', 'kai/wizard', 'lira/sage'], level: 40, stages: ['ch3_s10', 'ch3_s18', 'ch8_s15', 'ch4_s13', 'ch1_s10'], want: (e) => e.type === 'move' && e.reason === 'intercept' },
  { name: 'провокация', cards: ['alan/knight', 'iris/knight', 'bran/hunter', 'kai/wizard', 'vika/priest'], level: 40, stages: ['ch4_s10', 'ch4_s13', 'ch5_s10', 'ch3_s10'], want: (e) => e.type === 'status' && !!e.taunt },
  { name: 'связь', cards: ['alan/crusader', 'iris/knight', 'bran/hunter', 'kai/wizard', 'vika/priest'], level: 40, stages: ['ch4_s10', 'ch4_s13', 'ch5_s10', 'ch3_s10'], want: (e) => e.type === 'link' && e.action === 'apply' },
  { name: 'фаза', cards: ['alan/knight', 'iris/knight', 'bran/hunter', 'kai/wizard', 'vika/priest'], level: 20, stages: ['ch1_s10', 'ch2_s10', 'ch3_s10'], want: (e) => e.type === 'spawn' },
  // Шаги 4–5: круг мага на земле, аура барда и танцовщицы, трус убегает (после баннера начала боя — t ≥ 4).
  { name: 'круг', cards: ['alan/knight', 'vika/priest', 'kai/wizard', 'kai', 'lira/wizard'], level: 60, stages: ['ch4_s13', 'ch5_s12', 'ch6_s4', 'ch4_s18'], want: (e) => e.type === 'cast' && !!e.at && e.t >= 4 },
  { name: 'аура', cards: ['alan/knight', 'vika/priest', 'bran/bard', 'kai/wizard', 'meilin/dancer'], level: 60, stages: ['ch4_s13', 'ch5_s12', 'ch4_s18'], want: (e) => e.type === 'status' && e.action === 'refresh' && e.t >= 5 },
  { name: 'трус', cards: ['alan/knight', 'iris/knight', 'bran/hunter', 'kai/wizard', 'vika/priest'], level: 20, stages: ['ch2_s7', 'ch2_s17', 'ch2_s18', 'ch2_s5'], want: (e) => e.type === 'move' && e.reason === 'flee' && e.t >= 4 },
];
/** Только названные сцены (аргументы через запятую), без аргумента — все. */
const only = process.argv[2]?.split(',');
const stageSeed = (save: SaveState) => (save.createdAt ^ Math.imul(save.battleSeq + 1, 0x9e3779b1)) >>> 0;
const out: { name: string; stageId: string; event: string; save: string }[] = [];

for (const sc of SCENES.filter((x) => !only || only.includes(x.name))) {
  const base = newGame(ctx, 1_700_000_000_000);
  let save: SaveState = { ...base, heroes: [], squad: [null, null, null, null, null], campaign: { ...base.campaign, cleared: ctx.content.stages.map((s) => s.id) } };
  for (const card of sc.cards) {
    const [t, branch] = card.split('/');
    const rarity = rarityForLevel(ctx, sc.level, 'purple');
    const r = addHeroCard(save, t, rarity, { level: Math.min(sc.level, maxLevelOf(ctx, rarity)) });
    const hero = branch ? { ...r.hero, branch } : r.hero;
    save = { ...r.save, heroes: r.save.heroes.map((h) => (h.id === hero.id ? hero : h)) };
    save = { ...save, squad: placeInSquad(save.squad, hero, save, ctx) };
  }
  let found: { stageId: string; seq: number; t: number } | null = null;
  for (let seq = 0; seq < 12 && !found; seq++)
    for (const stageId of sc.stages) {
      const s = { ...save, battleSeq: seq };
      const e = playStage(s, stageId, stageSeed(s), ctx).result.log.find(sc.want);
      if (e) {
        found = { stageId, seq, t: e.t };
        break;
      }
    }
  if (!found) {
    process.stderr.write(`${sc.name}: события нет\n`);
    continue;
  }
  process.stderr.write(`${sc.name}: ${found.stageId}, попытка ${found.seq}, t=${found.t}\n`);
  out.push({ name: sc.name, stageId: found.stageId, event: sc.name, save: serialize({ ...save, battleSeq: found.seq }) });
}
process.stdout.write(JSON.stringify(out));
