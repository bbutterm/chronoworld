import { GAME_W, HEADER_H } from './layout';
import { DIORAMA_H } from './idleDioramaPlan';
import { S } from './theme';

/** Лагерь и все четыре входа сохраняют размер, свободное место уходит в отступы; тесный экран листается. */
export function homeLayout(bottom: number) {
  const left = S.l;
  const width = GAME_W - 2 * left;
  const compactH = 168;
  const top = DIORAMA_H + S.xxs;
  const free = bottom - HEADER_H - top - compactH - S.s;
  const bigH = Math.max(520, Math.min(760, free));
  const pad = Math.max(0, (free - bigH) / 3);
  const bigY = top + pad + bigH / 2;
  const tavernW = Math.round((width - S.s) * 0.6);
  const shopW = width - S.s - tavernW;
  const smallW = (width - S.s) / 2;
  const smallY = bigY + bigH / 2 + S.s + pad + compactH / 2;
  return {
    left, bodyTop: HEADER_H, bodyBottom: bottom,
    bodyHeight: smallY + compactH / 2 + pad,
    tavern: { x: left + tavernW / 2, y: bigY, w: tavernW, h: bigH },
    shop: { x: GAME_W - left - shopW / 2, y: bigY, w: shopW, h: bigH },
    quests: { x: left + smallW / 2, y: smallY, w: smallW, h: compactH },
    achievements: { x: GAME_W - left - smallW / 2, y: smallY, w: smallW, h: compactH },
  };
}
