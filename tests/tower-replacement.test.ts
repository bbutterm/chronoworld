import { describe, expect, it } from 'vitest';
import { deserialize, familyStates, pickTowerBlessing, previewTowerBlessingChoice, rerollTowerBlessing, resolveTowerEvent, runEffects, serialize, skipTowerBlessing } from '../src/core';
import { cfg, ctx, fresh, legends, offer } from './tower-draft-fixture';

describe('atomic Tower MVP choices',()=>{
  it.each([0,2])('accepts legendary below cap (%s), common and rare at cap', n=>{
    expect(pickTowerBlessing(offer(legends.slice(0,n),[legends[n]]),legends[n],ctx).save.tower.run!.cards).toHaveLength(n+1);
    for(const id of ['pupa','deviruchi']) expect(pickTowerBlessing(offer(legends.slice(0,3),[id]),id,ctx).save.tower.run!.cards).toEqual([...legends.slice(0,3),id]);
  });
  it('requires explicit active MVP replacement; invalid, stale and duplicate submissions are inert',()=>{
    const save=offer([...legends.slice(0,3),'pupa'],[legends[3]]); const before=serialize(save);
    expect(previewTowerBlessingChoice(save,legends[3],ctx).requiresReplacement).toBe(true);
    for(const replaceCardId of [undefined,'pupa','missing',legends[3]]) expect(()=>pickTowerBlessing(save,legends[3],ctx,{replaceCardId})).toThrow();
    expect(serialize(save)).toBe(before);
    const result=pickTowerBlessing(save,legends[3],ctx,{replaceCardId:legends[0]});
    expect(result.save.tower.run!.cards).toEqual([...legends.slice(1,3),'pupa',legends[3]]);
    expect(()=>pickTowerBlessing(result.save,legends[3],ctx,{replaceCardId:legends[1]})).toThrow();
    expect(serialize(save)).toBe(before);
  });
  it('keep resolves only the offer and never refunds a paid reroll',()=>{
    const original=offer(legends.slice(0,3),[legends[3]]);
    const rerolled=rerollTowerBlessing(original,ctx);
    const kept=skipTowerBlessing(deserialize(serialize(rerolled)),ctx);
    expect(kept.tower.run!.cards).toEqual(original.tower.run!.cards);
    expect(kept.tower.run!.pending).toBeUndefined();expect(kept.tower.run!.rerolls).toBe(2);
    expect(()=>skipTowerBlessing(kept,ctx)).toThrow();
    expect(()=>skipTowerBlessing(offer([],['pupa'],{draftRules:undefined}),ctx)).toThrow();
  });
  it('recalculates family effects from the final deck, including lost and gained families',()=>{
    const outgoing=cfg.blessings.find(b=>b.rarity==='legendary'&&cfg.blessings.some(c=>c.family===b.family&&c.id!==b.id))!;
    const incoming=cfg.blessings.find(b=>b.rarity==='legendary'&&b.family!==outgoing.family)!;
    const sourceMate=cfg.blessings.find(b=>b.family===outgoing.family&&b.id!==outgoing.id)!;
    const targetMate=cfg.blessings.find(b=>b.family===incoming.family&&b.id!==incoming.id)!;
    const cards=[outgoing.id,sourceMate.id,targetMate.id];
    const count=cards.filter(id=>legends.includes(id)).length;
    const save=offer(cards,[incoming.id]);save.tower.run!.draftRules!.legendaryCap=count;
    const preview=previewTowerBlessingChoice(save,incoming.id,ctx,{replaceCardId:outgoing.id});
    expect(preview.familiesLost).toContain(outgoing.family);expect(preview.familiesGained).toContain(incoming.family);
    const next=pickTowerBlessing(save,incoming.id,ctx,{replaceCardId:outgoing.id}).save.tower.run!;
    expect(familyStates(next.cards,cfg).find(f=>f.family.id===outgoing.family)!.active).toBe(false);
    expect(runEffects(next.cards,cfg).some(e=>e.card===`family_${outgoing.family}`)).toBe(false);
  });
  it.each([false,true])('Osiris first acquisition consumes its once-per-run revival even when fallen=%s',fallen=>{
    let save=offer([],['osiris']);const hero=save.tower.run!.squad[1]!;
    if(fallen){save.tower.run!.squad[1]=null;save.tower.run!.fallen=[hero];delete save.tower.run!.hp[hero];}
    const before=serialize(save);previewTowerBlessingChoice(save,'osiris',ctx);expect(serialize(save)).toBe(before);
    expect(skipTowerBlessing(save,ctx).tower.run!.consumedImmediateCards).toEqual([]);
    save=pickTowerBlessing(save,'osiris',ctx).save;
    expect(save.tower.run!.consumedImmediateCards).toEqual(['osiris']);expect(save.tower.run!.fallen).toEqual([]);
    // Retire Osiris with an explicit cap-1 replacement, then encounter him again.
    save.tower.run!.draftRules!.legendaryCap=1;
    save.tower.run!.pending={kind:'blessing',source:'event',options:[legends.find(id=>id!=='osiris')!],rolls:0};
    save=pickTowerBlessing(save,save.tower.run!.pending.options[0],ctx,{replaceCardId:'osiris'}).save;
    save.tower.run!.squad[1]=null;save.tower.run!.fallen=[hero];delete save.tower.run!.hp[hero];
    save.tower.run!.pending={kind:'blessing',source:'event',options:['osiris'],rolls:0};
    save=deserialize(serialize(save));expect(previewTowerBlessingChoice(save,'osiris',ctx).immediateRevivalSpent).toBe(true);
    const lives=save.tower.run!.lives;
    save=pickTowerBlessing(save,'osiris',ctx,{replaceCardId:save.tower.run!.cards[0]}).save;
    expect(save.tower.run!.fallen).toEqual([hero]);expect(save.tower.run!.consumedImmediateCards).toEqual(['osiris']);expect(save.tower.run!.lives).toBe(lives);
    expect(runEffects(save.tower.run!.cards,cfg).some(e=>e.card==='osiris'&&e.effect.kind==='reviveOnce')).toBe(true);
  });
  it('legacy Osiris still revives on reacquisition and old over-cap runs are grandfathered',()=>{
    const save=offer(legends.filter(id=>id!=='osiris'),['osiris'],{draftRules:undefined,consumedImmediateCards:undefined});
    const hero=save.tower.run!.squad[1]!;save.tower.run!.squad[1]=null;save.tower.run!.fallen=[hero];
    expect(pickTowerBlessing(save,'osiris',ctx).save.tower.run!.fallen).toEqual([]);
    expect(pickTowerBlessing(save,'osiris',ctx).save.tower.run!.cards).toHaveLength(7);
  });
});

describe('Scribe versioned escrow and exactly-one-card cost',()=>{
  const scribe=(cards:string[])=>resolveTowerEvent(fresh({cards,rerolls:2,floor:6,pending:{kind:'event',event:'scribe'}}),0,ctx).save;
  it.each(['pupa','deviruchi'])('source %s stays active through open, reroll, cancel and reload',source=>{
    let save=scribe([source]);expect(save.tower.run!.cards).toEqual([source]);expect(save.tower.run!.floor).toBe(7);
    save=rerollTowerBlessing(deserialize(serialize(save)),ctx);
    expect(save.tower.run!.cards).toEqual([source]);
    expect(skipTowerBlessing(save,ctx).tower.run!.cards).toEqual([source]);
    const p=save.tower.run!.pending!;if(p.kind!=='blessing')throw new Error();
    expect(p.options).not.toContain(source);
    const next=pickTowerBlessing(save,p.options[0],ctx).save;
    expect(next.tower.run!.cards).toEqual([p.options[0]]);
  });
  it('rare → MVP at full cap removes only the selected MVP, preserving the rare',()=>{
    const original=[...legends.slice(0,3),'deviruchi'];let save=scribe(original);
    expect(save.tower.run!.pending).toMatchObject({exchange:{sourceCardId:'deviruchi',mode:'mvpReplacement'},minRarity:'legendary'});
    save=deserialize(serialize(save));const p=save.tower.run!.pending!;if(p.kind!=='blessing')throw new Error();
    expect(previewTowerBlessingChoice(save,p.options[0],ctx).exchangeSourcePreserved).toBe(true);
    expect(()=>pickTowerBlessing(save,p.options[0],ctx)).toThrow();
    const next=pickTowerBlessing(save,p.options[0],ctx,{replaceCardId:legends[1]}).save;
    expect(next.tower.run!.cards).toEqual([legends[0],legends[2],'deviruchi',p.options[0]]);
    expect(skipTowerBlessing(save,ctx).tower.run!.cards).toEqual(original);
  });
  it('legendary source opens its own slot without charging a second MVP',()=>{
    const save=scribe(legends.slice(0,3));const p=save.tower.run!.pending!;if(p.kind!=='blessing')throw new Error();
    const preview=previewTowerBlessingChoice(save,p.options[0],ctx);
    expect(preview.requiresReplacement).toBe(false);expect(preview.outgoingCardId).toBe(legends[2]);
    expect(pickTowerBlessing(save,p.options[0],ctx).save.tower.run!.cards).toEqual([...legends.slice(0,2),p.options[0]]);
  });
  it('mixed rare+ exchange dynamically switches only legendary choices to MVP replacement',()=>{
    const save=scribe([...legends.slice(0,3),'pupa']);const p=save.tower.run!.pending!;if(p.kind!=='blessing')throw new Error();
    p.options=['deviruchi',legends[3]];
    expect(previewTowerBlessingChoice(save,'deviruchi',ctx).outgoingCardId).toBe('pupa');
    expect(previewTowerBlessingChoice(save,legends[3],ctx).exchangeSourcePreserved).toBe(true);
    expect(pickTowerBlessing(save,legends[3],ctx,{replaceCardId:legends[0]}).save.tower.run!.cards).toContain('pupa');
    const stale=deserialize(serialize(save));stale.tower.run!.cards=stale.tower.run!.cards.filter(id=>id!=='pupa');
    expect(()=>pickTowerBlessing(stale,'deviruchi',ctx)).toThrow();
  });
  it('legacy pending exchange already charged before this upgrade is never charged again',()=>{
    const save=offer(['pupa'],['deviruchi'],{draftRules:undefined});
    expect(pickTowerBlessing(deserialize(serialize(save)),'deviruchi',ctx).save.tower.run!.cards).toEqual(['pupa','deviruchi']);
  });
});
