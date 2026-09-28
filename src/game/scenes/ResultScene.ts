import Phaser from 'phaser';
import { oreIcon } from '../itemIcons';
import { GAME } from '../content';
import { autoNextStage, decimal, defeatAdvice, describeEvents, formatNumber, itemStatsText, keyEventsFirst, levelUpReady, nextOpenStage, stageNo, RARITY_COLORS, type AutoStop } from '../flow';
import type { BattleResult, Side } from '../../core';
import { GAME_W } from '../layout';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, panel, progressBar, ScrollArea, text, tutorialHint } from '../ui';
import { markHint, pickResultHint } from '../hints';
import { AUTO_DELAY_MS, autoAdvance, setAutoAdvance } from '../state';
import { C, FS, OUTLINE, SP, TINT, TOUCH } from '../theme';
import type { ResultData } from './BattleScene';
import { portrait, unitTint } from '../screen';
import { countUp, juiceOn } from '../juice';
import { skillIcon } from '../skillIcons';
import { playStory, startStageBattle } from '../dialogue';
import { chapterLastStage } from '../storyView';
import { startChapterDone } from './ChapterDoneScene';
import { addThemeBackground, themeOfBattle } from '../backdrops';
import { sfx } from '../audio';
import { glow, slowRays, sparkBurst } from '../decor';
import { showUnlockBanners } from '../unlockBanner';
import { heroCardIcon, rarityColor, rarityName } from '../heroCard';

/** Метка в данных итогов (ResultData.stage): «Глава пройдена» уже показан из этих итогов. */
type ShownMark = { chapterDoneShown?: boolean };

/** Шаг строки события, минимальная высота строки таблицы, центр строки «Авто: следующий этап». */
const EVENT_LINE = 42;
const ROW_MIN = 56;
const AUTO_Y = 1680;
/** Жирный светлый текст с обводкой (награды, трофеи). */
const BOLD_OUTLINE = { fontStyle: 'bold', ...OUTLINE } as const;

/** Высота таблицы итогов (две стороны: заголовок, шапка, строки) при минимальной высоте строки. */
function tableMinHeight(units: number, compact: boolean): number {
  return 2 * (TITLE_GAP(compact) + HEAD_GAP(compact) + SIDE_GAP(compact)) + units * ROW_MIN;
}
/** Отступы таблицы: заголовок стороны → шапка колонок → верх первой строки; после строк стороны. */
const TITLE_GAP = (compact: boolean) => (compact ? 40 : 55);
const HEAD_GAP = (compact: boolean) => (compact ? 24 : 34);
const SIDE_GAP = (compact: boolean) => (compact ? 34 : 50);

export class ResultScene extends Phaser.Scene {
  /** R: идущий обратный отсчёт авто-прохождения (null — нет). */
  private autoTimer: Phaser.Time.TimerEvent | null = null;
  /** Низ таблицы итогов и верх строки «Авто» (для e2e-проверки раскладки). */
  tableEnd = 0;
  autoTop = Infinity;
  /** Сколько строк событий на экране (e2e: ничего не спрятано). */
  eventLines = 0;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    const r = data.result;
    const stage = data.stage;
    const tower = data.tower;
    const win = r.winner === 'A';
    const compact = !!stage || !!tower;
    this.autoTimer = null;
    // Фон — поле только что сыгранного боя (глава этапа / ярус башни), приглушённый.
    addThemeBackground(this, 'battle', themeOfBattle({ stageId: stage?.stageId, towerFloor: tower?.floor }), 0.5);
    // Плашка итога — в стиле скина (своя текстура), с коротким «ударом» появления.
    const bannerKey = this.textures.exists('skin_banner_victory') ? (win ? 'skin_banner_victory' : 'skin_banner_defeat') : win ? 'ui_victory' : 'ui_defeat';
    const bannerW = compact ? 820 : 900;
    const bannerY = compact ? 200 : 250;
    // За плашкой: победа — медленные золотые лучи и тёплый ореол, поражение — тусклое красное свечение.
    if (win) {
      slowRays(this, GAME_W / 2, bannerY, 1100, 0.5);
      glow(this, GAME_W / 2, bannerY, 128, 0xffd27a, 0.45).setScale(1000 / 128, 420 / 128);
    } else glow(this, GAME_W / 2, bannerY, 128, 0xa02818, 0.4).setScale(1000 / 128, 380 / 128);
    const banner = this.add.image(GAME_W / 2, bannerY, bannerKey).setDisplaySize(bannerW, (bannerW * 300) / 900);
    const bs = banner.scaleX;
    banner.setScale(bs * 1.25).setAlpha(0);
    this.tweens.add({ targets: banner, scale: bs, alpha: 1, duration: 320, ease: 'Back.easeOut' });
    // Победа: искры разлетаются от плашки после её «удара» (без «Уменьшить анимацию»).
    if (win) this.time.delayedCall(260, () => sparkBurst(this, GAME_W / 2, bannerY, bannerW));
    const top = compact ? 380 : 470;
    panel(this, GAME_W / 2, (top + 1730) / 2, 1050, 1730 - top + 20, 'ui_panel');
    const reason = r.reason === 'timeout' ? 'Время вышло — поражение' : win ? 'Отряд противника уничтожен' : 'Ваш отряд уничтожен';
    let y = top + 50;
    // Под этапом кампании — строка «Авто: следующий этап» (R), таблица заканчивается выше.
    const tableBottom = stage ? AUTO_Y - TOUCH / 2 - SP.s : 1700;
    const where = tower ? `Башня, этаж ${tower.floor} · ` : stage?.skipped ? 'Бой пропущен · ' : '';
    text(this, GAME_W / 2, y, `${where}${reason} · ${decimal(r.duration, 1)} с`, FS.small, C.muted, OUTLINE);
    y += 60;

    const outcome = stage?.outcome ?? tower?.outcome;
    // Стингер итога (музыка боя приглушается под него); повышение уровня / редкий трофей — следом.
    sfx(win ? 'victory' : 'defeat');
    if (outcome?.events.some((e) => e.type === 'levelUp')) sfx('level_up', { delay: 1.6 });
    if (outcome) {
      const events = outcome.events;
      const rewards = events.find((e) => e.type === 'rewards');
      if (rewards && rewards.type === 'rewards') {
        // Числа награды отсчитываются от нуля (juice.ts; «Уменьшить анимацию» — сразу итог).
        const rewardLine = (k: number) => `Награда: золото +${formatNumber((rewards.gold * k) / 1000)} · опыт +${formatNumber((rewards.heroExp * k) / 1000)} в запас`;
        countUp(this, text(this, GAME_W / 2, y, rewardLine(1000), FS.body, C.gold, BOLD_OUTLINE), 0, 1000, rewardLine, { delay: 250, duration: 700 });
      } else {
        // T1-07: совет по делу (вещи, «Улучшить», вознесение, расстановка, прокачка).
        const advice = tower ? 'Этаж не взят. Усильте отряд и попробуйте снова.' : `Награды нет. ${defeatAdvice(session.save, GAME).text}`;
        text(this, GAME_W / 2, y, advice, FS.small, C.enemy, { ...OUTLINE, wordWrap: { width: 980 } });
        if (!tower) y += 20;
      }
      y += 55;
      // K6: выпавшие предметы — цветом редкости.
      for (const d of stage?.outcome.drops ?? []) {
        const def = GAME.equipment.items[d.itemId];
        const t = text(this, GAME_W / 2, y, `Трофей: ${def?.name ?? d.itemId}${def ? ` (${itemStatsText(def.stats)})` : ''}`, FS.body, def ? RARITY_COLORS[def.rarity] : C.text, BOLD_OUTLINE);
        this.tweens.add({ targets: t, scale: { from: 1.25, to: 1 }, duration: 500, ease: 'Back.easeOut' });
        y += 50;
      }
      // T1-09: все события, ключевые (новый герой, Таверна, вознесение, навыки, уровни) — первыми. Не влезают до таблицы —
      // список событий прокручивается пальцем, ничего не прячется под «…и ещё N».
      // Карты героя (копии для вознесения): мини-карта с лицом героя в рамке редкости и подпись цветом редкости.
      for (const e of events) {
        if (e.type !== 'heroCard') continue;
        const label = text(this, GAME_W / 2 + 30, y, `Карта героя: ${e.name} (${rarityName(e.rarity).toLowerCase()}) — копия для вознесения`, FS.body, rarityColor(e.rarity), BOLD_OUTLINE);
        ellipsize(label, 900);
        const ic = heroCardIcon(this, label.x - label.width / 2 - 40, y, 64, e.rarity, e.templateId).setName('resultHeroCard');
        this.tweens.add({ targets: [label, ic], scale: { from: 1.25, to: 1 }, duration: 500, ease: 'Back.easeOut' });
        y += 70;
      }
      // «Благословенная руда» с босса — строка с иконкой самородка (голубым, как руда).
      for (const e of events) {
        if (e.type !== 'blessedOre') continue;
        const label = text(this, GAME_W / 2 + 30, y, `Благословенная руда ×${e.count} — заточка без поломки`, FS.body, '#bfe9ff', BOLD_OUTLINE).setName('resultOre');
        ellipsize(label, 900);
        const ic = oreIcon(this, label.x - label.width / 2 - 40, y, 64);
        this.tweens.add({ targets: [label, ic], scale: { from: 1.25, to: 1 }, duration: 500, ease: 'Back.easeOut' });
        y += 70;
      }
      const lines = keyEventsFirst(describeEvents(events, outcome.save, GAME).filter((l) => !l.startsWith('Карта героя:') && !l.startsWith('Благословенная руда')));
      const rows: { line: string; hot: boolean; warn?: boolean }[] = lines.map((line) => ({ line, hot: line.startsWith('Новый герой') || line.startsWith('Открыта Таверна') }));
      // Опыт копится в общем запасе — подсказать «Улучшить», если хватает на уровень.
      if (levelUpReady(session.save, GAME).length) rows.push({ line: `Опыт в запасе: ${formatNumber(session.save.resources.heroExp)} — «Герои» → «Улучшить»`, hot: false });
      const room = tableBottom - y - tableMinHeight(r.units.length, compact) - 15;
      const fitLines = Math.max(2, Math.floor(room / EVENT_LINE));
      // Строка события — в ширину панели: длинная мельчает (не меньше 24), потом «…» (не вылезает за края экрана).
      const drawRow = (x: { line: string; hot: boolean; warn?: boolean }, ly: number) => {
        const t = text(this, GAME_W / 2, ly, x.line, x.hot ? FS.body : FS.small, x.warn ? C.warning : x.hot ? C.gold : C.success, x.hot ? BOLD_OUTLINE : OUTLINE);
        const maxW = 990;
        if (t.width > maxW) t.setFontSize(Math.max(24, Math.floor((Number.parseInt(String(t.style.fontSize), 10) * maxW) / t.width)));
        return ellipsize(t, maxW);
      };
      if (rows.length <= fitLines) {
        for (const x of rows) {
          drawRow(x, y);
          y += EVENT_LINE;
        }
      } else {
        const areaTop = y - EVENT_LINE / 2;
        const area = new ScrollArea(this, areaTop, areaTop + fitLines * EVENT_LINE);
        rows.forEach((x, i) => area.add(drawRow(x, EVENT_LINE * (i + 0.5))));
        area.setContentHeight(rows.length * EVENT_LINE);
        text(this, GAME_W - 70, y + (fitLines - 0.5) * EVENT_LINE, '⇅', FS.small, C.muted, OUTLINE);
        y += fitLines * EVENT_LINE;
      }
      this.eventLines = rows.length;
      y += 15;
    }

    // Сводка: почему победила сторона — кто сколько нанёс, вылечил и заблокировал.
    // Высота строки — чтобы обе таблицы влезли до кнопок.
    const headers = tableMinHeight(0, compact);
    const row = Phaser.Math.Clamp(Math.floor((tableBottom - y - headers) / Math.max(1, r.units.length)), ROW_MIN, 85);
    const cols = [150, 430, 590, 740, 870, 985];
    const heads = ['', 'Урон', 'Лечение', 'Щит', 'Навыки', 'Жив'];
    const maxDmg = Math.max(1, ...Object.values(r.report).map((x) => x.damageDealt));
    const mvp = mvpOf(r, 'A');
    const fs = compact ? FS.caption : FS.small;
    // Цифры таблицы отсчитываются строка за строкой, полосы урона вырастают (juice.ts).
    let rowN = 0;
    const tally = (t: Phaser.GameObjects.Text, n: number) => countUp(this, t, 0, n, formatNumber, { delay: 300 + rowN * 50, duration: 550 });
    for (const side of ['A', 'B'] as const) {
      text(this, GAME_W / 2, y, side === 'A' ? 'Ваш отряд' : 'Противник', compact ? FS.body : FS.h3, side === 'A' ? C.success : C.enemy, BOLD_OUTLINE);
      y += TITLE_GAP(compact);
      heads.forEach((h, i) => text(this, cols[i], y, h, FS.caption, C.muted));
      // T3-03: строки начинаются ниже шапки на HEAD_GAP — рамка MVP (строка любой высоты) не наезжает на подписи колонок.
      y += HEAD_GAP(compact) + row / 2;
      r.units
        .filter((x) => x.side === side)
        .forEach((u, i) => {
          const rep = r.report[u.uid];
          const def = data.defs[u.unitId];
          const isMvp = u.uid === mvp;
          // Полосатые строки читаются легче; строка MVP — золотая.
          if (isMvp) this.add.rectangle(GAME_W / 2, y, 1000, row - 6, TINT.gold, 0.18).setStrokeStyle(3, TINT.gold, 0.9);
          else if (i % 2 === 0) this.add.rectangle(GAME_W / 2, y, 1000, row - 6, TINT.pressed, 0.18);
          const alpha = rep.alive ? 1 : 0.5;
          portrait(this, 70, y, portraitKey(def?.visual.sprite ?? u.unitId), row - 12).setAlpha(alpha).setTint(unitTint(def?.visual));
          if (isMvp) crown(this, 70 + (row - 12) / 2 - 6, y - (row - 12) / 2 + 6, 22);
          const name = text(this, cols[0] - 20, y, def?.name ?? u.unitId, fs, isMvp ? C.title : C.text, {
            fontStyle: isMvp ? 'bold' : 'normal',
          })
            .setOrigin(0, 0.5)
            .setAlpha(alpha);
          if (name.width > cols[1] - 70 - name.x) name.setScale((cols[1] - 70 - name.x) / name.width);
          if (isMvp) {
            // «MVP» — золотая плашка справа от имени; не влезает в строку — под именем (строка тогда выше).
            const tag = text(this, 0, 0, 'MVP', FS.caption, '#2a1c08', { fontStyle: 'bold' });
            const tw = tag.width + 16;
            const room = cols[1] - 70 - (name.x + name.displayWidth + 12);
            const [tx, ty] = room >= tw ? [name.x + name.displayWidth + 12 + tw / 2, y] : [cols[0] - 20 + tw / 2, y + 16];
            if (room < tw) name.setY(y - 12);
            this.add.rectangle(tx, ty, tw, tag.height + 2, TINT.gold).setStrokeStyle(2, 0x6b4a1a);
            tag.setPosition(tx, ty);
            this.children.bringToTop(tag);
          }
          const dmgBar = this.add.rectangle(cols[1] - 60, y + 22, 120 * (rep.damageDealt / maxDmg), 6, TINT.danger).setOrigin(0, 0.5);
          if (juiceOn() && rep.damageDealt > 0) this.tweens.add({ targets: dmgBar, width: { from: 0, to: dmgBar.width }, delay: 300 + rowN * 50, duration: 550, ease: 'Cubic.easeOut' });
          const dim = (n: number, color: string) => (n > 0 ? color : C.placeholder);
          tally(text(this, cols[1], y - 2, formatNumber(rep.damageDealt), fs, dim(rep.damageDealt, isMvp ? C.gold : C.text), { fontStyle: isMvp ? 'bold' : 'normal' }), rep.damageDealt);
          tally(text(this, cols[2], y, formatNumber(rep.healingDone), fs, dim(rep.healingDone, C.positive)), rep.healingDone);
          tally(text(this, cols[3], y, formatNumber(rep.shieldGiven), fs, dim(rep.shieldGiven, C.shield)), rep.shieldGiven);
          rowN++;
          // Главный навык юнита — значком слева от числа применений.
          const mainSkill = def?.skills.actives[0] ?? def?.skills.ult;
          const used = rep.ults + rep.skills;
          if (mainSkill) this.add.image(cols[4] - 34, y, skillIcon(this, GAME.content.skills[mainSkill])).setDisplaySize(Math.min(40, row - 14), Math.min(40, row - 14)).setAlpha(used > 0 ? 1 : 0.45);
          text(this, mainSkill ? cols[4] + 14 : cols[4], y, String(used), fs, dim(used, C.gold));
          text(this, cols[5], y, rep.alive ? '✓' : '✗', fs, rep.alive ? C.success : C.enemy, { fontStyle: 'bold' });
          y += row;
        });
      y += SIDE_GAP(compact) - row / 2;
    }
    /** Низ таблицы — для e2e (таблица не должна наезжать на строку «Авто»). */
    this.tableEnd = y;

    if (tower) {
      button(this, 190, 1830, 330, 130, 'k:buttonLong_beige', 'Приключения', () => this.scene.start('Adventure'), FS.h3);
      button(this, 540, 1830, 330, 130, 'ui_btn_secondary', 'К башне', () => this.scene.start('Tower'), FS.h3);
      button(this, 890, 1830, 330, 130, 'ui_btn_primary', win ? 'Выше' : 'Ещё раз', () => this.scene.start('Battle', { mode: 'tower' }), FS.h2);
      return;
    }

    if (stage) {
      const next = win ? nextOpenStage(session.save, stage.stageId, GAME) : null;
      const bw = 330;
      const retry = () => this.scene.start('Battle', { mode: 'stage', stageId: stage.stageId });
      if (!win) {
        // T1-07: после поражения — путь к отряду и героям, а не только «Повторить» тем же составом.
        const w4 = 250;
        const xs = [0, 1, 2, 3].map((i) => GAME_W / 2 + (i - 1.5) * (w4 + 12));
        button(this, xs[0], 1830, w4, 130, 'k:buttonLong_beige', 'Кампания', () => this.scene.start('Campaign'), FS.h3);
        button(this, xs[1], 1830, w4, 130, 'ui_btn_secondary', 'Отряд', () => this.scene.start('Stage', { stageId: stage.stageId }), FS.h3);
        button(this, xs[2], 1830, w4, 130, 'ui_btn_secondary', 'Герои', () => this.scene.start('Heroes'), FS.h3);
        button(this, xs[3], 1830, w4, 130, 'ui_btn_primary', 'Повторить', retry, FS.h3);
        this.autoRow(stage.stageId, win)();
        return;
      }
      button(this, 190, 1830, bw, 130, 'k:buttonLong_beige', 'К кампании', () => {
        markHint('result_home');
        this.scene.start('Campaign');
      }, FS.h3);
      button(this, 540, 1830, bw, 130, 'ui_btn_secondary', 'Повторить', retry, FS.h3);
      const nextBtn = button(this, 890, 1830, bw, 130, 'ui_btn_primary', 'Дальше', () => {
        markHint('result_next');
        if (next) this.scene.start('Stage', { stageId: next.id });
      }, FS.h2);
      if (!next) nextBtn.setEnabled(false).container.disableInteractive();
      const beginAuto = this.autoRow(stage.stageId, win);
      // Сюжет после первой победы на этапе — поверх итогов; авто-отсчёт — после него (в авто-режиме строки листаются
      // сами, медленно; финал главы — только касанием).
      const firstClear = stage.outcome.events.some((e) => e.type === 'stageCleared' && e.firstTime);
      const stageInfo = GAME.content.stages.find((x) => x.id === stage.stageId);
      // T1-03: первая победа над боссом главы — после финальной сцены экран «Глава пройдена» (ровно один раз:
      // метка в данных сцены — при возврате на итоги он не повторяется).
      const chapterDone = firstClear && !!stageInfo && chapterLastStage(stageInfo.chapter, GAME)?.id === stage.stageId && !(stage as ShownMark).chapterDoneShown;
      playStory(this, { type: 'afterStage', stageId: stage.stageId, firstClear }, () => {
        if (chapterDone && stageInfo) {
          (stage as ShownMark).chapterDoneShown = true;
          startChapterDone(this, { chapterId: stageInfo.chapter });
          // Этап открыл функцию — баннер «Новая функция!» (в авто-режиме не мешаем: покажется на карте или главной).
        } else if (autoAdvance.on) beginAuto();
        else
          showUnlockBanners(this, () => {
            // Обучение (hints.ts): первая победа — «Дальше»; потом, когда копится сундук или хватает на уровень, — «К кампании».
            const hint = firstClear ? pickResultHint({ hasNext: !!next, chestOrLevel: levelUpReady(session.save, GAME).length > 0 || session.save.campaign.cleared.length >= 2 }) : null;
            if (hint === 'result_next') tutorialHint(this, hint, 890, 1830, 'above', { w: bw, h: 130 });
            if (hint === 'result_home') tutorialHint(this, hint, 190, 1830, 'above', { w: bw, h: 130 });
            beginAuto();
          });
      }, { auto: autoAdvance.on });
      return;
    }

    button(this, 190, 1830, 330, 130, 'k:buttonLong_beige', 'Город', () => this.scene.start('Home'), FS.h3);
    button(this, 540, 1830, 330, 130, 'ui_btn_secondary', 'Отряд', () => this.scene.start('Prep'), FS.h3);
    button(this, 890, 1830, 330, 130, 'ui_btn_primary', 'Ещё раз', () =>
      this.scene.start('Battle', { mode: 'test', seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 }),
    FS.h3);
  }

  /**
   * R. «Авто: следующий этап» (как авто-бой в AFK Arena): переключатель запоминается; если он включён и бой
   * выигран, через AUTO_DELAY_MS сам стартует следующий новый этап главы. Любое касание экрана отменяет отсчёт.
   * Возвращает запуск отсчёта — его зовут, когда закрыт сюжетный диалог (если он был).
   */
  private autoRow(stageId: string, win: boolean): () => void {
    const y = AUTO_Y;
    this.autoTop = y - TOUCH / 2;
    const plan = autoNextStage(session.save, stageId, win, GAME);
    const toggle = button(this, 280, y, 520, TOUCH, 'k:buttonLong_beige', 'Авто: следующий этап', () => {
      setAutoAdvance(!autoAdvance.on);
      drawMark();
      if (autoAdvance.on) start();
      else cancel('Авто выключено');
    }, FS.small);
    // S: чекбокс — тёмный квадрат с рамкой; включён — зелёный с белой галочкой (читается на бежевой кнопке).
    const BOX = 52;
    toggle.label.setX(BOX / 2 + 10);
    const boxX = toggle.label.x - toggle.label.width / 2 - BOX / 2 - 16;
    const box = this.add.rectangle(boxX, -3, BOX, BOX, TINT.checkOff).setStrokeStyle(5, TINT.header);
    const check = text(this, boxX, -5, '✓', FS.h2, C.text, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 4 });
    toggle.container.add([box, check]);
    const drawMark = () => {
      box.setFillStyle(autoAdvance.on ? TINT.success : TINT.checkOff).setStrokeStyle(5, autoAdvance.on ? TINT.header : TINT.frame);
      check.setVisible(autoAdvance.on);
    };
    drawMark();

    const status = text(this, 790, y - 16, '', FS.small, C.muted, { ...OUTLINE, wordWrap: { width: 480 } });
    const bar = progressBar(this, 580, y + 32, 420, 16, 0, TINT.gold).setVisible(false);
    const fill = bar.list[1] as Phaser.GameObjects.Rectangle;
    const fullW = 420 - 4;

    const cancelOnTap = () => cancel('Авто отменено — нажмите «Дальше»');
    const cancel = (msg: string) => {
      this.autoTimer?.remove();
      this.autoTimer = null;
      this.input.off('pointerdown', cancelOnTap);
      bar.setVisible(false);
      status.setText(msg).setColor(C.muted);
    };
    const start = () => {
      if (!plan.next) {
        status.setText(AUTO_STOP_TEXT[plan.stop ?? 'no_next']).setColor(plan.stop === 'defeat' ? C.danger : C.warning);
        return;
      }
      const next = plan.next;
      // Время считаем тиками таймера (они замирают на паузе сцены), а не часами игры.
      const STEP = 100;
      let elapsed = -STEP;
      bar.setVisible(true);
      const tick = () => {
        elapsed += STEP;
        const left = Math.max(0, AUTO_DELAY_MS - elapsed);
        status.setText(`Этап ${stageNo(next, GAME)} через ${decimal(left / 1000, 1)} с\nкоснитесь экрана — отмена`).setColor(C.gold);
        fill.width = fullW * (1 - left / AUTO_DELAY_MS);
        if (left > 0) return;
        cancel('');
        // Сюжет перед новым этапом показывается и в авто-режиме — один раз, строки листаются сами.
        startStageBattle(this, next.id, { auto: true });
      };
      tick();
      this.autoTimer = this.time.addEvent({ delay: STEP, loop: true, callback: tick });
      // Касание в любом месте (в том числе по кнопкам внизу) — отмена отсчёта.
      this.input.on('pointerdown', cancelOnTap);
    };

    status.setText(autoAdvance.on ? '' : 'Включите — бои пойдут сами до конца главы');
    return () => {
      if (autoAdvance.on && !this.autoTimer) start();
    };
  }
}

const AUTO_STOP_TEXT: Record<AutoStop, string> = {
  defeat: 'Поражение — авто остановлено',
  chapter_end: 'Глава пройдена — авто остановлено',
  no_next: 'Дальше этапов нет',
  replay: 'Это повтор — авто идёт только по новым этапам',
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

/** Корона MVP — многоугольник (своей иконки в атласе нет). size — ширина. */
function crown(scene: Phaser.Scene, x: number, y: number, size: number): void {
  const w = size;
  const h = size * 0.7;
  const pts = [0, h, 0, h * 0.25, w * 0.25, h * 0.55, w * 0.5, 0, w * 0.75, h * 0.55, w, h * 0.25, w, h];
  scene.add.polygon(x, y, pts, TINT.gold).setStrokeStyle(3, 0x7a4a00).setDisplaySize(size * 1.6, h * 1.6);
}
