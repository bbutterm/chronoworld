import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioFiles } from '../scripts/lib/used-assets';
import { AMBIENCE_IDS, MUSIC, MUSIC_IDS, SFX, SFX_IDS, SUMMON_REVEAL } from '../src/game/audioCatalog';
import {
  AUDIO_KEY,
  categoryVolume,
  DEFAULT_AUDIO,
  loadAudioSettings,
  MAX_VOICES,
  MuteReasons,
  nextVolume,
  PitchStreak,
  ruleOf,
  saveAudioSettings,
  sceneSound,
  SfxLimiter,
  volumeLabel,
} from '../src/game/audioCore';
import { hasRecipe, musicJob, synthAmbience, synthMusic, synthSfx } from '../src/game/audioSynth';
import { battleSound, weaponOf } from '../src/game/battleAudio';
import { simulateBattle, type UnitDef } from '../src/core';
import { CONTENT } from '../src/game/content';

function memStore() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('звук: настройки громкости (localStorage)', () => {
  it('пустое хранилище — значения по умолчанию', () => {
    expect(loadAudioSettings(memStore())).toEqual(DEFAULT_AUDIO);
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO);
  });

  it('сохраняются и читаются обратно под своим ключом', () => {
    const s = memStore();
    saveAudioSettings({ music: 0.25, sfx: 1, muted: true }, s);
    expect(s.m.has(AUDIO_KEY)).toBe(true);
    expect(loadAudioSettings(s)).toEqual({ music: 0.25, sfx: 1, muted: true });
  });

  it('мусор, чужие типы и выход за 0…1 не ломают игру', () => {
    const s = memStore();
    s.setItem(AUDIO_KEY, '{oops');
    expect(loadAudioSettings(s)).toEqual(DEFAULT_AUDIO);
    s.setItem(AUDIO_KEY, JSON.stringify({ music: 7, sfx: -1, muted: 'yes' }));
    expect(loadAudioSettings(s)).toEqual({ music: 1, sfx: 0, muted: false });
    s.setItem(AUDIO_KEY, 'null');
    expect(loadAudioSettings(s)).toEqual(DEFAULT_AUDIO);
  });

  it('хранилище бросает — чтение даёт умолчания, запись молча не запоминает', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadAudioSettings(bad)).toEqual(DEFAULT_AUDIO);
    expect(() => saveAudioSettings({ music: 1, sfx: 1, muted: false }, bad)).not.toThrow();
  });

  it('шаги громкости по кругу и подписи', () => {
    const seen = [0];
    let v = 0;
    for (let i = 0; i < 5; i++) seen.push((v = nextVolume(v)));
    expect(seen).toEqual([0, 0.25, 0.5, 0.75, 1, 0]);
    expect(nextVolume(0.6)).toBe(0.75);
    expect(volumeLabel(0)).toBe('Выкл');
    expect(volumeLabel(0.5)).toBe('50%');
  });

  it('«Без звука» глушит все категории, интерфейс тише звуков', () => {
    const s = { music: 0.5, sfx: 1, muted: false };
    expect(categoryVolume('music', s)).toBe(0.5);
    expect(categoryVolume('sfx', s)).toBe(1);
    expect(categoryVolume('ui', s)).toBeLessThan(1);
    for (const c of ['music', 'sfx', 'ui'] as const) expect(categoryVolume(c, { ...s, muted: true })).toBe(0);
  });
});

describe('звук: ограничитель частоты и голосов', () => {
  it('один id не чаще gap мс', () => {
    const l = new SfxLimiter();
    const rule = { gap: 50, voices: 5 };
    expect(l.tryPlay('hit', 0, 100, rule)).toBe(true);
    expect(l.tryPlay('hit', 20, 100, rule)).toBe(false);
    expect(l.tryPlay('hit', 50, 100, rule)).toBe(true);
  });

  it('не больше voices копий одного звука, закончившиеся освобождают место', () => {
    const l = new SfxLimiter();
    const rule = { gap: 0, voices: 2 };
    expect(l.tryPlay('coin', 0, 100, rule)).toBe(true);
    expect(l.tryPlay('coin', 1, 100, rule)).toBe(true);
    expect(l.tryPlay('coin', 2, 100, rule)).toBe(false);
    expect(l.tryPlay('coin', 101, 100, rule)).toBe(true);
  });

  it('всего не больше MAX_VOICES; важный звук вытесняет старый, обычный пропускается', () => {
    const l = new SfxLimiter();
    for (let i = 0; i < MAX_VOICES; i++) expect(l.tryPlay(`s${i}`, 0, 1000, { gap: 0, voices: 1 })).toBe(true);
    expect(l.playing(0)).toBe(MAX_VOICES);
    expect(l.tryPlay('extra', 1, 1000, { gap: 0, voices: 1 })).toBe(false);
    expect(l.tryPlay('victory', 1, 1000, { gap: 0, voices: 1, priority: true })).toBe(true);
    expect(l.playing(1)).toBe(MAX_VOICES);
    expect(l.playing(2000)).toBe(0);
  });

  it('правила из каталога: стингеры важнее, удары ограничены', () => {
    expect(ruleOf('victory').priority).toBe(true);
    expect(ruleOf('hit_sword').priority).toBe(false);
    expect(ruleOf('hit_sword').voices).toBeGreaterThan(1);
  });

  it('серия монет поднимается по полутонам и сбрасывается после паузы', () => {
    const p = new PitchStreak(400, 12);
    expect(p.next(0)).toBe(1);
    expect(p.next(100)).toBeCloseTo(Math.pow(2, 1 / 12));
    expect(p.next(200)).toBeCloseTo(Math.pow(2, 2 / 12));
    expect(p.next(2000)).toBe(1);
  });

  it('причины тишины: звучит, только когда причин нет', () => {
    const m = new MuteReasons();
    expect(m.toggle('hidden', true)).toBe(true);
    expect(m.toggle('telegram', true)).toBe(false);
    expect(m.toggle('hidden', false)).toBe(false);
    expect(m.active).toBe(true);
    expect(m.toggle('telegram', false)).toBe(true);
    expect(m.active).toBe(false);
  });
});

describe('звук: музыка по экранам', () => {
  it('главная, карта по теме главы, бой и босс', () => {
    expect(sceneSound('Home').music).toBe('home');
    expect(sceneSound('Campaign', { theme: 'swamp' }).music).toBe('map_swamp');
    expect(sceneSound('Battle', { theme: 'crypt' })).toEqual({ music: 'battle_crypt', ambience: 'amb_crypt' });
    expect(sceneSound('Battle', { theme: 'meadow', boss: true }).music).toBe('boss');
    // Меню не меняет музыку.
    expect(sceneSound('Heroes').music).toBeNull();
    expect(sceneSound('Heroes').ambience).toBeUndefined();
  });

  it('любая дорожка из sceneSound есть в каталоге', () => {
    for (const key of ['Home', 'Tavern', 'Campaign', 'Stage', 'Battle', 'Tower', 'Result'])
      for (const theme of ['meadow', 'swamp', 'crypt'] as const)
        for (const boss of [false, true]) {
          const s = sceneSound(key, { theme, boss });
          if (s.music) expect(MUSIC_IDS).toContain(s.music);
          if (s.ambience) expect(AMBIENCE_IDS).toContain(s.ambience);
        }
  });
});

describe('звук: заглушки (синтез)', () => {
  it('у каждого звука каталога есть рецепт; id — латиница (имя файла владельца)', () => {
    for (const id of SFX_IDS) {
      expect(hasRecipe(id), id).toBe(true);
      expect(id).toMatch(/^[a-z0-9_]+$/);
    }
    for (const id of Object.values(SUMMON_REVEAL)) expect(SFX_IDS).toContain(id);
    for (const t of Object.values(MUSIC)) for (const f of t.files) expect(f).toMatch(/^[a-z0-9_]+$/);
  });

  it('звуки короткие, не тихие и без перегруза; все вместе — немного памяти', () => {
    let total = 0;
    for (const id of SFX_IDS) {
      const { data, rate } = synthSfx(id);
      total += data.length;
      expect(data.length / rate, id).toBeLessThanOrEqual(2.5);
      let peak = 0;
      let finite = true;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v)) finite = false;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      expect(finite, id).toBe(true);
      expect(peak, id).toBeGreaterThan(0.2);
      expect(peak, id).toBeLessThanOrEqual(1);
    }
    // Float32 в памяти: меньше 4 МБ на все звуки.
    expect(total * 4).toBeLessThan(4 * 1024 * 1024);
  });

  it('синтез детерминирован (один и тот же звук — те же сэмплы)', () => {
    expect(Buffer.from(synthSfx('hit_sword').data.buffer).equals(Buffer.from(synthSfx('hit_sword').data.buffer))).toBe(true);
  });

  it('музыка: бесшовная петля 10–35 с, рендер по шагам даёт то же, что целиком', () => {
    const whole = synthMusic('home');
    const job = musicJob('home');
    expect(job.steps.length).toBeGreaterThan(2);
    for (const s of job.steps) s();
    expect(Buffer.from(job.pcm.data.buffer).equals(Buffer.from(whole.data.buffer))).toBe(true);
    expect(whole.loop).toBe(true);
    const sec = whole.data.length / whole.rate;
    expect(sec).toBeGreaterThan(10);
    expect(sec).toBeLessThan(35);
    // Шов: начало и конец петли близки (нет щелчка).
    expect(Math.abs(whole.data[0] - whole.data[whole.data.length - 1])).toBeLessThan(0.2);
  });

  it('фоновые звуки глав — тихие петли', () => {
    for (const id of AMBIENCE_IDS) {
      const { data, loop } = synthAmbience(id);
      expect(loop).toBe(true);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      expect(peak, id).toBeLessThanOrEqual(0.7);
      expect(peak, id).toBeGreaterThan(0.05);
    }
  });
});

describe('звук: бой', () => {
  it('оружие по профессии и виду юнита', () => {
    const base = Object.values(CONTENT.units)[0];
    const def = (id: string, kind: UnitDef['kind'], sprite = id): UnitDef => ({ ...base, id, kind, visual: { ...base.visual, sprite } });
    expect(weaponOf(def('job_assassin', 'hero'))).toBe('hit_dagger');
    expect(weaponOf(def('job_archer', 'hero'))).toBe('hit_arrow');
    expect(weaponOf(def('job_knight', 'hero'))).toBe('hit_sword');
    expect(weaponOf(def('job_priest', 'hero'))).toBe('hit_blunt');
    expect(weaponOf(def('poring', 'monster'))).toBe('hit_claw');
    expect(weaponOf(undefined)).toBe('hit_blunt');
  });

  it('весь лог боя проигрывается без звука (нет Web Audio) и без ошибок', () => {
    const result = simulateBattle(CONTENT, ['warrior', 'archer', 'mage', 'priest', 'assassin'], ['mob_melee', 'mob_ranged', 'mob_tank', 'mob_boss1', null], 7);
    const defs: Record<string, UnitDef> = { ...CONTENT.units };
    expect(result.log.some((e) => e.type === 'damage')).toBe(true);
    for (const e of result.log) expect(() => battleSound(e, true, result, defs)).not.toThrow();
  });
});

// Каталог: заглушки есть для всего, что может понадобиться экранам — таверна, итоги, награды.
describe('звук: каталог', () => {
  it('стингеры приглушают музыку, интерфейс — в своей категории', () => {
    expect('duck' in SFX.victory && SFX.victory.duck).toBe(true);
    expect(SFX.ui_tap.cat).toBe('ui');
    expect(SFX.hit_sword.cat).toBe('sfx');
  });
});

describe('звук: файлы владельца попадают в сборку', () => {
  it('assets/audio/<id>.(ogg|m4a|mp3) — в списке нужных файлов, прочее — нет', () => {
    const root = mkdtempSync(join(tmpdir(), 'audio-'));
    expect(audioFiles(root)).toEqual([]);
    mkdirSync(join(root, 'assets/audio'), { recursive: true });
    for (const f of ['hit_sword.ogg', 'hit_sword.m4a', 'music_home.mp3', 'notes.txt', 'Bad Name.ogg']) writeFileSync(join(root, 'assets/audio', f), '');
    expect(audioFiles(root)).toEqual(['audio/hit_sword.m4a', 'audio/hit_sword.ogg', 'audio/music_home.mp3']);
  });
});
