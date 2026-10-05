/**
 * Read-only аудит всех личных advanced-форм через публичные API и чистые UI facts.
 * Не экономическая симуляция и не критерий равенства DPS профессий.
 * npx tsx scripts/current-advanced-audit.ts --source <checkout> --out /tmp/advanced-facts.json
 * Боевая матрица отдельно: npx tsx scripts/class-audit.ts --seeds 1 --source <checkout> --out /tmp/advanced-matrix.json
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
const out = resolve(arg('out') ?? '/tmp/chronoworld-current-advanced-facts.json');
const paths = ['src/core/battle.ts', 'src/core/heroes/card.ts', 'src/game/skillFacts.ts', 'data/combat.json', 'data/cards.json'];
for (const dir of ['data/heroes', 'data/jobs', 'data/skills'])
  for (const name of readdirSync(`${root}/${dir}`).filter(n => n.endsWith('.json')).sort()) paths.push(`${dir}/${name}`);
const fingerprint = () => {
  const hash = createHash('sha256');
  for (const p of paths) hash.update(p).update('\0').update(readFileSync(`${root}/${p}`)).update('\0');
  return hash.digest('hex');
};
const before = fingerprint();
const core = await import(pathToFileURL(`${root}/src/core/index.ts`).href) as typeof import('../src/core');
const { loadFullContext } = await import(pathToFileURL(`${root}/scripts/lib/content-node.ts`).href) as typeof import('./lib/content-node');
const { skillFacts } = await import(pathToFileURL(`${root}/src/game/skillFacts.ts`).href) as typeof import('../src/game/skillFacts');
const ctx = loadFullContext();
const failures: string[] = [];
const check = (ok: unknown, message: string) => { if (!ok) failures.push(message); };
const rows = [];
let factsChecked = 0;
for (const template of Object.values(ctx.content.heroes)) for (const branch of template.branches) {
  const a = branch.advanced;
  check(a, `${template.id}/${branch.job}: no advanced`);
  if (!a) continue;
  const form = `${template.id}/${branch.job}`;
  const gates = [
    ['gold', 69, branch.job], ['gold', 70, a.job], ['gold', 80, a.job],
    ['red', 90, a.job], ['red', 100, a.job], ['purple', 60, branch.job],
  ] as const;
  const mature = [];
  for (const [rarity, level, expectedJob] of gates) {
    const hero = { id: form, templateId: template.id, branch: branch.job, rarity, level };
    const u = core.buildUnit(hero, ctx);
    const active = core.activeForm(template, hero);
    const who = `${form}@${rarity}${level}`;
    check(active.job === expectedJob, `${who}: wrong job`);
    check(u.skills.ult === active.ult, `${who}: wrong ult`);
    check(core.ultSkillOf(u, ctx.content.skills, ctx.combat)?.id === active.ult, `${who}: wrong energy dispatch`);
    check(JSON.stringify(u.energy) === JSON.stringify(ctx.combat.energy.hero), `${who}: wrong energy`);
    const opened = active.skills.filter(s => s.level <= level);
    check(opened.every(s => [...u.skills.actives, ...u.skills.passives].includes(s.skill)), `${who}: missing opened skill`);
    check([...u.skills.actives, ...u.skills.passives].every(id => opened.some(s => s.skill === id)), `${who}: premature skill`);
    check(u.skills.passives.every(id => !!ctx.content.skills[id]?.trigger), `${who}: passive without trigger`);
    check(u.skills.actives.every(id => !ctx.content.skills[id]?.trigger), `${who}: triggered active`);
    check(Object.values(u.stats).every(n => Number.isFinite(n) && n > 0), `${who}: invalid stat`);
    const definitions = [
      { id: u.skills.basic, basic: true, ult: false, passive: false },
      ...u.skills.actives.map(id => ({ id, basic: false, ult: false, passive: false })),
      ...u.skills.passives.map(id => ({ id, basic: false, ult: false, passive: true })),
      { id: u.skills.ult, basic: false, ult: true, passive: false },
    ];
    const described = [];
    for (const def of definitions) {
      check(def.id, `${who}: missing skill id`);
      if (!def.id) continue;
      const s = ctx.content.skills[def.id];
      check(s, `${who}/${def.id}: missing skill`);
      if (!s) continue;
      const power = def.basic ? 1 : u.skillPower ?? 1;
      const facts = skillFacts(s, { ...def, power, defaultCooldown: ctx.combat.skills?.defaultCooldown ?? 8,
        turnSeconds: ctx.combat.statusTurnSeconds ?? 1, nameOf: id => ctx.content.skills[id]?.name });
      check(facts.every(line => !/undefined|NaN/.test(line)), `${who}/${s.id}: invalid UI facts`);
      check(facts.some(line => line.startsWith('Цель: ')), `${who}/${s.id}: no target fact`);
      check(!def.ult || (facts.some(line => line.startsWith('Ульта: ')) && !facts.some(line => line.startsWith('Каст: '))), `${who}/${s.id}: ult timing mismatch`);
      check(!def.ult || facts.some(line => line.startsWith('Сбивает заряд босса: ')) === core.breaksCharge(s), `${who}/${s.id}: charge fact mismatch`);
      for (const e of s.effects) {
        if (e.type === 'damage' || e.type === 'heal') {
          const label = e.type === 'damage' ? 'Урон' : 'Лечение';
          const coefficient = Math.round(e.k * power * 100 + Number.EPSILON * 100);
          check(facts.some(line => line.startsWith(`${label}: ${coefficient}% АТК`)), `${who}/${s.id}: ${label} coefficient mismatch`);
        }
        if (e.type === 'heal') check(s.target.side === 'ally', `${who}/${s.id}: heals enemies`);
        if (e.type === 'damage') check(s.target.side === 'enemy', `${who}/${s.id}: damages allies`);
        if (e.type === 'shield') {
          const coefficient = Math.round(e.pctMaxHp * power * 100 + Number.EPSILON * 100);
          check(facts.some(line => line.startsWith(`Щит: ${coefficient}% макс. ОЗ цели`)), `${who}/${s.id}: shield coefficient mismatch`);
        }
        if (e.type === 'status' && e.status.dot) {
          const coefficient = Math.round(e.status.dot.k * power * 100 + Number.EPSILON * 100);
          check(facts.some(line => line.includes(`урон ${coefficient}% АТК`)), `${who}/${s.id}: DOT coefficient mismatch`);
        }
      }
      factsChecked++;
      described.push({ id: s.id, target: s.target, trigger: s.trigger, facts });
    }
    mature.push({ rarity, level, job: active.job, role: u.role, basic: u.skills.basic, actives: u.skills.actives,
      passives: u.skills.passives, ult: u.skills.ult, breaksCharge: !!u.skills.ult && core.breaksCharge(ctx.content.skills[u.skills.ult]), described });
  }
  rows.push({ form, advanced: a.job, gates: { minLevel: a.minLevel, minRarity: a.minRarity }, mature });
}
check(rows.length === 24, 'expected all 24 personal advanced forms');
check(fingerprint() === before, 'source changed during audit');
const output = { source: root, fingerprint: before, methodology: 'Read-only public buildUnit/activeForm/heroSkills/ultSkillOf and UI facts at legal gates. Combat role matrix is separate; these checks do not establish balance.', forms: rows.length, builds: rows.reduce((n,r) => n+r.mature.length,0), factsChecked, failures, rows };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(output,null,2)}\n`);
console.log(JSON.stringify({ forms: output.forms, builds: output.builds, factsChecked, failures, fingerprint: before }));
process.exitCode = failures.length ? 1 : 0;
