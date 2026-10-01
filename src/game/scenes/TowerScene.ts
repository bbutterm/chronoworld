import Phaser from 'phaser';
import { markHint } from '../hints';
import {
  abandonTowerRun,
  buildUnit,
  buyTowerUpgrade,
  chooseTowerPath,
  eventOptionAllowed,
  familyStates,
  heroPower,
  isBattleNode,
  markTowerSummarySeen,
  NODE_NAMES,
  pickTowerBlessing,
  rerollTowerBlessing,
  resolveTowerEvent,
  runConfig,
  startTowerRun,
  towerEventDef,
  towerPathPreview,
  towerRunStatus,
  TowerError,
  unitPower,
  upgradeLevel,
  upgradeValue,
  withGear,
  type Blessing,
  type TowerNodeKind,
  type TowerRun,
  type TowerRunEvent,
} from '../../core';
import { GAME } from '../content';
import { formatNumber, heroSprite, POWER_COLORS, powerTone, stageNo } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, confirm, CONTENT_TOP, portrait, screen, unitTint } from '../screen';
import { showCardArt } from '../cardArt';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { button, panel, pressable, text, toast } from '../ui';
import { ctaShine, glow, medallion } from '../decor';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from '../skin';
import { C, FS } from '../theme';
import { sfx } from '../audio';
import { firstTip } from '../firstTips';
import { haptic } from '../haptics';
import { motion } from '../state';

/** Что вернул бой этажа (BattleScene → Tower). */
export interface TowerSceneData {
  fight?: { floor: number; win: boolean; events: TowerRunEvent[] };
  /** Открыть окно улучшений (после покупки). */
  upgrades?: boolean;
}

/** Подсказка первого входа: верхний край (лобби — между строкой добычи и кнопками, ничего не закрывает). */
const TIP_Y = 1320;
const RARITY_COLOR: Record<Blessing['rarity'], number> = { common: 0xc8b89a, rare: 0x4aa8ff, legendary: 0xffb830 };
const RARITY_TEXT: Record<Blessing['rarity'], string> = { common: '#e0d4bc', rare: '#8ec8ff', legendary: '#ffcf60' };
const RARITY_NAME: Record<Blessing['rarity'], string> = { common: 'обычная', rare: 'редкая', legendary: 'легендарная' };
const NODE_ICON: Record<TowerNodeKind, SkinIcon> = { battle: 'swords', elite: 'swords', event: 'scroll', rest: 'home', boss: 'trophy' };
const NODE_TINT: Record<TowerNodeKind, number> = { battle: 0xf0cf8a, elite: 0xff8a6a, event: 0x9fd0ff, rest: 0x9fe0a6, boss: 0xff5a4a };
const SLOT_X = (i: number, w = 200) => GAME_W / 2 + (i - 2) * w;
const OVERLAY_DEPTH = 5000;

/**
 * Башня испытаний — забег-рогалик (docs/design/tower-roguelite.md): лобби (рекорд, осколки, улучшения, отряд, «Начать
 * забег») и экран забега (карта этажей с развилкой, превью боя, раны отряда, карты), окна выбора карты и события.
 */
export class TowerScene extends Phaser.Scene {
  /** Выбранный путь развилки (индекс в run.paths). */
  private sel = 0;
  /** Карта-благословение уже выбрана (идёт вспышка) — повторные касания не считаются. */
  private picking = false;

  constructor() {
    super('Tower');
  }

  create(data: TowerSceneData = {}): void {
    screen(this, 'Башня испытаний', 'Adventure', { to: 'Adventure' });
    markHint('tower_open');
    this.picking = false;
    const st = towerRunStatus(session.save, GAME, today());
    if (!st.unlocked) return this.locked(st.unlockAfterStage);
    if (data.fight) {
      this.sel = 0;
      this.afterFight(data.fight);
    }
    const run = st.run;
    if (!run) {
      this.lobby();
      if (data.upgrades) this.upgradesOverlay();
      else if (st.last && !st.last.seen) this.summary();
      // Первый вход в Башню-рогалик: Гаррет — о тропах, картах и павших (firstTips.ts, один раз).
      else firstTip(this, 'tip_tower', TIP_Y);
      return;
    }
    if (run.node) this.sel = Math.max(0, run.paths.indexOf(run.node));
    else if (this.sel >= run.paths.length) this.sel = 0;
    this.runView(run);
    if (run.pending?.kind === 'blessing') this.blessingOverlay(run);
    else if (run.pending?.kind === 'event') this.eventOverlay(run);
  }

  private locked(stageId: string | null): void {
    const top = CONTENT_TOP;
    const stage = GAME.content.stages.find((s) => s.id === stageId);
    card(this, GAME_W / 2, top + 300, 1000, 500);
    this.add.image(GAME_W / 2, top + 160, skinIcon('lock')).setDisplaySize(120, 120).setTint(SKIN_TINT.gold);
    text(this, GAME_W / 2, top + 300, 'Башня пока закрыта', FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 });
    text(this, GAME_W / 2, top + 380, stage ? `Пройдите этап ${stageNo(stage, GAME)} «${stage.name}» кампании` : 'Пройдите кампанию дальше', FS.h3, C.text, {
      wordWrap: { width: 880 },
    });
    button(this, GAME_W / 2, top + 650, 640, 140, 'ui_btn_primary', 'В кампанию', () => this.scene.start('Campaign'), FS.h1);
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

  // ---------- лобби ----------

  private lobby(): void {
    const save = session.save;
    const st = towerRunStatus(save, GAME, today());
    const top = CONTENT_TOP;
    card(this, GAME_W / 2, top + 170, 1040, 330);
    text(this, 70, top + 55, 'Лучший этаж', FS.body, C.muted).setOrigin(0, 0.5);
    text(this, 70, top + 140, `${st.best}`, 110, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 }).setOrigin(0, 0.5);
    text(this, 70, top + 235, `Осколки башни: ${st.shards}`, FS.h3, C.gem, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5);
    text(this, 70, top + 290, `Забегов: ${st.runs}`, FS.small, C.muted).setOrigin(0, 0.5);
    glow(this, 820, top + 160, 300, 0xffc860, 0.35, true);
    medallion(this, 820, top + 160, 200, 'tower');

    // Прошлый забег.
    let y = top + 370;
    if (st.last) {
      const l = st.last;
      const parts = [`этаж ${l.floor}${l.record ? ' — рекорд!' : ''}`, `осколки +${l.shards}`];
      if (l.gold) parts.push(`золото +${formatNumber(l.gold)}`);
      text(this, GAME_W / 2, y, `Прошлый забег: ${parts.join(' · ')}`, FS.small, l.record ? C.gold : C.muted, { wordWrap: { width: 980 }, align: 'center' });
      y += 50;
    }

    // Правила — коротко.
    const rules = [
      'Отряд идёт вверх без передышки: раны остаются, павший выбывает до конца забега.',
      'Каждые 3 этажа и после элиты — карта-благословение: она меняет правила боя.',
      'Поражение или «Сдаться» — конец забега. Осколки — за каждый забег, добыча — раз в день за новые этажи.',
    ];
    card(this, GAME_W / 2, y + 200, 1040, 380, true);
    text(this, GAME_W / 2, y + 45, 'Как устроен забег', FS.h3, C.inkGold, { fontStyle: 'bold' });
    rules.forEach((r, i) => text(this, 80, y + 110 + i * 95, `• ${r}`, FS.small, C.ink, { wordWrap: { width: 920 }, lineSpacing: 2, align: 'left' }).setOrigin(0, 0.5));
    y += 410;

    // Отряд забега.
    this.squadCard(y);
    y += 290;
    const loot = st.lootFloorToday;
    text(this, GAME_W / 2, y, loot > 0 ? `Добыча сегодня уже получена за этажи 1–${loot}; выше — с добычей` : 'Сегодня забег принесёт добычу за каждый этаж', FS.small, C.muted, {
      wordWrap: { width: 980 },
      align: 'center',
    });

    button(this, 260, 1650, 420, 140, 'ui_btn_secondary', 'Улучшения', () => this.upgradesOverlay(), FS.h3);
    const go = button(this, 760, 1650, 520, 140, 'ui_btn_primary', 'Начать забег', () => this.start(), FS.h2);
    go.container.setName('towerStart');
    ctaShine(this, go.container, 520, 140);
  }

  private squadCard(y: number): void {
    const save = session.save;
    const gctx = withGear(GAME, save);
    pressable(this, card(this, GAME_W / 2, y + 125, 1040, 260, true), 1040, 260, () => this.editSquad());
    text(this, GAME_W / 2, y + 25, 'Отряд забега — нажмите, чтобы изменить', FS.small, C.ink, { fontStyle: 'bold' });
    save.squad.forEach((id, i) => {
      const x = SLOT_X(i);
      const hero = id ? save.heroes.find((h) => h.id === id) : undefined;
      if (!hero) {
        text(this, x, y + 130, 'пусто', FS.small, C.placeholder);
        return;
      }
      portrait(this, x, y + 115, portraitKey(heroSprite(hero, GAME)), 120);
      text(this, x, y + 205, formatNumber(heroPower(hero, gctx)), FS.small, C.ink, { fontStyle: 'bold' });
    });
  }

  private editSquad(): void {
    this.scene.start('Squad', { back: { to: 'Tower' } });
  }

  private start(): void {
    const save = session.save;
    if (!save.squad.some(Boolean)) return this.editSquad();
    this.act(() => commit(startTowerRun(save, save.squad, GAME)));
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
    const save = session.save;
    const top = CONTENT_TOP;
    const cfg = runConfig(GAME);
    const next = run.floor + 1;
    // Шапка: этаж, рекорд, осколки, «Сдаться».
    card(this, GAME_W / 2, top + 75, 1040, 150);
    text(this, 60, top + 50, `Этаж ${next}`, FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    text(this, 60, top + 110, `Рекорд ${save.tower.floor} · осколки +${run.shards}`, FS.small, C.muted).setOrigin(0, 0.5);
    button(this, 900, top + 75, 230, 100, 'ui_btn_secondary', 'Сдаться', () => this.surrender(), FS.body).container.setName('towerGiveUp');

    this.runMap(run);

    // Превью выбранного пути.
    const kind = run.paths[this.sel];
    const py = 1070;
    card(this, GAME_W / 2, py, 1040, 260, true);
    if (isBattleNode(kind)) {
      const pv = towerPathPreview(save, this.sel, GAME);
      text(this, GAME_W / 2, py - 105, `${NODE_NAMES[kind]} · этаж ${pv.floor}`, FS.h3, kind === 'battle' ? C.inkGold : C.danger, { fontStyle: 'bold' });
      let enemy = 0;
      pv.enemies!.forEach((u, i) => {
        if (!u) return;
        enemy += unitPower(u, GAME);
        const x = SLOT_X(i);
        portrait(this, x, py - 5, portraitKey(u.visual.sprite), 110).setTint(unitTint(u.visual));
        if (u.kind === 'boss') this.add.rectangle(x, py - 5, 120, 120).setStrokeStyle(5, 0xd64545);
      });
      const mine = this.runPower(run);
      const tone = powerTone(mine, enemy);
      text(this, GAME_W / 2, py + 95, `Мощь: отряд ${formatNumber(mine)} · враги ${formatNumber(enemy)}`, FS.small, POWER_COLORS[tone], {
        fontStyle: 'bold',
        stroke: C.stroke,
        strokeThickness: 4,
      });
    } else {
      const heal = Math.round((cfg.restHeal + upgradeValue(save, cfg, 'restHeal')) * 100);
      const title = kind === 'rest' ? 'Отдых у костра' : 'Событие';
      const body = kind === 'rest' ? `Отряд лечится на ${heal}% ОЗ. Этаж засчитан.` : 'Неизвестная встреча: алтарь, торговка, сундук… Решать вам.';
      text(this, GAME_W / 2, py - 70, title, FS.h3, C.inkGold, { fontStyle: 'bold' });
      text(this, GAME_W / 2, py + 10, body, FS.small, C.ink, { wordWrap: { width: 920 }, align: 'center' });
    }
    this.runSquad(run, 1325);
    this.cardsRow(run, 1485);

    const label = isBattleNode(kind) ? 'В бой' : kind === 'rest' ? 'Отдохнуть' : 'Войти';
    glow(this, GAME_W / 2, 1650, 128, 0xffc860, 0.2, true).setScale(700 / 128, 280 / 128);
    const go = button(this, GAME_W / 2, 1650, 600, 140, 'ui_btn_primary', label, () => this.go(), FS.hero);
    go.container.setName('towerGo');
    ctaShine(this, go.container, 600, 140);
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

  /** Карта забега: пройденный этаж внизу, развилка, следующий этаж «?» и ближайший босс. */
  private runMap(run: TowerRun): void {
    const cfg = runConfig(GAME);
    const n = run.floor + 1;
    const yCur = 875;
    const yFork = 640;
    const yNext = 440;
    const g = this.add.graphics();
    const xs = run.paths.length === 1 ? [GAME_W / 2 + 1] : [330, 750];
    // Линии: текущий → развилка → следующий.
    g.lineStyle(10, 0x6a5030, 1);
    for (const x of xs) {
      g.lineBetween(GAME_W / 2, yCur - 50, x, yFork + 80);
      g.lineBetween(x, yFork - 80, GAME_W / 2, yNext + 50);
    }
    // Ближайший босс и карта.
    const bossAt = Math.ceil(n / cfg.bossEvery) * cfg.bossEvery;
    const blessIn = cfg.blessingEvery - (run.floor % cfg.blessingEvery);
    text(this, GAME_W / 2, 360, `Босс — этаж ${bossAt} · карта через ${blessIn} эт.`, FS.small, C.muted, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 });
    // Следующий-следующий этаж — неизвестен.
    this.add.circle(GAME_W / 2, yNext, 55, 0x241a10).setStrokeStyle(5, 0x6a5030);
    text(this, GAME_W / 2, yNext, (n + 1) % cfg.bossEvery === 0 ? 'Б' : '?', FS.h2, C.dim, { fontStyle: 'bold' });
    text(this, GAME_W / 2 + 80, yNext, `этаж ${n + 1}`, FS.caption, C.dim).setOrigin(0, 0.5);
    // Развилка.
    run.paths.forEach((k, i) => {
      const x = xs[i];
      const on = i === this.sel;
      const locked = !!run.node && run.node !== k;
      const disc = this.add.circle(x, yFork, 95, on ? 0x4a3418 : 0x241a10).setStrokeStyle(on ? 10 : 6, on ? 0xffd84a : NODE_TINT[k]);
      if (locked) disc.setAlpha(0.4);
      this.add.image(x, yFork - 12, skinIcon(NODE_ICON[k])).setDisplaySize(84, 84).setTint(NODE_TINT[k]).setAlpha(locked ? 0.4 : 1);
      text(this, x + (x < GAME_W / 2 ? -120 : 120), yFork, NODE_NAMES[k], FS.h3, on ? SKIN.goldLight : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(
        x < GAME_W / 2 ? 1 : 0,
        0.5,
      );
      if (!locked && !run.node)
        pressable(this, this.add.rectangle(x, yFork + 20, 260, 280, 0, 0.001), 260, 280, () => {
          this.sel = i;
          this.scene.restart();
        }).setName(`towerPath${i}`);
    });
    // Пройденный этаж.
    this.add.circle(GAME_W / 2, yCur, 50, 0x2e4a2a).setStrokeStyle(6, 0x9fe0a6);
    this.add.image(GAME_W / 2, yCur, skinIcon('check')).setDisplaySize(48, 48).setTint(0x9fe0a6);
    text(this, GAME_W / 2 + 75, yCur, run.floor ? `пройдено ${run.floor}` : 'вход', FS.caption, C.success, { stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5);
  }

  /** Отряд забега: портреты, полоса ОЗ, павшие — серые. */
  private runSquad(run: TowerRun, y: number): void {
    const save = session.save;
    card(this, GAME_W / 2, y, 1040, 200, true);
    const heroes = [...run.squad.filter((x): x is string => !!x).map((id) => ({ id, dead: false })), ...run.fallen.map((id) => ({ id, dead: true }))].slice(0, 5);
    heroes.forEach(({ id, dead }, i) => {
      const hero = save.heroes.find((h) => h.id === id);
      if (!hero) return;
      const x = SLOT_X(i);
      const img = portrait(this, x, y - 20, portraitKey(heroSprite(hero, GAME)), 110);
      const hp = dead ? 0 : (run.hp[id] ?? 1000) / 1000;
      this.add.rectangle(x, y + 60, 150, 16, 0x1a120a).setStrokeStyle(2, 0x000000);
      if (hp > 0) this.add.rectangle(x - 75 + (150 * hp) / 2, y + 60, 150 * hp, 12, hp > 0.5 ? 0x5ed36a : hp > 0.25 ? 0xf0c040 : 0xe05040);
      if (dead) {
        img.setTint(0x555555).setAlpha(0.6);
        text(this, x, y - 20, 'пал', FS.h3, C.danger, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
      } else text(this, x, y + 88, `${Math.round(hp * 100)}%`, FS.caption, C.ink);
    });
  }

  /** Карты забега — ряд значков; касание — список карт и бонусов видов. */
  private cardsRow(run: TowerRun, y: number): void {
    const cfg = runConfig(GAME);
    if (!run.cards.length) {
      text(this, GAME_W / 2, y, 'Карт пока нет — первая после 3-го этажа', FS.small, C.muted);
      return;
    }
    const size = 76;
    const max = 9;
    const shown = run.cards.slice(0, max);
    const x0 = 80;
    shown.forEach((id, i) => {
      const b = cfg.blessings.find((x) => x.id === id);
      if (b) this.cardIcon(b, x0 + i * (size + 10), y, size);
    });
    const active = familyStates(run.cards, cfg).filter((f) => f.active).length;
    const label = `${run.cards.length} карт${active ? ` · бонусов: ${active}` : ''} ›`;
    text(this, GAME_W - 50, y, run.cards.length > max ? `+${run.cards.length - max} ›` : label, FS.small, C.gold, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    pressable(this, this.add.rectangle(GAME_W / 2, y, 1040, 100, 0, 0.001), 1040, 100, () => this.cardsOverlay(run)).setName('towerCards');
  }

  /** Значок карты: рамка по редкости, портрет монстра (или значок); в окне (owner) — поверх рисунок карты RO. */
  private cardIcon(b: Blessing, x: number, y: number, size: number, depth = 0, owner?: Phaser.GameObjects.Container): void {
    const fam = runConfig(GAME).families.find((f) => f.id === b.family);
    this.add.rectangle(x, y, size, size, 0x1c140c, 0.95).setStrokeStyle(Math.max(3, size / 16), RARITY_COLOR[b.rarity]).setDepth(depth);
    if (fam) this.add.rectangle(x, y + size / 2 - size * 0.07, size - 8, size * 0.1, Phaser.Display.Color.HexStringToColor(fam.color).color).setDepth(depth);
    const u = b.monster ? GAME.content.units[b.monster] : undefined;
    if (u) portrait(this, x, y - size * 0.05, portraitKey(u.visual.sprite), size * 0.78).setTint(unitTint(u.visual)).setDepth(depth);
    else
      this.add
        .image(x, y - size * 0.05, skinIcon((b.icon ?? 'star') as SkinIcon))
        .setDisplaySize(size * 0.6, size * 0.6)
        .setTint(0xffe08a)
        .setDepth(depth);
    if (owner) showCardArt(this, b.id, x, y - size * 0.05, size * 0.8, (img) => img.setDepth(depth), owner);
  }

  private go(): void {
    const save = session.save;
    const run = save.tower.run!;
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

  // ---------- окна ----------

  /** Затемнение и слой окна поверх экрана. */
  private overlay(): Phaser.GameObjects.Container {
    const layer = this.add.container(0, 0).setDepth(OVERLAY_DEPTH);
    layer.add(this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W * 2, GAME_H * 2, 0x000000, 0.78).setInteractive());
    return layer;
  }

  /** Выбор 1 из 3 (4) карт-благословений. */
  private blessingOverlay(run: TowerRun): void {
    const cfg = runConfig(GAME);
    const p = run.pending;
    if (p?.kind !== 'blessing') return;
    const layer = this.overlay().setName('towerBlessing');
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (layer.add(o), o);
    const src = { floor: 'Этажи позади — выберите благословение', elite: 'Элита повержена — редкая карта', boss: 'Босс повержен — лучшие карты', event: 'Награда встречи', start: 'Дар Башни', upgrade: 'Дар Башни' }[p.source];
    add(text(this, GAME_W / 2, 230, 'Выберите карту', FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 7 }));
    add(text(this, GAME_W / 2, 300, src, FS.body, C.muted));
    const n = p.options.length;
    const h = n > 3 ? 290 : 350;
    const gap = 24;
    const y0 = 360 + h / 2;
    p.options.forEach((id, i) => {
      const b = cfg.blessings.find((x) => x.id === id)!;
      const y = y0 + i * (h + gap);
      const w = 1000;
      const box = add(this.add.rectangle(GAME_W / 2, y, w, h, 0x21170d, 1).setStrokeStyle(8, RARITY_COLOR[b.rarity]));
      // Иллюстрация.
      const ix = GAME_W / 2 - w / 2 + 120;
      const frame = add(this.add.rectangle(ix, y, 190, h - 40, 0x120c07).setStrokeStyle(3, RARITY_COLOR[b.rarity]));
      // Рисунок карты RO (по требованию) под маленьким портретом монстра; без рисунка — крупный портрет.
      const art = showCardArt(this, b.id, ix, y - 21, Math.min(240, h - 96), (img) => layer.addAt(img, layer.getIndex(frame) + 1), layer);
      const u = b.monster ? GAME.content.units[b.monster] : undefined;
      if (u) add(portrait(this, art ? ix + 56 : ix, art ? y + h / 2 - 108 : y - 10, portraitKey(u.visual.sprite), art ? 72 : 170).setTint(unitTint(u.visual)));
      else add(this.add.image(ix, y - 10, skinIcon((b.icon ?? 'star') as SkinIcon)).setDisplaySize(120, 120).setTint(0xffe08a));
      const fam = cfg.families.find((f) => f.id === b.family)!;
      const famColor = fam.color;
      add(this.add.rectangle(ix, y + h / 2 - 45, 170, 34, Phaser.Display.Color.HexStringToColor(famColor).color, 0.9));
      add(text(this, ix, y + h / 2 - 45, fam.name, 24, '#1a1008', { fontStyle: 'bold' }));
      // Текст.
      const tx = ix + 125;
      add(text(this, tx, y - h / 2 + 45, b.name, FS.h3, RARITY_TEXT[b.rarity], { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5));
      add(text(this, tx, y - h / 2 + 92, `${RARITY_NAME[b.rarity]}${b.cost ? ' · с ценой' : ''}`, FS.caption, b.cost ? C.danger : C.dim).setOrigin(0, 0.5));
      add(text(this, tx, y - h / 2 + 125, b.text, FS.small, C.text, { wordWrap: { width: 720 }, lineSpacing: 2, align: 'left' }).setOrigin(0, 0));
      // Станет ли активен бонус вида.
      const now = familyStates(run.cards, cfg).find((f) => f.family.id === fam.id)!;
      if (!now.active && now.count + 1 >= fam.need) add(text(this, tx, y + h / 2 - 32, `Бонус вида: ${fam.bonusText.replace(/^\d+ [^:]+: /, '')}`, 24, famColor, { fontStyle: 'bold', wordWrap: { width: 720 }, align: 'left' }).setOrigin(0, 0.5));
      pressable(this, box, w, h, () => {
        if (this.picking) return;
        let events: TowerRunEvent[] = [];
        if (!this.act(() => {
          const out = pickTowerBlessing(session.save, id, GAME);
          events = out.events;
          commit(out.save);
        }))
          return;
        // Выбор принят: звон Blessing, лёгкий толчок и вспышка рамки карты — потом экран забега.
        this.picking = true;
        sfx('bless_pick');
        haptic('blessPick');
        const ms = this.flashCard(layer, box, RARITY_COLOR[b.rarity]);
        this.time.delayedCall(ms, () => this.scene.restart({ fight: { floor: 0, win: false, events } } satisfies TowerSceneData));
      }).setName(`towerCard${i}`);
    });
    if (run.rerolls > 0) {
      const b = button(this, GAME_W / 2, y0 + n * (h + gap) + 40, 520, 110, 'ui_btn_secondary', `Перетасовать (${run.rerolls})`, () => {
        this.act(() => commit(rerollTowerBlessing(session.save, GAME)));
        this.scene.restart();
      }, FS.body);
      layer.add(b.container);
    }
  }

  /**
   * Вспышка рамки выбранной карты: белая рамка поверх и светлый отблеск, гаснут за ~0.3 с. «Меньше движения» — только
   * рамка, без анимации. Возвращает, сколько мс ждать перед переходом.
   */
  private flashCard(layer: Phaser.GameObjects.Container, box: Phaser.GameObjects.Rectangle, tint: number): number {
    const frame = this.add.rectangle(box.x, box.y, box.width + 16, box.height + 16).setStrokeStyle(14, 0xffffff, 1);
    const shine = this.add.rectangle(box.x, box.y, box.width, box.height, tint, 0.35);
    layer.add([shine, frame]);
    if (motion.reduced) return 200;
    this.tweens.add({ targets: frame, scaleX: 1.03, scaleY: 1.06, alpha: 0, duration: 340, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: shine, alpha: 0, duration: 340, ease: 'Quad.easeOut' });
    return 340;
  }

  /** Событие этажа: текст и 1–3 варианта. */
  private eventOverlay(run: TowerRun): void {
    const ev = towerEventDef(session.save, GAME);
    if (!ev) return;
    const layer = this.overlay().setName('towerEvent');
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (layer.add(o), o);
    const h = 560 + ev.options.length * 190;
    const cy = GAME_H / 2;
    add(panel(this, GAME_W / 2, cy, 1000, h, 'ui_panel'));
    const top = cy - h / 2;
    add(text(this, GAME_W / 2, top + 70, ev.title, FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }));
    const u = ev.monster ? GAME.content.units[ev.monster] : undefined;
    if (u) add(portrait(this, GAME_W / 2, top + 210, portraitKey(u.visual.sprite), 180).setTint(unitTint(u.visual)));
    else add(this.add.image(GAME_W / 2, top + 210, skinIcon((ev.icon ?? 'scroll') as SkinIcon)).setDisplaySize(140, 140).setTint(0xffe08a));
    add(text(this, GAME_W / 2, top + 390, ev.text, FS.body, C.text, { wordWrap: { width: 880 }, align: 'center', lineSpacing: 4 }));
    ev.options.forEach((o, i) => {
      const y = top + 560 + i * 190;
      const ok = eventOptionAllowed(run, o);
      const b = button(this, GAME_W / 2, y, 880, 120, ok ? 'ui_btn_primary' : 'skin_btn_disabled', o.label, () => {
        if (!ok) {
          toast(this, 'Не хватает условий для этого варианта', C.warning);
          return;
        }
        let msg = '';
        let events: TowerRunEvent[] = [];
        if (!this.act(() => {
          const out = resolveTowerEvent(session.save, i, GAME);
          msg = out.text;
          events = out.events;
          commit(out.save);
        }))
          return;
        toast(this, msg, C.success, 3500);
        this.scene.restart({ fight: { floor: 0, win: false, events } } satisfies TowerSceneData);
      }, FS.h3);
      b.container.setName(`towerEventOpt${i}`);
      layer.add(b.container);
      if (o.hint) add(text(this, GAME_W / 2, y + 80, o.hint, FS.caption, ok ? C.muted : C.disabled));
    });
  }

  /** Список карт забега и бонусов видов. */
  private cardsOverlay(run: TowerRun): void {
    const cfg = runConfig(GAME);
    const layer = this.overlay().setName('towerCardsList');
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (layer.add(o), o);
    add(text(this, GAME_W / 2, 200, 'Карты забега', FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }));
    const rows = run.cards.slice(0, 10);
    rows.forEach((id, i) => {
      const b = cfg.blessings.find((x) => x.id === id);
      if (!b) return;
      const y = 320 + i * 118;
      this.cardIcon(b, 110, y, 96, OVERLAY_DEPTH + 1, layer);
      add(text(this, 180, y - 28, b.name, FS.body, RARITY_TEXT[b.rarity], { fontStyle: 'bold' }).setOrigin(0, 0.5));
      add(text(this, 180, y + 14, b.text, 24, C.text, { wordWrap: { width: 840 }, align: 'left' }).setOrigin(0, 0.3));
    });
    let y = 320 + rows.length * 118 + 20;
    for (const f of familyStates(run.cards, cfg)) {
      if (!f.count) continue;
      add(text(this, 80, y, `${f.family.name}: ${f.count}/${f.family.need}${f.active ? ' ✓' : ''} — ${f.family.bonusText}`, 26, f.active ? f.family.color : C.dim, { wordWrap: { width: 920 }, align: 'left' }).setOrigin(0, 0.5));
      y += 50;
    }
    const b = button(this, GAME_W / 2, Math.min(1700, y + 90), 420, 120, 'ui_btn_primary', 'Закрыть', () => this.scene.restart(), FS.h3);
    layer.add(b.container);
  }

  /** Постоянные улучшения за осколки башни. */
  private upgradesOverlay(): void {
    const cfg = runConfig(GAME);
    const save = session.save;
    const layer = this.overlay().setName('towerUpgrades');
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (layer.add(o), o);
    add(text(this, GAME_W / 2, 200, 'Улучшения Башни', FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }));
    add(text(this, GAME_W / 2, 270, `Осколки башни: ${save.tower.shards ?? 0}`, FS.h3, C.gem, { fontStyle: 'bold' }));
    cfg.upgrades.forEach((u, i) => {
      const y = 400 + i * 175;
      const lvl = upgradeLevel(save, u.id);
      const max = lvl >= u.costs.length;
      add(panel(this, GAME_W / 2, y, 1020, 160, 'ui_panel'));
      add(text(this, 50, y - 45, `${u.name}  ${lvl}/${u.costs.length}`, FS.h3, max ? C.success : C.title, { fontStyle: 'bold' }).setOrigin(0, 0.5));
      add(text(this, 50, y + 20, u.text, 26, C.muted, { wordWrap: { width: 660 }, align: 'left' }).setOrigin(0, 0.5));
      const b = button(this, 880, y, 250, 110, max ? 'skin_btn_disabled' : 'ui_btn_primary', max ? 'Макс.' : `${u.costs[lvl]} оск.`, () => {
        if (max) return;
        if (this.act(() => commit(buyTowerUpgrade(session.save, u.id, GAME)))) {
          this.scene.restart({ upgrades: true } satisfies TowerSceneData);
        }
      }, FS.body);
      b.container.setName(`towerUpgrade${i}`);
      layer.add(b.container);
    });
    const close = button(this, GAME_W / 2, 400 + cfg.upgrades.length * 175 + 30, 420, 120, 'ui_btn_secondary', 'Закрыть', () => this.scene.restart(), FS.h3);
    layer.add(close.container);
  }

  /** Итог забега: этаж, осколки, добыча. */
  private summary(): void {
    const l = session.save.tower.last!;
    const layer = this.overlay().setName('towerSummary');
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (layer.add(o), o);
    const cy = GAME_H / 2;
    add(panel(this, GAME_W / 2, cy, 960, 900, 'ui_panel'));
    add(text(this, GAME_W / 2, cy - 360, l.won ? 'Вершина взята!' : 'Забег окончен', FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 7 }));
    add(text(this, GAME_W / 2, cy - 250, `Этаж ${l.floor}`, 100, l.record ? C.gold : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 8 }));
    if (l.record) add(text(this, GAME_W / 2, cy - 160, 'Новый рекорд!', FS.h2, C.gold, { fontStyle: 'bold' }));
    const lines = [`Осколки башни +${l.shards}`];
    if (l.gold || l.jobExp) lines.push(`Золото +${formatNumber(l.gold)} · опыт +${formatNumber(l.jobExp)} в запас`);
    else lines.push('Добыча за эти этажи сегодня уже получена');
    if (l.gems) lines.push(`Гемы за рекорды +${l.gems}`);
    lines.forEach((s, i) => add(text(this, GAME_W / 2, cy - 50 + i * 75, s, FS.body, i === 0 ? C.gem : C.text, { wordWrap: { width: 860 }, align: 'center' })));
    add(text(this, GAME_W / 2, cy + 200, 'Осколки тратятся на улучшения Башни.', FS.small, C.muted));
    const b = button(this, GAME_W / 2, cy + 330, 480, 130, 'ui_btn_primary', 'Дальше', () => {
      commit(markTowerSummarySeen(session.save));
      this.scene.restart();
    }, FS.h2);
    b.container.setName('towerSummaryOk');
    layer.add(b.container);
  }
}
