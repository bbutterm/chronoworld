import { expect, it } from 'vitest';
import { activeForm, branchPreview, buildUnit, simulateBattle } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { battleFxIds, castFxId } from '../src/game/animatedFx';
import { existsSync, readFileSync } from 'node:fs';
import sprites from '../assets/sprites/sprites.json';
const ctx=loadFullContext();
const forms=Object.values(ctx.content.heroes).flatMap(t=>t.branches.map(b=>({t,b})));
it('24 canonical recipient previews, ancestry, rarity gates and unlock thresholds',()=>{
 expect(forms).toHaveLength(24);
 for(const {t,b} of forms) {
  for(const [rarity,level,advanced] of [['gold',69,false],['gold',70,true],['red',100,true],['purple',60,false]] as const) {
   const hero={id:'recipient',templateId:t.id,branch:b.job,rarity,level};
   const p=branchPreview(t.id,b.job,ctx,hero);
   expect(p.form).toEqual(activeForm(t,hero));expect(p.card.advanced).toBe(advanced);
   expect(p.hero.branch).toBe(b.job); expect(p.card.level).toBe(level);
  }
  expect(branchPreview(t.id,b.job,ctx).hero.rarity).toBe('purple');
  const a=b.advanced!;expect(new Set(a.skills.map(s=>s.skill)).size).toBe(a.skills.length);
  for(const s of [...t.skills,...b.skills]) expect(a.skills.some(x=>x.skill===s.skill && x.level===(b.skills.find(old=>old.skill===s.skill)?.level ?? s.level))).toBe(true);
  for(const level of [70,80,90,100]) {
   const u=buildUnit({id:'hero',templateId:t.id,branch:b.job,rarity:'red',level},ctx);
   const ids=[...u.skills.actives,...u.skills.passives];
   for(const s of a.skills) expect(ids.includes(s.skill)).toBe(s.level<=level);
  }
 }
});
it('full kits dispatch signatures against durable dummies for at least 30 seconds',()=>{
 for(const {t,b} of forms) {
  const u=buildUnit({id:'hero',templateId:t.id,branch:b.job,rarity:'red',level:100},ctx);
  u.stats.hp=100000000;
  const dummy={...u,id:'dummy',stats:{...u.stats,atk:1,hp:100000000},skills:{basic:u.skills.basic,actives:[],passives:[]}};
  const result=simulateBattle(ctx.content,[u,null,null,null,null],[dummy,null,null,null,null],17,{combat:ctx.combat});
  expect(result.duration).toBeGreaterThanOrEqual(30);
  const signature=u.skills.actives.find(s=>s.startsWith('ro_'))!;
  expect(result.log.some(e=>e.type==='attack'&&e.unit==='A0'&&e.skill===signature),`${t.id}/${b.job}: ${signature}`).toBe(true);
 }
});
it('caster atlas selection uses only participating skill elements including ultimates',()=>{
 expect(battleFxIds([]).filter(s=>s.startsWith('fx_cast_'))).toEqual([]);
 const ids=['ro_paladin_pressure','ult_alan_magnum_break'];
 expect(new Set(battleFxIds(ids,[],ctx.content.skills).filter(s=>s.startsWith('fx_cast_')))).toEqual(new Set(ids.map(id=>castFxId(ctx.content.skills[id]))));
 expect(castFxId({element:'undead'})).toBe('fx_cast_dark');
});
it('audited integrated mobs map to existing sprite files and reachable campaign stages',()=>{
 for(const [unit,sprite] of [['alde_owl_baron','owl_baron'],['alde_owl_duke','owl_duke'],['sewer_plankton','plankton'],['mvp_pharaoh','pharaoh']]) {
  expect(ctx.content.units[unit].visual.sprite).toBe(sprite);
  const sheet=sprites.sprites.find(s=>s.id===sprite)!;expect(existsSync('assets/'+sheet.file)).toBe(true);
  if (unit === 'mvp_pharaoh') expect(JSON.stringify(JSON.parse(readFileSync('data/hunt.json','utf8')))).toContain(`"unit":"${unit}"`);
  const chapters=Array.from({length:10},(_,i)=>JSON.parse(readFileSync(`data/campaign/chapter${i+1}.json`,'utf8')));
  expect(chapters.some(c=>JSON.stringify(c).includes(`"unit":"${unit}"`)),unit).toBe(unit !== 'mvp_pharaoh');
 }
});
