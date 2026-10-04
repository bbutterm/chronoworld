import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { animatedEffect, animatedFxIds, skillFx } from '../src/game/animatedFx';
import { projectEffectsCatalog } from '../src/pipeline/effects';
import { trimEffectsJson } from '../scripts/lib/trim-effects';

const path = new URL('../assets/effects/effects.json', import.meta.url);
const source = readFileSync(path, 'utf8');
const full = JSON.parse(source);

describe('build-only effects projection', () => {
  it('preserves every runtime effect and skill role without changing source provenance', () => {
    const projected = projectEffectsCatalog(full);
    expect(projected.effects).toHaveLength(114);
    expect(projected.effects.map(e => e.id)).toEqual(animatedFxIds());
    for (const effect of projected.effects) {
      expect(effect).toEqual(animatedEffect(effect.id));
      const original = full.effects.find((e: { id: string }) => e.id === effect.id);
      for (const key of ['id', 'file', 'cell', 'columns', 'frames', 'ms', 'delayMs', 'anchor', 'scale', 'alpha', 'rise', 'from'] as const) {
        expect(effect[key]).toEqual(original[key]);
      }
      expect(effect.blend).toBe(original.blend === 'add' ? 'add' : 'normal');
      expect(effect).not.toHaveProperty('source');
      expect(effect).not.toHaveProperty('attach');
      expect(effect).not.toHaveProperty('loop');
    }
    expect(projected.skills).toEqual(full.skills);
    for (const id of Object.keys(full.skills)) expect((projected.skills as typeof full.skills)[id]).toEqual(skillFx(id));
    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(full).length);
    expect(full.effects.some((e: { source?: unknown }) => e.source)).toBe(true);
    expect(full.rejected).toBeDefined();
    expect(readFileSync(path, 'utf8')).toBe(source);
  });

  it('transforms only plain effects JSON in builds, leaving raw queries and sprites alone', () => {
    const plugin = trimEffectsJson();
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');
    const transform = plugin.transform as (code: string, id: string) => { code: string; map: null } | null;
    const result = transform(source, path.pathname)!;
    expect(JSON.parse(result.code)).toEqual(JSON.parse(JSON.stringify(projectEffectsCatalog(full))));
    for (const id of [path.pathname + '?raw', path.pathname + '?url', '/assets/sprites/sprites.json']) {
      expect(transform('not JSON', id)).toBeNull();
    }
  });
});
