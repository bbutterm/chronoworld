import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chooseTowerPath, eventOptionAllowed, isBattleNode, resolveTowerEvent } from '../src/core';
import { cfg, ctx, fresh } from './tower-draft-fixture';

const tower = readFileSync(new URL('../src/game/scenes/TowerScene.ts', import.meta.url), 'utf8');

describe('Adventure screen hierarchy', () => {
  it('final boss promises run completion, while rest/event milestones expose one card choice', () => {
    const code = tower.match(/const finished = [\s\S]*?const consequence = [\s\S]*?\+ after;/)![0];
    const describeRoute = new Function('k', 'n', 'run', 'cfg', 'GAME', 'isBattleNode', 'shards', 'heal', `${code}; return consequence`);
    const run = fresh().tower.run!;
    const summary = (kind: string, floor: number, r = run) => describeRoute(kind, floor, r, cfg, ctx, isBattleNode, 18, 50) as string;
    expect(summary('boss', ctx.tower.maxFloor)).toBe('Победа: +18 осколков\nЗавершение забега');
    const every = run.draftRules!.blessingEvery;
    expect(summary('rest', every)).toBe('Живым героям +50% ОЗ\nВыбор карты');
    expect(summary('event', every)).toBe('Событие с выбором\nВыбор карты');
    expect(summary('event', every + 1)).toBe('Событие с выбором');
    expect(summary('boss', every)).toContain('Выбор карты');
    const legacy = { ...run, draftRules: undefined };
    expect(summary('rest', cfg.blessingEvery, legacy)).toContain('Выбор карты');

    const rest = fresh({ floor: every - 1, paths: ['rest'], pending: undefined });
    expect(chooseTowerPath(rest, 0, ctx).tower.run!.pending?.kind).toBe('blessing');
    // All allowed event outcomes on a milestone retain exactly one pending choice, including
    // outcomes which create their own blessing/exchange before advance() applies its cadence.
    for (const event of cfg.events) {
      const state = fresh({ floor: every - 1, cards: [cfg.blessings.find(b => b.rarity === 'common')!.id], pending: { kind: 'event', event: event.id } });
      for (let option = 0; option < event.options.length; option++) {
        if (!eventOptionAllowed(state.tower.run!, event.options[option])) continue;
        const result = resolveTowerEvent(state, option, ctx).save.tower.run!;
        expect(result.pending?.kind, `${event.id}/${option}`).toBe('blessing');
        expect((summary('event', every).match(/Выбор карты/g) ?? []).length).toBe(1);
      }
    }
  });
});
