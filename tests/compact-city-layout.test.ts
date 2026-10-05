import { describe, expect, it } from 'vitest';
import { homeLayout } from '../src/game/homeLayout';
import { settingsLayout } from '../src/game/settingsLayout';
import { tavernLayout, tavernRevealLayout } from '../src/game/compactTavernLayout';
import { scrollLayout } from '../src/game/scroll';

describe('Лагерь и таверна сохраняют содержимое на тесном телефоне', () => {
  it('классический лагерь заполняет прежнюю область до навигации', () => {
    const layout = homeLayout(1730);
    expect(layout.tavern.h).toBe(760);
    expect(layout.bodyTop + layout.bodyHeight).toBeCloseTo(1730);
    expect(layout.quests.h).toBe(168);
  });

  it('все четыре входа достигаются прокруткой и остаются достаточно крупными для пальца', () => {
    const layout = homeLayout(1220);
    expect(layout.tavern.h).toBe(520);
    const bottom = scrollLayout(layout.bodyHeight, layout.bodyTop, layout.bodyBottom, Number.MAX_SAFE_INTEGER);
    for (const target of [layout.quests, layout.achievements]) {
      expect(target.h / 3).toBeGreaterThanOrEqual(44);
      expect(target.y + target.h / 2 + bottom.y).toBeLessThanOrEqual(layout.bodyBottom);
    }
    expect(bottom.maxOffset).toBe(250);
  });

  it.each([1410, 1770, 1920])('settings сохраняет закрытие и scroll в панели высоты%s', (height) => {
    const chrome = settingsLayout(height);
    const center = height / 2;
    expect(chrome.bodyBottom).toBeGreaterThan(chrome.bodyTop + 300);
    expect(chrome.closeY + chrome.hitH / 2).toBeLessThan(center + chrome.panelH / 2);
    expect(chrome.bodyBottom).toBeLessThan(chrome.closeY - chrome.hitH / 2);
    expect(chrome.hitH / 3).toBe(44);
  });

  it('подарок, гарант и summon CTA не перекрывают друг друга', () => {
    const layout = tavernLayout(1410, 1410, false);
    expect(layout.feetY - 410).toBeGreaterThan(430 + 100);
    expect(layout.bodyBottom).toBeLessThan(layout.pullY - 176 / 2 - 56);
    expect(layout.freeY + 30).toBeLessThan(1410);
    const end = scrollLayout(layout.pityY + 88 - layout.bodyTop, layout.bodyTop, layout.bodyBottom, Number.MAX_SAFE_INTEGER);
    expect(end.y + layout.pityY + 88 - layout.bodyTop).toBe(layout.bodyBottom);
  });

  it.each([1, 10])('%s новых карт сохраняют ширину имён и доступны до самого конца без пересечения footer', (count) => {
    const layout = tavernRevealLayout(count, 1410, true);
    expect(layout.slots).toHaveLength(count);
    for (const slot of layout.slots) expect(slot.w / 3).toBeGreaterThanOrEqual(104);
    const end = scrollLayout(layout.bodyHeight, layout.top, layout.bottom, Number.MAX_SAFE_INTEGER);
    const last = layout.slots.at(-1)!;
    expect(end.y + last.y + last.h / 2 + 80).toBeLessThanOrEqual(layout.bottom);
    expect(layout.bottom).toBeLessThan(layout.prepareY - 75);
    expect(layout.prepareY + 75).toBeLessThan(layout.doneY - 88);
    expect(layout.doneY + 88).toBeLessThan(1410);
  });
});
