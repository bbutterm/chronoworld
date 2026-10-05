/**
 * Read-only аудит фактического порядка, уровней и ориентиров кампании.
 * npx tsx scripts/campaign-hints-audit.ts --out-prefix /tmp/campaign-hints
 * Пишет -current.csv и -proposals.json. До/после двух правок сравнивается в памяти;
 * уровни вычислены stageLevels, не являются механическим уровнем монстра.
 * Используются default campaign choices; состав/скиллы важнее монотонного числа.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}
const root = resolve(arg('source') ?? resolve(import.meta.dirname, '..'));
const out = resolve(arg('out-prefix') ?? '/tmp/chronoworld-campaign-hints');
function digest(): string {
  const files = ['src/core/features/power.ts', 'src/core/features/levels.ts'];
  function visit(dir: string) {
    for (const e of readdirSync(resolve(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) visit(p);
      else if (e.isFile() && p.endsWith('.json')) files.push(p);
    }
  }
  visit('data');
  return createHash('sha256').update(files.map(p => `${p}\0${readFileSync(resolve(root, p), 'utf8')}\0`).join('')).digest('hex');
}
const sourceDigest = digest();
const core = await import(pathToFileURL(resolve(root, 'src/core/index.ts')).href) as typeof import('../src/core');
const node = await import(pathToFileURL(resolve(root, 'scripts/lib/content-node.ts')).href) as typeof import('./lib/content-node');
const ctx = node.loadFullContext();
const rows = ctx.content.stages.map((stage, i) => {
  const enemies = core.enemySquad(stage.id, ctx);
  const levels = core.stageLevels(stage.id, ctx);
  const hints = new Set<string>();
  const skills = enemies.flatMap(u => u ? [u.skills.basic, u.skills.ult, ...u.skills.actives, ...u.skills.passives]
    .flatMap(id => id && ctx.content.skills[id] ? [ctx.content.skills[id]] : []) : []);
  const hasHeals = skills.some(s => s.effects.some(e => e.type === 'heal'));
  const healsOthers = enemies.some(u => u?.role === 'healer') || skills.some(s =>
    s.target.side === 'ally' && s.target.pick !== 'self' && s.effects.some(e => e.type === 'heal'));
  if (healsOthers) hints.add('давление на лекаря/контроль лечения');
  else if (hasHeals) hints.add('устойчивый урон против самолечения');
  if (enemies.some(u => u?.role === 'tank')) hints.add('устойчивый урон по защищённым целям');
  if (enemies.filter(Boolean).length >= 4) hints.add('AoE против группы');
  if (enemies.some(u => u?.charge)) hints.add('сохранить контрольную ульту для заряда');
  if (enemies.filter(u => u && ctx.content.skills[u.skills.basic]?.range === 'ranged' && u.role !== 'healer').length >= 2)
    hints.add('защита своего тыла/доступ к дальним целям');
  const previous = ctx.content.stages[i - 1];
  const previousRecommended = previous?.chapter === stage.chapter ? core.recommendedPower(previous.id, ctx) : null;
  const recommended = core.recommendedPower(stage.id, ctx);
  return {
    chapter: stage.chapter, order: stage.index + 1, id: stage.id, name: stage.name, stageBoss: stage.boss,
    enemyPower: core.stagePower(stage.id, ctx), factor: core.recommendedFactor(stage.id, ctx), recommended,
    recommendedLevel: levels.recommended.level, recommendedRarity: levels.recommended.rarity,
    enemyLevels: enemies.flatMap((u, j) => u ? [`${u.name}:${levels.enemies[j]}`] : []).join('; '),
    enemyRoles: enemies.flatMap(u => u ? [u.role] : []).join('; '), expectedRoles: [...hints].join('; '),
    previous: previous?.chapter === stage.chapter ? previous.id : null, previousRecommended,
    change: previousRecommended !== null ? recommended / previousRecommended - 1 : null,
  };
});

const introduction = ctx.content.stages.find(s => s.id === 'ch1_s4');
const introEnemy = introduction?.enemies[2];
if (!introEnemy || !['mob_poporing', 'mob_tank'].includes(introEnemy.unit) || introEnemy.mult !== 0.9818)
  throw new Error('ch1_s4 отличается от проверяемого локального изменения');
const baseline = { ...ctx, content: { ...ctx.content, stages: ctx.content.stages.map(s => s.id === 'ch1_s4'
  ? { ...s, enemies: s.enemies.map((e, j) => j === 2 && e ? { ...e, unit: 'mob_poporing' } : e) } : s) },
  features: { ...ctx.features, power: { ...ctx.features.power,
    recommendedStages: { ...ctx.features.power.recommendedStages, ch9_s10: 0.3593 } } } };
const candidate = { ...ctx, content: { ...ctx.content, stages: ctx.content.stages.map(s => s.id === 'ch1_s4'
  ? { ...s, enemies: s.enemies.map((e, j) => j === 2 && e ? { ...e, unit: 'mob_tank' } : e) } : s) } };
const firstOrder = (unit: string) => candidate.content.stages.filter(s => s.chapter === 'chapter1')
  .find(s => s.enemies.some(e => e?.unit === unit))?.index;
const ch9Power = core.stagePower('ch9_s10', ctx);
const roundedFactor = Math.round(26000 / ch9Power * 10000) / 10000;
const factorContext = { ...ctx, features: { ...ctx.features, power: { ...ctx.features.power,
  recommendedStages: { ...ctx.features.power.recommendedStages, ch9_s10: roundedFactor } } } };
const proposals = {
  sourceDigest, timeLimitSeconds: ctx.combat.timeLimitSeconds, dataChanged: false, defaultCampaignChoices: true,
  baselineReconstructedInMemory: ['ch1_s4/enemies/2/unit=mob_poporing', 'power/recommendedStages/ch9_s10=.3593'],
  withinChapterDropsGreaterThan10Percent: rows.filter(r => r.change !== null && r.change < -0.1).length,
  ch1Candidate: {
    applied: introEnemy.unit === 'mob_tank', id: 'ch1_s4', slot: 2, oldUnit: 'mob_poporing', newUnit: 'mob_tank', mult: introEnemy.mult,
    oldEnemy: core.enemySquad('ch1_s4', baseline)[2]!.stats, newEnemy: core.enemySquad('ch1_s4', candidate)[2]!.stats,
    oldPower: core.stagePower('ch1_s4', baseline), newPower: core.stagePower('ch1_s4', candidate),
    oldRecommended: core.recommendedPower('ch1_s4', baseline), newRecommended: core.recommendedPower('ch1_s4', candidate),
    oldLevels: core.stageLevels('ch1_s4', baseline), newLevels: core.stageLevels('ch1_s4', candidate),
    newFirstWillowOrder: firstOrder('mob_tank')! + 1, newFirstPoporingOrder: firstOrder('mob_poporing')! + 1,
  },
  ch9Fit: {
    applied: core.recommendedFactor('ch9_s10', ctx) === roundedFactor, factor: 26000 / ch9Power, roundedFactor,
    oldRecommended: core.recommendedPower('ch9_s10', baseline), newRecommended: core.recommendedPower('ch9_s10', factorContext),
    oldLevels: core.stageLevels('ch9_s10', baseline), newLevels: core.stageLevels('ch9_s10', factorContext),
  },
};
if (digest() !== sourceDigest) throw new Error('Данные менялись во время аудита; результат не сохранён');
const columns = ['chapter', 'order', 'id', 'name', 'stageBoss', 'enemyPower', 'factor', 'recommended',
  'recommendedLevel', 'recommendedRarity', 'enemyLevels', 'enemyRoles', 'expectedRoles', 'previous', 'previousRecommended', 'change'];
const line = (values: unknown[]) => values.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}-current.csv`, [line(columns), ...rows.map(r => line(columns.map(k =>
  (r as unknown as Record<string, unknown>)[k])))].join('\n') + '\n');
writeFileSync(`${out}-proposals.json`, JSON.stringify(proposals, null, 2) + '\n');
console.log(JSON.stringify({ out, stages: rows.length, drops: proposals.withinChapterDropsGreaterThan10Percent,
  ch1Candidate: proposals.ch1Candidate, ch9Fit: proposals.ch9Fit }));
