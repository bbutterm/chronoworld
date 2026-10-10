import Phaser from 'phaser';
import { FINDING_KIND_NAMES, type ChapterChronicleDef, type EpisodeDef, type FindingDef, type FindingKind, type InterludeDef, type IntroPages, type LegendDef } from '../core';
import { sfx } from './audio';
import { haptic } from './haptics';
import { setThemeBackground, themeOfChapter } from './backdrops';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { bleedImage, onViewChange, view } from './viewport';
import { SKIN, SKIN_TINT } from './skin';
import { registerModal } from './screen';
import { BTN, button, mixHex, plate, ScrollArea, SURFACE, text, type PlateSpec } from './ui';
import { C, COLOR, FAMILY, M, R, S, T, TINT } from './theme';
import { hush, speak } from './voice';

/**
 * Страницы «между этапами» (docs/design/lore-route.md §5): «Эпизод N» и легенда перед главой, летопись главы после
 * финала, находка после боя. Полноэкранная страница поверх экрана: фон темы главы, надзаголовок («Эпизод 1»),
 * заголовок, эпиграф, текст (длинный — прокручивается), подпись, комментарий героя; «Далее ›» / касание — следующая,
 * «Пропустить» — закрыть все. Слой называется как диалог сюжета (DIALOGUE_NAME): экран под ним недоступен, e2e
 * пролистывает его тем же способом («Пропустить» или касания).
 */

export interface StoryPage {
  /** Надзаголовок: «Эпизод 1», «Легенда», «Летопись отряда», «Находка · Надпись». */
  kicker: string;
  title: string;
  subtitle?: string;
  /** Эпиграф (без кавычек). */
  quote?: string;
  /** Основной текст; абзацы — через пустую строку. */
  text: string;
  /** Подпись под текстом (без тире). */
  source?: string;
  /** Реплика героя под текстом. */
  comment?: { speaker: string; text: string };
  /** Фон — тема главы (нет — тёмный фон). */
  chapterId?: string;
  /** Значок находки над заголовком. */
  finding?: FindingKind;
  /** Вид страницы: свиток (легенда) — светлее, книга (летопись) — с золотой рамкой. */
  look?: 'episode' | 'scroll' | 'book' | 'finding';
}

export interface PagesOptions {
  /** Подпись кнопки последней страницы (по умолчанию «Далее ›», если страница одна — «Закрыть»). */
  doneLabel?: string;
  /** Список под рассказом остаётся на прежнем месте до закрытия. */
  lock?: ScrollArea;
}

/** Имя и глубина слоя — как у диалога сюжета (dialogue.ts: DIALOGUE_NAME, DEPTH). */
const DIALOGUE_NAME = 'dialogue';
const DEPTH = 9500;
/** Поверхность панели текста по виду страницы: свиток светлее, книга — с золотой кромкой. */
const PAGE_SURFACE: Record<NonNullable<StoryPage['look']>, PlateSpec> = {
  episode: { fill: COLOR.surface, alpha: 0.86, r: R.xl },
  finding: { fill: COLOR.surface, alpha: 0.86, r: R.xl },
  scroll: { fill: '#3a3226', alpha: 0.9, border: '#6b5a3c', borderW: 2, r: R.xl, hl: 0.12 },
  book: { ...SURFACE.raised, alpha: 0.92, border: mixHex(COLOR.border, COLOR.accent, 0.45), r: R.xl },
};
const COLOR_N_ACCENT = parseInt(COLOR.accent.slice(1), 16);
const COLOR_N_DIM = parseInt(COLOR.textTertiary.slice(1), 16);
/** Касание раньше этого (мс) после показа страницы не листает — хвост прошлого нажатия. */
const GUARD_MS = 350;
/** Ширина текста и его шрифт: страница во весь экран 9:16, текст крупнее основного (на 390×844 ≈ 15 px). */
const TEXT_W = 900;
/** Текст страницы — T.body, межстрочный 1.4 (≈ 34 знака в строке на 390 px). */
const BODY_FS = T.body;
const BODY_LEADING = Math.round(T.body * 0.4);
const BODY_TOP_MIN = 520;
const BODY_BOTTOM = 1690;

/** Открыта ли страница на экране (тот же слой, что у диалога). */
export const pageOpen = (scene: Phaser.Scene) => !!scene.children.getByName(DIALOGUE_NAME);

/**
 * Показать страницы по очереди; после последней (или «Пропустить») — onDone. Пустой список — onDone сразу.
 */
export function showPages(scene: Phaser.Scene, pages: readonly StoryPage[], onDone: () => void, opts: PagesOptions = {}): Phaser.GameObjects.Container | null {
  if (!pages.length) {
    onDone();
    return null;
  }
  const layer = scene.add.container(0, 0).setDepth(DEPTH).setName(DIALOGUE_NAME).setData('pages', pages.length);
  const cx = GAME_W / 2;
  const back = scene.add.rectangle(cx, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x07060a, 1).setInteractive();
  layer.add(back);
  let bg: Phaser.GameObjects.Image | null = null;
  const dim = scene.add.rectangle(cx, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x07060a, 0.66);
  // Мягкий тёплый свет сверху — страница «освещена».
  const glowKey = scene.textures.exists('skin_glow') ? 'skin_glow' : null;
  const warm = glowKey ? scene.add.image(cx, 380, glowKey).setDisplaySize(1300, 900).setTint(0xffc870).setAlpha(0.16).setBlendMode(Phaser.BlendModes.ADD) : null;
  layer.add(warm ? [dim, warm] : [dim]);

  let page = scene.add.container(0, 0);
  layer.add(page);
  let area: ScrollArea | null = null;
  let index = -1;
  let shownAt = 0;
  let closed = false;
  const lockedArea = opts.lock;
  const wasLocked = lockedArea?.locked ?? false;
  if (lockedArea) lockedArea.locked = true;

  const close = () => {
    if (closed) return;
    closed = true;
    hush();
    layer.destroy();
    onDone();
  };
  registerModal(layer, close);
  layer.once(Phaser.GameObjects.Events.DESTROY, () => {
    if (!closed) hush();
    closed = true;
    if (lockedArea) lockedArea.locked = wasLocked;
  });
  const next = () => {
    if (closed || performance.now() - shownAt < GUARD_MS) return;
    if (index + 1 < pages.length) show(index + 1);
    else close();
  };
  // «Пропустить» — тихая (ghost) в углу; главное действие — «Далее ›» внизу.
  const skip = button(scene, GAME_W - S.l - 130, 90, 260, BTN.m, '', 'Пропустить', close, T.body, { variant: 'ghost' });
  skip.container.setName('pagesSkip');
  // Счётчик страниц — точки (не текст): текущая золотая, остальные приглушённые.
  const footerY = () => view().safeBottom - 115;
  const dots = scene.add.container(cx, footerY() - 110);
  const nextBtn = button(scene, cx, footerY(), 520, BTN.cta, 'ui_btn_primary', 'Далее ›', () => next(), T.title, { sound: null });
  nextBtn.label.setFontFamily(FAMILY.heading);
  nextBtn.container.setName('pagesNext');
  layer.add([skip.container, dots, nextBtn.container]);
  back.on('pointerup', () => (area ? area.tap(next)() : next()));

  const show = (i: number, refresh = false) => {
    index = i;
    if (!refresh) shownAt = performance.now();
    const p = pages[i];
    // Фон — тема главы страницы (эпизод — «карта» главы), притемнённый.
    if (p.chapterId) {
      if (!bg) {
        bg = scene.add.image(cx, GAME_H / 2, '__DEFAULT');
        layer.addAt(bg, 1);
      }
      setThemeBackground(bg, 'map', themeOfChapter(p.chapterId));
      // Вытянутый экран (390×844): фон продолжается на поля над и под полем 9:16 (без чёрных полос).
      bleedImage(scene, bg);
      bg.setVisible(true);
      for (const o of (bg.getData('bleed') as Phaser.GameObjects.Image[] | undefined) ?? []) o.setVisible(true);
    } else {
      bg?.setVisible(false);
      for (const o of (bg?.getData('bleed') as Phaser.GameObjects.Image[] | undefined) ?? []) o.setVisible(false);
    }
    page.destroy();
    area = null;
    page = scene.add.container(0, 0);
    layer.addAt(page, layer.getIndex(skip.container));
    if (view().compact) buildScrollablePage(scene, page, p, (a) => (area = a));
    else buildPage(scene, page, p, (a) => (area = a));
    const last = i === pages.length - 1;
    nextBtn.label.setText(last ? (opts.doneLabel ?? 'Закрыть') : 'Далее ›');
    dots.removeAll(true);
    if (pages.length > 1)
      pages.forEach((_, k) => dots.add(scene.add.circle((k - (pages.length - 1) / 2) * 36, 0, k === i ? 9 : 7, k === i ? COLOR_N_ACCENT : COLOR_N_DIM, k === i ? 1 : 0.6)));
    if (!refresh) {
      page.setAlpha(0);
      scene.tweens.add({ targets: page, alpha: 1, duration: M.base });
      sfx(i === 0 ? 'ui_open' : 'ui_tab');
      if (i === 0) haptic('soft');
      // Рассказчик читает цитату и текст страницы, герой — свой комментарий к находке (что озвучено).
      void speak(p.quote, p.text, p.comment?.text);
    }
  };
  show(0);
  const off = onViewChange(scene, (next, previous) => {
    if (closed) return;
    nextBtn.container.setY(footerY());
    dots.setY(footerY() - 110);
    if (next.compact !== previous.compact) {
      const offset = area?.offset ?? 0;
      show(index, true);
      if (area) area.offset = offset;
    } else if (next.compact) area?.setBounds(170, footerY() - 120);
  });
  layer.once(Phaser.GameObjects.Events.DESTROY, off);
  return layer;
}

/** Короткий экран: весь рассказ прокручивается, заголовок не отнимает место у текста и нижней кнопки. */
function buildScrollablePage(scene: Phaser.Scene, root: Phaser.GameObjects.Container, p: StoryPage, onArea: (a: ScrollArea) => void): void {
  const cx = GAME_W / 2;
  const area = new ScrollArea(scene, 170, view().safeBottom - 235);
  area.content.setName('storyPageScroll');
  root.add(area.parts);
  let y = S.l;
  if (p.finding) {
    area.add(findingIcon(scene, cx, y + 60, 120, p.finding));
    y += 150;
  }
  const addText = (value: string, size: number, color: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}) => {
    const label = text(scene, cx, y, value, size, color, {
      wordWrap: { width: TEXT_W, useAdvancedWrap: true }, lineSpacing: BODY_LEADING, ...style,
    }).setOrigin(0.5, 0);
    area.add(label);
    y += label.height + S.s;
    return label;
  };
  addText(p.kicker.toUpperCase(), T.caption, SKIN.goldLight, { fontStyle: 'bold' }).setName('pageKicker');
  addText(p.title, T.display, C.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('pageTitle');
  if (p.subtitle) addText(p.subtitle, T.body, SKIN.cream, { fontStyle: 'italic' });
  area.add(divider(scene, cx, y));
  y += S.l;
  if (p.quote) addText(`«${p.quote}»`, T.body, C.title, { fontStyle: 'italic' });
  addText(p.text, BODY_FS, SKIN.cream, { align: 'left' }).setName('pageText');
  if (p.source) addText(`— ${p.source}`, T.caption, COLOR.textSecondary, { fontStyle: 'italic', align: 'right' });
  if (p.comment) addText(`${p.comment.speaker}: «${p.comment.text}»`, T.body, COLOR.info, { fontStyle: 'italic', align: 'left' }).setName('pageComment');
  area.setContentHeight(y + S.s);
  onArea(area);
}

/** Собрать страницу в контейнер: заголовок сверху, текст по центру свободного места. */
function buildPage(scene: Phaser.Scene, root: Phaser.GameObjects.Container, p: StoryPage, onArea: (a: ScrollArea) => void): void {
  const cx = GAME_W / 2;
  let y = 200;
  if (p.finding) {
    root.add(findingIcon(scene, cx, y + 20, 120, p.finding));
    y += 130;
  }
  const kicker = text(scene, cx, y, p.kicker.toUpperCase(), T.caption, SKIN.goldLight, { fontStyle: 'bold' }).setName('pageKicker');
  kicker.setLetterSpacing?.(6);
  kicker.setShadow(0, 2, 'rgba(0,0,0,0.85)', 4, false, true);
  root.add(kicker);
  y += 50;
  // Заголовок — заголовочная гарнитура T.display с мягкой тенью (без толстой обводки).
  const title = text(scene, cx, y, p.title, T.display, C.title, { fontFamily: FAMILY.heading, fontStyle: 'bold', wordWrap: { width: 980 }, align: 'center' }).setOrigin(0.5, 0).setName('pageTitle');
  title.setShadow(0, 4, 'rgba(0,0,0,0.85)', 10, false, true);
  root.add(title);
  y += title.height + S.xxs;
  if (p.subtitle) {
    const sub = text(scene, cx, y, p.subtitle, T.body, SKIN.cream, { fontStyle: 'italic', wordWrap: { width: 960 } }).setOrigin(0.5, 0);
    sub.setShadow(0, 2, 'rgba(0,0,0,0.85)', 4, false, true);
    root.add(sub);
    y += sub.height + S.xxs;
  }
  // Золотая черта с ромбом.
  y += 24;
  root.add(divider(scene, cx, y));
  y += 40;
  if (p.quote) {
    const q = text(scene, cx, y, `«${p.quote}»`, T.body, C.title, { fontStyle: 'italic', wordWrap: { width: 900 }, align: 'center', lineSpacing: 10 }).setOrigin(0.5, 0);
    q.setShadow(0, 2, 'rgba(0,0,0,0.85)', 4, false, true);
    root.add(q);
    y += q.height + 30;
  }

  // Текст на панели: ширина TEXT_W, по высоте — сколько есть места; не влезает — прокрутка пальцем.
  const body = text(scene, 0, 0, p.text, BODY_FS, SKIN.cream, { align: 'left', wordWrap: { width: TEXT_W, useAdvancedWrap: true }, lineSpacing: BODY_LEADING }).setOrigin(0, 0).setName('pageText');
  const extras: Phaser.GameObjects.Text[] = [];
  if (p.source) extras.push(text(scene, 0, 0, `— ${p.source}`, T.caption, COLOR.textSecondary, { fontStyle: 'italic', align: 'right', wordWrap: { width: TEXT_W } }).setOrigin(1, 0));
  if (p.comment) extras.push(text(scene, 0, 0, `${p.comment.speaker}: «${p.comment.text}»`, T.body, COLOR.info, { fontStyle: 'italic', align: 'left', wordWrap: { width: TEXT_W }, lineSpacing: 10 }).setOrigin(0, 0).setName('pageComment'));
  const GAP = 28;
  const contentH = body.height + extras.reduce((s, t) => s + GAP + t.height, 0);
  const PAD = 48;
  const top = Math.max(y, BODY_TOP_MIN - 60);
  const fullRoom = BODY_BOTTOM - top - 2 * PAD;
  // Не влезает — прокрутка: место под стрелку-подсказку ПОД панелью (не на рамке), а окно — по целым строкам
  // основного текста, чтобы нижняя строка не резалась маской пополам (BUG-159).
  const scrolls = contentH > fullRoom;
  const HINT_ROOM = 70;
  const room = scrolls ? fullRoom - HINT_ROOM : fullRoom;
  const lines = Math.max(1, body.getWrappedText().length);
  const pitch = body.height / lines;
  const viewH = scrolls ? Math.max(pitch, Math.floor(room / pitch) * pitch) : Math.min(contentH, room);
  // Панель по центру свободного места (короткий текст — не прилипает к заголовку).
  const panelH = viewH + 2 * PAD;
  const panelTop = !scrolls && contentH < room ? top + Math.min(60, (room - contentH) / 3) : top;
  const look = p.look ?? 'episode';
  const pn = plate(scene, cx, panelTop + panelH / 2, TEXT_W + 2 * PAD + 20, panelH, PAGE_SURFACE[look]);
  root.add(pn);
  if (look === 'book') {
    // Книга: вторая тонкая золотая рамка внутри.
    root.add(plate(scene, cx, panelTop + panelH / 2, TEXT_W + 2 * PAD - 10, panelH - 30, { fill: '#000000', alpha: 0, border: mixHex(COLOR.border, COLOR.accent, 0.6), borderW: 2, r: R.m }));
  }
  const left = cx - TEXT_W / 2;
  const place = (o: Phaser.GameObjects.Text, oy: number) => o.setPosition(o.originX === 1 ? left + TEXT_W : left, oy);
  let oy = 0;
  place(body, oy);
  oy += body.height;
  for (const t of extras) {
    oy += GAP;
    place(t, oy);
    oy += t.height;
  }
  const inner = panelTop + PAD;
  if (!scrolls) {
    for (const t of [body, ...extras]) {
      t.setY(t.y + inner);
      root.add(t);
    }
    return;
  }
  const a = new ScrollArea(scene, inner, inner + viewH);
  for (const t of [body, ...extras]) a.add(t);
  a.setContentHeight(contentH + 10);
  root.add(a.parts);
  // Текст длиннее окна — тихая стрелка под панелью (без слов).
  const hint = text(scene, cx, panelTop + panelH + 30, '⌄', T.title, COLOR.textTertiary).setName('pageScrollHint');
  root.add(hint);
  onArea(a);
}

/** Золотая черта, гаснущая к краям, с ромбом по центру. */
export function divider(scene: Phaser.Scene, cx: number, y: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  for (const d of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      g.fillStyle(TINT.gold, 1 - i / 14);
      g.fillRect(cx + d * (26 + i * 16) - (d < 0 ? 16 : 0), y - 2, 16, 4);
    }
  }
  g.fillStyle(TINT.gold, 1).fillPoints(
    [new Phaser.Math.Vector2(cx, y - 12), new Phaser.Math.Vector2(cx + 12, y), new Phaser.Math.Vector2(cx, y + 12), new Phaser.Math.Vector2(cx - 12, y)],
    true,
  );
  return g;
}

/**
 * Значок находки (своего арта нет — рисуем): записка — листок со строками, надпись — табличка, слух — облачко,
 * вещь — мешочек. size — ширина.
 */
export function findingIcon(scene: Phaser.Scene, x: number, y: number, size: number, kind: FindingKind): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const r = size / 2;
  const disc = scene.add.circle(0, 0, r, 0x1a140c, 0.95).setStrokeStyle(Math.max(3, size / 24), SKIN_TINT.gold);
  const g = scene.add.graphics();
  const lw = Math.max(2, size / 30);
  const gold = SKIN_TINT.gold;
  const s = size / 120;
  g.lineStyle(lw, gold, 1);
  if (kind === 'note') {
    g.fillStyle(0xe8d8b0, 1).fillRect(-26 * s, -32 * s, 52 * s, 64 * s);
    g.lineStyle(lw, 0x6b4a1a, 1);
    for (let i = 0; i < 4; i++) g.lineBetween(-18 * s, (-18 + i * 12) * s, 18 * s, (-18 + i * 12) * s);
  } else if (kind === 'inscription') {
    g.fillStyle(0x7a7468, 1).fillRoundedRect(-30 * s, -34 * s, 60 * s, 68 * s, 14 * s);
    g.lineStyle(lw, 0x2a2620, 1);
    g.lineBetween(-16 * s, -14 * s, 16 * s, -14 * s);
    g.lineBetween(-12 * s, 0, 12 * s, 0);
    g.lineBetween(-16 * s, 14 * s, 10 * s, 14 * s);
  } else if (kind === 'rumor') {
    g.fillStyle(0xe8d8b0, 1).fillEllipse(0, -6 * s, 70 * s, 48 * s);
    g.fillTriangle(-14 * s, 12 * s, -2 * s, 14 * s, -22 * s, 30 * s);
    g.fillStyle(0x6b4a1a, 1);
    for (const dx of [-16, 0, 16]) g.fillCircle(dx * s, -6 * s, 4 * s);
  } else {
    g.fillStyle(0x9a6a3a, 1).fillCircle(0, 8 * s, 28 * s);
    g.fillStyle(0x7a4f28, 1).fillRect(-12 * s, -28 * s, 24 * s, 14 * s);
    g.lineStyle(lw, gold, 1).lineBetween(-16 * s, -14 * s, 16 * s, -14 * s);
  }
  c.add([disc, g]);
  return c;
}

// ---------- готовые страницы ----------

/** Перерыв во времени, «Эпизод N» и легенда главы. */
export function introPages(p: IntroPages): StoryPage[] {
  const out: StoryPage[] = [];
  if (p.interlude) out.push(interludePage(p.chapterId, p.interlude));
  if (p.episode) out.push(episodePage(p.number, p.chapterId, p.episode));
  if (p.legend) out.push(legendPage(p.chapterId, p.legend));
  return out;
}

export const episodePage = (n: number, chapterId: string, e: EpisodeDef): StoryPage => ({
  kicker: `Эпизод ${n}`,
  title: e.title,
  ...(e.subtitle ? { subtitle: e.subtitle } : {}),
  ...(e.quote ? { quote: e.quote } : {}),
  text: e.text,
  chapterId,
  look: 'episode',
});

/** Перерыв во времени: книга рассказчика («Прошли годы»). */
export const interludePage = (chapterId: string, i: InterludeDef): StoryPage => ({
  kicker: i.kicker,
  title: i.title,
  text: i.text,
  chapterId,
  look: 'book',
});

export const legendPage = (chapterId: string, l: LegendDef): StoryPage => ({
  kicker: 'Легенда',
  title: l.title,
  text: l.text,
  ...(l.source ? { source: l.source } : {}),
  chapterId,
  look: 'scroll',
});

export const chroniclePage = (chapterId: string, n: number, c: ChapterChronicleDef, found?: { got: number; total: number }): StoryPage => ({
  kicker: `Летопись отряда · глава ${n}`,
  title: c.title,
  text: c.text,
  ...(found && found.total ? { source: `находок главы собрано: ${found.got} из ${found.total}` } : {}),
  chapterId,
  look: 'book',
});

export const findingPage = (f: FindingDef, chapterId?: string): StoryPage => ({
  kicker: `Находка · ${FINDING_KIND_NAMES[f.kind]}`,
  title: f.title,
  text: f.text,
  ...(f.comment ? { comment: f.comment } : {}),
  ...(chapterId ? { chapterId } : {}),
  finding: f.kind,
  look: 'finding',
});
