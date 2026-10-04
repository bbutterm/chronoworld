import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState } from '../src/core';
import type { ScrollArea } from '../src/game/ui';

const harness = vi.hoisted(() => ({
  save: undefined as unknown,
  commit: vi.fn(),
  building: null as any,
  sheets: [] as any[],
  delayedClose: false,
  cssW: 307.125,
}));

vi.mock('../src/game/session', () => ({
  session: {
    get save() { return harness.save; },
    set save(next: unknown) { harness.save = next; },
  },
  commit: (save: unknown) => { harness.commit(save); harness.save = save; },
}));
vi.mock('../src/game/viewport', () => ({ view: () => ({ worldW: 1080, cssW: harness.cssW }) }));
vi.mock('../src/game/ui', () => ({
  text: (_s: unknown, x: number, y: number, value: string, size: number, color: string) => {
    const obj: any = {
      x, y, text: value, color, name: '', height: size + 8,
      setName(name: string) { obj.name = name; return obj; },
      setOrigin() { return obj; },
      setText(next: string) { obj.text = next; return obj; },
      setColor(next: string) { obj.color = next; return obj; },
    };
    harness.building.texts.push(obj);
    return obj;
  },
  button: (_s: unknown, _x: number, _y: number, width: number, height: number, _skin: string, label: string, tap: () => void, _size: number, opts?: { variant?: string }) => {
    const control: any = { name: '', label, width, height, tap, enabled: true, variant: opts?.variant };
    const container: any = { setName(name: string) { control.name = name; return container; } };
    harness.building.controls.push(control);
    return {
      container,
      setEnabled(enabled: boolean) { control.enabled = enabled; },
      setLabel(label: string) { control.label = label; },
    };
  },
}));
vi.mock('../src/game/screen', () => ({
  bottomSheet: (_scene: unknown, title: string, build: Function, opts: { onClose?: () => void }) => {
    const events = new EventEmitter();
    const data: Record<string, unknown> = {};
    const record: any = { title, controls: [], texts: [], height: 0, content: { add() {} } };
    record.layer = {
      name: '', scene: {},
      once: events.once.bind(events),
      setName(name: string) { record.layer.name = name; return record.layer; },
      getData(key: string) { return data[key]; },
      destroy() { record.layer.scene = null; events.emit('destroy'); },
    };
    record.finishClose = () => { record.layer.destroy(); opts.onClose?.(); };
    record.close = vi.fn(() => {
      data.closing = true;
      record.layer.name = '';
      if (!harness.delayedClose) record.finishClose();
    });
    harness.building = record;
    record.height = build(record.content, 984, record.close);
    harness.sheets.push(record);
    return record;
  },
}));

import { addHeroCard, chooseBranch, levelUpHero, newGame, resetHeroLevel, setHeroFocus, upgradeHeroFromCopy } from '../src/core';
import { GAME } from '../src/game/content';
import { heroCopyTextSize, heroCopyTouchHeight, openHeroUpgradeCopyPicker } from '../src/game/heroUpgradeCopyPicker';

function fixture() {
  const save = newGame(GAME, 0);
  const target = save.heroes.find(h => h.templateId === 'alan')!;
  const added = addHeroCard(save, target.templateId, 'gold');
  harness.save = added.save;
  return { targetId: target.id, copyId: added.hero.id };
}
function scene() {
  let running = true;
  const events = new EventEmitter();
  return { events, sys: { isActive: () => running }, shutdown() { running = false; events.emit('shutdown'); } } as any;
}
function current() { return harness.sheets.at(-1)!; }
function control(name: string) { return current().controls.find((c: any) => c.name === name)!; }
function feedback(name: string) { return current().texts.find((t: any) => t.name === name)!.text; }
function changeSave(update: (save: SaveState) => SaveState) { harness.save = update(harness.save as SaveState); }

beforeEach(() => {
  vi.clearAllMocks();
  harness.sheets.length = 0;
  harness.delayedClose = false;
  harness.cssW = 307.125;
});

describe('явное развитие героя более редкой копией', () => {
  it('показывает обе редкости и бесплатный обмен; отмена ничего не меняет и снимает блокировку', () => {
    const { targetId, copyId } = fixture();
    const before = JSON.stringify(harness.save);
    const lock = { locked: false } as ScrollArea;
    const changed = vi.fn();
    openHeroUpgradeCopyPicker(scene(), targetId, { lock, onChange: changed });
    expect(lock.locked).toBe(true);
    expect(current().controls.filter((c: any) => c.variant === 'primary')).toHaveLength(0);
    control(`heroCopySelect_${copyId}`).tap();
    expect(current().controls.filter((c: any) => c.variant === 'primary')).toHaveLength(1);
    expect(control('heroCopyUpgradeConfirm').variant).toBe('primary');
    expect(lock.locked).toBe(true); // replacing the sheet must not unlock the underlying tab
    expect(feedback('heroCopyRecipientRarity')).toBe('Зелёный → Золотой');
    expect(feedback('heroCopyDonorRarity')).toBe('Золотой → Зелёный');
    expect(feedback('heroCopyCost')).toContain('0 золота · 0 алмазов');
    control('heroCopyUpgradeCancel').tap();
    expect(JSON.stringify(harness.save)).toBe(before);
    expect(lock.locked).toBe(false);
    expect(harness.commit).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('подтверждает один раз даже при повторном нажатии до окончания закрытия', () => {
    const { targetId, copyId } = fixture();
    const before = harness.save as SaveState;
    const changed = vi.fn();
    const lock = { locked: true } as ScrollArea;
    const s = scene();
    openHeroUpgradeCopyPicker(s, targetId, { lock, onChange: changed });
    control(`heroCopySelect_${copyId}`).tap();
    harness.delayedClose = true;
    const tap = control('heroCopyUpgradeConfirm').tap;
    tap();
    tap();
    expect(harness.commit).toHaveBeenCalledOnce();
    const after = harness.save as SaveState;
    expect(after.heroes.find(h => h.id === targetId)?.rarity).toBe('gold');
    expect(after.heroes.find(h => h.id === copyId)?.rarity).toBe('green');
    expect(after.resources).toEqual(before.resources);
    expect(after.heroes.map(h => h.id)).toEqual(before.heroes.map(h => h.id));
    expect(changed).not.toHaveBeenCalled();
    current().finishClose();
    expect(changed).toHaveBeenCalledOnce();
    expect(lock.locked).toBe(true); // restore the caller's prior state
    expect(s.events.listenerCount('shutdown')).toBe(0);
  });

  it('повторно проверяет защиту копии перед подтверждением и оставляет читаемую причину', () => {
    const { targetId, copyId } = fixture();
    openHeroUpgradeCopyPicker(scene(), targetId);
    control(`heroCopySelect_${copyId}`).tap();
    changeSave(save => ({ ...save, heroes: save.heroes.map(h => h.id === copyId ? { ...h, locked: true } : h) }));
    control('heroCopyUpgradeConfirm').tap();
    expect(harness.commit).not.toHaveBeenCalled();
    expect(feedback('heroCopyConfirmFeedback')).toContain('замок');
    expect((harness.save as SaveState).heroes.find(h => h.id === targetId)?.rarity).toBe('green');
  });

  it('новая защита ещё в списке показывает причину вместо неожиданного перехода в другую карточку', () => {
    const { targetId, copyId } = fixture();
    const inspect = vi.fn();
    openHeroUpgradeCopyPicker(scene(), targetId, { onInspect: inspect });
    changeSave(save => ({ ...save, heroes: save.heroes.map(h => h.id === copyId ? { ...h, locked: true } : h) }));
    control(`heroCopySelect_${copyId}`).tap();
    expect(feedback(`heroCopyOptionFeedback_${copyId}`)).toContain('замок');
    expect(current().layer.name).toBe('heroCopyUpgradePicker');
    expect(inspect).not.toHaveBeenCalled();
    expect(harness.commit).not.toHaveBeenCalled();
  });

  it('изменившийся просмотр редкости требует нового выбора, а не молчаливого другого обмена', () => {
    const { targetId, copyId } = fixture();
    openHeroUpgradeCopyPicker(scene(), targetId);
    control(`heroCopySelect_${copyId}`).tap();
    changeSave(save => ({ ...save, heroes: save.heroes.map(h => h.id === copyId ? { ...h, rarity: 'purple' } : h) }));
    control('heroCopyUpgradeConfirm').tap();
    expect(harness.commit).not.toHaveBeenCalled();
    expect(feedback('heroCopyConfirmFeedback')).toBe('Герои изменились. Обмен требует повторного просмотра.');
  });

  it('обученную копию сначала открывает для возврата; после возврата её можно использовать', () => {
    const { targetId, copyId } = fixture();
    changeSave(save => levelUpHero({ ...save, resources: { ...save.resources, gold: 100000, heroExp: 100000 } }, copyId, GAME, 10).save);
    const inspect = vi.fn();
    const lock = { locked: false } as ScrollArea;
    openHeroUpgradeCopyPicker(scene(), targetId, { lock, onInspect: inspect });
    expect(feedback(`heroCopyOptionFeedback_${copyId}`)).toContain('верните вложенные ресурсы');
    control(`heroCopySelect_${copyId}`).tap();
    expect(inspect).toHaveBeenCalledExactlyOnceWith(copyId);
    expect(lock.locked).toBe(false);
    expect(harness.commit).not.toHaveBeenCalled();
    changeSave(save => resetHeroLevel(save, copyId, GAME).save);
    openHeroUpgradeCopyPicker(scene(), targetId);
    control(`heroCopySelect_${copyId}`).tap();
    control('heroCopyUpgradeConfirm').tap();
    expect(harness.commit).toHaveBeenCalledOnce();
  });

  it('показывает блокировку специализации, а экспедиция спутника не позволяет открыть обмен', () => {
    const { targetId, copyId } = fixture();
    changeSave(save => {
      const next = { ...save, heroes: save.heroes.map(h => h.id === copyId ? { ...h, level: 10, grantedLevel: 10, training: { gold: 0, exp: 0 } } : h) };
      return setHeroFocus(next, copyId, 'guard', GAME);
    });
    openHeroUpgradeCopyPicker(scene(), targetId);
    expect(feedback(`heroCopyOptionFeedback_${copyId}`)).toContain('специализацию');
    changeSave(save => ({ ...save, bounties: { ...save.bounties, active: [{ id: 'e', missionId: 'm', heroIds: [targetId], start: 0, finish: 100 } as any] } }));
    const inspect = vi.fn();
    openHeroUpgradeCopyPicker(scene(), targetId, { onInspect: inspect });
    expect(control(`heroCopySelect_${copyId}`).enabled).toBe(false);
    expect(feedback(`heroCopyOptionFeedback_${copyId}`)).toContain('заберите награды');
    control(`heroCopySelect_${copyId}`).tap();
    expect(inspect).not.toHaveBeenCalled();
    expect(harness.commit).not.toHaveBeenCalled();
  });

  it('объясняет возврат донорской профессии и защищает от нажатий после закрытия/выключения сцены', () => {
    const { targetId, copyId } = fixture();
    changeSave(save => chooseBranch(save, copyId, 'knight', GAME).save);
    const s = scene();
    const lock = { locked: false } as ScrollArea;
    const changed = vi.fn();
    openHeroUpgradeCopyPicker(s, targetId, { lock, onChange: changed });
    control(`heroCopySelect_${copyId}`).tap();
    expect(feedback('heroCopyBranchWarning')).toContain('Вехи её прежней ветки останутся');
    const tap = control('heroCopyUpgradeConfirm').tap;
    s.shutdown();
    tap();
    expect(lock.locked).toBe(false);
    expect(harness.commit).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('показывает восстановление собственного пути без нового бесплатного выбора или чужой профессии', () => {
    const { copyId: veteranId } = fixture();
    changeSave(save => chooseBranch(save, veteranId, 'knight', GAME).save);
    const lower = addHeroCard(harness.save as SaveState, 'alan', 'blue');
    harness.save = upgradeHeroFromCopy(lower.save, lower.hero.id, veteranId, GAME).save;
    openHeroUpgradeCopyPicker(scene(), veteranId);
    control(`heroCopySelect_${lower.hero.id}`).tap();
    expect(feedback('heroCopyBranchRecovery')).toContain('Восстановится прежняя профессия спутника: Рыцарь');
    expect(current().texts.some((t: any) => t.text.includes('Вторую профессию спутника вы выберете сами'))).toBe(false);
    control('heroCopyUpgradeConfirm').tap();
    expect((harness.save as SaveState).heroes.find(h => h.id === veteranId)?.branch).toBe('knight');
  });

  it('основные действия сохраняют цели 44 CSS px при тесных Telegram отступах', () => {
    const { targetId, copyId } = fixture();
    openHeroUpgradeCopyPicker(scene(), targetId);
    expect(heroCopyTouchHeight() * harness.cssW / 1080).toBeGreaterThanOrEqual(44);
    expect(heroCopyTextSize(34) * harness.cssW / 1080).toBeGreaterThanOrEqual(12);
    expect(current().controls.every((c: any) => c.height * harness.cssW / 1080 >= 44)).toBe(true);
    control(`heroCopySelect_${copyId}`).tap();
    expect(current().controls.every((c: any) => c.height * harness.cssW / 1080 >= 44)).toBe(true);
  });
});
