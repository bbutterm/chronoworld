import { describe, it, expect, vi, afterEach } from 'vitest';
import { GAME } from '../src/game/content';
import { prepareAdvanceLab, clearAdvanceLabExtras } from '../src/game/lab';
import { activeForm, deserialize, serialize, sanitizeSave, setSquad, playStage } from '../src/core';

const prepared = () => prepareAdvanceLab(GAME, 1_800_000_000_000, '2027-01-15');
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('ADVANCE LAB', () => {
  it('generates deterministic 24 red100 real advanced forms and a valid squad', () => {
    const s = prepared();
    expect(prepared()).toEqual(s);
    expect(s.heroes).toHaveLength(24);
    expect(new Set(s.heroes.map(h => `${h.templateId}/${h.branch}`)).size).toBe(24);
    for (const h of s.heroes) {
      expect(h.rarity).toBe('red'); expect(h.level).toBe(100);
      expect(activeForm(GAME.content.heroes[h.templateId], h).advanced).toBe(true);
      expect(h.id).toMatch(/^h\d+$/);
    }
    expect(s.squad.filter(Boolean)).toHaveLength(5);
    expect(setSquad(s, s.squad).squad).toEqual(s.squad);
    expect(sanitizeSave(deserialize(serialize(s)), GAME).warnings).toEqual([]);
    expect(sanitizeSave(deserialize(serialize(s)), GAME).save.heroes).toEqual(s.heroes);
    expect(s.campaign.cleared).toHaveLength(GAME.content.stages.length);
    expect(s.seenUnlocks).toEqual(GAME.unlocks!.features.map(f => f.id));
  });
  it('runs a real late campaign battle using the prepared squad', () => {
    const s = prepared();
    const result = playStage(s, GAME.content.stages.at(-1)!.id, 42, GAME, s.createdAt);
    expect(result.save.battleSeq).toBe(1);
  });
  it('blocks all API calls even with Telegram credentials and mock query', async () => {
    vi.stubEnv('VITE_ADVANCE_LAB', '1');
    vi.stubGlobal('Telegram', { WebApp: { initData: 'real-data' } });
    vi.stubGlobal('location', { search: '?tgmock=1&dev=1' });
    const fetcher = vi.fn();
    const { call, onlineAvailable } = await import('../src/game/online/api');
    expect(onlineAvailable()).toBe(false);
    for (const action of ['hello', 'save_get', 'save_put', 'sync', 'player']) expect(await call(action, {}, { fetcher })).toBe(null);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('namespaces saves and backups without touching normal storage', async () => {
    vi.stubEnv('VITE_ADVANCE_LAB', '1');
    const { SAVE_KEY, LocalStorageAdapter } = await import('../src/game/storage');
    const map = new Map([['chronoworld.save.v1', 'normal'], ['unrelated', 'keep']]);
    const storage = { get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } } as Storage;
    const a = new LocalStorageAdapter(SAVE_KEY, storage);
    a.save(serialize(prepared())); a.backup('backup', 1); a.clear();
    expect(SAVE_KEY).toBe('chronoworld.advanceLab.save.v1');
    expect(map.get('chronoworld.save.v1')).toBe('normal');
    expect(map.get('unrelated')).toBe('keep');
    expect(map.get(`${SAVE_KEY}.backup.1`)).toBe('backup');
    storage.setItem('chronoworld.advanceLab.timeShift', '12');
    clearAdvanceLabExtras(storage);
    expect([...map.entries()]).toEqual([['chronoworld.save.v1', 'normal'], ['unrelated', 'keep']]);
  });
});
