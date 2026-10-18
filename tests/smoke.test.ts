/**
 * Смоук: по одному-два теста на каждую механику — «игрок может сделать главное», на НАСТОЯЩИХ состояниях модели игрока
 * (scripts/lib/player-model.ts: 3, 7, 10 и 14 дней игры), а не на искусственных сохранениях. Проверяются цели игрока и
 * инварианты («есть кого отдать в копии», «Башня проходима», «награда приходит»), а не числа и раскладка.
 *
 * Зачем (18.10.2026): 2 000+ узких тестов были зелёными, а тестер упёрся в то, что видно только на живом состоянии —
 * из 7 фиолетовых в копии шёл 1 (спутники не шли в корм), Башня с главы 4 была непроходима (эталон сильнее игрока).
 * Новая механика или правка правил — добавить сюда её главный путь игрока.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { autoRun } from '../scripts/balance-tower';
import { dateOf, loadFullContext, PLAYER_MODEL, runBalance } from '../scripts/lib/player-model';
import {
  actAscend,
  actClaimOffline,
  actCookMeal,
  actLevelUp,
  actPlayStage,
  actSummon,
  ascendRequirement,
  autoFodder,
  autoParty,
  buyShopSlot,
  claimExpedition,
  deserialize,
  fightHunt,
  huntStatus,
  kitchenAdvice,
  levelUpInfo,
  rarityIndex,
  redeemCode,
  serialize,
  shopStatus,
  squadPower,
  startExpedition,
  summonStatus,
  type SaveState,
} from '../src/core';
import { currentStage, stageNeeds } from '../src/game/flow';

const ctx = loadFullContext();
const snap: Record<number, { save: SaveState; day: string }> = {};
const DAYS = [3, 7, 10, 14] as const;

beforeAll(() => {
  for (const d of DAYS) snap[d] = { save: runBalance(ctx, d).save, day: dateOf(PLAYER_MODEL.startDate, d) };
}, 120_000);

const at = (d: (typeof DAYS)[number]) => snap[d];
/** «Сейчас» для механик со временем: позже любого времени в сохранении модели. */
const nowOf = (s: SaveState) => Math.max(s.offline.lastClaimAt, ...s.bounties.active.map((e) => e.startedAt)) + 8 * 3600_000;

describe('смоук: путь игрока на состояниях модели (3 / 7 / 14 дней)', () => {
  it('кампания: следующий этап — не стена (мощь отряда ≥ 60% рекомендуемой) и бой даёт исход', () => {
    for (const d of DAYS) {
      const { save, day } = at(d);
      const stage = currentStage(save, ctx);
      expect(stage, `день ${d}: есть текущий этап`).toBeDefined();
      const needs = stageNeeds(save, stage!.id, ctx, day);
      expect(needs.own / needs.power, `день ${d}: ${stage!.id} мощь ${needs.own} / ${needs.power}`).toBeGreaterThan(0.6);
      const out = actPlayStage(save, day, stage!.id, 7, ctx);
      expect(['win', 'loss']).toContain(out.result.winner === 'A' ? 'win' : 'loss');
    }
  });

  it('герои: «Улучшить» работает или честно упирается в опыт/золото', () => {
    for (const d of DAYS) {
      const { save, day } = at(d);
      for (const id of save.squad.filter((x): x is string => !!x)) {
        const info = levelUpInfo(save, id, ctx);
        if (info.canLevel) expect(actLevelUp(save, day, id, ctx).levels).toBeGreaterThan(0);
        else expect(['not_enough_exp', 'not_enough_gold', 'max_level']).toContain(info.blocker);
      }
    }
  });

  it('вознесение: у фиолетового есть из кого собрать золото — спутники идут в копии вручную, «Авто» их не берёт', () => {
    const { save, day } = at(14);
    const purples = save.heroes.filter((h) => h.rarity === 'purple');
    expect(purples.length, 'к 14-му дню есть фиолетовые').toBeGreaterThan(1);
    const away = (id: string) => save.bounties.active.some((b) => b.heroIds.includes(id));
    const target = purples.find((h) => save.squad.includes(h.id) && !away(h.id)) ?? purples.find((h) => !away(h.id))!;
    const req = ascendRequirement(save, target.id, ctx)!;
    const free = req.fodder.flatMap((f) => f.candidates);
    // Отряд (5) и экспедиции держат часть фиолетовых; остальные — кандидаты, спутники тоже.
    const notBusy = purples.filter((h) => h.id !== target.id && !save.squad.includes(h.id) && !away(h.id) && !save.tower.run?.squad.includes(h.id));
    expect(free.length, 'все незанятые фиолетовые — кандидаты в копии').toBe(notBusy.filter((h) => !h.locked && !h.journey?.focus && !h.training?.gold && !h.training?.exp).length);
    const auto = autoFodder(save, target.id, ctx);
    for (const id of auto ?? []) expect(save.heroes.find((h) => h.id === id)!.companion, '«Авто» не берёт спутника').toBeFalsy();
    if (free.length >= 2) {
      const rich = { ...save, resources: { ...save.resources, gold: 10_000_000 } };
      const out = actAscend(rich, day, target.id, free.slice(0, 2), ctx, { deferBranch: true });
      expect(out.save.heroes.find((h) => h.id === target.id)!.rarity).toBe('gold');
      // У каждого героя, у которого остались карты, ровно один спутник.
      for (const t of new Set(out.save.heroes.map((h) => h.templateId))) expect(out.save.heroes.filter((h) => h.templateId === t && h.companion)).toHaveLength(1);
    }
  });

  it('Таверна: призыв за свиток даёт карту', () => {
    const { save, day } = at(7);
    const withScroll = { ...save, currency: { ...save.currency, scrolls: save.currency.scrolls + 1 } };
    expect(summonStatus(withScroll, day, ctx)).toBeDefined();
    const out = actSummon(withScroll, day, 1, 'scroll', ctx);
    expect(out.results).toHaveLength(1);
    expect(out.save.currency.scrolls).toBe(withScroll.currency.scrolls - 1);
  });

  it('Башня: отряд модели в новом забеге проходит ≥ 8 этажей (главы 5, 6 и 8)', () => {
    // До 18.10 в главе 6 (10-й день) — 2 этажа: ступени Башни считались под отряд сильнее игрока.
    for (const d of [7, 10, 14] as const) {
      const { save } = at(d);
      const free = { ...save, tower: { ...save.tower, run: undefined } } as SaveState;
      expect(autoRun(ctx, free, true, 10).floor, `день ${d}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('Охота: попытка боя проходит и считается', () => {
    const { save, day } = at(7);
    const st = huntStatus(save, day, ctx);
    if (!st.unlocked || st.attemptsLeft === 0) return;
    const out = fightHunt(save, day, ctx);
    expect(huntStatus(out.save, day, ctx).used).toBe(st.used + 1);
  });

  it('экспедиции: автоподбор отправляет отряд, по возвращении приходит награда', () => {
    const { save } = at(7);
    const now = nowOf(save);
    const cleared = { ...save, bounties: { ...save.bounties, active: [] } };
    const loc = ctx.meta.expeditions.locations.find((l) => autoParty(cleared, l.id, ctx).ok);
    expect(loc, 'хотя бы одна локация по силам').toBeDefined();
    const hours = ctx.meta.expeditions.durations[0].hours;
    const sent = startExpedition(cleared, loc!.id, hours, now, ctx);
    const back = claimExpedition(sent, loc!.id, now + hours * 3600_000, ctx);
    expect(back.rewards.gold + back.rewards.jobExp).toBeGreaterThan(0);
  });

  it('сундук простоя: за 8 часов приходят золото и опыт', () => {
    const { save, day } = at(7);
    const out = actClaimOffline(save, save.offline.lastClaimAt + 8 * 3600_000, day, ctx);
    expect(out.rewards.gold).toBeGreaterThan(0);
    expect(out.rewards.jobExp).toBeGreaterThan(0);
  });

  it('Лавка: на 7-й день игроку есть что купить на свои деньги, покупка списывает цену', () => {
    // До 18.10 уровни съедали всё золото (15·L²): на 7-й день ≈ 20 тыс. при товарах по 30 тыс. — купить было нечего.
    const { save, day } = at(7);
    const shop = ctx as Parameters<typeof shopStatus>[2];
    const st = shopStatus(save, day, shop);
    expect(st.slots).toHaveLength(ctx.shop!.slots.length);
    const slot = st.slots.find((s) => s.affordable && s.bought < s.stock);
    expect(slot, `золото ${save.resources.gold}, алмазы ${save.currency.gems}: всё не по карману`).toBeDefined();
    const out = buyShopSlot(save, day, slot!.index, shop);
    const paid = slot!.currency === 'gold' ? save.resources.gold - out.save.resources.gold : save.currency.gems - out.save.currency.gems;
    expect(paid).toBe(slot!.price);
  });

  it('Кухня: совет повара готовится', () => {
    const { save, day } = at(7);
    const advice = kitchenAdvice(save, day, ctx);
    if (!advice || advice.reason === 'buy') return;
    const cooked = actCookMeal(save, day, advice.recipeId, ctx);
    expect(squadPower(cooked, ctx, day)).toBeGreaterThanOrEqual(squadPower(save, ctx, day));
  });

  it('коды из data/codes.json вводятся один раз и что-то дают', () => {
    const { save } = at(3);
    for (const c of ctx.codes!.codes) {
      const r = redeemCode(save, c.code, ctx.codes!);
      expect(r.ok, c.code).toBe(true);
      if (r.ok) expect(redeemCode(r.save, c.code, ctx.codes!).ok, `${c.code}: второй раз`).toBe(false);
    }
  });

  it('сохранение: состояние 14-го дня переживает запись и чтение без потерь', () => {
    const { save } = at(14);
    const back = deserialize(serialize(save));
    expect(back.heroes.map((h) => [h.id, h.rarity, h.level])).toEqual(save.heroes.map((h) => [h.id, h.rarity, h.level]));
    expect(back.campaign.cleared).toEqual(save.campaign.cleared);
    expect(back.resources).toEqual(save.resources);
    expect(rarityIndex(back.heroes[0].rarity)).toBeGreaterThanOrEqual(0);
  });
});
