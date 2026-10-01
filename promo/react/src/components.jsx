// Кирпичики сцен. Всё, что зависит от времени ролика, — через useTL (функция времени, без таймеров), поэтому кадр при
// seek(t) один и тот же. Интерактив (наклон, касания) — обычные пружины Framer Motion поверх.
import { motion, useTransform } from 'framer-motion';
import { RENDER, clamp, easeInOut, easeOut, hash, lerp, prog, sp, useTL } from './timeline.js';
import { pointer } from './pointer.js';

const BASE = import.meta.env.BASE_URL;
/** Чёткость кадров: 1080 px на плотных экранах и при рендере, 720 px — где хватает (меньше трафика). */
const HI = RENDER || Math.min(window.innerWidth, 520) * (window.devicePixelRatio || 1) > 1000;
export const imgUrl = (name) => `${BASE}img/${name}${HI ? '' : '_720'}.webp`;
export const cardUrl = (name) => `${BASE}cards/${name}.webp`;

/** Сцена: видна с a до b (+ хвост, пока следующая проявляется поверх). */
export function Scene({ a, b, fade = 0.22, children, className = '' }) {
  const ref = useTL((t) => {
    const k = fade ? prog(t, a, a + fade) : t >= a ? 1 : 0;
    const vis = t >= a - 0.001 && t < b + 0.5;
    return { opacity: String(vis ? k : 0), visibility: vis ? 'visible' : 'hidden' };
  });
  return (
    <div ref={ref} className={`scene ${className}`}>
      {children}
    </div>
  );
}

/** Слой параллакса: глубина depth — сдвиг от наклона/пальца (в % ширины сцены). */
export function Depth({ depth = 1, children, className = 'fill' }) {
  const x = useTransform(pointer.sx, (v) => `${v * depth * 1.6}cqw`);
  const y = useTransform(pointer.sy, (v) => `${v * depth * 1.2}cqw`);
  return (
    <motion.div className={className} style={{ x, y }}>
      {children}
    </motion.div>
  );
}

/**
 * Кадр игры во весь экран: «cover» по 9:16 с фокусом (fx, fy — доли кадра, что остаётся в центре при обрезке),
 * ken-burns от from к to: [масштаб, сдвиг x %, сдвиг y %]. Дети — поверх кадра в его координатах (% от 1080×1920).
 */
export function Shot({ name, a, b, fx = 0.5, fy = 0.5, from = [1.04, 0, 0], to = [1.14, 0, 0], ease = easeInOut, blur = 0, dim = 0, children, depth = -0.8 }) {
  const ref = useTL((t) => {
    const k = ease(prog(t, a, b));
    const s = lerp(from[0], to[0], k);
    const x = lerp(from[1], to[1], k);
    const y = lerp(from[2], to[2], k);
    return { transform: `translate(${x}%, ${y}%) scale(${s * 1.04})` };
  });
  return (
    <Depth depth={depth}>
      <div ref={ref} className="cover" style={{ '--fx': fx, '--fy': fy, transformOrigin: `${fx * 100}% ${fy * 100}%` }}>
        <img
          src={imgUrl(name)}
          alt=""
          draggable={false}
          decoding="async"
          style={blur || dim ? { filter: `${blur ? `blur(${blur * 0.2}cqw) ` : ''}brightness(${1 - dim})` } : undefined}
        />
        {children}
      </div>
    </Depth>
  );
}

/** Затемнения сверху/снизу под надписи. */
export function Shade({ top = 0.42, bottom = 0, a, b }) {
  return (
    <>
      {top > 0 && <div className="shade-top" style={{ height: `${top * 100}%` }} />}
      {bottom > 0 && <div className="shade-bottom" style={{ height: `${bottom * 100}%` }} />}
    </>
  );
}

/** Текст, появляющийся по буквам (пружина на каждую букву), гаснет к out. */
export function Letters({ text, at, step = 0.032, cls = 'gold', stiff = 420, damp = 17, out = Infinity, drop = 0.7 }) {
  const ref = useTL((t, el) => {
    const kids = el.children;
    const fadeOut = 1 - prog(t, out - 0.18, out);
    for (let i = 0; i < kids.length; i++) {
      const v = sp(t - at - i * step, stiff, damp);
      kids[i].style.opacity = String(clamp(v * 1.6) * fadeOut);
      kids[i].style.transform = `translateY(${(1 - v) * -drop}em) scale(${0.35 + 0.65 * v})`;
    }
  });
  return (
    <span ref={ref} className="letters">
      {[...text].map((c, i) => (
        <span key={i} className={`ch ${cls}`}>
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </span>
  );
}

/** Строка надписи: позиция top (% высоты сцены), размер size (cqw), появление пружиной снизу. */
export function Line({ top, size = 8, at, out = Infinity, children, from = 0.5, className = '' }) {
  const ref = useTL((t) => {
    const v = sp(t - at, 300, 20);
    const o = clamp(v * 1.4) * (1 - prog(t, out - 0.18, out));
    return { opacity: String(o), transform: `translateY(${(1 - v) * from}em)` };
  });
  return (
    <div ref={ref} className={`line ${className}`} style={{ top: `${top}%`, fontSize: `${size}cqw` }}>
      {children}
    </div>
  );
}

/** Удар-надпись («СБИТО!»): влетает из большого масштаба и дрожит. */
export function Slam({ text, at, out, top = 40, size = 19, cls = 'red', rot = -6 }) {
  const ref = useTL((t) => {
    const v = sp(t - at, 520, 22);
    const o = t < at ? 0 : clamp((t - at) * 12) * (1 - prog(t, out - 0.2, out));
    const s = lerp(3.2, 1, v);
    const wob = t > at ? Math.sin((t - at) * 40) * Math.max(0, 0.4 - (t - at)) * 6 : 0;
    return { opacity: String(o), transform: `translate(-50%, -50%) rotate(${rot + wob}deg) scale(${s})` };
  });
  return (
    <div ref={ref} className={`slam ${cls}`} style={{ top: `${top}%`, fontSize: `${size}cqw` }}>
      {text}
    </div>
  );
}

/** Плашка героя и ульты: въезжает пружиной сбоку. */
export function Plaque({ at, out, top = 74, who, what, img, side = -1 }) {
  const ref = useTL((t) => {
    const v = sp(t - at, 280, 19);
    const o = clamp(v * 2) * (1 - prog(t, out - 0.2, out));
    return { opacity: String(o), transform: `translateX(calc(-50% + ${(1 - v) * side * 70}cqw)) rotate(${(1 - v) * side * 4}deg)` };
  });
  return (
    <div ref={ref} className="plaque" style={{ top: `${top}%` }}>
      {img && <img src={img} alt="" />}
      <div>
        <div className="t1">{who}</div>
        <div className="t2">{what}</div>
      </div>
    </div>
  );
}

/** Круг-касание (подсказка «нажми сюда») в координатах кадра. */
export function Tap({ x, y, at, size = 16, finger = true }) {
  const ring = useTL((t) => {
    const d = t - at;
    if (d < 0 || d > 0.9) return { opacity: '0' };
    return { opacity: String(1 - d / 0.9), transform: `translate(-50%, -50%) scale(${0.3 + easeOut(d / 0.9) * 1.2})` };
  });
  const hand = useTL((t) => {
    const d = t - at;
    const o = clamp((d + 0.5) * 4) * (1 - prog(d, 0.7, 1.0));
    const press = d < 0 ? (d + 0.5) * 2 : 1 - clamp(d * 3) * 0.12;
    return { opacity: String(d < -0.5 ? 0 : o), transform: `translate(${(1 - clamp(press)) * 30}%, ${(1 - clamp(press)) * 40}%) scale(${press > 0.99 ? 0.92 : 1})` };
  });
  return (
    <>
      <div ref={ring} className="ring" style={{ left: `${x}%`, top: `${y}%`, width: `${size}%` }} />
      {finger && (
        <div ref={hand} className="finger" style={{ left: `${x}%`, top: `${y}%` }}>
          <Finger />
        </div>
      )}
    </>
  );
}

export function Finger() {
  return (
    <svg viewBox="0 0 64 64">
      <path
        d="M24 6c3 0 5 2 5 5v20l2-1c2-1 5 0 6 2 2-1 5 0 6 2 2-1 5 0 6 3l1 13c0 7-5 12-12 12H30c-4 0-7-2-9-5L10 40c-1-2 0-5 2-6 2-1 4 0 5 1l2 3V11c0-3 2-5 5-5z"
        fill="#fff8e6"
        stroke="#2a1204"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Подсветка области кадра (рамка с пульсацией). */
export function Glow({ x, y, w, h, at, out, round = 3 }) {
  const ref = useTL((t) => {
    const v = sp(t - at, 260, 14);
    const o = clamp(v * 2) * (1 - prog(t, out - 0.2, out));
    const p = 0.5 + 0.5 * Math.sin((t - at) * 9);
    return { opacity: String(o), transform: `scale(${lerp(1.3, 1, v)})`, boxShadow: `0 0 0 0.5cqw #ffe08f, 0 0 ${2 + p * 3}cqw ${0.4 + p}cqw rgba(255,200,80,.8)` };
  });
  return <div ref={ref} className="glow" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, borderRadius: `${round}cqw` }} />;
}

/** Снег «Великой снежной бури»: частицы — функция времени. */
export function Snow({ a, b, n = 46 }) {
  const ref = useTL((t, el) => {
    const kids = el.children;
    const on = clamp((t - a) * 3) * (1 - prog(t, b - 0.3, b));
    for (let i = 0; i < kids.length; i++) {
      const sx = hash(i) * 120 - 10;
      const spd = 30 + hash(i + 50) * 45;
      const y = ((hash(i + 99) * 140 + (t - a) * spd) % 140) - 20;
      const x = sx - (t - a) * (8 + hash(i + 7) * 10);
      kids[i].style.transform = `translate(${x}cqw, ${y}cqh) rotate(${(t - a) * 200 + i * 40}deg)`;
      kids[i].style.opacity = String(on * (0.4 + hash(i + 3) * 0.6));
    }
  });
  return (
    <div ref={ref} className="fill snow">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ width: `${0.8 + hash(i + 11) * 1.6}cqw`, height: `${0.8 + hash(i + 11) * 1.6}cqw` }} />
      ))}
    </div>
  );
}

/** Лучи за картой / логотипом. */
export function Rays({ at, out, x = 50, y = 50, size = 140, color = '255,210,120' }) {
  const ref = useTL((t) => {
    const v = sp(t - at, 120, 14);
    const o = clamp(v) * (1 - prog(t, out - 0.25, out));
    return { opacity: String(o * 0.85), transform: `translate(-50%, -50%) rotate(${(t - at) * 22}deg) scale(${0.4 + v * 0.6})` };
  });
  return (
    <div
      ref={ref}
      className="rays"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}cqw`,
        height: `${size}cqw`,
        background: `repeating-conic-gradient(rgba(${color},.55) 0 6deg, rgba(${color},0) 6deg 18deg)`,
      }}
    />
  );
}

/** Счётчик 0 → to. */
export function Count({ at, dur = 0.8, to }) {
  const ref = useTL((t, el) => {
    el.textContent = String(Math.round(to * easeOut(prog(t, at, at + dur))));
  });
  return <span ref={ref}>0</span>;
}

export function Logo({ at, top = 34, out = Infinity, size = 11.5 }) {
  const orn = useTL((t) => {
    const v = sp(t - at - 0.45, 200, 18);
    return { opacity: String(clamp(v) * (1 - prog(t, out - 0.2, out))), transform: `scaleX(${v})` };
  });
  return (
    <div className="logo" style={{ top: `${top}%` }}>
      <div style={{ fontSize: `${size}cqw` }}>
        <Letters text="CHRONOWORLD" at={at} step={0.04} stiff={520} damp={15} drop={1.6} out={out} />
      </div>
      <div ref={orn} className="orn" />
    </div>
  );
}

export const playUrl = 'https://t.me/Chronoworldbot?startapp';

export function TgIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#3a1a02" />
      <path d="M5.5 11.6l11.2-4.4c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.8z" fill="#ffe9a8" />
    </svg>
  );
}

export { motion, hash };
