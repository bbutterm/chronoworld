import { describe, expect, it } from 'vitest';
import { claimExpedition, newGame, type ActiveExpedition, type ExpeditionEventState, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { expeditionRewardPreview } from '../src/game/expeditionRewards';

const ctx = loadFullContext();
const T0 = 1_791_014_400_000;

function fixture(events?: ExpeditionEventState[]): { save: SaveState; e: ActiveExpedition } {
  const save = newGame(ctx, T0, '2026-10-03');
  const e: ActiveExpedition = {
    location: 'ant_hell', hours: 8, heroIds: save.heroes.map((h) => h.id), power: 1000,
    startedAt: T0, endsAt: T0 + 8 * 3_600_000,
    rewards: { gold: 432, jobExp: 576, gems: 2, heroCards: { blue: 1, purple: 0 }, scrolls: 1, items: [] },
    events,
  };
  save.bounties.active = [e];
  return { save, e };
}

const unresolved = (): ExpeditionEventState[] => [
  { id: 'road_old_friend', at: T0 + 1 },
  { id: 'road_marauders', at: T0 + 2 },
  { id: 'ant_queen_song', at: T0 + 3 },
];
const resolved = (): ExpeditionEventState[] => [
  { ...unresolved()[0], choice: 'talk', ok: true },
  { ...unresolved()[1], choice: 'storm', ok: false },
  { ...unresolved()[2], choice: 'listen', ok: true },
];

describe('expedition reward preview', () => {
  it('updates the current total for a negative and then a positive story outcome', () => {
    const { save, e } = fixture(unresolved());
    expect(expeditionRewardPreview(save, e, ctx)).toMatchObject({ gold: 432, jobExp: 576 });
    e.events![1] = resolved()[1];
    expect(expeditionRewardPreview(save, e, ctx)).toMatchObject({ gold: 418, jobExp: 557 });
    e.events![2] = resolved()[2];
    expect(expeditionRewardPreview(save, e, ctx)).toMatchObject({ gold: 453, jobExp: 603 });
    expect(e.rewards).toMatchObject({ gold: 432, jobExp: 576 });
  });

  it('matches the complete claimed reward and resource delta for fully resolved events', () => {
    const { save, e } = fixture(resolved());
    const preview = expeditionRewardPreview(save, e, ctx);
    const claim = claimExpedition(save, e.location, e.endsAt, ctx);
    expect(preview).toMatchObject({ gold: 453, jobExp: 603 });
    expect(preview).toEqual(claim.rewards);
    expect(claim.save.resources.gold - save.resources.gold).toBe(preview.gold);
    expect(claim.save.resources.heroExp - save.resources.heroExp).toBe(preview.jobExp);
  });

  it('repeated previews neither apply rewards twice nor mutate the save or its snapshot', () => {
    const { save, e } = fixture(resolved());
    const before = structuredClone(save);
    const first = expeditionRewardPreview(save, e, ctx);
    for (let i = 0; i < 3; i++) expect(expeditionRewardPreview(save, e, ctx)).toEqual(first);
    expect(save).toEqual(before);
    expect(claimExpedition(save, e.location, e.endsAt, ctx).rewards).toEqual(first);
    expect(save).toEqual(before);
  });

  it('previews actual default outcomes without resolving unanswered events in the save', () => {
    for (const def of ctx.expeditionEvents!.events) {
      const { save, e } = fixture([{ id: def.id, at: T0 + 1 }]);
      const before = structuredClone(save);
      const preview = expeditionRewardPreview(save, e, ctx);
      const claim = claimExpedition(save, e.location, e.endsAt, ctx);
      expect(preview, def.id).toEqual(claim.rewards);
      expect(claim.story[0].auto, def.id).toBe(true);
      expect(save, def.id).toEqual(before);
    }
  });

  it('includes event gems/items, filters removed items, and preserves other snapshot rewards', () => {
    const item = Object.keys(ctx.equipment.items)[0];
    const { save, e } = fixture([{ id: 'road_marauders', at: T0 + 1, choice: 'storm', ok: true, item }]);
    e.rewards.items = ['removed_item'];
    const event = ctx.expeditionEvents!.events.find((x) => x.id === 'road_marauders')!;
    const modified = { ...ctx, expeditionEvents: { ...ctx.expeditionEvents!, events: ctx.expeditionEvents!.events.map((x) => x === event ? { ...x, choices: x.choices.map((c) => c.id === 'storm' ? { ...c, success: { ...c.success, gems: 3 } } : c) } : x) } };
    const preview = expeditionRewardPreview(save, e, modified);
    expect(preview).toMatchObject({ gems: 5, items: [item], scrolls: 1, heroCards: { blue: 1, purple: 0 } });
    expect(preview).toEqual(claimExpedition(save, e.location, e.endsAt, modified).rewards);
  });

  it('keeps old expeditions without events unchanged', () => {
    const { save, e } = fixture();
    expect(expeditionRewardPreview(save, e, ctx)).toEqual(e.rewards);
  });
});
