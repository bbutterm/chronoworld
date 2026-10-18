import { describe, expect, it } from 'vitest';
import { forEachCase } from './helpers';
import { activeForm, buildUnit, cardStats, heroCard, heroJobId, heroSpriteOverride, heroSkills, lineOf, changeBranch, newGame, simulateBattle, levelUpHero, canEquip, sanitizeSave } from '../src/core';
import type { HeroState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const jobs: Record<string, string> = { knight: 'lord_knight', crusader: 'paladin', hunter: 'sniper', bard: 'clown', dancer: 'gypsy', wizard: 'high_wizard', sage: 'professor', assassin: 'assassin_cross', rogue: 'stalker', priest: 'high_priest', monk: 'champion', blacksmith: 'whitesmith', alchemist: 'creator' };
const forms = Object.values(ctx.content.heroes).flatMap(t => t.branches.map(b => ({ t, b })));

describe('ветеранские профессии: стабильные ветки и детерминированное возвышение', () => {
  it('каждая ветеранская форма: границы, пол, статы и старые сохранения', () => forEachCase(forms, ({ t, b }) => `${t.id}/${b.job}`, ({ t, b }) => {
    const hero: HeroState = { id: 'veteran', templateId: t.id, branch: b.job, rarity: 'gold', level: 70 };
    const copy = structuredClone(hero);
    expect(heroJobId(hero, ctx)).toBe(jobs[b.job]);
    expect(heroSpriteOverride(hero, ctx)).toBe(`${jobs[b.job]}_${t.gender}`);
    expect(heroCard(hero, ctx).branch).toBe(b.job);
    expect(lineOf(ctx, jobs[b.job])).toBe(t.line);
    expect(ctx.content.jobs[jobs[b.job]].from).toEqual([b.job]);
    for (const rarity of ['green', 'blue', 'purple', 'gold', 'red'] as const) {
      for (const level of [60, 69, 70, 80, 100]) {
        const job = heroJobId({ ...hero, rarity, level }, ctx);
        expect(job).toBe(rarity === 'green' || rarity === 'blue' ? t.job : (rarity === 'gold' || rarity === 'red') && level >= 70 ? jobs[b.job] : b.job);
      }
    }
    expect(activeForm(t, { rarity: 'gold', branch: b.job }).job).toBe(b.job);
    expect(heroJobId({ ...hero, branch: undefined }, ctx)).toBe(t.job);
    const legacy = { ...t, branches: t.branches.map(x => ({ ...x, advanced: undefined })) };
    const oldStats = cardStats(legacy, 70, 'gold', ctx, b.job);
    const stats = cardStats(t, 70, 'gold', ctx, b.job);
    for (const key of ['hp', 'atk', 'def', 'spd'] as const) {
      expect(stats[key] / oldStats[key]).toBeGreaterThanOrEqual(1.07);
      expect(stats[key] / oldStats[key]).toBeLessThanOrEqual(1.16);
    }
    for (const item of Object.values(ctx.equipment.items)) {
      expect(canEquip(hero, item, ctx), item.id).toBe(canEquip({ ...hero, level: 69 }, item, ctx));
    }
    const save = newGame(ctx, 0);
    save.heroes = [hero];
    save.squad = [hero.id, null, null, null, null];
    const loaded = sanitizeSave(save, ctx).save.heroes.find(h => h.id === hero.id)!;
    expect(loaded).toEqual({ ...hero, companion: true });
    expect(heroJobId(loaded, ctx)).toBe(jobs[b.job]);
    expect(hero).toEqual(copy);
  }));

  it('24 личные ульты, 52 навыка классов, открытия 70/80/90/100 и сохранённые приёмы', () => {
    const ults = new Set<string>();
    for (const { t, b } of forms) {
      const h: HeroState = { id: t.id, templateId: t.id, branch: b.job, rarity: 'red', level: 100 };
      const f = activeForm(t, h);
      expect(f.ult).toBe(`ult_adv_${t.id}_${jobs[b.job]}`);
      ults.add(f.ult!);
      expect(f.skills.filter(s => s.skill.startsWith('adv_')).map(s => s.level)).toEqual([70, 80, 90, 100]);
      expect(f.skills.filter(s => b.skills.some(old => old.skill === s.skill)).length).toBeGreaterThanOrEqual(1);
      expect(new Set(f.skills.map(s => s.skill)).size).toBe(f.skills.length);
      for (const level of [70, 80, 90, 100]) {
        const sk = heroSkills({ ...h, level }, ctx);
        expect([...sk.actives, ...sk.passives].filter(id => id.startsWith('adv_'))).toHaveLength((level - 70) / 10 + 1);
      }
    }
    expect(ults.size).toBe(24);
    expect(Object.keys(ctx.content.skills).filter(id => id.startsWith('adv_'))).toHaveLength(52);
    expect(new Set([...ults].map(id => JSON.stringify({ target: ctx.content.skills[id].target, effects: ctx.content.skills[id].effects, hits: ctx.content.skills[id].hits })) ).size).toBe(24);
  });

  it('смена ветки оставляет исходный id, а уровень 70 открывает новый навык', () => {
    const save = newGame(ctx, 0);
    save.heroes[0] = { ...save.heroes[0], templateId: 'alan', rarity: 'gold', level: 69, branch: 'knight' };
    save.resources = { gold: 100000000, heroExp: 100000000 };
    const before = structuredClone(save);
    const r = levelUpHero(save, save.heroes[0].id, ctx);
    expect(r.events.some(e => e.type === 'skillUnlocked' && e.skill.startsWith('adv_'))).toBe(true);
    const changed = changeBranch(r.save, save.heroes[0].id, 'crusader', ctx);
    expect(changed.save.heroes[0].branch).toBe('crusader');
    expect(heroJobId(changed.save.heroes[0], ctx)).toBe('paladin');
    expect(save).toEqual(before);
  });

  it('каждая ветеранская форма: воспроизводимый бой с реальным новым навыком', () => forEachCase(forms, ({ t, b }) => `${t.id}/${b.job}`, ({ t, b }) => {
    const u = buildUnit({ id: 'veteran', templateId: t.id, branch: b.job, rarity: 'red', level: 100 }, ctx);
    // Показ навыков, а не дуэль равной атаки: Кай раньше погибал в 13,9 с при готовности ульты около 20,6 с.
    // Противник держит длинный бой и наносит малый урон; реальные навыки, энергия, касты и выборы героя сохранены.
    const enemy = { ...u, id: 'target', stats: { ...u.stats, hp: u.stats.hp * 15, atk: Math.max(1, Math.floor(u.stats.atk * 0.08)) }, skills: { basic: u.skills.basic, actives: [], passives: [] } };
    const run = () => simulateBattle(ctx.content, [u, null, null, null, null], [enemy, null, null, null, null], 73, { combat: ctx.combat });
    const result = run();
    expect(result).toEqual(run());
    expect(result.log.some(e => 'skill' in e && typeof e.skill === 'string' && e.skill.startsWith('adv_'))).toBe(true);
    expect(result.log.some(e => e.type === 'ult' && e.unit === 'A0' && e.skill === u.skills.ult)).toBe(true);
    for (const id of u.skills.actives.filter(id => id.startsWith('adv_'))) {
      const isolated = { ...u, skills: { ...u.skills, actives: [id], passives: [], ult: undefined } };
      const cast = simulateBattle(ctx.content, [isolated, null, null, null, null], [enemy, null, null, null, null], 73, { combat: ctx.combat });
      expect(cast.log.some(e => e.type === 'attack' && e.unit === 'A0' && e.skill === id), id).toBe(true);
    }
  }));
});
