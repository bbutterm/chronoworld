import Phaser from 'phaser';
import { plural } from '../online/logic';
import { tavernNewCount, bestiary, chapterChronicle, chapterCleared, eveningStatus, newEvenings, findingEntries, FINDING_KIND_NAMES, firstSentence, heroEntries, heroTemplate, introPages, itemEntries, jobTitle, keeperIds, worldEntries, type BestiaryEntry, type ChronicleTab, type FindingEntry, type HeroEntry, type ItemEntry, type WorldItem } from '../../core';
import { hasHeroStory, heroStoryNew, heroStoryProgress, openHeroStory } from '../heroStoryView';
import { chroniclePage, findingIcon, findingPage, introPages as introPageList, showPages, type StoryPage } from '../storyPage';
import { seenChapterScenes } from '../storyView';
import { openStoryHistory } from './ChapterDoneScene';
import { startTavernEvening } from './TavernEveningScene';
import { CONTENT, GAME, LORE } from '../content';
import { RARITY_COLORS, RARITY_NAMES, SLOT_NAMES } from '../flow';
import { drawHeroCard, heroCardSize } from '../heroCard';
import { goldDot } from '../homeBuildings';
import { itemCell } from '../itemIcons';
import { staggerIn } from '../juice';
import { GAME_W } from '../layout';
import { loreKeys, loreModal, loreUnseen, markLoreSeen, monsterModal, itemModal, roleName, seenLore, type LoreBlock } from '../loreView';
import { bottomSheet, CONTENT_TOP, contentBottom, portrait, screen, unitTint } from '../screen';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { ensureTavernTextures, TAVERN_BG, TAVERN_BG_FILE } from '../tavernArt';
import { button, chip, ellipsize, listRow, mixHex, plate, pressable, ScrollArea, segmented, SURFACE, tag, text } from '../ui';
import { C, COLOR, COLOR_N, FAMILY, FS, R, S, T } from '../theme';
import { chronicleLayout } from '../chronicleLayout';
import { minimumFontSize, minimumTouchSize, onViewChange } from '../viewport';

const TABS: { id: ChronicleTab; label: string }[] = [
  { id: 'world', label: 'Мир' },
  { id: 'findings', label: 'Находки' },
  { id: 'bestiary', label: 'Монстры' },
  { id: 'items', label: 'Вещи' },
  { id: 'heroes', label: 'Герои' },
];

/** Последняя открытая вкладка (в пределах сессии). */
let lastTab: ChronicleTab = 'world';
let lastOffsets: Partial<Record<ChronicleTab, number>> = {};

export interface ChronicleData {
  tab?: ChronicleTab;
  /** Положение списка при возврате с другого экрана, например после вечера в таверне. */
  scroll?: number;
}

/** Ширина контента (поля экрана S.l). */
const CW = GAME_W - 2 * S.l;
/** Сетка плиток: 3 колонки. */
const COLS = 3;
const GAP = S.s;
const TILE_W = (CW - (COLS - 1) * GAP) / COLS;
const colX = (i: number) => S.l + TILE_W / 2 + i * (TILE_W + GAP);
/** Строка списка (запись мира, находка, предмет). */
/** Карточка «Вечера в „Двух колоколах“» — арт зала таверны. */
const TAVERN_H = 300;

/**
 * «Летопись» (лор Ragnarok Online, data/lore): сегмент «Мир / Находки / Монстры / Предметы / Герои».
 * Мир — карточка вечеров в таверне (арт зала) и строки глав и записей мира (медальон с номером, название, место);
 * текст и страницы главы (эпизод, летопись, сцены) — в листе снизу. Находки и предметы — строки; монстры — плитки,
 * закрытые — силуэт с «?»; герои — карточки (не получен — серая). Новое — тихая золотая точка (прочитанное помнится
 * в localStorage, loreView.ts). Вход — иконка-книга на странице «Город».
 */
export class ChronicleScene extends Phaser.Scene {
  private area!: ScrollArea;
  private tab: ChronicleTab = 'world';
  private seen = new Set<string>();
  /** Записи вкладки, которые считаются «новыми», пока не прочитаны (открытые, с текстом лора). */
  private readable = new Set<string>();
  private offsets: Partial<Record<ChronicleTab, number>> = {};
  private tabs!: Phaser.GameObjects.Container;
  private summaryText?: Phaser.GameObjects.Text;

  private layout() {
    return chronicleLayout(CONTENT_TOP, contentBottom(), minimumTouchSize(), minimumFontSize());
  }

  private get rowH(): number { return this.layout().rowH; }
  private font(size: number): number { return Math.max(size, minimumFontSize()); }

  /** Общие карточки/чипы не меняем: увеличиваем только их небольшие подписи в Летописи. */
  private readableLabels(root: Phaser.GameObjects.Container): void {
    for (const o of root.list) {
      if (o instanceof Phaser.GameObjects.Text && Number.parseFloat(o.style.fontSize as string) < minimumFontSize()) o.setFontSize(minimumFontSize());
      else if (o instanceof Phaser.GameObjects.Container) this.readableLabels(o);
    }
  }

  constructor() {
    super('Chronicle');
  }

  create(data: ChronicleData = {}): void {
    this.tab = data.tab ?? lastTab;
    lastTab = this.tab;
    this.offsets = { ...lastOffsets };
    this.summaryText = undefined;
    screen(this, 'Летопись', 'Home', { to: 'Home' });
    // Что было прочитано до этого визита: «новое» отмечается точкой, затем вкладка считается прочитанной.
    this.seen = new Set(seenLore());
    const unseen = loreUnseen();
    const layout = this.layout();
    const ty = layout.tabY;
    const index = Math.max(0, TABS.findIndex((t) => t.id === this.tab));
    const seg = segmented(this, GAME_W / 2, ty, CW, TABS.map((t) => t.label), index, (i) => this.changeTab(TABS[i].id), { h: layout.tabH });
    seg.container.setName('chronicleTabs');
    this.tabs = seg.container;
    seg.container.list.filter((o) => o instanceof Phaser.GameObjects.Zone).forEach((o, i) => o.setName(`chronicleTab_${TABS[i].id}`));
    // Есть непрочитанное на другой вкладке — тихая золотая точка над подписью (красное — только «можно забрать»).
    const segW = (CW - 12) / TABS.length;
    TABS.forEach((t, i) => {
      const n = unseen[t.id] + (t.id === 'world' ? tavernNewCount(session.save, GAME) : 0);
      if (n > 0 && i !== index) seg.container.add(goldDot(this, -CW / 2 + 6 + segW * (i + 1) - 12, -layout.tabH / 2 + 14).setName(`chronicleTabDot_${t.id}`));
    });
    this.area = new ScrollArea(this, layout.listTop, layout.listBottom);
    this.area.content.setName('chronicleScroll');
    this.renderTab(data.scroll ?? this.offsets[this.tab] ?? 0);
    const area = this.area;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offsets[this.tab] = area.offset;
      lastOffsets = { ...this.offsets };
    });
    onViewChange(this, () => {
      const next = this.layout();
      this.tabs.setY(next.tabY);
      this.summaryText?.setY(next.summaryY).setFontSize(this.font(T.caption));
      this.area.setBounds(next.listTop, next.listBottom);
      this.readableLabels(this.area.content);
    });
  }

  /** Переключение сохраняет независимые позиции вкладок и не перезапускает сцену/SDK Back. */
  private changeTab(tab: ChronicleTab): void {
    if (tab === this.tab || this.area.locked) return;
    this.offsets[this.tab] = this.area.offset;
    this.tab = lastTab = tab;
    this.tabs.getByName(`chronicleTabDot_${tab}`)?.destroy();
    this.renderTab(this.offsets[tab] ?? 0);
  }

  private renderTab(offset: number): void {
    this.area.clear();
    this.summaryText?.destroy();
    this.seen = new Set(seenLore());
    const keys = loreKeys()[this.tab];
    this.readable = new Set(keys);
    if (this.tab === 'world') this.world();
    else if (this.tab === 'findings') this.findings();
    else if (this.tab === 'bestiary') this.bestiary();
    else if (this.tab === 'items') this.items();
    else this.heroes();
    this.readableLabels(this.area.content);
    this.area.offset = offset;
    markLoreSeen(keys);
  }

  /** Строка над списком: «Открыто 3 из 12» (без инструкций). */
  private summary(open: number, total: number, label = 'Открыто'): void {
    this.summaryText = text(this, S.l + S.xxs, this.layout().summaryY, `${label} ${open} из ${total}`, this.font(T.caption), COLOR.textSecondary, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('chronicleSummary');
  }

  /** Золотая точка «новое» в правом верхнем углу записи. */
  private newDot(x: number, y: number, key: string): void {
    if (this.seen.has(key) || !this.readable.has(key)) return;
    this.area.add(goldDot(this, x, y).setDepth(0));
  }

  /** Пустая вкладка: значок и одна строка. */
  private empty(msg: string): void {
    this.area.add(plate(this, GAME_W / 2, 150, CW, 300, { ...SURFACE.surface, r: R.l }));
    this.area.add(this.add.image(GAME_W / 2, 110, 'skin_ico_scroll').setDisplaySize(80, 80).setTint(COLOR_N.textTertiary));
    this.area.add(text(this, GAME_W / 2, 210, msg, T.body, COLOR.textSecondary));
    this.area.setContentHeight(320);
  }

  // ---------- Мир ----------

  private world(): void {
    const list = worldEntries(session.save, CONTENT, LORE);
    this.summary(list.filter((w) => w.open).length, list.length);
    if (!list.length) return this.empty('Летописец ещё не начал свои записи');
    let y = this.tavernCard(0);
    const groups: Phaser.GameObjects.GameObject[][] = [];
    // Закрытые записи — одна следующая строкой, остальные — одной строкой «Ещё N впереди» (не стена из «???»).
    const shown = list.filter((w, i) => w.open || list.findIndex((x) => !x.open) === i);
    for (const w of shown) {
      const row = this.worldRow(w, y + this.rowH / 2);
      groups.push([row]);
      y += this.rowH + S.xs;
    }
    const rest = list.length - shown.length;
    if (rest > 0) {
      this.area.add(text(this, GAME_W / 2, y + 40, `Ещё ${rest} ${plural(rest, 'запись', 'записи', 'записей')} впереди`, this.font(T.caption), COLOR.textTertiary, { fontStyle: 'bold' }).setName('chronicleMore'));
      y += 80;
    }
    this.area.setContentHeight(y + S.s);
    staggerIn(this, 'chronicle', groups);
  }

  /** Вечера в «Двух колоколах» (docs/design/tavern-evenings.md): арт зала, название, «открыто N из M», новое — тег. */
  private tavernCard(top: number): number {
    const t = GAME.story.tavern;
    if (!t) return top;
    const a = this.area;
    const fresh = newEvenings(session.save, GAME).length;
    const open = t.evenings.filter((e) => eveningStatus(session.save, e, GAME) !== 'locked').length;
    const cy = top + TAVERN_H / 2;
    const go = a.tap(() => startTavernEvening(this, { mode: 'hub', back: { to: 'Chronicle', data: { tab: 'world', scroll: a.offset } satisfies ChronicleData } }));
    const frame = a.add(plate(this, GAME_W / 2, cy, CW, TAVERN_H, { ...SURFACE.raised, r: R.l }));
    // Арт: середина зала (очаг и столы) — обрезка нарисованного фона таверны (или файла художника).
    ensureTavernTextures(this);
    const key = this.textures.exists(TAVERN_BG_FILE) ? TAVERN_BG_FILE : TAVERN_BG;
    const art = this.add.image(0, 0, key);
    const iw = CW - 12;
    const ih = TAVERN_H - 12;
    const k = iw / art.width;
    const cropH = Math.min(art.height, ih / k);
    const cropY = Math.max(0, Math.min(art.height - cropH, art.height * 0.36 - cropH / 2));
    art.setCrop(0, cropY, art.width, cropH).setScale(k);
    art.setPosition(GAME_W / 2, cy + (art.height / 2 - cropY - cropH / 2) * k);
    a.add(art);
    // Тень слева под текстом — подписи читаются на любом арте.
    const shadeG = this.add.graphics();
    shadeG.fillGradientStyle(0x0d0b08, 0x0d0b08, 0x0d0b08, 0x0d0b08, 0.92, 0.1, 0.92, 0.1).fillRect(S.l + 6, cy - ih / 2, iw * 0.75, ih);
    a.add(shadeG);
    const left = S.l + S.l;
    a.add(text(this, left, cy - 60, 'Вечера в таверне', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5));
    a.add(text(this, left, cy + 4, '«Два колокола»: разговоры отряда', T.body, COLOR.textSecondary).setOrigin(0, 0.5));
    a.add(chip(this, left, cy + 80, 'scroll', `${open} / ${t.evenings.length}`, 'neutral', { size: 's', align: 'left' }));
    if (fresh) a.add(tag(this, GAME_W - S.l - S.m, cy - TAVERN_H / 2 + S.l, fresh > 1 ? `Новые: ${fresh}` : 'Новый вечер', 'accent', { solid: true, align: 'right' }).setName('chronicleTavernNew'));
    frame.setName('chronicleTavern');
    pressable(this, frame, CW, TAVERN_H, go);
    return top + TAVERN_H + S.s;
  }

  private worldRow(w: WorldItem, y: number): Phaser.GameObjects.Container {
    const a = this.area;
    const chapter = w.kind === 'chapter' ? CONTENT.chapters.find((c) => c.id === w.id) : undefined;
    // Номер главы на маршруте (order): у Нифльхейма «Глава 10», даже пока главы 9 нет.
    const chNo = chapter?.order ?? 0;
    let title: string;
    let subtitle: string;
    if (!w.open) {
      title = '???';
      const previous = chapter ? CONTENT.chapters[CONTENT.chapters.indexOf(chapter) - 1] : undefined;
      subtitle = w.kind === 'chapter' ? `Глава ${chNo}${previous ? ` · после главы ${previous.order}` : ''}` : `После этапа ${w.unlockLabel ?? '?'}`;
    } else if (w.kind === 'chapter') {
      title = w.lore?.title ?? chapter?.episode?.title ?? w.chapterName.replace(/^Глава\s*\d+\.\s*/, '');
      subtitle = w.lore?.location ?? chapter?.episode?.subtitle ?? `Глава ${chNo}`;
    } else {
      title = w.entry.title;
      subtitle = firstSentence(w.entry.text);
    }
    const row = listRow(this, GAME_W / 2, y, CW, {
      icon: w.kind === 'chapter' ? (s, x, iy, size) => medallion(s, x, iy, size, w.open ? String(chNo) : '?', w.open) : w.open ? 'scroll' : (s, x, iy, size) => medallion(s, x, iy, size, '?', false),
      title,
      subtitle,
      ...(w.open ? { trailing: '›', trailingTone: 'accent' as const, onTap: a.tap(() => this.worldSheet(w)) } : {}),
      dim: !w.open,
      h: this.rowH,
    });
    row.setName(`chronicleWorld_${w.id}`);
    a.add(row);
    if (w.open) this.newDot(GAME_W - S.l - 14, y - this.rowH / 2 + 14, `world:${w.id}`);
    return row;
  }

  /** Запись мира целиком — лист снизу: место, текст, эпиграф; у главы — страницы (эпизод, летопись, сцены). */
  private worldSheet(w: WorldItem): void {
    const a = this.area;
    const chapter = w.kind === 'chapter' ? CONTENT.chapters.find((c) => c.id === w.id) : undefined;
    const chNo = chapter?.order ?? 0;
    const title = w.kind === 'chapter' ? (w.lore?.title ?? chapter?.episode?.title ?? w.chapterName) : w.entry.title;
    type PageBtn = { label: string; name: string; on: () => void };
    const btns: PageBtn[] = [];
    if (chapter) {
      const intro = introPages(chapter.id, CONTENT);
      if (intro) btns.push({ label: intro.episode ? `Эпизод ${chNo}` : 'Легенда', name: `chronicleEpisode_${chapter.id}`, on: () => this.read(introPageList(intro)) });
      const chron = chapterChronicle(chapter.id, CONTENT);
      if (chron && chapterCleared(session.save, chapter.id, CONTENT)) {
        btns.push({
          label: 'Летопись',
          name: `chronicleChapter_${chapter.id}`,
          on: () => {
            const found = findingEntries(session.save, CONTENT).filter((f) => f.chapterId === chapter.id);
            this.read([chroniclePage(chapter.id, chNo, chron, { got: found.filter((f) => f.found).length, total: found.length })]);
          },
        });
      }
      const scenes = seenChapterScenes(session.save, chapter.id, GAME).length;
      if (scenes) {
        btns.push({
          label: `Сцены · ${scenes}`,
          name: `chronicleScenes_${chapter.id}`,
          on: () => {
            // Helper держит именно этот список заблокированным и во время повторного диалога.
            openStoryHistory(this, chapter.id, { lock: a });
          },
        });
      }
    }
    a.locked = true;
    let afterClose: (() => void) | undefined;
    bottomSheet(
      this,
      title,
      (box, width, close) => {
        let y = 0;
        const add = (s: string, size: number, color: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}, gap: number = S.s) => {
          const t = text(this, 0, y, s, this.font(size), color, { align: 'left', wordWrap: { width, useAdvancedWrap: true }, ...style }).setOrigin(0, 0);
          box.add(t);
          y += t.height + gap;
        };
        const where = w.kind === 'chapter' ? [`Глава ${chNo}`, w.lore?.location ?? chapter?.episode?.subtitle].filter(Boolean).join(' · ') : 'Мир Мидгарда';
        add(where, T.caption, COLOR.textSecondary, { fontStyle: 'bold' }, S.xs);
        if (w.kind === 'world') add(w.entry.text, T.body, COLOR.textPrimary, {}, S.m);
        else if (w.lore) add(w.lore.text, T.body, COLOR.textPrimary, {}, S.m);
        else if (chapter?.episode?.quote) add(`«${chapter.episode.quote}»`, T.body, COLOR.title, { fontStyle: 'italic' }, S.m);
        if (btns.length) {
          const bw = (width - S.xs * (btns.length - 1)) / btns.length;
          const bh = this.layout().pageButtonH;
          btns.forEach((b, i) => {
            const btn = button(this, bw / 2 + i * (bw + S.xs), y + bh / 2, bw, bh, '', b.label, () => {
              afterClose = b.on;
              close();
            }, T.body, { variant: 'secondary' });
            btn.container.setName(b.name);
            box.add(btn.container);
          });
          y += bh;
        }
        return y;
      },
      { onClose: () => {
        a.locked = false;
        // Новый рассказ открывается после закрытия листа: его lock не сбросит запоздалый callback.
        afterClose?.();
      } },
    );
  }

  /** Страницы поверх Летописи: список под ними не листается. */
  private read(pages: StoryPage[]): void {
    showPages(this, pages, () => {}, { lock: this.area });
  }

  // ---------- Находки ----------

  private findings(): void {
    const list = findingEntries(session.save, CONTENT);
    this.summary(list.filter((f) => f.found).length, list.length, 'Найдено');
    if (!list.length) return this.empty('Находок пока нет');
    let y = 0;
    let chapter = '';
    for (const f of list) {
      if (f.chapterId !== chapter) {
        chapter = f.chapterId;
        const name = CONTENT.chapters.find((c) => c.id === f.chapterId)?.name ?? chapter;
        if (y > 0) y += S.s;
        this.area.add(ellipsize(text(this, S.l + S.xxs, y + 30, name, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5), CW));
        y += 60 + S.xs;
      }
      this.findingRow(f, y + this.rowH / 2);
      y += this.rowH + S.xs;
    }
    this.area.setContentHeight(y + S.s);
  }

  private findingRow(f: FindingEntry, y: number): void {
    const a = this.area;
    const row = listRow(this, GAME_W / 2, y, CW, {
      icon: (s, x, iy, size) => {
        const ic = findingIcon(s, x, iy, size, f.finding.kind);
        return f.found ? ic : ic.setAlpha(0.3);
      },
      title: f.found ? f.finding.title : '???',
      subtitle: f.found ? `${FINDING_KIND_NAMES[f.finding.kind]} · этап ${f.stageLabel}` : `Этап ${f.stageLabel}`,
      ...(f.found ? { trailing: '›', trailingTone: 'accent' as const, onTap: a.tap(() => this.read([findingPage(f.finding, f.chapterId)])) } : {}),
      dim: !f.found,
      h: this.rowH,
    });
    row.setName(`chronicleFinding_${f.finding.id}`);
    a.add(row);
    if (f.found) this.newDot(GAME_W - S.l - 14, y - this.rowH / 2 + 14, `findings:${f.finding.id}`);
  }

  // ---------- Бестиарий ----------

  private bestiary(): void {
    const list = bestiary(session.save, CONTENT, GAME);
    this.summary(list.filter((m) => m.open).length, list.length);
    const TILE_H = 360;
    list.forEach((m, i) => this.monsterTile(m, colX(i % COLS), Math.floor(i / COLS) * (TILE_H + GAP) + TILE_H / 2, TILE_H));
    this.area.setContentHeight(Math.ceil(list.length / COLS) * (TILE_H + GAP) + S.s);
  }

  private monsterTile(m: BestiaryEntry, x: number, y: number, h: number): void {
    const a = this.area;
    const boss = m.unit.kind === 'boss';
    const bg = a.add(
      plate(this, x, y, TILE_W, h, m.open ? { ...SURFACE.raised, ...(boss ? { border: mixHex(COLOR.border, COLOR.negative, 0.55) } : {}), r: R.l } : { ...SURFACE.sunken, r: R.l }),
    );
    bg.setName(`chronicleMonster_${m.unitId}`);
    const picY = y - 50;
    if (m.open) a.add(this.add.ellipse(x, picY + 92, 150, 26, 0x000000, 0.35));
    const pic = a.add(portrait(this, x, picY, portraitKey(m.unit.visual.sprite), 190));
    if (m.open) pic.setTint(unitTint(m.unit.visual));
    else {
      // Закрыт — тёмный силуэт и «?» поверх.
      pic.setTint(0x000000).setAlpha(0.55);
      a.add(this.add.image(x, picY, questionMark(this)));
    }
    const name = a.add(text(this, x, y + 104, m.open ? m.unit.name : '???', this.font(T.caption), m.open ? COLOR.textPrimary : COLOR.textTertiary, { fontStyle: 'bold' }));
    ellipsize(name, TILE_W - S.m);
    const lore = LORE.monsters[m.unitId];
    const first = m.stages[0];
    const sub = !m.open ? (/^\d+-\d+$/.test(first) ? `Победа на ${first}` : first === 'Охота' ? 'Первый бой на охоте' : first) : lore ? lore.title : roleName(m.unit);
    a.add(ellipsize(text(this, x, y + 146, sub, this.font(T.caption), m.open ? COLOR.textSecondary : COLOR.textTertiary), TILE_W - S.m));
    if (boss && m.open) a.add(tag(this, x - TILE_W / 2 + S.xs, y - h / 2 + S.l, 'БОСС', 'negative', { solid: true, align: 'left' }));
    if (m.open) {
      this.newDot(x + TILE_W / 2 - 18, y - h / 2 + 18, `bestiary:${m.unitId}`);
      pressable(this, bg, TILE_W, h, a.tap(() => monsterModal(this, m.unit, m.stages, { lock: a })));
    }
  }

  // ---------- Предметы ----------

  private items(): void {
    const list = itemEntries(session.save, GAME);
    this.summary(list.filter((e) => e.open).length, list.length);
    list.forEach((e, i) => this.itemRow(e, i * (this.rowH + S.xs) + this.rowH / 2));
    this.area.setContentHeight(list.length * (this.rowH + S.xs) + S.s);
  }

  private itemRow(e: ItemEntry, y: number): void {
    const a = this.area;
    const def = e.item;
    const color = e.open ? RARITY_COLORS[def.rarity] : COLOR.textTertiary;
    const row = listRow(this, GAME_W / 2, y, CW, {
      icon: (s, x, iy, size) => {
        const box = s.add.container(x, iy);
        for (const o of itemCell(s, 0, 0, size + 8, def.slot, Phaser.Display.Color.HexStringToColor(color).color, def.id)) {
          box.add(o);
          // Закрытый предмет: тёмный силуэт (вещь ещё не найдена).
          if (!e.open && o.name === 'roItemIcon') (o as Phaser.GameObjects.Image).setTint(0x101010).setAlpha(0.6);
          else if (!e.open) (o as Phaser.GameObjects.Image).setAlpha(0.4);
        }
        return box;
      },
      title: e.open ? def.name : '???',
      subtitle: e.open ? `${RARITY_NAMES[def.rarity]} · ${SLOT_NAMES[def.slot]}` : `${SLOT_NAMES[def.slot]} · глава ${def.minChapter}`,
      ...(e.open ? { trailing: '›', trailingTone: 'accent' as const, onTap: a.tap(() => itemModal(this, def, { lock: a })) } : {}),
      dim: !e.open,
      h: this.rowH,
    });
    row.setName(`chronicleItem_${def.id}`);
    a.add(row);
    if (e.open) this.newDot(GAME_W - S.l - 14, y - this.rowH / 2 + 14, `items:${def.id}`);
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
    this.summary(list.filter((h) => h.owned).length, list.length, 'Получено');
    const CWD = 300;
    const CH = heroCardSize(CWD).h;
    list.forEach((h, i) => {
      const x = colX(i % COLS);
      const y = Math.floor(i / COLS) * (CH + 30) + CH / 2 + 16;
      // Новое: непрочитанный кусочек истории — значок-свиток карточки (heroCard.ts storyNew), запись героя — точка.
      const story = h.owned && heroStoryNew(h.templateId) > 0;
      const card = drawHeroCard(this, x, y, this.heroSubject(h.templateId), {
        w: CWD,
        parent: this.area.content,
        greyed: h.owned ? false : 'Не получен',
        storyNew: story,
        onTap: this.area.tap(() => this.heroModal(h)),
      });
      card.setName(`chronicleHero_${h.templateId}`);
      if (h.owned && !story && LORE.heroes[h.templateId]) this.newDot(x + CWD / 2 - 18, y - CH / 2 + 18, `heroes:${h.templateId}`);
    });
    this.area.setContentHeight(Math.ceil(list.length / COLS) * (CH + 30) + 30);
  }

  private heroModal(h: HeroEntry): void {
    const area = this.area;
    const t = heroTemplate(GAME, h.templateId);
    const l = LORE.heroes[h.templateId];
    const blocks: LoreBlock[] = [{ text: t.bio, color: C.text }];
    if (t.hook) blocks.push({ text: `«${t.hook}»`, italic: true, color: C.title });
    if (h.owned && l) {
      // «Легенда героя» — краткая биография; «История героя» — кусочки по уровням (кнопка внизу). BUG-155.
      blocks.push({ text: 'Легенда героя', bold: true, color: C.title, size: T.heading, gap: 10 });
      blocks.push({ text: l.story });
      if (l.quirks.length) {
        blocks.push({ text: 'Черты', bold: true, color: C.title, size: T.heading, gap: 10 });
        blocks.push({ text: l.quirks.map((q) => `• ${q}`).join('\n'), color: C.muted });
      }
    } else if (!h.owned) blocks.push({ text: 'Полная история — когда герой присоединится к отряду', color: C.dim, size: FS.small, italic: true });
    const job = LORE.jobs[t.job];
    if (job) {
      blocks.push({ text: `Гильдия: ${jobTitle(GAME, t.job, t.gender)}`, bold: true, color: C.title, size: T.heading, gap: 10 });
      blocks.push({ text: job, color: C.muted, size: T.caption });
    }
    loreModal(this, {
      title: t.name,
      // Гильдию первой профессии называет блок «Гильдия» ниже (data/lore/jobs.json: мечники — Излуд), здесь — путь героя.
      subtitle: `${jobTitle(GAME, t.job, t.gender)} → ${t.branches.map((b) => jobTitle(GAME, b.job, t.gender)).join(' или ')}${h.owned ? '' : ' · не получен'}`,
      art: (add, x, y) => {
        const card = drawHeroCard(this, x, y, this.heroSubject(h.templateId), { w: 180, showPips: false, greyed: h.owned ? false : 'Не получен' });
        this.readableLabels(card);
        add(card);
      },
      blocks,
      lock: area,
      // История героя кусочками (каждые 10 уровней) — страница во весь экран; закрыли — список обновит отметки.
      ...(h.owned && hasHeroStory(h.templateId)
        ? {
            extra: {
              label: `История героя · ${heroStoryProgress(h.templateId).open}/${heroStoryProgress(h.templateId).total}`,
              dot: heroStoryNew(h.templateId) > 0,
              onTap: () => openHeroStory(this, h.templateId, { lock: area, onClose: () => {
                if (this.sys.isActive() && this.area === area && this.tab === 'heroes') this.renderTab(area.offset);
              } }),
            },
          }
        : {}),
    });
  }
}

/** Медальон записи: номер главы заголовочной гарнитурой в кольце (закрыта — «?» приглушённо). */
function medallion(scene: Phaser.Scene, x: number, y: number, size: number, label: string, open: boolean): Phaser.GameObjects.Container {
  const r = size * 0.6;
  const ring = scene.add.circle(0, 0, r, open ? COLOR_N.surfaceRaised : COLOR_N.surfaceSunken).setStrokeStyle(4, open ? parseInt(mixHex(COLOR.border, COLOR.accent, 0.6).slice(1), 16) : COLOR_N.border);
  const t = text(scene, 0, 2, label, label.length > 1 ? T.heading : T.title, open ? COLOR.title : COLOR.textTertiary, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
  return scene.add.container(x, y, [ring, t]);
}

/**
 * «?» закрытой плитки бестиария — одна canvas-текстура на все плитки (а не Text на каждую: их бывает под сотню).
 * Цвет и гарнитура — как у текста T.display + 20.
 */
function questionMark(scene: Phaser.Scene): string {
  const key = 'chronicle_question';
  if (scene.textures.exists(key)) return key;
  const size = T.display + 20;
  const ct = scene.textures.createCanvas(key, size, Math.round(size * 1.3));
  if (!ct) return '__WHITE';
  const ctx = ct.getContext();
  ctx.font = `bold ${size}px ${FAMILY.heading}`;
  ctx.fillStyle = COLOR.textTertiary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', size / 2, (size * 1.3) / 2);
  ct.refresh();
  return key;
}
