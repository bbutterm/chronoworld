import type { Plugin } from 'vite';
import { projectEffectsCatalog } from '../../src/pipeline/effects.ts';

/** Only build-time JSON modules, never raw/url imports or the source on disk. */
export function trimEffectsJson(): Plugin {
  return {
    name: 'idle-rpg:trim-effects-json',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]assets[\\/]effects[\\/]effects\.json$/.test(id)) return null;
      return { code: JSON.stringify(projectEffectsCatalog(JSON.parse(code))), map: null };
    },
  };
}
