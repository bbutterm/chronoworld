/**
 * Плотность звуков боя (жалоба владельца «в бою звука слишком много», docs/design/audio.md, «Плотность звуков боя»).
 * Лог настоящих боёв 5×5 проигрывается через battleSound; вызовы звука перехватываются и пропускаются через тот же
 * ограничитель, что в движке (SoundGate: частота и голоса + плотность боя). Длительность звука — по заглушке
 * (audioSynth), свои звуки монстров RO — 450 мс.
 *
 * Замер для документа: CHRONO_AUDIO_REPORT=1 npx vitest run tests/battle-audio-density.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  id: string;
  at: number;
  gain: number;
  rule?: { gap: number; voices: number; tier?: 'minor' | 'skill' | 'major'; priority?: boolean };
}
const calls: Call[] = [];
let clock = 0;
vi.mock('../src/game/audio', () => ({
  sfx: (id: string, o: { delay?: number; gain?: number } = {}) => void calls.push({ id, at: clock + (o.delay ?? 0) * 1000, gain: o.gain ?? 1 }),
  sfxFile: (id: string, rule: Call['rule'], o: { delay?: number; gain?: number } = {}) => (calls.push({ id, at: clock + (o.delay ?? 0) * 1000, gain: o.gain ?? 1, rule }), true),
  preloadSoundFiles: () => {},
}));

import { simulateBattle, type UnitDef } from '../src/core';
import { SFX, type SfxId } from '../src/game/audioCatalog';
import {
  AUDIO_KEY,
  BATTLE_DENSITY,
  BattleMix,
  battleSfxLabel,
  battleSfxToast,
  categoryVolume,
  DEFAULT_AUDIO,
  loadAudioSettings,
  ruleOf,
  saveAudioSettings,
  SoundGate,
} from '../src/game/audioCore';
import { synthSfx } from '../src/game/audioSynth';
import { battleSound } from '../src/game/battleAudio';
import { CONTENT } from '../src/game/content';
import { playback } from '../src/game/state';

const durs = new Map<string, number>();
function dur(id: string): number {
  let d = durs.get(id);
  if (d === undefined) {
    const p = id in SFX ? synthSfx(id as SfxId) : null;
    d = p ? (p.data.length / p.rate) * 1000 : 450;
    durs.set(id, d);
  }
  return d;
}

/** Монстры главы крепче в HP и атаке — бой длится 25–30 с, как в кампании (а не 8 с). */
function tough(id: string, k: number): UnitDef {
  const u = CONTENT.units[id];
  return { ...u, stats: { ...u.stats, hp: u.stats.hp * k, atk: u.stats.atk * Math.sqrt(k) } };
}

const HEROES = ['warrior', 'archer', 'mage', 'priest', 'assassin'];
const FIGHTS: [(string | UnitDef)[], (string | UnitDef)[]][] = [
  [HEROES, ['mob_melee', 'mob_ranged', 'mob_tank', 'mob_fast', 'mob_elite'].map((x) => tough(x, 6))],
  [['warrior', 'guard', 'mage', 'priest', 'archer'], ['mob5_melee', 'mob5_ranged', 'mob5_tank', 'mob5_fast', 'mob5_support'].map((x) => tough(x, 3))],
  [HEROES, HEROES],
];
const SEEDS = [1, 2, 3, 4];

interface Stats {
  battles: number;
  seconds: number;
  requested: number;
  played: number;
  peak100: number;
  peak1s: number;
  /** Важные (ульта, смерти, босс): сколько просили и сколько прозвучало. */
  majorAsked: number;
  majorPlayed: number;
  /** Сумма громкостей сыгранного (мера «сколько шума» за бой). */
  energy: number;
  /** Сколько прозвучало по важности. */
  byTier: Record<string, number>;
  /** Важных, если бы в бою звучали только они (ограничитель частоты id тот же): плотность их не режет. */
  majorAlone: number;
}

const tierOf = (c: Call) => c.rule?.tier ?? (c.id in SFX ? ruleOf(c.id as SfxId).tier : undefined);

function measure(speed: number): Stats {
  const defs: Record<string, UnitDef> = { ...CONTENT.units };
  const was = playback.raw;
  playback.raw = speed;
  const s: Stats = { battles: 0, seconds: 0, requested: 0, played: 0, peak100: 0, peak1s: 0, majorAsked: 0, majorPlayed: 0, energy: 0, byTier: {}, majorAlone: 0 };
  try {
    for (const [a, b] of FIGHTS)
      for (const seed of SEEDS) {
        calls.length = 0;
        const r = simulateBattle(CONTENT, a, b, seed);
        for (const e of r.log) {
          clock = (e.t * 1000) / speed;
          battleSound(e, true, r, defs);
        }
        const alone = new SoundGate();
        for (const c of calls) if (tierOf(c) === 'major' && alone.tryPlay(c.id, c.at, dur(c.id), c.rule ?? ruleOf(c.id as SfxId))) s.majorAlone++;
        const gate = new SoundGate();
        const out: number[] = [];
        for (const c of calls) {
          const rule = c.rule ?? ruleOf(c.id as SfxId);
          const major = tierOf(c) === 'major';
          if (major) s.majorAsked++;
          if (!gate.tryPlay(c.id, c.at, dur(c.id), rule)) continue;
          out.push(c.at);
          if (major) s.majorPlayed++;
          const t = tierOf(c) ?? 'other';
          s.byTier[t] = (s.byTier[t] ?? 0) + 1;
          s.energy += (c.id in SFX ? SFX[c.id as SfxId].gain : 1) * c.gain;
        }
        s.battles++;
        s.requested += calls.length;
        s.played += out.length;
        s.seconds += r.log[r.log.length - 1].t / speed;
        out.sort((x, y) => x - y);
        for (let i = 0, j = 0, k = 0; i < out.length; i++) {
          while (j < out.length && out[j] - out[i] < 100) j++;
          while (k < out.length && out[k] - out[i] < 1000) k++;
          s.peak100 = Math.max(s.peak100, j - i);
          s.peak1s = Math.max(s.peak1s, k - i);
        }
      }
  } finally {
    playback.raw = was;
  }
  return s;
}

const report = (speed: number, s: Stats) =>
  `${speed}x: боёв ${s.battles}, средний бой ${(s.seconds / s.battles).toFixed(1)} с; просили ${(s.requested / s.battles).toFixed(0)} звуков за бой, ` +
  `прозвучало ${(s.played / s.battles).toFixed(0)} (${(s.played / s.seconds).toFixed(1)}/с), пик ${s.peak100} за 100 мс, ${s.peak1s} за 1 с; ` +
  `по важности за бой ${Object.entries(s.byTier).map(([k, v]) => `${k} ${(v / s.battles).toFixed(0)}`).join(', ')}; ` +
  `важных ${s.majorPlayed} (без ударов вокруг — ${s.majorAlone}, просили ${s.majorAsked}); громкость за бой ${(s.energy / s.battles).toFixed(1)}\n`;

describe('звук боя: плотность', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('BattleMix: обычных ударов не больше лимита за окно и за секунду, важные — ударами не вытесняются и глушат удары рядом', () => {
    const m = new BattleMix();
    const tryMinor = (t: number) => (m.allows('minor', t) ? (m.add('minor', t), true) : false);
    expect(tryMinor(0)).toBe(true);
    expect(tryMinor(30)).toBe(false);
    expect(tryMinor(BATTLE_DENSITY.WINDOW_MS)).toBe(true);
    let ok = 2;
    for (let t = 200; t < 1000; t += 100) if (tryMinor(t)) ok++;
    expect(ok).toBe(BATTLE_DENSITY.MINOR_PER_SEC);
    // Ульта / смерть: всегда, и удар в пределах MAJOR_SHADOW_MS от неё не звучит.
    const n = new BattleMix();
    expect(n.allows('major', 5000)).toBe(true);
    n.add('major', 5000);
    expect(n.allows('major', 5000)).toBe(true);
    n.add('major', 5010);
    // Третья смерть в тот же миг — нет, баннер / смерть босса (always) — всегда.
    expect(n.allows('major', 5020)).toBe(false);
    expect(n.allows('major', 5020, true)).toBe(true);
    expect(n.allows('minor', 5000 + BATTLE_DENSITY.MAJOR_SHADOW_MS - 10)).toBe(false);
    expect(n.allows('minor', 5000 - BATTLE_DENSITY.MAJOR_SHADOW_MS + 10)).toBe(false);
    expect(n.allows('minor', 5000 + BATTLE_DENSITY.MAJOR_SHADOW_MS + 10)).toBe(true);
    // Навыки — свой запас, удары его не тратят.
    const k = new BattleMix();
    k.add('minor', 0);
    expect(k.allows('skill', 0)).toBe(true);
  });

  it('SoundGate: звуки вне боя (интерфейс, награды) ограничитель плотности не трогает', () => {
    const g = new SoundGate();
    for (let i = 0; i < 5; i++) expect(g.tryPlay(`ui${i}`, 0, 50, ruleOf('ui_tap'))).toBe(true);
    expect(g.tryPlay('hit_sword', 0, 100, ruleOf('hit_sword'))).toBe(true);
    expect(g.tryPlay('hit_claw', 10, 100, ruleOf('hit_claw'))).toBe(false);
  });

  it('каталог: удары и звуки монстров тише ульты, смертей и босса; у каждого звука боя есть важность', () => {
    const battle = (Object.keys(SFX) as SfxId[]).filter((id) => SFX[id].cat === 'battle');
    expect(battle.length).toBeGreaterThan(20);
    for (const id of battle) expect(ruleOf(id).tier, id).toBeDefined();
    const loudestMinor = Math.max(...battle.filter((id) => ruleOf(id).tier === 'minor').map((id) => SFX[id].gain));
    for (const id of ['ult', 'death_monster', 'death_hero', 'boss_death', 'boss_intro'] as const) {
      expect(ruleOf(id).tier, id).toBe('major');
      expect(SFX[id].gain, id).toBeGreaterThan(loudestMinor);
    }
    // Обычный удар — не громче 0.25 (−6 дБ к прежним 0.5).
    for (const id of ['hit_sword', 'hit_blunt', 'hit_claw', 'hit_arrow', 'hit_magic', 'hit_dagger'] as const) expect(SFX[id].gain).toBeLessThanOrEqual(0.25);
  });

  it('бой 5×5 на 1x и 2x: пик не больше 3–4 звуков за 100 мс и 12 за секунду, важные не теряются', { timeout: 60_000 }, () => {
    const lines: string[] = [];
    for (const speed of [1, 2]) {
      const s = measure(speed);
      lines.push(report(speed, s));
      if (process.env.CHRONO_AUDIO_REPORT) process.stderr.write(lines[lines.length - 1]);
      expect(s.played).toBeGreaterThan(0);
      // До правки (docs/design/audio.md): пик 7–8 за 100 мс и 23 / 39 за секунду, в среднем 8.7/с на 1x и 15.9/с на 2x.
      expect(s.peak100).toBeLessThanOrEqual(speed === 1 ? 3 : 4);
      expect(s.peak1s).toBeLessThanOrEqual(12);
      expect(s.played / s.seconds).toBeLessThanOrEqual(speed === 1 ? 5 : 7);
      // Смерти и ульты слышны все, как если бы в бою больше ничего не звучало (теряются только одинаковые в один миг —
      // ограничитель частоты id: две ульты в одном кадре — один всплеск).
      expect(s.majorPlayed).toBe(s.majorAlone);
    }
  });
});

describe('звук боя: кнопка и настройка «Звуки боя»', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('по умолчанию звуки боя включены; старые настройки без поля — тоже', () => {
    expect(DEFAULT_AUDIO.battleSfx).toBe(true);
    const s = mem();
    s.setItem(AUDIO_KEY, JSON.stringify({ music: 0.5, sfx: 0.75, muted: false }));
    expect(loadAudioSettings(s).battleSfx).toBe(true);
  });

  it('выключение запоминается и глушит только звуки боя: музыка, награды и интерфейс звучат', () => {
    const s = mem();
    const cur = loadAudioSettings(s);
    const off = { ...cur, battleSfx: !cur.battleSfx };
    saveAudioSettings(off, s);
    const back = loadAudioSettings(s);
    expect(back.battleSfx).toBe(false);
    expect(categoryVolume('battle', back)).toBe(0);
    expect(categoryVolume('music', back)).toBeGreaterThan(0);
    expect(categoryVolume('sfx', back)).toBeGreaterThan(0);
    expect(categoryVolume('ui', back)).toBeGreaterThan(0);
    expect(battleSfxLabel(back)).toBe('Выкл');
    expect(battleSfxToast(back)).toBe('Звуки боя выключены');
    saveAudioSettings({ ...back, battleSfx: true }, s);
    expect(loadAudioSettings(s).battleSfx).toBe(true);
    expect(battleSfxToast(loadAudioSettings(s))).toBe('Звуки боя включены');
    expect(categoryVolume('battle', loadAudioSettings(s))).toBe(DEFAULT_AUDIO.sfx);
  });

  it('звуки монстров RO и рог начала боя — тоже звуки боя (одна кнопка глушит всё в бою)', () => {
    expect(SFX.battle_start.cat).toBe('battle');
    expect(SFX.boss_intro.cat).toBe('battle');
    const result = simulateBattle(CONTENT, HEROES, ['mob_fast', 'mob_fast', 'mob_fast', null, null], 3);
    const defs: Record<string, UnitDef> = { ...CONTENT.units };
    for (const e of result.log) battleSound(e, true, result, defs);
    const mon = calls.filter((c) => c.id.startsWith('mon_'));
    expect(mon.length).toBeGreaterThan(0);
    for (const c of mon) expect(c.rule?.tier).toBeDefined();
  });
});
