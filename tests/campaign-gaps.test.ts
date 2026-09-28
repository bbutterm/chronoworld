/**
 * Глава 1 растянута до 18 этапов (28.09): вставные ch1_s11…s18 стоят между выпущенными ch1_s1…s10. Старое сохранение с
 * пройденными этапами дальше вставленных не «откатывается»: при загрузке (sanitizeSave → fillClearedGaps) все этапы перед
 * самым дальним пройденным засчитываются пройденными. src/core/save/campaign-gaps.ts.
 */
import { describe, expect, it } from 'vitest';
import { currentStage } from '../src/game/flow';
import { fillClearedGaps, lastClearedStage, loadOrNew, MemoryStorage, newGame, persist, sanitizeSave, serialize, stageStatus, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const stages = ctx.content.stages;
const ch1Old = Array.from({ length: 10 }, (_, i) => `ch1_s${i + 1}`);
const withCleared = (cleared: string[]): SaveState => ({ ...newGame(ctx, 0), campaign: { cleared } });

describe('вставные этапы главы 1 и старые сохранения', () => {
  it('прошёл главу 1 до вставки (ch1_s1…s10): новые ch1_s11…s18 засчитаны, открыт ch2_s1', () => {
    const r = sanitizeSave(withCleared(ch1Old), ctx);
    const ch1 = stages.filter((s) => s.chapter === 'chapter1').map((s) => s.id);
    expect(ch1.every((id) => r.save.campaign.cleared.includes(id))).toBe(true);
    // Прежние id — на своих местах, новые дописаны в конец в порядке кампании.
    expect(r.save.campaign.cleared.slice(0, 10)).toEqual(ch1Old);
    expect(r.save.campaign.cleared.slice(10)).toEqual(ch1.filter((id) => !ch1Old.includes(id)));
    expect(stageStatus(r.save, 'ch2_s1', ctx)).toBe('open');
    expect(r.warnings).toEqual([expect.stringMatching(/новые этапы перед уже пройденными — они засчитаны пройденными \(этапы 3, 7, 9, 11, 13, 15, 16, 17\)/)]);
    // Сундук считает по самому дальнему этапу — он не изменился.
    expect(lastClearedStage(r.save, ctx)?.id).toBe('ch1_s10');
  });

  it('вся кампания пройдена: пробелов нет', () => {
    const all = [...ch1Old, ...stages.filter((s) => s.chapter !== 'chapter1').map((s) => s.id)];
    const r = sanitizeSave(withCleared(all), ctx);
    expect(new Set(r.save.campaign.cleared)).toEqual(new Set(stages.map((s) => s.id)));
    expect(stages.every((s) => stageStatus(r.save, s.id, ctx) === 'cleared')).toBe(true);
  });

  it('середина главы (ch1_s1…s5, Таверна): засчитан только вставной ch1_s11 перед ними; дальше — новый ch1_s12', () => {
    const r = sanitizeSave(withCleared(ch1Old.slice(0, 5)), ctx);
    expect(r.save.campaign.cleared).toEqual([...ch1Old.slice(0, 5), 'ch1_s11']);
    expect(stageStatus(r.save, 'ch1_s12', ctx)).toBe('open');
    expect(stageStatus(r.save, 'ch1_s6', ctx)).toBe('locked');
    expect(currentStage(r.save, ctx)?.id).toBe('ch1_s12');
  });

  it('новая игра и сохранение без пробелов — тот же объект, без предупреждений; неизвестные id не трогаются', () => {
    const fresh = newGame(ctx, 0);
    expect(fillClearedGaps(fresh, ctx).save).toBe(fresh);
    const upTo = withCleared(stages.slice(0, 7).map((s) => s.id));
    expect(fillClearedGaps(upTo, ctx)).toEqual({ save: upTo, filled: [] });
    const unknown = withCleared(['ch1_s1', 'ch9_s99']);
    expect(fillClearedGaps(unknown, ctx).save).toBe(unknown);
  });

  it('через loadOrNew: одно предупреждение при первой загрузке, после записи — больше никогда', () => {
    const storage = new MemoryStorage();
    storage.save(serialize(withCleared([...ch1Old, 'ch2_s1', 'ch2_s2'])));
    const r = loadOrNew(storage, ctx, 0);
    expect(r.warnings).toHaveLength(1);
    expect(r.save.campaign.cleared).toHaveLength(18 + 2);
    persist(storage, r.save);
    const again = loadOrNew(storage, ctx, 0);
    expect(again.warnings).toBeUndefined();
    expect(again.save.campaign.cleared).toEqual(r.save.campaign.cleared);
  });
});
