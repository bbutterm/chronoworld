/** Presentation geometry in the existing 1080-wide safe game field. */
export function campaignLayout(contentBottom: number, stageCount = 5, compact = contentBottom < 1600) {
  const cardY = contentBottom - 148;
  const rowY = cardY - 242;
  const bodyTop = 390;
  const mapTop = compact ? bodyTop + 110 : 450;
  const mapBottom = compact ? mapTop + Math.max(0, stageCount - 1) * 180 : rowY - 208 - 298;
  const squadY = compact ? mapBottom + 480 : rowY - 208;
  return {
    compact, bodyTop, bodyBottom: rowY - 126, bodyHeight: squadY + 104 - bodyTop,
    mapTop, mapBottom, objectiveY: compact ? mapBottom + 132 : squadY - 192,
    squadY, rowY, fastX: 886, fastW: 300, ctaX: 380, ctaW: 664,
    cardY, cardW: 984, cardH: 264,
    chestX: 152, chestY: cardY + 10, chestSize: 180,
    fillX: 272, fillW: 736, barY: cardY - 28,
    chipsY: cardY + 60, chipsW: 484,
    claimX: 906, claimY: cardY + 60, claimW: 204, claimH: 132,
  };
}

/** Small map sections keep every node legible without removing any stage. */
export function campaignPages(n: number): { from: number; to: number }[] {
  return Array.from({ length: Math.ceil(n / 5) }, (_, i) => ({ from: i * 5, to: Math.min(n, (i + 1) * 5) }));
}

export function heroFooterLayout(contentBottom: number) {
  return { actionY: contentBottom - 108, tabBottom: contentBottom - 224 };
}
