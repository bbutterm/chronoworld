import { describe, expect, it } from 'vitest';
import fixture from './fixtures/tavern-chapter1-before-win.json';
import { loadFullContext } from '../scripts/lib/content-node';
import { withReplay } from './helpers';
import { actPlayStage, chooseOption, deserialize, eveningSquadHeroes, finishEvening, sanitizeSave, serialize, setSquad, type SaveState } from '../src/core';

const ctx = loadFullContext();
const DAY = '2026-10-05';
const NOW = 1791160663806;
const FINAL = 'ch1_s10';
const EVENING = 'tav_ch1';
const PARTICIPANTS = ['alan', 'dorn', 'bran', 'kai', 'vika'];
const GAINS = { alan: 1, bran: 1, vika: 1, dorn: 1, kai: 1 };

/** Exact legal seed3 checkpoint, before its first chapter victory and before any claimed/paid follow-up. */
const checkpoint = () => deserialize(JSON.stringify(fixture));
function firstWin(c = ctx) {
  const result = actPlayStage(checkpoint(), DAY, FINAL, 20, c, NOW);
  expect(result.result.winner).toBe('A');
  return result;
}
const onlyLira = (save: SaveState) => setSquad(save, ['h5', null, null, null, null]);

describe('chapter trust follows the first final-stage participants', () => {
  it('records actual template identities in the first winning action without mutating its input', () => {
    const before = checkpoint();
    const snapshot = serialize(before);
    const win = actPlayStage(before, DAY, FINAL, 20, ctx, NOW);
    expect(win.result.winner).toBe('A');
    expect(win.save.tavern?.chapterSquads).toEqual({ chapter1: PARTICIPANTS });
    expect(win.save.campaign.cleared).toContain(FINAL);
    expect(win.save.tavern?.seen).toBeUndefined();
    expect(win.save.tavern?.bond).toBeUndefined();
    expect(serialize(before)).toBe(snapshot);
  });

  it('keeps the actual chapter party after a legal switch to a reserve hero before reading', () => {
    const win = firstWin().save;
    const changed = onlyLira(win);
    const original = serialize(changed);
    expect(eveningSquadHeroes(changed, EVENING, ctx)).toEqual(['alan', 'bran', 'vika', 'dorn', 'kai']);
    const out = finishEvening(changed, EVENING, ctx);
    expect(out.gains).toEqual(GAINS);
    expect(out.save.tavern?.bond?.lira).toBeUndefined();
    expect(out.save.tavern?.chapterSquads).toEqual(win.tavern?.chapterSquads);
    expect(out.save.heroes).toBe(changed.heroes);
    expect(out.save.resources).toBe(changed.resources);
    expect(out.save.currency).toBe(changed.currency);
    expect(out.save.campaign).toBe(changed.campaign);
    expect(out.save.squad).toBe(changed.squad);
    expect(serialize(changed)).toBe(original);
  });

  it('a second genuine victory with a different party does not overwrite the original chapter', () => {
    const first = firstWin().save;
    const changed = setSquad(first, first.squad.map(id => id === 'h12' ? 'h5' : id));
    // Выпущенные данные повторы запрещают; при явном replay: true вторая победа не переписывает главу.
    expect(() => actPlayStage(changed, DAY, FINAL, 21, ctx, NOW + 1000)).toThrow(expect.objectContaining({ code: 'stage_cleared' }));
    const replay = actPlayStage(changed, DAY, FINAL, 21, withReplay(ctx), NOW + 1000);
    expect(replay.result.winner).toBe('A');
    expect(replay.save.tavern?.chapterSquads).toEqual({ chapter1: PARTICIPANTS });
    expect(finishEvening(replay.save, EVENING, ctx).gains).toEqual(GAINS);
  });

  it('records the pre-battle party before a chapter recruit fills its previously empty slot', () => {
    const before = checkpoint();
    const smaller = setSquad(before, before.squad.map(id => id === 'h12' ? null : id));
    const win = actPlayStage(smaller, DAY, FINAL, 20, ctx, NOW);
    expect(win.result.winner).toBe('A');
    expect(win.save.squad.some(id => win.save.heroes.find(h => h.id === id)?.templateId === 'greta')).toBe(true);
    expect(win.save.tavern?.chapterSquads?.chapter1).toEqual(['alan', 'dorn', 'bran', 'vika']);
    expect(finishEvening(win.save, EVENING, ctx).gains).toEqual({ alan: 1, bran: 1, vika: 1, dorn: 1 });
  });

  it('a loss with a legal underprepared party records no chapter or evening credit', () => {
    const before = onlyLira(checkpoint());
    const loss = actPlayStage(before, DAY, FINAL, 20, ctx, NOW);
    expect(loss.result.winner).toBe('B');
    expect(loss.save.campaign.cleared).not.toContain(FINAL);
    expect(loss.save.tavern?.chapterSquads).toBeUndefined();
    expect(loss.save.tavern?.bond).toBeUndefined();
  });

  it('the numeric stage 18 before stage 10 does not count as completing chapter 1', () => {
    const before = checkpoint();
    const earlier = { ...before, campaign: { cleared: before.campaign.cleared.filter(id => id !== 'ch1_s18') } };
    const win = actPlayStage(earlier, DAY, 'ch1_s18', 20, ctx, NOW);
    expect(win.result.winner).toBe('A');
    expect(win.save.campaign.cleared).not.toContain(FINAL);
    expect(win.save.tavern?.chapterSquads).toBeUndefined();
  });

  it('chapter completion follows content order even if its last encounter is not marked boss', () => {
    const noBoss = { ...ctx, content: { ...ctx.content, stages: ctx.content.stages.map(s => s.id === FINAL ? { ...s, boss: false } : s) } };
    expect(firstWin(noBoss).save.tavern?.chapterSquads).toEqual({ chapter1: PARTICIPANTS });
  });

  it('reload and an evening choice retain the chapter snapshot and award the party only once', () => {
    const win = firstWin().save;
    const reload = deserialize(serialize(win));
    expect(reload.version).toBe(7);
    const chosen = chooseOption(reload, 'c_tav1', 'yes', ctx).save;
    expect(chosen.tavern?.chapterSquads).toEqual({ chapter1: PARTICIPANTS });
    const finished = finishEvening(onlyLira(chosen), EVENING, ctx);
    expect(finished.gains).toEqual(GAINS);
    expect(finished.save.tavern?.bond?.greta).toBe(2);
    expect(finished.save.tavern?.chapterSquads).toEqual({ chapter1: PARTICIPANTS });
    expect(finishEvening(finished.save, EVENING, ctx)).toEqual({ save: finished.save, gains: {} });
  });
});

describe('safe compatibility of optional chapter snapshots', () => {
  it('a legacy save retains its former current-party rule and does not invent past participants on replay', () => {
    const won = firstWin().save;
    const legacy = { ...won, tavern: { ...won.tavern, chapterSquads: undefined } };
    const changed = setSquad(legacy, legacy.squad.map(id => id === 'h12' ? 'h5' : id));
    const replay = actPlayStage(changed, DAY, FINAL, 21, withReplay(ctx), NOW + 1000).save;
    expect(replay.tavern?.chapterSquads).toBeUndefined();
    const delayed = onlyLira(replay);
    expect(eveningSquadHeroes(delayed, EVENING, ctx)).toEqual(['lira']);
    expect(finishEvening(delayed, EVENING, ctx).gains).toEqual({ lira: 1 });
  });

  it('an explicit empty snapshot never falls back to the newly chosen party', () => {
    const save = onlyLira(firstWin().save);
    const empty = { ...save, tavern: { ...save.tavern, chapterSquads: { chapter1: [] } } };
    expect(eveningSquadHeroes(empty, EVENING, ctx)).toEqual([]);
    const out = finishEvening(empty, EVENING, ctx);
    expect(out.gains).toEqual({});
    expect(out.save.tavern?.seen).toContain(EVENING);
    expect(out.save.tavern?.chapterSquads).toEqual({ chapter1: [] });
  });

  it('template history remains valid even if the participating instance is no longer in the roster', () => {
    const save = onlyLira(firstWin().save);
    const later = { ...save, heroes: save.heroes.filter(h => h.templateId !== 'kai') };
    expect(eveningSquadHeroes(later, EVENING, ctx)).toContain('kai');
    expect(finishEvening(later, EVENING, ctx).gains).toEqual(GAINS);
  });

  it('sanitize removes unknown heroes/chapters, duplicates and records for chapters never completed', () => {
    const save = onlyLira(firstWin().save);
    const raw = { ...save, tavern: { ...save.tavern, chapterSquads: { chapter1: ['alan', 'removed_hero', 'alan', 'kai'], retired_chapter: ['vika'], chapter2: ['lira'] } } };
    const fixed = sanitizeSave(raw, ctx);
    expect(fixed.save.tavern?.chapterSquads).toEqual({ chapter1: ['alan', 'kai'] });
    expect(fixed.warnings).toContain('Сведения об отряде, прошедшем главу, исправлены при загрузке.');
    expect(fixed.save.resources).toEqual(save.resources);
    expect(fixed.save.currency).toEqual(save.currency);
    expect(fixed.save.campaign).toEqual(save.campaign);
    expect(fixed.save.heroes.map(h => h.id)).toEqual(save.heroes.map(h => h.id));
    expect(finishEvening(fixed.save, EVENING, ctx).gains).toEqual({ alan: 1, kai: 1 });
  });

  it('an unknown-only historical party is retained as empty, not converted into legacy credit', () => {
    const save = onlyLira(firstWin().save);
    const raw = { ...save, tavern: { ...save.tavern, chapterSquads: { chapter1: ['removed_hero'] } } };
    const fixed = sanitizeSave(raw, ctx).save;
    expect(fixed.tavern?.chapterSquads).toEqual({ chapter1: [] });
    expect(finishEvening(fixed, EVENING, ctx).gains).toEqual({});
  });

  it.each(['corrupt', [42, {}], Array(6).fill('alan')])('a malformed single snapshot preserves version/progress and becomes explicit empty: %j', invalid => {
    const save = onlyLira(firstWin().save);
    const raw = { ...save, tavern: { ...save.tavern, chapterSquads: { chapter1: invalid } } };
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.version).toBe(7);
    expect(loaded.tavern?.chapterSquads).toEqual({ chapter1: [] });
    expect(loaded.resources).toEqual(save.resources);
    expect(loaded.campaign).toEqual(save.campaign);
    expect(loaded.heroes).toEqual(save.heroes);
    expect(finishEvening(loaded, EVENING, ctx).gains).toEqual({});
  });

  it('a malformed whole metadata field never discards the save or awards an already-read evening again', () => {
    const save = firstWin().save;
    const raw = { ...save, tavern: { seen: [EVENING], bond: { alan: 4 }, chapterSquads: 42 } };
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.tavern?.chapterSquads).toEqual({});
    expect(loaded.tavern?.bond).toEqual({ alan: 4 });
    expect(loaded.resources).toEqual(save.resources);
    expect(loaded.campaign).toEqual(save.campaign);
    expect(finishEvening(loaded, EVENING, ctx)).toEqual({ save: loaded, gains: {} });
  });

  it('an intact snapshot needs no sanitize change; unknown evening ids have no party preview', () => {
    const save = firstWin().save;
    const fixed = sanitizeSave(save, ctx);
    expect(fixed.save).toBe(save);
    expect(fixed.warnings).toEqual([]);
    expect(eveningSquadHeroes(save, 'unknown_evening', ctx)).toEqual([]);
  });
});
