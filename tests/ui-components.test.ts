import { beforeEach, describe, expect, it, vi } from 'vitest';

// ui.ts тянет Phaser (нужен window/canvas) — для чистых помощников хватает заглушки.
vi.mock('phaser', () => ({ default: { GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));

const ui = await import('../src/game/ui');
const { COLOR, M, E, R, TOUCH } = await import('../src/game/theme');
const { setReducedMotion } = await import('../src/game/state');

/** Относительная яркость и контраст по WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('ui: кнопки', () => {
  it('вид по текстуре: золото — primary, остальное — secondary', () => {
    expect(ui.variantOf('ui_btn_primary')).toBe('primary');
    expect(ui.variantOf('ui_btn_secondary')).toBe('secondary');
    expect(ui.variantOf('k:buttonLong_beige')).toBe('secondary');
    expect(ui.variantOf('')).toBe('secondary');
  });

  it('высоты кнопок — не меньше цели нажатия, на сетке 8', () => {
    for (const h of [ui.BTN.cta, ui.BTN.l, ui.BTN.m, ui.BTN.icon]) {
      expect(h).toBeGreaterThanOrEqual(TOUCH);
      expect(h % 8).toBe(0);
    }
    expect(ui.BTN.cta).toBeGreaterThan(ui.BTN.l);
    expect(ui.BTN.l).toBeGreaterThan(ui.BTN.m);
  });

  it('подпись недоступной кнопки читается на сером «камне» (≥ 4.5:1)', () => {
    // skin_btn_disabled: градиент #3b3a37 → #262523; берём светлый край — худший случай.
    const label = ui.DISABLED_LABEL;
    expect(contrast(label, '#3b3a37')).toBeGreaterThanOrEqual(4.5);
  });

  describe('нажатие: масштаб 0.96 и обратно, без двойного эффекта', () => {
    type Tw = { cfg: Record<string, unknown>; playing: boolean; destroyed: boolean };
    function setup() {
      const tweens: Tw[] = [];
      const data = new Map<string, unknown>();
      const obj = {
        scene: {},
        scaleX: 1,
        setScale(s: number) {
          obj.scaleX = s;
          return obj;
        },
        getData: (k: string) => data.get(k),
        setData(k: string, v: unknown) {
          data.set(k, v);
          return obj;
        },
      };
      const mk = (cfg: Record<string, unknown>, playing = true): Tw & Record<string, unknown> => {
        const tw = {
          cfg,
          playing,
          destroyed: false,
          isPlaying: () => tw.playing,
          isDestroyed: () => tw.destroyed,
          pause: () => (tw.playing = false),
          resume: () => (tw.playing = true),
          stop: () => (tw.destroyed = true),
        };
        tweens.push(tw);
        return tw;
      };
      const scene = {
        tweens: {
          add: (cfg: Record<string, unknown>) => mk(cfg),
          getTweensOf: () => tweens.filter((t) => !t.destroyed),
        },
      };
      return { obj, scene, tweens, mk };
    }

    beforeEach(() => setReducedMotion(false));

    it('вниз — к 0.96 за M.press, вверх — к исходному за M.release с «пружиной»', () => {
      const { obj, scene, tweens } = setup();
      ui.pressFeedback(scene as never, obj as never, true);
      expect(tweens[0].cfg).toMatchObject({ scale: ui.PRESS_SCALE, duration: M.press, ease: E.out });
      obj.scaleX = 0.97; // твин прошёл часть пути
      ui.pressFeedback(scene as never, obj as never, false);
      expect(tweens[0].destroyed).toBe(true);
      expect(tweens[1].cfg).toMatchObject({ scale: 1, duration: M.release, ease: E.pop });
    });

    it('пульс кнопки на время нажатия стоит на паузе и продолжается после', () => {
      const { obj, scene, tweens, mk } = setup();
      const pulse = mk({ scale: 1.05 });
      obj.scaleX = 1.03;
      ui.pressFeedback(scene as never, obj as never, true);
      expect(pulse.playing).toBe(false);
      expect(tweens[1].cfg.scale).toBeCloseTo(1.03 * ui.PRESS_SCALE);
      ui.pressFeedback(scene as never, obj as never, false);
      expect(tweens[2].cfg.scale).toBeCloseTo(1.03);
      (tweens[2].cfg.onComplete as () => void)();
      expect(pulse.playing).toBe(true);
    });

    it('«Уменьшить анимацию» — масштаб сразу, без твинов', () => {
      setReducedMotion(true);
      const { obj, scene, tweens } = setup();
      ui.pressFeedback(scene as never, obj as never, true);
      expect(obj.scaleX).toBeCloseTo(ui.PRESS_SCALE);
      ui.pressFeedback(scene as never, obj as never, false);
      expect(obj.scaleX).toBe(1);
      expect(tweens).toHaveLength(0);
    });
  });
});

describe('ui: помощники компонентов', () => {
  it('mixHex смешивает цвета и даёт #rrggbb', () => {
    expect(ui.mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(ui.mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(ui.mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(ui.mixHex(COLOR.surfaceSunken, COLOR.negative, 0.3)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('числа — с неразрывными пробелами по разрядам, минус — настоящий', () => {
    expect(ui.groupNum(34617)).toBe('34 617');
    expect(ui.groupNum(999)).toBe('999');
    expect(ui.groupNum(-1234567)).toBe('−1 234 567');
  });

  it('разница стата: плюс зелёным, минус красным, ноль не показываем', () => {
    expect(ui.formatDelta(12)).toEqual({ text: '+12', tone: 'positive' });
    expect(ui.formatDelta(-5)).toEqual({ text: '−5', tone: 'negative' });
    expect(ui.formatDelta(0)).toBeNull();
    expect(ui.formatDelta(undefined)).toBeNull();
    expect(ui.formatDelta('-3%')).toEqual({ text: '−3%', tone: 'negative' });
    expect(ui.formatDelta('10%')).toEqual({ text: '+10%', tone: 'positive' });
  });

  it('тон-цвета компонентов читаются на поверхности (≥ 4.5:1)', () => {
    for (const [tone, c] of Object.entries(ui.TONE_COLOR)) {
      expect(contrast(c, COLOR.surface), tone).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('радиус плашки не больше половины меньшей стороны (таблетка), ключ кэша различает виды', () => {
    expect(ui.plateRadius(300, 52, R.pill)).toBeLessThanOrEqual(26);
    expect(ui.plateRadius(300, 120, R.m)).toBe(R.m);
    expect(ui.plateRadius(4, 4, R.m)).toBeGreaterThanOrEqual(2);
    expect(ui.plateKey({ fill: '#000000', r: 10 })).not.toBe(ui.plateKey({ fill: '#000000', r: 10, border: '#ffffff' }));
  });
});

describe('ui: тосты', () => {
  it('тон по цвету старого API', () => {
    expect(ui.toastTone(COLOR.negative)).toBe('negative');
    expect(ui.toastTone(COLOR.positive)).toBe('positive');
    expect(ui.toastTone(COLOR.warning)).toBe('warning');
    expect(ui.toastTone(COLOR.title)).toBe('accent');
  });

  it('время показа: 2 с обычный, от 3 с ошибка, длинный дольше, но не больше максимума', () => {
    expect(ui.toastDuration('Коротко', false)).toBe(ui.TOAST_MS.show);
    expect(ui.toastDuration('Коротко', true)).toBe(ui.TOAST_MS.error);
    expect(ui.toastDuration('x'.repeat(60), false)).toBeGreaterThan(ui.TOAST_MS.show);
    expect(ui.toastDuration('x'.repeat(500), true)).toBe(ui.TOAST_MS.max);
  });

});

describe('ui: указатель подсказки и вкладки (итерация 10)', () => {
  const read = async (f: string) => (await import('node:fs')).readFileSync(f, 'utf8');

  it('указатель: один пульс (без бесконечных твинов), без тоста посреди экрана, обходит и данные', async () => {
    const src = await read('src/game/ui.ts');
    const hint = src.slice(src.indexOf('export function hintPointer('), src.indexOf('export function tutorialHint('));
    expect(hint).not.toMatch(/repeat:\s*-1/);
    expect(hint).not.toMatch(/toast\(/);
    expect(hint).toMatch(/sceneObstacles\(/);
  });

  it('segmented: вкладка — строка или { label, icon, dot, lock }; обходов в сценах нет', async () => {
    const friends = await read('src/game/scenes/FriendsScene.ts');
    const events = await read('src/game/scenes/EventsScene.ts');
    expect(friends).not.toMatch(/segIcons|friendsTabDot/);
    expect(events).not.toMatch(/tabDot_/);
    expect(events).toMatch(/lock: d\.locked/);
  });
});
