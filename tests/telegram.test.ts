import { afterEach, describe, expect, it } from 'vitest';
import { inTelegram, installTelegram, onTgEvent, setTgAppForTests, setTgBack, tgApp, tgBack, tgInsets, tgSupports, versionGte, type TgWebAppLike } from '../src/game/telegram';

/** Поддельный Telegram.WebApp: пишет все вызовы; версия и платформа — как у клиента. */
function fakeApp(version: string, platform = 'android', over: Partial<TgWebAppLike> = {}) {
  const calls: string[] = [];
  const handlers = new Map<string, ((...a: never[]) => void)[]>();
  const clicks: (() => void)[] = [];
  const app: TgWebAppLike = {
    version,
    platform,
    isVersionAtLeast: (v) => versionGte(version, v),
    ready: () => calls.push('ready'),
    expand: () => calls.push('expand'),
    requestFullscreen: () => calls.push('fullscreen'),
    lockOrientation: () => calls.push('lock'),
    disableVerticalSwipes: () => calls.push('noSwipes'),
    setHeaderColor: (c) => calls.push(`header:${c}`),
    setBackgroundColor: (c) => calls.push(`bg:${c}`),
    setBottomBarColor: (c) => calls.push(`bottom:${c}`),
    BackButton: {
      show: () => calls.push('back:show'),
      hide: () => calls.push('back:hide'),
      onClick: (cb) => clicks.push(cb),
      offClick: (cb) => {
        const i = clicks.indexOf(cb);
        if (i >= 0) clicks.splice(i, 1);
      },
    },
    onEvent: (ev, cb) => handlers.set(ev, [...(handlers.get(ev) ?? []), cb]),
    offEvent: (ev, cb) => handlers.set(ev, (handlers.get(ev) ?? []).filter((x) => x !== cb)),
    ...over,
  };
  const emit = (ev: string, payload?: unknown) => (handlers.get(ev) ?? []).forEach((cb) => (cb as (p?: unknown) => void)(payload));
  const pressBack = () => clicks.forEach((cb) => cb());
  return { app, calls, emit, pressBack, clicks };
}

afterEach(() => setTgAppForTests(undefined));

describe('telegram: версии', () => {
  it('сравнивает версии по числам', () => {
    expect(versionGte('8.0', '7.10')).toBe(true);
    expect(versionGte('7.7', '7.10')).toBe(false);
    expect(versionGte('7.10', '7.10')).toBe(true);
    expect(versionGte('6.1', '6')).toBe(true);
    expect(versionGte(undefined, '6.0')).toBe(false);
  });

  it('без isVersionAtLeast берёт поле version; падающий isVersionAtLeast не ломает', () => {
    expect(tgSupports({ version: '7.7' }, '7.7')).toBe(true);
    expect(tgSupports({ version: '6.0' }, '6.1')).toBe(false);
    const bad: TgWebAppLike = {
      version: '8.0',
      isVersionAtLeast: () => {
        throw new Error('нет');
      },
    };
    expect(tgSupports(bad, '8.0')).toBe(true);
  });
});

describe('telegram: вне Telegram — тихие no-op', () => {
  it('нет WebApp: ничего не делает и не падает', () => {
    setTgAppForTests(null);
    expect(inTelegram()).toBe(false);
    const r = installTelegram({ color: '#0a0907' });
    expect(r.telegram).toBe(false);
    expect(tgInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const off = onTgEvent('viewportChanged', () => {});
    off();
    const fn = () => {};
    const cancel = setTgBack(fn);
    expect(tgBack()).toBe(fn);
    cancel();
    expect(tgBack()).toBe(null);
  });

  it('SDK, загруженный вне Telegram (platform unknown), — тоже «не Telegram»', () => {
    const g = globalThis as unknown as { Telegram?: { WebApp?: TgWebAppLike } };
    g.Telegram = { WebApp: { platform: 'unknown', version: '6.0' } };
    try {
      expect(tgApp()).toBeUndefined();
      g.Telegram = { WebApp: { platform: 'ios', version: '8.0' } };
      expect(tgApp()?.platform).toBe('ios');
    } finally {
      delete g.Telegram;
    }
  });
});

describe('telegram: старт', () => {
  it('новый клиент на телефоне: цвета, ready, expand, без свайпа, полный экран и портрет', () => {
    const f = fakeApp('8.0', 'ios');
    setTgAppForTests(f.app);
    const r = installTelegram({ color: '#0a0907' });
    expect(r).toMatchObject({ telegram: true, ready: true, expanded: true, swipesOff: true, fullscreen: true, orientationLocked: true });
    expect(r.colors).toEqual(['header', 'background', 'bottomBar']);
    // Цвета — раньше ready(): без вспышки темы чата.
    expect(f.calls.indexOf('header:#0a0907')).toBeLessThan(f.calls.indexOf('ready'));
    expect(f.calls).toEqual(expect.arrayContaining(['bg:#0a0907', 'bottom:#0a0907', 'expand', 'noSwipes', 'fullscreen', 'lock']));
  });

  it('повторный вызов ничего не повторяет', () => {
    const f = fakeApp('8.0', 'android');
    setTgAppForTests(f.app);
    installTelegram({ color: '#000000' });
    const n = f.calls.length;
    expect(installTelegram({ color: '#000000' }).telegram).toBe(false);
    expect(f.calls.length).toBe(n);
  });

  it('компьютер: без полного экрана и блокировки ориентации', () => {
    const f = fakeApp('8.0', 'tdesktop');
    setTgAppForTests(f.app);
    const r = installTelegram({ color: '#0a0907' });
    expect(r.fullscreen).toBe(false);
    expect(f.calls).not.toContain('fullscreen');
    expect(f.calls).not.toContain('lock');
    expect(f.calls).toContain('noSwipes');
  });

  it('полный экран выключен опцией (?fullscreen=0) или уже включён — не просим', () => {
    const a = fakeApp('8.0', 'android');
    setTgAppForTests(a.app);
    installTelegram({ color: '#0a0907', fullscreen: false });
    expect(a.calls).not.toContain('fullscreen');
    const b = fakeApp('8.0', 'android', { isFullscreen: true });
    setTgAppForTests(b.app);
    installTelegram({ color: '#0a0907' });
    expect(b.calls).not.toContain('fullscreen');
  });

  it('старый клиент: только то, что поддерживает версия', () => {
    const f = fakeApp('6.0', 'android');
    setTgAppForTests(f.app);
    const r = installTelegram({ color: '#0a0907' });
    expect(r).toMatchObject({ ready: true, expanded: true, swipesOff: false, fullscreen: false, colors: [] });
    expect(f.calls).toEqual(['ready', 'expand']);
  });

  it('7.7: без свайпа есть, нижней полосы и полного экрана нет', () => {
    const f = fakeApp('7.7', 'android');
    setTgAppForTests(f.app);
    const r = installTelegram({ color: '#0a0907' });
    expect(r.swipesOff).toBe(true);
    expect(r.colors).toEqual(['header', 'background']);
    expect(r.fullscreen).toBe(false);
  });

  it('метод бросает исключение («не поддерживается») — остальное всё равно выполняется', () => {
    const f = fakeApp('8.0', 'android', {
      requestFullscreen: () => {
        throw new Error('WebAppMethodUnsupported');
      },
      setBottomBarColor: undefined,
    });
    setTgAppForTests(f.app);
    const r = installTelegram({ color: '#0a0907' });
    expect(r.fullscreen).toBe(false);
    expect(r.ready).toBe(true);
    expect(f.calls).toContain('lock');
  });
});

describe('telegram: события и отступы', () => {
  it('onTgEvent подписывает и отписывает', () => {
    const f = fakeApp('8.0');
    setTgAppForTests(f.app);
    const got: unknown[] = [];
    const off = onTgEvent('viewportChanged', (p) => got.push(p));
    f.emit('viewportChanged', { isStateStable: true });
    off();
    f.emit('viewportChanged', { isStateStable: false });
    expect(got).toEqual([{ isStateStable: true }]);
  });

  it('tgInsets — сумма safeAreaInset и contentSafeAreaInset', () => {
    setTgAppForTests(fakeApp('8.0', 'ios', { safeAreaInset: { top: 47, bottom: 34 }, contentSafeAreaInset: { top: 46 } }).app);
    expect(tgInsets()).toEqual({ top: 93, right: 0, bottom: 34, left: 0 });
  });
});

describe('telegram: BackButton', () => {
  it('показывает кнопку и ведёт в обработчик экрана; null — прячет', () => {
    const f = fakeApp('7.0');
    setTgAppForTests(f.app);
    const went: string[] = [];
    setTgBack(() => went.push('heroes'));
    expect(f.calls).toContain('back:show');
    f.pressBack();
    expect(went).toEqual(['heroes']);
    setTgBack(null);
    expect(f.calls.at(-1)).toBe('back:hide');
    expect(f.clicks.length).toBe(0);
    f.pressBack();
    expect(went).toEqual(['heroes']);
  });

  it('новый экран заменяет обработчик (один подписчик), отмена старого не трогает новый', () => {
    const f = fakeApp('7.0');
    setTgAppForTests(f.app);
    const went: string[] = [];
    const cancelA = setTgBack(() => went.push('a'));
    setTgBack(() => went.push('b'));
    expect(f.clicks.length).toBe(1);
    cancelA();
    f.pressBack();
    expect(went).toEqual(['b']);
    expect(f.calls.at(-1)).toBe('back:show');
  });

  it('отмена своего обработчика прячет кнопку', () => {
    const f = fakeApp('7.0');
    setTgAppForTests(f.app);
    const cancel = setTgBack(() => {});
    cancel();
    expect(f.calls.at(-1)).toBe('back:hide');
    expect(tgBack()).toBe(null);
  });

  it('ошибка перехода не ломает кнопку; до 6.1 BackButton не трогаем', () => {
    const f = fakeApp('7.0');
    setTgAppForTests(f.app);
    setTgBack(() => {
      throw new Error('сцена');
    });
    expect(() => f.pressBack()).not.toThrow();
    const old = fakeApp('6.0');
    setTgAppForTests(old.app);
    setTgBack(() => {});
    expect(old.calls).not.toContain('back:show');
  });
});
