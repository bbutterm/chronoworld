import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = process.argv[2];
if (!root) throw new Error('Pass exact PR132 checkout path');
const core = await import(pathToFileURL(root + '/src/core/index.ts').href);
const { loadFullContext } = await import(pathToFileURL(root + '/scripts/lib/content-node.ts').href);
const { playerSave, TOWER_SQUADS } = await import(pathToFileURL(root + '/scripts/balance-tower.ts').href);
const ctx = loadFullContext();
const cfg = core.runConfig(ctx);
const out = root + '/qa/fixtures';
mkdirSync(out,{recursive:true});
const cards = ['golden_bug', 'baphomet', 'mistress', 'pupa', 'deviruchi'];
const options = ['osiris', 'orc_hero', 'dark_lord', 'drake'];
function fixture(patch = {}) {
  let player = playerSave(ctx, 3, TOWER_SQUADS[0], 17);
  player.tower.shards = 100;
  player = core.buyTowerUpgrade(player, "wide_choice", ctx);
  player = core.buyTowerUpgrade(player, "shuffle", ctx);
  player = core.buyTowerUpgrade(player, "shuffle", ctx);
  const s = core.startTowerRun(player, player.squad, ctx);
  s.createdAt = Date.now(); s.offline.lastClaimAt = Date.now(); s.daily.day = '2026-10-03';
  s.seenUnlocks = ctx.unlocks.features.map((x:any) => x.id);
  s.seenScenes = ctx.story.scenes.map((x:any) => x.id);
  s.tower.run = { ...s.tower.run, floor: 30, cards: [...cards], rerolls: 2,
    draftRules: structuredClone(cfg.newRunDraftRules), consumedImmediateCards: [],
    pending: { kind: 'blessing', options: [...options], source: 'boss', minRarity: 'legendary', rolls: 0 }, ...patch };
  return core.deserialize(core.serialize(s));
}
const cases:any = {};
cases['cap3-four-choices'] = fixture();
cases['scribe-event-cap3'] = fixture({ pending: { kind: 'event', event: 'scribe' } });
cases['scribe-pending-cap3'] = core.resolveTowerEvent(cases['scribe-event-cap3'], 0, ctx).save;
// Four choices are deliberately synthetic to exercise the maximum UI layout.
cases['scribe-pending-cap3'].tower.run.pending.options = [...options];
function fallen(s:any) { const r = s.tower.run; const id = r.squad[1]; assert.ok(id); r.squad[1] = null; r.fallen = [id]; delete r.hp[id]; return s; }
cases['osiris-first-acquisition'] = fallen(fixture());
cases['osiris-already-spent'] = fallen(fixture({ consumedImmediateCards: ['osiris'] }));
cases['empty-exchange-pool'] = fixture({ pending: { kind: 'blessing', source: 'upgrade', minRarity: 'legendary', options: [], exhausted: true, rolls: 0, exchange: { sourceCardId: 'deviruchi', mode: 'mvpReplacement' } } });
cases['legacy-over-cap'] = fixture({ draftRules: undefined, consumedImmediateCards: undefined, cards: [...cards, 'orc_hero'], pending: { kind: 'blessing', options: ['osiris', 'dark_lord', 'drake'], source: 'boss', rolls: 0 } });
for (const [name, raw] of Object.entries(cases)) {
  const s:any = core.deserialize(core.serialize(raw)); const r = s.tower.run;
  for (const id of [...r.cards, ...(r.pending.kind === 'blessing' ? r.pending.options : [])]) assert.ok(cfg.blessings.some((b:any)=>b.id===id), `${name}: unknown card ${id}`);
  core.towerRunSquad(s, ctx); core.towerRunFloor(s, ctx);
  cases[name] = s;
  writeFileSync(`${out}/${name}.json`, JSON.stringify(s, null, 2)+'\n');
}
const base = cases['cap3-four-choices'];
const before = core.serialize(base);
const rr = core.rerollTowerBlessing(base, ctx);
assert.equal(rr.tower.run.pending.options.length, 4);
assert.equal(rr.tower.run.rerolls, 1);
assert.deepEqual(core.skipTowerBlessing(rr, ctx).tower.run.cards, cards);
assert.equal(core.previewTowerBlessingChoice(base, 'osiris', ctx).requiresReplacement, true);
assert.equal(core.serialize(base), before);
assert.throws(()=>core.pickTowerBlessing(base, 'osiris', ctx));
const chosen = core.pickTowerBlessing(base, 'osiris', ctx, {replaceCardId:'golden_bug'}).save;
assert.deepEqual(chosen.tower.run.cards, ['baphomet','mistress','pupa','deviruchi','osiris']);
assert.equal(chosen.tower.run.pending, undefined);
const kept = core.skipTowerBlessing(core.deserialize(before), ctx);
assert.deepEqual(kept.tower.run.cards, cards); assert.equal(kept.tower.run.pending, undefined);
const sp = cases['scribe-pending-cap3'];
assert.deepEqual(sp.tower.run.pending.exchange,{sourceCardId:'deviruchi',mode:'mvpReplacement'});
assert.deepEqual(core.skipTowerBlessing(sp,ctx).tower.run.cards,cards);
const sc = core.pickTowerBlessing(sp,'osiris',ctx,{replaceCardId:'golden_bug'}).save;
assert.ok(sc.tower.run.cards.includes('deviruchi')); assert.ok(!sc.tower.run.cards.includes('golden_bug'));
const fresh = core.pickTowerBlessing(cases['osiris-first-acquisition'],'osiris',ctx,{replaceCardId:'golden_bug'}).save;
assert.equal(fresh.tower.run.fallen.length,0); assert.deepEqual(fresh.tower.run.consumedImmediateCards,['osiris']);
const spentCase = cases['osiris-already-spent'];
assert.equal(core.previewTowerBlessingChoice(spentCase,'osiris',ctx).immediateRevivalSpent,true);
const spent = core.pickTowerBlessing(spentCase,'osiris',ctx,{replaceCardId:'golden_bug'}).save;
assert.deepEqual(spent.tower.run.fallen,spentCase.tower.run.fallen);
assert.ok(core.runEffects(spent.tower.run.cards,cfg).some((e:any)=>e.card==='osiris'&&e.effect.kind==='reviveOnce'));
writeFileSync(out+'/validation.json',JSON.stringify({checkout:root,createdAt:new Date().toISOString(),fixtures:Object.keys(cases),deserialize:true,cardReferences:true,fullContextSquadAndFloor:true,capReplacement:true,keep:true,purchasedWideChoice:true,purchasedTwoRerolls:true,fourChoicesAfterReroll:true,scribePreservesRare:true,osirisFirstAndSpent:true,synthetic:true,notNaturalBalanceEvidence:true},null,2)+'\n');
console.log('Validated '+Object.keys(cases).length+' synthetic fixtures in '+out);
