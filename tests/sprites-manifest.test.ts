import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPRITE_RUNTIME_KEYS } from '../src/pipeline/sprites';

const ROOT = join(import.meta.dirname, '..');
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const isRuntime = (k: string) => (SPRITE_RUNTIME_KEYS as readonly string[]).includes(k);

describe('sprites.json — только то, что читает игра (доказательства — в sprites.provenance.json)', () => {
  const runtime = json('assets/sprites/sprites.json') as { sprites: Record<string, unknown>[] } & Record<string, unknown>;

  it('у записей спрайтов нет служебных полей, у манифеста — заметок', () => {
    for (const s of runtime.sprites) expect(Object.keys(s).filter((k) => !isRuntime(k)), String(s.id)).toEqual([]);
    expect(Object.keys(runtime).sort()).toEqual(['animOverrides', 'anims', 'classes', 'columns', 'schema', 'sprites']);
  });

  it('доказательства лежат рядом и ссылаются только на листы из sprites.json', () => {
    const file = 'assets/sprites/sprites.provenance.json';
    expect(existsSync(join(ROOT, file))).toBe(true);
    const prov = json(file) as { sprites: Record<string, Record<string, unknown>> };
    const ids = new Set(runtime.sprites.map((s) => s.id));
    for (const [id, p] of Object.entries(prov.sprites)) {
      expect(ids.has(id), id).toBe(true);
      for (const k of Object.keys(p)) expect(isRuntime(k), `${id}.${k}`).toBe(false);
    }
  });

  it('Python и TypeScript согласны, какие поля игровые (tools/sprites_manifest.py)', () => {
    const py = readFileSync(join(ROOT, 'tools/sprites_manifest.py'), 'utf8');
    const m = py.match(/^RUNTIME_KEYS = \(([^)]*)\)/m);
    expect(m).not.toBeNull();
    const keys = m![1]
      .split(',')
      .map((x) => x.trim().replace(/'/g, ''))
      .filter(Boolean);
    expect(keys).toEqual([...SPRITE_RUNTIME_KEYS]);
  });
});
