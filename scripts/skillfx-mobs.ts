/**
 * Сохранения для просмотра атласов RO на навыках монстров и боссов (docs/content/skills-vfx.md, аудит эффектов):
 * для каждого навыка монстра с атласом (assets/effects/effects.json → skills) ищет этап кампании, уровень отряда и
 * номер боя, где монстр применяет навык (ядро, как в игре), и жадно покрывает все такие навыки несколькими боями.
 *   npx tsx scripts/skillfx-mobs.ts > /tmp/mobs.json
 *   SHOTS_SIDES=B SHOTS_ATLAS=1 SHOTS_SIZE=390x844 node scripts/skillfx-shots.mjs /tmp/mobs.json <папка>
 * Формат вывода — как у scripts/skillfx-save.ts: [{ name, stageId, seed, save }]. Навыки вне кампании (лабиринт,
 * башня) печатаются в stderr «не найден».
 */
import { readFileSync } from 'node:fs';
import { addHeroCard, enemySquad, maxLevelOf, newGame, placeInSquad, playStage, rarityForLevel, serialize, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const ctx = loadFullContext();
const fx = JSON.parse(readFileSync('assets/effects/effects.json', 'utf8')) as { skills: Record<string, unknown> };
const heroSkills = new Set(Object.values(ctx.content.skills).filter((s) => s.id.startsWith('job_')).map((s) => s.id));
const want = new Set(Object.keys(fx.skills).filter((id) => !heroSkills.has(id) && !['swordman_bash', 'swordman_endure'].includes(id)));
const stageSeed = (save: SaveState) => (save.createdAt ^ Math.imul(save.battleSeq + 1, 0x9e3779b1)) >>> 0;
const CARDS = ['alan', 'iris', 'bran', 'kai', 'vika'];

function squadSave(level: number, seq: number): SaveState {
  const base = newGame(ctx, 1_700_000_000_000);
  let save: SaveState = { ...base, heroes: [], squad: [null, null, null, null, null], campaign: { ...base.campaign, cleared: ctx.content.stages.map((s) => s.id) } };
  for (const t of CARDS) {
    const rarity = rarityForLevel(ctx, level, 'purple');
    const r = addHeroCard(save, t, rarity, { level: Math.min(level, maxLevelOf(ctx, rarity)) });
    save = { ...r.save, squad: placeInSquad(r.save.squad, r.hero, r.save, ctx) };
  }
  return { ...save, battleSeq: seq };
}

type Run = { stageId: string; save: SaveState; used: Set<string> };
const runs: Run[] = [];
for (const st of ctx.content.stages) {
  const mobs = enemySquad(st.id, ctx).filter((u) => !!u);
  const has = new Set(mobs.flatMap((u) => [u!.skills.basic, u!.skills.ult, ...(u!.skills.actives ?? []), ...(u!.skills.passives ?? [])]).filter((s) => s && want.has(s)) as string[]);
  if (!has.size) continue;
  for (const level of [30, 60, 90]) {
    for (let seq = 0; seq < 3; seq++) {
      const save = squadSave(level, seq);
      const res = playStage(save, st.id, stageSeed(save), ctx).result;
      const side = new Map(res.units.map((u) => [u.uid, u.side]));
      const used = new Set<string>();
      for (const e of res.log) if ((e.type === 'attack' || e.type === 'ult' || e.type === 'passive') && side.get(e.unit) === 'B' && want.has(e.skill)) used.add(e.skill);
      if (used.size) runs.push({ stageId: st.id, save, used });
    }
  }
}
const left = new Set(want);
const out: { name: string; stageId: string; seed: number; save: string }[] = [];
while (left.size) {
  let best: Run | undefined;
  let score = 0;
  for (const r of runs) {
    const n = [...r.used].filter((s) => left.has(s)).length;
    if (n > score) (best = r), (score = n);
  }
  if (!best) break;
  for (const s of best.used) left.delete(s);
  process.stderr.write(`${best.stageId}: ${[...best.used].join(', ')}\n`);
  out.push({ name: `монстры-${best.stageId}`, stageId: best.stageId, seed: stageSeed(best.save), save: serialize(best.save) });
}
for (const s of left) process.stderr.write(`не найден в кампании: ${s}\n`);
process.stdout.write(JSON.stringify(out));
