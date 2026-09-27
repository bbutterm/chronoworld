import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { existsSync } from 'node:fs';
import { buffColor, lookOf, RO_SKILL_ICONS, statusIconOf } from '../src/game/skillLook';
import { skillIconFiles, usedAssets } from '../scripts/lib/used-assets';

const skills = loadFullContext().content.skills;
const look = (id: string) => lookOf(skills[id]);

describe('вид навыка (значок и эффекты боя)', () => {
  it('у каждого навыка есть стихия и значок; пассивки помечены', () => {
    for (const s of Object.values(skills)) {
      const l = lookOf(s);
      expect(l.element, s.id).toBeTruthy();
      expect(l.glyph, s.id).toBeTruthy();
      expect(l.passive, s.id).toBe(!!s.trigger);
    }
  });

  it('магия мага: огненная стрела — огненный шар, ледяной удар — осколок, гроза — молнии по площади', () => {
    expect(look('job_mage_fire_bolt')).toMatchObject({ element: 'fire', glyph: 'flame', projectile: 'fireball' });
    expect(look('job_mage_frost_diver')).toMatchObject({ element: 'ice', projectile: 'ice' });
    expect(look('job_mage_thunderstorm')).toMatchObject({ element: 'wind', glyph: 'bolt', area: 'lightning', aoe: true });
  });

  it('аколит: лечение — крест, благословение и ускорение — баффы, святой свет — луч', () => {
    expect(look('job_acolyte_heal')).toMatchObject({ element: 'holy', glyph: 'cross' });
    expect(look('job_acolyte_blessing').glyph).toBe('up');
    expect(look('job_acolyte_increase_agi').glyph).toBe('haste');
    expect(look('job_acolyte_holy_light').projectile).toBe('beam');
    expect(look('job_priest_sanctuary').area).toBe('sanctuary');
  });

  it('мечник и лучник: провокация «!», магнум брейк — кольцо, дождь стрел — стрелы сверху', () => {
    expect(look('job_swordman_provoke').glyph).toBe('bang');
    expect(look('job_swordman_magnum_break')).toMatchObject({ element: 'fire', area: 'ring' });
    expect(look('job_archer_arrow_shower')).toMatchObject({ glyph: 'arrows', area: 'arrows' });
    expect(look('basic_melee')).toMatchObject({ element: 'physical', glyph: 'sword' });
  });

  it('значки статусов и цвет искр баффа', () => {
    const st = (skill: string) => skills[skill].effects.find((e) => e.type === 'status')!;
    const status = (skill: string) => (st(skill) as Extract<ReturnType<typeof st>, { type: 'status' }>).status;
    expect(statusIconOf(status('job_acolyte_blessing'))).toBe('atkUp');
    expect(statusIconOf(status('job_acolyte_increase_agi'))).toBe('spdUp');
    expect(statusIconOf(status('job_thief_envenom'))).toBe('poison');
    expect(statusIconOf(status('job_mage_frost_diver'))).toBe('stun');
    expect(statusIconOf(status('job_swordman_provoke'))).toBe('defDown');
    expect(buffColor(status('job_acolyte_increase_agi'))).not.toBe(buffColor(status('job_acolyte_blessing')));
  });

  it('иконки RO: каждый навык из таблицы существует, файл лежит в assets/ui/icons', () => {
    for (const [id, ro] of Object.entries(RO_SKILL_ICONS)) {
      expect(skills[id], id).toBeTruthy();
      expect(existsSync(`assets/ui/icons/skill_${ro}.png`), ro).toBe(true);
    }
    // Все навыки первых профессий и новичка — с настоящей иконкой.
    const ctx = loadFullContext();
    for (const job of ['novice', 'swordman', 'thief', 'archer', 'mage', 'acolyte', 'merchant']) {
      // Ангелус (новый навык) — иконки RO пока нет, рисуется кодом.
      for (const s of ctx.content.jobs[job].skills.filter((x) => x.skill !== 'job_acolyte_angelus')) expect(RO_SKILL_ICONS[s.skill], `${job}: ${s.skill}`).toBeTruthy();
    }
  });

  it('PNG значков от художника попадают в сборку', () => {
    const used = usedAssets({ manifest: { assets: {} }, spriteIds: [], skillIcons: ['ui/icons/skill_job_mage_fire_bolt.png'] });
    expect(used.files).toContain('ui/icons/skill_job_mage_fire_bolt.png');
    expect(Array.isArray(skillIconFiles('/nonexistent'))).toBe(true);
  });
});
