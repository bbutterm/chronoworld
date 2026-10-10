/**
 * Звук игры (issue #26, docs/design/audio.md): обёртка над Web Audio контекстом звукового менеджера Phaser.
 *
 * - Категории: музыка, звуки (награды), звуки боя, интерфейс — свои шины громкости; настройки «Музыка», «Звуки»,
 *   «Звуки боя» (вкл/выкл; та же кнопка-динамик в бою), «Без звука» (audioCore.ts, localStorage).
 * - Звук: `sfx('coin')` из любого места; ограничитель частоты и числа голосов (SfxLimiter) и плотности звуков боя
 *   (BattleMix: удары режутся первыми, ульта и смерти слышны всегда), серия монет — вверх по тону.
 *   Звуки — AudioBuffer (короткие, старт мгновенный), файлы качаются в фоне после старта.
 * - Музыка и фон: `music('home')`, `ambience('amb_swamp')` — плавная смена (перекрёстное затухание), музыка
 *   приглушается под стингеры (победа, повышение уровня). Экран сам выбирает музыку (sceneSound при старте сцены).
 *   Дорожка из файла (треки RO, 98–273 с) играет ПОТОКОМ: HTMLAudioElement → createMediaElementSource → GainNode → шина;
 *   браузер декодирует кусками, в памяти несколько МБ при любой длине (AudioBuffer трека RO — до ~105 МБ PCM;
 *   docs/TASK_MUSIC_STREAMING.md). Остановленный поток отпускает декодер и сеть (src снят, load()). Заглушки без
 *   файла — AudioBuffer, как звуки (в памяти — две последние, по ~1.5 МБ).
 * - Файлы владельца: assets/audio/<id>.(ogg|m4a|mp3) побеждают заглушки (как фоны глав в backdrops.ts);
 *   нет файла или он не играет — звук синтезируется кодом (audioSynth.ts).
 * - Разблокировка на iOS/Android — первым касанием (Phaser + своя подстраховка, она же повторяет play() потоков,
 *   которым браузер не дал играть до касания); вкладка скрыта / Telegram свёрнут — тишина, потоки на паузе (не качают
 *   и не тратят батарею) и продолжают с того же места. Нет Web Audio (headless, старый браузер) — всё молча ничего не делает.
 *
 * - «Своя музыка» (audioSettings.ownMusic, docs/design/audio.md «Своя музыка игрока»): игрок слушает свою музыку
 *   (Spotify, Яндекс Музыка, Apple Music). <audio> берёт аудиофокус на iOS и Android и останавливает чужую музыку, Web Audio
 *   с AudioBuffer — нет (Chrome Android), а на iOS сессия 'ambient' (navigator.audioSession) смешивает звуки игры с
 *   чужими. Поэтому в режиме музыка и фон игры не создаются вовсе, звуки — как обычно (AudioBuffer).
 *
 * Модуль не импортирует Phaser во время выполнения (только типы) — его можно звать из тестируемых модулей (juice.ts).
 */
import type Phaser from 'phaser';
import { AMBIENCE, MUSIC, SFX, SUMMON_REVEAL, SUMMON_TENSION_MS, type AmbienceId, type MusicId, type SfxId } from './audioCatalog';
import {
  applyAudioSession,
  audioSessionType,
  categoryVolume,
  loadAudioSettings,
  MuteReasons,
  PitchStreak,
  ruleOf,
  saveAudioSettings,
  shouldHintOwnMusic,
  SoundGate,
  type AudioSessionType,
  type AudioSettings,
  type SceneSound,
  type SoundRule,
} from './audioCore';
import { musicJob, synthAmbience, synthSfx, type Pcm } from './audioSynth';

// ---------- файлы владельца ----------

/** Файлы assets/audio/: имя без расширения → URL (от корня assets) по расширениям. */
const FILES: Record<string, Record<string, string>> = {};
for (const path of Object.keys(import.meta.glob('../../assets/audio/*.{ogg,m4a,mp3}', { query: '?url', import: 'default' }))) {
  const name = path.split('/').pop()!;
  const m = /^(.+)\.(ogg|m4a|mp3)$/.exec(name);
  if (m) (FILES[m[1]] ??= {})[m[2]] = `audio/${name}`;
}

let canPlay: ((type: string) => boolean) | null = null;
/** Умеет ли браузер этот тип (проба одним <audio>, ответ запоминается). */
function can(type: string): boolean {
  if (!canPlay) {
    let probe: HTMLAudioElement | null = null;
    try {
      probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
    } catch {
      probe = null;
    }
    const memo = new Map<string, boolean>();
    canPlay = (t) => {
      let v = memo.get(t);
      if (v === undefined) memo.set(t, (v = !!probe?.canPlayType?.(t).replace('no', '')));
      return v;
    };
  }
  return canPlay(type);
}

/**
 * Файлы в порядке предпочтения для этого браузера: OGG (Opus/Vorbis — Chrome, Android, Firefox), M4A (AAC — Safari,
 * iOS, macOS), MP3 (везде). Сначала те, что браузер обещает сыграть; остальные — в конце, на случай неверного ответа
 * canPlayType. Не раскодировался первый — пробуем следующий (load).
 */
function fileUrls(base: string): string[] {
  const f = FILES[base];
  if (!f) return [];
  const ok = {
    ogg: can('audio/ogg; codecs="opus"') || can('audio/ogg; codecs="vorbis"'),
    m4a: can('audio/mp4; codecs="mp4a.40.2"'),
    mp3: can('audio/mpeg'),
  };
  const order = (['ogg', 'm4a', 'mp3'] as const).filter((e) => f[e]);
  return [...order.filter((e) => ok[e]), ...order.filter((e) => !ok[e])].map((e) => f[e]);
}

/** Варианты звука: <id>, <id>_v2, <id>_v3… (удары RO — несколько файлов, чередуются). Только те, что есть. */
function sfxVariants(id: string): string[] {
  const out: string[] = FILES[id] ? [id] : [];
  for (let k = 2; FILES[`${id}_v${k}`]; k++) out.push(`${id}_v${k}`);
  return out;
}

/** Какие звуки и дорожки заменены файлами владельца (для отладки и отчёта). */
export const audioFiles = (): string[] => Object.keys(FILES).sort();

// ---------- настройки ----------

export const audioSettings: AudioSettings = loadAudioSettings();

// iOS: тип аудиосессии — до того, как Phaser создаст AudioContext (модуль грузится раньше new Phaser.Game).
applyAudioSession(audioSessionType(audioSettings));

/** Изменить настройки (что передано) — запомнить и сразу применить («Своя музыка» — погасить / вернуть музыку). */
export function setAudioSettings(patch: Partial<AudioSettings>): void {
  const wasOwn = audioSettings.ownMusic;
  Object.assign(audioSettings, patch);
  saveAudioSettings(audioSettings);
  if (audioSettings.ownMusic !== wasOwn) {
    if (engine) engine.syncOwnMusic();
    else applyAudioSession(audioSessionType(audioSettings));
  }
  engine?.applyVolumes();
}

/**
 * Подсказка про «Свою музыку» (Город, один раз): true — показать сейчас (и больше никогда). Музыка игры должна была
 * реально заиграть, настройка выключена.
 */
export function takeOwnMusicHint(): boolean {
  if (!shouldHintOwnMusic(audioSettings, !!engine?.musicHeard)) return false;
  setAudioSettings({ ownMusicHint: true });
  return true;
}

// ---------- движок ----------

interface WebAudioManager {
  context?: AudioContext;
  destination?: AudioNode;
  locked?: boolean;
  once?: (event: string, fn: () => void) => void;
}

/** Дорожка музыки или фона: заглушка (AudioBuffer в памяти) или файл потоком (<audio> через Web Audio). */
type Track = BufferTrack | StreamTrack;
interface BufferTrack {
  kind: 'buffer';
  id: string;
  gain: GainNode;
  src: AudioBufferSourceNode;
}
interface StreamTrack {
  kind: 'stream';
  id: string;
  gain: GainNode;
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  /** Один файл в разных форматах (ogg, m4a…) и какой сейчас пробуем. */
  urls: readonly string[];
  at: number;
  /** Уже звучал (нарастание сделано). */
  started: boolean;
  /** Затухает перед освобождением (не продолжать после паузы). */
  stopping: boolean;
  /** Файл не играет: заглушка вместо него (music / ambience ещё раз). */
  onFail: () => void;
}

/** Откуда играть дорожку: файл потоком (есть и не ломался) или заглушка из кода (AudioBuffer). */
export type TrackSource = { kind: 'stream'; key: string; urls: string[] } | { kind: 'buffer'; key: string };

/**
 * Выбор источника дорожки (чистая функция, проверяется в тестах). files — файлы дорожки по порядку (своя, затем общая);
 * urlsOf — URL файла в форматах браузера (нет файла — пусто); failed — ключи файлов, которые не заиграли.
 * Ключ потока — по файлу: две дорожки с одним файлом (карта и бой канализации) — одна и та же музыка, без перезапуска.
 * Ключ заглушки — по дорожке.
 */
export function trackSource(prefix: 'music' | 'amb', id: string, files: readonly string[], urlsOf: (f: string) => string[], failed: ReadonlySet<string>): TrackSource {
  for (const f of files) {
    const key = `${prefix}:${f}`;
    if (failed.has(key)) continue;
    const urls = urlsOf(f);
    if (urls.length) return { kind: 'stream', key, urls };
  }
  return { kind: 'buffer', key: prefix === 'amb' ? `amb:${id}` : `music:${id}` };
}

const FADE_S = 0.8;
/** Файлы звуков качаем не больше стольких сразу. */
const LOAD_PARALLEL = 3;
/** Через сколько мс после старта начинать качать звуки (экран загрузки и первый экран — важнее). */
const PRELOAD_DELAY_MS = 1500;

type PlayOpts = { rate?: number; gain?: number; delay?: number };
const DUCK_TO = 0.35;

export class AudioEngine {
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Ключи файлов, которые не загрузились / не заиграли: дальше вместо них заглушка. */
  readonly failed = new Set<string>();
  /** Живые потоки (играют или затухают перед освобождением). */
  private readonly streams = new Set<StreamTrack>();
  /** Потоки, которым браузер не дал играть до первого касания (автоплей): play() ещё раз в unlock. */
  private readonly pendingPlay = new Set<StreamTrack>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  /** Частота, голоса и плотность звуков боя (audioCore.ts). */
  private readonly limiter = new SoundGate();
  private readonly coinPitch = new PitchStreak();
  private readonly gemPitch = new PitchStreak();
  readonly mute = new MuteReasons();
  private readonly master: GainNode;
  private readonly bus: { music: GainNode; duck: GainNode; sfx: GainNode; battle: GainNode; ui: GainNode; voice: GainNode };
  /** Озвучка, которая звучит сейчас (одна реплика за раз), и номер просьбы — поздний ответ загрузки не перебивает новую. */
  private voiceSrc: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private voiceAsk = 0;
  private musicTrack: Track | null = null;
  private ambTrack: Track | null = null;
  /** Какую музыку просили последней (файл ещё грузится — не перебивать более поздней просьбой). */
  private wantMusic: string | null = null;
  private wantAmb: string | null = null;
  /** Музыка и фон, которые просил экран (в режиме «Своя музыка» не играют; выключили режим — заиграют эти). */
  private askedMusic: MusicId | null = null;
  private askedAmb: AmbienceId | null = null;
  /** Музыка игры хоть раз реально звучала (для подсказки про «Свою музыку»). */
  musicHeard = false;
  /** Какой тип аудиосессии выставлен (null — API нет: Chrome, Android, старый iOS). */
  session: AudioSessionType | null = null;
  private duckUntil = 0;

  constructor(
    readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    this.master = ctx.createGain();
    this.master.connect(out);
    const g = () => ctx.createGain();
    this.bus = { music: g(), duck: g(), sfx: g(), battle: g(), ui: g(), voice: g() };
    this.bus.duck.connect(this.bus.music);
    this.bus.music.connect(this.master);
    this.bus.sfx.connect(this.master);
    this.bus.battle.connect(this.master);
    this.bus.ui.connect(this.master);
    this.bus.voice.connect(this.master);
    this.session = applyAudioSession(audioSessionType(audioSettings));
    this.applyVolumes();
  }

  /**
   * «Своя музыка» включили / выключили (audioSettings.ownMusic). Включили — аудиосессия 'ambient' (iOS), музыка и фон
   * плавно гаснут, их <audio> отпускаются (пауза, файл снят — аудиофокус свободен); новых не создаём. Выключили —
   * сессия 'auto', заиграет музыка и фон, которые просил текущий экран.
   */
  syncOwnMusic(): void {
    this.session = applyAudioSession(audioSessionType(audioSettings));
    if (audioSettings.ownMusic) {
      this.wantMusic = null;
      this.wantAmb = null;
      this.stopTrack(this.musicTrack);
      this.musicTrack = null;
      this.stopTrack(this.ambTrack);
      this.ambTrack = null;
      return;
    }
    this.music(this.askedMusic);
    this.ambience(this.askedAmb);
  }

  private set(p: AudioParam, v: number, tau = 0.05): void {
    const t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(v, t, tau);
  }

  applyVolumes(): void {
    const s = audioSettings;
    this.set(this.master.gain, this.mute.active ? 0 : 1, 0.02);
    this.set(this.bus.music.gain, categoryVolume('music', s));
    this.set(this.bus.sfx.gain, categoryVolume('sfx', s));
    this.set(this.bus.battle.gain, categoryVolume('battle', s));
    this.set(this.bus.ui.gain, categoryVolume('ui', s));
    this.set(this.bus.voice.gain, s.muted ? 0 : s.voice);
  }

  /**
   * Файл (если есть) или заглушка; null — пока грузится файл или рендерится длинная заглушка
   * (звук пропускается, музыка заиграет, когда будет готова). Файл не загрузился — заглушка.
   */
  private buffer(key: string, files: readonly string[], synth: () => Pcm | Job): AudioBuffer | null {
    const have = this.buffers.get(key);
    if (have) return have;
    if (this.loading.has(key)) return null;
    const urls = this.failed.has(key) ? [] : (files.map(fileUrls).find((u) => u.length) ?? []);
    if (urls.length) {
      void this.load(key, urls);
      return null;
    }
    const made = synth();
    if ('steps' in made) {
      // Длинная петля: рендер по шагам между кадрами.
      const p = runSteps(made.steps).then(() => {
        this.loading.delete(key);
        const buf = pcmBuffer(this.ctx, made.pcm);
        this.buffers.set(key, buf);
        return buf;
      });
      this.loading.set(key, p);
      return null;
    }
    const buf = pcmBuffer(this.ctx, made);
    this.buffers.set(key, buf);
    return buf;
  }

  /**
   * Загрузить и раскодировать файл (один раз). urls — один звук в разных форматах: не скачался или не раскодировался
   * первый (Safari и Ogg) — следующий. Ни один — ключ помечен, дальше играет заглушка.
   */
  load(key: string, urls: readonly string[]): Promise<AudioBuffer | null> {
    const busy = this.loading.get(key);
    if (busy) return busy;
    const attempt = (i: number): Promise<AudioBuffer> =>
      fetch(urls[i])
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => this.ctx.decodeAudioData(data))
        .catch((e: unknown) => (i + 1 < urls.length ? attempt(i + 1) : Promise.reject(e)));
    const p = attempt(0)
      .then((buf) => {
        this.buffers.set(key, buf);
        this.loading.delete(key);
        return buf;
      })
      .catch((e: unknown) => {
        console.warn(`Звук ${urls.join(' / ')} не загрузился (${String(e)}), играет заглушка`);
        this.failed.add(key);
        this.loading.delete(key);
        return null;
      });
    this.loading.set(key, p);
    return p;
  }

  /** Очередь загрузки файлов звуков: не больше LOAD_PARALLEL сразу (не спорить с картинками экрана за сеть). */
  private readonly queue: [string, string[]][] = [];
  private queued = new Set<string>();
  private inFlight = 0;
  private enqueue(key: string, urls: string[]): void {
    if (this.buffers.has(key) || this.loading.has(key) || this.queued.has(key) || this.failed.has(key) || !urls.length) return;
    this.queued.add(key);
    this.queue.push([key, urls]);
    this.pump();
  }
  private pump(): void {
    while (this.inFlight < LOAD_PARALLEL && this.queue.length) {
      const [key, urls] = this.queue.shift()!;
      this.queued.delete(key);
      this.inFlight++;
      void this.load(key, urls).finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  /**
   * В фоне после старта: файлы звуков загрузить (интерфейс и награды — первыми, по порядку каталога), заглушки
   * отрендерить заранее (по одной за тик) — первое нажатие не ждёт синтеза. Музыка сюда не входит: она грузится,
   * только когда экран её попросит.
   */
  preloadSfx(): void {
    const ids = Object.keys(SFX) as SfxId[];
    setTimeout(() => {
      for (const id of ids) for (const v of sfxVariants(id)) this.enqueue(`sfx:${v}`, fileUrls(v));
    }, PRELOAD_DELAY_MS);
    const queue = ids.filter((id) => !sfxVariants(id).length);
    const tick = () => {
      const id = queue.shift();
      if (!id) return;
      this.sfxBuffer(id);
      setTimeout(tick, 30);
    };
    setTimeout(tick, 300);
  }

  /** Загрузить файлы заранее (звуки монстров перед боем). Нет файла — пропустить. */
  preloadFiles(names: readonly string[]): void {
    for (const n of names) this.enqueue(`sfx:${n}`, fileUrls(n));
  }

  private readonly lastVariant = new Map<string, number>();
  /** Буфер звука: вариант файла (случайный, не тот же, что в прошлый раз) или заглушка. */
  private sfxBuffer(id: SfxId): AudioBuffer | null {
    const vars = sfxVariants(id);
    if (vars.length <= 1) return this.buffer(`sfx:${id}`, [id], () => synthSfx(id));
    const last = this.lastVariant.get(id) ?? -1;
    let k = Math.floor(Math.random() * (vars.length - 1));
    if (k >= last && last >= 0) k++;
    this.lastVariant.set(id, k);
    const buf = this.buffer(`sfx:${vars[k]}`, [vars[k]], () => synthSfx(id));
    // Этот вариант ещё грузится — сыграть любой готовый.
    return buf ?? vars.map((v) => this.buffers.get(`sfx:${v}`)).find((b) => b) ?? null;
  }

  play(id: SfxId, o: PlayOpts = {}): void {
    const def = SFX[id];
    if (this.silent(def.cat)) return;
    const buf = this.sfxBuffer(id);
    if (!buf) return;
    let rate = o.rate ?? 1;
    const now = performance.now() + (o.delay ?? 0) * 1000;
    if (!this.limiter.tryPlay(id, now, (buf.duration / rate) * 1000, ruleOf(id))) return;
    if (id === 'coin') rate *= this.coinPitch.next(now);
    if (id === 'gem') rate *= this.gemPitch.next(now);
    this.emit(buf, def.gain * (o.gain ?? 1), this.bus[def.cat], rate, o.delay ?? 0, 'duck' in def && !!def.duck);
  }

  /**
   * Звук-файл без записи в каталоге (звуки монстров RO, mon_*). false — файла нет или он ещё не загружен
   * (вызывающий играет общий звук каталога); true — звук сыгран или пропущен ограничителем / выключенным звуком.
   */
  playFile(name: string, rule: SoundRule, o: PlayOpts = {}): boolean {
    if (!FILES[name]) return false;
    const key = `sfx:${name}`;
    const buf = this.buffers.get(key);
    if (!buf) {
      this.enqueue(key, fileUrls(name));
      return false;
    }
    // Файлы без каталога — звуки монстров RO: шина «Звуки боя».
    if (this.silent('battle')) return true;
    const rate = o.rate ?? 1;
    const now = performance.now() + (o.delay ?? 0) * 1000;
    if (this.limiter.tryPlay(name, now, (buf.duration / rate) * 1000, rule)) this.emit(buf, o.gain ?? 1, this.bus.battle, rate, o.delay ?? 0, false);
    return true;
  }

  /** Звук этой категории сейчас не слышен — не тратить на него голос. */
  private silent(cat: 'sfx' | 'battle' | 'ui'): boolean {
    return this.mute.active || categoryVolume(cat, audioSettings) <= 0;
  }

  private emit(buf: AudioBuffer, gain: number, bus: AudioNode, rate: number, delay: number, duck: boolean): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    const at = this.ctx.currentTime + delay;
    src.start(at);
    src.onended = () => g.disconnect();
    if (duck) this.duck(at, buf.duration / rate);
  }

  /**
   * Реплика озвучки (voice.ts): прежняя обрывается, музыка приглушается на время реплики. Буфер не кэшируется —
   * минуты речи в памяти ни к чему, файл маленький и лежит в кэше браузера. Возвращает длительность (с) или null —
   * файл не загрузился, озвучка выключена или за время загрузки попросили другую реплику.
   */
  async voice(key: string, url: string): Promise<number | null> {
    const ask = ++this.voiceAsk;
    this.stopVoice(false);
    if (audioSettings.muted || audioSettings.voice <= 0) return null;
    const buf = await this.load(`voice:${key}`, [url]);
    this.buffers.delete(`voice:${key}`);
    if (!buf || ask !== this.voiceAsk) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.bus.voice);
    const at = this.ctx.currentTime + 0.05;
    src.start(at);
    const cur = { src, gain };
    this.voiceSrc = cur;
    src.onended = () => {
      gain.disconnect();
      if (this.voiceSrc === cur) this.voiceSrc = null;
    };
    this.duck(at, buf.duration);
    return buf.duration;
  }

  /** Оборвать озвучку (листание, «Пропустить», закрытие); музыка возвращается плавно. */
  stopVoice(cancelPending = true): void {
    if (cancelPending) this.voiceAsk++;
    const cur = this.voiceSrc;
    if (!cur) return;
    this.voiceSrc = null;
    const t = this.ctx.currentTime;
    cur.gain.gain.setTargetAtTime(0, t, 0.03);
    try {
      cur.src.stop(t + 0.15);
    } catch {
      // Уже остановлен.
    }
    const p = this.bus.duck.gain;
    this.duckUntil = t;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(1, t, 0.3);
  }

  /** Приглушить музыку на время стингера и плавно вернуть. */
  private duck(at: number, dur: number): void {
    const p = this.bus.duck.gain;
    const end = Math.max(this.duckUntil, at + dur);
    this.duckUntil = end;
    p.cancelScheduledValues(at);
    p.setTargetAtTime(DUCK_TO, at, 0.05);
    p.setTargetAtTime(1, end, 0.4);
  }

  /** Заглушка (AudioBuffer в памяти): петля, нарастание за FADE_S. */
  private startTrack(key: string, buf: AudioBuffer, gain: number, bus: AudioNode): Track {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(bus);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Файл с тишиной по краям (задержка кодека MP3/AAC) — петля без неё, иначе на стыке пауза.
    const [a, b] = loopEdges(buf);
    if (a > 0 || b < buf.duration) {
      src.loopStart = a;
      src.loopEnd = b;
    }
    src.connect(g);
    src.start(0, a);
    this.fadeIn(g, gain);
    return { kind: 'buffer', id: key, gain: g, src };
  }

  private fadeIn(g: GainNode, gain: number): void {
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + FADE_S);
  }

  /**
   * Файл потоком: <audio> → MediaElementAudioSourceNode → GainNode → шина. Браузер декодирует кусками — в памяти
   * несколько МБ при любой длине трека. Элемент новый на каждый старт (createMediaElementSource — один раз на элемент).
   * Ассеты с того же домена — crossOrigin не нужен (переедут на CDN — el.crossOrigin = 'anonymous' и CORS на CDN,
   * иначе Web Audio получит тишину). Нарастание — когда звук реально пошёл (файл докачался, касание было).
   */
  private startStream(key: string, urls: readonly string[], gain: number, bus: AudioNode, onFail: () => void): StreamTrack {
    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.src = urls[0];
    const node = this.ctx.createMediaElementSource(el);
    const g = this.ctx.createGain();
    g.gain.value = 0;
    node.connect(g);
    g.connect(bus);
    const tr: StreamTrack = { kind: 'stream', id: key, gain: g, el, node, urls, at: 0, started: false, stopping: false, onFail };
    this.streams.add(tr);
    el.addEventListener('playing', () => {
      if (tr.started || tr.stopping) return;
      tr.started = true;
      if (key.startsWith('music:')) this.musicHeard = true;
      this.fadeIn(g, gain);
    });
    el.addEventListener('error', () => this.streamFailed(tr, tr.at, el.error ? `код ${el.error.code}` : 'ошибка'));
    this.playStream(tr);
    return tr;
  }

  /** play() потока. До первого касания браузер отказывает (автоплей) — повторим в unlock; иное — файл не играет. */
  private playStream(tr: StreamTrack): void {
    if (tr.stopping || this.mute.active) return;
    const at = tr.at;
    let p: Promise<void> | undefined;
    try {
      p = tr.el.play();
    } catch (e) {
      this.streamFailed(tr, at, String(e));
      return;
    }
    p?.then(
      () => this.pendingPlay.delete(tr),
      (e: unknown) => {
        const name = (e as { name?: string } | null)?.name;
        if (name === 'NotAllowedError') this.pendingPlay.add(tr);
        // AbortError — play() прервали паузой / сменой файла (свернули, остановили): не ошибка файла.
        else if (name !== 'AbortError') this.streamFailed(tr, at, String(e));
      },
    );
  }

  /** Были отказы автоплея: после касания попробовать ещё раз (зовётся из обработчика касания — жест пользователя). */
  retryPending(): void {
    for (const tr of [...this.pendingPlay]) {
      this.pendingPlay.delete(tr);
      this.playStream(tr);
    }
  }

  get hasPending(): boolean {
    return this.pendingPlay.size > 0;
  }

  /**
   * Файл в этом формате не играет: следующий формат (ogg → m4a), иначе ключ помечен и дорожка — заглушкой.
   * at — какой формат пробовали (ошибка и отказ play() могут прийти оба — считаем один раз).
   */
  private streamFailed(tr: StreamTrack, at: number, why: string): void {
    if (tr.stopping || at !== tr.at) return;
    if (tr.at + 1 < tr.urls.length) {
      tr.at++;
      tr.el.src = tr.urls[tr.at];
      this.playStream(tr);
      return;
    }
    console.warn(`Звук ${tr.urls.join(' / ')} не загрузился (${why}), играет заглушка`);
    this.failed.add(tr.id);
    this.release(tr);
    tr.onFail();
  }

  /** Отпустить поток: пауза, снять файл (load() освобождает декодер и сеть), отключить узлы, забыть ссылки. */
  private release(tr: StreamTrack): void {
    tr.stopping = true;
    this.streams.delete(tr);
    this.pendingPlay.delete(tr);
    try {
      tr.el.pause();
      tr.el.removeAttribute('src');
      tr.el.load();
    } catch {
      // Элемент уже мёртв — не страшно.
    }
    tr.node.disconnect();
    tr.gain.disconnect();
    if (this.musicTrack === tr) this.musicTrack = null;
    if (this.ambTrack === tr) this.ambTrack = null;
  }

  private stopTrack(tr: Track | null): void {
    if (!tr) return;
    const t = this.ctx.currentTime;
    tr.gain.gain.cancelScheduledValues(t);
    tr.gain.gain.setValueAtTime(tr.gain.gain.value, t);
    tr.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
    if (tr.kind === 'stream') {
      tr.stopping = true;
      this.pendingPlay.delete(tr);
      // Таймер, а не часы контекста: свёрнутый (suspend) контекст стоит, а поток отпустить нужно всё равно.
      setTimeout(() => this.release(tr), FADE_S * 1000 + 50);
      return;
    }
    try {
      tr.src.stop(t + FADE_S + 0.05);
    } catch {
      // Уже остановлен.
    }
    tr.src.onended = () => tr.gain.disconnect();
  }

  music(id: MusicId | null): void {
    this.askedMusic = id;
    // «Своя музыка»: музыки игры нет вовсе (ни <audio>, ни заглушки) — чужая музыка не прерывается.
    if (audioSettings.ownMusic) id = null;
    if (!id) {
      this.wantMusic = null;
      this.stopTrack(this.musicTrack);
      this.musicTrack = null;
      return;
    }
    const def = MUSIC[id];
    // Ключ — по файлу: у двух дорожек один файл (карта и бой канализации) — музыка не перезапускается.
    const src = trackSource('music', id, def.files, fileUrls, this.failed);
    const key = src.key;
    this.wantMusic = key;
    if (this.musicTrack?.id === key) return;
    if (src.kind === 'stream') {
      this.stopTrack(this.musicTrack);
      this.musicTrack = this.startStream(key, src.urls, def.gain, this.bus.duck, () => {
        if (this.wantMusic === key) this.music(id);
      });
      return;
    }
    const buf = this.buffer(key, [], () => musicJob(id));
    if (!buf) {
      // Заглушка рендерится: как будет готова — заиграет, если её всё ещё ждут.
      void this.loading.get(key)?.then(() => {
        if (this.wantMusic === key) this.music(id);
      });
      return;
    }
    this.stopTrack(this.musicTrack);
    this.musicTrack = this.startTrack(key, buf, def.gain, this.bus.duck);
    if (this.ctx.state === 'running' && !this.mute.active) this.musicHeard = true;
    this.keepRecentMusic(key);
  }

  /**
   * Заглушки музыки в памяти (~1.5 МБ на петлю 10–35 с): держим две последние (главная ↔ бой без повторного рендера).
   * Музыка из файлов сюда не попадает: она играет потоком, повторный старт берёт файл из HTTP-кэша браузера.
   */
  private readonly recentMusic: string[] = [];
  private keepRecentMusic(key: string): void {
    const r = this.recentMusic;
    const i = r.indexOf(key);
    if (i >= 0) r.splice(i, 1);
    r.push(key);
    while (r.length > 2) this.buffers.delete(r.shift()!);
  }

  ambience(id: AmbienceId | null): void {
    this.askedAmb = id;
    if (audioSettings.ownMusic) id = null;
    if (!id) {
      this.wantAmb = null;
      this.stopTrack(this.ambTrack);
      this.ambTrack = null;
      return;
    }
    const def = AMBIENCE[id];
    const src = trackSource('amb', id, def.files, fileUrls, this.failed);
    const key = src.key;
    this.wantAmb = key;
    if (this.ambTrack?.id === key) return;
    if (src.kind === 'stream') {
      this.stopTrack(this.ambTrack);
      this.ambTrack = this.startStream(key, src.urls, def.gain, this.bus.sfx, () => {
        if (this.wantAmb === key) this.ambience(id);
      });
      return;
    }
    const buf = this.buffer(key, [], () => synthAmbience(id));
    if (!buf) {
      void this.loading.get(key)?.then(() => {
        if (this.wantAmb === key) this.ambience(id);
      });
      return;
    }
    this.stopTrack(this.ambTrack);
    this.ambTrack = this.startTrack(key, buf, def.gain, this.bus.sfx);
  }

  /**
   * Вкладка скрыта / Telegram свёрнут: тишина и остановка аудио-часов (батарея). Потоки — на паузу: suspend контекста
   * <audio> не останавливает, он бы качал и декодировал дальше. Вернулись — продолжают с того же места.
   */
  setMuted(reason: string, on: boolean): void {
    if (!this.mute.toggle(reason, on)) return;
    this.applyVolumes();
    for (const tr of this.streams) {
      if (this.mute.active) {
        try {
          tr.el.pause();
        } catch {
          // Не страшно.
        }
      } else this.playStream(tr);
    }
    try {
      if (this.mute.active) void this.ctx.suspend();
      else {
        // iOS: тип сессии — до возобновления контекста (после сворачивания система могла его сбросить).
        this.session = applyAudioSession(audioSessionType(audioSettings));
        void this.ctx.resume();
      }
    } catch {
      // Контекст закрыт — не страшно.
    }
  }

  /**
   * Отладка и тесты (window.__audio.stats() в dev): буферы в памяти (trackBuffers — из них заглушки музыки и фона;
   * файлов музыки среди них нет), живые потоки (играют или затухают: после смены музыки ≤ 2 на время затухания, 1 потом),
   * текущие музыка и фон.
   */
  stats(): {
    buffers: number;
    trackBuffers: string[];
    streams: number;
    music: string | null;
    ambience: string | null;
    ownMusic: boolean;
    session: AudioSessionType | null;
  } {
    const trackBuffers = [...this.buffers.keys()].filter((k) => k.startsWith('music:') || k.startsWith('amb:'));
    return {
      buffers: this.buffers.size,
      trackBuffers,
      streams: this.streams.size,
      music: this.musicTrack?.id ?? null,
      ambience: this.ambTrack?.id ?? null,
      ownMusic: audioSettings.ownMusic,
      session: this.session,
    };
  }
}


type Job = { pcm: Pcm; steps: (() => void)[] };

/** Выполнить шаги рендера между кадрами: не больше ~6 мс работы за тик. */
function runSteps(steps: (() => void)[]): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      const t0 = performance.now();
      while (i < steps.length && performance.now() - t0 < 6) steps[i++]();
      if (i < steps.length) setTimeout(tick, 0);
      else resolve();
    };
    setTimeout(tick, 0);
  });
}

/** Начало и конец звука без цифровой тишины по краям, с (для петли). */
export function loopEdges(buf: { duration: number; length: number; sampleRate: number; numberOfChannels: number; getChannelData(c: number): Float32Array }): [number, number] {
  const ch = [...Array(buf.numberOfChannels).keys()].map((c) => buf.getChannelData(c));
  const loud = (i: number) => ch.some((d) => Math.abs(d[i]) > 1e-4);
  let a = 0;
  while (a < buf.length && !loud(a)) a++;
  let b = buf.length;
  while (b > a && !loud(b - 1)) b--;
  if (b - a < buf.sampleRate * 0.5) return [0, buf.duration];
  return [a / buf.sampleRate, b / buf.sampleRate];
}

function pcmBuffer(ctx: AudioContext, pcm: Pcm): AudioBuffer {
  const buf = ctx.createBuffer(1, pcm.data.length, pcm.rate);
  buf.getChannelData(0).set(pcm.data);
  return buf;
}

let engine: AudioEngine | null = null;

/** Звук включён и работает (есть Web Audio). */
export const audioReady = (): boolean => !!engine;

/** Для отладки (window.__audio в dev). */
export const audioStats = () => engine?.stats() ?? null;

// ---------- публичный API ----------

/** Проиграть звук. Безопасно звать всегда: нет звука / выключен / слишком часто — ничего не делает. */
export function sfx(id: SfxId, o: PlayOpts = {}): void {
  try {
    engine?.play(id, o);
  } catch {
    // Звук не должен ломать игру.
  }
}

/**
 * Свой звук-файл (звуки монстров RO, mon_*): false — файла нет или ещё не загружен (тогда сыграть общий звук
 * каталога), true — обработан. rule — ограничитель частоты для этого файла.
 */
export function sfxFile(name: string, rule: SoundRule, o: { rate?: number; gain?: number; delay?: number } = {}): boolean {
  try {
    return engine?.playFile(name, rule, o) ?? false;
  } catch {
    return false;
  }
}

/** Реплика озвучки по URL (voice.ts): длительность в секундах или null (нет звука, не загрузилась, перебили). */
export function playVoiceFile(key: string, url: string): Promise<number | null> {
  try {
    return engine?.voice(key, url).catch(() => null) ?? Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
}

/** Оборвать озвучку. */
export function stopVoiceFile(): void {
  try {
    engine?.stopVoice();
  } catch {
    // Звук не должен ломать игру.
  }
}

/** Загрузить звуки-файлы заранее (перед боем — звуки его монстров). */
export function preloadSoundFiles(names: readonly string[]): void {
  try {
    engine?.preloadFiles(names);
  } catch {
    // Звук не должен ломать игру.
  }
}

/** Сменить музыку (плавно). null — тишина. Та же дорожка — продолжает играть с того же места. */
export function music(id: MusicId | null): void {
  try {
    engine?.music(id);
  } catch {
    // Звук не должен ломать игру.
  }
}

/** Сменить фоновый звук (ветер, болото, капли). null — без фона. */
export function ambience(id: AmbienceId | null): void {
  try {
    engine?.ambience(id);
  } catch {
    // Звук не должен ломать игру.
  }
}

/** Применить звук экрана (sceneSound): null в music — оставить текущую музыку. */
export function applySceneSound(s: SceneSound): void {
  if (s.music) music(s.music);
  if (s.ambience !== undefined) ambience(s.ambience);
}

/**
 * Призыв в таверне (для будущей TavernScene): вихрь, нарастание (длиннее у редких) и открытие по редкости.
 * Возвращает, через сколько мс показывать героя (нарастание кончилось).
 */
export function summonSound(rarity: keyof typeof SUMMON_REVEAL): number {
  sfx('summon_pull');
  const tension = SUMMON_TENSION_MS[rarity];
  const reveal = 450 + tension;
  if (tension > 0) sfx('summon_tension', { delay: 0.35, rate: 1600 / Math.max(800, tension + 200) });
  sfx(SUMMON_REVEAL[rarity], { delay: reveal / 1000 });
  return reveal;
}

/**
 * Включить звук: один раз после загрузки (BootScene.create). Берёт Web Audio контекст звукового менеджера Phaser;
 * его нет (NoAudio / HTML5 Audio) — звук молча выключен. sceneFor — звук экрана при каждом старте сцены.
 */
export function installAudio(game: Phaser.Game, sceneFor?: (scene: Phaser.Scene) => SceneSound): void {
  if (engine) return;
  try {
    const sm = game.sound as unknown as WebAudioManager;
    const ctx = sm.context;
    if (!ctx || !sm.destination) return;
    engine = new AudioEngine(ctx, sm.destination);
  } catch (e) {
    console.warn('Звук недоступен', e);
    engine = null;
    return;
  }
  const eng = engine;
  // Разблокировка: Phaser возобновляет контекст по первому касанию; подстраховка — своим pointerup/touchend
  // (слушаем, пока контекст не пошёл и есть потоки, ждущие касания).
  if (typeof document !== 'undefined') {
    const unlock = () => {
      if (eng.ctx.state !== 'running' && !eng.mute.active) {
        // iOS: тип сессии ('ambient' при «Своей музыке») — до возобновления контекста.
        eng.session = applyAudioSession(audioSessionType(audioSettings));
        void eng.ctx.resume().catch(() => undefined);
      }
      // Музыка-поток, которой браузер не дал играть до касания, — play() ещё раз внутри жеста.
      eng.retryPending();
      if (eng.ctx.state === 'running' && !eng.hasPending) {
        document.removeEventListener('pointerup', unlock, true);
        document.removeEventListener('touchend', unlock, true);
      }
    };
    document.addEventListener('pointerup', unlock, true);
    document.addEventListener('touchend', unlock, true);
    // Скрыта вкладка / свёрнут Telegram Mini App / телефон повёрнут — тишина (игра тоже на паузе, lifecycle.ts).
    const vis = () => eng.setMuted('hidden', document.hidden);
    document.addEventListener('visibilitychange', vis);
    vis();
    const tg = (window as unknown as { Telegram?: { WebApp?: { onEvent?: (e: string, cb: () => void) => void } } }).Telegram?.WebApp;
    tg?.onEvent?.('deactivated', () => eng.setMuted('telegram', true));
    tg?.onEvent?.('activated', () => eng.setMuted('telegram', false));
  }
  eng.preloadSfx();
  // Для отладки и e2e: window.__audio.stats() — буферы, потоки, текущая музыка и фон.
  if (import.meta.env.DEV && typeof window !== 'undefined') Object.assign(window, { __audio: { stats: audioStats, files: audioFiles, settings: audioSettings } });
  if (sceneFor) {
    for (const scene of game.scene.scenes) {
      scene.sys.events.on('start', () => {
        try {
          applySceneSound(sceneFor(scene));
        } catch {
          // Звук не должен ломать переход.
        }
      });
    }
  }
}
