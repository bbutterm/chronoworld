import { describe, expect, it } from 'vitest';
import { animatedEffect, animatedFrameAt, animatedFxDuration, animatedFxKey, queueAnimatedFx, selectedAnimatedEffect } from '../src/game/animatedFx';

describe('RO animated effects', () => {
  it('queues all 26 captured atlases with catalog cell sizes', () => {
    const queued: Array<[string, string, number, number]> = [];
    queueAnimatedFx((key, file, w, h) => queued.push([key, file, w, h]));
    expect(queued).toHaveLength(26);
    expect(queued).toContainEqual(['anim_fx_hit', 'effects/fx_hit.png', 580, 440]);
    expect(queued).toContainEqual(['anim_fx_arrow', 'effects/fx_arrow.png', 66, 12]);
    expect(queued).toContainEqual(['anim_fx_job_mage_thunderstorm', 'effects/fx_job_mage_thunderstorm.png', 278, 318]);
    expect(queued).toContainEqual(['anim_fx_job_acolyte_blessing', 'effects/fx_job_acolyte_blessing.png', 98, 206]);
    expect(queued).toContainEqual(['anim_fx_job_mage_fire_ball_projectile', 'effects/fx_job_mage_fire_ball_projectile.png', 104, 44]);
    expect(queued).toContainEqual(['anim_fx_job_acolyte_signum_crucis', 'effects/fx_job_acolyte_signum_crucis.png', 236, 260]);
    expect(queued).toContainEqual(['anim_fx_job_crusader_holy_cross', 'effects/fx_job_crusader_holy_cross.png', 442, 442]);
    expect(queued).toContainEqual(['anim_fx_job_wizard_storm_gust', 'effects/fx_job_wizard_storm_gust.png', 362, 308]);
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
  it('maps only verified hit and buff RO skill effects', async () => {
    const { skillFx } = await import('../src/game/animatedFx');
    expect(skillFx('job_mage_thunderstorm')?.hit).toBe('fx_job_mage_thunderstorm');
    expect(skillFx('job_acolyte_blessing')?.buff).toBe('fx_job_acolyte_blessing');
    expect(skillFx('job_mage_fire_bolt')?.hit).toBe('fx_job_mage_fire_bolt');
    expect(skillFx('job_mage_fire_ball')?.hit).toBe('fx_job_mage_fire_bolt');
    expect(skillFx('job_mage_frost_diver')?.hit).toBe('fx_job_mage_frost_diver');
    expect(skillFx('job_merchant_cart_revolution')?.hit).toBe('fx_job_merchant_cart_revolution');
    expect(skillFx('job_acolyte_holy_light')?.hit).toBe('fx_job_acolyte_holy_light');
    expect(skillFx('job_acolyte_increase_agi')?.buff).toBe('fx_job_acolyte_increase_agi');
    expect(skillFx('job_acolyte_signum_crucis')).toBeUndefined();
    expect(skillFx('job_mage_fire_ball')?.hit).not.toBe('fx_job_mage_fire_ball_projectile');
    expect(skillFx('job_thief_envenom')?.hit).toBe('fx_job_thief_envenom');
    expect(skillFx('job_crusader_defender')?.buff).toBe('fx_job_crusader_defender');
    expect(skillFx('job_blacksmith_weapon_perfection')?.buff).toBe('fx_job_blacksmith_weapon_perfection');
    expect(skillFx('job_assassin_sonic_blow')?.hit).toBe('fx_job_assassin_sonic_blow');
    expect(skillFx('job_crusader_holy_cross')?.hit).toBe('fx_job_crusader_holy_cross');
    expect(skillFx('job_crusader_shield_charge')?.hit).toBe('fx_job_crusader_shield_charge');
    expect(skillFx('job_hunter_claymore_trap')?.hit).toBe('fx_job_hunter_claymore_trap');
    expect(skillFx('swordman_bash')).toBeUndefined(); // EF_BASH is a cast cue, not a hit
    expect(skillFx('job_crusader_grand_cross')).toBeUndefined(); // ground area needs a hook
    expect(skillFx('job_wizard_storm_gust')).toBeUndefined(); // ground area needs a hook
    expect(skillFx('job_hunter_sandman')).toBeUndefined(); // enemy status needs a hook
  });
  it('skillFx: нет привязки — undefined, без id — undefined', async () => {
    const { skillFx } = await import('../src/game/animatedFx');
    expect(skillFx(undefined)).toBeUndefined();
    expect(skillFx('no_such_skill')).toBeUndefined();
  });
});
