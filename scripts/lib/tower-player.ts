/** Модель выбора использует те же забеги, что интерфейс, без старой лестницы. */
import {
  chooseTowerPath, eventOptionAllowed, pickTowerBlessing, previewTowerBlessingChoice,
  resolveTowerEvent, runConfig, skipTowerBlessing, startTowerRun, towerEventDef,
  type Blessing, type EventOutcome, type SaveState, type TowerContext,
} from '../../src/core';

function cardValue(card: Blessing): number {
  const rarity = { common: 0, rare: 3, legendary: 7 }[card.rarity];
  return rarity + card.effects.reduce((n, effect) => {
    if (effect.kind === 'reviveRun' || effect.kind === 'reviveOnce') return n + 10;
    if (effect.kind === 'killHeal' || effect.kind === 'startShield' || effect.kind === 'regen') return n + 7;
    if (effect.kind === 'startHpLoss') return n - 8;
    if (effect.kind === 'atk' || effect.kind === 'healTaken') return n + effect.pct * 20;
    return n + 4;
  }, 0);
}

function outcomeValue(outcome: EventOutcome, wounded: boolean, fallen: boolean): number {
  switch (outcome.kind) {
    case 'hp': return outcome.pct * (wounded ? 100 : 20);
    case 'shards': return outcome.n / 10;
    case 'revive': return fallen ? 30 : 0;
    case 'card': return { common: 5, rare: 10, legendary: 15 }[outcome.rarity];
    case 'upgradeCard': return 12;
    case 'gamble': return outcome.chance * outcome.win.reduce((n, x) => n + outcomeValue(x, wounded, fallen), 0)
      + (1 - outcome.chance) * outcome.lose.reduce((n, x) => n + outcomeValue(x, wounded, fallen), 0) - 2;
  }
}

/** Один интерфейсный выбор; время чтения/нажатия начисляет вызывающая модель. */
export function prepareModelTower(save: SaveState, ctx: TowerContext): SaveState {
  const run = save.tower.run;
  if (!run) return startTowerRun(save, save.squad, ctx);
  if (run.node) return save;
  const cfg = runConfig(ctx);
  if (run.pending?.kind === 'blessing') {
    const candidates = run.pending.options
      .map((id) => cfg.blessings.find((card) => card.id === id))
      .filter((card): card is Blessing => !!card)
      .sort((a, b) => cardValue(b) - cardValue(a) || a.id.localeCompare(b.id));
    for (const card of candidates) {
      const preview = previewTowerBlessingChoice(save, card.id, ctx);
      const outgoing = preview.requiresReplacement
        ? [...preview.replacementCandidates].sort((a, b) => cardValue(cfg.blessings.find((c) => c.id === a)!) - cardValue(cfg.blessings.find((c) => c.id === b)!))[0]
        : undefined;
      if (preview.requiresReplacement && !outgoing) continue;
      return pickTowerBlessing(save, card.id, ctx, outgoing ? { replaceCardId: outgoing } : {}).save;
    }
    return skipTowerBlessing(save, ctx);
  }
  const hp = run.squad.filter((id): id is string => !!id).map((id) => run.hp[id] ?? 1000);
  const wounded = hp.some((value) => value < 650);
  if (run.pending?.kind === 'event') {
    const event = towerEventDef(save, ctx)!;
    const option = event.options.map((value, index) => ({ value, index }))
      .filter(({ value }) => eventOptionAllowed(run, value))
      .sort((a, b) => b.value.outcomes.reduce((n, x) => n + outcomeValue(x, wounded, run.fallen.length > 0), 0)
        - a.value.outcomes.reduce((n, x) => n + outcomeValue(x, wounded, run.fallen.length > 0), 0))[0];
    if (!option) throw new Error('Башня: нет доступного исхода события');
    return resolveTowerEvent(save, option.index, ctx).save;
  }
  const rank = (kind: string) => kind === 'rest' ? (wounded ? 10 : -1) : kind === 'event' ? 6 : kind === 'battle' ? 5 : kind === 'elite' ? 3 : 0;
  const index = run.paths.map((kind, i) => ({ kind, i })).sort((a, b) => rank(b.kind) - rank(a.kind) || a.i - b.i)[0]?.i;
  if (index === undefined) throw new Error('Башня: нет следующего пути');
  return chooseTowerPath(save, index, ctx);
}
