/** Раздельные цели фильтров; «Свободные» переносится, если44CSSpx не помещаются в одной строке. */
export function inventoryFilters(width: number, touch: number, gap: number) {
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const heights: number[] = [];
  let left = 0;
  let top = 0;
  for (const w of [...Array<number>(5).fill(touch), Math.max(244, touch)]) {
    if (left && left + w > width) {
      top += touch + gap;
      left = 0;
    }
    boxes.push({ x: left + w / 2, y: top + touch / 2, w, h: touch });
    heights.push(top + touch);
    left += w + gap;
  }
  // Последняя плашка справа оставляет свободное место между типами предметов и переключателем.
  const last = boxes[boxes.length - 1];
  last.x = width - last.w / 2;
  return { boxes, height: Math.max(...heights) };
}

/** Виртуальные строки пересчитываются и по прокрутке, и при раскрытии окна. */
export function inventoryWindow(count: number, rowHeight: number, offset: number, visibleHeight: number, buffer: number) {
  return {
    from: Math.max(0, Math.floor(offset / rowHeight) - buffer),
    to: Math.min(count - 1, Math.ceil((offset + visibleHeight) / rowHeight) + buffer),
  };
}
