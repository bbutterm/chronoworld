import Phaser from 'phaser';
import { tavernNewCount, bestiary, chapterChronicle, chapterCleared, eveningStatus, newEvenings, findingEntries, FINDING_KIND_NAMES, firstSentence, heroEntries, heroTemplate, introPages, itemEntries, jobTitle, keeperIds, worldEntries, type BestiaryEntry, type ChronicleTab, type FindingEntry, type HeroEntry, type ItemEntry, type WorldItem } from '../../core';
import { hasHeroStory, heroStoryNew, heroStoryProgress, openHeroStory, storyDot } from '../heroStoryView';
import { chroniclePage, findingIcon, findingPage, introPages as introPageList, showPages, type StoryPage } from '../storyPage';
import { seenChapterScenes } from '../storyView';
import { openStoryHistory } from './ChapterDoneScene';
import { startTavernEvening } from './TavernEveningScene';
import { CONTENT, GAME, LORE } from '../content';
import { itemStatsText, RARITY_COLORS, RARITY_NAMES, SLOT_NAMES } from '../flow';
import { drawHeroCard, heroCardSize } from '../heroCard';
import { itemCell } from '../itemIcons';
import { GAME_W } from '../layout';
import { loreKeys, loreModal, loreUnseen, markLoreSeen, monsterModal, itemModal, roleName, seenLore, type LoreBlock } from '../loreView';
import { badge, card, CONTENT_TOP, contentBottom, portrait, screen, unitTint } from '../screen';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, emptyState, pressable, ScrollArea, text, toast } from '../ui';
import { C, FS, OUTLINE, TINT, TOUCH } from '../theme';

const TABS: { id: ChronicleTab; label: string }[] = [
  { id: 'world', label: 'Мир' },
  { id: 'findings', label: 'Находки' },
  { id: 'bestiary', label: 'Бестиарий' },
  { id: 'items', label: 'Предметы' },
  { id: 'heroes', label: 'Герои' },
];

/** Последняя открытая вкладка (в пределах сессии). */
let lastTab: ChronicleTab = 'world';

export interface ChronicleData {
  tab?: ChronicleTab;
  /** Прокрутка списка после перезапуска (закрыли историю героя — список остаётся на том же месте, BUG-155). */
  scroll?: number;
}

/** Сетка плиток: 3 колонки. */
const COLS = 3;
const TILE_W = 330;
const colX = (i: number) => GAME_W / 2 + (i - (COLS - 1) / 2) * (TILE_W + 12);
const TEXT_W = 940;
const LEFT = 70;

/**
 * «Летопись» (лор Ragnarok Online, data/lore): вкладки «Мир» (главы и записи мира), «Бестиарий» (монстры кампании —
 * открыты после победы на их этапе, закрытые — силуэт и «???»), «Предметы» (легенды; открыт — есть у игрока или его
 * глава достигнута), «Герои» (история и черты полученных; остальные — только краткая био). Вход — кнопка на странице
 * «Город»; красный кружок — новые записи (прочитанное помнится в localStorage, loreView.ts).
 */
export class ChronicleScene extends Phaser.Scene {
  private area!: ScrollArea;
  private tab: ChronicleTab = 'world';
  private seen = new Set<string>();
  /** Записи вкладки, которые считаются «новыми», пока не прочитаны (открытые, с текстом лора). */
  private readable = new Set<string>();

  constructor() {
    super('Chronicle');
  }

  create(data: ChronicleData = {}): void {
    this.tab = data.tab ?? lastTab;
    lastTab = this.tab;
    screen(this, 'Летопись', 'Home', { to: 'Home' });
    // Что было прочитано до этого визита: «новое» отмечается точкой, затем вкладка считается прочитанной.
    this.seen = new Set(seenLore());
    const unseen = loreUnseen();
    const w = 1040 / TABS.length;
    const ty = CONTENT_TOP + 50;
    TABS.forEach((t, i) => {
      const on = t.id === this.tab;
      const x = 20 + w * (i + 0.5);
      const b = button(this, x, ty, w - 12, TOUCH, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t.label, () => {
        if (!on) this.scene.restart({ tab: t.id } satisfies ChronicleData);
      }, FS.small, { sound: 'ui_tab' });
      b.container.setName(`chronicleTab_${t.id}`);
      // Кружок — на верхней кромке вкладки, над подписью (в углу он закрывал «Бестиарий», «Предметы»).
      // «Мир» — ещё и новые вечера в «Двух колоколах» (их карточка — первая на вкладке).
      const n = unseen[t.id] + (t.id === 'world' ? tavernNewCount(session.save, GAME) : 0);
      if (!on) badge(this, x + (w - 12) / 2 - 20, ty - TOUCH / 2 - 4, n);
    });
    const keys = loreKeys()[this.tab];
    this.readable = new Set(keys);
    this.area = new ScrollArea(this, CONTENT_TOP + 170, contentBottom() + 10);
    if (this.tab === 'world') this.world();
    else if (this.tab === 'findings') this.findings();
    else if (this.tab === 'bestiary') this.bestiary();
    else if (this.tab === 'items') this.items();
    else this.heroes();
    if (data.scroll) this.area.offset = data.scroll;
    markLoreSeen(keys);
  }

  private summary(open: number, total: number, extra = '', label = 'Открыто'): void {
    text(this, GAME_W / 2, CONTENT_TOP + 132, `${label} ${open} из ${total}${extra}`, FS.body, C.muted, OUTLINE).setName('chronicleSummary');
  }

  /** Красная точка «новое» у записи. */
  private newDot(x: number, y: number, key: string): void {
    if (this.seen.has(key) || !this.readable.has(key)) return;
    this.area.add(this.add.circle(x, y, 16, TINT.badge).setStrokeStyle(4, 0xffffff));
  }

  // ---------- Мир ----------

  private world(): void {
    const list = worldEntries(session.save, CONTENT, LORE);
    this.summary(list.filter((w) => w.open).length, list.length);
    if (!list.length) {
      emptyState(this, GAME_W / 2, CONTENT_TOP + 400, 'Летописец ещё не начал свои записи.');
      return;
    }
    let y = this.tavernCard(0) + 20;
    for (const w of list) y = this.worldCard(w, y) + 20;
    this.area.setContentHeight(y + 20);
  }

  /** Вечера в «Двух колоколах» и близость (docs/design/tavern-evenings.md) — вход в «Вечера», новые — с отметкой. */
  private tavernCard(top: number): number {
    const t = GAME.story.tavern;
    if (!t) return top - 20;
    const a = this.area;
    const fresh = newEvenings(session.save, GAME).length;
    const open = t.evenings.filter((e) => eveningStatus(session.save, e, GAME) !== 'locked').length;
    const h = 250;
    const bg = a.add(card(this, GAME_W / 2, top + h / 2, 1040, h, true));
    a.add(text(this, LEFT, top + 50, 'Вечера в «Двух колоколах»', FS.h3, C.inkGold, { fontStyle: 'bold' }).setOrigin(0, 0.5));
    a.add(
      text(this, LEFT, top + 88, `Разговоры отряда после глав, близость с героями, личные сцены и задания. Открыто вечеров: ${open} из ${t.evenings.length}.`, FS.small, C.ink, {
        wordWrap: { width: 640 },
        align: 'left',
        lineSpacing: 4,
      }).setOrigin(0, 0),
    );
    const b = button(this, 860, top + h / 2, 280, 110, fresh ? 'ui_btn_primary' : 'ui_btn_secondary', 'Открыть', a.tap(() => startTavernEvening(this, { mode: 'hub', back: { to: 'Chronicle', data: { tab: 'world' } } })), FS.h3);
    b.container.setName('chronicleTavern');
    a.add(b.container);
    if (fresh) a.add(this.add.circle(1000, top + 30, 16, TINT.badge).setStrokeStyle(4, 0xffffff));
    pressable(this, bg, 1040, h, a.tap(() => startTavernEvening(this, { mode: 'hub', back: { to: 'Chronicle', data: { tab: 'world' } } })));
    return top + h;
  }

  private worldCard(w: WorldItem, top: number): number {
    const a = this.area;
    const objs: Phaser.GameObjects.Text[] = [];
    let y = top + 36;
    const line = (s: string, size: number, color: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}, gap = 12) => {
      const t = text(this, LEFT, y, s, size, color, { align: 'left', wordWrap: { width: TEXT_W }, lineSpacing: 6, ...style }).setOrigin(0, 0);
      objs.push(t);
      y += t.height + gap;
    };
    const chapter = w.kind === 'chapter' ? CONTENT.chapters.find((c) => c.id === w.id) : undefined;
    // Номер главы на маршруте (order): у Нифльхейма «Глава 10», даже пока главы 9 нет.
    const chNo = chapter?.order ?? 0;
    if (w.kind === 'chapter') line(`Глава ${chNo}${w.lore?.episode ? ` · ${w.lore.episode}` : ''}`, FS.small, C.dim, {}, 6);
    else line('Мир Мидгарда', FS.small, C.dim, {}, 6);
    // Страницы главы (эпизод и легенда, летопись, сцены) — кнопками под текстом.
    type PageBtn = { label: string; name: string; on: () => void; enabled: boolean };
    const btns: PageBtn[] = [];
    if (!w.open) {
      line('???', FS.h3, C.disabled, { fontStyle: 'bold' });
      line(
        w.kind === 'chapter' ? `Запись откроется, когда вы дойдёте до главы ${chNo}.` : `Запись откроется после победы на этапе ${w.unlockLabel ?? '?'}.`,
        FS.small,
        C.muted,
      );
    } else if (w.kind === 'chapter' && chapter) {
      const ep = chapter.episode;
      line(w.lore?.title ?? ep?.title ?? w.chapterName.replace(/^Глава\s*\d+\.\s*/, ''), FS.h3, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 5 }, 4);
      const where = w.lore?.location ?? ep?.subtitle;
      if (where) line(where, FS.small, C.info, { fontStyle: 'italic' });
      if (w.lore) line(w.lore.text, FS.body, C.text, {}, 0);
      else if (ep?.quote) line(`«${ep.quote}»`, FS.body, C.title, { fontStyle: 'italic' }, 0);
      const intro = introPages(chapter.id, CONTENT);
      if (intro) btns.push({ label: intro.episode ? `Эпизод ${chNo}` : 'Легенда', name: `chronicleEpisode_${chapter.id}`, on: () => this.read(introPageList(intro)), enabled: true });
      const chron = chapterChronicle(chapter.id, CONTENT);
      if (chron) {
        const done = chapterCleared(session.save, chapter.id, CONTENT);
        btns.push({
          label: 'Летопись',
          name: `chronicleChapter_${chapter.id}`,
          on: () => {
            if (!done) return toast(this, `Летопись главы ${chNo} допишется, когда глава будет пройдена`);
            const found = findingEntries(session.save, CONTENT).filter((f) => f.chapterId === chapter.id);
            this.read([chroniclePage(chapter.id, chNo, chron, { got: found.filter((f) => f.found).length, total: found.length })]);
          },
          enabled: done,
        });
      }
      const scenes = seenChapterScenes(session.save, chapter.id, GAME).length;
      btns.push({
        label: `Сцены (${scenes})`,
        name: `chronicleScenes_${chapter.id}`,
        on: () => {
          if (!scenes) return toast(this, 'Сцен этой главы вы ещё не видели');
          openStoryHistory(this, chapter.id);
          // Список под окном «Истории» не листается и не нажимается.
          a.locked = true;
          this.children.getByName('history')?.once(Phaser.GameObjects.Events.DESTROY, () => (a.locked = false));
        },
        enabled: scenes > 0,
      });
    } else if (w.kind === 'world') {
      line(w.entry.title, FS.h3, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 5 }, 12);
      line(w.entry.text, FS.body, C.text, {}, 0);
    }
    const BTN_H = 96;
    if (btns.length) y += 24 + BTN_H;
    const h = y - top + 36;
    const bg = a.add(card(this, GAME_W / 2, top + h / 2, 1040, h));
    if (!w.open) bg.setAlpha(0.6);
    for (const t of objs) a.add(t);
    if (btns.length) {
      const bw = Math.min(320, (TEXT_W + 40 - 16 * (btns.length - 1)) / btns.length);
      btns.forEach((b, i) => {
        const bx = LEFT + bw / 2 + i * (bw + 16);
        const btn = button(this, bx, y - BTN_H / 2, bw, BTN_H - 8, b.enabled ? 'k:buttonLong_beige' : 'k:buttonLong_grey', b.label, a.tap(b.on), FS.body);
        btn.container.setName(b.name);
        a.add(btn.container);
      });
    }
    if (w.open) this.newDot(1030, top + 30, `world:${w.id}`);
    return top + h;
  }

  /** Страницы поверх Летописи: список под ними не листается. */
  private read(pages: StoryPage[]): void {
    this.area.locked = true;
    showPages(this, pages, () => (this.area.locked = false));
  }

  // ---------- Находки ----------

  private findings(): void {
    const list = findingEntries(session.save, CONTENT);
    this.summary(list.filter((f) => f.found).length, list.length, '', 'Найдено');
    if (!list.length) {
      emptyState(this, GAME_W / 2, CONTENT_TOP + 400, 'Находок пока нет: летописец ждёт новых глав.');
      return;
    }
    const ROW = 200;
    let y = 0;
    let chapter = '';
    for (const f of list) {
      if (f.chapterId !== chapter) {
        chapter = f.chapterId;
        const name = CONTENT.chapters.find((c) => c.id === f.chapterId)?.name ?? chapter;
        this.area.add(text(this, LEFT - 20, y + 34, name, FS.h3, C.title, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5));
        y += 70;
      }
      this.findingRow(f, y + ROW / 2, ROW);
      y += ROW;
    }
    this.area.setContentHeight(y + 20);
  }

  private findingRow(f: FindingEntry, y: number, rowH: number): void {
    const a = this.area;
    const bg = a.add(card(this, GAME_W / 2, y, 1040, rowH - 12));
    const ix = 40 + 60;
    const icon = a.add(findingIcon(this, ix, y, 110, f.finding.kind));
    const tx = ix + 60 + 30;
    const tw = 1040 - tx;
    if (!f.found) {
      icon.setAlpha(0.35);
      bg.setAlpha(0.6);
      a.add(text(this, tx, y - 30, '???', FS.h3, C.disabled, { fontStyle: 'bold' }).setOrigin(0, 0.5));
      a.add(text(this, tx, y + 26, `Находка ждёт на этапе ${f.stageLabel}`, FS.small, C.dim).setOrigin(0, 0.5));
    } else {
      a.add(ellipsize(text(this, tx, y - 52, f.finding.title, FS.h3, C.title, { fontStyle: 'bold', ...OUTLINE, strokeThickness: 6 }).setOrigin(0, 0.5), tw));
      a.add(ellipsize(text(this, tx, y - 6, `${FINDING_KIND_NAMES[f.finding.kind]} · этап ${f.stageLabel}`, FS.small, C.muted, OUTLINE).setOrigin(0, 0.5), tw));
      a.add(ellipsize(text(this, tx, y + 42, firstSentence(f.finding.text), FS.small, C.text, { fontStyle: 'italic', ...OUTLINE }).setOrigin(0, 0.5), tw));
      this.newDot(1030, y - rowH / 2 + 30, `findings:${f.finding.id}`);
    }
    pressable(this, bg, 1040, rowH - 12, a.tap(() => {
      if (f.found) this.read([findingPage(f.finding, f.chapterId)]);
      else toast(this, `Победите на этапе ${f.stageLabel}, чтобы найти`);
    }));
  }

  // ---------- Бестиарий ----------

  private bestiary(): void {
    const list = bestiary(session.save, CONTENT, GAME);
    this.summary(list.filter((m) => m.open).length, list.length);
    const TILE_H = 390;
    list.forEach((m, i) => this.monsterTile(m, colX(i % COLS), Math.floor(i / COLS) * (TILE_H + 12) + TILE_H / 2 + 6, TILE_H));
    this.area.setContentHeight(Math.ceil(list.length / COLS) * (TILE_H + 12) + 20);
  }

  private monsterTile(m: BestiaryEntry, x: number, y: number, h: number): void {
    const a = this.area;
    const bg = a.add(card(this, x, y, TILE_W, h, m.open));
    const pic = a.add(portrait(this, x, y - 60, portraitKey(m.unit.visual.sprite), 200));
    const boss = m.unit.kind === 'boss';
    if (m.open) pic.setTint(unitTint(m.unit.visual));
    else pic.setTint(0x000000).setAlpha(0.75);
    const lore = LORE.monsters[m.unitId];
    const name = a.add(
      text(this, x, y + 78, m.open ? m.unit.name : '???', FS.small, !m.open ? C.disabled : boss ? C.danger : C.text, {
        fontStyle: 'bold',
        ...OUTLINE,
        wordWrap: { width: TILE_W - 30 },
      }),
    );
    if (name.height > 80) ellipsize(name.setWordWrapWidth(null), TILE_W - 30);
    const sub = !m.open ? `Этап ${m.stages[0]}` : lore ? lore.title : roleName(m.unit);
    a.add(ellipsize(text(this, x, y + 140, sub, FS.caption, m.open ? C.muted : C.dim, { fontStyle: m.open && lore ? 'italic' : 'normal', ...OUTLINE }), TILE_W - 30));
    if (m.open) this.newDot(x + TILE_W / 2 - 24, y - h / 2 + 24, `bestiary:${m.unitId}`);
    pressable(this, bg, TILE_W, h, a.tap(() => {
      if (m.open) monsterModal(this, m.unit, m.stages, { lock: a });
      else toast(this, `Победите на этапе ${m.stages[0]}, чтобы открыть запись`);
    }));
  }

  // ---------- Предметы ----------

  private items(): void {
    const list = itemEntries(session.save, GAME);
    this.summary(list.filter((e) => e.open).length, list.length);
    const ROW = 190;
    list.forEach((e, i) => this.itemRow(e, ROW * i + ROW / 2, ROW));
    this.area.setContentHeight(ROW * list.length + 20);
  }

  private itemRow(e: ItemEntry, y: number, rowH: number): void {
    const a = this.area;
    const def = e.item;
    const bg = a.add(card(this, GAME_W / 2, y, 1040, rowH - 12));
    const color = e.open ? RARITY_COLORS[def.rarity] : C.disabled;
    const CELL = 120;
    const cx = 40 + CELL / 2;
    const tx = cx + CELL / 2 + 24;
    const tw = 1040 - tx;
    for (const o of itemCell(this, cx, y, CELL, def.slot, Phaser.Display.Color.HexStringToColor(color).color, def.id)) {
      a.add(o);
      if (!e.open) (o as Phaser.GameObjects.Image).setAlpha(0.35);
      // Закрытый предмет: иконка RO — тёмный силуэт (вещь ещё не найдена).
      if (!e.open && o.name === 'roItemIcon') (o as Phaser.GameObjects.Image).setTint(0x101010);
    }
    const legend = LORE.items[def.id];
    if (!e.open) {
      a.add(text(this, tx, y - 30, '???', FS.h3, C.disabled, { fontStyle: 'bold' }).setOrigin(0, 0.5));
      a.add(text(this, tx, y + 26, `${SLOT_NAMES[def.slot]} · откроется в главе ${def.minChapter}`, FS.small, C.dim).setOrigin(0, 0.5));
    } else {
      a.add(ellipsize(text(this, tx, y - 52, def.name, FS.h3, color, { fontStyle: 'bold', ...OUTLINE, strokeThickness: 6 }).setOrigin(0, 0.5), tw));
      a.add(ellipsize(text(this, tx, y - 6, `${RARITY_NAMES[def.rarity]} · ${SLOT_NAMES[def.slot]} · ${itemStatsText(def.stats)}`, FS.small, C.text, OUTLINE).setOrigin(0, 0.5), tw));
      a.add(
        ellipsize(
          text(this, tx, y + 42, legend ?? (e.owned ? 'Есть у вас' : 'Легенда ещё не записана'), FS.small, legend ? C.title : C.dim, { fontStyle: legend ? 'italic' : 'normal', ...OUTLINE }).setOrigin(0, 0.5),
          tw,
        ),
      );
      this.newDot(1030, y - rowH / 2 + 30, `items:${def.id}`);
    }
    pressable(this, bg, 1040, rowH - 12, a.tap(() => {
      if (e.open) itemModal(this, def, { lock: a });
      else toast(this, `Такие вещи попадаются с главы ${def.minChapter}`);
    }));
  }

  // ---------- Герои ----------

  /**
   * Каким герой стал у игрока (BUG-155): лучший экземпляр — редкость, форма, уровень; не получен — серая карточка.
   */
  private heroSubject(templateId: string) {
    const keep = keeperIds(session.save);
    return session.save.heroes.find((x) => x.templateId === templateId && keep.has(x.id)) ?? templateId;
  }

  private heroes(): void {
    const list = heroEntries(session.save, CONTENT);
    this.summary(list.filter((h) => h.owned).length, list.length, ' · нажмите на героя', 'Получено');
    const CW = 300;
    const CH = heroCardSize(CW).h;
    list.forEach((h, i) => {
      const x = colX(i % COLS);
      const y = Math.floor(i / COLS) * (CH + 30) + CH / 2 + 16;
      drawHeroCard(this, x, y, this.heroSubject(h.templateId), { w: CW, parent: this.area.content, greyed: h.owned ? false : 'Не получен', onTap: this.area.tap(() => this.heroModal(h)) });
      // Новое: непрочитанный кусочек истории (книжка) или ещё не открытая запись героя (точка) — по центру верхней
      // кромки, между значками класса и роли (в углу отметка ложилась на значок роли).
      const my = y - CH / 2 + 30;
      if (h.owned && heroStoryNew(h.templateId)) this.area.add(storyDot(this, x, my, 20));
      else if (h.owned && LORE.heroes[h.templateId]) this.newDot(x, my, `heroes:${h.templateId}`);
    });
    this.area.setContentHeight(Math.ceil(list.length / COLS) * (CH + 30) + 30);
  }

  private heroModal(h: HeroEntry): void {
    const t = heroTemplate(GAME, h.templateId);
    const l = LORE.heroes[h.templateId];
    const blocks: LoreBlock[] = [{ text: t.bio, color: C.text }];
    if (t.hook) blocks.push({ text: `«${t.hook}»`, italic: true, color: C.title });
    if (h.owned && l) {
      // «Легенда героя» — краткая биография; «История героя» — кусочки по уровням (кнопка внизу). BUG-155.
      blocks.push({ text: 'Легенда героя', bold: true, color: C.title, size: FS.h3, gap: 10 });
      blocks.push({ text: l.story });
      if (l.quirks.length) {
        blocks.push({ text: 'Черты', bold: true, color: C.title, size: FS.h3, gap: 10 });
        blocks.push({ text: l.quirks.map((q) => `• ${q}`).join('\n'), color: C.muted });
      }
    } else if (!h.owned) blocks.push({ text: 'Полная история откроется, когда герой присоединится к отряду (Таверна, сюжет, «Контракт героя»).', color: C.dim, size: FS.small, italic: true });
    const job = LORE.jobs[t.job];
    if (job) {
      blocks.push({ text: `Гильдия: ${jobTitle(GAME, t.job, t.gender)}`, bold: true, color: C.title, size: FS.h3, gap: 10 });
      blocks.push({ text: job, color: C.muted, size: FS.small });
    }
    loreModal(this, {
      title: t.name,
      // Гильдию первой профессии называет блок «Гильдия» ниже (data/lore/jobs.json: мечники — Излуд), здесь — путь героя.
      subtitle: `${jobTitle(GAME, t.job, t.gender)} → ${t.branches.map((b) => jobTitle(GAME, b.job, t.gender)).join(' или ')}${h.owned ? '' : ' · не получен'}`,
      art: (add, x, y) => add(drawHeroCard(this, x, y, this.heroSubject(h.templateId), { w: 180, showPips: false, greyed: h.owned ? false : 'Не получен' })),
      blocks,
      lock: this.area,
      // История героя кусочками (каждые 10 уровней) — страница во весь экран; закрыли — список обновит отметки.
      ...(h.owned && hasHeroStory(h.templateId)
        ? {
            extra: {
              label: `История героя · ${heroStoryProgress(h.templateId).open} из ${heroStoryProgress(h.templateId).total}`,
              dot: heroStoryNew(h.templateId) > 0,
              onTap: () =>
                openHeroStory(this, h.templateId, { lock: this.area, onClose: () => this.scene.restart({ tab: 'heroes', scroll: this.area.offset } satisfies ChronicleData) }),
            },
          }
        : {}),
    });
  }
}

