import Phaser from 'phaser';
import { FINDING_KIND_NAMES, type ChapterChronicleDef, type EpisodeDef, type FindingDef, type FindingKind, type IntroPages, type LegendDef } from '../core';
import { sfx } from './audio';
import { setThemeBackground, themeOfChapter } from './backdrops';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { SKIN, SKIN_TINT } from './skin';
import { button, panel, ScrollArea, text } from './ui';
import { C, FS, OUTLINE, TINT, TOUCH } from './theme';

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
}

/** Имя и глубина слоя — как у диалога сюжета (dialogue.ts: DIALOGUE_NAME, DEPTH). */
const DIALOGUE_NAME = 'dialogue';
const DEPTH = 9500;
/** Касание раньше этого (мс) после показа страницы не листает — хвост прошлого нажатия. */
const GUARD_MS = 350;
/** Ширина текста и его шрифт: страница во весь экран 9:16, текст крупнее основного (на 390×844 ≈ 15 px). */
const TEXT_W = 900;
const BODY_FS = 42;
const BODY_TOP_MIN = 520;
const BODY_BOTTOM = 1690;
const BTN_Y = 1805;

/** Открыта ли страница на экране (тот же слой, что у диалога). */
export const pageOpen = (scene: Phaser.Scene) => !!scene.children.getByName(DIALOGUE_NAME);

/**
 * Показать страницы по очереди; после последней (или «Пропустить») — onDone. Пустой список — onDone сразу.
 */
export function showPages(scene: Phaser.Scene, pages: readonly StoryPage[], onDone: () => void, opts: PagesOptions = {}): void {
  if (!pages.length) {
    onDone();
    return;
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

  const close = () => {
    if (closed) return;
    closed = true;
    layer.destroy();
    onDone();
  };
  const next = () => {
    if (closed || performance.now() - shownAt < GUARD_MS) return;
    if (index + 1 < pages.length) show(index + 1);
    else close();
  };
  const skip = button(scene, GAME_W - 170, 90, 280, TOUCH, 'k:buttonLong_beige', 'Пропустить', close, FS.h3);
  skip.container.setName('pagesSkip');
  const dots = text(scene, cx, BTN_Y - 110, '', FS.caption, SKIN.creamDim, OUTLINE);
  const nextBtn = button(scene, cx, BTN_Y, 520, 140, 'ui_btn_primary', 'Далее ›', () => next(), FS.h2, { sound: null });
  nextBtn.container.setName('pagesNext');
  layer.add([skip.container, dots, nextBtn.container]);
  back.on('pointerup', () => (area ? area.tap(next)() : next()));

  const show = (i: number) => {
    index = i;
    shownAt = performance.now();
    const p = pages[i];
    // Фон — тема главы страницы (эпизод — «карта» главы), притемнённый.
    if (p.chapterId) {
      if (!bg) {
        bg = scene.add.image(cx, GAME_H / 2, '__DEFAULT');
        layer.addAt(bg, 1);
      }
      setThemeBackground(bg, 'map', themeOfChapter(p.chapterId));
      bg.setVisible(true);
    } else bg?.setVisible(false);
    page.destroy();
    area = null;
    page = scene.add.container(0, 0);
    layer.addAt(page, layer.getIndex(skip.container));
    buildPage(scene, page, p, (a) => (area = a));
    const last = i === pages.length - 1;
    nextBtn.label.setText(last ? (opts.doneLabel ?? 'Закрыть') : 'Далее ›');
    dots.setText(pages.length > 1 ? pages.map((_, k) => (k === i ? '●' : '○')).join('  ') : '');
    page.setAlpha(0);
    scene.tweens.add({ targets: page, alpha: 1, duration: 260 });
    sfx(i === 0 ? 'ui_open' : 'ui_tab');
  };
  show(0);
}

/** Собрать страницу в контейнер: заголовок сверху, текст по центру свободного места. */
function buildPage(scene: Phaser.Scene, root: Phaser.GameObjects.Container, p: StoryPage, onArea: (a: ScrollArea) => void): void {
  const cx = GAME_W / 2;
  let y = 200;
  if (p.finding) {
    root.add(findingIcon(scene, cx, y + 20, 120, p.finding));
    y += 130;
  }
  const kicker = text(scene, cx, y, p.kicker.toUpperCase(), FS.h3, SKIN.goldLight, { fontStyle: 'bold', ...OUTLINE }).setName('pageKicker');
  kicker.setLetterSpacing?.(6);
  root.add(kicker);
  y += 70;
  const title = text(scene, cx, y, p.title, FS.hero + 12, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10, wordWrap: { width: 980 }, align: 'center' }).setOrigin(0.5, 0).setName('pageTitle');
  root.add(title);
  y += title.height + 10;
  if (p.subtitle) {
    const sub = text(scene, cx, y, p.subtitle, FS.h3, SKIN.cream, { fontStyle: 'italic', ...OUTLINE, wordWrap: { width: 960 } }).setOrigin(0.5, 0);
    root.add(sub);
    y += sub.height + 8;
  }
  // Золотая черта с ромбом.
  y += 24;
  root.add(divider(scene, cx, y));
  y += 40;
  if (p.quote) {
    const q = text(scene, cx, y, `«${p.quote}»`, FS.h3, C.title, { fontStyle: 'italic', ...OUTLINE, wordWrap: { width: 960 }, align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0);
    root.add(q);
    y += q.height + 30;
  }

  // Текст на панели: ширина TEXT_W, по высоте — сколько есть места; не влезает — прокрутка пальцем.
  const body = text(scene, 0, 0, p.text, BODY_FS, SKIN.cream, { align: 'left', wordWrap: { width: TEXT_W, useAdvancedWrap: true }, lineSpacing: 14 }).setOrigin(0, 0).setName('pageText');
  const extras: Phaser.GameObjects.Text[] = [];
  if (p.source) extras.push(text(scene, 0, 0, `— ${p.source}`, FS.body, SKIN.creamDim, { fontStyle: 'italic', align: 'right', wordWrap: { width: TEXT_W } }).setOrigin(1, 0));
  if (p.comment) extras.push(text(scene, 0, 0, `${p.comment.speaker}: «${p.comment.text}»`, FS.h3, C.inkInfo, { fontStyle: 'italic', align: 'left', wordWrap: { width: TEXT_W } }).setOrigin(0, 0).setName('pageComment'));
  const GAP = 28;
  const contentH = body.height + extras.reduce((s, t) => s + GAP + t.height, 0);
  const PAD = 48;
  const top = Math.max(y, BODY_TOP_MIN - 60);
  const room = BODY_BOTTOM - top - 2 * PAD;
  const viewH = Math.min(contentH, room);
  // Панель по центру свободного места (короткий текст — не прилипает к заголовку).
  const panelH = viewH + 2 * PAD;
  const panelTop = contentH < room ? top + Math.min(60, (room - contentH) / 3) : top;
  const look = p.look ?? 'episode';
  const pn = panel(scene, cx, panelTop + panelH / 2, TEXT_W + 2 * PAD + 20, panelH, look === 'scroll' ? 'ui_panel_light' : 'ui_panel');
  root.add(pn);
  if (look === 'book') {
    const frame = scene.add.rectangle(cx, panelTop + panelH / 2, TEXT_W + 2 * PAD - 10, panelH - 30).setStrokeStyle(3, SKIN_TINT.gold, 0.6);
    root.add(frame);
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
  if (contentH <= room) {
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
  const hint = text(scene, cx, inner + viewH + PAD / 2 + 4, '⇅ листайте текст', FS.caption, SKIN.creamDim, OUTLINE);
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

/** «Эпизод N» и легенда главы. */
export function introPages(p: IntroPages): StoryPage[] {
  const out: StoryPage[] = [];
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
