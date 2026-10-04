import { describe, expect, it } from 'vitest';
import { buildUnit, simulateBattle } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
const ctx = loadFullContext();
const forms = Object.values(ctx.content.heroes).flatMap(t => t.branches.map(b => ({t,b})));
const signatures = Object.values(ctx.content.skills).filter(s => s.id.startsWith('ro_'));
describe('transcendent signatures', () => {
 it('13 distinct executable signatures; every branch retains its full inheritance', () => {
  expect(signatures).toHaveLength(13);
  expect(new Set(signatures.map(s => JSON.stringify([s.target,s.effects,s.hits]))).size).toBe(13);
  for (const {t,b} of forms) {
   const hero = {id:'hero',templateId:t.id,branch:b.job,rarity:'gold' as const,level:70};
   const u = buildUnit(hero,ctx);
   for (const s of b.skills) expect([...u.skills.actives,...u.skills.passives]).toContain(s.skill);
   const id = u.skills.actives.find(id => id.startsWith('ro_'))!;
   expect(id).toBeTruthy();
   const enemy = {...u,id:'enemy',stats:{...u.stats,hp:1000000},skills:{basic:u.skills.basic,actives:[],passives:[]}};
   const isolated = {...u,skills:{basic:u.skills.basic,actives:[id],passives:[]}};
   const run = () => simulateBattle(ctx.content,[isolated,null,null,null,null],[enemy,null,null,null,null],17,{combat:ctx.combat});
   expect(run()).toEqual(run());
   expect(run().log.some(e => e.type === 'attack' && e.unit === 'A0' && e.skill === id)).toBe(true);
  }
 });
 it('Pressure ignores DEF and drains target energy after offensive damage', () => {
  const u=buildUnit({id:'hero',templateId:'alan',branch:'crusader',rarity:'gold',level:70},ctx);
  const id='ro_paladin_pressure';
  const run=(def:number) => simulateBattle(ctx.content,[{...u,stats:{...u.stats,hp:1000000},skills:{basic:u.skills.basic,actives:[id],passives:[]}},null,null,null,null],[{...u,id:'enemy',stats:{...u.stats,hp:1000000,def},skills:{basic:u.skills.basic,actives:[],passives:[]}},null,null,null,null],19,{combat:ctx.combat});
  const hit=(def:number) => run(def).log.find(e=>e.type==='damage'&&e.source==='A0');
  expect(hit(0)).toMatchObject({amount:(hit(100000) as any).amount});
  const log=run(100000).log;
  const drains=log.filter(e=>e.type==='energy'&&e.unit==='B0');
  expect(drains.length).toBeGreaterThan(0);
  for(const drain of drains) {
   const before=log.slice(0,log.indexOf(drain)).reverse().find(e=>e.type==='damage'&&e.source==='A0'&&e.target==='B0');
   expect(before?.type).toBe('damage');
   if(before?.type==='damage' && drain.type==='energy') expect(drain.energy).toBe(Math.max(0,before.energy-35));
  }
  expect(drains.some(e=>e.type==='energy'&&e.energy===0)).toBe(true);
  expect(log.filter(e=>e.type==='energy'&&e.unit==='A0')).toHaveLength(0);
 });
});
