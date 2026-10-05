import Phaser from 'phaser';
import { markHint } from '../hints';
import {
  abandonTowerRun,
  buildUnit,
  buyTowerUpgrade,
  chooseTowerPath,
  eventOptionAllowed,
  familyStates,
  heroGender,
  heroPower,
  isBattleNode,
  markTowerSummarySeen,
  NODE_NAMES,
  pickTowerBlessing,
  previewTowerBlessingChoice,
  skipTowerBlessing,
  rerollTowerBlessing,
  resolveTowerEvent,
  runConfig,
  startTowerRun,
  towerEventDef,
  towerPathPreview,
  towerRunStatus,
  towerRunSquad,
  TowerError,
  unitPower,
  upgradeLevel,
  upgradeValue,
  withGear,
  type Blessing,
  type HeroState,
  type TowerNodeKind,
  type TowerRun,
  type TowerRunEvent,
  type UnitDef,
} from '../../core';
import { scoutLine } from '../scoutView';
import { plural } from '../skillFacts';
import { GAME } from '../content';
import { formatNumber, heroSprite, stageNo } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { bottomSheet, confirm, contentBottom, cta, CONTENT_TOP, portrait, powerCompare, screen, unitTint } from '../screen';
import { screenBackground, setThemeBackground, themeOfTowerFloor } from '../backdrops';
import { showCardArt } from '../cardArt';
import { framedPortrait } from '../portraitFrame';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { type Panel, BTN, button, chip, clampLines, ellipsize, iconOf, infoButton, plate, pressable, rewardRow, ScrollArea, SURFACE, tag, text, toast, type ButtonView, type ChipSpec, type Tone } from '../ui';
import { ctaShine, glow } from '../decor';
import { skinIcon, type SkinIcon } from '../skin';
import { C, COLOR, COLOR_N, FAMILY, hexNum, R, RARITY, S, T, TOUCH } from '../theme';
import { sfx } from '../audio';
import { firstTip } from '../firstTips';
import { haptic } from '../haptics';
import { motion } from '../state';
import { adventureModeLayout } from '../adventureModeLayout';
import { adventureModePanel } from '../adventureModePanel';
import { collect } from '../juice';
import { onViewChange } from '../viewport';

/** Что вернул бой этажа (BattleScene → Tower). */
export interface TowerSceneData {
  fight?: { floor: number; win: boolean; events: TowerRunEvent[] };
  /** Открыть лист улучшений (после покупки). */
  upgrades?: boolean;
  scroll?: number;
}

/**
 * Раскладка поля 1080×1920 (§4.2: поля S.l, сетка 8). Лобби и забег делят полосу состояния, лестницу этажей и главную
 * кнопку; ниже лестницы — у лобби отряд и добыча дня, у забега — превью выбранного пути и раны отряда.
 */
const L = {
  /** Полоса чипов состояния и «i». */
  barY: CONTENT_TOP + 56,
  /** Лестница: два этажа впереди (дальний — бледнее). */
  far: 350,
  near: 500,
  /** Лобби: рекорд — крупный круг. */
  bestY: 730,
  bestR: 132,
  /** Забег: развилка (крупный номер этажа между путями) и пройденный этаж. */
  forkY: 690,
  passedY: 930,
  /** Лобби: прошлый забег, отряд, добыча. */
  lastY: 950,
  squadHeadY: 1100,
  squadY: 1220,
  lootY: 1390,
  /** Забег: превью пути и отряд с ранами. */
  previewY: 1150,
  runSquadY: 1420,
} as const;

/** Первая реплика Гаррета — на месте «прошлого забега», которого при первом входе ещё нет. */
const TIP_Y = L.lastY;
/** Рамка карты по редкости (§4.4: редкость — только у рамок). */
const RARITY_COLOR: Record<Blessing['rarity'], string> = { common: RARITY.green, rare: RARITY.blue, legendary: RARITY.gold };
const NODE_ICON: Record<TowerNodeKind, SkinIcon> = { battle: 'swords', elite: 'swords', event: 'scroll', rest: 'home', boss: 'trophy' };
const NODE_TONE: Record<TowerNodeKind, string> = { battle: COLOR.title, elite: COLOR.negative, event: COLOR.info, rest: COLOR.positive, boss: COLOR.negative };
const SOURCE: Record<string, string> = {
  floor: 'Этажи позади',
  elite: 'Элита повержена — редкая карта',
  boss: 'Босс повержен — лучшие карты',
  event: 'Награда встречи',
  start: 'Дар Башни',
  upgrade: 'Дар Башни',
};
const W = GAME_W - 2 * S.l;

/**
 * Башня испытаний — забег-рогалик (docs/design/tower-roguelite.md) в духе «Башни королей» AFK: фон этажа, лестница
 * этажей (текущий — крупно, следующие — узлами выше), чипы состояния и одна главная кнопка. Правила — «i» (лист снизу).
 * Лобби: рекорд, отряд забега рядом портретов (касание — правка), добыча дня чипами, «Улучшения», «Начать забег».
 * Забег: развилка из двух путей, превью боя/отдыха/события, раны отряда; окна выбора карты и события; листы карт и
 * улучшений.
 */
export class TowerScene extends Phaser.Scene {
  /** Выбранный путь развилки (индекс в run.paths). */
  private sel = 0;
  /** Карта-благословение уже выбрана (идёт вспышка) — повторные касания не считаются. */
  private picking = false;
  /** Старые обработчики карточек не переживают смену режима/перезапуск сцены. */
  private draftRevision = 0;
  private area?: ScrollArea;
  private panel?: ReturnType<typeof adventureModePanel>;
  private sheetRevision = 0;
  private get layout() { return adventureModeLayout(contentBottom(), CONTENT_TOP); }

  constructor() {
    super('Tower');
  }

  create(data: TowerSceneData = {}): void {
    // BUG-182: Phaser при restart()/start('Tower') без данных берёт прежние settings.data — итог боя этажа повторялся бы
    // (тосты «Этаж N пройден!», выбор пути сбрасывался на первый). Данные сцены — одноразовые.
    this.sys.settings.data = {};
    screen(this, 'Башня испытаний', 'Adventure', { to: 'Adventure' });
    markHint('tower_open');
    this.picking = false;
    this.panel = undefined;
    this.sheetRevision++;
    this.draftRevision++;
    const st = towerRunStatus(session.save, GAME, today());
    this.backdrop(st.run ? st.run.floor + 1 : Math.max(1, st.best));
    if (!st.unlocked) return this.body(() => this.locked(st.unlockAfterStage), data.scroll);
    if (data.fight) {
      this.sel = 0;
      this.afterFight(data.fight);
    }
    const run = st.run;
    if (!run) {
      this.body(() => this.lobby(), data.scroll);
      if (data.upgrades) this.upgradesSheet();
      else if (st.last && !st.last.seen) this.summary();
      // Первый вход в Башню-рогалик: Гаррет — о тропах и павших (firstTips.ts, один раз).
      else firstTip(this, 'tip_tower', TIP_Y);
      return;
    }
    if (run.node) this.sel = Math.max(0, run.paths.indexOf(run.node));
    else if (this.sel >= run.paths.length) this.sel = 0;
    this.body(() => this.runView(run), data.scroll);
    if (run.pending?.kind === 'blessing') this.blessingOverlay(run);
    else if (run.pending?.kind === 'event') this.eventOverlay(run);
  }

  /** Preserve the readable route and squad; only the main actions remain outside the world-space scroll mask. */
  private body(draw: () => void, offset = 0): void {
    const layout = this.layout;
    const area = this.area = new ScrollArea(this, layout.bodyTop, layout.bodyBottom);
    area.content.setName('towerScroll');
    const rows = collect(this.children, draw);
    const actions = rows.filter(o => ['towerStart', 'towerUpgradesBtn', 'towerGo', 'towerUnlockGo'].includes(o.name));
    const rest = rows.filter(o => !actions.includes(o));
    const bottom = Math.max(layout.bodyTop, ...rest.map(o => (o as unknown as { getBounds?: () => Phaser.Geom.Rectangle }).getBounds?.().bottom ?? layout.bodyTop));
    const body = this.add.container(0, -layout.bodyTop, rest);
    area.add(body); area.setContentHeight(bottom + S.l - layout.bodyTop); area.offset = offset;
    const footer = this.add.container(0, layout.footerY).setName('towerFooter');
    footer.add(this.add.rectangle(GAME_W / 2, 0, GAME_W, 208, COLOR_N.surface).setInteractive());
    for (const o of actions) {
      const item = o as Phaser.GameObjects.Container;
      item.setY(item.y - layout.footerY); footer.add(item);
    }
    onViewChange(this, () => { const next = this.layout; area.setBounds(next.bodyTop, next.bodyBottom); footer.setY(next.footerY); });
  }

  /** Фон — поле боя этажа (тема полосы этажей, как в бою), притушенный: узлы и чипы читаются поверх. */
  private backdrop(floor: number): void {
    const bg = screenBackground(this);
    if (!bg) return;
    setThemeBackground(bg, 'battle', themeOfTowerFloor(floor));
    const dim = this.add.graphics();
    dim.fillStyle(COLOR_N.bg, 0.45).fillRect(-GAME_W, -GAME_H, GAME_W * 3, GAME_H * 3);
    dim.fillGradientStyle(COLOR_N.bg, COLOR_N.bg, COLOR_N.bg, COLOR_N.bg, 0, 0, 0.75, 0.75).fillRect(-GAME_W, L.previewY - 300, GAME_W * 3, GAME_H - L.previewY + 300);
    dim.fillStyle(COLOR_N.bg, 0.75).fillRect(-GAME_W, GAME_H, GAME_W * 3, GAME_H);
    this.children.moveAbove(dim as unknown as Phaser.GameObjects.GameObject, bg as unknown as Phaser.GameObjects.GameObject);
  }

  private locked(stageId: string | null): void {
    const stage = GAME.content.stages.find((s) => s.id === stageId);
    const cy = CONTENT_TOP + 420;
    plate(this, GAME_W / 2, cy, W, 520, { ...SURFACE.raised, r: R.l });
    this.add.image(GAME_W / 2, cy - 140, skinIcon('lock')).setDisplaySize(120, 120).setTint(COLOR_N.title);
    text(this, GAME_W / 2, cy, 'Башня пока закрыта', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
    text(this, GAME_W / 2, cy + 100, stage ? `Откроется после этапа ${stageNo(stage, GAME)} «${stage.name}»` : 'Откроется дальше по кампании', T.body, COLOR.textSecondary, {
      wordWrap: { width: W - 2 * S.m },
      align: 'center',
    });
    cta(this, GAME_W / 2, this.layout.footerY, 'В кампанию', () => this.scene.start('Campaign')).container.setName('towerUnlockGo');
  }

  /** Сообщения после боя этажа: этаж, павшие, рекорд, руда. Итог забега — окно summary. */
  private afterFight(f: NonNullable<TowerSceneData['fight']>): void {
    const name = (id: string) => GAME.content.heroes[session.save.heroes.find((h) => h.id === id)?.templateId ?? '']?.name ?? id;
    if (f.win) toast(this, `Этаж ${f.floor} пройден!`, C.success, 2500);
    for (const e of f.events) {
      if (e.type === 'towerFallen') toast(this, `Пал: ${e.heroes.map(name).join(', ')} — до конца забега`, C.danger, 3500);
      if (e.type === 'towerRevived') toast(this, `Встаёт: ${e.heroes.map(name).join(', ')}`, C.success, 3000);
      if (e.type === 'towerRecord') toast(this, `Новый рекорд: этаж ${e.floor}! +${e.gems} гемов`, C.gold, 3000);
      if (e.type === 'blessedOre') toast(this, `Благословенная руда +${e.count}`, C.gold, 3000);
    }
  }

  // ---------- общие части ----------

  /** Полоса состояния: чипы слева, «i» (правила) справа. Возвращает x левого края «i». */
  private statusBar(chips: (ChipSpec & { name?: string; onTap?: () => void })[]): number {
    let x = S.l;
    for (const c of chips) {
      const box = chip(this, x, L.barY, c.icon, c.value, c.tone ?? 'neutral', { align: 'left' });
      if (c.name) box.setName(c.name);
      if (c.onTap) pressable(this, box, box.width, Math.max(box.height, TOUCH), c.onTap);
      x += box.width + S.xs;
    }
    const ix = GAME_W - S.l - 32;
    infoButton(this, ix, L.barY, () => this.rulesSheet()).setName('towerInfo');
    return ix - 32;
  }

  /** Узел лестницы: диск с номером этажа (босс — кубок), обводка тона. */
  private node(x: number, y: number, r: number, floor: number, opts: { tone?: string; alpha?: number } = {}): void {
    const cfg = runConfig(GAME);
    const boss = floor % cfg.bossEvery === 0;
    const tone = opts.tone ?? (boss ? COLOR.negative : COLOR.border);
    const a = opts.alpha ?? 1;
    this.add.circle(x, y, r, COLOR_N.surfaceSunken, 0.92 * a).setStrokeStyle(Math.max(4, r / 10), hexNum(tone), a);
    if (boss) this.add.image(x, y, skinIcon('trophy')).setDisplaySize(r * 1.1, r * 1.1).setTint(COLOR_N.negative).setAlpha(a);
    else text(this, x, y, String(floor), r > 52 ? T.heading : T.body, COLOR.textSecondary, { fontStyle: 'bold' }).setAlpha(a);
  }

  /** Два этажа впереди и «хвост» лестницы вверх; нижний конец линии — fromY. Вершина — тег вместо узлов. */
  private floorsAhead(first: number, fromY: number): void {
    const max = GAME.tower.maxFloor;
    const g = this.add.graphics();
    g.lineStyle(8, COLOR_N.border, 0.9);
    if (first > max) {
      tag(this, GAME_W / 2, L.near, 'Вершина взята', 'gold', { solid: true });
      return;
    }
    g.lineBetween(GAME_W / 2, fromY, GAME_W / 2, L.near);
    if (first + 1 <= max) {
      g.lineBetween(GAME_W / 2, L.near, GAME_W / 2, L.far);
      g.lineStyle(8, COLOR_N.border, 0.35).lineBetween(GAME_W / 2, L.far, GAME_W / 2, L.far - 110);
      this.node(GAME_W / 2, L.far, 46, first + 1, { alpha: 0.6 });
    }
    this.node(GAME_W / 2, L.near, 60, first);
  }

  /** Подсказки на лестнице справа: ближайший босс и рекорд — тегами (без фраз). */
  private ladderTags(next: number, best: number): void {
    const cfg = runConfig(GAME);
    const bossAt = Math.ceil(next / cfg.bossEvery) * cfg.bossEvery;
    const x = GAME_W - S.l;
    if (bossAt > next + 1 && bossAt <= GAME.tower.maxFloor) chip(this, x, L.far, 'trophy', `Босс · ${bossAt}`, 'negative', { size: 's', align: 'right' }).setName('towerBossAt');
    if (best > 0) chip(this, x, L.near, 'flag', `Рекорд ${best}`, best >= next ? 'neutral' : 'gold', { size: 's', align: 'right' }).setName('towerBest');
  }

  /** Портрет героя в рамке редкости. */
  private heroPortrait(hero: HeroState, x: number, y: number, size: number): Phaser.GameObjects.Container {
    return framedPortrait(this, x, y, heroSprite(hero, GAME), size, heroGender(hero, GAME), hero.rarity);
  }

  // ---------- лобби ----------

  private lobby(): void {
    const save = session.save;
    const st = towerRunStatus(save, GAME, today());
    this.statusBar([
      { icon: 'tower', value: st.shards, tone: 'gem', name: 'towerShards', onTap: () => this.upgradesSheet() },
      { icon: 'flag', value: `${st.runs} ${plural(st.runs, 'забег', 'забега', 'забегов')}`, name: 'towerRuns' },
    ]);

    // Лестница: рекорд — крупно, выше — этажи, которые ждут.
    this.floorsAhead(st.best + 1, L.bestY - L.bestR);
    glow(this, GAME_W / 2, L.bestY, L.bestR * 3, COLOR_N.accent, 0.3, true);
    this.add.circle(GAME_W / 2, L.bestY, L.bestR, COLOR_N.surfaceSunken, 0.95).setStrokeStyle(8, COLOR_N.accent);
    text(this, GAME_W / 2, L.bestY - 66, 'Рекорд', T.caption, COLOR.textSecondary);
    text(this, GAME_W / 2, L.bestY + 18, st.best ? String(st.best) : '—', T.display, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' })
      .setShadow(0, 3, 'rgba(0,0,0,0.7)', 6, false, true)
      .setName('towerBestFloor');
    this.ladderTags(st.best + 1, 0);

    // Прошлый забег — одной строкой чипов.
    if (st.last) {
      const l = st.last;
      const items: ChipSpec[] = [{ icon: 'flag', value: `Этаж ${l.floor}`, tone: l.record ? 'gold' : 'neutral' }, { icon: 'tower', value: `+${l.shards}`, tone: 'gem' }];
      if (l.gold) items.push({ icon: 'gold', value: `+${formatNumber(l.gold)}`, tone: 'gold' });
      text(this, S.l, L.lastY, 'Прошлый забег', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
      const row = rewardRow(this, 0, L.lastY, items, { size: 's', maxW: W - 300 });
      row.setX(GAME_W - S.l - row.width / 2).setName('towerLast');
    }

    const draftRules = runConfig(GAME).newRunDraftRules;
    if (draftRules) text(this, GAME_W / 2, L.lastY + 76, `Новый забег: карта каждые ${draftRules.blessingEvery} этажей · MVP до ${draftRules.legendaryCap}`, T.caption, COLOR.info).setName('towerNewDraftRules');
    this.squadRow();
    this.lootRow(st.lootFloorToday);

    const upW = 340;
    button(this, S.l + upW / 2, this.layout.footerY, upW, BTN.cta, '', 'Улучшения', () => this.upgradesSheet(), T.heading, { variant: 'secondary' }).container.setName('towerUpgradesBtn');
    const goW = W - upW - S.s;
    const go = cta(this, GAME_W - S.l - goW / 2, this.layout.footerY, 'Начать забег', () => this.start(), { w: goW });
    go.container.setName('towerStart');
    ctaShine(this, go.container, goW, 140);
  }

  /** Отряд забега: заголовок с мощью и ряд портретов с карандашом; касание — правка отряда. */
  private squadRow(): void {
    const save = session.save;
    const gctx = withGear(GAME, save);
    const heroes = save.squad.map((id) => (id ? save.heroes.find((h) => h.id === id) : undefined));
    const power = heroes.reduce((n, h) => n + (h ? heroPower(h, gctx) : 0), 0);
    text(this, S.l, L.squadHeadY, 'Отряд', T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    chip(this, GAME_W - S.l, L.squadHeadY, 'swords', formatNumber(power), 'neutral', { size: 's', align: 'right', bg: false });
    const h = 172;
    const box = plate(this, GAME_W / 2, L.squadY, W, h, { ...SURFACE.surface, r: R.l }).setName('towerSquad');
    const size = 132;
    const step = 150;
    const x0 = S.l + S.m + size / 2;
    heroes.forEach((hero, i) => {
      const x = x0 + i * step;
      if (hero) this.heroPortrait(hero, x, L.squadY, size);
      else plate(this, x, L.squadY, size - 12, size - 12, { ...SURFACE.sunken, r: R.m });
    });
    // Карандаш: правка отряда (без надписи — §3 п. 3).
    const px = GAME_W - S.l - S.m - 48;
    this.add.circle(px, L.squadY, 44, COLOR_N.surfaceRaised).setStrokeStyle(3, COLOR_N.border);
    pencil(this, px, L.squadY, 44);
    pressable(this, box, W, h, () => this.editSquad());
  }

  /** Добыча дня за этаж (золото и опыт в запас) чипами; оплаченные сегодня этажи — тегом. */
  private lootRow(paid: number): void {
    const cfg = runConfig(GAME);
    const save = session.save;
    let last: (typeof GAME.content.stages)[number] | null = null;
    for (const s of GAME.content.stages) if (save.campaign.cleared.includes(s.id)) last = s;
    const gold = Math.floor((last?.rewards.gold ?? 0) * cfg.lootPerFloor);
    const exp = Math.floor((last?.rewards.jobExp ?? 0) * cfg.lootPerFloor);
    if (!gold && !exp) return;
    text(this, S.l, L.lootY, 'Добыча за этаж', T.body, COLOR.textSecondary).setOrigin(0, 0.5);
    const items: ChipSpec[] = [];
    if (gold) items.push({ icon: 'gold', value: gold, tone: 'gold' });
    if (exp) items.push({ icon: 'hero_exp', value: exp });
    const row = rewardRow(this, 0, L.lootY, items, { size: 's' });
    row.setX(GAME_W - S.l - row.width / 2).setName('towerLoot');
    if (paid > 0) tag(this, GAME_W - S.l, L.lootY + 64, `сегодня — выше ${paid} этажа`, 'neutral', { align: 'right' }).setName('towerLootPaid');
  }

  private editSquad(): void {
    this.scene.start('Squad', { back: { to: 'Tower' } });
  }

  private start(): void {
    const save = session.save;
    if (!save.squad.some(Boolean)) return this.editSquad();
    if (!this.act(() => commit(startTowerRun(save, save.squad, GAME)))) return;
    this.scene.restart();
  }

  /** Действие ядра: ошибка Башни — тост. */
  private act(fn: () => void): boolean {
    try {
      fn();
      return true;
    } catch (e) {
      if (e instanceof TowerError) toast(this, e.message, C.error);
      else throw e;
      return false;
    }
  }

  // ---------- забег ----------

  private runView(run: TowerRun): void {
    const next = run.floor + 1;
    const alive = run.squad.filter((x): x is string => !!x);
    const hp = alive.length ? alive.reduce((n, id) => n + (run.hp[id] ?? 1000), 0) / alive.length / 1000 : 0;
    const hpTone: Tone = hp > 0.6 ? 'positive' : hp > 0.3 ? 'warning' : 'negative';
    const active = familyStates(run.cards, runConfig(GAME)).filter((f) => f.active).length;
    const right = this.statusBar([
      { icon: 'red_potion', value: `${Math.round(hp * 100)}%`, tone: hpTone, name: 'towerHp' },
      { icon: 'hero_card', value: active ? `${run.cards.length} · ${active}★` : run.cards.length, tone: run.cards.length ? 'info' : 'neutral', name: 'towerCards', onTap: () => this.cardsSheet(run) },
      { icon: 'tower', value: `+${run.shards}`, tone: 'gem', name: 'towerRunShards' },
    ]);
    const giveW = 200;
    button(this, right - S.xs - giveW / 2, L.barY, giveW, BTN.m, '', 'Сдаться', () => this.surrender(), T.body, { variant: 'secondary' }).container.setName('towerGiveUp');

    if (run.draftRules) chip(this, S.l, L.barY + 80, 'hero_card', this.mvpLabel(run), 'gold', { size: 's', align: 'left' }).setName('towerMvpCount');
    this.runMap(run);

    const kind = run.paths[this.sel];
    this.preview(run, kind);
    this.runSquad(run);

    const label = run.pending ? (run.pending.kind === 'blessing' ? 'Выбрать карту' : 'Продолжить встречу') : isBattleNode(kind) ? `${NODE_NAMES[kind]} · этаж ${next}` : kind === 'rest' ? 'Отдохнуть' : 'Войти';
    const go = cta(this, GAME_W / 2, this.layout.footerY, label, () => this.go(), { w: 640 });
    go.container.setName('towerGo');
    ctaShine(this, go.container, 640, 140);
  }

  /** Компактный маршрут: текущая цель и две карточки с последствиями до подтверждения. */
  private runMap(run: TowerRun): void {
    const n = run.floor + 1;
    const cfg = runConfig(GAME);
    text(this, GAME_W / 2, 440, `Этаж ${n}`, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('towerFloor');
    const bossAt = Math.ceil(n / cfg.bossEvery) * cfg.bossEvery;
    text(this, GAME_W / 2, 506, bossAt === n ? 'На этом этаже — босс' : `Ближайший босс · этаж ${bossAt}`, T.caption, COLOR.textSecondary);
    const cardW = (W - S.s) / 2;
    const cardH = 340;
    const cy = 738;
    const xs = run.paths.length === 1 ? [GAME_W / 2] : [S.l + cardW / 2, GAME_W - S.l - cardW / 2];
    run.paths.forEach((k, i) => {
      const x = xs[i];
      const on = i === this.sel;
      const locked = !!run.node && run.node !== k;
      const box = plate(this, x, cy, cardW, cardH, { ...SURFACE.raised, r: R.l,
        border: on ? COLOR.accent : COLOR.border, borderW: on ? 6 : 3 });
      box.setAlpha(locked ? 0.4 : 1);
      this.add.image(x, cy - 108, skinIcon(NODE_ICON[k])).setDisplaySize(64, 64).setTint(hexNum(NODE_TONE[k]));
      text(this, x, cy - 40, NODE_NAMES[k], T.heading, on ? COLOR.title : COLOR.textPrimary, { fontStyle: 'bold' });
      const heal = Math.round((cfg.restHeal + upgradeValue(session.save, cfg, 'restHeal')) * 100);
      const shards = cfg.shards.floor + (k === 'elite' ? cfg.shards.elite : k === 'boss' ? cfg.shards.boss : 0);
      // Финальная победа завершает забег без выбора. У события свой draft заменяет периодический,
      // а не добавляется к нему: обещаем один выбор, без второго бонуса за тот же этаж.
      const finished = isBattleNode(k) && n >= GAME.tower.maxFloor;
      const card = !finished && (k === 'elite' || k === 'boss' || n % (run.draftRules?.blessingEvery ?? cfg.blessingEvery) === 0);
      const after = finished ? '\nЗавершение забега' : card ? '\nВыбор карты' : '';
      const consequence = (isBattleNode(k) ? `Победа: +${shards} осколков`
        : k === 'rest' ? `Живым героям +${heal}% ОЗ` : 'Событие с выбором') + after;
      text(this, x, cy + 34, consequence, T.caption, COLOR.textSecondary, {
        wordWrap: { width: cardW - 2 * S.s }, align: 'center',
      }).setName(`towerPathConsequence${i}`);
      text(this, x, cy + 126, on ? 'Выбран' : 'Другой путь', T.caption, on ? COLOR.title : COLOR.textSecondary);
      if (!locked && !run.node)
        pressable(this, this.add.zone(x, cy, cardW, cardH), cardW, cardH, () => {
          if (this.sel === i) return;
          this.sel = i;
          this.scene.restart({ scroll: this.area?.offset } satisfies TowerSceneData);
        }).setName(`towerPath${i}`);
    });
  }

  /** Превью выбранного пути: враги и мощь (с разведкой) / отдых / событие — одна карточка. */
  private preview(run: TowerRun, kind: TowerNodeKind): void {
    const save = session.save;
    const y = L.previewY;
    text(this, S.l, y - 184, 'Выбранный путь', T.caption, COLOR.textSecondary).setOrigin(0, 0.5).setName('towerPreviewLabel');
    if (isBattleNode(kind)) {
      const h = 300;
      plate(this, GAME_W / 2, y, W, h, { ...SURFACE.raised, r: R.l, ...(kind !== 'battle' ? { border: COLOR.negative } : {}) });
      const pv = towerPathPreview(save, this.sel, GAME);
      let enemy = 0;
      const size = 116;
      pv.enemies!.forEach((u, i) => {
        if (!u) return;
        enemy += unitPower(u, GAME);
        const x = GAME_W / 2 + (i - 2) * 150;
        plate(this, x, y - 70, size + 12, size + 12, { ...SURFACE.sunken, r: R.m, ...(u.kind === 'boss' ? { border: COLOR.negative, borderW: 4 } : {}) });
        portrait(this, x, y - 70, portraitKey(u.visual.sprite), size).setTint(unitTint(u.visual));
      });
      powerCompare(this, GAME_W / 2, y + 48, this.runPower(run), enemy, { align: 'center' });
      // BUG-198: разведка этажа, как на экране этапа: особенности, слабость, кто из отряда ею бьёт (касание — лист).
      const mineDefs = towerRunSquad(save, GAME).squad.filter((u): u is UnitDef => !!u && run.squad.includes(u.id));
      scoutLine(this, y + 112, pv.enemies!, mineDefs, W - 2 * S.m, 0, COLOR.info);
      return;
    }
    const h = 200;
    plate(this, GAME_W / 2, y, W, h, { ...SURFACE.raised, r: R.l });
    const ix = S.l + S.m + 60;
    this.add.circle(ix, y, 60, COLOR_N.surfaceSunken).setStrokeStyle(4, hexNum(NODE_TONE[kind]));
    this.add.image(ix, y, skinIcon(NODE_ICON[kind])).setDisplaySize(72, 72).setTint(hexNum(NODE_TONE[kind]));
    const tx = ix + 60 + S.m;
    if (kind === 'rest') {
      const cfg = runConfig(GAME);
      const heal = Math.round((cfg.restHeal + upgradeValue(save, cfg, 'restHeal')) * 100);
      text(this, tx, y - 34, 'Отдых у костра', T.heading, COLOR.title, { fontStyle: 'bold' }).setOrigin(0, 0.5);
      chip(this, tx, y + 40, 'red_potion', `+${heal}%`, 'positive', { size: 's', align: 'left' });
    } else {
      text(this, tx, y - 34, 'Неизвестная встреча', T.heading, COLOR.title, { fontStyle: 'bold' }).setOrigin(0, 0.5);
      text(this, tx, y + 36, 'Алтарь, торговка, сундук…', T.body, COLOR.textSecondary).setOrigin(0, 0.5);
    }
  }

  /** Мощь живого отряда забега с учётом ран (ОЗ-часть мощи — пропорционально). */
  private runPower(run: TowerRun): number {
    const save = session.save;
    const gctx = withGear(GAME, save);
    let sum = 0;
    for (const id of run.squad) {
      const hero = id ? save.heroes.find((h) => h.id === id) : undefined;
      if (!hero) continue;
      const u = buildUnit(hero, gctx);
      const hp = (run.hp[hero.id] ?? 1000) / 1000;
      sum += unitPower({ ...u, stats: { ...u.stats, hp: Math.max(1, Math.round(u.stats.hp * hp)) } }, GAME);
    }
    return sum;
  }

  /** Отряд забега: портреты в ряд, под каждым — полоса ОЗ; павшие — бледные, с крестом. */
  private runSquad(run: TowerRun): void {
    const save = session.save;
    const y = L.runSquadY;
    text(this, S.l, y - 90, run.fallen.length ? `Отряд · павших ${run.fallen.length}` : 'Отряд · здоровье перед следующим этажом', T.caption, COLOR.textSecondary).setOrigin(0, 0.5).setName('towerSquadLabel');
    const heroes = [...run.squad.filter((x): x is string => !!x).map((id) => ({ id, dead: false })), ...run.fallen.map((id) => ({ id, dead: true }))].slice(0, 5);
    const size = 128;
    const step = 176;
    heroes.forEach(({ id, dead }, i) => {
      const hero = save.heroes.find((h) => h.id === id);
      if (!hero) return;
      const x = GAME_W / 2 + (i - (heroes.length - 1) / 2) * step;
      const face = this.heroPortrait(hero, x, y, size);
      const bw = size - 8;
      const by = y + size / 2 + 22;
      this.add.rectangle(x, by, bw + 6, 18, COLOR_N.surfaceSunken).setStrokeStyle(2, COLOR_N.border);
      if (dead) {
        face.setAlpha(0.4);
        const g = this.add.graphics().lineStyle(10, COLOR_N.negative, 0.9);
        g.lineBetween(x - 34, y - 34, x + 34, y + 34).lineBetween(x - 34, y + 34, x + 34, y - 34);
        return;
      }
      const hp = Phaser.Math.Clamp((run.hp[id] ?? 1000) / 1000, 0, 1);
      const col = hp > 0.5 ? COLOR_N.positive : hp > 0.25 ? COLOR_N.warning : COLOR_N.negative;
      if (hp > 0) this.add.rectangle(x - bw / 2, by, bw * hp, 12, col).setOrigin(0, 0.5);
    });
  }

  private go(): void {
    if (this.area?.locked) return;
    const save = session.save;
    const run = save.tower.run!;
    if (run.pending?.kind === 'blessing') return this.blessingOverlay(run);
    if (run.pending?.kind === 'event') return this.eventOverlay(run);
    const kind = run.paths[this.sel];
    if (!run.node) {
      if (!this.act(() => commit(chooseTowerPath(save, this.sel, GAME)))) return;
    }
    if (isBattleNode(kind)) {
      this.scene.start('Battle', { mode: 'tower' });
      return;
    }
    if (kind === 'rest') toast(this, session.save.tower.run?.note ?? 'Отряд отдохнул', C.success, 3000);
    this.sel = 0;
    this.scene.restart();
  }

  private surrender(): void {
    confirm(
      this,
      'Сдаться? Забег закончится, награда — за пройденные этажи.',
      'Сдаться',
      () => {
        this.act(() => commit(abandonTowerRun(session.save, today(), GAME).save));
        this.scene.restart();
      },
      { danger: true },
    );
  }

  // ---------- листы снизу ----------

  /** «i»: как устроен забег — пять строк с иконками (вместо постоянного блока правил). */
  private rulesSheet(): void {
    const cfg = runConfig(GAME);
    const run = session.save.tower.run;
    // Активный старый забег никогда не заимствует правила будущих забегов.
    const draftRules = run ? run.draftRules : cfg.newRunDraftRules;
    const every = draftRules?.blessingEvery ?? cfg.blessingEvery;
    const rules: [string, string][] = [
      ['red_potion', 'После победы — частичное лечение, на отдыхе — ещё. Павших могут вернуть особые благословения и события.'],
      ['hero_card', `Каждые ${every} ${plural(every, 'этаж', 'этажа', 'этажей')} и после элиты — карта на выбор: она меняет правила боя.`],
      ['trophy', `Каждый ${cfg.bossEvery}-й этаж — босс. Рекордные этажи приносят гемы.`],
      ['flag', 'Поражение или «Сдаться» — конец забега.'],
      ['tower', 'Осколки — за каждый забег, на улучшения. Добыча — раз в день за новые этажи.'],
    ];
    if (draftRules) rules.splice(2, 0, ['hero_card', `MVP-карт одновременно: ${draftRules.legendaryCap}. Новую можно обменять на действующую или оставить сборку. Воскрешение при получении Осириса — один раз за забег; боевое воскрешение сохраняется.`]);
    bottomSheet(this, 'Как устроен забег', (c, width) => {
      let y = 0;
      for (const [icon, line] of rules) {
        const t = text(this, 96 + S.s, y, line, T.body, COLOR.textPrimary, { wordWrap: { width: width - 96 - S.s }, align: 'left', lineSpacing: 10 }).setOrigin(0, 0);
        const ic = plate(this, 48, y + 48, 96, 96, { ...SURFACE.sunken, r: R.m });
        c.add([ic, t]);
        const g = iconOf(this, 48, y + 48, icon, 60, icon === 'tower' ? COLOR.gem : COLOR.title);
        if (g) c.add(g);
        y += Math.max(96, t.height) + S.m;
      }
      c.setName('towerRules');
      return y - S.m;
    }, { onClose: this.lockSheet() });
  }

  /** Карты забега и бонусы видов — лист снизу. */
  private cardsSheet(run: TowerRun): void {
    const cfg = runConfig(GAME);
    if (!run.cards.length) {
      toast(this, `Первая карта — после ${run.draftRules?.blessingEvery ?? cfg.blessingEvery}-го этажа`, C.muted);
      return;
    }
    bottomSheet(this, 'Карты забега', (c, width) => {
      c.setName('towerCardsList');
      let y = 0;
      if (run.draftRules) {
        c.add(text(this, 0, y, this.mvpLabel(run), T.body, COLOR.gold).setOrigin(0, 0));
        y += 72;
      }
      for (const id of run.cards) {
        const b = cfg.blessings.find((x) => x.id === id);
        if (!b) continue;
        const thumb = this.cardThumb(b, 56, y + 56, 112, c);
        c.add(thumb);
        const name = text(this, 112 + S.s, y + 10, b.name, T.body, RARITY_COLOR[b.rarity], { fontStyle: 'bold' }).setOrigin(0, 0);
        const body = text(this, 112 + S.s, y + 10 + name.height + 4, this.blessingText(b, run), T.caption, COLOR.textSecondary, { wordWrap: { width: width - 112 - S.s }, align: 'left' }).setOrigin(0, 0);
        c.add([name, body]);
        y += Math.max(112, name.height + body.height + 14) + S.s;
      }
      const fams = familyStates(run.cards, cfg).filter((f) => f.count);
      if (fams.length) {
        y += S.xs;
        c.add(text(this, 0, y, 'Виды', T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0));
        y += 72;
        for (const f of fams) {
          const head = `${f.family.name} ${f.count}/${f.family.need}`;
          const ht = text(this, 0, y, head, T.body, f.active ? f.family.color : COLOR.textTertiary, { fontStyle: 'bold' }).setOrigin(0, 0);
          const bt = text(this, 0, y + ht.height + 2, f.family.bonusText.replace(/^\d+ [^:]+: /, ''), T.caption, f.active ? COLOR.textPrimary : COLOR.textTertiary, {
            wordWrap: { width },
            align: 'left',
          }).setOrigin(0, 0);
          c.add([ht, bt]);
          y += ht.height + bt.height + S.s;
        }
      }
      return y;
    }, { onClose: this.lockSheet() });
  }

  /** Постоянные улучшения за осколки: строки с уровнем и ценой; покупка — на месте, экран обновится при закрытии. */
  private upgradesSheet(): void {
    const cfg = runConfig(GAME);
    let bought = false;
    const rows: { refresh: () => void }[] = [];
    let shardsChip: Phaser.GameObjects.Container | null = null;
    bottomSheet(
      this,
      'Улучшения Башни',
      (c, width) => {
        c.setName('towerUpgrades');
        const shards = () => session.save.tower.shards ?? 0;
        const head = () => {
          shardsChip?.destroy();
          shardsChip = chip(this, 0, 36, 'tower', shards(), 'gem', { align: 'left' });
          c.add(shardsChip);
        };
        head();
        const rowH = 160;
        const btnW = 230;
        cfg.upgrades.forEach((u, i) => {
          const y = 104 + i * (rowH + S.xxs) + rowH / 2;
          c.add(plate(this, width / 2, y, width, rowH, { ...SURFACE.surface, r: R.m }));
          const name = text(this, S.s, y - rowH / 2 + 36, u.name, T.body, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
          const lvl = text(this, 0, name.y, '', T.caption, COLOR.textSecondary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
          const desc = text(this, S.s, name.y + 30, u.text, T.caption, COLOR.textSecondary, { wordWrap: { width: width - btnW - 3 * S.s }, align: 'left' }).setOrigin(0, 0);
          clampLines(desc, 2);
          const b: ButtonView = button(this, width - S.s - btnW / 2, y, btnW, BTN.m, '', '', () => {
            if (upgradeLevel(session.save, u.id) >= u.costs.length) return;
            if (!this.act(() => commit(buyTowerUpgrade(session.save, u.id, GAME)))) return;
            bought = true;
            sfx('level_up');
            head();
            for (const r of rows) r.refresh();
          }, T.body, { variant: 'secondary' });
          b.container.setName(`towerUpgrade${i}`);
          c.add([name, lvl, desc, b.container]);
          const refresh = () => {
            const lv = upgradeLevel(session.save, u.id);
            const max = lv >= u.costs.length;
            lvl.setText(`${lv}/${u.costs.length}`).setX(S.s + name.width + S.xs).setColor(max ? COLOR.positive : COLOR.textSecondary);
            b.setLabel(max ? 'Макс.' : `${u.costs[lv]} оск.`);
            b.setEnabled(!max && shards() >= u.costs[lv]);
          };
          refresh();
          rows.push({ refresh });
        });
        return 104 + cfg.upgrades.length * (rowH + S.xxs) - S.xxs;
      },
      { onClose: this.lockSheet(() => { if (bought) this.scene.restart({ scroll: this.area?.offset } satisfies TowerSceneData); }) },
    );
  }

  private lockSheet(onClose?: () => void): () => void {
    const area = this.area, revision = ++this.sheetRevision;
    if (area) area.locked = true;
    return () => {
      if (this.area !== area || this.sheetRevision !== revision) return;
      if (area) area.locked = false;
      onClose?.();
    };
  }

  // ---------- окна ----------

  /** Затемнение и слой окна поверх экрана. */
  private overlay(name: string, title: string): ReturnType<typeof adventureModePanel> {
    if (this.area) this.area.locked = true;
    const panel = this.panel = adventureModePanel(this, name, title, { footerH: 180, onClose: () => {
      if (this.area) this.area.locked = false;
      this.draftRevision++;
      if (name === 'towerSummary' && session.save.tower.last && !session.save.tower.last.seen) commit(markTowerSummarySeen(session.save));
    } });
    panel.content.setX(0);
    const back = button(this, panel.width / 2, 90, 720, 132, '', 'Вернуться к забегу', panel.close, T.body, { variant: 'secondary' });
    panel.footer.add(back.container.setName('towerModalBack'));
    return panel;
  }

  private panelHeight(content: Phaser.GameObjects.Container): void {
    const h = Math.max(0, ...content.list.map(o => (o as unknown as { getBounds?: () => Phaser.Geom.Rectangle }).getBounds?.().bottom ?? 0));
    const m = content.getWorldTransformMatrix();
    this.panel?.setHeight(h - m.ty + S.l);
  }

  private panelAction(button: ButtonView): void {
    if (!this.panel) return;
    this.panel.footer.removeAll(true);
    button.container.parentContainer?.remove(button.container);
    button.container.setPosition(this.panel.width / 2, 90);
    this.panel.footer.add(button.container);
  }

  /** В живом отряде забега есть лекарь (роль healer). */
  private hasHealer(run: TowerRun): boolean {
    return run.squad.some((id) => {
      const h = id ? session.save.heroes.find((x) => x.id === id) : undefined;
      return !!h && buildUnit(h, GAME).role === 'healer';
    });
  }

  /** Миниатюра карты: рамка редкости, портрет монстра (или значок), рисунок карты RO — когда загрузится. */
  private cardThumb(b: Blessing, x: number, y: number, size: number, owner: Phaser.GameObjects.Container): Phaser.GameObjects.Container {
    const box = this.add.container(x, y);
    box.add(plate(this, 0, 0, size, size, { fill: COLOR.surfaceSunken, border: RARITY_COLOR[b.rarity], borderW: 4, r: R.s }));
    const u = b.monster ? GAME.content.units[b.monster] : undefined;
    if (u) box.add(portrait(this, 0, 0, portraitKey(u.visual.sprite), size * 0.8).setTint(unitTint(u.visual)));
    else box.add(this.add.image(0, 0, skinIcon((b.icon ?? 'star') as SkinIcon)).setDisplaySize(size * 0.6, size * 0.6).setTint(COLOR_N.title));
    showCardArt(this, b.id, 0, 0, size - 10, (img) => { if (box.scene) box.add(img); else img.destroy(); }, owner);
    return box;
  }

  /** Выбор 1 из 3 (4) карт-благословений: чистые карточки — рамка редкости, рисунок, имя, одна строка эффекта. */
  private blessingOverlay(run: TowerRun): void {
    const cfg = runConfig(GAME);
    const p = run.pending;
    if (p?.kind !== 'blessing') return;
    if (run.draftRules) return this.draftOverlay();
    const modal = this.overlay('towerBlessing', 'Выберите карту');
    const layer = modal.content;
    const add = <O extends Phaser.GameObjects.GameObject>(o: O) => (layer.add(o), o);
    add(text(this, GAME_W / 2, 250, 'Выберите карту', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' })).setShadow(0, 3, 'rgba(0,0,0,0.8)', 6, false, true);
    add(text(this, GAME_W / 2, 320, SOURCE[p.source] ?? '', T.body, COLOR.textSecondary));
    const n = p.options.length;
    const h = n > 3 ? 290 : 350;
    const gap = S.s;
    const y0 = 380 + h / 2;
    p.options.forEach((id, i) => {
      const b = cfg.blessings.find((x) => x.id === id)!;
      const y = y0 + i * (h + gap);
      const rc = RARITY_COLOR[b.rarity];
      const box = add(plate(this, GAME_W / 2, y, W, h, { fill: COLOR.surfaceRaised, border: rc, borderW: 6, r: R.l, hl: 0.15 }));
      if (b.rarity === 'legendary') add(glow(this, GAME_W / 2, y, 128, hexNum(rc), 0.18).setDisplaySize(W + 80, h + 60));
      // Рисунок: рисунок карты RO (по требованию) или портрет монстра; полоска вида внизу.
      const aw = 200;
      const ah = h - 2 * S.s;
      const ax = S.l + S.s + aw / 2;
      const frame = add(plate(this, ax, y, aw, ah, { fill: COLOR.surfaceSunken, border: rc, borderW: 3, r: R.m }));
      const art = showCardArt(this, b.id, ax, y - 20, Math.min(240, ah - 60), (img) => {
        // Окно уже «влетело» (popIn перенёс всё во внутренний контейнер) — рисунок ложится туда же, над подложкой.
        const into = frame.parentContainer ?? layer;
        img.setPosition(img.x - into.x, img.y - into.y);
        into.addAt(img, into.getIndex(frame) + 1);
      }, layer);
      const u = b.monster ? GAME.content.units[b.monster] : undefined;
      if (u) add(portrait(this, art ? ax + 60 : ax, art ? y + ah / 2 - 90 : y - 16, portraitKey(u.visual.sprite), art ? 72 : 160).setTint(unitTint(u.visual)));
      else add(this.add.image(ax, y - 16, skinIcon((b.icon ?? 'star') as SkinIcon)).setDisplaySize(110, 110).setTint(COLOR_N.title));
      const fam = cfg.families.find((f) => f.id === b.family)!;
      add(plate(this, ax, y + ah / 2 - 26, aw - 16, 40, { fill: fam.color, alpha: 0.92, r: R.s }));
      add(text(this, ax, y + ah / 2 - 26, fam.name, T.caption, COLOR.onAccent, { fontStyle: 'bold' }));
      // Текст: имя, теги (цена, нет лекаря), эффект, бонус вида.
      const tx = ax + aw / 2 + S.m;
      const tw = GAME_W - S.l - S.m - tx;
      const top = y - h / 2;
      const name = add(text(this, tx, top + 52, b.name, T.heading, rc, { fontStyle: 'bold' }).setOrigin(0, 0.5));
      ellipsize(name, tw);
      const body = add(text(this, tx, top + 98, b.text, T.body, COLOR.textPrimary, { wordWrap: { width: tw }, align: 'left', lineSpacing: 8 }).setOrigin(0, 0));
      clampLines(body, n > 3 ? 2 : 3);
      // Низ карточки: теги (цена, нет лекаря) справа, бонус вида — слева, если карта его включит.
      const footY = top + h - 44;
      let tagX = GAME_W - S.l - S.s;
      const tags: Phaser.GameObjects.Container[] = [];
      // BUG-197: карта с условием «лекарь» — честно, если лекаря в отряде нет.
      if (b.effects.some((e) => e.kind === 'reviveOnce' && e.healer) && !this.hasHealer(run)) tags.push(tag(this, tagX, footY, 'нет лекаря', 'negative').setName('towerNoHealer'));
      if (b.cost) tags.push(tag(this, tagX, footY, 'с ценой', 'negative'));
      for (const t of tags) {
        t.setX(tagX - t.width / 2);
        tagX -= t.width + S.xxs;
        add(t);
      }
      const now = familyStates(run.cards, cfg).find((f) => f.family.id === fam.id)!;
      if (!now.active && now.count + 1 >= fam.need) {
        const bt = add(text(this, tx, footY, `Бонус вида: ${fam.bonusText.replace(/^\d+ [^:]+: /, '')}`, T.caption, fam.color, { fontStyle: 'bold' }).setOrigin(0, 0.5));
        ellipsize(bt, tagX - tx - S.xs);
      }
      pressable(this, box, W, h, () => {
        if (this.picking) return;
        let events: TowerRunEvent[] = [];
        if (
          !this.act(() => {
            const out = pickTowerBlessing(session.save, id, GAME);
            events = out.events;
            commit(out.save);
          })
        )
          return;
        // Выбор принят: звон Blessing, лёгкий толчок и вспышка рамки карты — потом экран забега.
        this.picking = true;
        sfx('bless_pick');
        haptic('blessPick');
        const ms = this.flashCard(layer, box, hexNum(rc));
        this.time.delayedCall(ms, () => this.scene.restart({ fight: { floor: 0, win: false, events } } satisfies TowerSceneData));
      }).setName(`towerCard${i}`);
    });
    if (run.rerolls > 0) {
      const b = button(this, GAME_W / 2, y0 + (n - 1) * (h + gap) + h / 2 + S.l + BTN.l / 2, 520, BTN.l, '', `Перетасовать (${run.rerolls})`, () => {
        this.act(() => commit(rerollTowerBlessing(session.save, GAME)));
        this.scene.restart();
      }, T.body, { variant: 'secondary' });
      b.container.setName('towerReroll');
      layer.add(b.container);
    }
    this.panelHeight(layer);
  }

  /** Подпись временных MVP-карт: предел относится только к текущему забегу. */
  private mvpLabel(run: TowerRun): string {
    const cfg = runConfig(GAME);
    const count = run.cards.filter((id) => cfg.blessings.find((b) => b.id === id)?.rarity === 'legendary').length;
    return `MVP ${count}/${run.draftRules!.legendaryCap}`;
  }

  /** Осирис: честная подпись разового получения, отдельная от воскрешения в бою. */
  private blessingText(b: Blessing, run: TowerRun): string {
    const immediate = b.effects.find((e) => e.kind === 'reviveRun');
    if (!run.draftRules || !immediate || immediate.kind !== 'reviveRun') return b.text;
    const used = run.consumedImmediateCards?.includes(b.id);
    const acquire = used ? 'Воскрешение при получении уже использовано.' : `Первое получение: павшие встают с ${Math.round(immediate.hpPct * 100)}% ОЗ (раз за забег).`;
    const battle = b.effects.find((e) => e.kind === 'reviveOnce');
    return `${acquire}${battle?.kind === 'reviveOnce' ? ` Раз за бой павший встаёт с ${Math.round(battle.hpPct * 100)}% ОЗ${battle.healer ? ' при живом лекаре' : ''}.` : ''}`;
  }

  /** Одна оболочка выбора: сравнение заменяет содержимое, не создавая второе модальное окно. */
  private draftOverlay(): void {
    const modal = this.overlay('towerBlessing', 'Выберите карту');
    const content = this.add.container(0, 0).setName('towerDraftContent');
    modal.content.add(content);
    this.draftChoices(content);
  }

  /** Защита от касания старого выбора после перетасовки, смены режима или обновления сохранения. */
  private draftGuard(run: TowerRun): () => boolean {
    const revision = ++this.draftRevision;
    const offer = JSON.stringify(run.pending);
    return () => {
      const fresh = session.save.tower.run;
      return !this.picking && revision === this.draftRevision && !!fresh?.draftRules && fresh.seed === run.seed && fresh.floor === run.floor && JSON.stringify(fresh.pending) === offer;
    };
  }

  /** Все изменения берут актуальное сохранение; блокировка охватывает commit и последующую анимацию. */
  private finishDraft(work: () => TowerRunEvent[], content: Phaser.GameObjects.Container, card?: Panel): void {
    if (this.picking) return;
    this.picking = true;
    let events: TowerRunEvent[] = [];
    if (!this.act(() => { events = work(); })) { this.picking = false; return; }
    const disable = (o: Phaser.GameObjects.GameObject): void => {
      if (o.input) o.disableInteractive();
      if (o instanceof Phaser.GameObjects.Container) o.list.forEach(disable);
    };
    disable(content);
    if (card) { sfx('bless_pick'); haptic('blessPick'); }
    const ms = card ? this.flashCard(content, card, COLOR_N.accent) : 0;
    this.time.delayedCall(ms, () => this.scene.restart({ fight: { floor: 0, win: false, events } } satisfies TowerSceneData));
  }

  private keepDraft(content: Phaser.GameObjects.Container): void {
    this.finishDraft(() => { commit(skipTowerBlessing(session.save, GAME)); return []; }, content);
  }

  /** Три/четыре полных предложения и оплаченные перетасовки остаются доступны до подтверждения. */
  private draftChoices(content: Phaser.GameObjects.Container): void {
    const run = session.save.tower.run;
    if (!run?.draftRules || run.pending?.kind !== 'blessing') return;
    const cfg = runConfig(GAME), p = run.pending;
    const ready = this.draftGuard(run);
    content.removeAll(true);
    const add = <O extends Phaser.GameObjects.GameObject>(o: O) => (content.add(o), o);
    add(text(this, GAME_W / 2, 150, 'Выберите карту', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }));
    add(text(this, GAME_W / 2, 222, SOURCE[p.source] ?? '', T.body, COLOR.textSecondary));
    add(text(this, GAME_W / 2, 282, `${this.mvpLabel(run)} · карты только на этот забег`, T.caption, COLOR.gold)).setName('towerDraftMvp');
    if (p.exhausted || !p.options.length) {
      add(text(this, GAME_W / 2, 740, 'Все подходящие карты уже действуют.\nСборка останется прежней.', T.heading, COLOR.textPrimary, { wordWrap: { width: W - S.l }, align: 'center' })).setName('towerDraftExhausted');
      if (p.exchange) add(text(this, GAME_W / 2, 920, 'Карта для обмена не потрачена.', T.body, COLOR.positive));
    }
    const n = p.options.length, h = n > 3 ? 268 : 340, gap = S.xs;
    p.options.forEach((id, i) => {
      const b = cfg.blessings.find((x) => x.id === id)!;
      const preview = previewTowerBlessingChoice(session.save, id, GAME);
      const top = 336 + i * (h + gap), cy = top + h / 2;
      const rc = RARITY_COLOR[b.rarity];
      const box = add(plate(this, GAME_W / 2, cy, W, h, { fill: COLOR.surfaceRaised, border: rc, borderW: 5, r: R.l }));
      const thumb = this.cardThumb(b, S.l + 96, cy, 148, content);
      add(thumb);
      const tx = S.l + 196, tw = W - 220;
      const title = add(text(this, tx, top + 20, b.name, T.body, rc, { fontStyle: 'bold' }).setOrigin(0, 0));
      ellipsize(title, tw);
      const body = add(text(this, tx, top + 72, this.blessingText(b, run), T.caption, COLOR.textPrimary, { wordWrap: { width: tw }, align: 'left', lineSpacing: 4 }).setOrigin(0, 0));
      clampLines(body, n > 3 ? 4 : 5);
      const family = cfg.families.find((f) => f.id === b.family)!;
      const action = preview.requiresReplacement ? 'выбор замены MVP' : p.exchange ? 'сравнить обмен' : family.name;
      add(text(this, tx, top + h - 30, action, T.caption, preview.requiresReplacement ? COLOR.gold : family.color).setOrigin(0, 0.5));
      if (b.effects.some((e) => e.kind === 'reviveOnce' && e.healer) && !this.hasHealer(run)) add(tag(this, S.l + 96, cy + 102, 'нет лекаря', 'negative').setName('towerNoHealer'));
      else if (b.cost) add(tag(this, S.l + 96, cy + 102, 'с ценой', 'negative'));
      pressable(this, box, W, h, () => {
        if (!ready()) return;
        if (preview.requiresReplacement || p.exchange) { this.draftComparison(content, id); return; }
        this.finishDraft(() => {
          const out = pickTowerBlessing(session.save, id, GAME);
          commit(out.save);
          return out.events;
        }, content, box);
      }).setName(`towerCard${i}`);
    });
    if (run.rerolls > 0 && !p.exhausted && p.options.length) {
      const reroll = button(this, GAME_W / 2, 1570, 720, BTN.l, '', `Перетасовать (${run.rerolls})`, () => {
        if (!ready()) return;
        this.finishDraft(() => { commit(rerollTowerBlessing(session.save, GAME)); return []; }, content);
      }, T.body, { variant: 'secondary' });
      add(reroll.container.setName('towerReroll'));
    }
    const keep = button(this, GAME_W / 2, 1750, 840, BTN.l, '', 'Оставить текущую сборку', () => { if (ready()) this.keepDraft(content); }, T.body, { variant: 'secondary' });
    add(keep.container.setName('towerDraftKeep'));
    this.panelAction(keep);
    this.panelHeight(content);
  }

  /** Сравнение входящей и явно выбранной уходящей карты с итоговыми бонусами видов. */
  private draftComparison(content: Phaser.GameObjects.Container, incomingId: string, replaceCardId?: string): void {
    const run = session.save.tower.run;
    if (!run?.draftRules || run.pending?.kind !== 'blessing') return;
    const cfg = runConfig(GAME), p = run.pending;
    const preview = previewTowerBlessingChoice(session.save, incomingId, GAME, { replaceCardId });
    const ready = this.draftGuard(run);
    content.removeAll(true);
    const add = <O extends Phaser.GameObjects.GameObject>(o: O) => (content.add(o), o);
    add(text(this, GAME_W / 2, 128, 'Сравнение карт', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' })).setName('towerDraftCompare');
    add(text(this, GAME_W / 2, 198, this.mvpLabel(run), T.body, COLOR.gold));
    const incoming = cfg.blessings.find((b) => b.id === incomingId)!;
    const card = (b: Blessing, top: number, heading: string, tint: string): Panel => {
      const panel = add(plate(this, GAME_W / 2, top + 155, W, 310, { fill: COLOR.surfaceRaised, border: tint, borderW: 4, r: R.l }));
      add(this.cardThumb(b, S.l + 104, top + 160, 160, content));
      const tx = S.l + 216, tw = W - 248;
      add(text(this, tx, top + 16, heading, T.caption, tint).setOrigin(0, 0));
      const name = add(text(this, tx, top + 62, b.name, T.body, RARITY_COLOR[b.rarity], { fontStyle: 'bold' }).setOrigin(0, 0));
      ellipsize(name, tw);
      add(text(this, tx, top + 118, this.blessingText(b, run), T.caption, COLOR.textPrimary, { wordWrap: { width: tw }, align: 'left', lineSpacing: 4 }).setOrigin(0, 0));
      return panel;
    };
    const incomingBox = card(incoming, 246, 'Войдёт в сборку', COLOR.positive);
    const candidates = preview.replacementCandidates;
    if (candidates.length) {
      add(text(this, GAME_W / 2, 606, 'Какую действующую MVP-карту заменить?', T.body, COLOR.title));
      const bw = (W - (candidates.length - 1) * S.xs) / candidates.length;
      candidates.forEach((id, i) => {
        const b = cfg.blessings.find((x) => x.id === id)!;
        const buttonView = button(this, S.l + bw / 2 + i * (bw + S.xs), 690, bw, BTN.l, '', `${id === replaceCardId ? '✓ ' : ''}${b.name.replace(/^Карта /, '')}`, () => {
          if (ready()) this.draftComparison(content, incomingId, id);
        }, T.caption, { variant: 'secondary' });
        add(buttonView.container.setName(`towerReplace${i}`));
      });
    }
    const outgoing = cfg.blessings.find((b) => b.id === preview.outgoingCardId);
    if (outgoing) {
      card(outgoing, 794, 'Уйдёт из сборки', COLOR.negative);
      add(text(this, GAME_W / 2, 1146, 'Все действующие эффекты уходящей карты исчезнут.', T.caption, COLOR.negative, { wordWrap: { width: W }, align: 'center' })).setName('towerDraftEffectsRemoved');
    } else add(text(this, GAME_W / 2, 920, 'Выберите уходящую карту для сравнения.', T.body, COLOR.textSecondary, { wordWrap: { width: W }, align: 'center' }));
    const familyNames = (ids: string[]) => ids.map((id) => cfg.families.find((f) => f.id === id)?.name ?? id).join(', ');
    const changes = preview.requiresReplacement ? 'Бонусы видов появятся после выбора замены.' : [
      preview.familiesGained.length ? `Включится бонус вида: ${familyNames(preview.familiesGained)}` : '',
      preview.familiesLost.length ? `Отключится бонус вида: ${familyNames(preview.familiesLost)}` : '',
    ].filter(Boolean).join('\n') || 'Бонусы видов не изменятся.';
    add(text(this, GAME_W / 2, 1240, changes, T.caption, COLOR.textPrimary, { wordWrap: { width: W }, align: 'center' })).setName('towerDraftFamilies');
    if (preview.exchangeSourcePreserved && p.exchange) {
      const source = cfg.blessings.find((b) => b.id === p.exchange!.sourceCardId)!;
      add(text(this, GAME_W / 2, 1360, `${source.name} остаётся.\nОбменяется только выбранная MVP-карта.`, T.caption, COLOR.positive, { wordWrap: { width: W }, align: 'center' })).setName('towerDraftSourcePreserved');
    }
    const accept = button(this, GAME_W / 2, 1510, 840, BTN.l, '', 'Заменить', () => {
      if (!ready() || preview.requiresReplacement) return;
      this.finishDraft(() => {
        const out = pickTowerBlessing(session.save, incomingId, GAME, { replaceCardId });
        commit(out.save);
        return out.events;
      }, content, incomingBox);
    }, T.body, { variant: 'secondary' });
    accept.setEnabled(!preview.requiresReplacement);
    add(accept.container.setName('towerDraftConfirm'));
    const back = button(this, GAME_W / 2, 1670, 840, BTN.l, '', 'Назад к картам', () => { if (ready()) this.draftChoices(content); }, T.body, { variant: 'secondary' });
    add(back.container.setName('towerDraftBack'));
    const keep = button(this, GAME_W / 2, 1830, 840, BTN.l, '', 'Оставить текущую сборку', () => { if (ready()) this.keepDraft(content); }, T.body, { variant: 'secondary' });
    add(keep.container.setName('towerDraftKeep'));
    this.panelAction(accept);
    this.panelHeight(content);
  }

  /**
   * Вспышка рамки выбранной карты: белая рамка поверх и светлый отблеск, гаснут за ~0.3 с. «Меньше движения» — только
   * рамка, без анимации. Возвращает, сколько мс ждать перед переходом.
   */
  private flashCard(layer: Phaser.GameObjects.Container, box: Panel, tint: number): number {
    const frame = this.add.rectangle(box.x, box.y, box.width + 16, box.height + 16).setStrokeStyle(14, 0xffffff, 1);
    const shine = this.add.rectangle(box.x, box.y, box.width, box.height, tint, 0.35);
    (box.parentContainer ?? layer).add([shine, frame]);
    if (motion.reduced) return 200;
    this.tweens.add({ targets: frame, scaleX: 1.03, scaleY: 1.06, alpha: 0, duration: 340, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: shine, alpha: 0, duration: 340, ease: 'Quad.easeOut' });
    return 340;
  }

  /** Событие этажа: одна карточка — рисунок, название, текст; варианты — кнопки (условие — подписью под кнопкой). */
  private eventOverlay(run: TowerRun): void {
    const ev = towerEventDef(session.save, GAME);
    if (!ev) return;
    const ready = run.draftRules ? this.draftGuard(run) : () => true;
    const modal = this.overlay('towerEvent', ev.title);
    const layer = modal.content;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const add = <O extends Phaser.GameObjects.GameObject>(o: O) => (parts.push(o), o);
    const inner = W - 2 * S.l;
    const cfg = runConfig(GAME);
    const last = cfg.blessings.find((b) => b.id === run.cards.at(-1));
    const exchange = !!run.draftRules && ev.options.some((o) => o.outcomes.some((x) => x.kind === 'upgradeCard')) && !!last;
    const full = !!run.draftRules && run.cards.filter((id) => cfg.blessings.find((b) => b.id === id)?.rarity === 'legendary').length >= run.draftRules.legendaryCap;
    const mvpExchange = exchange && full && last!.rarity === 'rare';
    const exchangeText = mvpExchange
      ? `Писарь предложит MVP-карту. Обменяется одна действующая MVP-карта; ${last!.name} останется. После сравнения можно отказаться.`
      : exchange && full && last!.rarity === 'common'
        ? `За редкую карту уйдёт ${last!.name}. За MVP уйдёт выбранная MVP-карта, а ${last!.name} останется. Обмен — только после сравнения.`
        : exchange ? `${last!.name} обменяется на ${last!.rarity === 'legendary' ? 'другую MVP-карту' : 'карту на ступень выше'}. До подтверждения карта остаётся в сборке; можно отказаться.` : ev.text;
    const body = add(text(this, GAME_W / 2, 0, exchangeText, T.body, COLOR.textPrimary, { wordWrap: { width: inner }, align: 'center', lineSpacing: 10 }));
    const optH = BTN.l;
    const optGap = S.s;
    const optionHints = ev.options.map((o) => exchange && o.outcomes.some((x) => x.kind === 'upgradeCard') ? 'Карта спишется только после подтверждения' : o.hint);
    const hints = optionHints.map((hint) => hint ? 44 : 0);
    const optsH = ev.options.reduce((n, _o, i) => n + optH + hints[i] + optGap, 0) - optGap;
    const artH = 200;
    const h = S.l + artH + S.s + 70 + S.s + body.height + S.l + optsH + S.l;
    const top = 0;
    const card = plate(this, GAME_W / 2, h / 2, W, h, { fill: COLOR.surfaceRaised, border: COLOR.accent, borderW: 4, r: R.xl, hl: 0.15 });
    parts.unshift(card);
    let y = top + S.l + artH / 2;
    const u = ev.monster ? GAME.content.units[ev.monster] : undefined;
    add(glow(this, GAME_W / 2, y, artH * 1.8, COLOR_N.accent, 0.25));
    if (u) add(portrait(this, GAME_W / 2, y, portraitKey(u.visual.sprite), artH).setTint(unitTint(u.visual)));
    else add(this.add.image(GAME_W / 2, y, skinIcon((ev.icon ?? 'scroll') as SkinIcon)).setDisplaySize(150, 150).setTint(COLOR_N.title));
    y += artH / 2 + S.s + 35;
    add(text(this, GAME_W / 2, y, ev.title, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }));
    y += 35 + S.s;
    body.setY(y + body.height / 2);
    y += body.height + S.l;
    ev.options.forEach((o, i) => {
      const ok = eventOptionAllowed(run, o);
      const by = y + optH / 2;
      const label = mvpExchange && o.outcomes.some((x) => x.kind === 'upgradeCard') ? 'Заменить MVP-карту' : o.label;
      const b = button(this, GAME_W / 2, by, inner, optH, '', label, () => {
        if (!ready()) return;
        if (!ok) {
          toast(this, 'Не хватает условий для этого варианта', C.warning);
          return;
        }
        if (run.draftRules) this.picking = true;
        let msg = '';
        let events: TowerRunEvent[] = [];
        if (
          !this.act(() => {
            const out = resolveTowerEvent(session.save, i, GAME);
            msg = out.text;
            events = out.events;
            commit(out.save);
          })
        )
          { this.picking = false; return; }
        toast(this, msg, C.success, 3500);
        this.scene.restart({ fight: { floor: 0, win: false, events } } satisfies TowerSceneData);
      }, T.heading, { variant: i === 0 && ok ? 'primary' : 'secondary' });
      if (!ok) b.setEnabled(false);
      ellipsize(b.label, inner - 2 * S.m);
      b.container.setName(`towerEventOpt${i}`);
      add(b.container);
      y += optH;
      if (optionHints[i]) {
        add(text(this, GAME_W / 2, y + 26, optionHints[i], T.caption, ok ? COLOR.textSecondary : COLOR.textTertiary));
        y += hints[i];
      }
      y += optGap;
    });
    layer.add(parts);
    this.panelHeight(layer);
  }

  /** Итог забега: этаж крупно, рекорд, награды чипами, «Дальше». */
  private summary(): void {
    const l = session.save.tower.last!;
    const modal = this.overlay('towerSummary', 'Итог забега');
    const layer = modal.content;
    const add = <O extends Phaser.GameObjects.GameObject>(o: O) => (layer.add(o), o);
    const items: ChipSpec[] = [{ icon: 'tower', value: `+${l.shards}`, tone: 'gem' }];
    if (l.gold) items.push({ icon: 'gold', value: `+${formatNumber(l.gold)}`, tone: 'gold' });
    if (l.jobExp) items.push({ icon: 'hero_exp', value: `+${formatNumber(l.jobExp)}` });
    if (l.gems) items.push({ icon: 'gems', value: `+${l.gems}`, tone: 'gem' });
    const noLoot = !l.gold && !l.jobExp;
    const chipsY = l.record ? 500 : 440;
    const h = chipsY + (noLoot ? 80 : 0) + 250;
    const top = 0;
    add(plate(this, GAME_W / 2, h / 2, W - 40, h, { fill: COLOR.surfaceRaised, border: l.record ? COLOR.accent : COLOR.border, borderW: 4, r: R.xl, hl: 0.15 }));
    add(text(this, GAME_W / 2, top + 90, l.won ? 'Вершина взята!' : 'Забег окончен', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }));
    // BUG-196: чем кончился забег и сколько пройдено — «пройдено этажей: 3», рекорд — в тех же единицах, что «Лучший этаж».
    const why = l.end === 'defeat' ? `Поражение на этаже ${l.floor + 1}` : l.end === 'surrender' ? `Вы сдались на этаже ${l.floor + 1}` : l.won ? 'Все этажи пройдены' : '';
    if (why) add(text(this, GAME_W / 2, top + 160, why, T.body, l.end === 'defeat' ? COLOR.negative : COLOR.textSecondary, { fontStyle: 'bold' }).setName('towerSummaryWhy'));
    if (l.record) add(glow(this, GAME_W / 2, top + 315, 420, COLOR_N.accent, 0.35, true));
    add(text(this, GAME_W / 2, top + 240, 'Пройдено этажей', T.caption, COLOR.textSecondary));
    add(text(this, GAME_W / 2, top + 315, String(l.floor), T.display, l.record ? COLOR.gold : COLOR.textPrimary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('towerSummaryFloor'));
    if (l.record) add(tag(this, GAME_W / 2, top + 400, 'Новый рекорд!', 'gold', { solid: true }));
    add(rewardRow(this, GAME_W / 2, top + chipsY, items, { maxW: W - 120 }).setName('towerSummaryRewards'));
    if (noLoot) add(text(this, GAME_W / 2, top + chipsY + 80, 'Добыча за эти этажи сегодня уже получена', T.caption, COLOR.textTertiary));
    const b = cta(this, GAME_W / 2, top + h - 110, 'Дальше', () => {
      commit(markTowerSummarySeen(session.save));
      this.scene.restart();
    }, { w: 520 });
    b.container.setName('towerSummaryOk');
    layer.add(b.container);
    this.panelAction(b);
    this.panelHeight(layer);
  }
}

/** Карандаш (правка): наклонный стержень с грифелем — графикой, своей иконки в скине нет. */
function pencil(scene: Phaser.Scene, x: number, y: number, r: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics({ x, y });
  const s = r / 44;
  g.fillStyle(COLOR_N.title, 1);
  g.fillPoints([new Phaser.Geom.Point(-18 * s, 10 * s), new Phaser.Geom.Point(10 * s, -18 * s), new Phaser.Geom.Point(18 * s, -10 * s), new Phaser.Geom.Point(-10 * s, 18 * s)], true);
  g.fillTriangle(-18 * s, 10 * s, -10 * s, 18 * s, -22 * s, 22 * s);
  g.fillStyle(COLOR_N.surfaceSunken, 1).fillCircle(-21 * s, 21 * s, 2.5 * s);
  return g;
}
