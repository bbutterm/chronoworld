import Phaser from 'phaser';
import { hasArt } from '../assets';
import { HINT_TEXT, hintDone, hintShown, markHint, markHintShown, pickHomeHint, type HintId } from '../hints';
import { overlapArea, type Rect } from '../hintLayout';
import { homeHintInput } from '../tutorial';
import { actClaimOffline, actUseFastRewards, episodePageId, fastRewardsLoot, fastRewardsPreview, fastRewardsStatus, markPageSeen, offlineLoot, pendingIntro, pendingScenes, stageStatus, type Pantry } from '../../core';
import { introPages, showPages } from '../storyPage';
import { CONTENT, GAME } from '../content';
import { playScenes } from '../dialogue';
import { isChapterFinale, seenChapterScenes } from '../storyView';
import { openStoryHistory, startChapterDone } from './ChapterDoneScene';
import { currentStage, describeEvents, formatNumber, powerCheck, stageNo, wallAdvice } from '../flow';
import { chapterTitle } from '../chapterTitle';
import { powerShortfall } from '../frame';
import { heroCard } from '../../core';
import { heroSprite } from '../flow';
import { campaignLayout, campaignPages } from '../runtimeUiLayout';
import { GAME_W } from '../layout';
import { confirm, confirmOpen, CONTENT_TOP, contentBottom, unitFigure, cta, dot, gemIcon, NAV_H, NAV_TAB_W, navTabX, navY, screen } from '../screen';
import { commit, now, restartOnNewDay, session, today } from '../session';
import { BTN, button, chip, clampLines, ellipsize, mixHex, plate, pressable, ScrollArea, SURFACE, text, toast, tutorialHint, type ButtonView } from '../ui';
import { C, COLOR, COLOR_N, E, M, R, S, T, TOUCH } from '../theme';
import { SKIN_TINT, skinIcon } from '../skin';
import { screenBackground, setThemeBackground, themeOfChapter } from '../backdrops';
import { glow, slowRays } from '../decor';
import { afterRewardFly, decorTween, juiceOn, queueRewardFly } from '../juice';
import { isUnlocked, lockedToast, showUnlockBanners, UNLOCK_BANNER_NAME } from '../unlockBanner';
import { ChestCardView, lootLines, lootSummary, type ChestState } from '../chestView';
import { campaignObjective, chestArt, nodeLabeled } from '../campaignView';
import { rewardIcon } from '../rewardsView';
import { touchToday } from '../homeEvents';
import { minimumFontSize, onViewChange } from '../viewport';
import { floatFood, foodLine } from '../kitchenEntry';

/** Узел этапа на тропе (босс — ×1.25). */
const NODE = 120;

/** Карта главы → настоящий отряд → бой и быстрые награды → накопленная добыча.
 * Нижние действия привязаны к безопасной области над общей навигацией.
 */
const mapPages = campaignPages;

/**
 * Половина высоты подписи этапа (одна строка названия на «таблетке») вокруг y узла: касание краем кружка
 * обычного соседа (шаг тропы ≈ 94) допустимо, заход под крупный кружок босса — нет.
 */
const LABEL_HALF_H = 30;
/** Высота «таблетки» подписи. */
const LABEL_H = 64;

/**
 * Сколько места у подписи узла i по горизонтали: от lx в сторону подписи до ближайшего соседнего узла тропы,
 * который по высоте попадает в полосу подписи (LT-09: «Кают-компания мертвецов» уходила под соседний кружок).
 */
export function labelRoom(pos: readonly { x: number; y: number }[], stages: readonly { boss?: boolean }[], i: number, lx: number, right: boolean, max: number): number {
  let room = max;
  for (const j of [i - 1, i + 1]) {
    const p = pos[j];
    if (!p) continue;
    const r = (stages[j]?.boss ? NODE * 1.25 : NODE) / 2;
    if (Math.abs(p.y - pos[i].y) >= r + LABEL_HALF_H) continue;
    const d = (right ? p.x - r - lx : lx - (p.x + r)) - 10;
    // Узел позади начала подписи — не мешает; впереди — подпись кончается перед ним.
    if ((right ? p.x + r : p.x - r) * (right ? 1 : -1) <= lx * (right ? 1 : -1)) continue;
    room = Math.min(room, Math.max(60, d));
  }
  return room;
}

/** Кампания: этапы главы снизу вверх, как тропа (закрыт / открыт / пройден / босс), сундук и «В бой». */
export class CampaignScene extends Phaser.Scene {
  private get layout() { return campaignLayout(contentBottom(), this.mapStageCount, this.compactLayout); }

  private compactLayout = false;
  private mapStageCount = 5;
  private mapArea?: ScrollArea;
  private mapHeader: Phaser.GameObjects.GameObject[] = [];
  private mapPage = 0;
  private footer: Phaser.GameObjects.GameObject[] = [];
  private footerBottom = 0;

  private chapterIndex = 0;
  private chestView?: ChestCardView;
  private chestImg?: Phaser.GameObjects.Image;
  private chestRays?: Phaser.GameObjects.Image;
  private chestGlow?: Phaser.GameObjects.Image;
  private claimBtn?: ButtonView;
  /** Подпись карточки сундука «Добыча за время отдыха» (уступает место плашке подсказки — fitChestToHint). */
  private chestCaption?: Phaser.GameObjects.Text;
  /** Сундук полон — один раз за показ экрана включаем мягкий пульс сундука. */
  private chestPulsing = false;
  /** R: показанная подсказка (одна за раз) и её указатель. */
  private hintId: HintId | null = null;
  private hintView: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Campaign');
  }

  create(data: { chapter?: number; page?: number }): void {
    this.hintId = null;
    this.hintView = null;
    this.chestPulsing = false;
    this.compactLayout = campaignLayout(contentBottom()).compact;
    this.mapArea = undefined;
    this.mapHeader = [];
    this.mapStageCount = 5;
    this.footer = [];
    // Сцена-синглтон живёт всю игру: после выхода не держать её уничтоженные объекты (npm run perf — «dead»).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hintView = null;
      this.chestImg = this.chestRays = this.chestGlow = undefined;
      this.chestView = undefined;
      this.chestCaption = undefined;
      this.claimBtn = undefined;
      this.mapArea = undefined;
      this.mapHeader = [];
      this.footer = [];
    });
    restartOnNewDay(this);
    // Засчитать сегодняшний вход и доставить письма до навигации — её значок «Город» их учитывает.
    touchToday();
    const chapters = CONTENT.chapters;
    const cur = currentStage(session.save, GAME);
    const ci = Phaser.Math.Clamp(data?.chapter ?? Math.max(0, chapters.findIndex((c) => c.id === cur?.chapter)), 0, chapters.length - 1);
    this.chapterIndex = ci;
    const chapter = chapters[ci];
    screen(this, 'Кампания', 'Campaign');
    this.quietNav();
    if (!chapter) {
      text(this, GAME_W / 2, 600, 'В data/campaign нет глав', T.heading);
      return;
    }
    // Фон карты — по теме главы (луг, топь, склеп).
    const bg = screenBackground(this);
    if (bg) setThemeBackground(bg, 'map', themeOfChapter(chapter.id));

    // Область нужна и на полном экране: Telegram может прислать безопасные отступы позже.
    // При достаточной высоте карта и отряд помещаются в неё без прокрутки.
    this.mapArea = new ScrollArea(this, this.layout.bodyTop, this.layout.bodyBottom);
    this.mapArea.content.setName('campaignMapScroll');
    this.drawMap(data?.page);
    const footerBefore = new Set(this.children.list);
    const footerTop = this.layout.bodyBottom + 12;
    this.add.rectangle(GAME_W / 2, (footerTop + contentBottom()) / 2, GAME_W, contentBottom() - footerTop, COLOR_N.surface);
    this.fastRewards();
    this.fightCta();
    this.chest();
    this.footer = this.children.list.filter((o) => !footerBefore.has(o));
    this.footerBottom = contentBottom();
    onViewChange(this, () => {
      const bottom = contentBottom();
      const offset = this.mapArea?.offset ?? 0;
      const wasCompact = this.compactLayout;
      this.compactLayout = campaignLayout(bottom).compact;
      this.drawMap(this.mapPage);
      if (wasCompact && this.compactLayout && this.mapArea) this.mapArea.offset = offset;
      const dy = bottom - this.footerBottom;
      for (const o of this.footer) if (o.scene && 'y' in o) (o as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform).y += dy;
      this.footerBottom = bottom;
      this.quietNav();
      this.hintView?.destroy();
      this.hintView = null;
      this.hintId = null;
    });

    this.refresh();
    // Сундук считаем раз в секунду, а не каждый кадр.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refresh() });

    // Сюжет: вступление главы — при первом входе на её карту (пока первый этап не пройден). P11: сначала — сцены
    // из очереди (финал, прерванный перезагрузкой); если среди них финал главы — после него «Глава пройдена» (T1-03).
    // NB-02: «Глава пройдена» — раньше вступления следующей главы: сцены после финала (вступление главы 2) ждут,
    // пока игрок не уйдёт с экрана итогов, — тогда карта откроется снова и покажет их.
    const all = pendingScenes(session.save, { type: 'chapterStart', chapter: chapter.id }, GAME);
    const fi = all.findIndex((s) => isChapterFinale(s, GAME));
    const finale = fi >= 0 ? all[fi] : undefined;
    const scenes = finale ? all.slice(0, fi + 1) : session.save.pendingChapterDone ? [] : all;
    const afterScenes = () => {
      // Экран «Глава пройдена» ждёт показа (перезагрузка на нём или на финале) — показать сейчас.
      const done = finale?.chapter ?? session.save.pendingChapterDone;
      if (done && GAME.content.chapters.some((c) => c.id === done)) startChapterDone(this, { chapterId: done });
      // Открылась функция (в том числе за этапы, пройденные в авто-режиме) — баннер «Новая функция!».
      else showUnlockBanners(this);
    };
    // «Эпизод N» и легенда главы (lore-route §5.1–5.2) — один раз, при первом входе: после сцен из очереди и до
    // вступления главы (chapterStart).
    const intro = finale || session.save.pendingChapterDone ? undefined : pendingIntro(session.save, chapter.id, GAME);
    const isStart = (sc: (typeof scenes)[number]) => sc.trigger === 'chapterStart' && sc.chapter === chapter.id;
    playScenes(this, scenes.filter((sc) => !isStart(sc)), () => {
      const rest = () => playScenes(this, scenes.filter(isStart), afterScenes);
      if (!intro) return rest();
      showPages(this, introPages(intro), () => {
        commit(markPageSeen(session.save, episodePageId(chapter.id)));
        rest();
      }, { doneLabel: 'В путь' });
    });
  }

  // ---------- карта главы ----------

  /** Перестроить карту при раскрытии окна, сохранив участок и текущий сюжетный диалог. */
  private drawMap(page?: number): void {
    for (const o of this.mapHeader) if (o.scene) o.destroy();
    this.mapArea?.clear();
    const before = new Set(this.children.list);
    const chapter = CONTENT.chapters[this.chapterIndex];
    this.map(chapter.id, this.chapterIndex, CONTENT.chapters.length, page);
    this.mapHeader = this.children.list.filter((o) => !before.has(o));
    this.intoMapFlow(() => this.squadStrip());
    this.mapArea?.setBounds(this.layout.bodyTop, this.layout.bodyBottom);
    this.mapArea?.setContentHeight(this.layout.bodyHeight);
  }

  private map(chapterId: string, ci: number, count: number, pageArg?: number): void {
    const chapter = CONTENT.chapters[ci];
    // Название главы — на ленте (между стрелками глав); стрелки — квадратные иконки-кнопки.
    plate(this, GAME_W / 2, CONTENT_TOP + 80, GAME_W, 180, { fill: COLOR.surface, alpha: 0.94, borderW: 0, r: 0 });
    // Номер главы — строкой ниже («Глава 6 · 0 / 18»): в заголовке только имя, без «Глава 6.» (не обрезается).
    ellipsize(text(this, GAME_W / 2, CONTENT_TOP + 40, chapterTitle(chapter.name), T.title, COLOR.textPrimary).setName('chapterTitle'), 760);
    const arrow = (x: number, ico: 'back' | 'next', to: number, name: string) => {
      const b = button(this, x, CONTENT_TOP + 40, TOUCH, TOUCH, '', '', () => this.scene.restart({ chapter: to }), T.body, { variant: 'icon' });
      b.container.add(this.add.image(0, 0, skinIcon(ico)).setDisplaySize(52, 52).setTint(COLOR_N.title)).setName(name);
    };
    if (ci > 0) arrow(70, 'back', ci - 1, 'chapterPrev');
    if (ci < count - 1) arrow(GAME_W - 70, 'next', ci + 1, 'chapterNext');

    // Длинная глава (18 этапов) — участками по ≤ 5 узлов: иначе узлы тропы налезают друг на друга.
    // Участок по умолчанию — с текущим этапом (пройдена вся глава — последний); кнопка с диапазоном этапов — соседний.
    const all = CONTENT.stages.filter((s) => s.chapter === chapterId);
    const pages = mapPages(all.length);
    const cur = all.findIndex((s) => stageStatus(session.save, s.id, GAME) === 'open');
    const pageOf = (i: number) => pages.findIndex((p) => i >= p.from && i < p.to);
    const auto = cur >= 0 ? pageOf(cur) : all.every((s) => stageStatus(session.save, s.id, GAME) === 'cleared') ? pages.length - 1 : 0;
    const page = Phaser.Math.Clamp(pageArg ?? auto, 0, pages.length - 1);
    this.mapPage = page;
    const stages = all.slice(pages[page].from, pages[page].to);
    this.mapStageCount = stages.length;
    const paged = pages.length > 1;
    const cleared = all.filter((s) => stageStatus(session.save, s.id, GAME) === 'cleared').length;
    text(this, GAME_W / 2, CONTENT_TOP + 108, `Глава ${ci + 1} · ${cleared} / ${all.length}`, T.caption, COLOR.textSecondary).setName('chapterProgress');
    const toPage = (p: number, up: boolean, y: number, name: string) => {
      const pg = pages[p];
      const w = 220;
      const x = this.compactLayout && !up ? 40 + w / 2 : GAME_W - 40 - w / 2;
      const b = button(this, x, y, w, this.compactLayout ? 132 : BTN.m, '', `${pg.from + 1}–${pg.to}`, () => this.scene.restart({ chapter: ci, page: p }), T.body, { variant: 'secondary' });
      b.label.setX(22);
      b.container.add(this.add.image(22 - b.label.width / 2 - 30, 0, skinIcon('next')).setDisplaySize(36, 36).setAngle(up ? -90 : 90).setTint(COLOR_N.title));
      b.container.setName(name);
    };
    if (page < pages.length - 1) toPage(page + 1, true, CONTENT_TOP + (this.compactLayout ? 134 : 150), 'mapPageUp');
    if (page > 0) toPage(page - 1, false, CONTENT_TOP + (this.compactLayout ? 134 : page < pages.length - 1 ? 150 + BTN.m + S.xs : 150), 'mapPageDown');
    // Участком — ниже кнопок участков и «Истории» (верхний узел не под ними).
    const before = new Set(this.children.list);
    const top = paged && !this.compactLayout ? this.layout.mapTop + 40 : this.layout.mapTop;
    const objective = campaignObjective(chapterId, session.save.campaign.cleared);
    const bottom = this.layout.mapBottom;
    if (objective) {
      const goal = text(this, GAME_W / 2, this.layout.objectiveY, objective, T.caption, COLOR.title, { fontStyle: 'bold' }).setName('campaignObjective');
      goal.setShadow(0, 2, 'rgba(0,0,0,0.9)', 4, false, true);
      ellipsize(goal, GAME_W - 2 * S.l);
    }
    const step = stages.length > 1 ? (bottom - top) / (stages.length - 1) : 0;
    // Тропа змейкой снизу вверх (как в референсе владельца), подпись — с той стороны, где больше места.
    const pos = stages.map((_, i) => ({ x: GAME_W / 2 + Math.sin(i * 1.05 + 0.4) * 250, y: this.compactLayout ? top + step * i : bottom - step * i }));

    if (pos.length > 1) {
      const curve = new Phaser.Curves.Spline(pos.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
      const pts = curve.getSpacedPoints(pos.length * 16);
      this.add.graphics().lineStyle(8, 0xe8b85a, 0.45).strokePoints(pts);
    }

    // Кружки значков (галка/замок) и кольца боссов — одной Graphics на все узлы (меньше объектов сцены).
    const rings = this.add.graphics();
    const icons: [number, number, 'check' | 'lock', number][] = [];
    const labels: (() => void)[] = [];

    stages.forEach((s, i) => {
      const st = stageStatus(session.save, s.id, GAME);
      const { x, y } = pos[i];
      const size = s.boss ? NODE * 1.25 : NODE;
      const key = st === 'open' ? 'skin_node_open' : st === 'cleared' ? 'skin_node_cleared' : s.boss ? 'skin_node_boss' : 'skin_node_locked';
      // Текущий этап — тёплый ореол (неподвижный: «дышит» только кольцо, и один раз).
      if (st === 'open') glow(this, x, y, size * 2.1, 0xffc860, 0.5);
      const node = this.add.image(x, y, key).setDisplaySize(size, size);
      const no = stageNo(s, GAME);
      const fs = s.boss ? (no.length > 3 ? T.body : T.heading) : no.length > 3 ? T.caption : T.body;
      const num = text(this, x, y - 2, no, fs, st === 'locked' ? COLOR.textTertiary : COLOR.textPrimary, { fontStyle: 'bold' });
      num.setShadow(0, 2, 'rgba(0,0,0,0.9)', 3, false, true);
      const open = () => (st === 'locked' ? this.shake([node, num]) : this.toStage(s.id));
      pressable(this, node, size, size, open);
      // Босс — кольцо цвета опасности в любом состоянии: узел крупнее и читается издалека.
      if (s.boss) rings.lineStyle(5, COLOR_N.negative, st === 'locked' ? 0.55 : 0.9).strokeCircle(x, y, size * 0.54);
      // Значок в углу: замок (закрыт), галка (пройден) — тихо, без подписей.
      if (st !== 'open') {
        const bx = x + size * 0.36;
        const by = y + size * 0.34;
        rings.fillStyle(COLOR_N.bg, 1).fillCircle(bx, by, 19);
        rings.lineStyle(3, SKIN_TINT.bronze, 1).strokeCircle(bx, by, 19);
        icons.push([bx, by, st === 'locked' ? 'lock' : 'check', st === 'locked' ? SKIN_TINT.gold : COLOR_N.positive]);
      }
      if (st === 'open') this.currentRing(x, y, size);
      if (nodeLabeled(st, !!s.boss)) labels.push(() => this.nodeLabel(pos, stages, i, s.name, st === 'open' ? COLOR.title : COLOR.negative, !!s.boss, step, open));
    });
    this.children.bringToTop(rings);
    for (const [bx, by, ico, tint] of icons) this.add.image(bx, by, skinIcon(ico)).setDisplaySize(24, 24).setTint(tint);
    // Подписи — поверх всех узлов и колец.
    for (const draw of labels) draw();

    // Живой фон карты: несколько искр поднимаются над тропой.


    // «История» (P3): пересмотр увиденных сцен главы. Слева вверху, под стрелкой глав: там нет узлов и подписей этапов.
    if (seenChapterScenes(session.save, chapterId, GAME).length) {
      button(this, 40 + 110, this.compactLayout ? this.layout.objectiveY + 100 : CONTENT_TOP + 150, 220, this.compactLayout ? 132 : BTN.m, '', 'История', () => openStoryHistory(this, chapterId), T.body, { variant: 'secondary' }).container.setName('historyBtn');
    }
    this.moveIntoMapFlow(before);
    if (this.mapArea && cur >= pages[page].from && cur < pages[page].to) {
      this.mapArea.setContentHeight(this.layout.bodyHeight);
      this.mapArea.offset = Math.max(0, pos[cur - pages[page].from].y - this.layout.bodyTop - (this.layout.bodyBottom - this.layout.bodyTop) / 2);
    }
  }

  private intoMapFlow(draw: () => void): void {
    const before = new Set(this.children.list);
    draw();
    this.moveIntoMapFlow(before);
  }

  private moveIntoMapFlow(before: Set<Phaser.GameObjects.GameObject>): void {
    if (!this.mapArea) return;
    const items = this.children.list.filter((o) => !before.has(o));
    for (const o of items) if ('y' in o) (o as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform).y -= this.layout.bodyTop;
    this.mapArea.content.add(items);
  }

  /** Текущий этап: золотое кольцо вокруг узла, один пульс при входе (дальше спокойно — не мельтешит). */
  private currentRing(x: number, y: number, size: number): void {
    const g = this.add.graphics({ x, y });
    g.lineStyle(6, COLOR_N.accent, 0.95).strokeCircle(0, 0, size * 0.56);
    if (juiceOn()) this.tweens.add({ targets: g, scale: 1.16, alpha: 0.3, yoyo: true, repeat: 1, delay: M.base, duration: M.emphasis, ease: E.inOut });
  }

  /**
   * Подпись узла: одно название на тёмной «таблетке», сбоку от узла, обычно в сторону центра экрана.
   * LT-09 / MT-16: длинное название не заходит на соседний узел — если в сторону центра мешает узел, подпись встаёт
   * с внешней стороны; не влезает нигде — шрифт мельче и «…». Касание подписи — как касание узла.
   */
  private nodeLabel(pos: readonly { x: number; y: number }[], stages: readonly { boss?: boolean }[], i: number, title: string, color: string, boss: boolean, step: number, open: () => void): void {
    const { x, y } = pos[i];
    const size = boss ? NODE * 1.25 : NODE;
    const name = text(this, 0, y, title, T.body, color, { fontStyle: 'bold' });
    const lxOf = (r: boolean) => (r ? x + size * 0.6 : x - size * 0.6);
    const maxOf = (r: boolean) => (r ? GAME_W - 20 - lxOf(r) : lxOf(r) - 20);
    const roomOf = (r: boolean) => labelRoom(pos, stages, i, lxOf(r), r, maxOf(r) - 2 * S.xs);
    const inner = x < GAME_W / 2;
    const fits = (r: boolean) => roomOf(r) >= (name.width * T.caption) / T.body;
    const right = fits(inner) ? inner : fits(!inner) ? !inner : roomOf(inner) >= roomOf(!inner) ? inner : !inner;
    const lx = lxOf(right) + (right ? S.xs : -S.xs);
    const room = roomOf(right);
    name.setX(lx).setOrigin(right ? 0 : 1, 0.5);
    if (name.width > room) name.setFontSize(Math.max(T.caption, minimumFontSize()));
    ellipsize(name, room);
    const pw = name.displayWidth + 2 * S.xs + 8;
    const px = right ? lx - S.xs + pw / 2 : lx + S.xs - pw / 2;
    const border = boss ? mixHex(COLOR.surface, COLOR.negative, 0.6) : mixHex(COLOR.surface, COLOR.accent, 0.5);
    const bg = plate(this, px, y, pw, LABEL_H, { ...SURFACE.surface, alpha: 0.86, border, borderW: 2, r: R.pill });
    this.children.moveBelow(bg as never, name as never);
    const zh = Math.max(80, Math.min(step, 120));
    pressable(this, this.add.zone(px, y, pw, zh), pw, zh, open);
  }

  /** Закрытый этап: узел коротко качается — «сюда пока нельзя» (без тоста: замок уже на узле). */
  private shake(targets: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[]): void {
    if (!juiceOn() || this.tweens.isTweening(targets[0])) return;
    this.tweens.add({ targets, x: '+=10', yoyo: true, repeat: 2, duration: 50, ease: E.inOut });
  }

  private toStage(stageId: string): void {
    markHint('home_campaign');
    this.scene.start('Stage', { stageId });
  }

  /** Actual formation, with the same editor and return route used by preparation. */
  private squadStrip(): void {
    const edit = () => this.scene.start('Squad', { back: { to: 'Campaign', data: { chapter: this.chapterIndex } } });
    const headerY = this.layout.squadY - (this.compactLayout ? 164 : 116);
    // Одна подпись: кнопка «Отряд» над полосой героев (без второй такой же надписи слева).
    const editButton = button(this, GAME_W - S.l - 130, headerY, 260, this.compactLayout ? 132 : 96, '', 'Отряд', edit, T.caption, { variant: 'secondary' });
    editButton.container.setName('campaignSquadEdit');
    this.wallLine(headerY, this.compactLayout ? 132 : 96);
    Array.from({ length: 5 }, (_, i) => {
      const hero = session.save.heroes.find((h) => h.id === session.save.squad[i]);
      const x = 144 + i * 198;
      const card = plate(this, x, this.layout.squadY, 184, 160, { ...SURFACE.surface, border: hero ? heroCard(hero, GAME).rarity.color : COLOR.border, borderW: 2, r: R.m });
      card.setName(`campaignSquad_${i}`);
      pressable(this, card, 184, 160, edit);
      if (hero) {
        unitFigure(this, heroSprite(hero, GAME), x, this.layout.squadY + 22, 104, { maxScale: 1.4, onReady: (sprite) => {
          if (!card.scene) { sprite.destroy(); return; }
          if (card.parentContainer && this.mapArea) {
            sprite.y -= this.layout.bodyTop;
            card.parentContainer.add(sprite);
          }
        } });
        ellipsize(text(this, x, this.layout.squadY + 56, heroCard(hero, GAME).name, T.caption, COLOR.textPrimary), 172);
      } else text(this, x, this.layout.squadY, 'Пусто', T.caption, COLOR.textSecondary);
    });
  }

  /**
   * Аудит 11.10 (ux 1): стена — мощи на текущий этап мало. Слева от «Отряд» — что поможет сейчас (уровни, вещи,
   * вознесение, блюдо дня, сундук: полон — забрать, нет — через сколько наполнится; а пока Башня и Охота). Касание —
   * туда, где это делается. Мощи хватает — строки нет.
   */
  private wallLine(y: number, h: number): void {
    const save = session.save;
    const cur = currentStage(save, GAME);
    if (!cur || cur.chapter !== CONTENT.chapters[this.chapterIndex]?.id || stageStatus(save, cur.id, GAME) !== 'open') return;
    const wall = wallAdvice(save, cur.id, GAME, now(), today());
    if (!wall) return;
    const w = GAME_W - 2 * S.l - 260 - S.xs;
    const bg = plate(this, S.l + w / 2, y, w, h, { fill: COLOR.surfaceSunken, alpha: 0.9, border: mixHex(COLOR.surfaceSunken, COLOR.warning, 0.6), borderW: 2, r: R.m }).setName('campaignWall');
    const t = text(this, S.l + S.s, y, `${wall.text}${wall.action ? ' ›' : ''}`, T.caption - 6, COLOR.textPrimary, { wordWrap: { width: w - 2 * S.s } }).setOrigin(0, 0.5).setName('campaignWallText');
    clampLines(t, 2);
    const action = wall.action;
    if (action) pressable(this, bg, w, h, () => (action === 'Campaign' ? this.claim() : this.scene.start(action)));
  }

  /**
   * Новичок до первой победы (аудит 11.10, ux 15): красные точки других вкладок («Город»: вход дня, письмо) спорят с
   * указателем «В бой» — до первой победы их не показываем. Точку «Кампании» оставляем.
   */
  private quietNav(): void {
    if (session.save.campaign.cleared.length > 0) return;
    for (const o of this.children.list) if (o.name.startsWith('navBadge_') && o.name !== 'navBadge_Campaign') (o as Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject).setVisible(false);
  }

  // ---------- «В бой» ----------

  /**
   * Единственная главная кнопка страницы: «В бой · этап N». Мощь — только когда её не хватает (§3 п. 11):
   * «Не хватает N» второй строкой на кнопке; хватает — ничего не пишем.
   */
  private fightCta(): void {
    const cur = currentStage(session.save, GAME);
    const open = !!cur && stageStatus(session.save, cur.id, GAME) === 'open';
    const label = open ? `В бой · этап ${stageNo(cur, GAME)}` : 'К приключениям';
    const b = cta(this, this.layout.ctaX, this.layout.rowY, label, () => {
      if (open) this.toStage(cur.id);
      else this.scene.start('Adventure');
    }, { w: this.layout.ctaW, h: BTN.cta });
    b.container.setName('fightCta');
    if (!open) return;

    const pc = powerCheck(session.save, cur.id, GAME, today());
    const short = powerShortfall(pc.squad, pc.recommended).label;
    if (short) {
      b.label.setY(-22);
      const sub = text(this, 0, 34, short, T.caption, COLOR.onAccent, { fontStyle: 'bold' }).setName('ctaShort');
      b.container.add(sub);
    }
  }

  // ---------- K1. Быстрые награды ----------

  /**
   * Иконка-кнопка (вторичная): песочные часы и цена под ними — «Бесплатно», ромб гема с числом, «Лимит».
   * Закрыто — серая с замком, без слов (касание — когда откроется). Бесплатно — красная точка, без пульса.
   */
  private fastRewards(): void {
    const save = session.save;
    const st = fastRewardsStatus(save, today(), GAME);
    const preview = fastRewardsPreview(save, GAME);
    const noIncome = preview.gold <= 0 && preview.jobExp <= 0;
    const unlocked = isUnlocked('fast_rewards');
    const free = unlocked && st.nextCost === 0 && !noIncome;
    const state = !unlocked ? 'locked' : noIncome ? 'empty' : st.nextCost === null ? 'limit' : free ? 'free' : 'paid';
    const price = state === 'free' ? 'Бесплатно' : state === 'paid' ? formatNumber(st.nextCost ?? 0) : state === 'limit' ? 'Лимит' : '';
    text(this, this.layout.fastX, this.layout.rowY - 96, 'Быстрая награда', T.caption, COLOR.textSecondary);
    const x = this.layout.fastX;
    const y = this.layout.rowY;
    const btn = button(this, x, y, this.layout.fastW, BTN.cta, '', price, () => (unlocked ? this.useFast() : lockedToast(this, 'fast_rewards')), T.caption, { variant: 'secondary' });
    btn.container.setName('fastRewards').setData('state', state);
    const ico = this.add.image(0, price ? -24 : 0, skinIcon('hourglass')).setDisplaySize(64, 64).setTint(unlocked ? COLOR_N.title : COLOR_N.textTertiary);
    btn.container.add(ico);
    btn.label.setY(36);
    if (state === 'free') btn.label.setColor(COLOR.positive);
    if (state === 'paid') {
      // Цена: ромб гема + число.
      btn.label.setX(16);
      btn.container.add(gemIcon(this, 16 - btn.label.width / 2 - 22, 32, 26));
    }
    if (!unlocked) {
      btn.container.add(this.add.circle(36, 30, 24, COLOR_N.bg).setStrokeStyle(3, SKIN_TINT.bronze));
      btn.container.add(this.add.image(36, 30, skinIcon('lock')).setDisplaySize(30, 30).setTint(SKIN_TINT.gold));
    }
    if (state !== 'free' && state !== 'paid') btn.setEnabled(false);
    if (state === 'free') dot(this, x + this.layout.fastW / 2 - 14, y - BTN.cta / 2 + 14);
  }

  private useFast(): void {
    markHint('fast_rewards');
    const save = session.save;
    const day = today();
    const st = fastRewardsStatus(save, day, GAME);
    const preview = fastRewardsPreview(save, GAME);
    // Нечего забирать (лимит дня, нет дохода) — кнопка уже серая и говорит «Лимит»; без тоста.
    if (st.nextCost === null || (preview.gold <= 0 && preview.jobExp <= 0)) return;
    const loot = lootSummary(fastRewardsLoot(save, day, GAME));
    const price = st.nextCost === 0 ? '' : `\nЦена: ${formatNumber(st.nextCost)} гемов (у вас ${formatNumber(save.currency.gems)})`;
    const q = `Забрать ${GAME.features.fastRewards.hours} ч дохода сразу?\nЗолото +${formatNumber(preview.gold)}, опыт +${formatNumber(preview.jobExp)}${loot ? `\n${loot}` : ''}${price}\nОсталось сегодня: ${st.usesLeft}`;
    confirm(this, q, 'Забрать', () => {
      try {
        const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
        const r = actUseFastRewards(session.save, day, GAME);
        commit(r.save);
        const from = { x: this.layout.fastX, y: this.layout.rowY };
        queueRewardFly('Campaign', from, before);
        this.restartWithReward(from, r.rewards.jobExp, [...lootLines(r.loot), ...describeEvents(r.events, r.save, GAME)]);
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
      }
    });
  }

  // ---------- сундук офлайн-наград ----------

  /**
   * Сундук как в AFK: крупная картинка (растёт по мере наполнения, лучи — когда полон), полоса «1ч 05м / 12ч»,
   * накопленное чипами и «Собрать» (вторичная; главная кнопка экрана одна — «В бой»). Касание сундука — тоже сбор.
   * Новичок (ни одного этапа): сундук серый под замком и короткая подпись, когда начнёт копить.
   */
  private chest(): void {
    plate(this, GAME_W / 2, this.layout.cardY, this.layout.cardW, this.layout.cardH, { ...SURFACE.raised, borderW: 2, r: R.m }).setName('chestCard');
    const locked = session.save.campaign.cleared.length === 0;
    // Новичок: полосы и чипов ещё нет — подпись ниже, у сундука; верх карточки свободен под плашку «Вперёд, в первый
    // бой!» под «В бой» (first-30min P2: плашка закрывала подпись сундука).
    this.chestCaption = text(this, this.layout.fillX, this.layout.cardY + (locked ? -10 : -90), 'Добыча за время отдыха', T.caption, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('chestCaption');
    const cx = this.layout.chestX;
    const cy = this.layout.chestY;
    // Тёмная ниша под сундуком: лучи и сундук читаются «в рамке».
    this.add.image(cx, cy, 'skin_glow').setDisplaySize(240, 240).setTint(0x000000).setAlpha(0.5);
    if (hasArt('ui_chest_empty')) {
      if (!locked) {
        // За сундуком — медленные лучи и ореол, когда он полон (refresh включает).
        this.chestRays = slowRays(this, cx, cy, 230, 0.5).setVisible(false);
        this.chestGlow = glow(this, cx, cy + 8, 190, 0xffd27a, 0.45).setVisible(false);
      }
      this.chestImg = this.add.image(cx, cy, 'ui_chest_empty').setDisplaySize(this.layout.chestSize, this.layout.chestSize);
    } else this.chestImg = this.add.image(cx, cy, skinIcon('chest')).setDisplaySize(110, 110).setTint(SKIN_TINT.gold);
    if (locked) {
      this.chestImg.setTint(0x8a8378).setAlpha(0.85);
      const lx = cx + 52;
      const ly = cy + 46;
      this.add.circle(lx, ly, 26, COLOR_N.bg).setStrokeStyle(3, SKIN_TINT.bronze);
      this.add.image(lx, ly, skinIcon('lock')).setDisplaySize(30, 30).setTint(SKIN_TINT.gold);
      const first = CONTENT.stages[0];
      // Ниже середины карточки: над подписями ложится плашка подсказки «В бой» (у новичка).
      const cap = text(this, this.layout.fillX, this.layout.cardY + 50, `Откроется после ${first ? stageNo(first, GAME) : 'этапа 1'}`, T.body, COLOR.textSecondary).setOrigin(0, 0.5);
      cap.setName('chestLocked');
      return;
    }
    pressable(this, this.chestImg, this.layout.chestSize, this.layout.chestSize, () => this.claim());
    // Ряд накопленного — до самой «Собрать» (аудит 11.10: трофеи реже сворачиваются в «+N»).
    const chipsW = Math.max(this.layout.chipsW, this.layout.claimX - this.layout.claimW / 2 - S.xs - this.layout.fillX);
    this.chestView = new ChestCardView(this, { x: this.layout.fillX, w: this.layout.fillW, barY: this.layout.barY, chipsY: this.layout.chipsY, chipsW });
    // Касание ряда накопленного — что именно в сундуке (названия вещей), без сбора.
    const lz = this.add.zone(this.layout.fillX + chipsW / 2, this.layout.chipsY, chipsW, 88).setName('chestLootZone');
    pressable(this, lz, chipsW, 88, () => this.showChestLoot());
    this.claimBtn = button(this, this.layout.claimX, this.layout.claimY, this.layout.claimW, this.layout.claimH, '', 'Собрать', () => this.claim(), T.body, { variant: 'secondary' });
    this.claimBtn.container.setName('chestClaim');
  }

  private refresh(): void {
    if (!this.chestView || !this.claimBtn) {
      this.updateHint(false);
      return;
    }
    const st: ChestState = this.chestView.update(session.save, now());
    this.fitChestToHint();
    this.claimBtn.setEnabled(st.hasIncome);
    // Полон — подпись «Собрать» золотом, сундук мягко пульсирует (одна декоративная анимация на экран).
    if (st.hasIncome) this.claimBtn.label.setColor(st.fill.full ? COLOR.gold : COLOR.textPrimary);
    if (this.chestImg) {
      const art = chestArt(st.fill, st.hasIncome);
      if (hasArt('ui_chest_empty')) this.chestImg.setTexture(`ui_chest_${art}`);
      // Сундук растёт по мере наполнения: 85 % → 100 % размера.
      const k = 0.85 + 0.15 * st.fill.frac;
      if (!this.chestPulsing) this.chestImg.setDisplaySize(this.layout.chestSize * k, this.layout.chestSize * k);
      this.chestRays?.setVisible(art === 'full');
      this.chestGlow?.setVisible(art !== 'empty');
      if (st.fill.full && !this.chestPulsing) {
        this.chestPulsing = true;
        decorTween(this, { targets: this.chestImg, scale: this.chestImg.scale * 1.06, yoyo: true, repeat: -1, duration: M.emphasis, ease: E.inOut });
      }
    }
    this.updateHint(st.hasIncome);
  }

  /** Тост с содержимым сундука: золото и опыт видны чипами, здесь — вещи по названиям, карты, гемы, свитки. */
  private showChestLoot(): void {
    const save = session.save;
    const loot = offlineLoot(save, now(), GAME);
    const lines = lootLines(loot);
    if (loot.cards.length) lines.push(`Карты героя: ${loot.cards.length}`);
    toast(this, lines.length ? `В сундуке:\n${lines.join('\n')}` : 'В сундуке пока золото и опыт — трофеи добавятся со временем.', C.title, 4500);
  }

  private claim(): void {
    if (!this.chestView) return;
    const r = actClaimOffline(session.save, now(), today(), GAME);
    if (r.rewards.gold === 0 && r.rewards.jobExp === 0) {
      // T4-06: пустой сбор всё равно записывается — ядро сдвигает якорь сундука (часы переводили).
      commit(r.save);
      return;
    }
    const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
    commit(r.save);
    markHint('chest_claim');
    // Монеты вылетают из сундука и летят в золото в шапке (juice.ts); опыт всплывает над сундуком.
    const from = { x: this.layout.chestX, y: this.layout.chestY };
    queueRewardFly('Campaign', from, before, { burst: true });
    const food = foodLine(r.ingredients);
    this.restartWithReward(from, r.rewards.jobExp, [...lootLines(r.loot), ...(food ? [food] : []), ...describeEvents(r.events, r.save, GAME)], r.ingredients);
  }

  // ---------- R. Подсказки первой сессии ----------

  /**
   * Одна подсказка на следующем полезном действии; пересчитывается раз в секунду (сундук наполняется).
   * «В бой», «Собрать», вкладка «Герои» (опыт на уровень, трофеи), вкладка «Приключения» (открылась Башня).
   */
  private updateHint(chestHasIncome: boolean): void {
    const save = session.save;
    // Модальное окно или баннер открыты — подсказку не перестраиваем (она под ними всё равно не видна).
    if (confirmOpen(this) || this.children.getByName(UNLOCK_BANNER_NAME)) return;
    // RN-15: одноразовые («Башня открыта») — один показ, дальше не глушат другие шаги.
    const id = pickHomeHint(homeHintInput(save, chestHasIncome), (h) => hintDone(h) || (h !== this.hintId && hintShown(h)));
    if (id === this.hintId) return;
    this.hintView?.destroy();
    this.hintView = null;
    this.hintId = id;
    if (!id) return;
    const msg = HINT_TEXT[id];
    const tabY = navY() + 4;
    const tab = { w: NAV_TAB_W - 6, h: NAV_H - 40 };
    // Сторону плашки выбирает hintPointer (S): так, чтобы не закрыть другие кнопки и плитки.
    // Каждый шаг — tutorialHint с id (hints.ts): плашку можно пропустить касанием, e2e узнаёт шаг по id.
    if (id === 'home_campaign') this.hintView = tutorialHint(this, id, this.layout.ctaX, this.layout.rowY, 'below', { w: this.layout.ctaW, h: BTN.cta });
    if (id === 'chest_claim') this.hintView = tutorialHint(this, id, this.layout.claimX, this.layout.claimY, 'below', { w: this.layout.claimW, h: this.layout.claimH });
    if (id === 'level_up' || id === 'equip_gear') this.hintView = tutorialHint(this, id, navTabX('Heroes'), tabY, 'above', tab);
    // Башня — на странице «Приключения»: здесь указываем на вкладку, на самой странице — на плитку.
    if (id === 'tower_open') this.hintView = tutorialHint(this, id, navTabX('Adventure'), tabY, 'above', tab, { text: `${msg} Загляните в «Приключения»` });
    // Ведущее обучение (hints.ts, TUTORIAL_CHAIN): Таверна и задания — вкладка «Город», вознесение — «Герои»,
    // быстрые награды — кнопка слева от «В бой». Касание плашки — пропустить шаг.
    if (id === 'tavern_summon' || id === 'quests_open') this.hintView = tutorialHint(this, id, navTabX('Home'), tabY, 'above', tab);
    if (id === 'ascend') this.hintView = tutorialHint(this, id, navTabX('Heroes'), tabY, 'above', tab);
    if (id === 'branch_pick') this.hintView = tutorialHint(this, id, navTabX('Heroes'), tabY, 'above', tab);
    if (id === 'fast_rewards') this.hintView = tutorialHint(this, id, this.layout.fastX, this.layout.rowY, 'above', { w: this.layout.fastW, h: BTN.cta });
    const shown = !!this.hintView && !this.hintView.getData('hintMuted');
    if (shown) markHintShown(id, true);
    if (!shown) this.hintId = null; // Подавленную подсказку попробуем снова после закрытия окна.
    // Плашку раскладывает hintPointer на следующем кадре — после неё карточка сундука уступает ей место.
    if (this.hintView) this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => this.fitChestToHint());
    this.hintView?.once(Phaser.GameObjects.Events.DESTROY, () => {
      // Плашку пропустили касанием — на следующем тике покажется следующий шаг цепочки.
      if (this.hintId === id && hintDone(id)) this.hintId = null;
      this.fitChestToHint();
    });
  }

  /**
   * Плашка подсказки легла на карточку сундука (first-30min P2): «Собрать» — плашка над кнопкой, на подписи;
   * вкладки снизу — на ряду накопленного. Карточка уступает место, а не прячет данные под плашкой: ряд накопленного
   * поднимается на место подписи, подпись «Добыча за время отдыха» уходит (о сундуке говорит сама плашка).
   * Плашки нет — всё на своих местах. Зовётся после раскладки плашки, её снятия и каждой перестройки чипов (refresh).
   */
  private fitChestToHint(): void {
    const caption = this.chestCaption;
    if (!caption?.scene) return;
    const hint = this.hintView?.scene && this.hintView.getData('hintMode') === 'box' ? (this.hintView.getData('hintBox') as Rect | undefined) : undefined;
    const covers = (o: { getBounds(): Phaser.Geom.Rectangle }) => {
      if (!hint) return false;
      const b = o.getBounds();
      return overlapArea(hint, { x: b.x, y: b.y, w: b.width, h: b.height }) > 0;
    };
    const chips = this.children.getByName('chestChips') as Phaser.GameObjects.Container | null;
    chips?.setY(this.layout.chipsY);
    const lift = !!chips && covers(chips);
    chips?.setY(lift ? caption.y : this.layout.chipsY);
    caption.setVisible(!lift && !covers(caption));
  }

  /**
   * Перезапустить экран (та же глава) после награды: монеты летят в «таблетки» валют (queueRewardFly), опыт в запас
   * всплывает чипом над точкой получения; тост — только о том, чего на экране не видно (трофеи, события).
   */
  private restartWithReward(from: { x: number; y: number }, exp: number, lines: string[], food?: Pantry): void {
    this.scene.restart({ chapter: this.chapterIndex });
    this.events.once(Phaser.Scenes.Events.CREATE, () => {
      if (exp > 0) this.floatGain(from, exp);
      // Продукты Кухни (сундук) — рядом чипов под опытом.
      floatFood(this, { x: from.x, y: from.y + 70 }, food);
      if (lines.length) afterRewardFly(this, () => toast(this, lines.join('\n'), C.success));
    });
  }

  /** Чип «+N опыта» поднимается над точкой и гаснет. */
  private floatGain(from: { x: number; y: number }, exp: number): void {
    const c = chip(this, from.x, from.y - 40, (s, x, y, size) => rewardIcon(s, x, y, 'exp', size), `+${formatNumber(exp)}`, 'neutral', { size: 's' }).setDepth(50).setName('expGain');
    if (!juiceOn()) {
      this.time.delayedCall(M.count * 2, () => c.destroy());
      return;
    }
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, y: from.y - 110, duration: M.slow, ease: E.out });
    this.tweens.add({ targets: c, alpha: 0, y: from.y - 160, delay: M.slow + M.count, duration: M.base, ease: E.in, onComplete: () => c.destroy() });
  }
}
