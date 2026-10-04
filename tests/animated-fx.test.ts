import { describe, expect, it } from 'vitest';
import { animatedEffect, animatedFrameAt, animatedFxDuration, animatedFxKey, loopFrameAt, queueAnimatedFx, selectedAnimatedEffect } from '../src/game/animatedFx';
import catalogJson from '../assets/effects/effects.json';

describe('RO animated effects', () => {
  it('queues all captured and authored atlases with catalog cell sizes', () => {
    const queued: Array<[string, string, number, number]> = [];
    queueAnimatedFx((key, file, w, h) => queued.push([key, file, w, h]));
    expect(queued).toHaveLength(106);
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

  it('registers the 13 original veteran atlases with their authored frame metadata', () => {
    const jobs = ['lord_knight', 'paladin', 'sniper', 'clown', 'gypsy', 'high_wizard', 'professor', 'assassin_cross', 'stalker', 'high_priest', 'champion', 'whitesmith', 'creator'];
    const catalog = catalogJson as { effects: Array<Record<string, unknown>> };
    for (const job of jobs) {
      const id = `fx_job_veteran_${job}`;
      const effect = catalog.effects.find((row) => row.id === id)!;
      expect(effect, id).toBeDefined();
      expect(effect).toMatchObject({ file: `effects/${id}.png`, cell: [128, 128], columns: 6, frames: 24, ms: 35, anchor: [64, 64], attach: 'target' });
      expect(effect.source).toMatchObject({ kind: 'original' });
    }
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
  it('maps all 76 veteran skills to their class atlas and mechanical event roles', async () => {
    const { loadFullContext } = await import('../scripts/lib/content-node');
    const content = loadFullContext().content;
    const catalog = catalogJson as { skills: Record<string, Record<string, string>> };
    const ids = Object.keys(content.skills).filter((id) => id.startsWith('adv_') || id.startsWith('ult_adv_'));
    expect(ids).toHaveLength(76);
    for (const id of ids) {
      const skill = content.skills[id];
      const roles = catalog.skills[id];
      const types = new Set(skill.effects.map((effect) => effect.type));
      expect(roles, id).toBeDefined();
      expect(new Set(Object.values(roles)).size, id).toBe(1);
      const atlas = Object.values(roles)[0];
      expect(atlas, id).toMatch(/^fx_job_veteran_/);
      expect(animatedEffect(atlas), id).toMatchObject({ frames: 24, columns: 6, cell: [128, 128] });
      if (types.has('damage')) expect(roles.hit, `${id}: damage`).toBe(atlas);
      if (types.has('shield') || types.has('heal') || (types.has('status') && skill.target.side === 'ally')) expect(roles.buff, `${id}: apply`).toBe(atlas);
      if (types.has('status') && skill.target.side === 'enemy') expect(roles.debuff, `${id}: hostile status`).toBe(atlas);
      if (types.size === 1 && types.has('energy')) expect(roles.cast, `${id}: caster proc`).toBe(atlas);
    }
  });

  it('maps verified direct and shared RO effects to the correct battle event', async () => {
    const { skillFx } = await import('../src/game/animatedFx');
    expect(skillFx('swordman_endure')?.buff).toBe('fx_swordman_endure');
    expect(skillFx('job_knight_two_hand_quicken')?.buff).toBe('fx_job_knight_two_hand_quicken');
    expect(skillFx('job_sage_earth_spike')?.hit).toBe('fx_job_sage_earth_spike');
    // Яд монстров — эффект монстрового навыка RO NPC_POISON (192), а не Отравление вора (жалоба 30.09 «чужие эффекты»).
    expect(skillFx('mob2_ranged_poison_arrow')?.hit).toBe('fx_npc_poison');
    // Аудит 30.09: иероглиф 滅 Звукового удара — только у самого Звукового удара, не на каждом разрезе монстров.
    expect(skillFx('mob3_melee_rend')).toBeUndefined();
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
    // Летящий щит — только у Удара щитом (не у якоря, прыжка и удара предка).
    // 30.09: у якоря теперь звёзды оглушения монстров RO (NPC_STUNATTACK 194), но не щит.
    expect(skillFx('mob6_bosun_anchor')).toEqual({ hit: 'fx_npc_stun_attack' });
    expect(skillFx('job_mage_frost_diver')?.projectile).toBe('fx_job_mage_frost_diver_spikes');
    expect(skillFx('job_sage_heavens_drive')?.ground).toBeUndefined();
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
    const idle = catalog.effects.map((e) => e.id).filter((id) => !used.has(id) && !(id in rejected) && /^fx_(job|swordman|npc)_/.test(id));
    expect(idle).toEqual([]);
  });

  it('аудит 30.09: у каждого атласа навыка свой масштаб и смешивание, в разумных пределах', () => {
    const catalog = catalogJson as { effects: { id: string }[] };
    for (const { id } of catalog.effects.filter((e) => /^fx_(job|swordman|npc)_/.test(e.id))) {
      const e = animatedEffect(id)!;
      expect(e.scale, `${id}: scale`).toBeGreaterThan(0.5);
      expect(e.scale!, `${id}: scale`).toBeLessThan(4);
      expect(['add', 'normal']).toContain(e.blend);
      // Самый крупный кадр на экране — не шире поля 1080 (Буря, Великий крест).
      expect(e.cell[0] * e.scale!, `${id}: ширина на экране`).toBeLessThanOrEqual(1080);
      if (e.alpha !== undefined) expect(e.alpha).toBeGreaterThan(0.3);
    }
    // Светящиеся эффекты RO — ADD (как в клиенте), твёрдые предметы — normal.
    expect(animatedEffect('fx_job_wizard_storm_gust')!.blend).toBe('add');
    expect(animatedEffect('fx_job_acolyte_holy_light')!.blend).toBe('add');
    expect(animatedEffect('fx_job_thief_venom_knife_projectile')!.blend).toBe('normal');
    // Щит Удара щитом прилетает справа — у героя слева кадр отражается.
    expect(animatedEffect('fx_job_crusader_shield_charge')!.from).toBe('right');
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
