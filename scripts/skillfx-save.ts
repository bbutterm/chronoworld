/**
 * Сохранения для просмотра эффектов навыков героев в бою (docs/content/skills-vfx.md, scripts/skillfx-shots.mjs):
 * отряды фиолетовых карточек со всеми ветками (24 формы) и базовых форм (12), все этапы пройдены — любой этап открыт.
 *   npx tsx scripts/skillfx-save.ts > /tmp/squads.json
 * Для каждого отряда подбирает этап главы 3 и seed, где за бой срабатывает больше всего навыков отряда (ядро, как в игре),
 * и печатает JSON: [{ name, stageId, seed, save }] (save — сериализованное сохранение, seed — stageSeed этого сохранения).
 */
import { addHeroCard, maxLevelOf, newGame, placeInSquad, playStage, rarityForLevel, serialize, type SaveState } from '../src/core';
import { heroSkillList } from '../src/core/heroes/card';
import { loadFullContext } from './lib/content-node';

const ctx = loadFullContext();
const SQUADS: [string, string[]][] = [
  ['ветки-1', ['alan/knight', 'iris/crusader', 'bran/hunter', 'kai/wizard', 'vika/priest']],
  ['ветки-2', ['alan/crusader', 'iris/knight', 'meilin/dancer', 'lira/sage', 'teo/monk']],
  ['ветки-3', ['dorn/assassin', 'zara/rogue', 'greta/blacksmith', 'otto/alchemist', 'bran/bard']],
  ['ветки-4', ['dorn/rogue', 'zara/assassin', 'greta/alchemist', 'otto/blacksmith', 'meilin/hunter']],
  ['ветки-5', ['kai/sage', 'lira/wizard', 'teo/priest', 'vika/monk', 'alan/knight']],
  ['база-1', ['alan', 'iris', 'bran', 'kai', 'vika']],
  ['база-2', ['dorn', 'zara', 'greta', 'otto', 'teo']],
  ['база-3', ['meilin', 'lira', 'alan', 'bran', 'kai']],
];
const LEVEL = Number(process.argv[2] ?? 60);
/** Как src/game/flow.ts stageSeed (без Phaser): seed боя этапа из сохранения. */
const stageSeed = (save: SaveState) => (save.createdAt ^ Math.imul(save.battleSeq + 1, 0x9e3779b1)) >>> 0;
const stages = ctx.content.stages;
const out: { name: string; stageId: string; seed: number; coverage: string; save: string }[] = [];

for (const [name, cards] of SQUADS) {
  const base = newGame(ctx, 1_700_000_000_000);
  let save: SaveState = { ...base, heroes: [], squad: [null, null, null, null, null], campaign: { ...base.campaign, cleared: stages.map((s) => s.id) } };
  for (const card of cards) {
    const [t, branch] = card.split('/');
    // Базовая форма — фиолетовая карточка без выбранной ветки (в бою — форма первой профессии, открыты все 4 навыка).
    const rarity = rarityForLevel(ctx, LEVEL, 'purple');
    const lv = Math.min(LEVEL, maxLevelOf(ctx, rarity));
    const r = addHeroCard(save, t, rarity, { level: lv });
    const hero = branch ? { ...r.hero, branch } : r.hero;
    save = { ...r.save, heroes: r.save.heroes.map((h) => (h.id === hero.id ? hero : h)) };
    save = { ...save, squad: placeInSquad(save.squad, hero, save, ctx) };
  }
  const want = new Set(save.heroes.flatMap((h) => heroSkillList(h, ctx).filter((s) => s.unlocked).map((s) => `${h.id}:${s.skill}`)));
  let best = { stageId: '', score: -1, used: 0, seq: 0 };
  for (let seq = 0; seq < 3; seq++)
  for (const st of stages.filter((s) => s.chapter === 'chapter3' || s.chapter === 'chapter2')) {
    const res = playStage({ ...save, battleSeq: seq }, st.id, stageSeed({ ...save, battleSeq: seq }), ctx).result;
    const uid = new Map(res.units.map((u) => [u.uid, u.unitId]));
    const used = new Set<string>();
    for (const e of res.log) {
      if ((e.type === 'attack' || e.type === 'passive') && want.has(`${uid.get(e.unit)}:${e.skill}`)) used.add(`${uid.get(e.unit)}:${e.skill}`);
    }
    const score = used.size * 1000 + Math.min(res.duration, 60);
    if (score > best.score) best = { stageId: st.id, score, used: used.size, seq };
  }
  save = { ...save, battleSeq: best.seq };
  const seed = stageSeed(save);
  process.stderr.write(`${name}: ${best.stageId}, навыков ${best.used}/${want.size}\n`);
  out.push({ name, stageId: best.stageId, seed, coverage: `${best.used}/${want.size}`, save: serialize(save) });
}
process.stdout.write(JSON.stringify(out));
