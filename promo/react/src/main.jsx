import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { RENDER } from './timeline.js';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Готовность для render.mjs: шрифты загружены, все кадры в DOM декодированы.
window.promoReady = (async () => {
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, RENDER ? 300 : 0));
  await Promise.all([...document.images].map((im) => im.decode().catch(() => {})));
  return true;
})();
