/** Границы списка при изменении доступной высоты. Размеры текста и карточек остаются прежними. */
export function scrollLayout(contentHeight: number, top: number, bottom: number, offset = 0) {
  const height = Math.max(1, bottom - top);
  const maxOffset = Math.max(0, contentHeight - height);
  const clampedOffset = Math.max(0, Math.min(maxOffset, offset));
  const thumbHeight = Math.min(height, Math.max(60, height * height / Math.max(1, contentHeight)));
  return {
    bottom: top + height,
    height,
    maxOffset,
    offset: clampedOffset,
    y: top - clampedOffset,
    thumbHeight,
    thumbY: top + (height - thumbHeight) * (maxOffset ? clampedOffset / maxOffset : 0),
  };
}
