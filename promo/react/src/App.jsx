import { AnimatePresence, motion, useAnimationControls, useAnimationFrame, useTransform } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playSfx, sound } from './audio.js';
import { TgIcon, imgUrl, playUrl } from './components.jsx';
import { pointer } from './pointer.js';
import { SCENES } from './scenes.jsx';
import { DUR, IMPACTS, RENDER, clock, flashAt, redAt, seek, shakeAt, time, useTL } from './timeline.js';

/** Какие сцены держать в DOM в момент t: текущая, соседние (для перехода и подгрузки кадров). */
function mountedAt(t) {
  if (RENDER) return SCENES.map((_, i) => i).join(',');
  const out = [];
  SCENES.forEach((s, i) => {
    if (t >= s.a - 1.2 && t < s.b + 0.6) out.push(i);
  });
  if (t > DUR - 1.2) out.push(0);
  return out.join(',');
}
const sceneAt = (t) => Math.max(0, SCENES.findIndex((s) => t >= s.a && t < s.b));

const preloaded = new Set();
function preload(i) {
  for (const n of SCENES[i % SCENES.length].imgs) {
    if (preloaded.has(n)) continue;
    preloaded.add(n);
    new Image().src = imgUrl(n);
  }
}

const isDesk = () => !RENDER && window.matchMedia('(min-aspect-ratio: 4/5)').matches;

export default function App() {
  const [mounted, setMounted] = useState(() => mountedAt(time.get()));
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(clock.playing);
  const [soundOn, setSoundOn] = useState(false);
  const [hits, setHits] = useState([]);
  const [desk, setDesk] = useState(isDesk);
  const kick = useAnimationControls();
  const down = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    const off = time.on('change', (t) => {
      const m = mountedAt(t);
      setMounted((p) => (p === m ? p : m));
      const c = sceneAt(t);
      setCur((p) => (p === c ? p : c));
    });
    const onClock = (p) => setPlaying(p);
    const onSound = (p) => setSoundOn(p);
    clock.listeners.add(onClock);
    sound.listeners.add(onSound);
    const onResize = () => setDesk(isDesk());
    window.addEventListener('resize', onResize);
    return () => {
      off();
      clock.listeners.delete(onClock);
      sound.listeners.delete(onSound);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    preload(cur + 1);
    preload(cur + 2);
  }, [cur]);

  // Часы: обычный просмотр — время идёт по кадрам браузера; при рендере кадры ставит window.seek.
  useAnimationFrame((_, delta) => {
    if (!RENDER && clock.playing) seek(time.get() + Math.min(delta, 100) / 1000);
  });

  const go = useCallback((i) => {
    const n = (i + SCENES.length) % SCENES.length;
    seek(SCENES[n].a + 0.001);
  }, []);
  const togglePlay = useCallback(() => clock.set(!clock.playing), []);

  useEffect(() => {
    if (RENDER) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(sceneAt(time.get()) + 1);
      else if (e.key === 'ArrowLeft') go(sceneAt(time.get()) - 1);
      else if (e.key === ' ') togglePlay();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, togglePlay]);

  // Касание — удар (цифра урона, вспышка, тряска, звук); свайп вбок — соседняя сцена.
  const onDown = (e) => {
    down.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = (e) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    if (!sound.on) sound.enable();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      go(sceneAt(time.get()) + (dx < 0 ? 1 : -1));
      playSfx('hit_sword', 0.6);
      return;
    }
    if (Math.hypot(dx, dy) > 14) return;
    const r = stageRef.current.getBoundingClientRect();
    const crit = Math.random() < 0.35;
    const hit = {
      id: performance.now(),
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
      n: Math.round((crit ? 2600 : 600) + Math.random() * (crit ? 9000 : 1800)),
      crit,
      ang: -35 + Math.random() * 70,
    };
    setHits((h) => [...h.slice(-5), hit]);
    setTimeout(() => setHits((h) => h.filter((x) => x.id !== hit.id)), 1100);
    playSfx(crit ? 'crit' : 'hit_blunt', 0.9);
    kick.start({ x: [0, -10, 9, -5, 3, 0], y: [0, 6, -5, 3, 0, 0], transition: { duration: 0.32 } });
  };

  const world = useTL((t) => {
    const s = shakeAt(t);
    return { transform: `translate(${s.x * 100}cqw, ${s.y * 100}cqw) rotate(${s.r}deg)` };
  });
  const flash = useTL((t) => ({ opacity: String(flashAt(t)) }));
  const red = useTL((t) => ({ opacity: String(redAt(t) * 0.9) }));

  const rotY = useTransform(pointer.sx, (v) => (desk ? v * 7 : 0));
  const rotX = useTransform(pointer.sy, (v) => (desk ? -v * 5 : 0));
  const list = mounted.split(',').filter(Boolean).map(Number);

  return (
    <div className={`wrap${RENDER ? ' render' : ''}${desk ? ' desk' : ''}`}>
      <motion.div className="frame" style={{ rotateY: rotY, rotateX: rotX }}>
        <div ref={stageRef} className="stage" onPointerDown={onDown} onPointerUp={onUp}>
          <motion.div className="fill" animate={kick}>
            <div ref={world} className="fill world">
              {list.map((i) => {
                const S = SCENES[i];
                return <S.C key={S.id} a={S.a} b={S.b} />;
              })}
            </div>
          </motion.div>
          <div ref={red} className="fill redvig" />
          <div className="fill vig" />
          <div ref={flash} className="fill flash" />
          <AnimatePresence>
            {hits.map((h) => (
              <Hit key={h.id} h={h} />
            ))}
          </AnimatePresence>
          {!RENDER && (
            <Chrome
              cur={cur}
              playing={playing}
              soundOn={soundOn}
              onPlay={togglePlay}
              onSound={() => sound.toggle()}
              onSeg={go}
            />
          )}
        </div>
      </motion.div>
      {desk && !RENDER && <div className="deskhint">Касание — удар · свайп или ← → — сцены · пробел — пауза</div>}
    </div>
  );
}

function Hit({ h }) {
  return (
    <div className="hit" style={{ left: `${h.x}%`, top: `${h.y}%` }}>
      <motion.div
        className="slash"
        style={{ rotate: h.ang }}
        initial={{ scaleX: 0, opacity: 1 }}
        animate={{ scaleX: [0, 1.15, 1], opacity: [1, 1, 0] }}
        transition={{ duration: 0.38, times: [0, 0.4, 1] }}
      />
      <motion.div
        className="burst"
        initial={{ scale: 0.2, opacity: 0.9 }}
        animate={{ scale: 1.8, opacity: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      <motion.div
        className={`dmg ${h.crit ? 'crit' : ''}`}
        initial={{ y: 0, scale: 0.2, opacity: 0 }}
        animate={{ y: '-9cqw', scale: h.crit ? 1.25 : 1, opacity: [0, 1, 1, 0] }}
        exit={{ opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14, opacity: { duration: 1, times: [0, 0.1, 0.7, 1] } }}
      >
        {h.n.toLocaleString('ru-RU')}
        {h.crit && <span className="crit-t">КРИТ</span>}
      </motion.div>
    </div>
  );
}

function Chrome({ cur, playing, soundOn, onPlay, onSound, onSeg }) {
  // Подсказка про звук — первые 7 с, дальше остаётся кнопка звука.
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setHint(false), 7000);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="chrome" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <div className="segs">
        {SCENES.map((s, i) => (
          <Seg key={s.id} s={s} i={i} cur={cur} onSeg={onSeg} />
        ))}
      </div>
      <div className="bar">
        <motion.button whileTap={{ scale: 0.85 }} className="ico" onClick={onPlay} aria-label={playing ? 'Пауза' : 'Продолжить'}>
          {playing ? (
            <svg viewBox="0 0 24 24">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M7 5l12 7-12 7z" />
            </svg>
          )}
        </motion.button>
        <motion.button whileTap={{ scale: 0.85 }} className="ico" onClick={onSound} aria-label={soundOn ? 'Выключить звук' : 'Включить звук'}>
          <svg viewBox="0 0 24 24">
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            {soundOn ? (
              <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </motion.button>
        <span className="sp" />
        <motion.a whileTap={{ scale: 0.9 }} className="mini" href={playUrl} target="_blank" rel="noopener">
          <TgIcon />
          Играть
        </motion.a>
      </div>
      <AnimatePresence>
        {!soundOn && hint && (
          <motion.button
            className="hint"
            onClick={onSound}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.8 } }}
            exit={{ opacity: 0, y: 20 }}
          >
            <svg viewBox="0 0 24 24">
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Коснись — со звуком
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function Seg({ s, i, cur, onSeg }) {
  const ref = useTL((t) => ({ transform: `scaleX(${t >= s.b ? 1 : t <= s.a ? 0 : (t - s.a) / (s.b - s.a)})` }));
  return (
    <button className={`seg${i === cur ? ' on' : ''}`} style={{ flexGrow: s.b - s.a }} onClick={() => onSeg(i)} aria-label={s.label} title={s.label}>
      <i ref={ref} />
    </button>
  );
}

// Для рендера и отладки: window.seek(t) → кадр готов после двух кадров браузера.
window.seek = (t) => {
  seek(t);
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
window.promo = { DUR, IMPACTS, scenes: SCENES.map(({ id, label, a, b }) => ({ id, label, a, b })) };
