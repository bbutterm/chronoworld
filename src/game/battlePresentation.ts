import type { SpriteDef } from '../pipeline/sprites';

/** Bounds of visible animation pixels relative to the existing foot anchor, before facing is applied. */
export interface BattleSpriteBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BattlePresentationBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BattleSpritePresentation {
  /** Native source-pixel scale; the frame cell and its original foot anchor are unchanged. */
  scale: number;
  animated: BattleSpriteBounds;
  /** Standing/hurt silhouette: a sword may reach the enemy without hiding its wielder's body. */
  body: BattleSpriteBounds;
  large: boolean;
}

/** A renderer projection, deliberately separate from core positions and the regular formation spread. */
export interface BattlePresentedUnit {
  side: 'A' | 'B';
  active: boolean;
  faceDir: 1 | -1;
  displayX: number;
  displayY: number;
  presentation: BattleSpritePresentation;
  node: { scaleX: number; scaleY: number };
}

const BODY_GAP = 20;
const MAX_WIDTH_PART = 0.56;
const MAX_HEIGHT_PART = 0.56;
const LARGE_BODY_WIDTH_PART = 0.44;

function sourceBounds(def: SpriteDef, names: string[]): BattleSpriteBounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const name of names) {
    const b = def.boxes?.[name];
    if (!b || !def.anims[name as keyof SpriteDef['anims']]) continue;
    left = Math.min(left, b[0]);
    top = Math.min(top, b[1]);
    right = Math.max(right, b[2]);
    bottom = Math.max(bottom, b[3]);
  }
  // Old art without bboxes still gets a finite, conservative cell bound.
  if (!Number.isFinite(left)) [left, top, right, bottom] = [0, 0, ...def.cell];
  return { left: left - def.anchor[0], top: top - def.anchor[1], right: right - def.anchor[0], bottom: bottom - def.anchor[1] };
}

const scaled = (b: BattleSpriteBounds, scale: number): BattleSpriteBounds => ({ left: b.left * scale, top: b.top * scale, right: b.right * scale, bottom: b.bottom * scale });

/**
 * Fit every registered animation, including attacks/death, rather than the transparent frame cell or idle alone.
 * Ordinary figures retain their current scale. Oversized art uses the largest half-step that fits its share of the
 * visible arena, keeping a large boss and space for the party at the same time.
 */
export function battleSpritePresentation(def: SpriteDef, requestedScale: number, arena: BattlePresentationBounds, compact = false): BattleSpritePresentation {
  const animated = sourceBounds(def, Object.keys(def.anims));
  const body = sourceBounds(def, ['idle', 'walk', 'hurt']);
  const maxScale = Math.min(
    (arena.maxX - arena.minX) * MAX_WIDTH_PART / Math.max(1, animated.right - animated.left),
    (arena.maxY - arena.minY) * (compact ? 0.9 : MAX_HEIGHT_PART) / Math.max(1, animated.bottom - animated.top),
  );
  // A wide blade/death effect needs fitting, but does not turn an ordinary fighter into a giant footprint.
  const large = (body.right - body.left) * requestedScale > (arena.maxX - arena.minX) * LARGE_BODY_WIDTH_PART
    || (body.bottom - body.top) * requestedScale > (arena.maxY - arena.minY) * MAX_HEIGHT_PART;
  const crispFit = Math.floor(maxScale * 2) / 2;
  const scale = requestedScale > maxScale ? Math.min(requestedScale, crispFit > 0 ? crispFit : maxScale) : requestedScale;
  return { scale, animated: scaled(animated, scale), body: scaled(body, scale), large };
}

/** Input coordinates include the unmirrored world transform and the sprite's (possibly mirrored) origin. */
export function battleSpriteHitArea(p: BattleSpritePresentation, frameW: number, frameH: number, originX: number, originY: number, flipX: boolean): { x: number; y: number; width: number; height: number } {
  const b = p.body;
  return {
    x: originX * frameW + (flipX ? -b.right : b.left) / p.scale,
    y: originY * frameH + b.top / p.scale,
    width: (b.right - b.left) / p.scale,
    height: (b.bottom - b.top) / p.scale,
  };
}

const left = (u: BattlePresentedUnit, b: BattleSpriteBounds): number => (u.faceDir < 0 ? -b.right : b.left) * u.node.scaleX;
const right = (u: BattlePresentedUnit, b: BattleSpriteBounds): number => (u.faceDir < 0 ? -b.left : b.right) * u.node.scaleX;
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Large figures occupy their side of the arena. All opposing bodies keep a clear foreground contour, while
 * attack blades may cross that contour. Positions use the union of animations, so an attack frame cannot
 * suddenly enlarge the reservation. No alpha/depth changes or per-frame allocation.
 */
export function separateBattleSprites(units: readonly BattlePresentedUnit[], arena: BattlePresentationBounds): void {
  for (const u of units) {
    if (!u.active) continue;
    const a = u.presentation.animated;
    u.displayX = clamp(u.displayX, arena.minX - left(u, a), arena.maxX - right(u, a));
    u.displayY = clamp(u.displayY, arena.minY - a.top * u.node.scaleY, arena.maxY - a.bottom * u.node.scaleY);
  }
  // Reserve large silhouettes first; move the body of a nearby opponent only after the large figure reaches its edge.
  for (const big of units) {
    if (!big.active || !big.presentation.large) continue;
    const a = big.presentation.animated;
    let x = big.displayX;
    for (const foe of units) {
      if (!foe.active || foe.side === big.side) continue;
      const body = foe.presentation.body;
      x = big.side === 'B'
        ? Math.max(x, foe.displayX + right(foe, body) + BODY_GAP - left(big, a))
        : Math.min(x, foe.displayX + left(foe, body) - BODY_GAP - right(big, a));
    }
    big.displayX = clamp(x, arena.minX - left(big, a), arena.maxX - right(big, a));
  }
  for (const big of units) {
    if (!big.active || !big.presentation.large) continue;
    const a = big.presentation.animated;
    for (const foe of units) {
      if (!foe.active || foe.side === big.side || foe.presentation.large) continue;
      const body = foe.presentation.body;
      const x = big.side === 'B'
        ? Math.min(foe.displayX, big.displayX + left(big, a) - BODY_GAP - right(foe, body))
        : Math.max(foe.displayX, big.displayX + right(big, a) + BODY_GAP - left(foe, body));
      foe.displayX = clamp(x, arena.minX - left(foe, foe.presentation.animated), arena.maxX - right(foe, foe.presentation.animated));
    }
  }
}
