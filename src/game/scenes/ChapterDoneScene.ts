import Phaser from 'phaser';
import { GAME } from '../content';
import { applySceneSound } from '../audio';
import { sceneSoundOf } from '../sceneAudio';
import { playScenes } from '../dialogue';
import { formatNumber, heroSprite, levelText, ROLE_NAMES } from '../flow';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from '../layout';
import { confirm, cta, popIn, unitFigure } from '../screen';
import { arrangeSquad, pendingEvening, chapterChronicle, chroniclePageId, clearChapterDone, findingEntries, heroCard, heroName, heroPower, markPageSeen, pendingChronicle, type HeroState, type SaveState } from '../../core';
import { chroniclePage, showPages } from '../storyPage';
import { startTavernEvening } from './TavernEveningScene';
import { commit, session } from '../session';
import { setThemeBackground, themeOfChapter } from '../backdrops';
import { chapterSummary, sceneLabel, seenChapterScenes } from '../storyView';
import { BTN, button, clampLines, ellipsize, groupNum, panel, plate, rewardRow, ScrollArea, SURFACE, tag, text, toast, type ChipSpec } from '../ui';
import { C, COLOR, E, FS, M, OUTLINE, R, S, T, TINT } from '../theme';
import { countUp, juiceOn, moment } from '../juice';
import { glow } from '../decor';
import { Reveal } from '../rewardsView';

export interface ChapterDoneData {
  chapterId: string;
}

export const CHAPTER_DONE = 'ChapterDone';

/**
 * Открыть «Глава пройдена» (T1-03). Сцена регистрируется при первом показе — список сцен игры (main.ts) не трогаем.
 */
export function startChapterDone(from: Phaser.Scene, data: ChapterDoneData): void {
  if (!from.scene.get(CHAPTER_DONE)) from.scene.add(CHAPTER_DONE, ChapterDoneScene, false);
  from.scene.start(CHAPTER_DONE, data);
}

/** Имя слоя списка «История» (e2e). */
const HISTORY = 'history';

/** Раскладка (поле 1080×1920): заголовок момента, цитата, итоги главы, герой/«впереди», ряд «История…», CTA. */
const L = {
  titleY: 330,
  quoteY: 570,
  rewardsHeadY: 700,
  rewardsY: 770,
  cardY: 1090,
  cardH: 500,
  rowY: 1450,
  ctaY: 1690,
} as const;

/** Затемнение арта главы после «удара» заголовка (арт проступает, текст читается). */
const ART_DIM = 0.35;

type Summary = ReturnType<typeof chapterSummary>;

/**
 * T1-03. «Глава пройдена» — момент (juice.ts moment('newChapter'), §5 «Итог боя» P1): полноэкранный арт главы
 * (её карта), «Глава N пройдена!» и название, одна строка-крючок (цитата главы), итоги главы чипами,
 * новый герой (или «Впереди — …»), тихий ряд «История / Летопись / Вечер» и одна главная кнопка «Глава N ›».
 */
export class ChapterDoneScene extends Phaser.Scene {
  constructor() {
    super(CHAPTER_DONE);
  }

  create(data: ChapterDoneData): void {
    const sum = chapterSummary(session.save, data.chapterId, GAME);
    // Сцену добавляют при первом показе — хук звука экранов (installAudio) её не знает: музыка босса сменяется картой главы сама.
    try {
      applySceneSound(sceneSoundOf(this));
    } catch {
      // Звук не должен ломать экран.
    }
    const cx = GAME_W / 2;
    // Арт пройденной главы во весь экран, ярко; низ притемнён под текст и кнопки. Не карта следующей главы: фон вида
    // 'map' держится один на игру (backdrops.ts hold), а страница летописи поверх рисует карту этой главы — чужая
    // выгрузила бы текстуру из-под экрана (glTexture null, чёрный экран).
    setThemeBackground(this.add.image(cx, GAME_H / 2, 'skin_bg_forest'), 'map', themeOfChapter(data.chapterId));
    this.add.image(cx, GAME_H + BLEED_Y, fadeTexture(this)).setOrigin(0.5, 1).setDisplaySize(GAME_W + 2 * BLEED_X, GAME_H * 0.62 + BLEED_Y);

    const name = sum.name.replace(/^Глава\s*\d+\.\s*/, '');
    // Слои момента — на глубине 1–3, под содержимым экрана (окна «История», летопись, подтверждения — над ними);
    // затемнение после «удара» заголовка отступает до ART_DIM — арт новых земель проступает.
    moment(this, 'newChapter', {
      title: `Глава ${sum.number} пройдена!`,
      subtitle: name,
      at: { x: cx, y: L.titleY },
      keep: true,
      depth: 1,
      dimAfter: ART_DIM,
      onSettled: () => this.body(data, sum),
    });
  }

  /** Содержимое под заголовком — по одной (Reveal), кнопки последними; летопись главы (первый раз) — после них. */
  private body(data: ChapterDoneData, sum: Summary): void {
    const cx = GAME_W / 2;
    const layer = this.add.container(0, 0).setDepth(10);
    const reveal = new Reveal(this);

    // Строка-крючок — цитата главы (episode.quote).
    const quote = GAME.content.chapters.find((c) => c.id === data.chapterId)?.episode?.quote;
    if (quote) {
      const q = clampLines(text(this, cx, L.quoteY, `«${quote}»`, T.body, COLOR.textPrimary, { fontStyle: 'italic', wordWrap: { width: GAME_W - 2 * S.xl } }), 2).setName('chapterQuote');
      q.setShadow(0, 3, '#000000', 8, true, true);
      layer.add(q);
      reveal.step([q]);
    }

    // Итоги главы чипами: этапы, золото, опыт (числа отсчитываются).
    const head = text(this, cx, L.rewardsHeadY, 'Итоги главы', T.caption, COLOR.textPrimary, { fontStyle: 'bold' });
    head.setShadow(0, 2, '#000000', 6, true, true);
    layer.add(head);
    reveal.step([head]);
    const chips: ChipSpec[] = [
      { icon: 'flag', value: `${sum.cleared} / ${sum.stages}`, tone: 'positive' },
      { icon: 'gold', value: sum.gold, tone: 'gold' },
      { icon: 'hero_exp', value: sum.jobExp, tone: 'positive' },
    ];
    const row = rewardRow(this, cx, L.rewardsY, chips, { maxW: GAME_W - 2 * S.l });
    layer.add(row);
    const amounts = [0, sum.gold, sum.jobExp];
    (row.list as Phaser.GameObjects.Container[]).forEach((c, i) => {
      const label = c.list.find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
      reveal.step([c], (instant) => {
        if (!instant && amounts[i] && label) countUp(this, label, 0, amounts[i], groupNum);
      });
    });

    // Новый герой — карточка с фигурой; без него — «Впереди — Глава N».
    const card = this.add.container(0, 0);
    layer.add(card);
    if (sum.recruit) this.recruitCard(card, data, sum.recruit);
    else this.aheadCard(card, sum);
    reveal.step([card]);

    reveal.play(() => {
      for (const o of this.buttons(data, sum)) {
        o.setDepth(20);
        if (!juiceOn()) continue;
        o.setAlpha(0);
        this.tweens.add({ targets: o, alpha: 1, duration: M.base, ease: E.out });
      }
      // «Летопись отряда» главы (lore-route §5.3) — в первый раз открывается сама, когда экран встал.
      if (chapterChronicle(data.chapterId, GAME.content) && pendingChronicle(session.save, data.chapterId, GAME.content)) this.openChronicle(data, sum.number);
    }, M.slow);
  }

  /** Карточка героя истории: фигура, имя, профессия; не в отряде — «Взять в отряд». */
  private recruitCard(c: Phaser.GameObjects.Container, data: ChapterDoneData, hero: HeroState): void {
    const save = session.save;
    const cx = GAME_W / 2;
    const top = L.cardY - L.cardH / 2;
    const info = heroCard(hero, GAME);
    // Герой мог прийти из Таверны раньше своей сцены (пул — все 12): тогда рекрут принёс копию, и «новый» — неправда.
    const had = save.heroes.filter((h) => h.templateId === hero.templateId).length > 1;
    // RN-02: герой истории, которого нет в отряде (отряд был полон), — явно зовём поставить его в бой.
    const inSquad = save.squad.some((id) => id !== null && save.heroes.find((h) => h.id === id)?.templateId === hero.templateId);
    c.add(plate(this, cx, L.cardY, GAME_W - 2 * S.l, L.cardH, { ...SURFACE.raised, r: R.l }));
    const feet = top + 290;
    c.add(glow(this, cx, feet - 110, 128, 0xffd27a, 0.4).setScale(2.4, 2.6));
    c.add(this.add.ellipse(cx, feet, 220, 50, 0x000000, 0.35));
    const figs = this.add.container(0, 0);
    c.add(figs);
    unitFigure(this, heroSprite(hero, GAME), cx, feet, 230, { maxScale: 2, onReady: (o) => (figs.scene ? figs.add(o) : o.destroy()) });
    c.add(tag(this, cx, top, had ? 'Герой истории' : 'Новый герой', 'accent', { solid: true }));
    const job = `${info.jobName} · ${ROLE_NAMES[info.role] ?? ''} · ${levelText(info.level)}`;
    if (inSquad) {
      c.add(text(this, cx, feet + 70, had ? `${info.name} присоединяется по сюжету` : `${info.name} присоединяется к отряду`, T.body, COLOR.title, { fontStyle: 'bold' }).setName('recruitName'));
      c.add(text(this, cx, feet + 122, job, T.caption, COLOR.textSecondary));
      return;
    }
    c.add(text(this, cx, feet + 50, `${info.name} с вами — но не в отряде`, T.body, COLOR.title, { fontStyle: 'bold' }).setName('recruitName'));
    c.add(text(this, cx, feet + 96, job, T.caption, COLOR.textSecondary));
    const take = button(this, cx, top + L.cardH - BTN.m / 2 - S.xs, 480, BTN.m, '', 'Взять в отряд', () => {
      const go = () => {
        const r = takeIntoSquad(session.save, hero.id);
        commit(r.save);
        toast(this, r.replaced ? `${info.name} в отряде вместо: ${r.replaced}` : `${info.name} в отряде`);
        this.scene.restart(data);
      };
      // RR-01: не менять молча героя сильнее рекрута — спросить.
      const out = squadSwapCandidate(session.save, hero.id);
      if (out?.stronger) confirm(this, `${out.name} сильнее: ${formatNumber(out.power)} мощи против ${formatNumber(out.recruitPower)}. Снять ${out.name} ради ${info.name}?`, 'Заменить', go);
      else go();
    }, T.body, { variant: 'secondary' });
    take.container.setName('recruitTake');
    c.add(take.container);
  }

  /** Без нового героя: куда дальше (после последней главы — «скоро» и чем заняться). */
  private aheadCard(c: Phaser.GameObjects.Container, sum: Summary): void {
    const cx = GAME_W / 2;
    c.add(text(this, cx, L.cardY - 50, sum.next ? 'Впереди' : 'Новые главы — скоро', T.caption, COLOR.accent, { fontStyle: 'bold' }));
    const line = sum.next ? sum.next.name : 'А пока — Башня испытаний и Охота в «Приключениях»';
    const t = text(this, cx, L.cardY + 20, line, sum.next ? T.title : T.body, sum.next ? COLOR.title : COLOR.textPrimary, { fontStyle: 'bold', wordWrap: { width: GAME_W - 2 * S.xl } });
    t.setShadow(0, 3, '#000000', 8, true, true);
    c.add(t);
  }

  /** Тихий ряд «История / Летопись / Вечер» и главная «Глава N ›». Возвращает показанные объекты. */
  private buttons(data: ChapterDoneData, sum: Summary): (Phaser.GameObjects.Container | Phaser.GameObjects.Text)[] {
    const save = session.save;
    const cx = GAME_W / 2;
    const out: (Phaser.GameObjects.Container | Phaser.GameObjects.Text)[] = [];
    const history = seenChapterScenes(save, data.chapterId, GAME);
    const chronicle = chapterChronicle(data.chapterId, GAME.content);
    // Вечер в «Двух колоколах» (docs/design/tavern-evenings.md) — новый с красной точкой.
    const evening = GAME.story.tavern?.evenings.find((e) => e.after === data.chapterId);
    const items: { label: string; name: string; onTap: () => void; enabled: boolean; dot?: boolean }[] = [
      { label: 'История', name: 'storyHistoryBtn', onTap: () => openStoryHistory(this, data.chapterId), enabled: history.length > 0 },
    ];
    if (chronicle) items.push({ label: 'Летопись', name: 'chronicleChapterBtn', onTap: () => this.openChronicle(data, sum.number), enabled: true });
    if (evening) {
      items.push({
        label: 'Вечер',
        name: 'tavernEveningBtn',
        onTap: () => startTavernEvening(this, { mode: 'evening', id: evening.id, back: { to: CHAPTER_DONE, data } }),
        enabled: true,
        dot: !!pendingEvening(save, data.chapterId, GAME),
      });
    }
    const w = items.length === 3 ? 312 : 400;
    items.forEach((it, i) => {
      const x = cx + (i - (items.length - 1) / 2) * (w + S.s);
      const b = button(this, x, L.rowY, w, BTN.m, '', it.label, it.onTap, T.body, { variant: 'secondary' });
      b.container.setName(it.name);
      if (!it.enabled) b.setEnabled(false).container.disableInteractive();
      if (it.dot) b.container.add(this.add.circle(w / 2 - 14, -BTN.m / 2 + 14, 14, TINT.badge).setStrokeStyle(4, 0xffffff));
      out.push(b.container);
    });
    const next = sum.next;
    const go = cta(this, cx, L.ctaY, next ? `Глава ${next.number} ›` : 'К кампании', () => {
      // Игрок ушёл с экрана — больше не показывать (метка в сохранении держала его на случай перезагрузки).
      commit(clearChapterDone(session.save));
      this.scene.start('Campaign', next ? { chapter: next.index } : {});
    }, { w: 700 });
    out.push(go.container);
    // Название следующей главы под кнопкой — когда его не показала карточка «Впереди».
    if (next && sum.recruit) out.push(ellipsize(text(this, cx, L.ctaY + BTN.cta / 2 + S.l, next.name.replace(/^Глава\s*\d+\.\s*/, ''), T.caption, COLOR.textSecondary), 900));
    return out;
  }

  /** «Летопись отряда» главы — страница поверх экрана; прочитана — отметка в сохранении. */
  private openChronicle(data: ChapterDoneData, number: number): void {
    const chronicle = chapterChronicle(data.chapterId, GAME.content);
    if (!chronicle) return;
    const found = findingEntries(session.save, GAME.content).filter((f) => f.chapterId === data.chapterId);
    showPages(this, [chroniclePage(data.chapterId, number, chronicle, { got: found.filter((f) => f.found).length, total: found.length })], () =>
      commit(markPageSeen(session.save, chroniclePageId(data.chapterId))),
    );
  }
}

/** Вертикальный градиент «прозрачно → фон» (низ экрана под текст и кнопки); одна текстура на игру. */
function fadeTexture(scene: Phaser.Scene): string {
  const key = 'chapter_done_fade';
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, 4, 256);
  if (!t) return '__WHITE';
  const c = t.getContext();
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(13,14,11,0)');
  g.addColorStop(0.45, 'rgba(13,14,11,0.7)');
  g.addColorStop(1, 'rgba(13,14,11,0.95)');
  c.fillStyle = g;
  c.fillRect(0, 0, 4, 256);
  t.refresh();
  return key;
}

/**
 * RN-02 / RR-01. Кого снять из полного отряда ради героя heroId: самый слабый по мощи; stronger — он сильнее рекрута
 * (экран спрашивает, а не меняет молча). undefined — в отряде есть свободное место.
 */
export function squadSwapCandidate(save: SaveState, heroId: string): { slot: number; name: string; power: number; recruitPower: number; stronger: boolean } | undefined {
  if (save.squad.some((id) => id === null)) return undefined;
  let slot = -1;
  let min = Infinity;
  save.squad.forEach((id, i) => {
    const h = save.heroes.find((x) => x.id === id);
    if (!h) return;
    const p = heroPower(h, GAME, save);
    if (p < min) {
      min = p;
      slot = i;
    }
  });
  const gone = save.heroes.find((x) => x.id === save.squad[slot]);
  const recruit = save.heroes.find((x) => x.id === heroId);
  if (slot < 0 || !gone || !recruit) return undefined;
  const recruitPower = heroPower(recruit, GAME, save);
  return { slot, name: heroName(gone, GAME), power: min, recruitPower, stronger: min > recruitPower };
}

/**
 * RN-02. Поставить героя истории в отряд: на свободное место, иначе вместо самого слабого (по мощи) героя отряда
 * (squadSwapCandidate; если он сильнее рекрута — экран сначала спрашивает); затем расстановка по ролям (arrangeSquad).
 * replaced — имя того, кого сняли.
 */
export function takeIntoSquad(save: SaveState, heroId: string): { save: SaveState; replaced?: string } {
  const squad = [...save.squad];
  let slot = squad.findIndex((id) => id === null);
  let replaced: string | undefined;
  if (slot < 0) {
    const out = squadSwapCandidate(save, heroId);
    slot = out?.slot ?? -1;
    replaced = out?.name;
  }
  if (slot < 0) return { save };
  squad[slot] = heroId;
  const next = { ...save, squad };
  return { save: { ...next, squad: arrangeSquad(next, GAME) }, replaced };
}

/** «История» (P3 / T1-03): список увиденных сцен главы; касание — пересмотреть сцену поверх экрана. */
export function openStoryHistory(sc: Phaser.Scene, chapterId: string): void {
  if (sc.children.getByName(HISTORY)) return;
  const scenes = seenChapterScenes(session.save, chapterId, GAME);
  const layer = sc.add.container(0, 0).setDepth(9000).setName(HISTORY);
  const shade = sc.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
  const rowH = 118;
  // NB-01: все увиденные сцены (в главе 1 их 13) — не влезают в окно, список прокручивается.
  const visibleRows = Math.min(Math.max(1, scenes.length), 9);
  const h = 370 + visibleRows * rowH;
  const top = GAME_H / 2 - h / 2;
  const box = panel(sc, GAME_W / 2, GAME_H / 2, 940, h, 'ui_panel').setInteractive();
  const head = text(sc, GAME_W / 2, top + 80, 'История главы', FS.h1, C.title, { fontStyle: 'bold', ...OUTLINE });
  // Черта под заголовком.
  const line = sc.add.rectangle(GAME_W / 2, top + 140, 860, 2, TINT.frame, 0.5);
  layer.add([shade, box, head, line]);
  const close = () => layer.destroy();
  shade.on('pointerup', close);
  if (!scenes.length) layer.add(text(sc, GAME_W / 2, top + 200, 'Сцен этой главы вы ещё не видели', FS.body, C.muted));
  const done = button(sc, GAME_W / 2, top + h - 90, 400, 110, 'ui_btn_primary', 'Закрыть', close, FS.h3);
  layer.add(done.container);
  popIn(sc, layer, shade);
  // Список — после popIn: прокрутка живёт в координатах экрана, окно «вырастает» без неё (160 мс).
  const listTop = top + 150;
  const area = new ScrollArea(sc, listTop, listTop + visibleRows * rowH);
  layer.add(area.parts);
  // Полоса прокрутки — у правой кромки окна, а не экрана.
  (area.parts[1] as Phaser.GameObjects.Rectangle).setX(GAME_W / 2 + 448);
  scenes.forEach((s, i) => {
    const b = button(sc, GAME_W / 2, rowH / 2 + i * rowH, 800, 100, 'k:buttonLong_beige', `▶  ${sceneLabel(s, GAME)}`, area.tap(() => {
      close();
      playScenes(sc, [s], () => {}, { readOnly: true });
    }), FS.h3);
    area.add(b.container);
  });
  area.setContentHeight(scenes.length * rowH);
}
