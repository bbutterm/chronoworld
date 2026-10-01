// Звук промо: музыка (35 с, по кругу синхронно с таймлайном) и удары по IMPACTS. Браузеры не дают звук без жеста —
// AudioContext создаётся на первом касании. Формат: ogg, где играет (Chrome, Firefox), иначе m4a (Safari, iOS).
import { DUR, IMPACTS, clock, time } from './timeline.js';

const ext = new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
const url = (n) => `${import.meta.env.BASE_URL}audio/${n}.${ext}`;

let ctx = null;
let master = null;
let musicBuf = null;
let musicSrc = null;
const sfx = new Map();
let enabled = false;
let lastT = 0;
let musicZero = 0; // ctx.currentTime, когда музыка была бы в 0 с

async function load(name) {
  const r = await fetch(url(name));
  return ctx.decodeAudioData(await r.arrayBuffer());
}

function startMusic() {
  stopMusic();
  if (!musicBuf || !enabled || !clock.playing) return;
  const src = ctx.createBufferSource();
  src.buffer = musicBuf;
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = 0.55;
  src.connect(g).connect(master);
  const off = time.get() % DUR;
  src.start(0, off);
  musicSrc = src;
  musicZero = ctx.currentTime - off;
}
function stopMusic() {
  if (musicSrc) {
    try {
      musicSrc.stop();
    } catch {
      /* уже остановлен */
    }
    musicSrc = null;
  }
}

export function playSfx(name, gain = 0.9) {
  const b = sfx.get(name);
  if (!b || !enabled) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start();
}

export const sound = {
  get on() {
    return enabled;
  },
  listeners: new Set(),
  /** Включить по жесту пользователя (касание, клик). */
  async enable() {
    if (enabled) return;
    enabled = true;
    this.listeners.forEach((f) => f(true));
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.connect(ctx.destination);
      const names = [...new Set([...IMPACTS.map((i) => i.s), 'crit', 'hit_sword'])];
      names.forEach((n) => load(n).then((b) => sfx.set(n, b)).catch(() => {}));
      load('music_promo')
        .then((b) => {
          musicBuf = b;
          startMusic();
        })
        .catch(() => {});
    }
    await ctx.resume();
    startMusic();
  },
  disable() {
    enabled = false;
    stopMusic();
    this.listeners.forEach((f) => f(false));
  },
  toggle() {
    return enabled ? this.disable() : this.enable();
  },
};

// Удары — при проходе таймлайна через момент; перемотка (скачок) — перезапуск музыки с нового места.
time.on('change', (t) => {
  const jump = t < lastT ? t + DUR - lastT : t - lastT;
  if (enabled && clock.playing) {
    // Расхождение музыки и картинки (рывки вкладки, перемотка) больше 0,15 с — перезапуск с текущего места.
    const pos = musicSrc ? (((ctx.currentTime - musicZero) % DUR) + DUR) % DUR : t;
    const drift = Math.min(Math.abs(pos - t), DUR - Math.abs(pos - t));
    if (jump > 0.25 || drift > 0.15) startMusic();
    if (jump > 0 && jump <= 0.25)
      for (const i of IMPACTS) {
        const crossed = lastT <= t ? i.t > lastT && i.t <= t : i.t > lastT || i.t <= t;
        if (crossed) playSfx(i.s, 0.5 + i.f * 0.4);
      }
  }
  lastT = t;
});
clock.listeners.add((p) => (p ? startMusic() : stopMusic()));
