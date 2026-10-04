/** Presentation geometry in the existing 1080-wide safe game field. */
export function campaignLayout(contentBottom: number) {
  const cardY = contentBottom - 148;
  const rowY = cardY - 242;
  const squadY = rowY - 208;
  return {
    mapTop: 450, mapBottom: squadY - 298, objectiveY: squadY - 192,
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
