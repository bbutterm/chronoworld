import { describe, expect, it } from 'vitest';
import { animatedEffect, animatedFrameAt, animatedFxDuration, animatedFxKey, queueAnimatedFx, selectedAnimatedEffect } from '../src/game/animatedFx';

describe('RO animated effects', () => {
  it('queues all eight atlases with catalog cell sizes', () => {
    const queued: Array<[string, string, number, number]> = [];
    queueAnimatedFx((key, file, w, h) => queued.push([key, file, w, h]));
    expect(queued).toHaveLength(8);
    expect(queued).toContainEqual(['anim_fx_hit', 'effects/fx_hit.png', 580, 440]);
    expect(queued).toContainEqual(['anim_fx_arrow', 'effects/fx_arrow.png', 66, 12]);
    expect(queued).toContainEqual(['anim_fx_job_mage_thunderstorm', 'effects/fx_job_mage_thunderstorm.png', 278, 318]);
    expect(queued).toContainEqual(['anim_fx_job_acolyte_blessing', 'effects/fx_job_acolyte_blessing.png', 98, 206]);
  });

  it('plays authored frames without entering blank trailing cells', () => {
    const shield = animatedEffect('fx_shield')!;
    expect(shield.frames).toBe(3);
    expect(shield.delayMs).toBe(83);
    expect(animatedFrameAt(shield, 0)).toBe(-1);
    expect(animatedFrameAt(shield, shield.delayMs)).toBe(0);
    expect(animatedFrameAt(shield, shield.delayMs + shield.ms)).toBe(1);
    expect(animatedFrameAt(shield, 99999)).toBe(2);
    expect(animatedFxDuration(shield)).toBeCloseTo(83 + 3 * shield.ms);
  });

  it('keeps the delayed death and the one-frame travelling arrow', () => {
    const death = animatedEffect('fx_death')!;
    expect(death.delayMs).toBe(500);
    expect(animatedFrameAt(death, 499)).toBe(-1);
    expect(animatedFrameAt(death, 500)).toBe(0);
    const arrow = animatedEffect('fx_arrow')!;
    expect(animatedFrameAt(arrow, 120)).toBe(0);
    expect(animatedFxKey('fx_arrow')).toBe('anim_fx_arrow');
    expect(animatedEffect('unknown')).toBeUndefined();
  });

  it('uses a static fallback when the atlas is unavailable or the magic impact is used as a projectile', () => {
    expect(selectedAnimatedEffect('fx_hit', 'flash', true)?.id).toBe('fx_hit');
    expect(selectedAnimatedEffect('fx_arrow', 'projectile', true)?.id).toBe('fx_arrow');
    expect(selectedAnimatedEffect('fx_magic', 'projectile', true)).toBeUndefined();
    expect(selectedAnimatedEffect('fx_heal', 'flash', false)).toBeUndefined();
    expect(selectedAnimatedEffect('other', 'flash', true)).toBeUndefined();
  });
});

describe('эффекты навыков (effects.json → skills)', () => {
  it('maps the two new animated skill effects', async () => {
    const { skillFx } = await import('../src/game/animatedFx');
    expect(skillFx('job_mage_thunderstorm')?.hit).toBe('fx_job_mage_thunderstorm');
    expect(skillFx('job_acolyte_blessing')?.buff).toBe('fx_job_acolyte_blessing');
  });
  it('skillFx: нет привязки — undefined, без id — undefined', async () => {
    const { skillFx } = await import('../src/game/animatedFx');
    expect(skillFx(undefined)).toBeUndefined();
    expect(skillFx('no_such_skill')).toBeUndefined();
  });
});
