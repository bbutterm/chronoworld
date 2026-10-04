import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { skillFx, animatedEffect } from '../src/game/animatedFx';
import { lookOf } from '../src/game/skillLook';
import { visualOf } from '../src/game/skillVisuals';
import { loadFullContext } from '../scripts/lib/content-node';

vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1, NORMAL: 0 } } }));
import { signatureDef } from '../src/game/skillSigs';

const skills = loadFullContext().content.skills;
const scene = readFileSync(new URL('../src/game/scenes/BattleScene.ts', import.meta.url), 'utf8');
// Execute the actual dispatcher methods without booting Phaser or a browser.
function method(name: string, deps: Record<string, unknown>) {
  const start = scene.indexOf(`  private ${name}(`);
  const end = scene.indexOf('\n  }', start) + 4;
  const js = stripTypeScriptTypes(`class Harness { ${scene.slice(start, end)} }`);
  return new Function(...Object.keys(deps), `${js}; return Harness.prototype.${name};`)(...Object.values(deps));
}
const point = (v: any) => ({ x: v.node.x, y: v.node.y - 60, feet: v.node.y });
const unit = (uid: string, x: number, side = 'A') => ({ snap: { uid, side }, node: { x, y: 300 }, hitPlan: new Map() });

function dispatch(skill: any, events: any[]) {
  const caster = unit('caster', 100);
  const targets = [unit('one', 400, skill.target.side === 'ally' ? 'A' : 'B'), unit('two', 600, skill.target.side === 'ally' ? 'A' : 'B')];
  const flyAtlas = vi.fn();
  const playSignature = vi.fn((_fx, _sig, k, delay) => k.hits.map(() => delay + 150));
  const ctx: any = {
    result: { log: [{ t: 1 }, ...events] }, cursor: 0, time: { now: 0 },
    views: new Map(targets.map(v => [v.snap.uid, v])), point,
    loadedFx: skillFx, floats: { catalogFlash: vi.fn() },
    sfx: { later: (_delay: number, fn: () => void) => fn(), areaAt: vi.fn(() => 360), shake: vi.fn() },
  };
  ctx.eventTargets = method('eventTargets', {});
  ctx.groundCue = method('groundCue', { skillFx, avg: (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length });
  const run = method('skillVisualInner', { lookOf, visualOf, COMBAT: { projectileSeconds: 0.3 }, playSignature, flyAtlas, avg: (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length });
  expect(run.call(ctx, caster, skill, 100)).toBe(true);
  return { ctx, caster, flyAtlas, playSignature };
}

describe('bounded RO atlas integration', () => {
  it('maps authentic roles without a Frost Diver alias or impact flask', () => {
    expect(skillFx('job_alchemist_acid_terror')).toEqual({ projectile: 'fx_job_alchemist_acid_terror_projectile' });
    expect(skillFx('job_archer_arrow_shower')).toEqual({ projectile: 'fx_job_archer_arrow_shower_source' });
    expect(skillFx('job_sage_volcano')).toEqual({ ground: 'fx_job_sage_volcano_ground' });
    expect(skillFx('job_mage_frost_diver')?.projectile).toBe('fx_job_mage_frost_diver_spikes');
    expect(animatedEffect('fx_job_mage_frost_diver_release')).toBeUndefined();
    expect(animatedEffect('fx_job_mage_frost_diver_spikes')).toMatchObject({ file: 'effects/fx_job_mage_frost_diver_release.png', ms: 60, scale: 1.5, anchor: [13, 146] });
  });

  it('flies the animated acid flask for 380ms and retains its landing splash', () => {
    const image: any = {};
    for (const name of ['setFrame', 'setOrigin', 'setDisplaySize', 'setPosition']) image[name] = vi.fn(() => image);
    const fx: any = { boost: 1, img: vi.fn(() => image), run: vi.fn(), splat: vi.fn(), glow: vi.fn(), blobs: vi.fn(), puffCloud: vi.fn(), rise: vi.fn(), later: vi.fn() };
    const p = { x: 500, y: 240, feet: 300 };
    const k = { c: { x: 100, y: 240, feet: 300 }, hits: [p], uniq: [p], dir: 1, tint: 0xc8f040, atlas: skillFx('job_alchemist_acid_terror') };
    const recipe = signatureDef('acidTerror');
    recipe.draw(fx, k);
    expect(recipe.hit(k, 0)).toBe(380);
    expect(fx.img).toHaveBeenCalledWith('anim_fx_job_alchemist_acid_terror_projectile', 100, 210, 0xffffff, expect.any(Number), 0);
    const [, duration, tick, delay, land] = fx.run.mock.calls[0];
    expect([duration, delay]).toEqual([380, 0]);
    tick(0.5, image);
    expect(image.setFrame).toHaveBeenLastCalledWith(2);
    expect(fx.splat).not.toHaveBeenCalled();
    land();
    expect(fx.splat).toHaveBeenCalled();
    expect(fx.img).toHaveBeenCalledTimes(1);
  });

  it('dispatches Arrow Shower through flying catalog projectiles, preserving area timing', () => {
    const { flyAtlas, playSignature, caster } = dispatch(skills.job_archer_arrow_shower, ['one', 'two'].map(target => ({ t: 1.3, type: 'damage', source: 'caster', target })));
    expect(playSignature).not.toHaveBeenCalled();
    expect(flyAtlas).toHaveBeenCalledTimes(2);
    for (const args of flyAtlas.mock.calls) {
      expect(args[1]).toBe('fx_job_archer_arrow_shower_source');
      expect(args[2].y).toBeLessThan(args[3].y);
      expect(args[4]).toBe(240);
    }
    expect(caster).toHaveProperty('impactAt', 360);
    expect(animatedEffect('fx_job_archer_arrow_shower_source')?.frames).toBe(1);
  });

  it('emits one caster ground atlas for a Volcano cast with two allied status recipients', () => {
    const { ctx, playSignature } = dispatch(skills.job_sage_volcano, ['one', 'two'].map(target => ({ t: 1, type: 'status', action: 'apply', source: 'caster', target })));
    expect(playSignature.mock.calls[0][2].uniq).toHaveLength(2);
    expect(ctx.floats.catalogFlash).toHaveBeenCalledTimes(1);
    expect(ctx.floats.catalogFlash).toHaveBeenCalledWith(100, 300, 'fx_job_sage_volcano_ground', 320, undefined, 100, true);
    // Loaded ground art replaces only the caster recipe, not the ally status/aura path.
    expect(() => signatureDef('volcano').draw({} as any, playSignature.mock.calls[0][2])).not.toThrow();
  });
});
