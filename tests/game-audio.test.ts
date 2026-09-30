import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  lineChimes,
  sceneSound,
  SfxLimiter,
  THEME_AMBIENCE,
  THEMES,
  volumeLabel,
  applyAudioSession,
  audioSessionType,
  ownMusicLabel,
  shouldHintOwnMusic,
} from '../src/game/audioCore';
import { AudioEngine, audioSettings, setAudioSettings, takeOwnMusicHint, trackSource } from '../src/game/audio';
import { hasRecipe, musicJob, musicSpecOf, synthAmbience, synthMusic, synthSfx } from '../src/game/audioSynth';
import { battleSound, monsterSoundsOf, swingOf, weaponOf } from '../src/game/battleAudio';
import { MonsterSoundsSchema, monsterSoundFile, monsterSoundFiles } from '../src/game/monsterSounds';
import monsterSoundsJson from '../data/monster_sounds.json';
import { existsSync } from 'node:fs';
import { CHAPTER_THEMES, simulateBattle, type UnitDef } from '../src/core';
import { CONTENT, GAME } from '../src/game/content';

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
    // «Своя музыка» и отметка её подсказки — в том же ключе (переживают «Начать заново», как остальной звук).
    saveAudioSettings({ music: 0.25, sfx: 1, muted: true, battleSfx: false, ownMusic: true, ownMusicHint: true }, s);
    expect(s.m.has(AUDIO_KEY)).toBe(true);
    expect(loadAudioSettings(s)).toEqual({ music: 0.25, sfx: 1, muted: true, battleSfx: false, ownMusic: true, ownMusicHint: true });
  });

  it('мусор, чужие типы и выход за 0…1 не ломают игру', () => {
    const s = memStore();
    s.setItem(AUDIO_KEY, '{oops');
    expect(loadAudioSettings(s)).toEqual(DEFAULT_AUDIO);
    s.setItem(AUDIO_KEY, JSON.stringify({ music: 7, sfx: -1, muted: 'yes' }));
    expect(loadAudioSettings(s)).toEqual({ music: 1, sfx: 0, muted: false, battleSfx: true, ownMusic: false, ownMusicHint: false });
    // Старая запись без «Своей музыки» — режим выключен.
    s.setItem(AUDIO_KEY, JSON.stringify({ music: 0.5, sfx: 0.75, muted: false, battleSfx: true }));
    expect(loadAudioSettings(s).ownMusic).toBe(false);
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
    expect(() => saveAudioSettings({ ...DEFAULT_AUDIO }, bad)).not.toThrow();
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
    const s = { music: 0.5, sfx: 1, muted: false, battleSfx: true };
    expect(categoryVolume('music', s)).toBe(0.5);
    expect(categoryVolume('sfx', s)).toBe(1);
    expect(categoryVolume('battle', s)).toBe(1);
    expect(categoryVolume('ui', s)).toBeLessThan(1);
    for (const c of ['music', 'sfx', 'battle', 'ui'] as const) expect(categoryVolume(c, { ...s, muted: true })).toBe(0);
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
    // «Глава пройдена» после боя с боссом — музыка карты главы, а не тема босса.
    expect(sceneSound('ChapterDone', { theme: 'desert' }).music).toBe('map_desert');
    // Меню не меняет музыку.
    expect(sceneSound('Heroes').music).toBeNull();
    expect(sceneSound('Heroes').ambience).toBeUndefined();
  });

  it('любая дорожка из sceneSound есть в каталоге', () => {
    for (const key of ['Home', 'Tavern', 'Campaign', 'Stage', 'Battle', 'Tower', 'Result'])
      for (const theme of THEMES)
        for (const boss of [false, true]) {
          const s = sceneSound(key, { theme, boss });
          if (s.music) expect(MUSIC_IDS).toContain(s.music);
          if (s.ambience) expect(AMBIENCE_IDS).toContain(s.ambience);
        }
  });
});

describe('звук: темы глав 4–7', () => {
  it('у каждой темы своя музыка карты и боя; фон — свой у старых тем, у новых слотов — подходящий из имеющихся', () => {
    const seen = new Set<string>();
    for (const theme of THEMES) {
      const map = sceneSound('Campaign', { theme }).music!;
      const battle = sceneSound('Battle', { theme });
      expect(map).toBe(`map_${theme}`);
      expect(battle).toEqual({ music: `battle_${theme}`, ambience: THEME_AMBIENCE[theme] });
      for (const id of [map, battle.music]) {
        expect(seen.has(id!), id!).toBe(false);
        seen.add(id!);
      }
      // Босс — общая тема во всех главах, фон главы остаётся.
      expect(sceneSound('Battle', { theme, boss: true })).toEqual({ music: 'boss', ambience: THEME_AMBIENCE[theme] });
      // Башня — своя тема во всех боях, фон — по ярусу.
      expect(sceneSound('Battle', { theme, tower: true })).toEqual({ music: 'battle_tower', ambience: THEME_AMBIENCE[theme] });
    }
    // Семь старых тем — у каждой свой фон.
    const own = ['meadow', 'swamp', 'crypt', 'desert', 'grove', 'shipwreck', 'niflheim'] as const;
    expect(new Set(own.map((t) => THEME_AMBIENCE[t])).size).toBe(own.length);
    for (const t of own) expect(THEME_AMBIENCE[t]).toBe(`amb_${t}`);
    // Темы звука — ровно темы глав (фон и звук едут вместе).
    expect([...THEMES].sort()).toEqual([...CHAPTER_THEMES].sort());
    expect(sceneSound('Tower').music).toBe('tower');
  });

  it('у каждой темы главы и экрана — трек RO в каталоге (заказ владельцу, docs/design/audio.md)', () => {
    for (const theme of THEMES.filter((t) => t !== 'swamp'))
      for (const kind of ['map', 'battle'] as const) expect((MUSIC[`${kind}_${theme}` as keyof typeof MUSIC] as { ro?: string }).ro, `${kind}_${theme}`).toMatch(/^\d\d\.mp3/);
    for (const id of ['title', 'home', 'tavern', 'tower', 'battle_tower', 'boss'] as const) expect((MUSIC[id] as { ro?: string }).ro, id).toMatch(/^\d\d\.mp3/);
    // Карта и бой канализации — один трек RO: бой без своего файла берёт файл карты.
    expect(MUSIC.battle_sewer.files).toContain('music_map_sewer');
    // Лабиринт (глава 9) — своя боевая тема (47.mp3), а не трек карты (отчёт RL, «Музыка»).
    expect(MUSIC.battle_labyrinth.files).toEqual(['music_battle_labyrinth', 'music_battle']);
    expect(MUSIC.battle_labyrinth.ro).not.toBe(MUSIC.map_labyrinth.ro);
  });

  it('у новых дорожек есть описание и ориентир из RO, файл владельца — своя дорожка, затем общая', () => {
    for (const t of ['desert', 'grove', 'shipwreck', 'niflheim']) {
      for (const kind of ['map', 'battle'] as const) {
        const def = MUSIC[`${kind}_${t}` as keyof typeof MUSIC] as { files: readonly string[]; desc: string; ro?: string };
        expect(def.files).toEqual([`music_${kind}_${t}`, `music_${kind}`]);
        expect(def.desc.length).toBeGreaterThan(5);
        expect(def.ro, `${kind}_${t}`).toBeTruthy();
      }
      expect(AMBIENCE_IDS).toContain(`amb_${t}`);
    }
  });

  it('колокольчик Греты: звон — по реплике, где он звенит (не где молчит)', () => {
    expect(lineChimes('Колокольчик звенит в сторону моря. Глухо.')).toBe(true);
    expect(lineChimes('Колокольчик сам звенит у меня в руке.')).toBe(true);
    expect(lineChimes('Там, наверху, каюта капитана. Мой колокольчик и тот, чёрный, звенят в один голос.')).toBe(true);
    expect(lineChimes('Я позвоню. Только не так, как ты хочешь.')).toBe(true);
    expect(lineChimes('Колокольчик молчит. Совсем. Мне это не нравится больше, чем любой звон.')).toBe(false);
    expect(lineChimes('За лесом — трактир «Два колокола».')).toBe(false);
    // В сюжете такие реплики есть (иначе звон никогда не прозвучит).
    const lines = GAME.story.scenes.flatMap((s) => s.lines.map((l) => l.text));
    const chimes = lines.filter(lineChimes);
    expect(chimes.length).toBeGreaterThanOrEqual(8);
    expect(chimes.length).toBeLessThan(lines.length / 10);
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

  it('вся музыка: петля 10–35 с, шов без щелчка, не тихая и без перегруза', () => {
    // Дорожки без своей заглушки звучат как прежняя тема слота (musicSpecOf) — рендерим каждую заглушку один раз.
    for (const id of MUSIC_IDS) expect(MUSIC_IDS).toContain(musicSpecOf(id));
    for (const id of new Set(MUSIC_IDS.map(musicSpecOf))) {
      const { data, rate } = synthMusic(id);
      const sec = data.length / rate;
      expect(sec, id).toBeGreaterThan(10);
      expect(sec, id).toBeLessThan(35);
      let peak = 0;
      let jump = 0;
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (i) jump = Math.max(jump, Math.abs(data[i] - data[i - 1]));
      }
      expect(peak, id).toBeGreaterThan(0.3);
      expect(peak, id).toBeLessThanOrEqual(0.9);
      // Шов: скачок на стыке конец → начало не больше самого резкого перепада внутри петли.
      expect(Math.abs(data[0] - data[data.length - 1]), id).toBeLessThanOrEqual(jump + 1e-6);
    }
  }, 30_000); // лимит времени вызова (синтез 17 дорожек под нагрузкой контейнера), не порог качества

  it('фоновые звуки глав — тихие петли', () => {
    for (const id of AMBIENCE_IDS) {
      const { data, loop } = synthAmbience(id);
      expect(loop).toBe(true);
      let jump = 0;
      for (let i = 1; i < data.length; i++) jump = Math.max(jump, Math.abs(data[i] - data[i - 1]));
      expect(Math.abs(data[0] - data[data.length - 1]), id).toBeLessThanOrEqual(jump + 1e-6);
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

  it('взмах по оружию героя', () => {
    expect(swingOf('hit_sword')).toBe('swing');
    expect(swingOf('hit_dagger')).toBe('swing_dagger');
    expect(swingOf('hit_blunt')).toBe('swing_blunt');
    expect(SFX_IDS).toEqual(expect.arrayContaining(['swing_dagger', 'swing_blunt', 'refine_success', 'refine_fail']));
  });

  it('свои звуки монстров RO: таблица по листу спрайта, файлы собраны, у героев своих звуков нет', () => {
    const table = MonsterSoundsSchema.parse(monsterSoundsJson);
    for (const f of monsterSoundFiles(table)) for (const ext of ['ogg', 'm4a']) expect(existsSync(`assets/audio/${f}.${ext}`), `${f}.${ext}`).toBe(true);
    const base = Object.values(CONTENT.units).find((u) => u.kind === 'monster')!;
    const poring = { ...base, visual: { ...base.visual, sprite: 'fast' } };
    expect(monsterSoundsOf(poring)?.death?.map(monsterSoundFile)).toEqual(['mon_poring_die']);
    expect(monsterSoundsOf({ ...poring, kind: 'hero' })).toBeUndefined();
    expect(monsterSoundsOf({ ...base, visual: { ...base.visual, sprite: 'no_such_sheet' } })).toBeUndefined();
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
    expect(SFX.hit_sword.cat).toBe('battle');
    expect(SFX.victory.cat).toBe('sfx');
  });
});

describe('звук: файлы владельца попадают в сборку', () => {
  it('assets/audio/<id>.(ogg|m4a|mp3) — в списке нужных файлов, прочее — нет', () => {
    const root = mkdtempSync(join(tmpdir(), 'audio-'));
    expect(audioFiles(root)).toEqual([]);
    mkdirSync(join(root, 'assets/audio'), { recursive: true });
    for (const f of ['hit_sword.ogg', 'hit_sword.m4a', 'music_home.mp3', 'music_spare_03.ogg', 'notes.txt', 'Bad Name.ogg']) writeFileSync(join(root, 'assets/audio', f), '');
    // Запасной трек без дорожки в MUSIC (music_spare_03) в сборку не едет.
    expect(audioFiles(root)).toEqual(['audio/hit_sword.m4a', 'audio/hit_sword.ogg', 'audio/music_home.mp3']);
  });
});

describe('звук: музыка RO — файлы', () => {
  // Треки RO (raw/ro-build/audio, docs/RO_SCRO_IMPORT.md шаг 6): у каждой дорожки с треком RO — пара ogg + m4a,
  // своя или общая (бой канализации — файл карты). title — сцены входа нет, файл не кладём.
  const has = (f: string) => existsSync(`assets/audio/${f}.ogg`) && existsSync(`assets/audio/${f}.m4a`);
  it('у каждой дорожки с треком RO (кроме title и запасных топей) есть файл; один трек — один файл', () => {
    const used = new Map<string, string>();
    for (const id of MUSIC_IDS) {
      const def = MUSIC[id] as { files: readonly string[]; ro?: string };
      if (!def.ro || id === 'title') continue;
      const file = def.files.find(has);
      expect(file, id).toBeTruthy();
      // Одинаковый трек RO у двух дорожек — один файл на обе (в сборке без дублей).
      const track = def.ro.slice(0, 6);
      const prev = used.get(track);
      if (prev) expect(file, `${id}: трек ${track} уже в ${prev}`).toBe(prev);
      used.set(track, file!);
    }
    // 23: с 30.09 у боя главы 9 своя тема (47.mp3), раньше он брал трек карты.
    expect(used.size).toBe(23);
  });

  it('файлы музыки — до 1.5 МБ каждый (петля качается быстро и на 3G)', () => {
    for (const id of MUSIC_IDS)
      for (const f of MUSIC[id].files)
        for (const ext of ['ogg', 'm4a'])
          if (existsSync(`assets/audio/${f}.${ext}`)) expect(statSync(`assets/audio/${f}.${ext}`).size, `${f}.${ext}`).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  });
});

describe('звук: выбор источника дорожки (файл потоком / заглушка)', () => {
  const urlsOf = (have: Record<string, string[]>) => (f: string) => have[f] ?? [];
  it('есть файл — поток, ключ по файлу (две дорожки с одним файлом — одна музыка)', () => {
    const u = urlsOf({ music_map_sewer: ['audio/music_map_sewer.ogg', 'audio/music_map_sewer.m4a'] });
    expect(trackSource('music', 'map_sewer', ['music_map_sewer', 'music_map'], u, new Set())).toEqual({ kind: 'stream', key: 'music:music_map_sewer', urls: ['audio/music_map_sewer.ogg', 'audio/music_map_sewer.m4a'] });
    expect(trackSource('music', 'battle_sewer', ['music_battle_sewer', 'music_map_sewer', 'music_battle'], u, new Set())).toMatchObject({ kind: 'stream', key: 'music:music_map_sewer' });
  });

  it('нет файла или он не заиграл — следующий файл дорожки, иначе заглушка (ключ по дорожке)', () => {
    const u = urlsOf({ music_tower: ['audio/music_tower.ogg'], music_home: ['audio/music_home.ogg'] });
    expect(trackSource('music', 'battle_tower', ['music_battle_tower', 'music_tower'], u, new Set(['music:music_tower']))).toEqual({ kind: 'buffer', key: 'music:battle_tower' });
    expect(trackSource('music', 'tavern', ['music_tavern', 'music_home'], u, new Set())).toMatchObject({ kind: 'stream', key: 'music:music_home' });
    expect(trackSource('music', 'map_swamp', ['music_map_swamp', 'music_map'], u, new Set())).toEqual({ kind: 'buffer', key: 'music:map_swamp' });
    expect(trackSource('amb', 'amb_crypt', ['amb_crypt'], u, new Set())).toEqual({ kind: 'buffer', key: 'amb:amb_crypt' });
  });
});

// ---------- движок с поддельным Web Audio и <audio> (в node их нет) ----------

class FakeParam {
  value = 0;
  cancelScheduledValues() {}
  setTargetAtTime(v: number) {
    this.value = v;
  }
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
}
class FakeNode {
  connected = true;
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {
    this.connected = false;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}

function fakeCtx() {
  return {
    currentTime: 0,
    state: 'running',
    createGain: vi.fn(() => new FakeGain()),
    createMediaElementSource: vi.fn(() => new FakeNode()),
    createBufferSource: vi.fn(() => ({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: new FakeParam(), connect: <T>(n: T) => n, disconnect() {}, start: vi.fn(), stop: vi.fn(), onended: null })),
    decodeAudioData: vi.fn(() => Promise.reject(new Error('файл музыки не раскодируют целиком'))),
    createBuffer: vi.fn((ch: number, len: number, rate: number) => {
      const d = [...Array(ch)].map(() => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: (c: number) => d[c] };
    }),
    suspend: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
  };
}

/** Поддельный <audio>: ok — играет; autoplay — отказ до «касания»; broken — файл не читается (ошибка + отказ play). */
class FakeAudio {
  static all: FakeAudio[] = [];
  static mode: 'ok' | 'autoplay' | 'broken' = 'ok';
  static touched = false;
  loop = false;
  preload = '';
  src = '';
  paused = true;
  error: { code: number } | null = null;
  private readonly on = new Map<string, (() => void)[]>();
  constructor() {
    FakeAudio.all.push(this);
  }
  play = vi.fn((): Promise<void> => {
    if (FakeAudio.mode === 'broken') {
      this.error = { code: 4 };
      queueMicrotask(() => this.emit('error'));
      return Promise.reject(Object.assign(new Error('не поддерживается'), { name: 'NotSupportedError' }));
    }
    if (FakeAudio.mode === 'autoplay' && !FakeAudio.touched) return Promise.reject(Object.assign(new Error('нужно касание'), { name: 'NotAllowedError' }));
    this.paused = false;
    queueMicrotask(() => this.emit('playing'));
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn((a: string) => {
    if (a === 'src') this.src = '';
  });
  addEventListener(t: string, f: () => void) {
    this.on.set(t, [...(this.on.get(t) ?? []), f]);
  }
  emit(t: string) {
    for (const f of this.on.get(t) ?? []) f();
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('звук: музыка из файлов играет потоком', () => {
  let ctx: ReturnType<typeof fakeCtx>;
  let eng: AudioEngine;
  const OrigAudio = (globalThis as { Audio?: unknown }).Audio;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.all = [];
    FakeAudio.mode = 'ok';
    FakeAudio.touched = false;
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    ctx = fakeCtx();
    eng = new AudioEngine(ctx as unknown as AudioContext, new FakeNode() as unknown as AudioNode);
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { Audio?: unknown }).Audio = OrigAudio;
    vi.restoreAllMocks();
  });

  it('музыка с файлом не раскодируется целиком и не лежит в буферах', async () => {
    eng.music('home');
    await flush();
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
    const el = FakeAudio.all[0];
    expect(el.loop).toBe(true);
    expect(el.src).toMatch(/audio\/music_home\.(ogg|m4a)$/);
    expect(eng.stats()).toMatchObject({ buffers: 0, trackBuffers: [], streams: 1, music: 'music:music_home' });
  });

  it('главная → бой → главная ×10: после затухания живёт один поток, остальные отпущены', async () => {
    eng.music('home');
    for (let i = 0; i < 10; i++) {
      for (const id of ['battle_meadow', 'home'] as const) {
        eng.music(id);
        await flush();
        expect(eng.stats().streams).toBeLessThanOrEqual(2);
        vi.advanceTimersByTime(900);
        expect(eng.stats().streams).toBe(1);
      }
    }
    expect(eng.stats()).toMatchObject({ buffers: 0, streams: 1, music: 'music:music_home' });
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    // Каждый старт — новый элемент; все, кроме последнего, отпущены: пауза, файл снят, load(), узлы отключены.
    expect(FakeAudio.all.length).toBe(21);
    for (const el of FakeAudio.all.slice(0, -1)) {
      expect(el.pause).toHaveBeenCalled();
      expect(el.src).toBe('');
      expect(el.load).toHaveBeenCalled();
    }
    const nodes = ctx.createMediaElementSource.mock.results.map((r) => r.value as FakeNode);
    expect(nodes.filter((n) => n.connected).length).toBe(1);
    expect(FakeAudio.all.at(-1)!.src).not.toBe('');
  });

  it('та же дорожка и дорожка с тем же файлом не перезапускаются (карта и бой канализации)', async () => {
    eng.music('map_sewer');
    eng.music('battle_sewer');
    eng.music('map_sewer');
    await flush();
    expect(FakeAudio.all.length).toBe(1);
    // Бой Башни без своего файла — музыка экрана Башни продолжает играть.
    eng.music('tower');
    eng.music('battle_tower');
    expect(FakeAudio.all.length).toBe(2);
  });

  it('свернули Telegram — поток на паузе; вернулись — играет дальше с того же места', async () => {
    eng.music('home');
    await flush();
    const el = FakeAudio.all[0];
    expect(el.play).toHaveBeenCalledTimes(1);
    eng.setMuted('telegram', true);
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(ctx.suspend).toHaveBeenCalled();
    // Пока свернуто, новая музыка не стартует (ждёт возврата).
    eng.music('battle_meadow');
    const el2 = FakeAudio.all[1];
    expect(el2.play).not.toHaveBeenCalled();
    eng.setMuted('telegram', false);
    expect(el2.play).toHaveBeenCalledTimes(1);
    // Старый затухает и отпускается, не возобновляясь.
    expect(el.play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(900);
    expect(eng.stats().streams).toBe(1);
    expect(el.load).toHaveBeenCalled();
  });

  it('до первого касания браузер не даёт играть — play() повторяется при касании', async () => {
    FakeAudio.mode = 'autoplay';
    eng.music('home');
    await flush();
    const el = FakeAudio.all[0];
    expect(eng.hasPending).toBe(true);
    expect(eng.stats().streams).toBe(1);
    expect(eng.failed.size).toBe(0);
    FakeAudio.touched = true;
    eng.retryPending();
    await flush();
    expect(el.play).toHaveBeenCalledTimes(2);
    expect(eng.hasPending).toBe(false);
    expect(el.paused).toBe(false);
  });

  it('файл не читается ни в одном формате — заглушка из кода, файл больше не пробуем', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    FakeAudio.mode = 'broken';
    eng.music('boss');
    await flush();
    const el = FakeAudio.all[0];
    // ogg, затем m4a — один раз каждый (ошибка и отказ play() — одна попытка).
    expect(el.play).toHaveBeenCalledTimes(2);
    expect(eng.failed.has('music:music_boss')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^Звук .*music_boss.* не загрузился .*играет заглушка$/);
    expect(eng.stats().streams).toBe(0);
    await vi.runAllTimersAsync();
    await flush();
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(eng.stats()).toMatchObject({ streams: 0, music: 'music:boss', trackBuffers: ['music:boss'] });
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    // Повторный вызов — сразу заглушка, без новых элементов.
    eng.music('home');
    eng.music('boss');
    expect(FakeAudio.all.filter((a) => a.src.includes('music_boss')).length).toBe(0);
  }, 30_000);

  it('дорожка без файла (топи) — заглушка в памяти, как раньше', async () => {
    eng.music('map_swamp');
    await vi.runAllTimersAsync();
    await flush();
    expect(FakeAudio.all.length).toBe(0);
    expect(eng.stats()).toMatchObject({ streams: 0, music: 'music:map_swamp', trackBuffers: ['music:map_swamp'] });
  }, 30_000);
});

describe('звук: «Своя музыка» — игра не прерывает музыку игрока', () => {
  let ctx: ReturnType<typeof fakeCtx>;
  const OrigAudio = (globalThis as { Audio?: unknown }).Audio;
  let session: { type: string };
  const make = () => new AudioEngine(ctx as unknown as AudioContext, new FakeNode() as unknown as AudioNode);
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.all = [];
    FakeAudio.mode = 'ok';
    FakeAudio.touched = false;
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    session = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession: session });
    ctx = fakeCtx();
  });
  afterEach(() => {
    setAudioSettings({ ownMusic: false, ownMusicHint: false });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    (globalThis as { Audio?: unknown }).Audio = OrigAudio;
    vi.restoreAllMocks();
  });

  it('аудиосессия iOS: ambient в режиме, auto без него; нет API или он бросает — молча null', () => {
    expect(audioSessionType({ ownMusic: true })).toBe('ambient');
    expect(audioSessionType({ ownMusic: false })).toBe('auto');
    const s = { type: 'auto' };
    expect(applyAudioSession('ambient', { audioSession: s })).toBe('ambient');
    expect(s.type).toBe('ambient');
    expect(applyAudioSession('ambient', {})).toBeNull();
    expect(applyAudioSession('ambient', null)).toBeNull();
    const bad = {
      audioSession: Object.defineProperty({}, 'type', {
        get: () => 'auto',
        set: () => {
          throw new Error('нельзя');
        },
      }),
    };
    expect(applyAudioSession('ambient', bad)).toBeNull();
  });

  it('режим включён: ни одного <audio>, музыки и фона нет, сессия ambient, звуки игры играют через Web Audio', async () => {
    setAudioSettings({ ownMusic: true });
    expect(session.type).toBe('ambient');
    const eng = make();
    for (const id of ['home', 'battle_meadow', 'boss', 'map_swamp'] as const) eng.music(id);
    eng.ambience('amb_swamp');
    await vi.runAllTimersAsync();
    await flush();
    expect(FakeAudio.all.length).toBe(0);
    expect(ctx.createMediaElementSource).not.toHaveBeenCalled();
    expect(eng.stats()).toMatchObject({ streams: 0, music: null, ambience: null, trackBuffers: [], ownMusic: true, session: 'ambient' });
    // Звук интерфейса (заглушка без файла) — AudioBuffer в Web Audio, как всегда.
    eng.play('ui_toggle');
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(eng.stats().streams).toBe(0);
    // Свернули и вернули — сессия выставлена снова (до resume), <audio> не появились.
    session.type = 'auto';
    eng.setMuted('telegram', true);
    eng.setMuted('telegram', false);
    expect(session.type).toBe('ambient');
    expect(FakeAudio.all.length).toBe(0);
  }, 30_000);

  it('включили во время музыки — плавно гаснет и <audio> отпущен; выключили — снова музыка экрана', async () => {
    const eng = make();
    expect(eng.stats().session).toBe('auto');
    eng.music('home');
    await flush();
    const el = FakeAudio.all[0];
    expect(eng.stats().streams).toBe(1);
    expect(eng.musicHeard).toBe(true);

    setAudioSettings({ ownMusic: true });
    eng.syncOwnMusic();
    expect(session.type).toBe('ambient');
    expect(eng.stats().music).toBeNull();
    // Затухание FADE_S, потом элемент отпущен: пауза, файл снят, load(), узлы отключены.
    vi.advanceTimersByTime(900);
    expect(eng.stats().streams).toBe(0);
    expect(el.pause).toHaveBeenCalled();
    expect(el.src).toBe('');
    expect(el.load).toHaveBeenCalled();
    expect(ctx.createMediaElementSource.mock.results.every((r) => !(r.value as FakeNode).connected)).toBe(true);

    // Пока режим включён, экраны просят музыку — ни одного нового элемента.
    eng.music('battle_meadow');
    await flush();
    expect(FakeAudio.all.length).toBe(1);

    setAudioSettings({ ownMusic: false });
    eng.syncOwnMusic();
    await flush();
    expect(session.type).toBe('auto');
    expect(FakeAudio.all.length).toBe(2);
    expect(FakeAudio.all[1].src).toMatch(/music_battle_meadow/);
    expect(eng.stats()).toMatchObject({ streams: 1, music: 'music:music_battle_meadow', ownMusic: false });
  });

  it('подсказка в Городе: один раз, только после музыки игры и если режим не включён', () => {
    const base = { ownMusic: false, ownMusicHint: false, muted: false, music: 0.5 };
    expect(shouldHintOwnMusic(base, true)).toBe(true);
    expect(shouldHintOwnMusic(base, false)).toBe(false);
    expect(shouldHintOwnMusic({ ...base, ownMusic: true }, true)).toBe(false);
    expect(shouldHintOwnMusic({ ...base, ownMusicHint: true }, true)).toBe(false);
    expect(shouldHintOwnMusic({ ...base, muted: true }, true)).toBe(false);
    expect(shouldHintOwnMusic({ ...base, music: 0 }, true)).toBe(false);
    // Без движка (нет Web Audio) музыка не звучала — подсказки нет.
    expect(takeOwnMusicHint()).toBe(false);
    expect(audioSettings.ownMusicHint).toBe(false);
    expect(ownMusicLabel({ ownMusic: true })).toBe('Вкл');
    expect(categoryVolume('music', { ...DEFAULT_AUDIO, ownMusic: true })).toBe(0);
    expect(categoryVolume('sfx', { ...DEFAULT_AUDIO, ownMusic: true })).toBe(DEFAULT_AUDIO.sfx);
  });
});
