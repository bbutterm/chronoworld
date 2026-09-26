/**
 * Реестр спрайтов — единый формат для игры и скриптов проверки (без Phaser).
 * Источники:
 *   assets/sprites/sprites.json   — формат v2 (docs/SPRITE_SPEC.md), главный;
 *   assets/sprites.legacy.json    — старые листы assets/ro, сконвертированные `npm run assets:legacy`.
 * v2 перекрывает legacy по id.
 */

export type AnimName = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'death';
export const ANIM_NAMES: AnimName[] = ['idle', 'walk', 'attack', 'cast', 'hurt', 'death'];

/** Чем заменить анимацию, если её нет в листе. */
export const ANIM_FALLBACK: Record<AnimName, AnimName | null> = {
  idle: null,
  walk: 'idle',
  attack: 'idle',
  cast: 'attack',
  hurt: null,
  death: null,
};

export interface AnimDef {
  row: number;
  frames: number;
  /** Длительность каждого кадра, мс. */
  ms: number[];
  loop?: boolean;
  /** Кадр, на котором удар касается цели (счёт с 0). */
  hitFrame?: number;
}

export interface SpriteDef {
  id: string;
  file: string;
  cell: [number, number];
  /** Точка ног внутри клетки. */
  anchor: [number, number];
  columns: number;
  /** Во сколько раз увеличить на экране (1080×1920). */
  scale: number;
  anims: Partial<Record<AnimName, AnimDef>>;
  portrait?: string;
  /** Высота фигуры в стойке над точкой ног, px листа (из bbox idle). Нужна для подписи и центра тела. */
  top?: number;
  source: 'v2' | 'legacy';
}

/**
 * Масштаб на экране для спрайтов v2 (родной размер RO ×1 → ×2.5):
 * герой в стойке ~90 px листа → ~230 px на поле 1080×1920.
 */
export const V2_SCALE = 2.5;

interface V2Class {
  cell: [number, number];
  anchor: [number, number];
  anims: string[];
}
interface V2Anim {
  frames: number;
  ms: number;
  loop?: boolean;
  hitFrame?: number;
}
export interface SpritesV2 {
  schema: 2;
  columns: number;
  classes: Record<string, V2Class>;
  anims: Record<string, V2Anim>;
  animOverrides?: Record<string, Record<string, Partial<V2Anim>>>;
  sprites: {
    id: string;
    class: string;
    file: string;
    portrait?: string;
    hitFrames?: Record<string, number>;
    /** Габариты кадров анимации в клетке: [x0, y0, x1, y1]. */
    bbox?: Record<string, [number, number, number, number]>;
  }[];
}

export function normalizeV2(json: SpritesV2): SpriteDef[] {
  return json.sprites.map((s) => {
    const cls = json.classes[s.class];
    if (!cls) throw new Error(`sprites.json: у спрайта ${s.id} неизвестный класс ${s.class}`);
    const anims: SpriteDef['anims'] = {};
    cls.anims.forEach((name, row) => {
      const a = { ...json.anims[name], ...json.animOverrides?.[s.class]?.[name] };
      if (!a || !a.frames) return;
      anims[name as AnimName] = {
        row,
        frames: a.frames,
        ms: Array(a.frames).fill(a.ms),
        loop: a.loop,
        hitFrame: s.hitFrames?.[name] ?? a.hitFrame,
      };
    });
    return {
      id: s.id,
      file: s.file,
      cell: cls.cell,
      anchor: cls.anchor,
      columns: json.columns,
      scale: V2_SCALE,
      anims,
      portrait: s.portrait,
      top: s.bbox?.idle ? Math.max(0, cls.anchor[1] - s.bbox.idle[1]) : undefined,
      source: 'v2' as const,
    };
  });
}

export interface LegacySprites {
  sprites: Omit<SpriteDef, 'source'>[];
}

export function buildRegistry(legacy: LegacySprites | undefined, v2: SpritesV2 | undefined): Record<string, SpriteDef> {
  const out: Record<string, SpriteDef> = {};
  for (const s of legacy?.sprites ?? []) out[s.id] = { ...s, source: 'legacy' };
  for (const s of v2 ? normalizeV2(v2) : []) out[s.id] = s;
  return out;
}

/** Имя анимации с учётом замен (например, нет walk — играем idle). */
export function resolveAnim(def: SpriteDef | undefined, name: AnimName): AnimName | null {
  let n: AnimName | null = name;
  while (n && !def?.anims[n]) n = ANIM_FALLBACK[n];
  return n;
}
