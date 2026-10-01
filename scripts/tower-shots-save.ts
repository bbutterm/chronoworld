/**
 * Сохранения для кадров экрана Башни (docs/design/tower-roguelite.md): игрок середины главы 3 — лобби, забег с ранами
 * и картами, выбор карты, событие, бой с картами. Вывод — JSON { имя: сохранение } в stdout.
 *   npx tsx scripts/tower-shots-save.ts > /tmp/tower-saves.json
 */
import { chooseTowerPath, fightTowerFloor, runConfig, serialize, startTowerRun, type SaveState } from '../src/core';
import { playerSave, TOWER_SQUADS } from './balance-tower';
import { loadFullContext } from './lib/content-node';

const ctx = loadFullContext();
const cfg = runConfig(ctx);
const base = playerSave(ctx, 3, TOWER_SQUADS[0], 3);
const clean = (s: SaveState): string => {
  const o = JSON.parse(serialize(s));
  delete o.seenUnlocks; // все открытия — показаны (без баннеров)
  o.seenScenes = ctx.story.scenes.map((x) => x.id);
  return JSON.stringify(o);
};

const lobby = { ...base, tower: { ...base.tower, floor: 9, shards: 23, runs: 2, upgrades: { start_card: 1 } } };
let run = startTowerRun(lobby, lobby.squad, ctx);
const r = run.tower.run!;
const ids = r.squad.filter((x): x is string => !!x);
const mid: SaveState = {
  ...run,
  tower: {
    ...run.tower,
    run: {
      ...r,
      floor: 5,
      shards: 6,
      pending: undefined,
      cards: ['pupa', 'poring', 'deviruchi', 'marin'],
      squad: [ids[0], ids[1], ids[2], ids[3], null],
      fallen: [ids[4]],
      hp: { [ids[0]]: 820, [ids[1]]: 460, [ids[2]]: 1000, [ids[3]]: 230 },
      paths: ['elite', 'event'],
      note: 'Привал у костра: отряд перевязал раны.',
    },
  },
};
const bless: SaveState = { ...mid, tower: { ...mid.tower, run: { ...mid.tower.run!, pending: { kind: 'blessing', options: ['osiris', 'high_orc', 'baphomet_jr'], source: 'elite', rolls: 0 } } } };
const event: SaveState = { ...mid, tower: { ...mid.tower, run: { ...mid.tower.run!, pending: { kind: 'event', event: 'altar' } } } };
const mimic: SaveState = { ...mid, tower: { ...mid.tower, run: { ...mid.tower.run!, pending: { kind: 'event', event: 'mimic' } } } };
const battle = chooseTowerPath(mid, 0, ctx);
// Итог забега (окно summary).
run = { ...mid, tower: { ...mid.tower, run: { ...mid.tower.run!, node: 'battle' } } };
const lost = fightTowerFloor({ ...run, tower: { ...run.tower, run: { ...run.tower.run!, tier: 10 } } }, '2026-10-01', { ...ctx, tower: { ...ctx.tower, run: { ...cfg, tierMult: cfg.tierMult.map(() => 1000) } } }).save;
process.stdout.write(JSON.stringify({ lobby: clean(lobby), run: clean(mid), bless: clean(bless), event: clean(event), mimic: clean(mimic), battle: clean(battle), summary: clean(lost) }));
