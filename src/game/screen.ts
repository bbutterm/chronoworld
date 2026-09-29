import Phaser from 'phaser';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W, HEADER_H } from './layout';
import { now, session, takeWarnings, today } from './session';
import { adventureBadge, campaignBadge, cityBadge } from './navBadges';
import { GAME } from './content';
import { anim, lazyPortrait, portraitKey, spriteView, whenSprites } from './sprites';
import { campLevel, formatNumber, heroesNavBadge, heroSprite, leadHero, POWER_COLORS, POWER_TINTS, type PowerCheck, type PowerTone } from './flow';
import { framedPortrait } from './portraitFrame';
import { view } from './viewport';
import { heroGender } from '../core';
import { button, ellipsize, emptyState, icon, panel, shieldTaps, text, toast } from './ui';
import { hasArt } from './assets';
import { RO_ICON_TINT, roIcon } from './itemIcons';
import { C, FS, SP, TINT } from './theme';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from './skin';
import { animateCurrency, heartbeat, type CurrencyPill } from './juice';
import { sfx } from './audio';
import { testerButtons } from './tester';

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
  return (GAME_W / TABS.length) * (i + 0.5);
}

/** Ширина плитки вкладки (цель подсказки). */
export const NAV_TAB_W = GAME_W / TABS.length - 14;

/** Высота нижней навигации; контент экрана — между шапкой и ней. */
export const NAV_H = 170;
export { HEADER_H };
export const CONTENT_TOP = HEADER_H + 20;
export const CONTENT_BOTTOM = GAME_H - NAV_H - 20;

/**
 * Общий каркас экрана: фон, шапка с названием и золотом, нижняя навигация (если active задан)
 * и накопившиеся предупреждения о сохранении.
 * back — кнопка «‹ Назад» в шапке: всегда ведёт на логического родителя экрана (карточка героя → список героев,
 * этап → его глава кампании и т. д.), а не «куда-то на главную».
 * opts.settings — шестерёнка в шапке слева от валюты (S: настройки и редкие действия главной).
 */
export function screen(
  scene: Phaser.Scene,
  title: string,
  active: NavTab | null,
  back?: { label?: string; to: string; data?: object },
  opts: {
    settings?: () => void;
    /** Главная: вместо названия — плашка игрока (аватар-лидер отряда, уровень лагеря, полоска опыта); title — её имя. */
    player?: boolean;
  } = {},
): void {
  // Фон 1080×1920 сам продолжается на поля вытянутых экранов (viewport.ts); шапка и навигация — тоже до краёв.
  scene.add.image(GAME_W / 2, GAME_H / 2, 'skin_bg_forest').setDisplaySize(GAME_W, GAME_H);
  const fullW = GAME_W + 2 * BLEED_X;
  // Шапка в несколько слоёв (как в AFK Arena): тёмный градиент к бронзе, золотая кромка и орнамент по центру.
  scene.add.image(GAME_W / 2, (HEADER_H - BLEED_Y) / 2, 'skin_header_grad').setDisplaySize(fullW, HEADER_H + BLEED_Y).setAlpha(0.97);
  scene.add.image(GAME_W / 2, HEADER_H + 1, 'skin_trim').setDisplaySize(fullW, 12);
  scene.add.image(GAME_W / 2, HEADER_H + 4, 'skin_ornament').setDisplaySize(180, 36);
  if (back) button(scene, 110, HEADER_H / 2, 180, 100, 'k:buttonLong_beige', back.label ?? '‹ Назад', () => scene.scene.start(back.to, back.data), FS.h3, { sound: 'ui_back' });
  // Вытянутый телефон: над шапкой видна полоса поля (до ~130–200 ед.). Валюта уходит туда одной строкой, как верхняя
  // полоса ресурсов AFK Arena, — названию и плашке игрока в шапке достаётся вся ширина. На 9:16 полосы нет — всё как было.
  const band = topBand();
  let currencyLeft: number;
  if (band >= BAND_MIN) {
    bandStrip(scene, band);
    currencyLabels(scene, -band / 2);
    currencyLeft = GAME_W - 50 + SP.m;
  } else currencyLeft = currencyLabels(scene);
  let titleRight = currencyLeft - SP.m;
  if (opts.settings) {
    const gx = currencyLeft - SP.m - GEAR_SIZE / 2;
    const gear = button(scene, gx, HEADER_H / 2, GEAR_SIZE, GEAR_SIZE, 'k:buttonSquare_beige', '', opts.settings, FS.h2, { sound: null });
    gear.container.add(scene.add.image(0, 0, skinIcon('gear')).setDisplaySize(56, 56).setTint(SKIN_TINT.gold)).setName('settings');
    titleRight = gx - GEAR_SIZE / 2 - SP.m;
  }
  // T3-08: название — между «‹ Назад» и валютой; длинное сначала мельчает, потом переносится на две строки.
  const titleLeft = back ? 200 + SP.m : 50;
  if (opts.player) playerPlate(scene, title, titleLeft - 20, titleRight);
  else {
    const t = text(scene, back ? (titleLeft + titleRight) / 2 : titleLeft, HEADER_H / 2, title, FS.h1, SKIN.goldLight, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(back ? 0.5 : 0, 0.5);
    t.setShadow(0, 4, 'rgba(0,0,0,0.7)', 4, true, true);
    t.setName('screenTitle');
    fitTitle(t, titleRight - titleLeft);
  }

  if (active) {
    // Панель навигации: тот же градиент, перевёрнутый (бронза сверху), и золотая кромка по верху.
    const navBottom = GAME_H + navShift();
    scene.add.image(GAME_W / 2, navBottom - (NAV_H - BLEED_Y) / 2, 'skin_header_grad').setDisplaySize(fullW, NAV_H + BLEED_Y).setFlipY(true).setAlpha(0.96);
    scene.add.image(GAME_W / 2, navBottom - NAV_H - 1, 'skin_trim').setDisplaySize(fullW, 12).setFlipY(true);
    const w = GAME_W / TABS.length;
    TABS.forEach((t, i) => {
      const on = t.scene === active;
      const bx = w * (i + 0.5);
      const by = navBottom - NAV_H / 2;
      // Плитка вкладки как в референсе: контурная иконка и подпись капсом под ней; активная — золотая рамка.
      const btn = button(scene, bx, by, NAV_TAB_W, NAV_H - 30, on ? 'skin_tab_active' : 'skin_tab', t.label.toUpperCase(), () => {
        // T1-04: на подэкранах вкладки (карточка героя, инвентарь) вкладка ведёт к её корневому экрану.
        if (!on || scene.scene.key !== t.scene) scene.scene.start(t.scene);
      }, FS.caption, { sound: 'ui_tab' });
      btn.label.setY(34).setColor(on ? SKIN.goldLight : SKIN.creamDim);
      // Активная вкладка: тёплое свечение за иконкой, иконка крупнее.
      if (on) btn.container.add(scene.add.image(0, -18, 'skin_glow').setDisplaySize(150, 110).setTint(0xf0cf8a).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD));
      btn.container.add(scene.add.image(0, -18, skinIcon(NAV_ICON[t.scene])).setDisplaySize(on ? 66 : 58, on ? 66 : 58).setTint(on ? SKIN_TINT.gold : SKIN_TINT.creamDim));
      btn.container.bringToTop(btn.label);
      // Значок «Герои»: число — можно вознести или надеть вещь получше (P10, T1-08); иначе зелёная стрелка —
      // кто-то из отряда может «Улучшить» за опыт из запаса.
      if (t.scene === 'Heroes') {
        const b = heroesNavBadge(session.save, GAME);
        if (b?.kind === 'count') cornerBadge(scene, bx, by, NAV_TAB_W, NAV_H - 30, b.count);
        else if (b?.kind === 'levelUp') levelUpBadge(scene, bx + NAV_TAB_W / 2 - 22, by - (NAV_H - 30) / 2 + 16);
      } else {
        // Остальные вкладки — сумма значков своей страницы (navBadges.ts).
        const n = t.scene === 'Campaign' ? campaignBadge(session.save, now(), today()) : t.scene === 'Home' ? cityBadge(session.save, today()) : adventureBadge(session.save, now(), today());
        cornerBadge(scene, bx, by, NAV_TAB_W, NAV_H - 30, n)?.setName(`navBadge_${t.scene}`);
      }
    });
  }
  testerButtons(scene, band, BAND_MIN);
  const warnings = takeWarnings();
  for (const w of warnings.filter((x) => !isHeroesNotice(x))) toast(scene, w, C.error, 6000);
  const notices = warnings.filter(isHeroesNotice);
  if (notices.length) noticeModal(scene, 'Обновление героев', notices, { label: 'К героям', to: 'Heroes' });
}

/**
 * Сообщения перевода старого сохранения на героев v2 (миграция v7: новые герои и ветки, осколки → копии, подарок
 * 10 свитков) — показываются один раз окном «Обновление героев», а не красным тостом (это не ошибка).
 */
export function isHeroesNotice(w: string): boolean {
  return w.startsWith('Герои обновлены') || w.startsWith('Осколки героев стали');
}

/** Окно-сообщение: заголовок, абзацы, «Понятно» (и кнопка перехода). Возвращает слой (name `noticeModal`). */
export function noticeModal(scene: Phaser.Scene, title: string, paragraphs: readonly string[], go?: { label: string; to: string; data?: object }): Phaser.GameObjects.Container {
  const layer = scene.add.container(0, 0).setDepth(9100).setName('noticeModal');
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.75).setInteractive();
  const w = 940;
  const body = text(scene, 0, 0, paragraphs.join('\n\n'), FS.body, C.text, { align: 'left', wordWrap: { width: w - 120 }, lineSpacing: 8, stroke: C.stroke, strokeThickness: 4 }).setOrigin(0.5, 0);
  const maxBody = GAME_H - 700;
  if (body.height > maxBody) body.setFontSize(FS.small).setMaxLines(Math.floor(maxBody / 40));
  const h = Math.min(GAME_H - 300, body.height + 360);
  const top = GAME_H / 2 - h / 2;
  const box = panel(scene, GAME_W / 2, GAME_H / 2, w, h, 'ui_panel').setInteractive();
  const head = text(scene, GAME_W / 2, top + 80, title, FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 8 });
  body.setPosition(GAME_W / 2, top + 150);
  const close = () => layer.destroy();
  const by = top + h - 100;
  const ok = button(scene, GAME_W / 2 + (go ? 210 : 0), by, 380, 120, 'ui_btn_primary', 'Понятно', close, FS.h2);
  ok.container.setName('noticeOk');
  layer.add([shade, box, head, body, ok.container]);
  if (go) layer.add(button(scene, GAME_W / 2 - 210, by, 380, 120, 'ui_btn_secondary', go.label, () => {
    close();
    scene.scene.start(go.to, go.data);
  }, FS.h2).container);
  popIn(scene, layer, shade);
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

/** Полоса над шапкой: тонкая золотая кромка по низу отделяет строку ресурсов от шапки. */
function bandStrip(scene: Phaser.Scene, band: number): void {
  const fullW = GAME_W + 2 * BLEED_X;
  scene.add.rectangle(GAME_W / 2, -band / 2, fullW, band, 0x000000, 0.35);
  scene.add.image(GAME_W / 2, -2, 'skin_trim').setDisplaySize(fullW, 8).setAlpha(0.6);
}

/**
 * Плашка игрока в шапке главной (как в AFK Arena): лидер отряда в рамке, уровень лагеря на медальоне у портрета,
 * имя лагеря и полоска опыта до следующего уровня (flow.ts campLevel). Места — от left до right.
 */
function playerPlate(scene: Phaser.Scene, name: string, left: number, right: number): void {
  const save = session.save;
  const lead = leadHero(save);
  const cy = HEADER_H / 2;
  const size = 124;
  const ax = left + size / 2;
  scene.add.image(ax, cy, 'skin_glow').setDisplaySize(size * 1.5, size * 1.5).setTint(0xf0cf8a).setAlpha(0.18).setBlendMode(Phaser.BlendModes.ADD);
  framedPortrait(scene, ax, cy - 2, lead ? heroSprite(lead, GAME) : null, size, lead ? heroGender(lead, GAME) : undefined).setName('playerAvatar');
  const lv = campLevel(save);
  // Уровень — на медальоне в правом нижнем углу портрета.
  const mx = ax + size / 2 - 12;
  const my = cy + size / 2 - 16;
  scene.add.circle(mx, my, 27, 0x120d08).setStrokeStyle(4, SKIN_TINT.gold);
  text(scene, mx, my - 1, String(lv.level), lv.level >= 100 ? FS.caption - 8 : FS.caption, SKIN.goldLight, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setName('campLevel');
  const tx = ax + size / 2 + 26;
  const w = Math.max(160, Math.min(330, right - tx));
  const nm = text(scene, tx, cy - 38, name, FS.h3, SKIN.goldLight, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
  nm.setShadow(0, 3, 'rgba(0,0,0,0.7)', 3, true, true);
  ellipsize(nm, w + 60);
  text(scene, tx, cy + 4, `Уровень лагеря ${lv.level}`, FS.caption, SKIN.cream, { stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5);
  // Полоска опыта лагеря: утопленный жёлоб, золотая заливка с бликом.
  const by = cy + 42;
  const bh = 18;
  const frac = Phaser.Math.Clamp(lv.exp / lv.need, 0, 1);
  scene.add.rectangle(tx + w / 2, by, w + 6, bh + 6, 0x000000, 0.9).setStrokeStyle(2, SKIN_TINT.bronze);
  if (frac > 0) {
    scene.add.rectangle(tx, by, w * frac, bh, 0xd9a54c).setOrigin(0, 0.5);
    scene.add.rectangle(tx, by - bh / 4, w * frac, bh / 3, 0xfff0b0, 0.55).setOrigin(0, 0.5);
  }
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

/** Зелёная стрелка «можно улучшить» (вкладка «Герои»): тот же вид, что метка canLevel на плитке карточки. */
function levelUpBadge(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Container {
  const disc = scene.add.circle(0, 0, 26, 0x1f6a28).setStrokeStyle(4, 0xb6f0a0);
  const g = scene.add.graphics();
  g.fillStyle(0xd8ffd0, 1).fillTriangle(0, -15, 13, 2, -13, 2);
  g.fillRect(-6, 1, 12, 13);
  const box = scene.add.container(x, y, [disc, g]).setDepth(50).setName('levelUpBadge');
  heartbeat(scene, box);
  return box;
}

/** Название экрана в ширину maxW: крупно, если влезает; иначе мельче (до FS.h3), потом две строки, потом «…». */
function fitTitle(t: Phaser.GameObjects.Text, maxW: number): void {
  for (const size of [FS.h1, FS.h2, FS.h3]) {
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

/** Размер кнопки-шестерёнки в шапке (цель нажатия — не меньше TOUCH). */
const GEAR_SIZE = 100;

/**
 * Золото и гемы в правом углу шапки — друг под другом, чтобы не наезжать на заголовок. Возвращает левый край.
 * Каждая «таблетка» — контейнер с центром в её середине: подпрыгивает целиком, когда валюта меняется (juice.ts).
 */
function currencyLabels(scene: Phaser.Scene, rowY?: number): number {
  let x = GAME_W - 50;
  const pills: CurrencyPill[] = [];
  // Валюта — «таблетка» из скина: иконка и число, как монеты в референсе.
  const row = (y: number, kind: CurrencyPill['kind'], value: number, color: string, tint: number) => {
    const gem = kind === 'gems';
    const t = text(scene, 0, 0, formatNumber(value), FS.h3, color, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    const ix = x - 18 - t.width - 34;
    const pillW = x - ix + 34 + 6;
    const cx = x - pillW / 2 + 6;
    const art = gem ? 'ui_icon_gem' : 'ui_icon_gold';
    // Иконки RO (мешочек золота, алмаз) — ×2, пиксели без сглаживания; нет — прежний арт.
    const ro = roIcon(scene, gem ? 'gems' : 'gold');
    const ico = ro
      ? scene.add.image(ix - cx, 0, ro).setScale(gem ? 3 : 2).setTint(gem ? RO_ICON_TINT.gems : 0xffffff)
      : hasArt(art) ? scene.add.image(ix - cx, 0, art).setDisplaySize(46, 46) : gem ? gemIcon(scene, ix - cx, 0, 34) : icon(scene, ix - cx, 0, 'iconCircle_beige', 36).setTint(tint);
    t.setPosition(x - 18 - cx, 0);
    // Утопленное поле с бронзовой кромкой; иконка — в тёплом ореоле у левого края.
    const halo = scene.add.image(ix - cx, 0, 'skin_glow').setDisplaySize(70, 70).setTint(gem ? 0x6fd8ff : 0xffc83a).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD);
    t.setShadow(0, 2, 'rgba(0,0,0,0.9)', 2, true, true);
    const box = scene.add.container(cx, y, [panel(scene, 0, 0, pillW, 64, 'skin_pill'), halo, ico, t]).setName(`pill_${kind}`);
    pills.push({ kind, value, text: t, box, icon: { x: ix, y } });
    return x - pillW + 6 - 10;
  };
  let left: number;
  if (rowY !== undefined) {
    // Одной строкой в полосе над шапкой: гемы у края, золото левее.
    x = row(rowY, 'gems', session.save.currency.gems, C.gem, 0x6fd8ff) - SP.s;
    left = row(rowY, 'gold', session.save.resources.gold, C.gold, 0xffc83a);
  } else {
    left = Math.min(
      row(HEADER_H / 2 - 30, 'gold', session.save.resources.gold, C.gold, 0xffc83a),
      row(HEADER_H / 2 + 32, 'gems', session.save.currency.gems, C.gem, 0x6fd8ff),
    );
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
 * Красный кружок с числом (готово к получению, есть что сделать). count ≤ 0 — ничего. Больше 99 — «99+».
 * Один вид везде (навигация, плитки, кнопки): радиус 28, белая обводка, мягкое «сердцебиение» (juice.ts).
 * Место — через cornerBadge (правый верхний угол цели), чтобы значки стояли одинаково.
 */
export function badge(scene: Phaser.Scene, x: number, y: number, count: number): Phaser.GameObjects.Container | null {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  const c = scene.add.circle(0, 0, 28, TINT.badge).setStrokeStyle(4, 0xffffff);
  const t = text(scene, 0, -1, label, label.length > 2 ? FS.caption - 6 : FS.body, C.text, { fontStyle: 'bold' });
  const box = scene.add.container(x, y, [c, t]).setDepth(50).setName('badge');
  heartbeat(scene, box);
  return box;
}

/** Значок в правом верхнем углу прямоугольника (центр cx, cy; размер w×h): на 22 внутрь от правого края, на 16 — от верхнего. */
export function cornerBadge(scene: Phaser.Scene, cx: number, cy: number, w: number, h: number, count: number): Phaser.GameObjects.Container | null {
  return badge(scene, cx + w / 2 - 22, cy - h / 2 + 16, count);
}

/** Карточка-панель с рамкой из атласа. */
export function card(scene: Phaser.Scene, x: number, y: number, w: number, h: number, light = false): Phaser.GameObjects.NineSlice {
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
 * безопасная «Отмена» (T3-23: не сбросить прогресс «на автомате»).
 */
export function confirm(scene: Phaser.Scene, question: string, yes: string, onYes: () => void, opts: { danger?: boolean } = {}): void {
  const layer = scene.add.container(0, 0).setDepth(9000).setName(CONFIRM_NAME);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
  const q = text(scene, GAME_W / 2, 0, question, FS.h2, C.text, { wordWrap: { width: 780 }, lineSpacing: 8 });
  // Высота окна — по тексту вопроса: без пустого провала между вопросом и кнопками.
  const boxH = Math.max(400, q.height + 330);
  const top = GAME_H / 2 - boxH / 2;
  const box = panel(scene, GAME_W / 2, GAME_H / 2, 900, boxH, 'ui_panel');
  q.setY(top + 90 + q.height / 2);
  const btnY = top + boxH - 110;
  const close = () => layer.destroy();
  const doIt = () => {
    close();
    onYes();
  };
  const danger = !!opts.danger;
  const ok = button(scene, GAME_W / 2 + (danger ? 210 : -210), btnY, 380, 120, danger ? DANGER_BTN : 'ui_btn_primary', yes, doIt);
  const cancel = button(scene, GAME_W / 2 + (danger ? -210 : 210), btnY, 380, 120, danger ? 'ui_btn_primary' : 'k:buttonLong_beige', 'Отмена', close);
  // Касание мимо окна — «Отмена» (окно само касания ловит, чтобы не закрываться от нажатия по нему).
  box.setInteractive();
  shade.on('pointerup', close);
  layer.add([shade, box, q, ok.container, cancel.container]);
  popIn(scene, layer, shade);
}

/** Красная кнопка опасного действия (текстура скина, buildSkin). */
export const DANGER_BTN = 'skin_btn_danger';

/** Появление модального окна: затемнение проявляется, окно чуть «вырастает» из центра экрана. */
export function popIn(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, shade?: Phaser.GameObjects.GameObject): void {
  sfx('ui_open');
  // MT-02: окно закрылось (или его экран ушёл) — короткий щит от второго быстрого тапа.
  const game = scene.sys.game;
  layer.once(Phaser.GameObjects.Events.DESTROY, () => shieldTaps(game));
  const rest = layer.list.filter((o) => o !== shade) as unknown as (Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha)[];
  if (shade) scene.tweens.add({ targets: shade, alpha: { from: 0, to: 1 }, duration: 140 });
  // Масштаб контейнера — от центра экрана: сдвигаем начало координат в центр.
  const inner = scene.add.container(GAME_W / 2, GAME_H / 2);
  for (const o of rest) {
    layer.remove(o as unknown as Phaser.GameObjects.GameObject);
    o.setPosition(o.x - GAME_W / 2, o.y - GAME_H / 2);
    inner.add(o as unknown as Phaser.GameObjects.GameObject);
  }
  layer.add(inner);
  inner.setScale(0.92).setAlpha(0);
  scene.tweens.add({ targets: inner, scale: 1, alpha: 1, duration: 160, ease: 'Back.easeOut' });
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
    spr.setScale(Math.min(opts.maxScale ?? 1, height / Math.max(1, view.height)) * (view.size / spr.frame.height));
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
