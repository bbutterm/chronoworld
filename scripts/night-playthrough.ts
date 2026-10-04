/** Полная QA-кампания: легальные действия, реальные проигрыши, ожидание ровно +12 часов на стене. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  actPlayStage, featureUnlocked, heroPower, levelUpInfo, recommendedPower, serialize,
  setSquad, squadPower, type BattleResult, type FullContext, type SaveState,
} from '../src/core';
import { loadFullContext, nextOpenStage } from './lib/player-model';
import { NIGHT_MODEL, NightPlayer } from './lib/night-player';

export interface NightAttempt {
  stage: string;
  attempt: number;
  seed: number;
  phase: 'normal' | 'boost' | 'side_modes' | 'candidate' | 'candidate_retry';
  winner: BattleResult['winner'];
  reason: BattleResult['reason'];
  duration: number;
  ults: { A: number; B: number; firstA: number | null };
  hours: number;
  activeMinutes: number;
  power: number;
  recommended: number;
  ratio: number;
  remainingEnemyHp: number;
  resources: { gold: number; exp: number; gems: number; scrolls: number };
  squad: string[];
}

export interface NightStage {
  stage: string;
  chapter: string;
  firstHour: number;
  clearedHour?: number;
  attempts: number;
  waits: number;
  power?: number;
  recommended?: number;
  ratio?: number;
  seed?: number;
  squad?: string[];
}

export interface NightWall {
  stage: string;
  hour: number;
  waitNumber: number;
  willWait: boolean;
  power: number;
  recommended: number;
  blockers: Record<string, number>;
  resources: { gold: number; exp: number; gems: number; scrolls: number };
}

export interface NightOptions {
  seedBase?: number;
  maxWaits?: number;
  maxStages?: number;
  /** Контрольный профиль: тратить гемы на все быстрые награды даже при полном пределе редкости. */
  naiveMaxFarm?: boolean;
  /** Отдельный профиль: редкость свободной копии передаётся исходному спутнику через новый API. */
  preserveCompanions?: boolean;
  onAttempt?: (attempt: NightAttempt, before: SaveState, enteredAt: number) => void;
  onWall?: (wall: NightWall, save: SaveState, now: number) => void;
  onStage?: (stage: NightStage, save: SaveState, now: number) => void;
}

export interface NightResult {
  status: 'complete' | 'wait_limit' | 'stage_limit';
  seedBase: number;
  cleared: number;
  campaignStages: number;
  elapsedHours: number;
  activeMinutes: number;
  totalWaits: number;
  attempts: NightAttempt[];
  stages: NightStage[];
  walls: NightWall[];
  actions: NightPlayer['actions'];
  income: NightPlayer['income'];
  spend: NightPlayer['spend'];
  save: SaveState;
  now: number;
  development: {
    summons: number; ascensions: number; levelUps: number; branchChoices: number; equips: number;
    refines: number; refineFailures: number; shopBuys: Record<string, number>;
  };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const resources = (save: SaveState) => ({ gold: save.resources.gold, exp: save.resources.heroExp, gems: save.currency.gems, scrolls: save.currency.scrolls });
const squadLabel = (save: SaveState): string[] => save.squad.map((id) => {
  const hero = save.heroes.find((h) => h.id === id);
  return hero ? `${hero.id}:${hero.templateId}:${hero.rarity}:${hero.level}:${hero.branch ?? 'tier1'}:${hero.journey?.focus ?? '-'}` : '-';
});

/** Решения игрока — эвристика с конечным бюджетом поиска; выдач или результатов боя эта функция не подменяет. */
export function runNightCampaign(ctx: FullContext, options: NightOptions = {}): NightResult {
  const player = new NightPlayer(ctx, {
    ...NIGHT_MODEL, seedBase: options.seedBase ?? 1,
    ...(options.naiveMaxFarm ? { shopExpWhenCapped: true } : {}),
  }, options.naiveMaxFarm, options.preserveCompanions);
  const maxWaits = options.maxWaits ?? 180;
  const maxStages = options.maxStages ?? ctx.content.stages.length;
  const attempts: NightAttempt[] = [];
  const stages = new Map<string, NightStage>();
  const walls: NightWall[] = [];
  let waits = 0;
  let status: NightResult['status'] = 'complete';

  const fight = (stageId: string, phase: NightAttempt['phase']): { won: boolean; score: number } => {
    const stage = ctx.content.stages.find((s) => s.id === stageId)!;
    const row = stages.get(stageId) ?? { stage: stageId, chapter: stage.chapter, firstHour: round(player.t), attempts: 0, waits: 0 };
    stages.set(stageId, row);
    const before = player.save;
    const enteredAt = player.now;
    const power = squadPower(before, ctx);
    const recommended = recommendedPower(stageId, ctx, before.campaignChoices);
    const seed = player.model.seedBase + before.battleSeq;
    const out = actPlayStage(before, player.day, stageId, seed, ctx, player.now);
    const ratio = power / Math.max(1, recommended);
    const battleSpeed = featureUnlocked(before, 'speed_x2', ctx) ? 2 : 1;
    player.spendTime(out.result.duration / battleSpeed * 1000 + player.model.battleOverheadSec * 1000);
    player.step('campaign', out.save);
    const enemies = [...out.result.units, ...(out.result.spawned ?? [])].filter((u) => u.side === 'B');
    const finalHp = new Map(enemies.map((u) => [u.uid, u.hp ?? u.maxHp]));
    for (const event of out.result.log) {
      if ((event.type === 'damage' || event.type === 'heal') && finalHp.has(event.target)) finalHp.set(event.target, event.hp);
    }
    const remainingEnemyHp = enemies.reduce((n, u) => n + Math.max(0, finalHp.get(u.uid) ?? 0), 0) / Math.max(1, enemies.reduce((n, u) => n + u.maxHp, 0));
    const attempt: NightAttempt = {
      stage: stageId, attempt: ++row.attempts, seed, phase,
      winner: out.result.winner, reason: out.result.reason, duration: round(out.result.duration), hours: round(player.t),
      ults: {
        A: Object.values(out.result.report).filter((unit) => unit.uid.startsWith('A')).reduce((n, unit) => n + unit.ults, 0),
        B: Object.values(out.result.report).filter((unit) => unit.uid.startsWith('B')).reduce((n, unit) => n + unit.ults, 0),
        firstA: out.result.log.find((event) => event.type === 'ult' && event.unit.startsWith('A'))?.t ?? null,
      },
      activeMinutes: player.activeMin, power, recommended, ratio: round(ratio),
      remainingEnemyHp: round(remainingEnemyHp), resources: resources(before), squad: squadLabel(before),
    };
    attempts.push(attempt);
    options.onAttempt?.(attempt, before, enteredAt);
    if (out.result.winner === 'A') {
      row.clearedHour = round(player.t);
      row.power = power;
      row.recommended = recommended;
      row.ratio = round(ratio);
      row.seed = seed;
      row.squad = squadLabel(before);
      player.claimRewards();
      player.prepare();
      options.onStage?.(row, player.save, player.now);
      return { won: true, score: 1 };
    }
    return { won: false, score: 1 - remainingEnemyHp };
  };

  player.claimRewards();
  player.prepare();
  while (player.save.campaign.cleared.length < maxStages) {
    const stageId = nextOpenStage(player.save, ctx);
    if (!stageId) break;
    if (fight(stageId, 'normal').won) continue;

    player.claimOffline();
    player.fastRewards();
    player.claimRewards();
    player.prepare();
    if (fight(stageId, 'boost').won) continue;

    player.sideModes();
    player.farmReplays();
    if (fight(stageId, 'side_modes').won) continue;
    const original = [...player.save.squad];
    let best = { squad: original, score: 0, power: squadPower(player.save, ctx) };
    let succeeded = false;
    for (const candidate of player.candidateSquads()) {
      player.applyCandidate(candidate);
      const tested = fight(stageId, 'candidate');
      if (tested.won) { succeeded = true; break; }
      const power = squadPower(player.save, ctx);
      if (tested.score > best.score || (tested.score === best.score && power > best.power)) best = { squad: [...player.save.squad], score: tested.score, power };
      if (tested.score >= 0.85 && fight(stageId, 'candidate_retry').won) { succeeded = true; break; }
    }
    if (succeeded) continue;
    player.applyCandidate(best.squad);
    player.save = setSquad(player.save, best.squad);

    const blockers: Record<string, number> = {};
    for (const id of player.save.squad) {
      if (!id) continue;
      const blocker = levelUpInfo(player.save, id, ctx).blocker ?? 'can_level';
      blockers[blocker] = (blockers[blocker] ?? 0) + 1;
    }
    const wall: NightWall = {
      stage: stageId, hour: round(player.t), waitNumber: waits + 1,
      willWait: waits < maxWaits,
      power: squadPower(player.save, ctx), recommended: recommendedPower(stageId, ctx, player.save.campaignChoices),
      blockers, resources: resources(player.save),
    };
    walls.push(wall);
    options.onWall?.(wall, player.save, player.now);
    if (waits >= maxWaits) { status = 'wait_limit'; break; }
    stages.get(stageId)!.waits++;
    waits++;
    player.advanceTwelveHours();
  }
  if (status === 'complete' && player.save.campaign.cleared.length < ctx.content.stages.length) status = 'stage_limit';
  return {
    status, seedBase: player.model.seedBase, cleared: player.save.campaign.cleared.length,
    campaignStages: ctx.content.stages.length, elapsedHours: round(player.t), activeMinutes: player.activeMin,
    totalWaits: waits, attempts, stages: [...stages.values()], walls, actions: player.actions,
    income: player.income, spend: player.spend, save: player.save, now: player.now,
    development: {
      summons: player.summons, ascensions: player.ascensions.length,
      levelUps: player.levels.length + player.candidateLevelUps, branchChoices: player.branches.length,
      equips: player.equips, refines: player.refines, refineFailures: player.refineFailures, shopBuys: player.shopBuys,
    },
  };
}

function numericArgument(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isSafeInteger(n) || n < 0 || (name === '--seed' && n < 1)) throw new Error(`${name}: нужен целый неотрицательный параметр`);
  return n;
}

function main(): void {
  const args = process.argv.slice(2);
  const root = process.cwd();
  const outIndex = args.indexOf('--out');
  const out = resolve(outIndex >= 0 ? args[outIndex + 1] : '/tmp/chronoworld-night-campaign');
  mkdirSync(resolve(out, 'saves'), { recursive: true });
  const ctx = loadFullContext();
  const sourceFiles = (directory: string): string[] => readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory + '/' + entry.name;
    return entry.isDirectory() ? sourceFiles(path) : entry.isFile() ? [path] : [];
  });
  const metadata = {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scriptSha256: createHash('sha256').update(readFileSync(resolve(root, 'scripts/night-playthrough.ts'))).update(readFileSync(resolve(root, 'scripts/lib/night-player.ts'))).digest('hex'),
    sourceSha256: createHash('sha256').update([...sourceFiles('src/core'), ...sourceFiles('data'), 'scripts/lib/player-model.ts', 'scripts/lib/tower-player.ts', 'scripts/lib/content-node.ts'].sort().map((path) => `${path}:${createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')}`).join('\n')).digest('hex'),
    seedBase: numericArgument(args, '--seed', 1),
    maxWaits: numericArgument(args, '--max-waits', 180),
    maxStages: numericArgument(args, '--max-stages', ctx.content.stages.length),
    naiveMaxFarm: args.includes('--naive-max-farm'),
    preserveCompanions: args.includes('--preserve-companions'),
    waitHours: 12,
    artificialResources: false,
  };
  writeFileSync(resolve(out, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  writeFileSync(resolve(out, 'attempts.jsonl'), '');
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  const seenWalls = new Set<string>();
  const result = runNightCampaign(ctx, {
    ...metadata,
    onAttempt(attempt, before, enteredAt) {
      appendFileSync(resolve(out, 'attempts.jsonl'), JSON.stringify(attempt) + '\n');
      if (attempt.winner === 'A') {
        writeFileSync(resolve(out, 'saves', `before-first-win-${attempt.stage}.json`), serialize(before));
        writeFileSync(resolve(out, 'saves', `before-first-win-${attempt.stage}.clock.json`), JSON.stringify({ now: enteredAt, day: new Date(enteredAt).toISOString().slice(0, 10), seed: attempt.seed, stage: attempt.stage }));
      }
    },
    onWall(wall, save, now) {
      writeFileSync(resolve(out, 'checkpoint-save.json'), serialize(save));
      writeFileSync(resolve(out, 'checkpoint-clock.json'), JSON.stringify({ now, day: new Date(now).toISOString().slice(0, 10), stage: wall.stage, waitNumber: wall.waitNumber }));
      if (!seenWalls.has(wall.stage)) {
        seenWalls.add(wall.stage);
        writeFileSync(resolve(out, 'saves', `before-wall-${wall.stage}.json`), serialize(save));
        writeFileSync(resolve(out, 'saves', `before-wall-${wall.stage}.clock.json`), JSON.stringify({ now, day: new Date(now).toISOString().slice(0, 10) }));
      }
      console.log(`Стена ${wall.stage}: ${wall.power}/${wall.recommended}, ${JSON.stringify(wall.blockers)}, ${wall.willWait ? `ожидание №${wall.waitNumber} +12ч` : 'лимит ожиданий, этап не пройден'}`);
    },
    onStage(stage, save, now) {
      const definition = ctx.content.stages.find((s) => s.id === stage.stage)!;
      if (definition.index === 17 || definition.boss || [8, 36, 90, 150].includes(save.campaign.cleared.length)) {
        writeFileSync(resolve(out, 'saves', `after-${stage.stage}.json`), serialize(save));
        writeFileSync(resolve(out, 'saves', `after-${stage.stage}.clock.json`), JSON.stringify({ now, day: new Date(now).toISOString().slice(0, 10) }));
      }
      if (save.campaign.cleared.length % 18 === 0) console.log(`Глава ${save.campaign.cleared.length / 18}: ${stage.clearedHour}ч, ${save.campaign.cleared.length}/180 этапов`);
    },
  });
  writeFileSync(resolve(out, 'final-save.json'), serialize(result.save));
  writeFileSync(resolve(out, 'final-clock.json'), JSON.stringify({ now: result.now, day: new Date(result.now).toISOString().slice(0, 10) }));
  const cpu = process.cpuUsage(cpuStarted);
  const summary = {
    ...metadata, status: result.status, cleared: result.cleared, campaignStages: result.campaignStages,
    elapsedHours: result.elapsedHours, activeMinutes: result.activeMinutes, totalWaits: result.totalWaits,
    campaignAttempts: result.attempts.length, campaignLosses: result.attempts.filter((a) => a.winner !== 'A').length,
    wallTimeSeconds: round((performance.now() - started) / 1000), cpuTimeSeconds: round((cpu.user + cpu.system) / 1_000_000), stages: result.stages, walls: result.walls,
    actionCounts: Object.fromEntries([...new Set(result.actions.map((a) => a.kind))].map((kind) => [kind, result.actions.filter((a) => a.kind === kind).length])),
    income: result.income, spend: result.spend, finalResources: resources(result.save),
    development: result.development,
    finalSquad: squadLabel(result.save), heroPowers: result.save.squad.flatMap((id) => result.save.heroes.filter((h) => h.id === id).map((hero) => ({ id: hero.id, power: heroPower(hero, ctx, result.save) }))),
  };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  const columns = ['stage', 'chapter', 'firstHour', 'clearedHour', 'attempts', 'waits', 'power', 'recommended', 'ratio', 'seed'] as const;
  writeFileSync(resolve(out, 'stages.csv'), [columns.join(','), ...result.stages.map((s) => columns.map((k) => s[k] ?? '').join(','))].join('\n') + '\n');
  console.log(`${result.status}: ${result.cleared}/${result.campaignStages}, ${result.elapsedHours}ч игры, ${result.totalWaits} ожиданий; ${summary.cpuTimeSeconds}с CPU, ${summary.wallTimeSeconds}с общего времени. Отчёт: ${out}`);
  if (result.status === 'wait_limit') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
