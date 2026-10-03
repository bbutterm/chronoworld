import Phaser from 'phaser';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W, HEADER_H } from './layout';
import { now, session, takeWarnings, today } from './session';
import { adventureBadge, campaignBadge, cityBadge } from './navBadges';
import { GAME } from './content';
import { anim, lazyPortrait, portraitKey, spriteView, whenSprites } from './sprites';
import { formatNumber, heroesNavBadge, POWER_COLORS, POWER_TINTS, type PowerCheck, type PowerTone } from './flow';
import { view } from './viewport';
import { button, ellipsize, emptyState, icon, panel, ScrollArea, shieldTaps, text, toast, type ButtonView, type Panel } from './ui';
import { hasArt } from './assets';
import { RO_ICON_TINT, roIcon } from './itemIcons';
import { C, COLOR, COLOR_N, E, FAMILY, FS, M, R, S, T, TOUCH, TOUCH_COMFORT, Z } from './theme';
import { SKIN_TINT, skinIcon, type SkinIcon } from './skin';
import { animateCurrency, heartbeat, juiceOn, type CurrencyPill } from './juice';
import { sfx } from './audio';
import { haptic } from './haptics';
import { setTgBack } from './telegram';
import { isLeaving } from './transitions';
import { BACK, BADGE, badgeLabel, compactNumber, GEAR, HEADER_CY, navTabCenter, parseGrouped, PILL, powerShortfall, titleLeft } from './frame';

/**
 * Вкладки нижней навигации (как в AFK Arena): «Кампания» — карта, сундук офлайн-наград и быстрые награды;
 * «Герои»; «Город» (сцена Home) — Таверна, Лавка, задания, достижения, события и почта в шапке;
 * «Приключения» (сцена Adventure, «Тёмный лес» AFK) — Башня, экспедиции, охота на босса.
 */
export type NavTab = 'Campaign' | 'Heroes' | 'Home' | 'Adventure';

export const TABS: readonly { scene: NavTab; label: string }[] = [
  { scene: 'Campaign', label: 'Кампания' },
  { scene: 'Heroes', label: 'Герои' },
  { scene: 'Home', label: 'Город' },
  { scene: 'Adventure', label: 'Приключения' },
];

/** Контурные иконки вкладок (skin.ts). */
const NAV_ICON: Record<NavTab, SkinIcon> = { Campaign: 'map', Heroes: 'helmet', Home: 'castle', Adventure: 'compass' };

/** Центр вкладки по x (подсказки новичку указывают на вкладку). */
export function navTabX(tab: NavTab): number {
  const i = Math.max(0, TABS.findIndex((t) => t.scene === tab));
  return navTabCenter(i, TABS.length);
}

/** Ширина вкладки (цель нажатия и подсказки). */
export const NAV_TAB_W = GAME_W / TABS.length - 14;

/** Высота нижней навигации; контент экрана — между шапкой и ней. */
export const NAV_H = 170;
export { HEADER_H };
export const CONTENT_TOP = HEADER_H + 20;
export const CONTENT_BOTTOM = GAME_H - NAV_H - 20;

/** Куда ведёт «‹» в шапке (и кнопка «назад» Telegram). */
export type BackTarget = { label?: string; to: string; data?: object };

/** Имена модальных слоёв, которые «назад» закрывает первым (как касание мимо окна). */
const MODAL_NAMES = ['confirmModal', 'noticeModal', 'bottomSheet'] as const;

/**
 * Общий каркас экрана: фон, шапка (одна полоса: «‹», название, валюта), нижняя навигация (если active задан)
 * и накопившиеся предупреждения о сохранении.
 * back — «‹» в шапке: всегда ведёт на логического родителя экрана (карточка героя → список героев, этап → его глава
 * кампании и т. д.), а не «куда-то на главную». Та же функция — у кнопки «назад» Telegram (и аппаратной «назад»
 * Android); корневые вкладки без back её прячут. back.label — подсказка для чтения с экрана, на кнопке не пишется.
 * opts.settings — шестерёнка в шапке слева от валюты (S: настройки и редкие действия главной).
 * title '' — без названия (Город: на его месте своя плашка игрока). Вкладки навигации (Кампания, Герои, Приключения)
 * держат компактное название T.title слева: без него полоса шапки пустая (итерация 10A).
 */
export function screen(
  scene: Phaser.Scene,
  title: string,
  active: NavTab | null,
  back?: BackTarget,
  opts: {
    settings?: () => void;
  } = {},
): void {
  // Фон 1080×1920 сам продолжается на поля вытянутых экранов (viewport.ts); шапка и навигация — тоже до краёв.
  scene.add.image(GAME_W / 2, GAME_H / 2, 'skin_bg_forest').setDisplaySize(GAME_W, GAME_H);
  const fullW = GAME_W + 2 * BLEED_X;
  // Шапка — одна тёмная полоса без орнамента: градиент к бронзе и тонкая кромка по низу (бронза + золотой блик).
  scene.add.image(GAME_W / 2, (HEADER_H - BLEED_Y) / 2, 'skin_header_grad').setDisplaySize(fullW, HEADER_H + BLEED_Y).setAlpha(0.97);
  edge(scene, HEADER_H, fullW, false);

  const goBack = back ? backAction(scene, back) : null;
  if (goBack) backButton(scene, goBack, back?.label);
  // Telegram BackButton = «‹» экрана; уходя с экрана, снимаем (если её ещё не занял следующий экран).
  const off = setTgBack(goBack);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);

  // Вытянутый телефон: над шапкой видна полоса поля (до ~130–200 ед.). Валюта уходит туда одной строкой — верхняя
  // полоса ресурсов AFK Arena, — названию и плашке игрока в шапке достаётся вся ширина. На 9:16 — две строки справа.
  const band = topBand();
  let currencyLeft: number;
  if (band >= BAND_MIN) {
    bandStrip(scene, band);
    currencyLabels(scene, -band / 2);
    currencyLeft = GAME_W - S.xs;
  } else currencyLeft = currencyLabels(scene);
  let titleRight = currencyLeft - S.s;
  if (opts.settings) {
    const gearHit = Math.max(GEAR.hit, TOUCH_COMFORT);
    const gx = currencyLeft - S.xs - gearHit / 2;
    const gear = iconButton(scene, gx, HEADER_CY, GEAR.size, gearHit, 'gear', opts.settings, null);
    gear.setName('settings');
    titleRight = gx - gearHit / 2 - S.xs;
  }
  const left = titleLeft(!!back);
  if (title) {
    // Название — слева, заголовочной гарнитурой; длинное сначала мельчает, потом переносится на две строки.
    const t = text(scene, left, HEADER_CY, title, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold', align: 'left' }).setOrigin(0, 0.5);
    t.setShadow(0, 3, 'rgba(0,0,0,0.75)', 6, false, true);
    t.setName('screenTitle');
    fitTitle(t, titleRight - left);
  }

  if (active) navBar(scene, active, fullW);
  const warnings = takeWarnings();
  for (const w of warnings.filter((x) => !isHeroesNotice(x))) toast(scene, w, C.error, 6000);
  const notices = warnings.filter(isHeroesNotice);
  if (notices.length) noticeModal(scene, 'Обновление героев', notices, { label: 'К героям', to: 'Heroes' });
}

/**
 * Переход «назад» экрана: один на «‹» и Telegram BackButton. Открыто окно — «назад» сначала закрывает его (как касание
 * мимо окна); экран уже уходит (затемнение transitions.ts) или не активен — второе нажатие ничего не делает.
 */
function backAction(scene: Phaser.Scene, back: BackTarget): () => void {
  return () => {
    if (!scene.sys.isActive() || isLeaving(scene)) return;
    if (closeTopModal(scene)) return;
    sfx('ui_back');
    haptic('tap');
    scene.scene.start(back.to, back.data);
  };
}

/** Закрыть верхнее модальное окно сцены (confirm, noticeModal, bottomSheet). true — было что закрыть. */
export function closeTopModal(scene: Phaser.Scene): boolean {
  const list = scene.children.list;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (!(MODAL_NAMES as readonly string[]).includes(o.name)) continue;
    const close = o.getData?.('close') as (() => void) | undefined;
    if (close) close();
    else o.destroy();
    return true;
  }
  return false;
}

/** Кромка панели (шапки — по низу, навигации — по верху): тёмная бронза и тонкий золотой блик. */
function edge(scene: Phaser.Scene, y: number, fullW: number, up: boolean): void {
  const s = up ? -1 : 1;
  scene.add.rectangle(GAME_W / 2, y + s * 2, fullW, 4, COLOR_N.border, 1);
  scene.add.rectangle(GAME_W / 2, y, fullW, 2, COLOR_N.title, 0.45);
}

/**
 * Круглая кнопка-иконка шапки («‹», шестерёнка): тёмный диск с бронзовой кромкой, золотая контурная иконка.
 * Видимый диск size, цель нажатия hit (не меньше TOUCH). Нажатие — диск темнеет и чуть сжимается (M.press/M.release).
 */
function iconButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  hit: number,
  ico: SkinIcon,
  onTap: () => void,
  sound: 'ui_tap' | null = 'ui_tap',
): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  const draw = (pressed: boolean) => {
    g.clear();
    g.fillStyle(pressed ? COLOR_N.surfaceSunken : COLOR_N.surface, 0.92).fillCircle(0, 0, size / 2);
    g.lineStyle(3, pressed ? COLOR_N.title : COLOR_N.border, 1).strokeCircle(0, 0, size / 2 - 1.5);
  };
  draw(false);
  const img = scene.add.image(0, 0, skinIcon(ico)).setDisplaySize(size * 0.6, size * 0.6).setTint(SKIN_TINT.gold);
  const box = scene.add.container(x, y, [g, img]).setSize(hit, hit);
  tappable(scene, box, hit, hit, onTap, sound, (p) => {
    draw(p);
    scene.tweens.add({ targets: box, scale: p ? 0.94 : 1, duration: p ? M.press : M.release, ease: p ? E.out : E.pop });
  });
  return box;
}

/**
 * Нажимаемая область без текстуры (кнопки шапки, вкладки навигации): «вооружается» нажатием на ней, срабатывает при
 * отпускании на ней же; повтор чаще 250 мс игнорируется; экран уже уходит — ничего не делает.
 */
function tappable(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Container,
  w: number,
  h: number,
  onTap: () => void,
  sound: 'ui_tap' | 'ui_tab' | null,
  onPress?: (pressed: boolean) => void,
): void {
  target.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(0, 0, w, h), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
  let armed = false;
  let last = 0;
  const set = (p: boolean) => {
    if (armed === p) return;
    armed = p;
    if (target.scene) onPress?.(p);
  };
  target.on('pointerdown', () => set(true));
  target.on('pointerout', () => set(false));
  target.on('pointerup', () => {
    if (!armed) return;
    set(false);
    const t = Date.now();
    if (t - last < 250 || isLeaving(scene)) return;
    last = t;
    if (sound) sfx(sound);
    haptic(sound === 'ui_tab' ? 'tab' : 'tap');
    onTap();
  });
  const release = () => set(false);
  scene.input.on('pointerup', release);
  target.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.off('pointerup', release));
}

/** «‹» в шапке: иконка-шеврон в диске (имя `backButton`; цель нажатия 120). label — для e2e/чтения, не рисуется. */
function backButton(scene: Phaser.Scene, goBack: () => void, label?: string): void {
  // Звук и вибрацию даёт сам переход (backAction) — у кнопки свои выключены, чтобы не звучало дважды.
  const b = iconButton(scene, BACK.x, HEADER_CY, BACK.size, Math.max(BACK.hit, TOUCH_COMFORT), 'back', goBack, null);
  b.setName('backButton').setData('label', label ?? 'Назад');
}

/**
 * Нижняя навигация без плиток (как в AFK Arena/Journey): крупная иконка и подпись обычным регистром; активная вкладка
 * приподнята — золотая иконка в тёплом свечении, золотая черта по верхней кромке и золотая подпись; остальные приглушены.
 * Значки — точкой у правого верхнего угла иконки (что внутри — видно на самой странице).
 */
function navBar(scene: Phaser.Scene, active: NavTab, fullW: number): void {
  const navBottom = GAME_H + navShift();
  const top = navBottom - NAV_H;
  // Панель: тот же градиент, перевёрнутый (бронза сверху), чуть плотнее шапки; кромка по верху.
  scene.add.image(GAME_W / 2, navBottom - (NAV_H - BLEED_Y) / 2, 'skin_header_grad').setDisplaySize(fullW, NAV_H + BLEED_Y).setFlipY(true).setAlpha(0.98);
  edge(scene, top, fullW, true);
  const iconY = top + 64;
  const labelY = top + 128;
  TABS.forEach((t, i) => {
    const on = t.scene === active;
    const bx = navTabCenter(i, TABS.length);
    const box = scene.add.container(bx, top + NAV_H / 2).setSize(NAV_TAB_W, NAV_H).setDepth(Z.nav).setName(`nav_${t.scene}`);
    const rel = (y: number) => y - (top + NAV_H / 2);
    if (on) {
      // Подъём активной: свечение за иконкой и золотая черта по кромке над вкладкой.
      box.add(scene.add.image(0, rel(iconY), 'skin_glow').setDisplaySize(190, 150).setTint(COLOR_N.title).setAlpha(0.42).setBlendMode(Phaser.BlendModes.ADD));
      box.add(scene.add.rectangle(0, rel(top) + 3, 132, 6, COLOR_N.accent, 1));
    }
    const size = on ? 84 : 68;
    const ico = scene.add.image(0, rel(iconY) - (on ? 8 : 0), skinIcon(NAV_ICON[t.scene])).setDisplaySize(size, size).setTint(on ? COLOR_N.title : COLOR_N.textTertiary);
    const label = text(scene, 0, rel(labelY), t.label, T.caption, on ? COLOR.title : COLOR.textTertiary, { fontStyle: on ? 'bold' : 'normal' });
    if (on) label.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
    box.add([ico, label]);
    const base = ico.scaleX;
    tappable(scene, box, NAV_TAB_W, NAV_H, () => {
      // T1-04: на подэкранах вкладки (карточка героя, инвентарь) вкладка ведёт к её корневому экрану.
      if (!on || scene.scene.key !== t.scene) scene.scene.start(t.scene);
    }, 'ui_tab', (p) => {
      scene.tweens.add({ targets: ico, scale: p ? base * 0.92 : base, duration: p ? M.press : M.release, ease: p ? E.out : E.pop });
    });
    // Значок — у правого верхнего угла иконки.
    const dx = bx + size / 2 + 2;
    const dy = iconY - size / 2 + 6 - (on ? 8 : 0);
    if (t.scene === 'Heroes') {
      // «Герои»: точка — можно вознести, улучшить или надеть вещь получше (P10, T1-08; §2.4 — на вкладке только точка).
      if (heroesNavBadge(session.save, GAME)) dot(scene, dx, dy)?.setDepth(Z.nav + 1).setName('navBadge_Heroes');
    } else {
      // Остальные вкладки — сумма значков своей страницы (navBadges.ts); на вкладке — точка (§2.4).
      const n = t.scene === 'Campaign' ? campaignBadge(session.save, now(), today()) : t.scene === 'Home' ? cityBadge(session.save, today()) : adventureBadge(session.save, now(), today());
      if (n > 0) dot(scene, dx, dy)?.setDepth(Z.nav + 1).setName(`navBadge_${t.scene}`);
    }
  });
}

/**
 * Сообщения перевода старого сохранения на героев v2 (миграция v7: новые герои и ветки, осколки → копии, подарок
 * 10 свитков) — показываются один раз окном «Обновление героев», а не красным тостом (это не ошибка).
 */
export function isHeroesNotice(w: string): boolean {
  return w.startsWith('Герои обновлены') || w.startsWith('Осколки героев стали');
}

/** Затемнение под модальным окном (e3: 0.65), во весь экран с полями. */
function shadeRect(scene: Phaser.Scene): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.65).setInteractive();
}

/**
 * Окно-сообщение: заголовок, абзацы, «Понятно» (и кнопка перехода). Возвращает слой (name `noticeModal`).
 * lead — итог крупно над абзацами (виден всегда). Длинный текст не обрезается: абзацы прокручиваются пальцем
 * и колёсиком в своей полосе (BUG-184: рассказ «Забрать всё» на 12 событий), справа — полоса прокрутки.
 */
export function noticeModal(
  scene: Phaser.Scene,
  title: string,
  paragraphs: readonly string[],
  go?: { label: string; to: string; data?: object },
  lead?: string,
): Phaser.GameObjects.Container {
  const layer = scene.add.container(0, 0).setDepth(Z.confirm + 100).setName('noticeModal');
  const shade = shadeRect(scene);
  const w = 940;
  const leadText = lead
    ? text(scene, 0, 0, lead, FS.h3, C.gold, { align: 'center', wordWrap: { width: w - 120 }, lineSpacing: 6, fontStyle: 'bold', stroke: C.stroke, strokeThickness: 3 }).setOrigin(0.5, 0)
    : null;
  const leadH = leadText ? leadText.height + 30 : 0;
  const body = text(scene, 0, 0, paragraphs.join('\n\n'), FS.body, C.text, { align: 'left', wordWrap: { width: w - 120 }, lineSpacing: 8 }).setOrigin(0.5, 0);
  const maxBody = GAME_H - 700 - leadH;
  const scroll = body.height > maxBody;
  if (scroll) body.setFontSize(FS.small);
  const bodyH = Math.min(body.height, maxBody);
  const h = Math.min(GAME_H - 300, bodyH + leadH + 360);
  const top = GAME_H / 2 - h / 2;
  const box = panel(scene, GAME_W / 2, GAME_H / 2, w, h, 'ui_panel').setInteractive();
  const head = text(scene, GAME_W / 2, top + 80, title, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
  head.setShadow(0, 3, 'rgba(0,0,0,0.7)', 6, false, true);
  layer.add([shade, box, head]);
  if (leadText) {
    leadText.setPosition(GAME_W / 2, top + 140);
    layer.add(leadText);
  }
  const bodyTop = top + 150 + leadH;
  let area: ScrollArea | null = null;
  if (scroll) {
    area = new ScrollArea(scene, bodyTop, bodyTop + bodyH);
    body.setPosition(GAME_W / 2, 0);
    area.add(body);
    area.setContentHeight(body.height + 24);
    layer.add(text(scene, GAME_W / 2, bodyTop + bodyH + 22, 'листайте ↕', FS.caption, C.muted));
  } else {
    body.setPosition(GAME_W / 2, bodyTop);
    layer.add(body);
  }
  const close = () => layer.destroy();
  layer.setData('close', close);
  const by = top + h - 100;
  const ok = button(scene, GAME_W / 2 + (go ? 210 : 0), by, 380, 120, 'ui_btn_primary', 'Понятно', close, FS.h2);
  ok.container.setName('noticeOk');
  layer.add(ok.container);
  if (go) layer.add(button(scene, GAME_W / 2 - 210, by, 380, 120, 'ui_btn_secondary', go.label, () => {
    close();
    scene.scene.start(go.to, go.data);
  }, FS.h2).container);
  popIn(scene, layer, shade);
  // Прокрутка живёт в координатах мира (маска и границы — от top): в слой — после popIn, который переносит детей в
  // контейнер с началом в центре экрана (иначе список уезжал вниз на полэкрана при первой прокрутке).
  if (area) {
    layer.add(area.parts);
    scene.tweens.add({ targets: area.content, alpha: { from: 0, to: 1 }, duration: M.base });
  }
  return layer;
}

/** Полоса над шапкой не ниже этого (ед. мира) — туда переезжает валюта. */
const BAND_MIN = 84;

/**
 * NB-21: на сколько панель навигации опущена ниже поля 1080×1920 — к низу безопасной области вытянутого экрана
 * (как в AFK Arena), чтобы под ней не оставалась пустая полоса. 0 — на 9:16.
 */
export function navShift(): number {
  return Math.max(0, Math.min(BLEED_Y, view().safeBottom - GAME_H));
}

/**
 * Низ области содержимого с учётом navShift: на вытянутых экранах (390×844) навигация опущена к низу безопасной
 * области, и прокручиваемые списки тянутся до неё, а не обрываются на CONTENT_BOTTOM с пустой полосой. На 9:16 — CONTENT_BOTTOM.
 */
export function contentBottom(): number {
  return CONTENT_BOTTOM + navShift();
}

/** Центр вкладок навигации по высоте (с учётом navShift) — для указателей подсказок на вкладки. */
export function navY(): number {
  return GAME_H - NAV_H / 2 + navShift();
}

/** Высота видимой полосы над полем на вытянутых экранах (ниже выреза), в ед. мира; 0 — полосы нет (9:16). */
export function topBand(): number {
  return Math.max(0, Math.min(BLEED_Y, -view().safeTop));
}

/** Полоса ресурсов над шапкой: чуть темнее шапки, без кромки — шапка и полоса читаются одним блоком. */
function bandStrip(scene: Phaser.Scene, band: number): void {
  const fullW = GAME_W + 2 * BLEED_X;
  scene.add.rectangle(GAME_W / 2, -band / 2, fullW, band, 0x000000, 0.28);
}

/**
 * Плашка «мощь отряда против рекомендуемой» (главная, этап): тёмная капсула с обводкой цвета тона — зелёный «сил хватает»,
 * жёлтый «чуть не хватает», красный «слабее». label — свой текст (по умолчанию «⚔ 1 224 / 1 067 · вердикт»).
 * Возвращает контейнер (data `tone`); setPowerChip — обновить на месте.
 */
export function powerChip(scene: Phaser.Scene, x: number, y: number, pc: PowerCheck, opts: { label?: string; minW?: number } = {}): Phaser.GameObjects.Container {
  const box = scene.add.container(x, y).setName('powerChip');
  const bg = scene.add.graphics();
  const ico = scene.add.image(0, 0, skinIcon('swords')).setDisplaySize(34, 34);
  const t = text(scene, 0, -1, '', FS.caption, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 });
  box.add([bg, ico, t]);
  box.setData({ bg, ico, t, minW: opts.minW ?? 0, fixed: opts.label });
  setPowerChip(box, pc, opts.label);
  return box;
}

export function setPowerChip(box: Phaser.GameObjects.Container, pc: PowerCheck, label?: string): void {
  const bg = box.getData('bg') as Phaser.GameObjects.Graphics;
  const ico = box.getData('ico') as Phaser.GameObjects.Image;
  const t = box.getData('t') as Phaser.GameObjects.Text;
  const tone: PowerTone = pc.tone;
  t.setText(label ?? (box.getData('fixed') as string | undefined) ?? `${formatNumber(pc.squad)} / ${formatNumber(pc.recommended)} · ${pc.verdict}`).setColor(POWER_COLORS[tone]);
  const h = 48;
  const w = Math.max(box.getData('minW') as number, t.width + 34 + 44);
  t.setX(22);
  ico.setPosition(22 - t.width / 2 - 26, -1).setTint(Phaser.Display.Color.HexStringToColor(POWER_COLORS[tone]).color);
  bg.clear();
  bg.fillStyle(0x0d0a07, 0.92).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  bg.lineStyle(3, POWER_TINTS[tone], 1).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  box.setData('tone', tone).setSize(w, h);
}

/**
 * Мощь отряда против нужной (Этап, Башня, Охота — правило 11, §3): иконка мечей и своя мощь; хватает — спокойная
 * зелёная галка и больше ничего, не хватает — «Не хватает N» красным. align — каким краем ряд стоит в (x, y).
 * Возвращает контейнер `powerCompare` (data `short` — сколько не хватает); updatePowerCompare — обновить на месте.
 */
export function powerCompare(
  scene: Phaser.Scene,
  x: number,
  y: number,
  own: number,
  need: number,
  opts: { align?: 'left' | 'center' | 'right' } = {},
): Phaser.GameObjects.Container {
  const box = scene.add.container(x, y).setName('powerCompare');
  const ico = scene.add.image(0, 0, skinIcon('swords')).setDisplaySize(56, 56).setTint(COLOR_N.title);
  const num = text(scene, 0, 0, '', T.heading, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  num.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
  const ok = scene.add.image(0, 0, skinIcon('check')).setDisplaySize(56, 56).setTint(COLOR_N.positive);
  const short = text(scene, 0, 0, '', T.body, COLOR.negative, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  short.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
  box.add([ico, num, ok, short]);
  box.setData({ parts: { ico, num, ok, short }, align: opts.align ?? 'left' });
  updatePowerCompare(box, own, need);
  return box;
}

export function updatePowerCompare(box: Phaser.GameObjects.Container, own: number, need: number): void {
  const { ico, num, ok, short } = box.getData('parts') as {
    ico: Phaser.GameObjects.Image;
    num: Phaser.GameObjects.Text;
    ok: Phaser.GameObjects.Image;
    short: Phaser.GameObjects.Text;
  };
  const cmp = powerShortfall(own, need);
  num.setText(formatNumber(Math.floor(own)));
  ok.setVisible(!cmp.label);
  short.setVisible(!!cmp.label).setText(cmp.label ?? '');
  // Ряд слева направо: мечи · число · (галка | «Не хватает N»).
  let cx = 28;
  ico.setX(cx);
  cx += 28 + S.xxs;
  num.setX(cx);
  cx += num.width + S.xs;
  const tail = cmp.label ? short : ok;
  tail.setX(cmp.label ? cx : cx + 28);
  const w = cx + (cmp.label ? short.width : 56);
  const align = box.getData('align') as 'left' | 'center' | 'right';
  const dx = align === 'left' ? 0 : align === 'center' ? -w / 2 : -w;
  for (const o of [ico, num, ok, short]) o.x += dx;
  box.setData('short', cmp.short).setSize(w, 56);
}

/**
 * Главная кнопка экрана (одна на экран, §3 правило 1): золото, 600×140, подпись заголовочной гарнитурой T.title.
 * opts.w/h — другой размер (не меньше 122 по высоте), opts.enabled = false — серая. Имя контейнера `cta`.
 */
export function cta(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: { w?: number; h?: number; enabled?: boolean } = {},
): ButtonView {
  const w = opts.w ?? 600;
  const h = Math.max(122, opts.h ?? 140);
  const b = button(scene, x, y, w, h, 'ui_btn_primary', label, onClick, T.title);
  b.label.setFontFamily(FAMILY.heading);
  // Длинная подпись не вылезает за кнопку: мельче до T.heading, потом многоточие.
  if (b.label.width > w - 2 * S.m) b.label.setFontSize(T.heading);
  ellipsize(b.label, w - 2 * S.m);
  b.container.setName('cta');
  if (opts.enabled === false) b.setEnabled(false);
  return b;
}

/** Лист снизу: что получает build — контейнер содержимого (0,0 — его левый верх), ширина и закрытие. */
export interface BottomSheet {
  layer: Phaser.GameObjects.Container;
  content: Phaser.GameObjects.Container;
  close: () => void;
}

/**
 * Лист снизу (подробности, «i», фильтры): затемнение 0.65, поверхность от нижнего края безопасной области, ручка,
 * заголовок слева и «×» справа; въезжает снизу (y + 120 → 0 за M.base), уходит быстрее (M.fast). Касание мимо листа,
 * «×» и «назад» (Telegram) закрывают его. build строит содержимое в контейнере шириной width и возвращает его высоту;
 * выше 80 % экрана — содержимое прокручивается. Слой — `bottomSheet` (Z.modal).
 */
export function bottomSheet(
  scene: Phaser.Scene,
  title: string,
  build: (content: Phaser.GameObjects.Container, width: number, close: () => void) => number,
  opts: { onClose?: () => void } = {},
): BottomSheet {
  const fullW = GAME_W + 2 * BLEED_X;
  const width = GAME_W - 2 * S.l;
  const bottom = GAME_H + navShift();
  const layer = scene.add.container(0, 0).setDepth(Z.modal).setName('bottomSheet');
  const shade = shadeRect(scene);
  const sheet = scene.add.container(0, 0);
  const content = scene.add.container(S.l, 0);
  let closed = false;
  let area: ScrollArea | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    layer.setName('');
    shade.disableInteractive();
    sfx('ui_back');
    const done = () => {
      layer.destroy();
      opts.onClose?.();
    };
    if (!juiceOn()) return done();
    scene.tweens.add({ targets: shade, alpha: 0, duration: M.fast, ease: E.in });
    scene.tweens.add({ targets: [sheet, ...(area ? [area.content] : [])], y: '+=120', alpha: 0, duration: M.fast, ease: E.in, onComplete: done });
  };
  layer.setData('close', close);
  const contentH = Math.max(0, build(content, width, close));
  const headH = 136;
  const maxH = Math.round(GAME_H * 0.8);
  const h = Math.min(maxH, headH + contentH + S.xl);
  const top = bottom - h;
  // Поверхность: скруглённые верхние углы, бронзовая кромка сверху, тянется за края поля и под нижний край.
  const bg = scene.add.graphics();
  bg.fillStyle(COLOR_N.surface, 0.98).fillRoundedRect(GAME_W / 2 - fullW / 2, top, fullW, h + BLEED_Y, { tl: R.xl, tr: R.xl, bl: 0, br: 0 });
  bg.lineStyle(3, COLOR_N.border, 1).strokeRoundedRect(GAME_W / 2 - fullW / 2, top, fullW, h + BLEED_Y, { tl: R.xl, tr: R.xl, bl: 0, br: 0 });
  bg.setInteractive(new Phaser.Geom.Rectangle(GAME_W / 2 - fullW / 2, top, fullW, h + BLEED_Y), Phaser.Geom.Rectangle.Contains);
  const grip = scene.add.rectangle(GAME_W / 2, top + S.s, 96, 8, COLOR_N.textTertiary, 0.8);
  const head = text(scene, S.l, top + 80, title, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold', align: 'left' }).setOrigin(0, 0.5);
  ellipsize(head, width - TOUCH - S.s);
  const x = closeButton(scene, GAME_W - S.l - 36, top + 80, close);
  sheet.add([bg, grip, head, x]);
  const contentTop = top + headH;
  if (headH + contentH + S.xl > maxH) {
    area = new ScrollArea(scene, contentTop, bottom - S.m);
    content.setPosition(S.l, 0);
    area.add(content);
    area.setContentHeight(contentH + S.m);
  } else {
    content.setY(contentTop);
    sheet.add(content);
  }
  layer.add([shade, sheet]);
  if (area) layer.add(area.parts);
  shade.on('pointerup', close);
  sfx('ui_open');
  const game = scene.sys.game;
  layer.once(Phaser.GameObjects.Events.DESTROY, () => shieldTaps(game));
  if (juiceOn()) {
    scene.tweens.add({ targets: shade, alpha: { from: 0, to: 1 }, duration: M.base, ease: E.out });
    for (const o of [sheet, ...(area ? [area.content] : [])]) {
      const y0 = o.y;
      o.setY(y0 + 120).setAlpha(0);
      scene.tweens.add({ targets: o, y: y0, alpha: 1, duration: M.base, ease: E.out });
    }
  }
  return { layer, content, close };
}

/** «×» листа снизу: тёмный диск с крестом (цель нажатия TOUCH). */
function closeButton(scene: Phaser.Scene, x: number, y: number, onTap: () => void): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  const draw = (p: boolean) => {
    g.clear();
    g.fillStyle(p ? COLOR_N.surfaceSunken : COLOR_N.surfaceRaised, 1).fillCircle(0, 0, 32);
    g.lineStyle(5, COLOR_N.textSecondary, 1);
    g.lineBetween(-11, -11, 11, 11).lineBetween(-11, 11, 11, -11);
  };
  draw(false);
  const box = scene.add.container(x, y, [g]).setSize(TOUCH_COMFORT, TOUCH_COMFORT).setName('sheetClose');
  tappable(scene, box, TOUCH_COMFORT, TOUCH_COMFORT, onTap, null, draw);
  return box;
}

/** Название экрана в ширину maxW: T.title, если влезает; иначе мельче (до T.body), потом две строки, потом «…». */
function fitTitle(t: Phaser.GameObjects.Text, maxW: number): void {
  for (const size of [T.title, T.heading, T.body]) {
    t.setFontSize(size);
    if (t.width <= maxW) return;
  }
  const full = t.text;
  t.setWordWrapWidth(maxW).setLineSpacing(-4);
  if (t.height <= HEADER_H - 16 && t.width <= maxW) return;
  t.setWordWrapWidth(null);
  t.setText(full);
  ellipsize(t, maxW);
}

/**
 * Валюта: «таблетки» иконка + число (коротко: 874K, 8.7M — frame.ts compactNumber; точное — по нажатию, тостом).
 * С rowY — одной строкой в полосе над шапкой (гемы у края, золото левее); без — друг под другом в правом углу шапки.
 * Ширина «таблетки» постоянная (по «88 888») — число не прыгает, когда счётчик juice.ts отсчитывает награду.
 * Каждая — контейнер `pill_gold`/`pill_gems` с центром в середине (подпрыгивает целиком) и одним Text. Возвращает левый край.
 */
function currencyLabels(scene: Phaser.Scene, rowY?: number): number {
  const right = GAME_W - S.xs;
  const pills: CurrencyPill[] = [];
  const row = (xRight: number, y: number, kind: CurrencyPill['kind'], value: number): number => {
    const gem = kind === 'gems';
    const t = text(scene, 0, 0, '88 888', T.body, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    const numW = t.width;
    // Счётчик награды (juice.ts countUp) и экраны (HeroScene) пишут полное число — «таблетка» сокращает его сама.
    const setText = t.setText.bind(t);
    t.setText = (v: string | string[]) => {
      const s = Array.isArray(v) ? v.join('\n') : String(v);
      const n = parseGrouped(s);
      return setText(n === null ? s : compactNumber(n));
    };
    t.setText(compactNumber(value));
    t.setShadow(0, 2, 'rgba(0,0,0,0.9)', 2, false, true);
    const w = S.xxs + PILL.icon + S.xxs + numW + S.s;
    const cx = xRight - w / 2;
    const ix = -w / 2 + S.xxs + PILL.icon / 2 - 4;
    t.setPosition(w / 2 - S.s + 4, 0);
    const bg = scene.add.graphics();
    bg.fillStyle(0x0b0907, 0.82).fillRoundedRect(-w / 2, -PILL.h / 2, w, PILL.h, PILL.h / 2);
    bg.lineStyle(2, COLOR_N.border, 1).strokeRoundedRect(-w / 2, -PILL.h / 2, w, PILL.h, PILL.h / 2);
    const art = gem ? 'ui_icon_gem' : 'ui_icon_gold';
    // Иконки RO (мешочек золота, алмаз) — целым масштабом, пиксели без сглаживания; нет — прежний арт.
    const ro = roIcon(scene, gem ? 'gems' : 'gold');
    const ico = ro
      ? scene.add.image(ix, 0, ro).setScale(gem ? 3 : 2).setTint(gem ? RO_ICON_TINT.gems : 0xffffff)
      : hasArt(art) ? scene.add.image(ix, 0, art).setDisplaySize(PILL.icon - 8, PILL.icon - 8) : gem ? gemIcon(scene, ix, 0, 34) : icon(scene, ix, 0, 'iconCircle_beige', 36).setTint(gem ? 0x6fd8ff : 0xffc83a);
    const halo = scene.add.image(ix, 0, 'skin_glow').setDisplaySize(72, 72).setTint(gem ? 0x6fd8ff : 0xffc83a).setAlpha(0.25).setBlendMode(Phaser.BlendModes.ADD);
    const box = scene.add.container(cx, y, [bg, halo, ico, t]).setName(`pill_${kind}`);
    // Точное число — по нажатию (сокращённое не всегда хватает для решения «хватит ли на покупку»).
    // В двух строках цели ограничены межстрочным шагом, иначе золото и гемы перехватывают тапы друг друга.
    const hitH = rowY === undefined ? PILL.h + 8 : Math.max(PILL.h, TOUCH);
    box.setSize(w, hitH);
    tappable(scene, box, w, hitH, () => {
      const v = gem ? session.save.currency.gems : session.save.resources.gold;
      toast(scene, `${gem ? 'Гемы' : 'Золото'}: ${formatNumber(v)}`, gem ? C.gem : C.gold, 2000);
    }, null);
    pills.push({ kind, value, text: t, box, icon: { x: cx + ix, y } });
    return xRight - w;
  };
  let left: number;
  if (rowY !== undefined) {
    const gemsLeft = row(right, rowY, 'gems', session.save.currency.gems);
    left = row(gemsLeft - PILL.gap, rowY, 'gold', session.save.resources.gold);
  } else {
    left = Math.min(row(right, HEADER_CY - PILL.h / 2 - 4, 'gold', session.save.resources.gold), row(right, HEADER_CY + PILL.h / 2 + 4, 'gems', session.save.currency.gems));
  }
  animateCurrency(scene, pills);
  return left;
}


/** Шестерёнка (своей иконки в атласе нет): зубцы, диск и отверстие. size — внешний диаметр. */
export function gearIcon(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const r = size / 2;
  const ink = Phaser.Display.Color.HexStringToColor(C.ink).color;
  g.fillStyle(ink, 1);
  const teeth = 8;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const pts = [
      [-r * 0.17, -r * 0.62],
      [r * 0.17, -r * 0.62],
      [r * 0.14, -r],
      [-r * 0.14, -r],
    ].map(([px, py]) => new Phaser.Math.Vector2(px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)));
    g.fillPoints(pts, true);
  }
  g.fillCircle(0, 0, r * 0.72);
  g.fillStyle(0xe8d4a8, 1);
  g.fillCircle(0, 0, r * 0.3);
  return g;
}

/**
 * Гем: иконка RO «1carat Diamond» (камень ≈ 13 пикселей в поле 24×24 — масштаб целый, чтобы камень был ростом ≈ size),
 * без неё — ромб.
 */
export function gemIcon(scene: Phaser.Scene, x: number, y: number, size: number): Phaser.GameObjects.Polygon | Phaser.GameObjects.Image {
  const ro = roIcon(scene, 'gems');
  if (ro) return scene.add.image(x, y, ro).setScale(Math.max(1, Math.round(size / 13))).setTint(RO_ICON_TINT.gems);
  const h = size / 2;
  return scene.add.polygon(x, y, [h * 0.8, 0, h * 1.6, h * 0.8, h * 0.8, h * 2, 0, h * 0.8], 0x6fd8ff).setStrokeStyle(3, 0x1d4a66);
}

/**
 * Красный значок с числом (готово к получению, есть что сделать). count ≤ 0 — ничего. Больше 99 — «99+».
 * Один вид везде (плитки, кнопки, иконки шапки): «таблетка» высотой 44 (шире — по числу), тонкая тёмная кромка,
 * мягкое «сердцебиение» (juice.ts). Место — через cornerBadge (правый верхний угол цели), чтобы значки стояли одинаково.
 */
export function badge(scene: Phaser.Scene, x: number, y: number, count: number): Phaser.GameObjects.Container | null {
  const label = badgeLabel(count);
  if (!label) return null;
  const h = BADGE.num;
  const t = text(scene, 0, -1, label, FS.caption, '#ffffff', { fontStyle: 'bold' });
  const w = Math.max(h, t.width + 18);
  const g = scene.add.graphics();
  g.fillStyle(COLOR_N.badge, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  g.lineStyle(3, 0x2a0c06, 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  const box = scene.add.container(x, y, [g, t]).setDepth(50).setName('badge').setSize(w, h);
  heartbeat(scene, box);
  return box;
}

/** Красная точка без числа (24 ед.): «внутри есть что сделать» — вкладки навигации, плитки. */
export function dot(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Container {
  const r = BADGE.dot / 2;
  const c = scene.add.circle(0, 0, r, COLOR_N.badge).setStrokeStyle(3, 0x2a0c06, 0.9);
  const box = scene.add.container(x, y, [c]).setDepth(50).setName('badge').setSize(BADGE.dot, BADGE.dot);
  heartbeat(scene, box);
  return box;
}

/** Значок в правом верхнем углу прямоугольника (центр cx, cy; размер w×h): на 18 внутрь от правого края, на 14 — от верхнего. */
export function cornerBadge(scene: Phaser.Scene, cx: number, cy: number, w: number, h: number, count: number): Phaser.GameObjects.Container | null {
  return badge(scene, cx + w / 2 - 18, cy - h / 2 + 14, count);
}

/** Карточка-панель с рамкой из атласа. */
export function card(scene: Phaser.Scene, x: number, y: number, w: number, h: number, light = false): Panel {
  return panel(scene, x, y, w, h, light ? 'ui_panel_light' : 'ui_panel');
}

const CONFIRM_NAME = 'confirmModal';

/** Открыто ли на сцене подтверждение confirm() — экран не должен перезапускаться у игрока «из-под пальца». */
export function confirmOpen(scene: Phaser.Scene): boolean {
  return !!scene.children.getByName(CONFIRM_NAME);
}

/**
 * Модальное подтверждение: затемнение, вопрос, «Да» / «Отмена».
 * opts.danger — разрушительное действие (сброс, удаление): оно красное и справа, а золотая основная кнопка —
 * безопасная «Отмена» (T3-23: не сбросить прогресс «на автомате»). Касание мимо окна и «назад» — «Отмена».
 */
export function confirm(scene: Phaser.Scene, question: string, yes: string, onYes: () => void, opts: { danger?: boolean } = {}): void {
  const layer = scene.add.container(0, 0).setDepth(Z.confirm).setName(CONFIRM_NAME);
  const shade = shadeRect(scene);
  const q = text(scene, GAME_W / 2, 0, question, FS.h2, C.text, { wordWrap: { width: 780 }, lineSpacing: 8 });
  // Высота окна — по тексту вопроса: без пустого провала между вопросом и кнопками.
  const boxH = Math.max(400, q.height + 330);
  const top = GAME_H / 2 - boxH / 2;
  const box = panel(scene, GAME_W / 2, GAME_H / 2, 900, boxH, 'ui_panel');
  q.setY(top + 90 + q.height / 2);
  const btnY = top + boxH - 110;
  const cancel = () => popOut(scene, layer);
  const doIt = () => {
    layer.destroy();
    onYes();
  };
  const danger = !!opts.danger;
  const ok = button(scene, GAME_W / 2 + (danger ? 210 : -210), btnY, 380, 120, danger ? DANGER_BTN : 'ui_btn_primary', yes, doIt);
  const no = button(scene, GAME_W / 2 + (danger ? -210 : 210), btnY, 380, 120, danger ? 'ui_btn_primary' : 'ui_btn_secondary', 'Отмена', cancel);
  // Окно само ловит касания, чтобы не закрываться от нажатия по нему.
  box.setInteractive();
  shade.on('pointerup', cancel);
  layer.setData('close', cancel);
  layer.add([shade, box, q, ok.container, no.container]);
  popIn(scene, layer, shade);
}

/** Красная кнопка опасного действия (текстура скина, buildSkin). */
export const DANGER_BTN = 'skin_btn_danger';

/**
 * Появление модального окна (e3, §4.6): затемнение 0 → 0.65 и окно scale 0.92 → 1 с проявлением, оба за M.base,
 * окно — E.pop. Масштаб — от центра экрана.
 */
export function popIn(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, shade?: Phaser.GameObjects.GameObject): void {
  sfx('ui_open');
  // MT-02: окно закрылось (или его экран ушёл) — короткий щит от второго быстрого тапа.
  const game = scene.sys.game;
  layer.once(Phaser.GameObjects.Events.DESTROY, () => shieldTaps(game));
  const rest = layer.list.filter((o) => o !== shade) as unknown as (Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha)[];
  if (shade) scene.tweens.add({ targets: shade, alpha: { from: 0, to: 1 }, duration: M.base, ease: E.out });
  // Масштаб контейнера — от центра экрана: сдвигаем начало координат в центр.
  const inner = scene.add.container(GAME_W / 2, GAME_H / 2).setName('popInner');
  for (const o of rest) {
    layer.remove(o as unknown as Phaser.GameObjects.GameObject);
    o.setPosition(o.x - GAME_W / 2, o.y - GAME_H / 2);
    inner.add(o as unknown as Phaser.GameObjects.GameObject);
  }
  layer.add(inner);
  inner.setScale(0.92).setAlpha(0);
  scene.tweens.add({ targets: inner, scale: 1, alpha: 1, duration: M.base, ease: E.pop });
}

/**
 * Закрытие окна, открытого popIn: ввод сразу выключен (второе касание не попадёт в окно), окно и затемнение гаснут
 * за M.fast (E.in), затем слой уничтожается. Без анимаций (juiceOn) — сразу.
 */
export function popOut(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, onDone?: () => void): void {
  if (!layer.scene || layer.getData('closing')) return;
  layer.setData('closing', true).setName('');
  const all = (o: Phaser.GameObjects.GameObject): Phaser.GameObjects.GameObject[] =>
    o instanceof Phaser.GameObjects.Container ? [o, ...o.list.flatMap(all)] : [o];
  for (const o of all(layer)) if (o.input) o.disableInteractive();
  const done = () => {
    if (layer.scene) layer.destroy();
    onDone?.();
  };
  if (!juiceOn()) return done();
  sfx('ui_back');
  const inner = layer.getByName('popInner');
  const others = layer.list.filter((o) => o !== inner);
  if (others.length) scene.tweens.add({ targets: others, alpha: 0, duration: M.fast, ease: E.in });
  scene.tweens.add({ targets: inner ?? layer, scale: 0.96, alpha: 0, duration: M.fast, ease: E.in, onComplete: done });
}

/**
 * Портрет, вписанный в квадрат size (портреты бывают неквадратными). U: портрета ещё нет (лист не загружался) —
 * сначала нейтральный силуэт, настоящий подставится, когда будет вырезан из листа.
 */
export function portrait(scene: Phaser.Scene, x: number, y: number, key: string, size: number): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, key);
  const fit = () => img.setScale(size / Math.max(img.width, img.height, 1));
  lazyPortrait(scene, key, img, fit);
  return fit();
}

/** Цвет перекраски юнита (visual.tint) для setTint; нет — белый (без перекраски). */
export function unitTint(visual: { tint?: string } | undefined): number {
  return visual?.tint ? Phaser.Display.Color.HexStringToColor(visual.tint).color : 0xffffff;
}

/**
 * Фигура героя/юнита в стойке (анимация idle), ноги в (x, feetY), высота фигуры не больше height.
 * Лист грузится по требованию; пока его нет (или арта нет вовсе) — портрет. onReady получает готовый объект.
 */
export function unitFigure(
  scene: Phaser.Scene,
  id: string,
  x: number,
  feetY: number,
  height: number,
  opts: { maxScale?: number; onReady?: (o: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) => void } = {},
): void {
  const onReady = opts.onReady;
  whenSprites(scene, [id], () => {
    if (!scene.sys.displayList) return;
    const view = spriteView(scene, id);
    if (!view.art) {
      onReady?.(portrait(scene, x, feetY - height / 2, portraitKey(id), height));
      return;
    }
    const spr = scene.add.sprite(x, feetY, view.key, 0).setOrigin(view.originX, view.originY);
    // Пиксель-арт: по умолчанию не растягиваем (как в бою), крупный показ — до maxScale.
    spr.setScale(Math.min(opts.maxScale ?? 1, height / Math.max(1, view.height)) * (view.size / spr.frame.realHeight));
    const idle = anim(view, id, 'idle');
    if (idle) spr.play({ key: idle, repeat: -1 });
    onReady?.(spr);
  });
}

/**
 * Пустой список: карточка с иконкой, подсказкой «что сделать» и (если есть) кнопкой этого действия —
 * у игрока всегда есть очевидный следующий шаг, а не голый текст поверх фона.
 */
export function emptyCard(
  scene: Phaser.Scene,
  y: number,
  message: string,
  iconName: SkinIcon,
  cta?: { label: string; onClick: () => void },
): void {
  const msg = emptyState(scene, GAME_W / 2, 0, message, 880);
  const h = 120 + msg.height + 60 + (cta ? 150 : 0);
  const top = y - h / 2;
  card(scene, GAME_W / 2, y, 1000, h);
  scene.children.bringToTop(msg);
  scene.add.image(GAME_W / 2, top + 80, skinIcon(iconName)).setDisplaySize(80, 80).setTint(SKIN_TINT.gold).setAlpha(0.9);
  msg.setY(top + 140 + msg.height / 2);
  if (cta) button(scene, GAME_W / 2, top + h - 95, 560, 120, 'ui_btn_primary', cta.label, cta.onClick, FS.h2);
}
