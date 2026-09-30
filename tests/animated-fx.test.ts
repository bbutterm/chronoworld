import { describe, expect, it } from 'vitest';
import { animatedEffect, animatedFrameAt, animatedFxDuration, animatedFxKey, loopFrameAt, queueAnimatedFx, selectedAnimatedEffect } from '../src/game/animatedFx';

describe('RO animated effects', () => {
  it('queues all 43 captured atlases (42 листа, осколок Frost Diver — два вида) with catalog cell sizes', () => {
    const queued: Array<[string, string, number, number]> = [];
    queueAnimatedFx((key, file, w, h) => queued.push([key, file, w, h]));
    expect(queued).toHaveLength(43);
    expect(queued).toContainEqual(['anim_fx_job_sage_volcano_ground', 'effects/fx_job_sage_volcano_ground.png', 122, 98]);
    expect(queued).toContainEqual(['anim_fx_job_thief_venom_knife_projectile', 'effects/fx_job_thief_venom_knife_projectile.png', 42, 38]);
    expect(queued).toContainEqual(['anim_fx_job_thief_steal', 'effects/fx_job_thief_steal.png', 188, 176]);
    expect(queued).toContainEqual(['anim_fx_job_swordman_magnum_break', 'effects/fx_job_swordman_magnum_break.png', 276, 198]);
    expect(queued).toContainEqual(['anim_fx_swordman_endure', 'effects/fx_swordman_endure.png', 156, 156]);
    expect(queued).toContainEqual(['anim_fx_job_wizard_meteor_storm', 'effects/fx_job_wizard_meteor_storm.png', 250, 458]);
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
  it('maps verified direct and shared RO effects to the correct battle event', async () => {
    const { skillFx } = await import('../src/game/animatedFx');
    expect(skillFx('swordman_endure')?.buff).toBe('fx_swordman_endure');
    expect(skillFx('job_knight_two_hand_quicken')?.buff).toBe('fx_job_knight_two_hand_quicken');
    expect(skillFx('job_sage_earth_spike')?.hit).toBe('fx_job_sage_earth_spike');
    expect(skillFx('mob2_ranged_poison_arrow')?.hit).toBe('fx_job_thief_envenom');
    expect(skillFx('mob3_melee_rend')?.hit).toBe('fx_job_assassin_sonic_blow');
    expect(skillFx('job_mage_thunderstorm')?.hit).toBe('fx_job_mage_thunderstorm');
    expect(skillFx('job_acolyte_blessing')?.buff).toBe('fx_job_acolyte_blessing');
    expect(skillFx('job_mage_fire_bolt')?.hit).toBe('fx_job_mage_fire_bolt');
    expect(skillFx('job_mage_fire_ball')?.hit).toBe('fx_job_mage_fire_bolt');
    expect(skillFx('job_mage_frost_diver')?.hit).toBe('fx_job_mage_frost_diver');
    expect(skillFx('job_merchant_cart_revolution')?.hit).toBe('fx_job_merchant_cart_revolution');
    expect(skillFx('job_acolyte_holy_light')?.hit).toBe('fx_job_acolyte_holy_light');
    expect(skillFx('job_acolyte_increase_agi')?.buff).toBe('fx_job_acolyte_increase_agi');
    expect(skillFx('job_acolyte_signum_crucis')).toEqual({ debuff: 'fx_job_acolyte_signum_crucis' });
    expect(skillFx('job_mage_fire_ball')?.hit).not.toBe('fx_job_mage_fire_ball_projectile');
    expect(skillFx('job_thief_envenom')?.hit).toBe('fx_job_thief_envenom');
    expect(skillFx('job_crusader_defender')?.buff).toBe('fx_job_crusader_defender');
    expect(skillFx('job_blacksmith_weapon_perfection')?.buff).toBe('fx_job_blacksmith_weapon_perfection');
    expect(skillFx('job_assassin_sonic_blow')?.hit).toBe('fx_job_assassin_sonic_blow');
    expect(skillFx('job_crusader_holy_cross')?.hit).toBe('fx_job_crusader_holy_cross');
    expect(skillFx('job_crusader_shield_charge')?.hit).toBe('fx_job_crusader_shield_charge');
    expect(skillFx('job_hunter_claymore_trap')?.hit).toBe('fx_job_hunter_claymore_trap');
    expect(skillFx('swordman_bash')).toEqual({ cast: 'fx_swordman_bash' });
    expect(skillFx('job_crusader_grand_cross')).toEqual({ ground: 'fx_job_crusader_grand_cross' });
    expect(skillFx('job_wizard_storm_gust')).toEqual({ ground: 'fx_job_wizard_storm_gust' });
    expect(skillFx('job_hunter_sandman')).toEqual({ debuff: 'fx_job_hunter_sandman' });
    for (const id of ['swordman_bash', 'job_crusader_grand_cross', 'job_wizard_storm_gust', 'job_acolyte_signum_crucis', 'job_hunter_sandman']) {
      const roles = skillFx(id)!;
      expect(roles.hit).toBeUndefined();
      expect(roles.buff).toBeUndefined();
      for (const fxId of Object.values(roles)) expect(animatedEffect(fxId)).toBeDefined();
    }
    // Роль projectile (29.09): кадры EF_FIREBALL летят от мага к цели (skillSigs flyAtlas, кадры по кругу),
    // попадание — по-прежнему отдельный лист огня.
    expect(skillFx('job_mage_fire_ball')?.projectile).toBe('fx_job_mage_fire_ball_projectile');
    expect(skillFx('job_thief_venom_knife')?.projectile).toBe('fx_job_thief_venom_knife_projectile');
    expect(skillFx('job_wizard_jupitel_thunder')).toEqual({ projectile: 'fx_job_wizard_jupitel_thunder_projectile', hit: 'fx_job_wizard_jupitel_thunder_target' });
  });
  it('все привязки: навык есть в контенте, роль известна, атлас есть в каталоге; каждый атлас к чему-то привязан', async () => {
    const { skillFx: _unused } = await import('../src/game/animatedFx');
    void _unused;
    const { loadFullContext } = await import('../scripts/lib/content-node');
    const catalog = (await import('../assets/effects/effects.json')).default as unknown as { effects: { id: string }[]; skills: Record<string, Record<string, string>> };
    const skills = loadFullContext().content.skills;
    const roles = new Set(['hit', 'buff', 'cast', 'ground', 'debuff', 'projectile']);
    const used = new Set<string>();
    for (const [skill, map] of Object.entries(catalog.skills)) {
      expect(skills[skill], `нет навыка ${skill}`).toBeDefined();
      for (const [role, fx] of Object.entries(map)) {
        expect(roles.has(role), `${skill}: роль ${role}`).toBe(true);
        expect(animatedEffect(fx), `${skill}: нет атласа ${fx}`).toBeDefined();
        used.add(fx);
      }
    }
    // Общие (fx_hit, fx_heal…) рисуются правилами боя; все атласы навыков fx_job_* / fx_swordman_* должны быть подключены.
    // Отклонённые аудитом (effects.json → rejected: id → почему, «нужен арт») не привязываются ни к чему.
    const rejected = (catalog as unknown as { rejected?: Record<string, string> }).rejected ?? {};
    for (const id of Object.keys(rejected)) {
      expect(animatedEffect(id), `rejected: нет атласа ${id}`).toBeDefined();
      expect(used.has(id), `отклонённый атлас ${id} привязан к навыку`).toBe(false);
    }
    const idle = catalog.effects.map((e) => e.id).filter((id) => !used.has(id) && !(id in rejected) && /^fx_(job|swordman)_/.test(id));
    expect(idle).toEqual([]);
  });

  it('летящий атлас: кадры по кругу без паузы', () => {
    const knife = animatedEffect('fx_job_thief_venom_knife_projectile')!;
    expect(loopFrameAt(knife, 0)).toBe(0);
    expect(loopFrameAt(knife, knife.ms)).toBe(1);
    expect(loopFrameAt(knife, knife.ms * 2)).toBe(0);
    expect(loopFrameAt(animatedEffect('fx_job_archer_arrow_shower_source')!, 999)).toBe(0);
  });

  it('skillFx: нет привязки — undefined, без id — undefined', async () => {
    const { skillFx } = await import('../src/game/animatedFx');
    expect(skillFx(undefined)).toBeUndefined();
    expect(skillFx('no_such_skill')).toBeUndefined();
  });
});
