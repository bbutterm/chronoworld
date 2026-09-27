import Phaser from 'phaser';
import { ensureAmbientTextures, SHADOW_TEX } from './ambient';
import { CONTENT } from './content';
import { portrait } from './screen';
import { SKIN, SKIN_TINT, skinIcon } from './skin';
import { portraitKey, SPRITES } from './sprites';

/**
 * Портрет в рамке (визуальная полировка): диалоги сюжета, шапка смены профессии, карточка героя.
 *
 * Лицо — бюст RO (assets/ro/portraits/hero_<класс>_portrait.png, 256×256: верхняя половина фигуры ×4) для тех
 * профессий, у которых он есть; бюсты грузятся по требованию (≈ 0.25 МБ видеопамяти каждый) и остаются в кэше.
 * Нет бюста или ещё грузится — портрет спрайта (portrait_<id>, 64×64 v2 или вырезанный из листа). Нет и его —
 * значок скина. Всё рисуется на тёплой подложке в золотой рамке скина.
 */

const FRAME = 'skin_portrait_frame';
const BACK = 'skin_portrait_bg';

/** Бюсты RO: id спрайта → URL (от корня assets). Имя класса в файле не всегда равно id спрайта. */
const BUST_ALIAS: Record<string, string> = { priestess: 'priest' };
const BUSTS: Record<string, string> = {};
for (const path of Object.keys(import.meta.glob('../../assets/ro/portraits/hero_*_portrait.png', { query: '?url', import: 'default' }))) {
  const name = path.split('/').pop()!;
  const cls = name.replace(/^hero_|_portrait\.png$/g, '');
  // Вариант по полу — суффикс _m/_f после имени класса (hero_priestess_m_portrait.png → priest_m).
  const [, base, g = ''] = /^(.+?)(_[mf])?$/.exec(cls)!;
  BUSTS[(BUST_ALIAS[base] ?? base) + g] = `ro/portraits/${name}`;
}
const bustKey = (id: string) => `bust_${id}`;
const pending = new Map<string, Promise<boolean>>();

/** Есть ли у спрайта бюст RO. */
export const hasBust = (id: string) => !!BUSTS[id] && !!SPRITES[id];

/** Базовый лист варианта по полу (`acolyte_m` → `acolyte`), если базовый зарегистрирован; иначе сам id. */
const baseSprite = (id: string) => {
  const m = /^(.+)_[mf]$/.exec(id);
  return m && SPRITES[m[1]] ? m[1] : id;
};

/**
 * Бюст героя с учётом пола: бюст варианта `hero_<база>_<m|f>_portrait.png` (если есть) → бюст самого листа → нет.
 * Лист-вариант без своего бюста получает портрет листа (правильного пола), а не бюст базы.
 */
export function bustFor(sprite: string, gender?: 'm' | 'f'): string | undefined {
  const base = baseSprite(sprite);
  if (gender && BUSTS[`${base}_${gender}`] && SPRITES[base]) return `${base}_${gender}`;
  return hasBust(sprite) ? sprite : undefined;
}

/** Загрузить бюст (один раз); true — текстура готова. */
function loadBust(game: Phaser.Game, id: string): Promise<boolean> {
  const key = bustKey(id);
  if (game.textures.exists(key)) return Promise.resolve(true);
  const running = pending.get(id);
  if (running) return running;
  const p = new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!game.textures.exists(key)) game.textures.addImage(key, img)?.setFilter(Phaser.Textures.FilterMode.NEAREST);
      resolve(true);
    };
    img.onerror = () => {
      console.warn(`Бюст ${BUSTS[id]} не загрузился — будет портрет спрайта`);
      resolve(false);
    };
    img.src = BUSTS[id];
  }).finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}

type Ctx = CanvasRenderingContext2D;

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Текстуры рамки и подложки (один раз). */
export function ensurePortraitTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  if (!tm.exists(BACK)) {
    const t = tm.createCanvas(BACK, 128, 128);
    if (t) {
      const c = t.getContext();
      rr(c, 4, 4, 120, 120, 18);
      c.save();
      c.clip();
      const g = c.createRadialGradient(64, 52, 4, 64, 64, 84);
      g.addColorStop(0, '#6b5436');
      g.addColorStop(0.55, '#34281b');
      g.addColorStop(1, '#120e0a');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
      // Лучи из-за головы — чуть светлее фона.
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgba(255,220,160,0.05)';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        c.beginPath();
        c.moveTo(64, 50);
        c.arc(64, 50, 110, a, a + 0.22);
        c.closePath();
        c.fill();
      }
      c.restore();
      t.refresh();
    }
  }
  if (!tm.exists(FRAME)) {
    const S = 256;
    const t = tm.createCanvas(FRAME, S, S);
    if (t) {
      const c = t.getContext();
      // Тёмный кант, золотой обод с градиентом, тонкая бронзовая линия внутри.
      rr(c, 7, 7, S - 14, S - 14, 30);
      c.lineWidth = 14;
      c.strokeStyle = '#120d07';
      c.stroke();
      const g = c.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, SKIN.goldLight);
      g.addColorStop(0.5, SKIN.gold);
      g.addColorStop(1, SKIN.goldDark);
      c.lineWidth = 7;
      c.strokeStyle = g;
      c.stroke();
      rr(c, 17, 17, S - 34, S - 34, 22);
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(122,100,66,0.9)';
      c.stroke();
      // Блик на верхней кромке.
      c.beginPath();
      c.moveTo(40, 8);
      c.lineTo(S - 40, 8);
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255,245,215,0.7)';
      c.stroke();
      // Ромбы-заклёпки в углах и сверху по центру.
      const gem = (x: number, y: number, r: number, face: string) => {
        c.beginPath();
        c.moveTo(x, y - r);
        c.lineTo(x + r, y);
        c.lineTo(x, y + r);
        c.lineTo(x - r, y);
        c.closePath();
        c.fillStyle = '#120d07';
        c.fill();
        c.beginPath();
        c.moveTo(x, y - r + 3);
        c.lineTo(x + r - 3, y);
        c.lineTo(x, y + r - 3);
        c.lineTo(x - r + 3, y);
        c.closePath();
        c.fillStyle = face;
        c.fill();
      };
      for (const [x, y] of [[16, 16], [S - 16, 16], [16, S - 16], [S - 16, S - 16]]) gem(x, y, 13, SKIN.gold);
      gem(S / 2, 8, 12, '#b8402e');
      t.refresh();
    }
  }
}

/** Спрайт — профессия героя (а не монстр/босс): у врагов подложка холоднее и краснее. */
const heroSprites = () => new Set(Object.values(CONTENT.jobs).map((j) => j.visual.sprite));
let heroSet: Set<string> | null = null;
const isHeroSprite = (id: string) => (heroSet ??= heroSprites()).has(baseSprite(id));

/**
 * Портрет в рамке: size — внешний размер рамки. sprite — id спрайта (null — значок скина); gender — пол героя
 * (бюст `<база>_<m|f>`, если есть, см. bustFor). Возвращает контейнер (подложка, лицо, рамка); лицо само подменится
 * бюстом, когда тот загрузится.
 */
export function framedPortrait(
  scene: Phaser.Scene,
  x: number,
  y: number,
  sprite: string | null,
  size: number,
  gender?: 'm' | 'f',
): Phaser.GameObjects.Container {
  ensurePortraitTextures(scene);
  const inner = size * 0.86;
  const box = scene.add.container(x, y);
  const back = scene.add.image(0, 0, BACK).setDisplaySize(inner + 6, inner + 6);
  if (sprite && !isHeroSprite(sprite)) back.setTint(0xe0a0a0);
  const face = heroFace(scene, sprite, inner, gender);
  const frame = scene.add.image(0, 0, FRAME).setDisplaySize(size, size);
  box.add([back, face, frame]);
  return box;
}

/**
 * Лицо героя без рамки и подложки (для рамки портрета и плиток карточек героев, heroCard.ts): бюст RO → портрет
 * листа (голова и плечи) → значок скина. inner — сторона квадрата; tint — перекраска (серые «неполученные» карточки),
 * применяется и к бюсту, который подгрузится позже. Контейнер с центром в центре квадрата.
 */
export function heroFace(scene: Phaser.Scene, sprite: string | null, inner: number, gender?: 'm' | 'f', tint?: number): Phaser.GameObjects.Container {
  const face = scene.add.container(0, 0);
  const paint = () => {
    if (tint === undefined) return;
    for (const o of face.list) (o as Phaser.GameObjects.Image).setTint?.(tint);
  };
  const putBust = (id: string) => {
    face.removeAll(true);
    // Бюст 256×256: фигура до среза на y≈236, голова с y≈20. Срез — по низу рамки, голова — чуть ниже верха.
    const k = (inner * 1.12) / 256;
    face.add(scene.add.image(0, inner / 2, bustKey(id)).setOrigin(0.5, 236 / 256).setScale(k));
    paint();
  };
  if (!sprite || (!SPRITES[sprite] && !scene.textures.exists(portraitKey(sprite)))) {
    face.add(scene.add.image(0, 0, skinIcon('swords')).setDisplaySize(inner * 0.6, inner * 0.6).setTint(tint ?? SKIN_TINT.gold));
    return face;
  }
  const bust = bustFor(sprite, gender);
  if (bust && scene.textures.exists(bustKey(bust))) putBust(bust);
  else {
    face.add(SPRITES[sprite]?.portrait && scene.textures.exists(portraitKey(sprite)) ? headCrop(scene, portraitKey(sprite), inner) : portrait(scene, 0, 0, portraitKey(sprite), inner * 0.94));
    paint();
    if (bust) {
      void loadBust(scene.game, bust).then((ok) => {
        if (ok && face.scene) putBust(bust);
      });
    }
  }
  return face;
}

/**
 * Портрет-файл спрайта (64×64, фигура в полный рост) крупнее: верхний квадрат (голова и плечи) на всю рамку.
 * Без маски — обрезка кадра (setCrop), один и тот же батч.
 */
function headCrop(scene: Phaser.Scene, key: string, inner: number): Phaser.GameObjects.Image {
  const img = scene.add.image(0, 0, key);
  const w = img.width;
  const h = img.height;
  const side = Math.round(h * 0.72);
  const x0 = Math.round((w - side) / 2);
  const k = (inner * 0.98) / side;
  img.setCrop(x0, 0, side, side).setScale(k);
  // Центр обрезки — в центр рамки.
  return img.setPosition(-(x0 + side / 2 - w / 2) * k, -(side / 2 - h / 2) * k);
}

/**
 * Рамка для фигуры в полный рост (карточка героя): подложка, тень под ногами и золотая рамка скина.
 * Фигуру кладут поверх (unitFigure) — ноги в feetY.
 */
export function figureFrame(scene: Phaser.Scene, x: number, y: number, size: number, feetY: number): void {
  ensurePortraitTextures(scene);
  ensureAmbientTextures(scene);
  scene.add.image(x, y, BACK).setDisplaySize(size * 0.9, size * 0.9);
  scene.add.image(x, feetY + 4, SHADOW_TEX).setDisplaySize(size * 0.55, size * 0.14);
  scene.add.image(x, y, FRAME).setDisplaySize(size, size);
}
