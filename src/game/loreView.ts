import Phaser from 'phaser';
import { tavernNewCount, chronicleKeys, firstSentence, heroStoryUnreadTotal, jobTitle, refinedStats, unseenCount, type ChronicleTab, type ItemDef, type LineKind, type UnitDef } from '../core';
import { GAME, LORE } from './content';
import { itemStatsText, RARITY_COLORS, RARITY_NAMES, ROLE_NAMES, SLOT_NAMES } from './flow';
import { hasCollectionArt, itemCell, itemIconKey, loadCollectionArt, refineBadge, roIconImage } from './itemIcons';
import { GAME_H, GAME_W } from './layout';
import { minimumTouchSize, onViewChange, view } from './viewport';
import { popIn, registerModal, unitFigure, unitTint } from './screen';
import { session } from './session';
import { SKIN_TINT } from './skin';
import { goldDot, roundIcon, ROUND_ICON } from './homeBuildings';
import { BTN, button, ellipsize, plate, ScrollArea, SURFACE, text } from './ui';
import { C, COLOR, FAMILY, FS, M, R, S, T, TINT } from './theme';
import { tr } from './locale';

/**
 * Летопись (лор RO, data/lore): общие помощники экранов — прочитанные записи (localStorage), значок «новое»,
 * кнопка входа на странице «Город», окно записи (монстр, предмет, герой, глава) и иконка-книга.
 */

// ---------- прочитанные записи ----------

const SEEN_KEY = (import.meta.env?.VITE_ADVANCE_LAB === '1' ? 'chronoworld.advanceLab.lore.seen' : 'chronoworld.lore.seen');
let seenCache: Set<string> | null = null;

/** Ключи записей, которые игрок уже видел в «Летописи» (`<вкладка>:<id>`). Хранилища нет — живёт в памяти. */
export function seenLore(): Set<string> {
  if (seenCache) return seenCache;
  let list: unknown = [];
  try {
    list = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
  } catch {
    list = [];
  }
  seenCache = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  return seenCache;
}

/** Отметить записи прочитанными. */
export function markLoreSeen(keys: readonly string[]): void {
  const seen = seenLore();
  const before = seen.size;
  for (const k of keys) seen.add(k);
  if (seen.size === before) return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Хранилище недоступно — отметки живут до перезагрузки.
  }
}

/** Открытые записи по вкладкам (для значков). */
export const loreKeys = (): Record<ChronicleTab, string[]> => chronicleKeys(session.save, GAME, LORE);

/**
 * Новые (открытые и непрочитанные) записи — по вкладкам и всего. Во вкладку «Герои» входят и непрочитанные кусочки
 * истории героев (save.heroStoryRead, heroStoryView.ts).
 */
export const loreUnseen = () => {
  const r = unseenCount(loreKeys(), seenLore());
  const stories = heroStoryUnreadTotal(session.save, LORE);
  return { ...r, heroes: r.heroes + stories, total: r.total + stories };
};

// ---------- иконка и вход ----------

/** Раскрытая книга (своей иконки в скине нет). size — ширина. */
export function bookIcon(scene: Phaser.Scene, x: number, y: number, size: number, color: number = SKIN_TINT.gold): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const w = size / 2;
  const h = size * 0.62;
  const lw = Math.max(3, size / 16);
  g.lineStyle(lw, color, 1);
  // Левая и правая страницы с чуть приподнятыми внешними краями.
  g.beginPath();
  g.moveTo(0, -h / 2 + 6);
  g.lineTo(-w + 2, -h / 2);
  g.lineTo(-w + 2, h / 2 - 6);
  g.lineTo(0, h / 2);
  g.lineTo(w - 2, h / 2 - 6);
  g.lineTo(w - 2, -h / 2);
  g.lineTo(0, -h / 2 + 6);
  g.lineTo(0, h / 2);
  g.strokePath();
  // Строки текста.
  g.lineStyle(Math.max(2, lw - 2), color, 0.8);
  for (let i = 0; i < 3; i++) {
    const yy = -h / 2 + 16 + i * (h / 5);
    g.lineBetween(-w + 10, yy, -8, yy + 3);
    g.lineBetween(8, yy + 3, w - 10, yy);
  }
  return g;
}

/**
 * «Летопись» на странице «Город»: круглая иконка-книга (как иконки шапки, homeBuildings.ts roundIcon), имя
 * chronicleBtn. Есть новое для чтения (записи, вечера в «Двух колоколах», личные сцены) — тихая золотая точка без числа
 * (красное — только «можно забрать», ui-polish-research §2.4).
 */
export function chronicleButton(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Container {
  const b = roundIcon(scene, x, y, 'chronicleBtn', (s) => bookIcon(scene, 0, 0, s), () => scene.scene.start('Chronicle'));
  const n = loreUnseen().total + tavernNewCount(session.save, GAME);
  if (n > 0) goldDot(scene, x + ROUND_ICON.size / 2 - 10, y - ROUND_ICON.size / 2 + 10).setName('chronicleBadge');
  return b;
}

// ---------- окно записи ----------

export interface LoreBlock {
  text: string;
  color?: string;
  size?: number;
  italic?: boolean;
  bold?: boolean;
  /** Отступ после блока (по умолчанию 22). */
  gap?: number;
}

export interface LoreModalOptions {
  title: string;
  titleColor?: string;
  subtitle?: string;
  /** Картинка над текстом: рисует в полосе высотой ART_H с центром (x, y) и возвращает объекты (или кладёт их через add). */
  art?: (add: (o: Phaser.GameObjects.GameObject) => void, x: number, y: number) => void;
  blocks: LoreBlock[];
  /** Список под окном — не прокручивать и не нажимать, пока окно открыто. */
  lock?: ScrollArea;
  /** Вторая кнопка слева от «Закрыть» (например, «История героя»): окно закрывается, затем onTap. */
  extra?: { label: string; onTap: () => void; dot?: boolean };
}

/** Окно почти во весь экран 9:16: ширина 1040 из 1080, высота до 1840 из 1920 (длинный текст — прокрутка). */
const BOX_W = 1040;
const PAD = 56;
const ART_H = 260;
const MAX_H = 1840;
/** Основной шрифт окна — T.body (≈ 14.4 px на 390×844), межстрочный 1.4 для чтения. */
const BODY_FS = T.body;
const BODY_LEADING = Math.round(T.body * 0.4);

/**
 * Модальное окно записи Летописи: заголовок (заголовочная гарнитура), подзаголовок, картинка, абзацы (длинное —
 * прокручивается); внизу — «Закрыть» (вторичная) и, если есть, главное действие (extra, золото).
 */
export function loreModal(scene: Phaser.Scene, o: LoreModalOptions): Phaser.GameObjects.Container {
  const cx = GAME_W / 2;
  const layer = scene.add.container(0, 0).setDepth(9000).setName('loreModal');
  const shade = scene.add.rectangle(cx, GAME_H / 2, GAME_W * 2, GAME_H * 2, 0x000000, 0.72).setInteractive();
  const lockedArea = o.lock;
  const wasLocked = lockedArea?.locked ?? false;
  if (lockedArea) lockedArea.locked = true;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    layer.destroy();
  };
  registerModal(layer, close);
  layer.once(Phaser.GameObjects.Events.DESTROY, () => {
    closed = true;
    if (lockedArea) lockedArea.locked = wasLocked;
  });
  shade.on('pointerup', close);

  const tw = BOX_W - 2 * PAD;
  const left = cx - BOX_W / 2 + PAD;
  const title = text(scene, cx, 0, o.title, T.title, o.titleColor ?? COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold', wordWrap: { width: tw } }).setOrigin(0.5, 0);
  const sub = o.subtitle ? text(scene, cx, 0, o.subtitle, T.caption, COLOR.textSecondary, { fontStyle: 'bold', wordWrap: { width: tw } }).setOrigin(0.5, 0) : null;
  const blocks = o.blocks
    .filter((b) => b.text)
    .map((b) => ({
      b,
      t: text(scene, left, 0, b.text, b.size ?? BODY_FS, b.color ?? COLOR.textPrimary, {
        align: 'left',
        wordWrap: { width: tw, useAdvancedWrap: true },
        lineSpacing: b.size && b.size < BODY_FS ? 8 : BODY_LEADING,
        fontStyle: [b.bold ? 'bold' : '', b.italic ? 'italic' : ''].join(' ').trim() || 'normal',
        ...(b.bold && (b.size ?? 0) >= T.heading ? { fontFamily: FAMILY.heading } : {}),
      }).setOrigin(0, 0),
    }));
  const touchH = Math.max(BTN.l, minimumTouchSize());
  const footH = Math.max(190, touchH + 2 * S.m);
  const fullHeight = title.height + S.xxs + (sub ? sub.height + S.xxs : 0) + (o.art ? ART_H : S.s)
    + blocks.reduce((sum, { b, t }) => sum + t.height + (b.gap ?? S.s), 0);
  const geometry = () => {
    const v = view();
    const boxH = Math.min(fullHeight + S.l + footH, MAX_H, v.safeBottom - v.safeTop - 2 * S.s);
    return { boxH, top: (v.safeTop + v.safeBottom - boxH) / 2 };
  };
  const initial = geometry();
  const chrome = scene.add.container(0, 0);
  const bg = plate(scene, cx, 0, BOX_W, MAX_H, { ...SURFACE.raised, alpha: 0.99, r: R.xl }).setInteractive();
  chrome.add(bg);
  layer.add([shade, chrome]);
  // Заголовок и иллюстрация тоже входят в полосу: длинная шапка не вытесняет текст с короткого экрана.
  const area = new ScrollArea(scene, initial.top + S.l, initial.top + initial.boxH - footH, { left: cx - BOX_W / 2, right: cx + BOX_W / 2 });
  area.content.setName('loreModalScroll');
  area.add(title);
  let y = title.height + S.xxs;
  if (sub) {
    sub.setY(y);
    area.add(sub);
    y += sub.height + S.xxs;
  }
  if (o.art) {
    const art = scene.add.container(0, 0);
    o.art((obj) => art.add(obj), cx, y + ART_H / 2 - 10);
    area.add(art);
    y += ART_H;
  } else y += S.s;
  for (const { b, t } of blocks) {
    t.setY(y);
    area.add(t);
    y += t.height + (b.gap ?? S.s);
  }
  area.setContentHeight(y);
  const buttons: Phaser.GameObjects.Container[] = [];
  if (o.extra) {
    const ex = o.extra;
    const eb = button(scene, cx + 210, 0, 520, touchH, 'ui_btn_primary', ex.label, () => {
      if (closed) return;
      close();
      ex.onTap();
    }, T.body);
    eb.container.setName('loreModalExtra');
    ellipsize(eb.label, 520 - 2 * S.m);
    if (ex.dot) eb.container.add(goldDot(scene, 260 - 14, -touchH / 2 + 14));
    buttons.push(eb.container);
    buttons.push(button(scene, cx - 290, 0, 340, touchH, '', 'Закрыть', close, T.body, { variant: 'secondary' }).container.setName('loreModalClose'));
  } else buttons.push(button(scene, cx, 0, 400, touchH, '', 'Закрыть', close, T.body, { variant: 'secondary' }).container.setName('loreModalClose'));
  chrome.add(buttons);
  const reflow = () => {
    if (closed) return;
    const { boxH, top } = geometry();
    bg.setPosition(cx, top + boxH / 2).setSize(BOX_W, boxH);
    const btnY = top + boxH - footH / 2;
    for (const b of buttons) b.setY(btnY);
    area.setBounds(top + S.l, top + boxH - footH);
  };
  bg.setPosition(cx, initial.top + initial.boxH / 2).setSize(BOX_W, initial.boxH);
  for (const b of buttons) b.setY(initial.top + initial.boxH - footH / 2);
  popIn(scene, layer, shade);
  // ScrollArea использует координаты мира; его части не должны попасть во внутренний контейнер popIn.
  layer.add(area.parts);
  scene.tweens.add({ targets: area.content, alpha: { from: 0, to: 1 }, duration: M.base });
  const offView = onViewChange(scene, reflow);
  layer.once(Phaser.GameObjects.Events.DESTROY, offView);
  return layer;
}

// ---------- готовые окна ----------

/** Роль монстра словами. */
export const roleName = (u: UnitDef) => `${u.kind === 'boss' ? 'Босс · ' : ''}${ROLE_NAMES[u.role] ?? u.role}`;

/**
 * Окно монстра: фигура, имя, прозвище, текст, цитата курсивом, роль и где встречается.
 * loreId — id юнита в data/units (у врага этапа unit.id — копия `<этап>_<слот>`, лор ищем по исходному id).
 */
export function monsterModal(scene: Phaser.Scene, unit: UnitDef, where: readonly string[], opts: { loreId?: string; lock?: ScrollArea } = {}): void {
  const lock = opts.lock;
  const l = LORE.monsters[opts.loreId ?? unit.id];
  const blocks: LoreBlock[] = [];
  if (l) {
    blocks.push({ text: l.text });
    if (l.quote) blocks.push({ text: `«${l.quote}»`, italic: true, color: C.title });
  } else blocks.push({ text: 'Летописец ещё не записал рассказ об этом существе.', color: C.dim, italic: true });
  blocks.push({ text: `Роль: ${roleName(unit)}`, color: C.muted, size: FS.small, gap: 10 });
  if (where.length) blocks.push({ text: `Где встречается: ${shortList(where)}`, color: C.muted, size: FS.small });
  loreModal(scene, {
    title: unit.name,
    titleColor: unit.kind === 'boss' ? C.danger : C.title,
    subtitle: l?.title,
    art: (add, x, y) => {
      add(scene.add.ellipse(x, y + 84, 200, 36, 0x000000, 0.35));
      unitFigure(scene, unit.visual.sprite, x, y + 88, unit.kind === 'boss' ? 200 : 170, {
        maxScale: 2,
        onReady: (spr) => {
          spr.setTint(unitTint(unit.visual));
          if (spr instanceof Phaser.GameObjects.Sprite) spr.setFlipX(true).setOrigin(1 - spr.originX, spr.originY);
          add(spr);
        },
      });
    },
    blocks,
    lock,
  });
}

/** «2-5, 2-7, 3-1 и ещё 4». */
export function shortList(list: readonly string[], max = 6): string {
  return list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} и ещё ${list.length - max}`;
}

/** Строка-легенда предмета (или undefined). */
export const itemLegend = (itemId: string): string | undefined => LORE.items[itemId];

/** Окно предмета: иконка, редкость и слот, статы (с заточкой), кому подходит, легенда курсивом. */
export function itemModal(scene: Phaser.Scene, def: ItemDef, opts: { refine?: number; lock?: ScrollArea; card?: string | null } = {}): void {
  const refine = opts.refine ?? 0;
  const stats = refine ? refinedStats(def, refine, GAME) : def.stats;
  const blocks: LoreBlock[] = [{ text: itemStatsText(stats), color: C.text, bold: true, size: FS.h3 }];
  if (def.jobs?.length) blocks.push({ text: `Кому: ${def.jobs.map((j) => jobTitle(GAME, j)).join(', ')} и их ветки`, color: C.muted, size: FS.small });
  // BUG-187: слот карты MVP — что вставлено или что можно вставить (Инвентарь → «Карты MVP»).
  if (opts.card !== undefined) {
    const inside = opts.card ? GAME.hunt.cards.find((c) => c.id === opts.card) : undefined;
    if (inside) blocks.push({ text: `${inside.name}: ${inside.text}`, color: '#d8b4ff', bold: true, size: FS.small });
    else {
      const own = session.save.hunt?.cards ?? {};
      const fit = GAME.hunt.cards.filter((c) => c.slot === def.slot && (own[c.id] ?? 0) > 0);
      blocks.push({
        text: fit.length ? `Слот карты пуст · есть «${fit[0].name}» — Инвентарь → Карты MVP → Вставить` : 'Слот карты пуст · карты MVP выпадают на охоте',
        color: fit.length ? '#d8b4ff' : C.muted,
        size: FS.small,
      });
    }
  }
  const legend = itemLegend(def.id);
  if (legend) blocks.push({ text: legend, italic: true, color: C.title });
  loreModal(scene, {
    title: `${refine ? `+${refine} ` : ''}${def.name}`,
    titleColor: RARITY_COLORS[def.rarity],
    subtitle: `${RARITY_NAMES[def.rarity]} · ${SLOT_NAMES[def.slot]}${def.minChapter > 1 ? ` · с главы ${def.minChapter}` : ''}`,
    art: (add, x, y) => {
      const color = Phaser.Display.Color.HexStringToColor(RARITY_COLORS[def.rarity]).color;
      if (!hasCollectionArt(def.id)) {
        for (const obj of itemCell(scene, x, y, 180, def.slot, color, def.id, refine)) add(obj);
        return;
      }
      // Большая картинка RO (collection, 75×100 ×2) в рамке редкости; пока грузится — ячейка с иконкой на её месте.
      const frame = scene.add.rectangle(x, y, 166, 216, TINT.checkOff, 0.95).setStrokeStyle(4, color, 1);
      const back = scene.add.rectangle(x, y, 158, 208, color, 0.18);
      add(frame);
      add(back);
      const ico = roIconImage(scene, x, y, def.id, 120) ?? scene.add.image(x, y, itemIconKey(scene, def.slot, def.id)).setDisplaySize(120, 120).setTint(color);
      add(ico);
      const badge = refine > 0 ? refineBadge(scene, x - 83 + 6, y - 108 + 2, refine, FS.small) : undefined;
      if (badge) add(badge);
      void loadCollectionArt(scene.game, def.id).then((key) => {
        if (!key || !frame.scene || !frame.active) return;
        ico.destroy();
        const pic = scene.add.image(x, y, key).setScale(2);
        add(pic);
        if (badge) badge.parentContainer?.bringToTop(badge);
      });
    },
    blocks,
    lock: opts.lock,
  });
}

/** Прозвище и первая фраза лора монстра (подсказка на экране этапа); лора нет — undefined. */
export function monsterTeaser(unitId: string): string | undefined {
  const l = LORE.monsters[unitId];
  return l ? `${tr(l.title)}. ${firstSentence(tr(l.text))}` : undefined;
}

// ---------- строки-комментарии ----------

/**
 * Случайная строка-комментарий вида kind (data/lore/lines.json, lore-route §5.8): заточка, поражение, этаж Башни,
 * экспедиция, загрузка. Это только вид (UI), поэтому Math.random; строк нет — undefined. Подряд одна и та же не выпадает.
 */
const lastLine: Partial<Record<LineKind, string>> = {};
export function randomLine(kind: LineKind): string | undefined {
  const list = LORE.lines[kind];
  if (!list.length) return undefined;
  const pool = list.length > 1 ? list.filter((l) => l !== lastLine[kind]) : list;
  const line = pool[Math.floor(Math.random() * pool.length)];
  lastLine[kind] = line;
  return line;
}
