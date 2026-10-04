/**
 * Контрольные бои всех 24 форм (13 адвансов), отдельно от экономики прохождения.
 * У всех участников одинаковые уровень/редкость, нет экипировки, близости и тренировочных бонусов.
 * Сравнивает ту же команду с сигнатурой и без неё; поддержка оценивается по победам, ОЗ, лечению,
 * щитам и контролю, а не по одному урону. Цифры не задают обязательную норму DPS для разных ролей.
 *
 * npx tsx scripts/class-audit.ts --seeds 16 --out /tmp/classes.json
 * --source /workspace/chronoworld — повторить те же бои другим checkout без изменения файлов.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BattleResult, CardRarity, Squad, StatusDef, UnitDef } from '../src/core';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}
const root = resolve(arg('source') ?? resolve(import.meta.dirname, '..'));
const n = Number(arg('seeds') ?? 16);
if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('--seeds: ожидалось целое от 1 до 1000');
const out = resolve(arg('out') ?? '/tmp/chronoworld-class-audit.json');
const core = await import(pathToFileURL(resolve(root, 'src/core/index.ts')).href) as typeof import('../src/core');
const node = await import(pathToFileURL(resolve(root, 'scripts/lib/content-node.ts')).href) as typeof import('./lib/content-node');
const ctx = node.loadFullContext();

function sourceDigest(): string {
  const paths = ['src/core/battle.ts', 'data/combat.json', 'data/cards.json'];
  for (const dir of ['data/heroes', 'data/jobs', 'data/skills']) {
    for (const name of readdirSync(resolve(root, dir)).filter(name => name.endsWith('.json')).sort()) paths.push(`${dir}/${name}`);
  }
  const h = createHash('sha256');
  for (const p of paths) h.update(p).update('\0').update(readFileSync(resolve(root, p))).update('\0');
  return h.digest('hex');
}
const before = sourceDigest();
const started = performance.now();
const seedBase = 440_000;
const stages = [
  { level: 70, rarity: 'gold' },
  { level: 80, rarity: 'gold' },
  { level: 90, rarity: 'red' },
  { level: 100, rarity: 'red' },
] satisfies { level: number; rarity: CardRarity }[];
const anchor = ['alan/knight', 'dorn/assassin', 'bran/hunter', 'kai/wizard', 'vika/priest'];
const replacement: string[][] = [
  ['iris/knight', 'alan/knight'],
  ['zara/assassin', 'teo/monk', 'iris/knight'],
  ['meilin/hunter', 'bran/hunter', 'otto/alchemist'],
  ['lira/wizard', 'kai/wizard', 'greta/alchemist'],
  ['teo/priest', 'vika/priest', 'greta/alchemist'],
];
const foes = [
  { id: 'line', forms: anchor },
  { id: 'burst', forms: ['iris/knight', 'zara/assassin', 'meilin/hunter', 'lira/wizard', 'teo/priest'] },
  { id: 'sustain', forms: ['alan/crusader', 'iris/knight', 'bran/bard', 'lira/wizard', 'vika/priest'] },
];
function build(form: string, level: number, rarity: CardRarity, id: string): UnitDef {
  const [templateId, branch] = form.split('/');
  return core.buildUnit({ id, templateId, branch, level, rarity }, ctx);
}
function candidateSquad(form: string, level: number, rarity: CardRarity): { squad: UnitDef[]; slot: number } {
  const candidate = build(form, level, rarity, 'candidate');
  const line = ctx.content.heroes[form.split('/')[0]].line;
  const slot = candidate.role === 'tank' ? 0 : candidate.role === 'healer' ? 4
    : ctx.content.skills[candidate.skills.basic].range === 'melee' ? 1 : line === 'mage' || line === 'merchant' ? 3 : 2;
  const chosen = [...anchor];
  chosen[slot] = form;
  const taken = new Set([form.split('/')[0]]);
  for (let i = 0; i < chosen.length; i++) {
    if (i === slot) continue;
    if (taken.has(chosen[i].split('/')[0])) {
      const next = replacement[i].find(x => !taken.has(x.split('/')[0]) && !chosen.some((y, j) => j !== i && j !== slot && y.split('/')[0] === x.split('/')[0]));
      if (!next) throw new Error(`Нет замены для ${form}, слот ${i}`);
      chosen[i] = next;
    }
    taken.add(chosen[i].split('/')[0]);
  }
  if (new Set(chosen.map(x => x.split('/')[0])).size !== 5) throw new Error(`Повтор героя: ${chosen.join(',')}`);
  return { squad: chosen.map((f, i) => i === slot ? candidate : build(f, level, rarity, `a${i}`)), slot };
}

const statusDefs = new Map<string, StatusDef>();
for (const s of Object.values(ctx.content.skills)) for (const e of s.effects) if (e.type === 'status') statusDefs.set(e.status.id, e.status);
function controlSeconds(r: BattleResult, uid: string): number {
  const active = new Map<string, { from: number; until: number; target: string; source: string }>();
  const intervals = new Map<string, [number, number][]>();
  const close = (key: string, t: number) => {
    const s = active.get(key);
    if (!s) return;
    const end = Math.min(t, s.until);
    if (s.source === uid && end > s.from) {
      const list = intervals.get(s.target) ?? [];
      list.push([s.from, end]);
      intervals.set(s.target, list);
    }
    active.delete(key);
  };
  for (const e of r.log) {
    if (e.type === 'status' && statusDefs.get(e.status)?.stun && e.target.startsWith('B')) {
      const key = `${e.target}:${e.status}`;
      close(key, e.t);
      if (e.action !== 'expire') active.set(key, { from: e.t, until: e.t + (e.seconds ?? e.turns * (ctx.combat.statusTurnSeconds ?? 1)), target: e.target, source: e.source });
    } else if (e.type === 'death') {
      for (const [key, s] of active) if (s.target === e.unit) close(key, e.t);
    }
  }
  for (const key of active.keys()) close(key, r.duration);
  let total = 0;
  for (const list of intervals.values()) {
    list.sort((a, b) => a[0] - b[0]);
    let start = -1, end = -1;
    for (const [a, b] of list) {
      if (start < 0) { start = a; end = b; }
      else if (a <= end) end = Math.max(end, b);
      else { total += end - start; start = a; end = b; }
    }
    if (start >= 0) total += end - start;
  }
  return total;
}
interface Measure {
  win: number; timeout: number; duration: number; damage: number; healing: number; shield: number;
  teamHpPct: number; teamDamageTaken: number; firstUlt: number | null; ults: number; signatureUses: number;
  controlSeconds: number; attacks: Record<string, number>;
}
function measure(r: BattleResult, uid: string, signature: string): Measure {
  const hp = new Map(r.units.filter(u => u.side === 'A').map(u => [u.uid, u.maxHp]));
  let max = 0;
  for (const u of r.units) if (u.side === 'A') max += u.maxHp;
  const attacks: Record<string, number> = {};
  let firstUlt: number | null = null;
  let signatureUses = 0;
  for (const e of r.log) {
    if ((e.type === 'attack' || e.type === 'ult' || e.type === 'passive') && e.unit === uid) {
      attacks[e.skill] = (attacks[e.skill] ?? 0) + 1;
      if (e.skill === signature) signatureUses++;
    }
    if (e.type === 'ult' && e.unit === uid && firstUlt === null) firstUlt = e.t;
    if ((e.type === 'damage' || e.type === 'heal') && hp.has(e.target)) hp.set(e.target, e.hp);
  }
  return {
    win: Number(r.winner === 'A'), timeout: Number(r.reason === 'timeout'), duration: r.duration,
    damage: r.report[uid].damageDealt, healing: r.report[uid].healingDone, shield: r.report[uid].shieldGiven,
    teamHpPct: [...hp.values()].reduce((a, b) => a + b, 0) / max,
    teamDamageTaken: Object.values(r.report).filter(u => u.uid.startsWith('A')).reduce((a, b) => a + b.damageTaken, 0),
    firstUlt, ults: r.report[uid].ults, signatureUses, controlSeconds: controlSeconds(r, uid), attacks,
  };
}
const round = (n: number) => Math.round(n * 1000) / 1000;
function summarize(ms: Measure[]) {
  const keys = ['win', 'timeout', 'duration', 'damage', 'healing', 'shield', 'teamHpPct', 'teamDamageTaken', 'ults', 'signatureUses', 'controlSeconds'] as const;
  const sums = Object.fromEntries(keys.map(k => [k, round(ms.reduce((sum, m) => sum + m[k], 0) / ms.length)]));
  const first = ms.flatMap(m => m.firstUlt === null ? [] : [m.firstUlt]).sort((a, b) => a - b);
  return { ...sums, firstUltCount: first.length, firstUltMean: first.length ? round(first.reduce((a, b) => a + b, 0) / first.length) : null,
    firstUltMin: first[0] ?? null, firstUltMax: first.at(-1) ?? null };
}
const rows: unknown[] = [];
let battles = 0;
let determinismReplays = 0;
for (const maturity of stages) {
  const { level, rarity } = maturity;
  for (const template of Object.values(ctx.content.heroes).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const branch of template.branches) {
      const form = `${template.id}/${branch.job}`;
      const { squad, slot } = candidateSquad(form, level, rarity);
      const u = squad[slot];
      const signature = u.skills.actives.find(id => id.startsWith('ro_'));
      if (!signature) throw new Error(`${form} ур.${level}: нет сигнатуры`);
      const without: Squad = squad.map((x, i) => i === slot ? { ...x, skills: { ...x.skills, actives: x.skills.actives.filter(id => id !== signature) } } : x);
      const full: Measure[] = [], omitted: Measure[] = [];
      const usage: Record<string, number> = {};
      const cases: unknown[] = [];
      for (const foe of foes) {
        const b = foe.forms.map((f, i) => build(f, level, rarity, `b${i}`));
        const caseFull: Measure[] = [], caseOmitted: Measure[] = [];
        for (let i = 0; i < n; i++) {
          const opts = { combat: ctx.combat };
          const normal = core.simulateBattle(ctx.content, squad, b, seedBase + i, opts);
          const stripped = core.simulateBattle(ctx.content, without, b, seedBase + i, opts);
          if (i === 0) {
            determinismReplays++;
            if (JSON.stringify(core.simulateBattle(ctx.content, squad, b, seedBase + i, opts)) !== JSON.stringify(normal)) throw new Error(`${form}/${foe.id}: недетерминированный бой`);
          }
          const a = measure(normal, `A${slot}`, signature), c = measure(stripped, `A${slot}`, signature);
          full.push(a); omitted.push(c); caseFull.push(a); caseOmitted.push(c);
          for (const [id, count] of Object.entries(a.attacks)) usage[id] = (usage[id] ?? 0) + count;
          battles += 2;
        }
        cases.push({ foe: foe.id, full: summarize(caseFull), withoutSignature: summarize(caseOmitted) });
      }
      rows.push({ form, job: branch.advanced?.job, role: u.role, level, rarity, signature, slot,
        stats: u.stats, full: summarize(full), withoutSignature: summarize(omitted), usage,
        unusedActives: u.skills.actives.filter(id => !usage[id]), cases });
    }
  }
}
const after = sourceDigest();
if (after !== before) throw new Error('Исходники или данные изменились во время прогона');
if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ source: root, sourceDigest: before, methodology: 'Контрольные legal формы с одинаковыми уровнем/редкостью и нулевой экипировкой; не экономическая симуляция. Одни и те же seeds с сигнатурой и без неё. Выживание, поддержка и контроль учитываются отдельно от урона.',
  seedBase, seeds: n, battles, determinismReplays, seconds: round((performance.now() - started) / 1000), rows }, null, 2)}\n`);
console.log(`Контрольный аудит: ${rows.length} форм/уровней, ${battles} боёв и ${determinismReplays} повторов, ${round((performance.now() - started) / 1000)} с; ${out}`);
