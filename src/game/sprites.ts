import Phaser from 'phaser';
import { buildRegistry, resolveAnim, type AnimName, type LegacySprites, type SpriteDef, type SpritesV2 } from '../pipeline/sprites';

const first = <T>(mods: Record<string, unknown>): T | undefined => Object.values(mods)[0] as T | undefined;

/** Файлов может не быть — glob тогда пустой, и реестр просто без этого источника. */
export const SPRITES = buildRegistry(
  first<LegacySprites>(import.meta.glob('../../assets/sprites.legacy.json', { eager: true, import: 'default' })),
  first<SpritesV2>(import.meta.glob('../../assets/sprites/sprites.json', { eager: true, import: 'default' })),
);

export const spriteKey = (id: string) => `spr_${id}`;
export const portraitKey = (id: string) => `portrait_${id}`;
const animKey = (id: string, name: AnimName) => `spr_${id}:${name}`;

/** Ставит в загрузку только нужные спрайты (старые листы монстров огромные — не грузим зря). */
export function queueSprites(scene: Phaser.Scene, ids: string[]): void {
  for (const id of new Set(ids)) {
    const s = SPRITES[id];
    if (!s) continue;
    scene.load.spritesheet(spriteKey(id), s.file, { frameWidth: s.cell[0], frameHeight: s.cell[1] });
    if (s.portrait) scene.load.image(portraitKey(id), s.portrait);
  }
}

/** После загрузки: анимации, фильтр без сглаживания; для отсутствующих — плейсхолдеры. */
export function setupSprites(scene: Phaser.Scene, ids: string[], labels: Record<string, string>): void {
  for (const id of new Set(ids)) {
    const s = SPRITES[id];
    const key = spriteKey(id);
    if (s && scene.textures.exists(key)) {
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      for (const [name, a] of Object.entries(s.anims)) {
        const k = animKey(id, name as AnimName);
        if (scene.anims.exists(k) || !a) continue;
        scene.anims.create({
          key: k,
          frames: Array.from({ length: a.frames }, (_, i) => ({ key, frame: a.row * s.columns + i, duration: a.ms[i] ?? a.ms[0] })),
        });
      }
    } else {
      placeholder(scene, key, 128, 128, labels[id] ?? id, true);
    }
    const pk = portraitKey(id);
    if (scene.textures.exists(pk)) scene.textures.get(pk).setFilter(Phaser.Textures.FilterMode.NEAREST);
    else if (s && scene.textures.exists(key)) {
      // Портрета нет — берём кадр стойки.
      const idle = s.anims.idle;
      const frame = scene.textures.getFrame(key, (idle?.row ?? 0) * s.columns);
      const c = scene.textures.createCanvas(pk, s.cell[0], s.cell[1]);
      if (c && frame) {
        c.drawFrame(key, frame.name);
        c.refresh();
        c.setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    } else placeholder(scene, pk, 128, 128, labels[id] ?? id, false);
  }
}

function placeholder(scene: Phaser.Scene, key: string, w: number, h: number, label: string, body: boolean): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  if (!t) return;
  const ctx = t.getContext();
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  ctx.fillStyle = `hsl(${hash % 360}, 45%, 45%)`;
  // Тело стоит на «ногах» (низ клетки), как у настоящих спрайтов.
  if (body) ctx.fillRect(w * 0.25, h * 0.2, w * 0.5, h * 0.74);
  else ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(Math.min(w / (label.length * 0.6), 28))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, body ? h * 0.55 : h / 2);
  t.refresh();
}

/** Всё, что нужно сцене, чтобы поставить спрайт юнита. */
export interface SpriteView {
  key: string;
  /** Высота клетки на экране. */
  size: number;
  /** Высота фигуры над ногами на экране (макушка) — для подписи, полосок и центра тела. */
  height: number;
  /** Смещение origin, чтобы ноги стояли в точке юнита. */
  originX: number;
  originY: number;
  def?: SpriteDef;
  /** true — настоящий арт (его можно отражать); false — плейсхолдер с подписью. */
  art: boolean;
}

export function spriteView(scene: Phaser.Scene, id: string): SpriteView {
  const s = SPRITES[id];
  const key = spriteKey(id);
  if (s && scene.anims.exists(animKey(id, 'idle'))) {
    const size = s.cell[1] * s.scale;
    const originY = s.anchor[1] / s.cell[1];
    // Нет bbox (старые листы) — считаем, что фигура занимает 85% клетки над ногами.
    const height = s.top !== undefined ? s.top * s.scale : Math.min(size * originY * 0.85, 240);
    return { key, size, height, originX: s.anchor[0] / s.cell[0], originY, def: s, art: true };
  }
  return { key, size: 200, height: 160, originX: 0.5, originY: 0.94, art: false };
}

/** Ключ анимации с учётом замен или null, если у спрайта нет ни её, ни замены. */
export function anim(view: SpriteView, id: string, name: AnimName): string | null {
  const n = resolveAnim(view.def, name);
  return view.art && n ? animKey(id, n) : null;
}

/** Через сколько мс после начала анимации удар касается цели. */
export function hitDelay(view: SpriteView, name: AnimName): number {
  const a = view.def?.anims[resolveAnim(view.def, name) ?? 'attack'];
  if (!a) return 0;
  const hit = a.hitFrame ?? Math.floor(a.frames / 2);
  return a.ms.slice(0, hit).reduce((s, v) => s + v, 0);
}
