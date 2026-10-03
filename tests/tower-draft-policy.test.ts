import { describe, expect, it } from 'vitest';
import { chooseTowerPath, deserialize, rerollTowerBlessing, resolveTowerEvent, serialize, TowerDraftRulesSchema, startTowerRun, type TowerRun } from '../src/core';
import { cfg, ctx, fresh, legends, offer, rules } from './tower-draft-fixture';
import { autoRun, playerSave, TOWER_SQUADS } from '../scripts/balance-tower';

const pending = (run: TowerRun) => { if (run.pending?.kind !== 'blessing') throw new Error('missing offer'); return run.pending; };
describe('experimental Tower draft policy and compatibility', () => {
  it('enables the complete v1 candidate only for new runs; snapshots nested rules', () => {
    expect(rules).toEqual({ version: 1, blessingEvery: 5, legendaryCap: 3, rarity: {
      floor: {common:72,rare:27,legendary:1}, elite:{rare:94,legendary:6}, boss:{rare:80,legendary:20}, event:{common:64,rare:35,legendary:1}, start:{common:64,rare:35,legendary:1},
    }});
    const save = fresh();
    expect(save.tower.run!.draftRules).toEqual(rules);
    expect(save.tower.run!.draftRules).not.toBe(rules);
    expect(save.tower.run!.draftRules!.rarity.floor).not.toBe(rules.rarity.floor);
    expect(deserialize(serialize(save)).tower).toEqual(save.tower);
    const legacy = fresh({}, {...ctx, tower:{...ctx.tower, run:{...cfg,newRunDraftRules:undefined}}});
    expect(legacy.tower.run).not.toHaveProperty('draftRules');
    expect(deserialize(serialize(legacy)).tower.run).not.toHaveProperty('draftRules');
    expect(cfg.blessingEvery).toBe(3);
    expect(cfg.rarity.floor.legendary).toBe(8);
  });
  it.each([0, -1, 1.5])('rejects invalid cap %s rather than silently reinterpret it', (cap) => {
    expect(TowerDraftRulesSchema.safeParse({...rules,legendaryCap:cap}).success).toBe(false);
  });
  it('rejects unknown versions and malformed nested weights', () => {
    expect(TowerDraftRulesSchema.safeParse({...rules,version:2}).success).toBe(false);
    expect(TowerDraftRulesSchema.safeParse({...rules,rarity:{...rules.rarity,floor:{legendary:-1}}}).success).toBe(false);
  });
  it('uses saved cadence and weights after content changes, leaves old runs legacy', () => {
    const changed = {...ctx,tower:{...ctx.tower,run:{...cfg,blessingEvery:3,newRunDraftRules:{...rules,blessingEvery:2},rarity:{...cfg.rarity,floor:{legendary:100}}}}};
    expect(chooseTowerPath(fresh({floor:2,paths:['rest']}),0,changed).tower.run!.pending).toBeUndefined();
    const save=chooseTowerPath(fresh({floor:4,paths:['rest']}),0,changed);
    expect(pending(save.tower.run!).source).toBe('floor');
    expect(save.tower.run!.draftRules!.blessingEvery).toBe(5);
    expect(chooseTowerPath(fresh({floor:2,paths:['rest'],draftRules:undefined}),0,changed).tower.run!.pending?.kind).toBe('blessing');
    const original = offer([], ['pupa']);
    expect(rerollTowerBlessing(original,changed)).toEqual(rerollTowerBlessing(original,ctx));
  });
  it('preserves bought starting rarity, four choices, rerolls and second wind', () => {
    let save=fresh(); delete save.tower.run;
    save.tower.upgrades=Object.fromEntries(cfg.upgrades.map((u)=>[u.id,u.costs.length]));
    save=startTowerRun(save,save.squad,ctx);
    expect(pending(save.tower.run!).options).toHaveLength(4);
    expect(pending(save.tower.run!).minRarity).toBe('rare');
    expect(save.tower.run!.rerolls).toBe(2);
    expect(save.tower.run!.lives).toBe(1);
  });
  it.each(['floor','elite','boss','event','start','upgrade'] as const)('keeps source/minimum and distinct full choices at cap: %s', source => {
    let save=offer(legends.slice(0,3),[legends[3]]);
    save.tower.upgrades=Object.fromEntries(cfg.upgrades.filter(u=>u.effect==='extraChoice').map(u=>[u.id,1]));
    save.tower.run!.pending={kind:'blessing',source,options:[legends[3]],rolls:0,minRarity:'legendary'};
    for(let i=0;i<3;i++) {
      save=rerollTowerBlessing(deserialize(serialize(save)),ctx);
      const p=pending(save.tower.run!);
      expect(p.minRarity).toBe('legendary'); expect(p.options).toHaveLength(4); expect(new Set(p.options).size).toBe(4);
      expect(p.options.every(id=>legends.includes(id)&&!save.tower.run!.cards.includes(id))).toBe(true);
    }
    expect(save.tower.run!.rerolls).toBe(0);
  });
  it('Mimic guarantees survive reload and reroll under versioned rules', () => {
    let wins=0;
    for(let seed=1;seed<30;seed++) {
      let save=resolveTowerEvent(fresh({seed,rerolls:1,pending:{kind:'event',event:'mimic'}}),0,ctx).save;
      if(save.tower.run!.pending?.kind!=='blessing')continue;
      wins++;save=rerollTowerBlessing(deserialize(serialize(save)),ctx);
      expect(pending(save.tower.run!).minRarity).toBe('legendary');
      expect(pending(save.tower.run!).options.every(id=>legends.includes(id))).toBe(true);
    }
    expect(wins).toBeGreaterThan(0);
  });
  it('pool depletion remains explicit and never downgrades a guaranteed exchange', () => {
    const small={...ctx,tower:{...ctx.tower,run:{...cfg,blessings:cfg.blessings.filter(b=>b.rarity!=='legendary'||legends.slice(0,3).includes(b.id))}}};
    const save=resolveTowerEvent(fresh({cards:[...legends.slice(0,3),'deviruchi'],pending:{kind:'event',event:'scribe'}},small),0,small).save;
    expect(pending(save.tower.run!)).toMatchObject({options:[],exhausted:true,minRarity:'legendary',exchange:{sourceCardId:'deviruchi'}});
    expect(save.tower.run!.cards).toContain('deviruchi');
  });
  it('long candidate simulation explicitly keeps full builds instead of throwing at cap', () => {
    const allLegend = { legendary: 100 };
    const easy = { ...ctx, tower: { ...ctx.tower, run: { ...cfg,
      tierMult: cfg.tierMult.map(() => 0.0001), growthPerFloor: 0,
      newRunDraftRules: { ...rules, rarity: { floor: allLegend, elite: allLegend, boss: allLegend, event: allLegend, start: allLegend } },
    } } };
    const player = playerSave(easy, 3, TOWER_SQUADS[0], 25);
    player.tower.upgrades = Object.fromEntries(cfg.upgrades.map(u => [u.id, u.costs.length]));
    const result = autoRun(easy, player, true, 50);
    expect(result.floor).toBe(50);
    expect(result.cards.filter(id => legends.includes(id))).toHaveLength(3);
    expect(autoRun(easy, player, true, 50)).toEqual(result);
  });

});
