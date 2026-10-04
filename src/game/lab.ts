import { addHeroCard, chooseBranch, heroJobId, newGame, placeInSquad, type FullContext, type SaveState } from '../core';

/** Prepared sandbox; all forms, IDs and combat remain core-owned. */
export function prepareAdvanceLab(ctx: FullContext, now: number, day: string): SaveState {
  let save = newGame(ctx, now, day);
  save = { ...save, heroes: [], squad: [null, null, null, null, null] };
  for (const t of Object.values(ctx.content.heroes).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const branch of t.branches) {
      save = addHeroCard(save, t.id, 'red', { level: 100 }).save;
      const hero = save.heroes.at(-1)!;
      save = chooseBranch(save, hero.id, branch.job, ctx).save;
    }
  }
  for (const job of ['high_priest', 'paladin', 'sniper', 'high_wizard', 'stalker']) {
    const hero = save.heroes.find(h => heroJobId(h, ctx) === job);
    if (!hero) throw new Error(`Missing LAB form: ${job}`);
    save = { ...save, squad: placeInSquad(save.squad, hero, save, ctx) };
  }
  return { ...save, resources: { gold: 1_000_000, heroExp: 1_000_000 },
    currency: { ...save.currency, gems: 100_000, scrolls: 1000 },
    campaign: { cleared: ctx.content.stages.map(s => s.id) },
    seenScenes: ctx.story.scenes.map(s => s.id), storyQueue: [],
    seenUnlocks: (ctx.unlocks?.features ?? []).map(f => f.id) };
}

export function installAdvanceLab(reset: () => void, summary: () => unknown, game: unknown): void {
  document.title = 'Chronoworld — тест адвансов';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);left:50%;transform:translateX(-50%);z-index:10000;font:11px sans-serif;color:#fff;background:#231d16dd;border-radius:0 0 6px 6px;padding:2px 6px;white-space:nowrap';
  overlay.append('Тест адвансов ');
  const button = document.createElement('button');
  button.textContent = 'Сброс теста';
  button.style.cssText = 'font:inherit;min-height:24px;cursor:pointer';
  button.onclick = () => { if (window.confirm('Сбросить прогресс теста адвансов?')) reset(); };
  overlay.append(button);
  document.body.append(overlay);
  Object.defineProperty(window, '__advanceLab', { value: Object.freeze({ get summary() { return summary(); }, game }), writable: false });
}

/** Only this sandbox's auxiliary keys/backups are removed; save revision is retained. */
export function clearAdvanceLabExtras(storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith('chronoworld.advanceLab.') && key !== 'chronoworld.advanceLab.save.v1') keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
