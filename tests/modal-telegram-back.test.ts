import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModalBack } from '../src/game/modalBack';
import { setTgAppForTests, tgBack } from '../src/game/telegram';

function setup(fallback: (() => void) | null = null) {
  const handlers = new Set<() => void>();
  const bb = {
    show: vi.fn(), hide: vi.fn(),
    onClick: (fn: () => void) => handlers.add(fn), offClick: (fn: () => void) => handlers.delete(fn),
  };
  setTgAppForTests({ version: '9.0', platform: 'ios', BackButton: bb });
  let active = true;
  const stack: { closed: boolean; closing: boolean; close: () => void }[] = [];
  const back = new ModalBack(fallback, () => {
    const top = [...stack].reverse().find((layer) => !layer.closed);
    if (top && !top.closing) top.close();
  }, () => active);
  const open = (animate = false) => {
    const layer = { closed: false, closing: false, close: vi.fn() };
    const off = back.opened(layer);
    const destroy = () => { layer.closed = true; off(); };
    layer.close.mockImplementation(() => { if (animate) layer.closing = true; else destroy(); });
    stack.push(layer);
    return { layer, destroy };
  };
  const tap = () => { for (const fn of [...handlers]) fn(); };
  return { back, open, handlers, bb, tap, setActive: (value: boolean) => { active = value; } };
}

afterEach(() => setTgAppForTests(undefined));

describe('Telegram Back на корневой вкладке и вложенных окнах', () => {
  it('корневая вкладка скрывает Back, лист включает его; реальный SDK tap закрывает только лист', () => {
    const h = setup();
    expect(h.handlers.size).toBe(0);
    const sheet = h.open();
    expect(h.handlers.size).toBe(1);
    expect(h.bb.show).toHaveBeenCalledOnce();
    h.tap();
    expect(sheet.layer.close).toHaveBeenCalledOnce();
    expect(h.handlers.size).toBe(0);
    expect(tgBack()).toBeNull();
    h.back.destroy();
  });

  it.each(['Hero', 'Ascend'])('%s: nested modal Back сохраняет оба нижних слоя и исходного родителя', () => {
    const parent = vi.fn(); const h = setup(parent);
    const picker = h.open(); const detail = h.open();
    expect(h.handlers.size).toBe(1);
    h.tap();
    expect(detail.layer.close).toHaveBeenCalledOnce();
    expect(picker.layer.close).not.toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
    h.tap();
    expect(picker.layer.close).toHaveBeenCalledOnce();
    expect(h.handlers.size).toBe(1);
    h.tap();
    expect(parent).toHaveBeenCalledOnce();
    h.back.destroy(); expect(h.handlers.size).toBe(0);
  });

  it('быстрый повтор Back при анимации закрытия не уводит со сцены', () => {
    const parent = vi.fn(); const h = setup(parent); const sheet = h.open(true);
    h.tap(); h.tap();
    expect(sheet.layer.close).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
    sheet.destroy(); h.tap(); expect(parent).toHaveBeenCalledOnce();
    h.back.destroy();
  });

  it('20 открытий и закрытий не накапливают SDK listeners', () => {
    const h = setup();
    for (let i = 0; i < 20; i++) {
      h.open(); expect(h.handlers.size).toBe(1); h.tap(); expect(h.handlers.size).toBe(0);
    }
    h.back.destroy(); expect(h.handlers.size).toBe(0);
  });

  it('окно, открытое внутри create до RUNNING, получает Back сразу', () => {
    const h = setup(); h.setActive(false); const sheet = h.open();
    expect(h.handlers.size).toBe(1);
    h.setActive(true); h.tap();
    expect(sheet.layer.close).toHaveBeenCalledOnce();
    h.back.destroy();
  });

  it('остановленная сцена не закрывает слой; поздний destroy не снимает Back новой сцены', () => {
    const h = setup(); const sheet = h.open(); h.setActive(false); h.tap();
    expect(sheet.layer.close).not.toHaveBeenCalled();
    const parent = vi.fn(); const next = new ModalBack(parent, vi.fn(), () => true);
    sheet.destroy(); h.back.destroy(); h.tap();
    expect(parent).toHaveBeenCalledOnce();
    expect(h.handlers.size).toBe(1);
    next.destroy(); expect(h.handlers.size).toBe(0);
  });
});
