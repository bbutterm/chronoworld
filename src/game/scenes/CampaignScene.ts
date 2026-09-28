import Phaser from 'phaser';
import { hasArt } from '../assets';
import { HINT_TEXT, hintDone, markHint, pickHomeHint, type HintId } from '../hints';
import { homeHintInput } from '../tutorial';
import { actClaimOffline, actUseFastRewards, fastRewardsLoot, fastRewardsPreview, fastRewardsStatus, offlineRewards, pendingScenes, stageStatus } from '../../core';
import { CONTENT, GAME } from '../content';
import { playScenes } from '../dialogue';
import { isChapterFinale, seenChapterScenes } from '../storyView';
import { openStoryHistory, startChapterDone } from './ChapterDoneScene';
import { currentStage, describeEvents, formatNumber, POWER_COLORS, powerCheck } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, confirm, confirmOpen, CONTENT_TOP, cornerBadge, gemIcon, NAV_H, NAV_TAB_W, navTabX, powerChip, screen } from '../screen';
import { commit, now, restartOnNewDay, session, today } from '../session';
import { button, ellipsize, hintPointer, pressable, text, toast, tutorialHint } from '../ui';
import { C, FS, OUTLINE, TINT, TOUCH } from '../theme';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from '../skin';
import { screenBackground, setThemeBackground, themeOfChapter } from '../backdrops';
import { ctaShine, glow, medallion, motes, ribbon, slowRays } from '../decor';
import { afterRewardFly, juiceOn, pulse, queueRewardFly } from '../juice';
import { isUnlocked, lockedToast, showUnlockBanners, UNLOCK_BANNER_NAME } from '../unlockBanner';
import { ChestCardView, chestHeadline, lootLines, lootSummary } from '../chestView';
import { touchToday } from '../homeEvents';

/** Узел этапа на тропе (босс — ×1.25). */
const NODE = 120;

/**
 * Страница «Кампания» (как экран кампании AFK Arena), сверху вниз: лента главы со стрелками, тропа этапов змейкой,
 * ряд «Быстрые награды» + «В бой · этап N», карточка сундука офлайн-наград (сундук, накопленное иконками, «Собрать»,
 * таймер «Полон через»). Между карточкой и навигацией — зазор под плашку подсказки (вкладка «Герои», «Собрать»):
 * плашка ≈ 126 ед. от края цели до дальнего края. Плашка под «В бой» ложится на карточку сундука (у новичка на ней нет кнопок).
 */
const L = {
  mapTop: CONTENT_TOP + 150,
  mapBottom: 1165,
  rowY: 1325,
  fastX: 195,
  fastW: 330,
  fastH: 120,
  ctaX: 712,
  ctaW: 650,
  ctaH: 130,
  chestCardY: 1520,
  chestCardH: 240,
  chestX: 130,
  chestY: 1522,
  chestSize: 124,
  titleY: 1436,
  headlineX: 240,
  claimX: 872,
  claimY: 1512,
  claimW: 300,
  claimH: 90,
  incomeX: 450,
  incomeY: 1532,
  lootY: 1594,
} as const;

/** Узлов на одном участке карты не больше: 10 — как у глав из 10 этапов (плотнее — узлы налезают друг на друга). */
const MAP_PAGE_MAX = 10;

/** Участки карты главы из n этапов: поровну, по ≤ MAP_PAGE_MAX (18 → 9 + 9). [from, to) — индексы этапов главы. */
function mapPages(n: number): { from: number; to: number }[] {
  const count = Math.max(1, Math.ceil(n / MAP_PAGE_MAX));
  const size = Math.ceil(n / count);
  return Array.from({ length: count }, (_, i) => ({ from: i * size, to: Math.min(n, (i + 1) * size) })).filter((p) => p.to > p.from);
}

/** Кампания: этапы главы снизу вверх, как тропа (закрыт / открыт / пройден / босс), сундук и «В бой». */
export class CampaignScene extends Phaser.Scene {
  private chapterIndex = 0;
  private chestText?: Phaser.GameObjects.Text;
  private chestView?: ChestCardView;
  private chestImg?: Phaser.GameObjects.Image;
  private chestRays?: Phaser.GameObjects.Image;
  private chestGlow?: Phaser.GameObjects.Image;
  private claimBtn?: ReturnType<typeof button>;
  private claimPulsing = false;
  /** R: показанная подсказка (одна за раз) и её указатель. */
  private hintId: HintId | null = null;
  private hintView: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Campaign');
  }

  create(data: { chapter?: number; page?: number }): void {
    this.hintId = null;
    this.hintView = null;
    this.claimPulsing = false;
    // Сцена-синглтон живёт всю игру: после выхода не держать её уничтоженные объекты (npm run perf — «dead»).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hintView = null;
      this.chestImg = this.chestRays = this.chestGlow = undefined;
      this.chestView = undefined;
      this.chestText = undefined;
      this.claimBtn = undefined;
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
    if (!chapter) {
      text(this, GAME_W / 2, 600, 'В data/campaign нет глав', FS.h2);
      return;
    }
    // Фон карты — по теме главы (луг, топь, склеп).
    const bg = screenBackground(this);
    if (bg) setThemeBackground(bg, 'map', themeOfChapter(chapter.id));

    this.map(chapter.id, ci, chapters.length, data?.page);
    this.fastRewards();
    this.cta();
    this.chest();

    this.refresh();
    // Сундук считаем раз в секунду, а не каждый кадр.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refresh() });

    // Сюжет: вступление главы — при первом входе на её карту (пока первый этап не пройден). P11: сначала — сцены
    // из очереди (финал, прерванный перезагрузкой); если среди них финал главы — после него «Глава пройдена» (T1-03).
    const scenes = pendingScenes(session.save, { type: 'chapterStart', chapter: chapter.id }, GAME);
    const finale = scenes.find((s) => isChapterFinale(s, GAME));
    playScenes(this, scenes, () => {
      // Экран «Глава пройдена» ждёт показа (перезагрузка на нём или на финале) — показать сейчас.
      const done = finale?.chapter ?? session.save.pendingChapterDone;
      if (done && GAME.content.chapters.some((c) => c.id === done)) startChapterDone(this, { chapterId: done });
      // Открылась функция (в том числе за этапы, пройденные в авто-режиме) — баннер «Новая функция!».
      else showUnlockBanners(this);
    });
  }

  // ---------- карта главы ----------

  private map(chapterId: string, ci: number, count: number, pageArg?: number): void {
    const chapter = CONTENT.chapters[ci];
    // Название главы — на ленте (между стрелками глав).
    ribbon(this, GAME_W / 2, CONTENT_TOP + 40, chapter.name, { size: FS.h2, minW: 520, maxW: 780 }).setDepth(5);
    if (ci > 0) button(this, 70, CONTENT_TOP + 40, TOUCH, TOUCH, 'k:buttonSquare_beige', '‹', () => this.scene.restart({ chapter: ci - 1 }), FS.hero);
    if (ci < count - 1) button(this, GAME_W - 70, CONTENT_TOP + 40, TOUCH, TOUCH, 'k:buttonSquare_beige', '›', () => this.scene.restart({ chapter: ci + 1 }), FS.hero);

    // Длинная глава (глава 1 — 18 этапов) — участками по ≤ 10 узлов: иначе узлы тропы налезают друг на друга.
    // Участок по умолчанию — с текущим этапом (пройдена вся глава — последний); «▲ Этапы 10–18» / «▼ Этапы 1–9» — соседний.
    const all = CONTENT.stages.filter((s) => s.chapter === chapterId);
    const pages = mapPages(all.length);
    const cur = all.findIndex((s) => stageStatus(session.save, s.id, GAME) === 'open');
    const pageOf = (i: number) => pages.findIndex((p) => i >= p.from && i < p.to);
    const auto = cur >= 0 ? pageOf(cur) : all.every((s) => stageStatus(session.save, s.id, GAME) === 'cleared') ? pages.length - 1 : 0;
    const page = Phaser.Math.Clamp(pageArg ?? auto, 0, pages.length - 1);
    const stages = all.slice(pages[page].from, pages[page].to);
    const paged = pages.length > 1;
    const toPage = (p: number, label: string, y: number, name: string) => {
      const pg = pages[p];
      button(this, GAME_W - 150, y, 250, 84, 'k:buttonLong_beige', `${label} ${all[pg.from].globalIndex + 1}–${all[pg.to - 1].globalIndex + 1}`, () => this.scene.restart({ chapter: ci, page: p }), FS.body).container.setName(name);
    };
    if (page < pages.length - 1) toPage(page + 1, '▲', CONTENT_TOP + 140, 'mapPageUp');
    if (page > 0) toPage(page - 1, '▼', CONTENT_TOP + (page < pages.length - 1 ? 236 : 140), 'mapPageDown');
    // Участком — ниже кнопок участков и «Истории» (верхний узел не под ними).
    const top = paged ? L.mapTop + 80 : L.mapTop;
    const bottom = L.mapBottom;
    const step = stages.length > 1 ? (bottom - top) / (stages.length - 1) : 0;
    // Тропа змейкой снизу вверх (как в референсе владельца), подпись — с той стороны, где больше места.
    const pos = stages.map((_, i) => ({ x: GAME_W / 2 + Math.sin(i * 1.05 + 0.4) * 250, y: bottom - step * i }));

    // Деревянная тропа: гладкая кривая через все узлы — тёмная кромка, доска, светлые «гвозди».
    if (pos.length > 1) {
      const curve = new Phaser.Curves.Spline(pos.map((p) => new Phaser.Math.Vector2(p.x, p.y)));
      const pts = curve.getSpacedPoints(pos.length * 24);
      const g = this.add.graphics();
      g.lineStyle(56, 0x0e0b07, 0.9).strokePoints(pts);
      g.lineStyle(42, 0x5a3c22, 1).strokePoints(pts);
      g.lineStyle(22, 0x6e4b2b, 1).strokePoints(pts);
      g.fillStyle(0xc9a878, 0.5);
      for (let i = 0; i < pts.length; i += 3) g.fillCircle(pts[i].x, pts[i].y, 3.5);
    }

    stages.forEach((s, i) => {
      const st = stageStatus(session.save, s.id, GAME);
      const { x, y } = pos[i];
      const size = s.boss ? NODE * 1.25 : NODE;
      const open = () => {
        if (st === 'locked') toast(this, 'Этап закрыт: сначала пройдите предыдущий');
        else this.toStage(s.id);
      };
      const key = st === 'open' ? 'skin_node_open' : st === 'cleared' ? 'skin_node_cleared' : s.boss ? 'skin_node_boss' : 'skin_node_locked';
      // Текущий этап и босс подсвечены ореолом (текущий — «дышит»).
      if (st === 'open') glow(this, x, y, size * 2.1, 0xffc860, 0.55, true);
      else if (s.boss) glow(this, x, y, size * 1.9, 0xc04070, 0.35);
      pressable(this, this.add.image(x, y, key).setDisplaySize(size, size), size, size, open);
      text(this, x, y - 2, String(s.globalIndex + 1), size * 0.34, st === 'locked' ? SKIN.creamDim : SKIN.cream, {
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
      });
      // Значок в углу: замок (закрыт), галочка (пройден).
      const badge = (name: SkinIcon, color: number) => {
        const bx = x + size * 0.36;
        const by = y + size * 0.34;
        this.add.circle(bx, by, 22, 0x0d0e0b).setStrokeStyle(3, SKIN_TINT.bronze);
        this.add.image(bx, by, skinIcon(name)).setDisplaySize(28, 28).setTint(color);
      };
      if (st === 'locked') badge('lock', SKIN_TINT.gold);
      if (st === 'cleared') badge('check', 0x9fe0a6);
      if (st === 'open') {
        // Текущий этап: пульсирующее золотое кольцо вокруг узла (T3-21: красные квадраты-«прицел» наезжали на подпись).
        const r = size * 0.56;
        const g = this.add.graphics({ x, y });
        g.lineStyle(6, TINT.gold, 0.9).strokeCircle(0, 0, r);
        if (juiceOn()) this.tweens.add({ targets: g, scale: 1.1, alpha: 0.35, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
      }
      // Подпись — сбоку от узла, в сторону центра экрана: название и строка состояния (у текущего — мощь).
      const right = x < GAME_W / 2;
      const lx = right ? x + size * 0.6 : x - size * 0.6;
      const zh = Math.max(80, Math.min(step, 120));
      const zx = right ? (lx + GAME_W - 20) / 2 : (20 + lx) / 2;
      const zw = right ? GAME_W - 20 - lx : lx - 20;
      pressable(this, this.add.zone(zx, y, zw, zh), zw, zh, open);
      const color = st === 'locked' ? SKIN.creamDim : s.boss ? C.danger : SKIN.cream;
      ellipsize(
        text(this, lx, y - 17, s.name, FS.h3, color, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 }).setOrigin(right ? 0 : 1, 0.5),
        zw - 10,
      );
      if (st === 'open') {
        // «Почти готово»: у текущего этапа — мощь отряда против рекомендуемой, цветом тона (зелёный / жёлтый / красный).
        const pc = powerCheck(session.save, s.id, GAME);
        const pw = text(this, lx, y + 21, `${s.boss ? 'БОСС · ' : ''}мощь ${formatNumber(pc.squad)} / ${formatNumber(pc.recommended)}${pc.tone === 'ahead' ? '' : ` · ${pc.verdict.toLowerCase()}`}`, FS.caption, POWER_COLORS[pc.tone], {
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 5,
        }).setOrigin(right ? 0 : 1, 0.5).setName('stagePower');
        ellipsize(pw, zw - 10);
      } else {
        const status = st === 'cleared' ? 'пройден' : s.boss ? 'босс' : 'закрыт';
        text(this, lx, y + 21, status, FS.caption, st === 'cleared' ? C.success : SKIN.creamDim, { stroke: '#000000', strokeThickness: 4 }).setOrigin(right ? 0 : 1, 0.5);
      }
    });

    // Живой фон карты: несколько искр поднимаются над тропой.
    motes(this, { x: 60, y: top, w: GAME_W - 120, h: bottom - top }, 6);

    // «История» (P3): пересмотр увиденных сцен главы. Слева вверху, под стрелкой глав: там нет узлов и подписей этапов.
    if (seenChapterScenes(session.save, chapterId, GAME).length) {
      button(this, 150, CONTENT_TOP + 150, 240, 84, 'k:buttonLong_beige', 'История', () => openStoryHistory(this, chapterId), FS.body).container.setName('historyBtn');
    }
  }

  private toStage(stageId: string): void {
    markHint('home_campaign');
    this.scene.start('Stage', { stageId });
  }

  // ---------- «В бой» ----------

  /** Главная кнопка страницы: следующий этап, мощь отряда против рекомендуемой — плашкой внизу кнопки. */
  private cta(): void {
    const cur = currentStage(session.save, GAME);
    const open = !!cur && stageStatus(session.save, cur.id, GAME) === 'open';
    const y = L.rowY;
    glow(this, L.ctaX, y, 900, 0xffc860, 0.22, true).setScale(900 / 128, 250 / 128);
    const label = open ? `В бой · этап ${cur.globalIndex + 1}` : 'Все этапы пройдены';
    const cta = button(this, L.ctaX, y, L.ctaW, L.ctaH, 'ui_btn_primary', label, () => {
      if (open) this.toStage(cur.id);
      else toast(this, 'Новые главы — скоро');
    }, FS.h2);
    cta.container.setName('fightCta');
    const labelY = open ? -24 : -4;
    cta.label.setPosition(30, labelY);
    cta.container.add(this.add.image(30 - cta.label.width / 2 - 40, labelY, skinIcon('swords')).setDisplaySize(52, 52).setTint(0x3a2408));
    if (open) {
      ctaShine(this, cta.container, L.ctaW, L.ctaH);
      cta.container.add(powerChip(this, 0, 30, powerCheck(session.save, cur.id, GAME), { minW: 420 }));
    } else cta.setEnabled(false);
  }

  // ---------- K1. Быстрые награды ----------

  private fastRewards(): void {
    const save = session.save;
    const st = fastRewardsStatus(save, today(), GAME);
    const preview = fastRewardsPreview(save, GAME);
    const noIncome = preview.gold <= 0 && preview.jobExp <= 0;
    const unlocked = isUnlocked('fast_rewards');
    const free = unlocked && st.nextCost === 0 && !noIncome;
    const x = L.fastX;
    const y = L.rowY;
    const price = !unlocked ? 'Закрыто' : st.nextCost === null ? 'Лимит' : st.nextCost === 0 ? 'Бесплатно' : formatNumber(st.nextCost);
    const btn = button(this, x, y, L.fastW, L.fastH, free ? 'ui_btn_primary' : 'ui_btn_secondary', price, () => (unlocked ? this.useFast() : lockedToast(this, 'fast_rewards')), FS.h3);
    btn.container.setName('fastRewards');
    const tx = 42;
    btn.label.setPosition(tx, 18);
    const title = text(this, tx, -24, 'Быстрые', FS.caption, free ? '#2a1c08' : SKIN.goldLight, { fontStyle: 'bold' });
    btn.container.add([medallion(this, -L.fastW / 2 + 52, 0, 84, unlocked ? 'hourglass' : 'lock', unlocked ? SKIN_TINT.gold : SKIN_TINT.creamDim), title]);
    if (unlocked && st.nextCost !== null && st.nextCost > 0) {
      // Цена: ромб гема + число.
      btn.label.setX(tx + 20);
      btn.container.add(gemIcon(this, tx + 20 - btn.label.width / 2 - 30, 14, 32));
    }
    if (!unlocked || st.nextCost === null || noIncome) btn.setEnabled(false);
    // Бесплатные быстрые награды — готовы к получению: пульс и красный кружок.
    else if (free) {
      pulse(this, btn.container, 1.04);
      cornerBadge(this, x, y, L.fastW, L.fastH, 1);
    }
  }

  private useFast(): void {
    markHint('fast_rewards');
    const save = session.save;
    const day = today();
    const st = fastRewardsStatus(save, day, GAME);
    const preview = fastRewardsPreview(save, GAME);
    if (st.nextCost === null) {
      toast(this, 'Быстрые награды на сегодня закончились');
      return;
    }
    if (preview.gold <= 0 && preview.jobExp <= 0) {
      toast(this, 'Пройдите хотя бы один этап кампании, чтобы получать быстрые награды');
      return;
    }
    const price = st.nextCost === 0 ? 'Бесплатно.' : `Цена: ${formatNumber(st.nextCost)} гемов (у вас ${formatNumber(save.currency.gems)}).`;
    const loot = lootSummary(fastRewardsLoot(save, day, GAME));
    const left = `Осталось сегодня: ${st.usesLeft}, бесплатно ${st.freeLeft}.`;
    const q = `Забрать ${GAME.features.fastRewards.hours} ч дохода сразу?\nЗолото +${formatNumber(preview.gold)}, опыт +${formatNumber(preview.jobExp)} в запас.${loot ? `\n${loot}` : ''}\n${price}\n${left}`;
    confirm(this, q, 'Забрать', () => {
      try {
        const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
        const r = actUseFastRewards(session.save, day, GAME);
        commit(r.save);
        queueRewardFly('Campaign', { x: L.fastX, y: L.rowY }, before);
        this.restartWithToast([`Быстрые награды: золото +${formatNumber(r.rewards.gold)}, опыт +${formatNumber(r.rewards.jobExp)}`, ...lootLines(r.loot), ...describeEvents(r.events, r.save, GAME)]);
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
      }
    });
  }

  // ---------- сундук офлайн-наград ----------

  private chest(): void {
    const y = L.chestCardY;
    card(this, GAME_W / 2, y, 1000, L.chestCardH).setName('chestCard');
    const cx = L.chestX;
    const cy = L.chestY;
    // Подложка под сундуком — тёмная ниша, чтобы лучи и сундук читались «в рамке».
    this.add.image(cx, cy, 'skin_glow').setDisplaySize(230, 230).setTint(0x000000).setAlpha(0.5);
    if (hasArt('ui_chest_empty')) {
      // За сундуком — медленные лучи и ореол, пока в нём что-то есть (refresh включает).
      this.chestRays = slowRays(this, cx, cy, 220, 0.55).setVisible(false);
      this.chestGlow = glow(this, cx, cy + 8, 180, 0xffd27a, 0.5, true).setVisible(false);
      // Сундук: пустой / наполняется / полный (текстура меняется в refresh).
      this.chestImg = this.add.image(cx, cy, 'ui_chest_empty').setDisplaySize(L.chestSize, L.chestSize);
    } else this.add.image(cx, cy, skinIcon('chest')).setDisplaySize(90, 90).setTint(SKIN_TINT.gold);
    text(this, 70, L.titleY, 'Сундук офлайн-наград', FS.h3, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    this.chestText = text(this, L.headlineX, L.titleY + 48, '', FS.small, C.text, { lineSpacing: 6, ...OUTLINE }).setOrigin(0, 0.5);
    // Золото и опыт, трофеи (предметы, карты героя, гемы, свитки) иконками и «Полон через Ч:ММ» (лимит — capHours).
    this.chestView = new ChestCardView(this, { incomeX: L.incomeX, incomeY: L.incomeY, lootX: L.incomeX, lootY: L.lootY, timerX: L.claimX, timerY: L.titleY });
    this.chestView.update(session.save, now());
    this.claimBtn = button(this, L.claimX, L.claimY, L.claimW, L.claimH, 'ui_btn_primary', 'Собрать', () => this.claim(), FS.h2);
    this.claimBtn.container.setName('chestClaim');
    // Новичок (ни одного этапа): собирать нечего — вместо кнопки пояснение, место под подсказку «В бой».
    if (session.save.campaign.cleared.length === 0) this.claimBtn.container.setVisible(false).disableInteractive();
  }

  private refresh(): void {
    if (!this.chestText || !this.claimBtn) return;
    const r = this.chestView?.update(session.save, now()) ?? offlineRewards(session.save, now(), GAME);
    const full = r.gold > 0 || r.jobExp > 0;
    const cleared = session.save.campaign.cleared.length;
    // Есть накопленное — строка «Накоплено за…» над иконками; иначе пояснение в две строки.
    // Пусто — пояснение в две строки ниже середины карточки: над ним остаётся место под плашку подсказки «В бой».
    this.chestText.setText(chestHeadline(r, cleared)).setY(full ? L.titleY + 46 : L.chestY + 44);
    this.claimBtn.setEnabled(full);
    // Есть что собрать — кнопка мягко пульсирует (один раз запускаем; пустой сундук бывает только после сбора — это перезапуск).
    if (full && !this.claimPulsing) {
      this.claimPulsing = true;
      pulse(this, this.claimBtn.container);
    }
    if (this.chestImg) {
      const capMin = GAME.progression.offline.capHours * 60;
      const state = !full ? 'empty' : r.minutes >= capMin * 0.9 ? 'full' : 'filling';
      this.chestImg.setTexture(`ui_chest_${state}`).setDisplaySize(L.chestSize, L.chestSize);
      this.chestRays?.setVisible(state !== 'empty');
      this.chestGlow?.setVisible(state !== 'empty');
    }
    this.updateHint(full);
  }

  private claim(): void {
    const r = actClaimOffline(session.save, now(), today(), GAME);
    if (r.rewards.gold === 0 && r.rewards.jobExp === 0) {
      // T4-06: пустой сбор всё равно записывается — ядро сдвигает якорь сундука (часы переводили).
      commit(r.save);
      toast(this, 'Сундук пока пуст');
      return;
    }
    const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
    commit(r.save);
    markHint('chest_claim');
    // Монеты вылетают из сундука и летят в золото в шапке (juice.ts).
    queueRewardFly('Campaign', { x: L.chestX, y: L.chestY }, before, { burst: true });
    this.restartWithToast([`Собрано: золото +${formatNumber(r.rewards.gold)}, опыт +${formatNumber(r.rewards.jobExp)}`, ...lootLines(r.loot), ...describeEvents(r.events, r.save, GAME)]);
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
    const id = pickHomeHint(homeHintInput(save, chestHasIncome));
    if (id === this.hintId) return;
    this.hintView?.destroy();
    this.hintView = null;
    this.hintId = id;
    if (!id) return;
    const msg = HINT_TEXT[id];
    const tabY = GAME_H - NAV_H / 2 + 4;
    const tab = { w: NAV_TAB_W - 6, h: NAV_H - 40 };
    // Сторону плашки выбирает hintPointer (S): так, чтобы не закрыть другие кнопки и плитки.
    if (id === 'home_campaign') this.hintView = hintPointer(this, L.ctaX, L.rowY, msg, 'below', { w: L.ctaW, h: L.ctaH });
    if (id === 'chest_claim') this.hintView = hintPointer(this, L.claimX, L.claimY, msg, 'below', { w: L.claimW, h: L.claimH });
    if (id === 'level_up' || id === 'equip_gear') this.hintView = hintPointer(this, navTabX('Heroes'), tabY, msg, 'above', tab);
    // Башня — на странице «Приключения»: здесь указываем на вкладку, на самой странице — на плитку.
    if (id === 'tower_open') this.hintView = hintPointer(this, navTabX('Adventure'), tabY, `${msg} Загляните в «Приключения»`, 'above', tab);
    // Ведущее обучение (hints.ts, TUTORIAL_CHAIN): Таверна и задания — вкладка «Город», вознесение — «Герои»,
    // быстрые награды — кнопка слева от «В бой». Касание плашки — пропустить шаг.
    if (id === 'tavern_summon' || id === 'quests_open') this.hintView = tutorialHint(this, id, navTabX('Home'), tabY, 'above', tab);
    if (id === 'ascend') this.hintView = tutorialHint(this, id, navTabX('Heroes'), tabY, 'above', tab);
    if (id === 'fast_rewards') this.hintView = tutorialHint(this, id, L.fastX, L.rowY, 'above', { w: L.fastW, h: L.fastH });
    this.hintView?.once(Phaser.GameObjects.Events.DESTROY, () => {
      // Плашку пропустили касанием — на следующем тике покажется следующий шаг цепочки.
      if (this.hintId === id && hintDone(id)) this.hintId = null;
    });
  }

  /** Перезапустить экран (та же глава) и показать тост уже на новом экземпляре сцены. */
  private restartWithToast(lines: string[]): void {
    this.scene.restart({ chapter: this.chapterIndex });
    this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, lines.join('\n'), C.success, 5000)));
  }
}
