import { describe, expect, it } from 'vitest';
import {
  addItems,
  buildUnit,
  deserialize,
  equip,
  EquipmentError,
  featureStage,
  fightHunt,
  heroGearStats,
  huntBoss,
  huntDamage,
  huntRank,
  huntScore,
  huntSquad,
  huntStatus,
  insertCard,
  newGame,
  serialize,
  simulateBattle,
  sweepHunt,
  withGear,
  type FullContext,
  type HuntConfig,
  type SaveState,
  type UnitDef,
} from '../src/core';
import { attackElement, elementMult, weakTo } from '../src/core/elements';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx: FullContext = loadFullContext();
const D1 = '2026-09-26';

function unlocked(): SaveState {
  const s = newGame(ctx, 0, D1);
  const stage = featureStage('hunt', ctx)!;
  const upTo = ctx.content.stages.findIndex((x) => x.id === stage);
  return { ...s, campaign: { cleared: ctx.content.stages.slice(0, upTo + 1).map((x) => x.id) } };
}

const withMvp = (patch: Partial<NonNullable<HuntConfig['mvp']>>): FullContext => ({ ...ctx, hunt: { ...ctx.hunt, mvp: { ...ctx.hunt.mvp!, ...patch } } });

/** Контекст, где MVP падает с одного удара: уровни с крошечными ОЗ и силой. */
const EASY = withMvp({
  ranks: ctx.hunt.tiers.map((_, i) => ({ hp: 40 + 10 * i, atk: 0.01, def: 0.01 })),
});

function dayAfter(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe('MVP-охота: ротация и данные', () => {
  it('ротация детерминирована: неделя — все MVP по разу, через 7 дней тот же; от сохранения не зависит', () => {
    const n = ctx.hunt.bosses.length;
    expect(n).toBeGreaterThanOrEqual(6);
    const week = Array.from({ length: n }, (_, i) => huntBoss(dayAfter(D1, i), ctx).unit);
    expect(new Set(week).size).toBe(n);
    for (let i = 0; i < n; i++) expect(huntBoss(dayAfter(D1, i + n), ctx).unit).toBe(week[i]);
    const a = huntStatus(unlocked(), D1, ctx).boss.unit;
    const b = huntStatus({ ...unlocked(), createdAt: 123456789 }, D1, ctx).boss.unit;
    expect(a).toBe(b);
  });

  it('у каждого MVP стихия, слабость, механики, легенда, фазы, заряд и карта', () => {
    for (let i = 0; i < ctx.hunt.bosses.length; i++) {
      const b = huntBoss(dayAfter(D1, i), ctx);
      expect(b.element, b.unit).not.toBe('neutral');
      expect(b.weakTo.length, b.unit).toBeGreaterThan(0);
      expect(b.mechanics.length, b.unit).toBeGreaterThanOrEqual(2);
      expect(b.legend, b.unit).toBeTruthy();
      expect(b.card, b.unit).toBeTruthy();
      expect(b.def.phases?.length, b.unit).toBeGreaterThanOrEqual(2);
      expect(b.def.charge, b.unit).toBeTruthy();
      expect(ctx.content.skills[b.def.charge!.skill].castTime, b.unit).toBeGreaterThan(0);
    }
  });
});

describe('MVP-охота: слабость стихии', () => {
  const kai = buildUnit({ id: 'k', templateId: 'kai', rarity: 'blue', level: 35 }, ctx);
  const alan = buildUnit({ id: 'a', templateId: 'alan', rarity: 'blue', level: 35 }, ctx);

  it('герой стихии слабости получает +weaknessAtk АТК, остальные теряют armorAtk', () => {
    const mvp = ctx.hunt.mvp!;
    expect(attackElement(kai, ctx.content.skills)).toBe('fire');
    const boss = { weakTo: weakTo(ctx.combat.elements, 'undead') };
    expect(boss.weakTo).toContain('fire');
    const [k, a] = huntSquad([kai, alan], boss, ctx) as UnitDef[];
    expect(k.stats.atk).toBe(Math.round(kai.stats.atk * (1 + mvp.weaknessAtk)));
    expect(a.stats.atk).toBe(Math.round(alan.stats.atk * (1 - mvp.armorAtk)));
    // Таблица боя: огонь по нежити ×1.5.
    expect(elementMult(ctx.combat.elements, 'fire', 'undead')).toBe(1.5);
  });

  it('в бою: огненный маг бьёт MVP-нежить заметно сильнее, чем MVP с «чужой» стихией', () => {
    const osiris = (() => {
      for (let i = 0; i < 7; i++) {
        const b = huntBoss(dayAfter(D1, i), ctx, 3);
        if (b.unit === 'mvp_osiris') return b;
      }
      throw new Error('нет Осириса');
    })();
    const sandbag = { ...osiris.def, stats: { ...osiris.def.stats, hp: 1e9 } };
    const squad = [alan, null, kai, null, null];
    const dmg = (weak: typeof osiris.weakTo) => {
      const r = simulateBattle(ctx.content, huntSquad(squad, { weakTo: weak }, ctx), [sandbag, null, null, null, null], 3, { combat: { ...ctx.combat, timeLimitSeconds: 30 }, log: false });
      return r.report['A2'].damageDealt;
    };
    // Та же стихия защиты; «weakTo» — что дал ему расчёт слабостей (огонь в списке) против пустого (без бонуса).
    expect(dmg(osiris.weakTo) / dmg([])).toBeGreaterThan(1.6);
  });
});

describe('MVP-охота: уровни, победа, карты', () => {
  it('старое сохранение охоты (без новых полей, старые id боссов) читается и ставит уровень по лучшему урону', () => {
    const s = unlocked();
    const old: SaveState = { ...s, hunt: { day: '2026-09-20', used: 2, best: { mob_mastering: 200000, mob_osiris: 90000 } } };
    const back = deserialize(serialize(old));
    expect(back.hunt).toEqual(old.hunt);
    const expected = ctx.hunt.tiers.filter((t) => t.damage <= 200000).length;
    expect(huntRank(back, ctx)).toBe(expected);
    const st = huntStatus(back, D1, ctx);
    expect(st.rank).toBe(expected);
    expect(st.boss.def.stats.hp).toBe(ctx.hunt.mvp!.ranks[expected].hp);
    expect(st.attemptsLeft).toBe(ctx.hunt.attemptsPerDay);
    // Бой на старом сохранении: старые рекорды остаются.
    const out = fightHunt(back, D1, ctx);
    expect(out.save.hunt!.best.mob_mastering).toBe(200000);
    expect(out.save.hunt!.best.mob_osiris).toBe(90000);
  });

  it('победа над MVP: «MVP!», победа засчитана, следующий уровень, урон = ОЗ уровня (награда его порога)', () => {
    const s = unlocked();
    const out = fightHunt(s, D1, EASY);
    expect(out.killed).toBe(true);
    expect(out.rankUp).toBe(true);
    expect(out.damage).toBeGreaterThanOrEqual(EASY.hunt.mvp!.ranks[0].hp);
    expect(out.save.hunt!.kills![out.boss.unit]).toBe(1);
    expect(huntRank(out.save, EASY)).toBeGreaterThan(EASY.hunt.mvp!.startRank);
    expect(out.save.hunt!.level).toBe(huntRank(out.save, EASY));
    expect(out.score).toBe(EASY.hunt.tiers[EASY.hunt.mvp!.startRank].damage);
    expect(huntStatus(out.save, D1, EASY).kills).toBe(1);
  });

  it('поражение на своём уровне — уровень ниже; бой на выбранном ниже уровне уровень не трогает', () => {
    const hard = withMvp({ ranks: ctx.hunt.mvp!.ranks.map((r) => ({ ...r, hp: r.hp * 1000, atk: r.atk * 100 })) });
    const s: SaveState = { ...unlocked(), hunt: { day: '2026-09-20', used: 0, best: {}, level: 4 } };
    const out = fightHunt(s, D1, hard);
    expect(out.killed).toBe(false);
    expect(out.save.hunt!.level).toBe(3);
    expect(out.score).toBe(huntScore(out.damage, false, 4, hard));
    const low = fightHunt(s, D1, hard, { rank: 1 });
    expect(low.save.hunt!.level).toBe(4);
  });

  it('уровень можно выбрать ниже высшего (выше — не даёт)', () => {
    const s: SaveState = { ...unlocked(), hunt: { day: '2026-09-20', used: 0, best: { mvp_osiris: 60000 } } };
    const top = huntRank(s, EASY);
    expect(top).toBeGreaterThan(1);
    expect(fightHunt(s, D1, EASY, { rank: 1 }).boss.rank).toBe(1);
    expect(fightHunt(s, D1, EASY, { rank: 99 }).boss.rank).toBe(top);
  });

  it('карта MVP: шанс от seed, гарантия после cardPity побед без карты; зачистка карт не даёт', () => {
    const pity = withMvp({ ...EASY.hunt.mvp!, cardChance: 0, cardPity: 3 });
    let s = unlocked();
    const cards: (string | undefined)[] = [];
    for (let d = 0; d < 3; d++) {
      const out = fightHunt(s, dayAfter(D1, d), pity);
      expect(out.killed).toBe(true);
      cards.push(out.grant.card);
      s = out.save;
    }
    expect(cards.slice(0, 2)).toEqual([undefined, undefined]);
    expect(cards[2]).toBeTruthy();
    expect(s.hunt!.cards![cards[2]!]).toBe(1);
    expect(s.hunt!.dry).toBe(0);
    const always = withMvp({ ...EASY.hunt.mvp!, cardChance: 1 });
    expect(fightHunt(unlocked(), D1, always).grant.card).toBe(huntBoss(D1, ctx).card!.id);
    const fought = fightHunt(unlocked(), D1, always);
    const sw = sweepHunt(fought.save, D1, always);
    expect(sw.killed).toBe(false);
    expect(sw.grant.card).toBeUndefined();
  });

  it('детерминирована: тот же бой — та же карта и то же сохранение', () => {
    const half = withMvp({ ...EASY.hunt.mvp!, cardChance: 0.5 });
    const a = fightHunt(unlocked(), D1, half);
    const b = fightHunt(unlocked(), D1, half);
    expect(b.save).toEqual(a.save);
    expect(b.grant.card).toBe(a.grant.card);
  });
});

describe('Карты MVP в снаряжении', () => {
  const card = ctx.hunt.cards.find((c) => c.id === 'card_osiris')!;
  const armor = Object.values(ctx.equipment.items).find((i) => i.slot === card.slot && !i.jobs)!;
  const helmet = Object.values(ctx.equipment.items).find((i) => i.slot !== card.slot && !i.jobs)!;

  function withCardAndItems(): { save: SaveState; armorId: string; helmetId: string; heroId: string } {
    let s = unlocked();
    s = { ...s, hunt: { day: D1, used: 0, best: {}, cards: { [card.id]: 1 } } };
    const r = addItems(s, [armor.id, helmet.id]);
    const heroId = s.heroes[0].id;
    s = equip(r.save, heroId, r.added[0].id, ctx);
    return { save: s, armorId: r.added[0].id, helmetId: r.added[1].id, heroId };
  }

  it('вставка: карта уходит из запаса в предмет, бонус — доля базовых статов героя, пока предмет надет', () => {
    const { save, armorId, heroId } = withCardAndItems();
    const before = heroGearStats(save, heroId, ctx);
    const next = insertCard(save, armorId, card.id, ctx);
    expect(next.inventory.items.find((i) => i.id === armorId)!.card).toBe(card.id);
    expect(next.hunt!.cards![card.id]).toBe(0);
    const after = heroGearStats(next, heroId, ctx);
    const hero = next.heroes.find((h) => h.id === heroId)!;
    const base = buildUnit(hero, ctx, { hp: 0, atk: 0, def: 0, spd: 0 }).stats;
    expect(after.hp - before.hp).toBe(Math.round(base.hp * (card.bonus.hp ?? 0)));
    expect(after.hp).toBeGreaterThan(before.hp);
    // Бонус попадает в бой через withGear.
    const g = withGear(ctx, next);
    expect(buildUnit(hero, g).stats.hp).toBe(base.hp + after.hp);
    // Сохранение с картой в предмете читается.
    expect(deserialize(serialize(next))).toEqual(next);
  });

  it('ошибки: не тот слот, слот занят, карты нет в запасе', () => {
    const { save, armorId, helmetId } = withCardAndItems();
    expect(codeOf(() => insertCard(save, helmetId, card.id, ctx))).toBe('card_slot');
    const once = insertCard(save, armorId, card.id, ctx);
    expect(codeOf(() => insertCard(once, armorId, card.id, ctx))).toBe('card_unknown');
    const twice = { ...once, hunt: { ...once.hunt!, cards: { [card.id]: 1 } } };
    expect(codeOf(() => insertCard(twice, armorId, card.id, ctx))).toBe('card_taken');
    expect(() => insertCard(save, armorId, 'card_nope', ctx)).toThrow(EquipmentError);
  });
});

describe('MVP-охота: урон считается по MVP, не по свите', () => {
  it('huntDamage — урон по первому юниту стороны B (MVP), свита не в счёт', () => {
    const out = fightHunt(unlocked(), D1, ctx);
    const r = out.result!;
    const boss = r.units.find((u) => u.side === 'B')!;
    expect(huntDamage(r)).toBe(r.report[boss.uid].damageTaken);
  });
});
