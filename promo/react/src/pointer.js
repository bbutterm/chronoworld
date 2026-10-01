// Наклон/параллакс: положение пальца или мыши (−1…1) и сглаженное пружиной значение. При рендере mp4 — всегда 0.
import { motionValue, animate } from 'framer-motion';
import { RENDER } from './timeline.js';

const raw = { x: motionValue(0), y: motionValue(0) };
export const pointer = { sx: motionValue(0), sy: motionValue(0) };

let ctlX = null;
let ctlY = null;
function follow() {
  ctlX?.stop();
  ctlY?.stop();
  ctlX = animate(pointer.sx, raw.x.get(), { type: 'spring', stiffness: 60, damping: 14 });
  ctlY = animate(pointer.sy, raw.y.get(), { type: 'spring', stiffness: 60, damping: 14 });
}

export function setPointer(nx, ny) {
  if (RENDER) return;
  raw.x.set(Math.max(-1, Math.min(1, nx)));
  raw.y.set(Math.max(-1, Math.min(1, ny)));
  follow();
}

if (!RENDER) {
  window.addEventListener('pointermove', (e) => setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1));
  // Телефон: наклон устройства (Android даёт без запроса; на iOS — только палец).
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null || e.beta == null) return;
    setPointer(e.gamma / 25, (e.beta - 45) / 25);
  });
}
