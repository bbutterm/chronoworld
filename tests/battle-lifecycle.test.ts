import { describe, expect, it, vi } from 'vitest';
import type { BattleEvent } from '../src/core';

vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));
vi.mock('../src/game/content', async () => {
  const GAME = (await import('../scripts/lib/content-node')).loadFullContext();
  return { GAME, CONTENT: GAME.content };
});
vi.mock('../src/game/battleAudio', () => ({ battleSound: vi.fn() }));

import { BattleScene } from '../src/game/scenes/BattleScene';

function statusHarness() {
  const scene = new BattleScene();
  const pending: (() => void)[] = [];
  const icon = vi.fn();
  const stun = vi.fn();
  const target = { snap: { uid: 'B0', side: 'B' }, alive: true, shownDead: false };
  const source = { snap: { uid: 'A0', side: 'A' } };
  Object.assign(scene, {
    views: new Map([['A0', source], ['B0', target]]),
    atImpact: (_source: unknown, _animate: unknown, show: (animate: boolean) => void) => pending.push(() => show(false)),
    setStatusIcon: icon,
    setStun: stun,
  });
  const play = (action: 'apply' | 'expire', t: number, status = 'transcendent_assumptio', name = 'Высшее Ассумптио') => scene['playEvent']({
    t, type: 'status', source: 'A0', target: 'B0', status, name, turns: action === 'apply' ? 3 : 0, action,
  } satisfies BattleEvent, false);
  return { scene, pending, target, icon, stun, play };
}

describe('отложенные визуальные статусы', () => {
  it('закончившийся бафф не возвращается, когда отложенное попадание рисуется позже expiry', () => {
    const h = statusHarness();
    h.play('apply', 1);
    h.play('expire', 4);
    expect(h.icon).toHaveBeenCalledExactlyOnceWith(h.target, 'transcendent_assumptio', undefined);
    h.pending[0]();
    expect(h.icon).toHaveBeenCalledOnce();
  });

  it('повторное наложение заменяет прежний отложенный визуальный эффект', () => {
    const h = statusHarness();
    h.play('apply', 1);
    h.play('apply', 2);
    h.pending[0]();
    expect(h.icon).not.toHaveBeenCalled();
    h.pending[1]();
    expect(h.icon).toHaveBeenCalledOnce();
    expect(h.icon.mock.calls[0][2]).toMatchObject({ damageReduction: 0.5 });
  });

  it('заморозка и оглушение перекрываются: истечение одного сохраняет другое', () => {
    const h = statusHarness();
    h.play('apply', 1, 'stun', 'Оглушение');
    h.play('apply', 1.1, 'frozen', 'Заморозка');
    h.pending[0]();
    h.pending[1]();
    expect(h.stun).toHaveBeenLastCalledWith(h.target, true, true);
    h.play('expire', 3.1, 'frozen', 'Заморозка');
    expect(h.stun).toHaveBeenLastCalledWith(h.target, true, false);
    h.play('expire', 4, 'stun', 'Оглушение');
    expect(h.stun).toHaveBeenLastCalledWith(h.target, false, false);
  });

  it('шестисекундное оглушение после сбитого заряда видно после истечения короткого контроля ульты', () => {
    const h = statusHarness();
    h.play('apply', 1, 'charge_broken', 'Сбит');
    h.play('apply', 1, 'stun', 'Оглушение');
    h.pending[0]();
    h.pending[1]();
    h.play('expire', 3, 'stun', 'Оглушение');
    expect(h.stun).toHaveBeenLastCalledWith(h.target, true, false);
    h.play('expire', 7, 'charge_broken', 'Сбит');
    expect(h.stun).toHaveBeenLastCalledWith(h.target, false, false);
  });

  it('бафф, отложенный до смерти цели, не появляется на павшем', () => {
    const h = statusHarness();
    h.play('apply', 1);
    h.target.alive = false;
    h.pending[0]();
    expect(h.icon).not.toHaveBeenCalled();
  });
});

it.each(['stun', 'dispel', 'ult', 'break', 'noTarget'] as const)('оборванный каст (%s) прячет реальный rig и полосу', (reason) => {
  const scene = new BattleScene();
  const visibility = () => ({ setVisible: vi.fn() });
  const rig = { hide: vi.fn() };
  const target = {
    snap: { uid: 'B0', side: 'B' }, alive: false,
    cast: { start: 1, dur: 5 }, castBack: visibility(), castBar: visibility(), castIcon: visibility(),
    castRig: rig, nameText: visibility(),
  };
  Object.assign(scene, {
    views: new Map([['B0', target]]),
    floats: { cancelFx: vi.fn() },
    atImpact: (_source: unknown, _animate: unknown, show: (animate: boolean) => void) => show(false),
  });
  scene['playEvent']({ t: 2, type: 'cast', unit: 'B0', skill: 'job_mage_fire_bolt', name: 'Огненная стрела', duration: 0, action: 'interrupt', reason }, false);
  expect(target.cast).toBeNull();
  expect(rig.hide).toHaveBeenCalledOnce();
  expect(target.castBar.setVisible).toHaveBeenCalledWith(false);
});


it('уход со сцены скрывает каст и не запускает анимацию уничтожаемой фигуры', () => {
  const scene = new BattleScene();
  const visibility = () => ({ setVisible: vi.fn() });
  const rig = { hide: vi.fn() };
  const target = {
    snap: { uid: 'B0', side: 'B' }, alive: true,
    cast: { start: 1, dur: 5 }, castBack: visibility(), castBar: visibility(), castIcon: visibility(),
    castRig: rig, nameText: visibility(),
  };
  const loop = vi.fn();
  Object.assign(scene, { views: new Map([['B0', target]]), floats: { cancelFx: vi.fn(), clear: vi.fn() }, loop });
  scene['shutdown']();
  expect(target.cast).toBeNull();
  expect(rig.hide).toHaveBeenCalledOnce();
  expect(loop).not.toHaveBeenCalled();
});
