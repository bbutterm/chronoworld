import Phaser from 'phaser';
import { itemCell, oreIcon } from '../itemIcons';
import { GAME } from '../content';
import { autoNextStage, decimal, defeatAdvice, describeEvents, equipBestSquad, formatNumber, keyEventsFirst, levelUpReady, nextOpenStage, squadGearUpgrades, stageNeeds, stageNo, RARITY_COLORS, type AutoStop } from '../flow';
import { collectFinding, featureUnlocked, pendingFinding, stageFinding, type BattleResult, type Side } from '../../core';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from '../layout';
import { commit, session } from '../session';
import { findingIcon, findingPage, showPages } from '../storyPage';
import { randomLine } from '../loreView';
import { portraitKey } from '../sprites';
import { BTN, button, clampLines, ellipsize, groupNum, plate, pressable, rewardRow, ScrollArea, SURFACE, tag, text, toast, tutorialHint, type ButtonView, type ChipSpec } from '../ui';
import { markHint, pickResultHint } from '../hints';
import { AUTO_DELAY_MS, autoAdvance, setAutoAdvance } from '../state';
import { COLOR, COLOR_N, E, M, R, S, T, TINT } from '../theme';
import type { ResultData } from './BattleScene';
import { bottomSheet, cta, portrait, powerCompare, unitFigure, unitTint } from '../screen';
import { countUp, juiceOn, moment, MOMENT_DEPTH, MOMENT_DIM } from '../juice';
import { playStory, startStageBattle } from '../dialogue';
import { chapterLastStage } from '../storyView';
import { startChapterDone } from './ChapterDoneScene';
import { addThemeBackground, themeOfBattle } from '../backdrops';
import { sfx } from '../audio';
import { haptic } from '../haptics';
import { glow } from '../decor';
import { showUnlockBanners } from '../unlockBanner';
import { heroCardIcon, rarityColor } from '../heroCard';
import { skinIcon } from '../skin';
import { mugIcon } from '../tavernEntry';
import { battleRewards, defeatShortcuts, resultEventLines, Reveal, type BattleReward, type DefeatShortcut, type RevealObj } from '../rewardsView';

/** Метка в данных итогов (ResultData.stage): «Глава пройдена» уже показан из этих итогов. */
type ShownMark = { chapterDoneShown?: boolean };

/**
 * Раскладка итогов (поле 1080×1920): плашка «Победа»/«Поражение», строка «где и сколько», карточка MVP, награды
 * чипами, строки событий; внизу — ряд кнопок (слева вторичная, справа главная «Дальше») и под ним тихий ряд
 * (ghost «К кампании», переключатель «Авто»).
 */
const L = {
  bannerY: 300,
  bannerW: 860,
  metaY: 500,
  rewardsHeadY: 590,
  rewardsY: 660,
  /** Отряд в стойке: линия ног и высота фигуры. */
  lineFeet: 1360,
  lineH: 230,
  /** Главный ряд кнопок и тихий ряд под ним. */
  row1: 1690,
  row2: 1840,
  side: { x: 228, w: 330 },
  main: { x: 717, w: 600 },
  /** Тихий ряд: «Статистика» по центру, переключатель «Авто» — под правой частью «Дальше». */
  stats: { x: 536, w: 260 },
  auto: { x: 845, w: 330 },
  /** Ширина содержимого (поля по S.l). */
  contentW: GAME_W - 2 * S.l,
} as const;
/** Верх кнопок: содержимое (события) кончается выше. */
const BUTTONS_TOP = L.row1 - BTN.cta / 2 - S.s;
/** Строка события. */
const EVENT_LINE = 60;
/** Кольцо отсчёта авто на «Дальше»: радиус и толщина. */
const RING_R = 34;
const RING_W = 8;

type Obj = RevealObj;

export class ResultScene extends Phaser.Scene {
  /** R: идущий обратный отсчёт авто-прохождения (null — нет). */
  autoTimer: Phaser.Time.TimerEvent | null = null;
  /** Низ содержимого и верх кнопок (e2e: содержимое не наезжает на кнопки). */
  tableEnd = 0;
  autoTop = Infinity;
  /** Сколько строк событий на экране (e2e: ничего не спрятано). */
  eventLines = 0;
  /** Хореография кончилась, кнопки на экране (e2e и атлас ждут его, прежде чем нажимать). */
  ready = false;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    const r = data.result;
    const stage = data.stage;
    const tower = data.tower;
    const win = r.winner === 'A';
    this.autoTimer = null;
    this.ready = false;
    this.tableEnd = 0;
    this.autoTop = BUTTONS_TOP;
    this.eventLines = 0;
    // Фон — поле только что сыгранного боя (глава этапа / ярус башни).
    addThemeBackground(this, 'battle', themeOfBattle({ stageId: stage?.stageId, towerFloor: tower?.floor }), win ? 0.75 : 0.6);
    const outcome = stage?.outcome ?? tower?.outcome;
    if (outcome?.events.some((e) => e.type === 'levelUp')) {
      sfx('level_up', { delay: 1.6 });
      haptic('levelUp', 1600);
    }
    if (win) this.victory(data);
    else this.defeat(data);
  }

  // ---------- победа ----------

  private victory(data: ResultData): void {
    const { stage } = data;
    const firstClear = !!stage && stage.outcome.events.some((e) => e.type === 'stageCleared' && e.firstTime);
    const bannerKey = this.textures.exists('skin_banner_victory') ? 'skin_banner_victory' : 'ui_victory';
    // Стингер — свой (у «первой победы» в MOMENTS — другой звук; здесь всегда джингл победы), вибрация — момента.
    sfx('victory');
    const before = this.children.list.length;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      this.victoryBody(data, firstClear);
    };
    moment(this, firstClear ? 'firstClear' : 'victory', {
      image: bannerKey,
      imageWidth: L.bannerW,
      at: { x: GAME_W / 2, y: L.bannerY },
      keep: true,
      sound: false,
      onSettled: start,
    });
    // Слои момента (затемнение, лучи, плашка) опускаем под содержимое экрана: награды и кнопки — над ними, а
    // сюжет, баннеры «Новая функция», лист «Статистика» и подсказки (их глубины ниже MOMENT_DEPTH) — над всем.
    const layers = (this.children.list.slice(before) as (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth)[]).filter((o) => o.depth >= MOMENT_DEPTH);
    for (const o of layers) o.setDepth(1 + Math.max(0, o.depth - MOMENT_DEPTH));
    if (!layers.length) {
      // «Уменьшить анимацию»: момента нет — затемнение и плашка сразу.
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, COLOR_N.bg, MOMENT_DIM).setDepth(1);
      const b = this.add.image(GAME_W / 2, L.bannerY, bannerKey).setDepth(3);
      b.setDisplaySize(L.bannerW, (L.bannerW * b.height) / Math.max(1, b.width));
    }
  }

  private victoryBody(data: ResultData, firstClear: boolean): void {
    const { result: r, stage, tower } = data;
    const reveal = new Reveal(this);
    const layer = this.add.container(0, 0).setDepth(10);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      layer.add(o);
      return o;
    };

    // Где и сколько: «Этап 1-3 · 17,3 с»; первая победа — зелёный тег.
    const meta = this.metaLine(data, firstClear);
    add(meta);
    reveal.step([meta]);

    // Отряд-победитель внизу (MVP — с тегом и уроном); «Статистика» — кнопка в нижнем ряду.
    const lineup = add(this.squadLineup(r, data.defs));
    reveal.step([lineup]);

    // Награды чипами — по одной; числа отсчитываются от нуля.
    let y = L.rewardsHeadY;
    const events = stage?.outcome.events ?? tower?.outcome.events ?? [];
    const rewards = battleRewards(events, stage?.outcome.drops ?? []);
    if (rewards.length) {
      const head = add(text(this, GAME_W / 2, y, 'Награды', T.caption, COLOR.textSecondary, { fontStyle: 'bold' }));
      reveal.step([head]);
      const row = add(rewardRow(this, GAME_W / 2, L.rewardsY, rewards.map((x) => this.chipOf(x)), { maxW: L.contentW }));
      const chips = row.list as Phaser.GameObjects.Container[];
      chips.forEach((c, i) => {
        this.tintChip(c, rewards[i]);
        const amount = 'amount' in rewards[i] && rewards[i].kind !== 'ore' ? (rewards[i] as { amount: number }).amount : 0;
        const label = c.list.find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
        reveal.step([c], (instant) => {
          if (amount && label && !instant) countUp(this, label, 0, amount, groupNum);
        });
      });
      y = L.rewardsY + row.height - (row.height ? 72 / 2 : 0) + S.l;
    } else y = L.rewardsHeadY;

    // События под наградами: находка (касание — прочитать), ключевые строки, «хватает опыта на уровень».
    /** Строка: рисует свои объекты на высоте ly, кладёт их put (в слой или прокрутку) — затем вешает нажатие. */
    type Put = <O extends Obj>(o: O) => O;
    const rows: { draw: (ly: number, put: Put) => Obj[] }[] = [];
    const found = stage && firstClear ? stageFinding(stage.stageId, GAME.content) : undefined;
    if (stage && found) {
      rows.push({
        draw: (ly, put) => {
          const label = put(text(this, GAME_W / 2 + 34, ly, `Находка: ${found.title} ›`, T.body, COLOR.accent, { fontStyle: 'bold' }).setName('resultFinding'));
          ellipsize(label, L.contentW - 120);
          const ic = put(findingIcon(this, label.x - label.width / 2 - 44, ly, 56, found.kind));
          const chapterId = GAME.content.stages.find((x) => x.id === stage.stageId)?.chapter;
          pressable(this, label, label.width + 100, EVENT_LINE, () => showPages(this, [findingPage(found, chapterId)], () => {}));
          return [label, ic];
        },
      });
    }
    const outcome = stage?.outcome ?? tower?.outcome;
    if (outcome) {
      const lines = keyEventsFirst(resultEventLines(describeEvents(outcome.events, outcome.save, GAME)));
      for (const line of lines) {
        const hot = line.startsWith('Новый герой') || line.startsWith('Открыта Таверна');
        rows.push({
          draw: (ly, put) => {
            const t = put(text(this, GAME_W / 2, ly, line, hot ? T.body : T.caption, hot ? COLOR.title : COLOR.textPrimary, { fontStyle: hot ? 'bold' : 'normal' }));
            if (t.width > L.contentW) t.setFontSize(Math.max(T.caption - 6, Math.floor((T.caption * L.contentW) / t.width)));
            return [ellipsize(t, L.contentW)];
          },
        });
      }
      if (levelUpReady(session.save, GAME).length) {
        rows.push({
          draw: (ly, put) => {
            const t = put(text(this, GAME_W / 2, ly, 'Хватает опыта на новый уровень ›', T.caption, COLOR.positive, { fontStyle: 'bold' }).setName('resultLevelUp'));
            pressable(this, t, t.width + 60, EVENT_LINE, () => this.scene.start('Heroes'));
            return [t];
          },
        });
      }
    }
    // Этаж-босс Башни взят — «надпись на стене этажа» (lines.json → towerFloor).
    if (tower && tower.floor % GAME.tower.bossEvery === 0) {
      const wall = randomLine('towerFloor');
      if (wall) {
        rows.push({
          draw: (ly, put) => [put(clampLines(text(this, GAME_W / 2, ly, wall, T.caption, COLOR.textSecondary, { fontStyle: 'italic', wordWrap: { width: L.contentW - 80 } }), 1).setName('resultLine'))],
        });
      }
    }
    if (rows.length) {
      const room = L.lineFeet - L.lineH * 1.1 - 80 - y;
      const fit = Math.max(2, Math.floor(room / EVENT_LINE));
      if (rows.length <= fit) {
        rows.forEach((row, i) => {
          reveal.step(row.draw(y + EVENT_LINE * (i + 0.5), add));
        });
        y += rows.length * EVENT_LINE;
      } else {
        // Не влезают до кнопок — список прокручивается пальцем, ничего не прячется.
        const area = new ScrollArea(this, y, y + fit * EVENT_LINE);
        const put: Put = (o) => {
          area.add(o);
          return o;
        };
        rows.forEach((row, i) => row.draw(EVENT_LINE * (i + 0.5), put));
        area.setContentHeight(rows.length * EVENT_LINE);
        for (const p of area.parts) (p as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(10);
        y += fit * EVENT_LINE;
      }
      this.eventLines = rows.length;
    }
    this.tableEnd = y;

    reveal.play(() => this.victoryButtons(data, firstClear));
  }

  /** «Этап 1-3 · 17,3 с» (башня — этаж; пропуск боя — «Бой пропущен»); первая победа — тег слева. */
  private metaLine(data: ResultData, firstClear: boolean): Phaser.GameObjects.Container {
    const { result: r, stage, tower } = data;
    const def = stage ? GAME.content.stages.find((s) => s.id === stage.stageId) : undefined;
    const where = tower ? `Башня, этаж ${tower.floor}` : def ? `Этап ${stageNo(def, GAME)}` : 'Бой';
    const parts = [where, stage?.skipped ? 'бой пропущен' : `${decimal(r.duration, 1)} с`];
    const c = this.add.container(GAME_W / 2, L.metaY);
    const t = text(this, 0, 0, parts.join(' · '), T.caption, COLOR.textSecondary);
    c.add(t);
    if (firstClear) {
      const tg = tag(this, 0, 0, 'Первая победа', 'positive');
      const w = tg.width + S.xs + t.width;
      tg.setX(-w / 2 + tg.width / 2);
      t.setX(w / 2 - t.width / 2);
      c.add(tg);
    }
    return c;
  }

  /**
   * Отряд-победитель в стойке на «сцене» внизу (как в AFK): MVP — с тегом над головой и уроном под ногами, павшие —
   * приглушены. Фигуры грузятся по требованию (листы боя обычно уже в памяти) — контейнер появляется сразу.
   */
  private squadLineup(r: BattleResult, defs: ResultData['defs']): Phaser.GameObjects.Container {
    const back = this.add.container(0, 0);
    const figs = this.add.container(0, 0);
    const front = this.add.container(0, 0);
    const c = this.add.container(0, 0, [back, figs, front]);
    const units = r.units.filter((u) => u.side === 'A');
    const mvp = mvpOf(r, 'A');
    const team = units.reduce((sum, u) => sum + r.report[u.uid].damageDealt, 0);
    const step = Math.min(196, L.contentW / Math.max(1, units.length));
    const feet = L.lineFeet;
    units.forEach((u, i) => {
      const x = GAME_W / 2 + (i - (units.length - 1) / 2) * step;
      const rep = r.report[u.uid];
      const def = defs[u.unitId];
      const isMvp = u.uid === mvp;
      if (isMvp) back.add(glow(this, x, feet - L.lineH * 0.45, 128, 0xffd27a, 0.5).setScale(2.2, 3.4));
      back.add(this.add.ellipse(x, feet, 130, 34, 0x000000, 0.35));
      unitFigure(this, def?.visual.sprite ?? u.unitId, x, feet, isMvp ? L.lineH * 1.1 : L.lineH, {
        maxScale: 2,
        onReady: (o) => {
          if (!c.scene) return o.destroy();
          if (!rep.alive) o.setAlpha(0.45).setTint(0x8a8a8a);
          else if (def?.visual.tint) o.setTint(unitTint(def.visual));
          figs.add(o);
        },
      });
      if (isMvp) {
        const share = team > 0 ? Math.round((rep.damageDealt / team) * 100) : 0;
        // Под ногами: «MVP» и урон одной строкой, ниже — доля урона отряда.
        const mark = tag(this, 0, feet + 48, 'MVP', 'gold', { solid: true });
        const dmg = text(this, 0, feet + 48, formatNumber(rep.damageDealt), T.body, COLOR.gold, { fontStyle: 'bold' }).setName('resultMvp');
        const w = mark.width + S.xs + dmg.width;
        mark.setX(x - w / 2 + mark.width / 2);
        dmg.setX(x + w / 2 - dmg.width / 2);
        front.add([mark, dmg, text(this, x, feet + 96, `урон · ${share}%`, T.caption - 6, COLOR.textSecondary)]);
      }
    });
    return c;
  }

  /** Чип награды: иконка и число/название. */
  private chipOf(x: BattleReward): ChipSpec {
    switch (x.kind) {
      case 'gold':
        return { icon: 'gold', value: x.amount, tone: 'gold' };
      case 'gems':
        return { icon: 'gems', value: x.amount, tone: 'gem' };
      case 'exp':
        return { icon: 'hero_exp', value: x.amount, tone: 'positive' };
      case 'ore':
        return { icon: (s, ix, iy, size) => oreIcon(s, ix, iy, size), value: `×${x.amount}`, tone: 'info' };
      case 'heroCard':
        return { icon: (s, ix, iy, size) => heroCardIcon(s, ix, iy, size * 1.15, x.rarity, x.templateId).setName('resultHeroCard'), value: x.name.split(' ')[0], tone: 'neutral' };
      case 'item': {
        const def = GAME.equipment.items[x.itemId];
        const color = Phaser.Display.Color.HexStringToColor(def ? RARITY_COLORS[def.rarity] : COLOR.textPrimary).color;
        return {
          icon: (s, ix, iy, size) => s.add.container(ix, iy, itemCell(s, 0, 0, size, def?.slot ?? 'weapon', color, x.itemId)),
          value: def?.name ?? x.itemId,
        };
      }
    }
  }

  /** Подпись чипа цветом редкости (трофей, карта героя). */
  private tintChip(c: Phaser.GameObjects.Container, x: BattleReward): void {
    const label = c.list.find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
    if (!label) return;
    if (x.kind === 'item') {
      const def = GAME.equipment.items[x.itemId];
      if (def) label.setColor(RARITY_COLORS[def.rarity]);
      c.setName('resultDrop');
    } else if (x.kind === 'heroCard') label.setColor(rarityColor(x.rarity));
    else if (x.kind === 'ore') c.setName('resultOre');
  }

  /** Кнопки победы — последними (§4.6), затем сюжет, «Глава пройдена», баннеры, подсказки, авто. */
  private victoryButtons(data: ResultData, firstClear: boolean): void {
    const { stage, tower } = data;
    const shown: Obj[] = [];
    const keep = (b: ButtonView) => {
      shown.push(b.container);
      return b;
    };
    keep(this.statsButton(data, L.stats.x, L.stats.w));
    if (tower) {
      keep(button(this, L.side.x, L.row1, L.side.w, BTN.l, '', 'К башне', () => this.scene.start('Tower'), T.body, { variant: 'secondary' }));
      keep(cta(this, L.main.x, L.row1, 'Выше', () => this.scene.start('Battle', { mode: 'tower' }), { w: L.main.w, h: BTN.cta }));
      keep(button(this, L.side.x, L.row2, L.side.w, BTN.m, '', 'Приключения', () => this.scene.start('Adventure'), T.body, { variant: 'ghost' }));
      this.showButtons(shown);
      return;
    }
    if (!stage) {
      keep(button(this, L.side.x, L.row1, L.side.w, BTN.l, '', 'Отряд', () => this.scene.start('Prep'), T.body, { variant: 'secondary' }));
      keep(cta(this, L.main.x, L.row1, 'Ещё раз', () => this.testAgain(), { w: L.main.w, h: BTN.cta }));
      keep(button(this, L.side.x, L.row2, L.side.w, BTN.m, '', 'Город', () => this.scene.start('Home'), T.body, { variant: 'ghost' }));
      this.showButtons(shown);
      return;
    }
    const next = nextOpenStage(session.save, stage.stageId, GAME);
    keep(button(this, L.side.x, L.row1, L.side.w, BTN.l, '', 'Повторить', () => this.scene.start('Battle', { mode: 'stage', stageId: stage.stageId }), T.body, { variant: 'secondary' }));
    const nextBtn = keep(cta(this, L.main.x, L.row1, 'Дальше', () => {
      markHint('result_next');
      if (next) this.scene.start('Stage', { stageId: next.id });
    }, { w: L.main.w, h: BTN.cta, enabled: !!next }));
    if (!next) nextBtn.container.disableInteractive();
    keep(button(this, L.side.x, L.row2, L.side.w, BTN.m, '', 'К кампании', () => {
      markHint('result_home');
      this.scene.start('Campaign');
    }, T.body, { variant: 'ghost' }));
    const auto = this.autoRow(stage.stageId, nextBtn);
    shown.push(auto.view);
    this.showButtons(shown);

    // Сюжет после первой победы — после наград и кнопок (§5 «Итог боя» P1: сначала награды); авто-отсчёт — после
    // него (в авто-режиме строки листаются сами; финал главы — только касанием).
    const stageInfo = GAME.content.stages.find((x) => x.id === stage.stageId);
    // T1-03: первая победа над боссом главы — после финальной сцены экран «Глава пройдена» (ровно один раз:
    // метка в данных сцены — при возврате на итоги он не повторяется).
    const chapterDone = firstClear && !!stageInfo && chapterLastStage(stageInfo.chapter, GAME)?.id === stage.stageId && !(stage as ShownMark).chapterDoneShown;
    // Находка (первая победа, её ещё нет в сохранении): в сохранение сразу, страница — до сюжета «после этапа»;
    // в авто-режиме страницу не показываем (строка «Находка» в итогах и «Летопись» остаются).
    const finding = pendingFinding(session.save, stage.stageId, firstClear, GAME.content);
    if (finding) commit(collectFinding(session.save, finding.id));
    const afterFinding = (then: () => void) => (finding && !autoAdvance.on ? showPages(this, [findingPage(finding, stageInfo?.chapter)], then) : then());
    afterFinding(() =>
      playStory(this, { type: 'afterStage', stageId: stage.stageId, firstClear }, () => {
        if (chapterDone && stageInfo) {
          (stage as ShownMark).chapterDoneShown = true;
          startChapterDone(this, { chapterId: stageInfo.chapter });
        } else if (autoAdvance.on) auto.begin();
        else
          // Этап открыл функцию — баннер «Новая функция!» (касание мимо — «Позже», кнопки итогов не заперты).
          showUnlockBanners(this, () => {
            // Обучение (hints.ts): первая победа — «Дальше»; потом, когда копится сундук или хватает на уровень, — «К кампании».
            const hint = firstClear ? pickResultHint({ hasNext: !!next, chestOrLevel: levelUpReady(session.save, GAME).length > 0 || session.save.campaign.cleared.length >= 2 }) : null;
            if (hint === 'result_next') tutorialHint(this, hint, L.main.x, L.row1, 'above', { w: L.main.w, h: BTN.cta });
            else if (hint) tutorialHint(this, hint, L.side.x, L.row2, 'above', { w: L.side.w, h: BTN.m });
            auto.begin();
          });
      }, { auto: autoAdvance.on }),
    );
  }

  /** Кнопки проявляются (M.base); экран готов. */
  private showButtons(objs: Obj[]): void {
    for (const o of objs) {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(20);
      if (!juiceOn()) continue;
      const a = o.alpha;
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: a, duration: M.base, ease: E.out });
    }
    this.ready = true;
  }

  private testAgain(): void {
    this.scene.start('Battle', { mode: 'test', seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 });
  }

  // ---------- поражение ----------

  /**
   * Поражение — спокойно и по делу: плашка, почему (мощь против рекомендуемой), три большие плитки «как стать
   * сильнее» (Герои, Снаряжение, Таверна/Отряд; совет defeatAdvice выделен) и «Повторить». Без лекций.
   */
  private defeat(data: ResultData): void {
    const { result: r, stage, tower } = data;
    sfx('defeat');
    haptic('defeat');
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, COLOR_N.bg, 0.45);
    const layer = this.add.container(0, 0).setDepth(10);
    const reveal = new Reveal(this);
    const bannerKey = this.textures.exists('skin_banner_defeat') ? 'skin_banner_defeat' : 'ui_defeat';
    const halo = glow(this, GAME_W / 2, L.bannerY, 128, 0xa02818, 0.4).setScale(1000 / 128, 380 / 128);
    const banner = this.add.image(GAME_W / 2, L.bannerY, bannerKey);
    banner.setDisplaySize(L.bannerW, (L.bannerW * banner.height) / Math.max(1, banner.width));
    layer.add([halo, banner]);
    reveal.step([halo, banner]);

    const why = r.reason === 'timeout' ? 'Время вышло' : 'Отряд пал';
    const where = tower ? `Башня, этаж ${tower.floor} · ` : '';
    const meta = text(this, GAME_W / 2, L.metaY, `${where}${why} · ${decimal(r.duration, 1)} с`, T.caption, COLOR.textSecondary);
    layer.add(meta);
    reveal.step([meta]);

    // Почему: мощь отряда против рекомендуемой (этап) — «⚔ 1 224  Не хватает 300».
    let y = L.metaY + 130;
    if (stage) {
      const needs = stageNeeds(session.save, stage.stageId, GAME);
      const pc = powerCompare(this, GAME_W / 2, y, needs.own, needs.power, { align: 'center' });
      layer.add(pc);
      reveal.step([pc]);
      y += 150;
    }

    // Как стать сильнее: три плитки-иконки.
    const head = text(this, GAME_W / 2, y, 'Как стать сильнее', T.heading, COLOR.title, { fontStyle: 'bold' });
    layer.add(head);
    reveal.step([head]);
    const tip = defeatAdvice(session.save, GAME);
    const gearReady = squadGearUpgrades(session.save, GAME).length > 0;
    const tiles = defeatShortcuts(tip.action, featureUnlocked(session.save, 'tavern', GAME), gearReady);
    const tw = 312;
    const th = 340;
    const ty = y + S.l + th / 2 + S.s;
    tiles.forEach((t, i) => reveal.step([this.defeatTile(layer, t, GAME_W / 2 + (i - 1) * (tw + S.s), ty, tw, th, stage?.stageId)]));
    y = ty + th / 2 + S.l;

    // Строка Гаррета вместо сухого «Поражение» (lore-route §5.8, data/lore/lines.json → defeat) — одна-две строки.
    const said = randomLine('defeat');
    if (said) {
      const q = clampLines(text(this, GAME_W / 2, y + S.l, said, T.caption, COLOR.textSecondary, { fontStyle: 'italic', wordWrap: { width: L.contentW - 80 } }), 2).setOrigin(0.5, 0).setName('resultLine');
      layer.add(q);
      reveal.step([q]);
      y += S.l + q.height;
    }
    this.tableEnd = y;

    reveal.play(() => {
      const shown: Obj[] = [];
      const stats = this.statsButton(data, GAME_W / 2, 360);
      if (tower) {
        shown.push(button(this, L.side.x, L.row1, L.side.w, BTN.l, '', 'К башне', () => this.scene.start('Tower'), T.body, { variant: 'secondary' }).container);
        shown.push(cta(this, L.main.x, L.row1, 'Ещё раз', () => this.scene.start('Battle', { mode: 'tower' }), { w: L.main.w, h: BTN.cta }).container);
      } else if (stage) {
        shown.push(button(this, L.side.x, L.row1, L.side.w, BTN.l, '', 'К кампании', () => this.scene.start('Campaign'), T.body, { variant: 'secondary' }).container);
        shown.push(cta(this, L.main.x, L.row1, 'Повторить', () => this.scene.start('Battle', { mode: 'stage', stageId: stage.stageId }), { w: L.main.w, h: BTN.cta }).container);
      } else {
        shown.push(button(this, L.side.x, L.row1, L.side.w, BTN.l, '', 'Город', () => this.scene.start('Home'), T.body, { variant: 'secondary' }).container);
        shown.push(cta(this, L.main.x, L.row1, 'Ещё раз', () => this.testAgain(), { w: L.main.w, h: BTN.cta }).container);
      }
      shown.push(stats.container);
      this.showButtons(shown);
    }, M.base);
  }

  /** Плитка «как стать сильнее»: иконка, подпись, строка под ней; совет — рамка акцента и тег «Совет». */
  private defeatTile(layer: Phaser.GameObjects.Container, t: DefeatShortcut, x: number, y: number, w: number, h: number, stageId: string | undefined): Phaser.GameObjects.Container {
    const c = this.add.container(x, y).setName(t.id === 'gear' ? 'equipBestSquad' : `defeat_${t.id}`).setSize(w, h);
    layer.add(c);
    const bg = plate(this, 0, 0, w, h, t.advised ? { ...SURFACE.raised, border: COLOR.accent, borderW: 4, r: R.l } : { ...SURFACE.raised, r: R.l });
    c.add(bg);
    const iy = -h / 2 + 100;
    c.add(glow(this, 0, iy, 128, t.advised ? 0xffd27a : 0x8a7350, t.advised ? 0.4 : 0.22).setScale(1.5));
    const ICON = 112;
    if (t.id === 'tavern') c.add(mugIcon(this, 0, iy, ICON));
    else {
      const name = t.id === 'heroes' ? 'star' : t.id === 'gear' ? 'helmet' : 'flag';
      c.add(this.add.image(0, iy, skinIcon(name)).setDisplaySize(ICON, ICON).setTint(COLOR_N.title));
    }
    const label = text(this, 0, h / 2 - 96, t.label, T.body, COLOR.textPrimary, { fontStyle: 'bold' });
    ellipsize(label, w - S.l);
    const sub = text(this, 0, h / 2 - 46, t.sub, T.caption, t.advised ? COLOR.accent : COLOR.textSecondary);
    ellipsize(sub, w - S.s);
    c.add([label, sub]);
    if (t.advised) c.add(tag(this, 0, -h / 2, 'Совет', 'accent', { solid: true }));
    let used = false;
    pressable(this, c, w, h, () => {
      if (t.id === 'heroes') this.scene.start('Heroes');
      else if (t.id === 'tavern') this.scene.start('Tavern');
      else if (t.id === 'squad') {
        if (stageId) this.scene.start('Stage', { stageId });
        else this.scene.start('Prep');
      } else if (t.sub === 'Надеть лучшее') {
        // RN-10: вещи получше у отряда — надеть прямо здесь, всему отряду.
        if (used) return;
        used = true;
        const res = equipBestSquad(session.save, GAME);
        commit(res.save);
        sub.setText(res.equipped ? 'Надето' : 'Нечего надеть').setColor(COLOR.positive);
        toast(this, res.equipped ? `Отряд переодет: вещей надето ${res.equipped}` : 'Надевать нечего', COLOR.positive);
      } else this.scene.start('Inventory');
    });
    return c;
  }

  // ---------- статистика ----------

  /** Тихая кнопка «Статистика» (лист снизу с обеими сторонами). */
  private statsButton(data: ResultData, x: number, w: number): ButtonView {
    const b = button(this, x, L.row2, w, BTN.m, '', 'Статистика', () => this.openStats(data.result, data.defs), T.body, { variant: 'ghost' });
    b.container.setName('resultStats');
    return b;
  }

  /** Лист «Статистика»: обе стороны — кто сколько нанёс (полоса), вылечил и закрыл щитом; MVP — золотом. */
  private openStats(r: BattleResult, defs: ResultData['defs']): void {
    bottomSheet(this, 'Статистика боя', (content, width) => {
      const maxDmg = Math.max(1, ...Object.values(r.report).map((x) => x.damageDealt));
      const mvp = mvpOf(r, 'A');
      const ROW = 112;
      let y = 0;
      for (const side of ['A', 'B'] as const) {
        content.add(text(this, 0, y + 28, side === 'A' ? 'Ваш отряд' : 'Противник', T.body, side === 'A' ? COLOR.positive : COLOR.negative, { fontStyle: 'bold' }).setOrigin(0, 0.5));
        y += 72;
        for (const u of r.units.filter((x) => x.side === side)) {
          const rep = r.report[u.uid];
          const def = defs[u.unitId];
          const isMvp = u.uid === mvp;
          const cy = y + ROW / 2;
          if (isMvp) content.add(plate(this, width / 2, cy, width, ROW - 8, { fill: COLOR.surfaceRaised, border: COLOR.gold, borderW: 3, r: R.m }));
          const alpha = rep.alive ? 1 : 0.45;
          content.add(portrait(this, 48, cy, portraitKey(def?.visual.sprite ?? u.unitId), 84).setAlpha(alpha).setTint(unitTint(def?.visual)));
          const nx = 48 + 42 + S.s;
          const name = text(this, nx, cy - 20, def?.name ?? u.unitId, T.caption, isMvp ? COLOR.title : COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5).setAlpha(alpha);
          ellipsize(name, width - nx - 260);
          content.add(name);
          if (isMvp) content.add(tag(this, nx + name.displayWidth + S.xs, cy - 20, 'MVP', 'gold', { solid: true, align: 'left' }).setScale(0.8));
          const barW = width - nx - 260;
          content.add(this.add.rectangle(nx, cy + 22, barW, 12, COLOR_N.surfaceSunken).setOrigin(0, 0.5));
          if (rep.damageDealt > 0) content.add(this.add.rectangle(nx, cy + 22, Math.max(4, (barW * rep.damageDealt) / maxDmg), 12, side === 'A' ? TINT.gold : TINT.danger).setOrigin(0, 0.5));
          content.add(text(this, width, cy - 16, formatNumber(rep.damageDealt), T.body, isMvp ? COLOR.gold : COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(1, 0.5));
          const extra = [rep.healingDone > 0 ? `лечение ${formatNumber(rep.healingDone)}` : '', rep.shieldGiven > 0 ? `щит ${formatNumber(rep.shieldGiven)}` : ''].filter(Boolean).join(' · ');
          content.add(text(this, width, cy + 24, extra || 'урон', T.caption, extra ? COLOR.positive : COLOR.textTertiary).setOrigin(1, 0.5));
          y += ROW;
        }
        y += S.m;
      }
      return y;
    });
  }

  // ---------- авто ----------

  /**
   * R. «Авто: дальше» (как авто-бой в AFK Arena): переключатель запоминается; если он включён и бой выигран,
   * через AUTO_DELAY_MS сам стартует следующий новый этап главы — кольцо отсчёта на «Дальше». Любое касание
   * экрана отменяет отсчёт (кольцо гаснет, без лишних подписей). begin — запуск отсчёта (после сюжета).
   */
  private autoRow(stageId: string, next: ButtonView): { view: Obj; begin: () => void } {
    const plan = autoNextStage(session.save, stageId, true, GAME);
    const toggle = button(this, L.auto.x, L.row2, L.auto.w, BTN.m, '', 'Авто: дальше', () => {
      setAutoAdvance(!autoAdvance.on);
      drawMark();
      if (autoAdvance.on) start();
      else cancel();
    }, T.caption, { variant: 'secondary' });
    toggle.container.setName('autoToggle');
    // Флажок слева от подписи: включён — зелёный с галочкой.
    const BOX = 44;
    toggle.label.setX(BOX / 2 + 6);
    const boxX = toggle.label.x - toggle.label.width / 2 - BOX / 2 - 12;
    const box = this.add.rectangle(boxX, -3, BOX, BOX, TINT.checkOff).setStrokeStyle(4, TINT.frame);
    const check = text(this, boxX, -5, '✓', T.caption, COLOR.textPrimary, { fontStyle: 'bold' });
    toggle.container.add([box, check]);
    // Почему авто стоит (повтор, конец главы) — крошечная подпись под переключателем, только когда авто включено.
    const note = text(this, L.auto.x, L.row2 + BTN.m / 2 + 18, '', T.caption - 8, COLOR.textTertiary).setDepth(20);
    toggle.container.once(Phaser.GameObjects.Events.DESTROY, () => note.destroy());
    const drawMark = () => {
      box.setFillStyle(autoAdvance.on ? TINT.success : TINT.checkOff).setStrokeStyle(4, autoAdvance.on ? TINT.header : TINT.frame);
      check.setVisible(autoAdvance.on);
      note.setText(autoAdvance.on && !plan.next ? AUTO_STOP_TEXT[plan.stop ?? 'no_next'] : '');
    };
    drawMark();

    // Кольцо отсчёта — на «Дальше» справа от подписи.
    const ring = this.add.graphics();
    const secs = text(this, 0, -2, '', T.caption, COLOR.onAccent, { fontStyle: 'bold' });
    const rx = L.main.w / 2 - S.l - RING_R;
    ring.setPosition(rx, -3);
    secs.setPosition(rx, -4);
    next.container.add([ring, secs]);
    ring.setVisible(false);
    secs.setVisible(false);
    const drawRing = (frac: number) => {
      ring.clear();
      ring.lineStyle(RING_W, COLOR_N.onAccent, 0.25).strokeCircle(0, 0, RING_R);
      ring.lineStyle(RING_W, COLOR_N.onAccent, 1).beginPath();
      ring.arc(0, 0, RING_R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
      ring.strokePath();
    };

    const cancelOnTap = () => cancel();
    const cancel = () => {
      this.autoTimer?.remove();
      this.autoTimer = null;
      this.input.off('pointerdown', cancelOnTap);
      ring.setVisible(false);
      secs.setVisible(false);
    };
    const start = () => {
      drawMark();
      if (!plan.next) return;
      const target = plan.next;
      // Время считаем тиками таймера (они замирают на паузе сцены), а не часами игры.
      const STEP = 50;
      let elapsed = -STEP;
      ring.setVisible(true);
      secs.setVisible(true);
      const tick = () => {
        elapsed += STEP;
        const left = Math.max(0, AUTO_DELAY_MS - elapsed);
        drawRing(1 - left / AUTO_DELAY_MS);
        secs.setText(String(Math.ceil(left / 1000)));
        if (left > 0) return;
        cancel();
        // Сюжет перед новым этапом показывается и в авто-режиме — один раз, строки листаются сами.
        startStageBattle(this, target.id, { auto: true });
      };
      tick();
      this.autoTimer = this.time.addEvent({ delay: STEP, loop: true, callback: tick });
      // Касание в любом месте (в том числе по кнопкам) — отмена отсчёта.
      this.input.on('pointerdown', cancelOnTap);
    };
    return {
      view: toggle.container,
      begin: () => {
        if (autoAdvance.on && !this.autoTimer) start();
      },
    };
  }
}

/** Почему авто не пошло дальше — коротко, под переключателем. */
const AUTO_STOP_TEXT: Record<AutoStop, string> = {
  defeat: 'Авто стоит: поражение',
  chapter_end: 'Авто стоит: конец главы',
  no_next: 'Дальше этапов нет',
  replay: 'Авто — только по новым этапам',
};

/** MVP стороны — больше всех урона (при равенстве — лечение + щит). Никто ничего не сделал — нет MVP. */
export function mvpOf(r: BattleResult, side: Side): string | null {
  let best: string | null = null;
  let score = 0;
  for (const u of r.units) {
    if (u.side !== side) continue;
    const rep = r.report[u.uid];
    const s = rep.damageDealt * 1e6 + rep.healingDone + rep.shieldGiven;
    if (s > score) {
      score = s;
      best = u.uid;
    }
  }
  return best;
}
