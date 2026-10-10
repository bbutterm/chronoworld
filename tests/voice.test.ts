import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { voiceKey } from '../src/game/voiceKey';
import { voiceFiles } from '../scripts/lib/used-assets';
import { heroesGrown } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const DIR = 'assets/voice/ru';
const GAME = loadFullContext();
const index = (existsSync(`${DIR}/index.json`) ? JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')) : {}) as Record<string, { text: string; role: string }>;

describe('озвучка (assets/voice, scripts/voice-gen.ts)', () => {
  it('ключ не зависит от пробелов по краям и подряд, но различает тексты', () => {
    expect(voiceKey('  Живыми   назад! ')).toBe(voiceKey('Живыми назад!'));
    expect(voiceKey('Живыми назад!')).not.toBe(voiceKey('Живыми назад.'));
    expect(voiceKey('Живыми назад!')).toMatch(/^[0-9a-f]{14}$/);
  });

  it('у каждого клипа есть запись в index.json с тем же ключом текста, и наоборот', () => {
    const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.mp3')).map((f) => f.replace(/\.mp3$/, '')) : [];
    expect(files.sort()).toEqual(Object.keys(index).sort());
    const wrong = Object.entries(index).filter(([key, v]) => voiceKey(v.text) !== key.replace(/-a$/, ''));
    expect(wrong).toEqual([]);
  });

  it('клипы попадают в сборку', () => {
    const used = voiceFiles(process.cwd());
    expect(used.length).toBe(Object.keys(index).length);
  });

  it('личные сцены: у взрослеющих героев есть молодая и взрослая версия (ключ-a), у остальных — одна', () => {
    const bonds = Object.entries(index).filter(([, v]) => (v as { from?: string }).from?.startsWith('bonds/'));
    const adult = bonds.filter(([k]) => k.endsWith('-a'));
    expect(adult.length).toBeGreaterThan(0);
    for (const [k] of adult) expect(index[k.replace(/-a$/, '')]).toBeDefined();
  });

  it('герои взрослеют после главы 4', () => {
    const content = GAME.content;
    const ch4 = content.stages.filter((s) => s.chapter === content.chapters.find((c) => c.order === 4)!.id);
    expect(heroesGrown({ campaign: { cleared: ch4.slice(0, -1).map((s) => s.id) } } as never, content)).toBe(false);
    expect(heroesGrown({ campaign: { cleared: ch4.map((s) => s.id) } } as never, content)).toBe(true);
  });

  it('глава 1 озвучена целиком: каждая реплика сюжета', () => {
    const story = JSON.parse(readFileSync('data/story/chapter1.json', 'utf8')) as { scenes: { lines: { text: string }[] }[] };
    const missing = story.scenes.flatMap((s) => s.lines).filter((l) => !index[voiceKey(l.text)]).map((l) => l.text);
    expect(missing).toEqual([]);
  });
});
