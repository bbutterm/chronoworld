import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeView } from '../src/game/viewLayout';
import { S, T } from '../src/game/theme';
import { chooseTowerPath, eventOptionAllowed, isBattleNode, resolveTowerEvent } from '../src/core';
import { cfg, ctx, fresh } from './tower-draft-fixture';

const hunt = readFileSync(new URL('../src/game/scenes/HuntScene.ts', import.meta.url), 'utf8');
const tower = readFileSync(new URL('../src/game/scenes/TowerScene.ts', import.meta.url), 'utf8');
const number = (src: string, name: string) => Number(src.match(new RegExp(`\\b${name}: (\\d+)`))?.[1]);

describe('Adventure screen hierarchy', () => {
  it('selected hunt objective distinguishes farming, advancement and the final rank without promising a fixed jump', () => {
    const expression = hunt.match(/const objective = ([\s\S]*?);/)![1];
    const objective = new Function('rank', 'st', `return ${expression}`);
    expect(objective(1, { rank: 4, ranks: 10 })).toBe('Фарм · для продвижения — уровень 5');
    expect(objective(4, { rank: 4, ranks: 10 })).toBe('Победите MVP — откроются уровни выше');
    expect(objective(9, { rank: 9, ranks: 10 })).toBe('Последний уровень · цель — победить MVP');
    expect(hunt).toContain("rank + 1 >= st.ranks ? 'Выбран последний уровень MVP'");
    expect(hunt).toContain('`MVP дня · ур. ${(pickedRank ?? st.rank) + 1}`');
  });

  it('makes boss mechanic, reward meaning and historical progress visible without opening rules', () => {
    for (const name of ['huntMechanic', 'huntObjective', 'huntRewardLabel', 'huntHistoryLabel']) expect(hunt).toContain(`setName('${name}')`);
    expect(hunt).toContain('boss.mechanics[0]');
    expect(hunt).toContain("'Лучший результат · пороги наград'");
    expect(hunt).not.toContain("'ниже вашего', 'neutral').setScale(0.85)");
  });

  it.each([[360, 640], [390, 844]])('keeps hunt preparation and reward bands above the CTA at %sx%s', (w, h) => {
    const view = computeView(w, h, 1);
    const bottom = 1730 + Math.max(0, Math.min(360, view.safeBottom - 1920));
    const top = 170 + S.xs;
    const squadH = number(hunt, 'squadH');
    const levelH = number(hunt, 'levelH');
    const ctaH = 144;
    const restH = squadH + levelH + ctaH + S.xs + 3 * S.s + S.l;
    const bannerH = Math.max(number(hunt, 'bannerMin'), Math.min(number(hunt, 'bannerMax'), bottom - top - restH));
    const gap = Math.max(S.s, (bottom - top - bannerH - squadH - levelH - ctaH - S.xs - S.l) / 3);
    const levelY = top + bannerH + gap + squadH + gap;
    expect(levelY + levelH).toBeLessThan(bottom - S.xs - ctaH);
    // Mechanics stay below the name/subtitle/element stack, above weakness and HP.
    expect(bannerH - 228).toBeGreaterThan(330);
    expect(bannerH - 228 + 2 * (T.caption + 9)).toBeLessThan(bannerH - 120);
    // Two chip rows (56 high, 16 gap) fit between reward and history labels.
    expect(levelH - 40 - 80 - (64 + 132 + 34)).toBeGreaterThanOrEqual(128);
  });

  it('route cards use real reward/rest values and retain selection guards', () => {
    expect(tower).toContain('cfg.shards.floor +');
    expect(tower).toContain('cfg.restHeal + upgradeValue');
    expect(tower).toContain('run.draftRules?.blessingEvery ?? cfg.blessingEvery');
    expect(tower).toContain('if (!locked && !run.node)');
    expect(tower).toContain('if (this.sel === i) return;');
    for (const name of ['towerPathConsequence${i}', 'towerPreviewLabel', 'towerSquadLabel']) expect(tower).toContain(name);
  });


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

  it.each([[360, 640], [390, 844]])('keeps both route targets, selected preview, wounds and CTA separated at %sx%s', (w, h) => {
    const scale = computeView(w, h, 1).zoom;
    const cardW = (1080 - 2 * S.l - S.s) / 2;
    const cardH = Number(tower.match(/const cardH = (\d+);/)![1]);
    const cy = Number(tower.match(/const cy = (738);/)![1]);
    expect(cardW * scale).toBeGreaterThanOrEqual(44);
    expect(cardH * scale).toBeGreaterThanOrEqual(44);
    const previewY = number(tower, 'previewY');
    const squadY = number(tower, 'runSquadY');
    expect(cy + cardH / 2).toBeLessThan(previewY - 184 - 22);
    expect(previewY + 150).toBeLessThan(squadY - 90 - 22);
    expect(squadY + 64 + 22 + 9).toBeLessThan(1920 - 170 - 110 - 72);
  });
});
