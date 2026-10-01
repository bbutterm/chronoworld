import Phaser from 'phaser';
import { GAME } from '../content';
import { haptic } from '../haptics';
import { applySceneSound } from '../audio';
import { sceneSoundOf } from '../sceneAudio';
import { playScenes } from '../dialogue';
import { formatNumber, heroSprite, levelText, ROLE_NAMES } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, confirm, popIn, unitFigure } from '../screen';
import { arrangeSquad, pendingEvening, chapterChronicle, chroniclePageId, clearChapterDone, findingEntries, heroCard, heroName, heroPower, markPageSeen, pendingChronicle, type SaveState } from '../../core';
import { chroniclePage, showPages } from '../storyPage';
import { startTavernEvening } from './TavernEveningScene';
import { commit, now, session } from '../session';
import { SKIN } from '../skin';
import { setThemeBackground, themeOfChapter } from '../backdrops';
import { chapterSummary, playTimeText, sceneLabel, seenChapterScenes } from '../storyView';
import { button, ellipsize, panel, ScrollArea, text, toast } from '../ui';
import { C, FS, OUTLINE, TINT } from '../theme';

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

/**
 * T1-03. «Глава пройдена» — после финальной сцены главы (docs/design/chapter1.md §7.2): название главы, итоги
 * (этапы, время, награды), карточка нового героя, «История» (пересмотр увиденных сцен главы) и «Глава N ›».
 */
export class ChapterDoneScene extends Phaser.Scene {
  constructor() {
    super(CHAPTER_DONE);
  }

  create(data: ChapterDoneData): void {
    const save = session.save;
    const sum = chapterSummary(save, data.chapterId, GAME);
    // Глава пройдена — открылась следующая.
    haptic('unlock');
    // Сцену добавляют при первом показе — хук звука экранов (installAudio) её не знает: музыка босса сменяется картой главы сама.
    try {
      applySceneSound(sceneSoundOf(this));
    } catch {
      // Звук не должен ломать экран.
    }
    const cx = GAME_W / 2;
    // Фон — карта пройденной главы (луг, топь, склеп), притемнённая.
    setThemeBackground(this.add.image(cx, GAME_H / 2, 'skin_bg_forest'), 'map', themeOfChapter(data.chapterId));
    this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0x07060a, 0.55);
    if (this.textures.exists('skin_rays')) {
      const rays = this.add.image(cx, 300, 'skin_rays').setDisplaySize(1200, 1200).setAlpha(0.35);
      this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
      // Второй веер навстречу — светом, слабее: лучи переливаются.
      const rays2 = this.add.image(cx, 300, 'skin_rays').setDisplaySize(820, 820).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: rays2, alpha: 0.28, duration: 800 });
      this.tweens.add({ targets: rays2, angle: -360, duration: 26000, repeat: -1 });
    }
    // Золотые искры медленно поднимаются по всему экрану (по кругу).
    if (this.textures.exists('skin_spark')) {
      for (let i = 0; i < 14; i++) {
        const x0 = Phaser.Math.Between(60, GAME_W - 60);
        const s = this.add.image(x0, GAME_H + 40, 'skin_spark').setTint(i % 3 ? 0xffd884 : 0xfff4d0).setScale(0.2 + Math.random() * 0.3).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        this.tweens.add({
          targets: s,
          y: Phaser.Math.Between(80, 700),
          x: x0 + Phaser.Math.Between(-80, 80),
          angle: 180,
          alpha: { from: 0.85, to: 0 },
          duration: 4200 + Math.random() * 2500,
          delay: Math.random() * 4000,
          repeat: -1,
        });
      }
    }

    // --- Заголовок ---
    const title = text(this, cx, 200, `Глава ${sum.number} пройдена!`, FS.hero + 8, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 });
    ellipsize(title, 1000);
    title.setScale(0.5).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 450, ease: 'Back.easeOut' });
    const subtitle = sum.name.replace(/^Глава\s*\d+\.\s*/, '');
    const sub = ellipsize(text(this, cx, 290, subtitle, FS.h2, SKIN.cream, { fontStyle: 'bold', ...OUTLINE }), 1000);
    // Золотой разделитель под подзаголовком: две черты, гаснущие к краям, и ромб по центру.
    const dy = 290 + sub.height / 2 + 18;
    const g = this.add.graphics();
    for (const d of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        g.fillStyle(TINT.gold, 1 - i / 12);
        g.fillRect(cx + d * (26 + i * 16) - (d < 0 ? 16 : 0), dy - 2, 16, 4);
      }
    }
    g.fillStyle(TINT.gold, 1).fillPoints([new Phaser.Math.Vector2(cx, dy - 12), new Phaser.Math.Vector2(cx + 12, dy), new Phaser.Math.Vector2(cx, dy + 12), new Phaser.Math.Vector2(cx - 12, dy)], true);
    g.setAlpha(0);
    this.tweens.add({ targets: g, alpha: 1, duration: 500, delay: 300 });

    // --- Итоги ---
    const sy = 480;
    card(this, cx, sy, 1000, 250);
    const row = (y: number, label: string, value: string, color: string = C.text) => {
      text(this, 110, y, label, FS.body, C.muted).setOrigin(0, 0.5);
      text(this, 970, y, value, FS.body, color, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    };
    row(sy - 75, 'Этапы', `${sum.cleared} / ${sum.stages}`, C.success);
    // LT-11: время считается с начала игры (своего счёта у главы нет) — так и подписано.
    row(sy - 25, 'С начала игры', playTimeText(now() - save.createdAt));
    row(sy + 25, 'Награды главы', `золото ${formatNumber(sum.gold)} · опыт ${formatNumber(sum.jobExp)}`, C.gold);
    row(sy + 75, 'Трофеев в сумке', String(sum.items), '#6fb8ff');

    // --- Новый герой ---
    const ry = 1010;
    if (sum.recruit) {
      const hero = sum.recruit;
      const c = heroCard(hero, GAME);
      // Герой мог прийти из Таверны раньше своей сцены (пул — все 12): тогда рекрут принёс копию, и «новый» — неправда.
      const had = save.heroes.filter((h) => h.templateId === hero.templateId).length > 1;
      card(this, cx, ry, 1000, 620, true);
      text(this, cx, ry - 260, had ? 'Герой истории с вами' : 'Новый герой в отряде!', FS.h2, C.inkGold, { fontStyle: 'bold' });
      // Тёплый отсвет за новым героем и тень под ногами.
      const halo = this.add.ellipse(cx, ry + 40, 420, 300, 0xffd27a, 0.1).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: halo, fillAlpha: { from: 0.06, to: 0.16 }, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut' });
      this.add.ellipse(cx, ry + 110, 300, 60, 0x000000, 0.3);
      unitFigure(this, heroSprite(hero, GAME), cx, ry + 110, 300, { maxScale: 2 });
      // RN-02: герой истории, которого нет в отряде (отряд был полон), — явно зовём поставить его в бой.
      const inSquad = save.squad.some((id) => id !== null && save.heroes.find((h) => h.id === id)?.templateId === hero.templateId);
      if (inSquad) {
        text(this, cx, ry + 180, had ? `${c.name} присоединяется по сюжету` : `${c.name} присоединяется к отряду`, FS.h2, C.ink, { fontStyle: 'bold' }).setName('recruitName');
        text(this, cx, ry + 240, `${c.jobName} · ${ROLE_NAMES[c.role] ?? ''} · ${levelText(c.level)}`, FS.body, C.inkMuted);
      } else {
        text(this, cx, ry + 160, `${c.name} с вами — но не в отряде`, FS.h2, C.ink, { fontStyle: 'bold' }).setName('recruitName');
        text(this, cx, ry + 212, `${c.jobName} · ${ROLE_NAMES[c.role] ?? ''} · ${levelText(c.level)}`, FS.body, C.inkMuted);
        button(this, cx, ry + 280, 560, 96, 'ui_btn_primary', 'Взять в отряд', () => {
          const take = () => {
            const r = takeIntoSquad(session.save, hero.id);
            commit(r.save);
            toast(this, r.replaced ? `${c.name} в отряде вместо: ${r.replaced}` : `${c.name} в отряде`);
            this.scene.restart(data);
          };
          // RR-01: не менять молча героя сильнее рекрута — спросить.
          const out = squadSwapCandidate(session.save, hero.id);
          if (out?.stronger) confirm(this, `${out.name} сильнее: ${formatNumber(out.power)} мощи против ${formatNumber(out.recruitPower)}. Снять ${out.name} ради ${c.name}?`, 'Заменить', take);
          else take();
        }, FS.h3).container.setName('recruitTake');
      }
    } else {
      card(this, cx, ry, 1000, 300, true);
      // BUG-159: вместо одной и той же «Отряд готов к новым землям» — цитата главы (episode.quote) и куда дальше.
      const quote = GAME.content.chapters.find((c) => c.id === data.chapterId)?.episode?.quote;
      if (quote) text(this, cx, ry - 50, `«${quote}»`, FS.h3, C.ink, { fontStyle: 'italic', align: 'center', wordWrap: { width: 900 } }).setName('chapterQuote');
      // LT-11: после последней главы новых земель пока нет — куда идти дальше.
      const where = sum.next ? `Дальше — ${sum.next.name}` : 'Новые главы — скоро';
      text(this, cx, quote ? ry + 60 : ry - (sum.next ? 0 : 30), where, quote ? FS.body : FS.h2, C.ink, { fontStyle: 'bold', align: 'center', wordWrap: { width: 900 } });
      if (!sum.next) text(this, cx, quote ? ry + 110 : ry + 40, 'А пока — Башня испытаний и Охота в «Приключениях»', FS.body, C.inkMuted, { wordWrap: { width: 900 } });
    }

    // --- Кнопки ---
    const history = seenChapterScenes(save, data.chapterId, GAME);
    const chronicle = chapterChronicle(data.chapterId, GAME.content);
    // «Летопись отряда» главы (lore-route §5.3) — рядом с «Историей»; в первый раз открывается сама, когда улёгся заголовок.
    // Вечер в «Двух колоколах» (docs/design/tavern-evenings.md) — третья кнопка ряда; новый — с отметкой и приглашением.
    const evening = GAME.story.tavern?.evenings.find((e) => e.after === data.chapterId);
    const btnRow = 1 + (chronicle ? 1 : 0) + (evening ? 1 : 0);
    const rowW = btnRow === 3 ? 320 : btnRow === 2 ? 500 : 560;
    const rowX = (i: number) => cx + (i - (btnRow - 1) / 2) * (btnRow === 3 ? 340 : 540);
    const hx = rowX(0);
    const hb = button(this, hx, 1480, rowW, 120, 'ui_btn_secondary', 'История', () => openStoryHistory(this, data.chapterId), FS.h2);
    if (!history.length) hb.setEnabled(false).container.disableInteractive();
    if (evening) {
      const fresh = !!pendingEvening(save, data.chapterId, GAME);
      const ex = rowX(btnRow - 1);
      const eb = button(this, ex, 1480, rowW, 120, fresh ? 'ui_btn_primary' : 'ui_btn_secondary', 'Вечер', () => {
        startTavernEvening(this, { mode: 'evening', id: evening.id, back: { to: CHAPTER_DONE, data } });
      }, FS.h2);
      eb.container.setName('tavernEveningBtn');
      if (fresh) {
        this.add.circle(ex + rowW / 2 - 16, 1480 - 52, 16, TINT.badge).setStrokeStyle(4, 0xffffff);
        const invite = text(this, cx, 1392, 'Вечером в «Двух колоколах» ждут вас', FS.small, SKIN.goldLight, { fontStyle: 'italic', ...OUTLINE });
        this.tweens.add({ targets: invite, alpha: { from: 1, to: 0.55 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: eb.container, scale: { from: 1, to: 1.05 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
    if (chronicle) {
      const open = () => {
        const found = findingEntries(session.save, GAME.content).filter((f) => f.chapterId === data.chapterId);
        showPages(this, [chroniclePage(data.chapterId, sum.number, chronicle, { got: found.filter((f) => f.found).length, total: found.length })], () =>
          commit(markPageSeen(session.save, chroniclePageId(data.chapterId))),
        );
      };
      button(this, rowX(1), 1480, rowW, 120, 'ui_btn_secondary', 'Летопись', open, FS.h2).container.setName('chronicleChapterBtn');
      if (pendingChronicle(save, data.chapterId, GAME.content)) this.time.delayedCall(1400, () => this.scene.isActive() && open());
    }
    const next = sum.next;
    button(this, cx, 1700, 760, 170, 'ui_btn_primary', next ? `Глава ${next.number} ›` : 'К кампании', () => {
      // Игрок ушёл с экрана — больше не показывать (метка в сохранении держала его на случай перезагрузки).
      commit(clearChapterDone(session.save));
      this.scene.start('Campaign', next ? { chapter: next.index } : {});
    }, FS.hero);
    if (next) ellipsize(text(this, cx, 1820, next.name.replace(/^Глава\s*\d+\.\s*/, ''), FS.small, SKIN.creamDim, OUTLINE), 900);
  }
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
      playScenes(sc, [s], () => {});
    }), FS.h3);
    area.add(b.container);
  });
  area.setContentHeight(scenes.length * rowH);
}
