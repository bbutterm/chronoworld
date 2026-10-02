import Phaser from 'phaser';
import { compactNumber } from '../frame';
import { GAME_W } from '../layout';
import { contentBottom, CONTENT_TOP, dot, screen } from '../screen';
import { button, BTN, chip, ellipsize, listRow, mixHex, plate, ScrollArea, segmented, SURFACE, text, toast, type ButtonView } from '../ui';
import { COLOR, COLOR_N, FAMILY, R, S, T } from '../theme';
import { haptic } from '../haptics';
import { staggerIn } from '../juice';
import { api, onlineAvailable, openTgLink } from '../online/api';
import { appLink, bellIcon } from '../online/entry';
import {
  BELL_GEMS,
  BELLS_PER_DAY,
  BOARD_KINDS,
  boardSubLine,
  boardValueText,
  BOT_LINK,
  REF_INVITER_GEMS,
  REF_WELCOME_GEMS,
  shareUrl,
  whereText,
  type BoardKind,
  type BoardMine,
  type BoardResp,
  type BoardRow,
  type BoardScope,
  type FriendInfo,
} from '../online/logic';
import { claimBells, onlineState, setGiftsWaiting } from '../online/online';

export type FriendsTab = 'friends' | 'records';

export interface FriendsData {
  tab?: FriendsTab;
  board?: BoardKind;
  scope?: BoardScope;
}

/** Ответы сервера живут минуту: переключение вкладок не дёргает сеть. */
const CACHE_MS = 60_000;
const cache = {
  friends: null as { at: number; list: FriendInfo[] } | null,
  boards: new Map<string, { at: number; data: BoardResp }>(),
};
const fresh = (at: number) => Date.now() - at < CACHE_MS;

let last: Required<FriendsData> = { tab: 'friends', board: 'power', scope: 'all' };

/** Ширина контента: поля экрана S.l. */
const CW = GAME_W - 2 * S.l;
const TABS: { id: FriendsTab; label: string }[] = [
  { id: 'friends', label: 'Друзья' },
  { id: 'records', label: 'Рекорды' },
];
/** Короткие подписи досок (полное название — в BOARD_KINDS) и значки скина рядом с ними. */
const BOARD_ICON: Record<BoardKind, string> = { power: 'swords', progress: 'map', tower: 'tower', mvp: 'trophy' };
const BOARD_SHORT: Record<BoardKind, string> = { power: 'Сила', progress: 'Прогресс', tower: 'Башня', mvp: 'MVP' };
const SCOPES: { id: BoardScope; label: string }[] = [
  { id: 'all', label: 'Все игроки' },
  { id: 'friends', label: 'Друзья' },
];
/** Строка друга и доски. */
const FRIEND_H = 136;
const ROW_H = 120;
/** Цвета медалей мест 1–3: золото, серебро, бронза. */
const MEDAL = ['#f0c040', '#c9d2dc', '#cd8a52'] as const;
/** Цвет кружка-аватара по имени (тёплая гамма, без кислотных). */
const AVATAR = ['#8a5a3c', '#5d6f8a', '#6d8a5a', '#8a5a78', '#7a6a3c', '#4f7f7a'] as const;

/** Неделя доски «2026-W40» → «Неделя 40». */
export const weekLabel = (week: string): string => {
  const m = /W(\d+)$/.exec(week);
  return m ? `Неделя ${Number(m[1])}` : '';
};

/** «Гл. 4 · этап 12» (коротко, для строки друга); глава 0 — «Только начинает». */
export const friendWhere = (chapter: number, stage: number): string => (chapter > 0 ? `Гл. ${chapter} · этап ${Math.max(1, stage)}` : whereText(chapter, stage));

/**
 * «Друзья и рекорды» (онлайн фаза 1, docs/design/online.md): сегмент «Друзья / Рекорды».
 * Друзья — колокольчики сверху (есть что забрать), строки друзей (аватар-буква, имя, «Гл. N · этап M», чип силы и
 * кнопка-колокольчик), внизу — «Позвать друга» и бот. Никого нет — пустая карточка с главной кнопкой «Позвать друга».
 * Рекорды — сегмент досок со значками, «Все / Друзья», строки с медалями мест 1–3, своя строка подсвечена, внизу — «Ваше место».
 * Вне Telegram — спокойная карточка «Друзья живут в Telegram» с кнопкой бота. Нет сети — «Нет связи» и «Повторить».
 */
export class FriendsScene extends Phaser.Scene {
  private area!: ScrollArea;
  private opts: Required<FriendsData> = last;
  /** Номер показа: ответ, пришедший после перезапуска экрана, не рисуется. */
  private gen = 0;
  private status: Phaser.GameObjects.GameObject[] = [];
  /** Верх содержимого вкладки (под сегментом). */
  private top = 0;

  constructor() {
    super('Friends');
  }

  create(data: FriendsData = {}): void {
    this.opts = { ...last, ...data };
    last = this.opts;
    this.gen++;
    this.status = [];
    screen(this, 'Друзья и рекорды', 'Home', { to: 'Home' });
    if (!onlineAvailable()) {
      this.offline();
      return;
    }
    const ty = CONTENT_TOP + S.s + 44;
    const index = Math.max(0, TABS.findIndex((t) => t.id === this.opts.tab));
    const seg = segmented(this, GAME_W / 2, ty, CW, TABS.map((t) => t.label), index, (i) => this.scene.restart({ tab: TABS[i].id } satisfies FriendsData));
    seg.container.setName('friendsTabs');
    // Колокольчики ждут, а открыты «Рекорды» — точка на вкладке «Друзья» (число — на самой карточке колокольчиков).
    if (this.opts.tab !== 'friends' && onlineState.giftsWaiting > 0) dot(this, GAME_W / 2 - CW / 2 + CW / 4 + 90, ty - 30).setName('friendsTabDot');
    this.top = ty + 44 + S.s;
    if (this.opts.tab === 'friends') this.friendsTab();
    else this.recordsTab();
  }

  // ---------- общее ----------

  private alive(gen: number): boolean {
    return gen === this.gen && this.sys.isActive();
  }

  private clearStatus(): void {
    for (const o of this.status) o.destroy();
    this.status = [];
  }

  /** «Загружаем…» — тихая строка; «Нет связи» — карточка с «Повторить» (вторичная кнопка). */
  private showStatus(y: number, msg: string, retry?: () => void): void {
    this.clearStatus();
    if (!retry) {
      this.status.push(text(this, GAME_W / 2, y, msg, T.body, COLOR.textTertiary).setName('friendsLoading'));
      return;
    }
    const h = 300;
    this.status.push(plate(this, GAME_W / 2, y, CW, h, { ...SURFACE.surface, r: R.l }));
    this.status.push(text(this, GAME_W / 2, y - 70, msg, T.body, COLOR.textSecondary, { wordWrap: { width: CW - 2 * S.l } }));
    const b = button(this, GAME_W / 2, y + 70, 360, BTN.m, '', 'Повторить', retry, T.body, { variant: 'secondary' });
    b.container.setName('friendsRetry');
    this.status.push(b.container);
  }

  /** Вне Telegram: иллюстрация (колокол в тёплом свете), одна строка и кнопка бота. */
  private offline(): void {
    const cy = (CONTENT_TOP + contentBottom()) / 2 - 40;
    const h = 840;
    const top = cy - h / 2;
    plate(this, GAME_W / 2, cy, CW, h, { ...SURFACE.raised, r: R.l }).setName('friendsOffline');
    const artY = top + 230;
    this.add.image(GAME_W / 2, artY, 'skin_glow').setDisplaySize(620, 420).setTint(COLOR_N.accent).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
    this.add.circle(GAME_W / 2, artY, 130, COLOR_N.surfaceSunken, 0.9).setStrokeStyle(4, mixHexN(COLOR.border, COLOR.accent, 0.5));
    bellIcon(this, GAME_W / 2, artY - 4, 150, COLOR_N.accent);
    // Два «звона» от колокола — дуги по бокам.
    const g = this.add.graphics().lineStyle(6, COLOR_N.accent, 0.55);
    for (const d of [-1, 1]) for (const r of [170, 205]) g.beginPath().arc(GAME_W / 2, artY, r, d < 0 ? Math.PI * 0.82 : -Math.PI * 0.18, d < 0 ? Math.PI * 1.18 : Math.PI * 0.18).strokePath();
    text(this, GAME_W / 2, top + 510, 'Друзья живут в Telegram', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
    text(this, GAME_W / 2, top + 610, 'Колокольчики, рекорды и приглашения —\nв игре внутри Telegram', T.body, COLOR.textSecondary, { align: 'center', lineSpacing: 10 });
    const b = button(this, GAME_W / 2, top + h - 110, 560, BTN.l, '', 'Открыть в Telegram', () => openTgLink(BOT_LINK), T.heading, { variant: 'secondary' });
    b.container.setName('openBot');
  }

  // ---------- Друзья ----------

  private friendsTab(): void {
    let y = this.top;
    const n = onlineState.giftsWaiting;
    if (n > 0) {
      // Колокольчики ждут: «×N», сколько гемов, «Забрать» — главная кнопка экрана.
      const gems = BELL_GEMS * Math.min(n, BELLS_PER_DAY);
      const trail = this.add.container(0, 0);
      const c = chip(this, 0, 0, 'gems', `+${gems}`, 'gem', { size: 's' });
      const b = button(this, 0, 0, 240, BTN.m, 'ui_btn_primary', 'Забрать', () => void this.claim(b), T.body);
      b.container.setName('bellsClaim');
      const tw = c.width + S.xs + 240;
      c.setX(-tw / 2 + c.width / 2);
      b.container.setX(tw / 2 - 120);
      trail.add([c, b.container]).setSize(tw, BTN.m);
      const row = listRow(this, GAME_W / 2, y + FRIEND_H / 2, CW, {
        icon: (s, x, iy, size) => bellIcon(s, x, iy, size, COLOR_N.accent),
        title: `Колокольчики ×${n}`,
        subtitle: 'от друзей',
        trailing: trail,
        raised: true,
        h: FRIEND_H,
      });
      row.setName('bellsRow');
      y += FRIEND_H + S.s;
    }
    const link = appLink();
    this.area = new ScrollArea(this, y, contentBottom() + 10);
    const gen = this.gen;
    const draw = (list: FriendInfo[]) => {
      if (!this.alive(gen)) return;
      this.clearStatus();
      this.area.clear();
      this.drawFriends(list, link);
    };
    const statusY = y + 200;
    const load = async () => {
      this.showStatus(statusY, 'Загружаем друзей…');
      const list = await api.friends();
      if (!this.alive(gen)) return;
      if (!list) {
        this.showStatus(statusY, 'Нет связи с сервером.\nИгра работает как обычно.', () => void load());
        return;
      }
      cache.friends = { at: Date.now(), list };
      const waiting = list.filter((f) => f.giftWaiting).length;
      if (waiting !== onlineState.giftsWaiting) {
        setGiftsWaiting(waiting);
        this.scene.restart();
        return;
      }
      draw(list);
    };
    if (cache.friends && fresh(cache.friends.at)) draw(cache.friends.list);
    else void load();
  }

  private invite(link: string): void {
    const id = onlineState.profile?.id;
    if (!id) {
      toast(this, 'Нет связи с сервером — попробуйте чуть позже', COLOR.negative);
      return;
    }
    openTgLink(shareUrl(link, id));
  }

  private drawFriends(list: FriendInfo[], link: string | null): void {
    const a = this.area;
    const x = GAME_W / 2;
    let y = 0;
    const groups: Phaser.GameObjects.GameObject[][] = [];
    if (!list.length) {
      // Пусто: карточка-приглашение — единственное место, где «Позвать друга» главная.
      const h = link ? 560 : 420;
      a.add(plate(this, x, h / 2, CW, h, { ...SURFACE.raised, r: R.l }).setName('friendsEmpty'));
      const artY = 140;
      a.add(this.add.image(x, artY, 'skin_glow').setDisplaySize(460, 300).setTint(COLOR_N.accent).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD));
      a.add(this.add.circle(x - 70, artY, 62, COLOR_N.surfaceSunken).setStrokeStyle(4, COLOR_N.border));
      a.add(this.add.circle(x + 70, artY, 62, COLOR_N.surfaceSunken).setStrokeStyle(4, COLOR_N.border));
      a.add(text(this, x - 70, artY, '?', T.display, COLOR.textTertiary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }));
      a.add(bellIcon(this, x + 70, artY - 2, 70, COLOR_N.accent));
      a.add(text(this, x, 270, 'Пока никого', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }));
      if (link) {
        a.add(chipRow(this, x, 350, [chip(this, 0, 0, 'gems', `+${REF_INVITER_GEMS} вам`, 'gem', { size: 's' }), chip(this, 0, 0, 'gems', `+${REF_WELCOME_GEMS} другу`, 'gem', { size: 's' })]));
        const b = button(this, x, h - 100, 560, BTN.l, 'ui_btn_primary', 'Позвать друга', a.tap(() => this.invite(link)), T.heading);
        b.container.setName('inviteFriend');
        a.add(b.container);
      } else a.add(text(this, x, 350, 'Друг по вашей ссылке появится здесь', T.body, COLOR.textSecondary));
      y = h + S.s;
    } else {
      const sorted = [...list].sort((p, q) => Number(q.giftWaiting) - Number(p.giftWaiting) || q.chapter - p.chapter || q.stage - p.stage || q.power - p.power);
      for (const f of sorted) {
        const row = this.friendRow(f, y + FRIEND_H / 2);
        a.add(row);
        groups.push([row]);
        y += FRIEND_H + S.xs;
      }
      y += S.s - S.xs;
      if (link) {
        const inv = listRow(this, x, y + FRIEND_H / 2, CW, {
          icon: 'gift',
          title: 'Позвать друга',
          subtitle: `+${REF_INVITER_GEMS} гемов вам, +${REF_WELCOME_GEMS} другу`,
          trailing: '›',
          trailingTone: 'accent',
          h: FRIEND_H,
          onTap: a.tap(() => this.invite(link)),
        }).setName('inviteFriend');
        a.add(inv);
        groups.push([inv]);
        y += FRIEND_H + S.xs;
      }
    }
    // Бот: уведомления о сундуке, экспедиции и колокольчиках.
    const bot = listRow(this, x, y + 112 / 2, CW, {
      icon: (s, ix, iy, size) => bellIcon(s, ix, iy, size * 0.8, COLOR_N.textSecondary),
      title: 'Уведомления в боте',
      subtitle: '@Chronoworldbot',
      trailing: '›',
      h: 112,
      onTap: a.tap(() => openTgLink(BOT_LINK)),
    }).setName('openBot');
    a.add(bot);
    groups.push([bot]);
    y += 112;
    a.setContentHeight(y + S.s);
    staggerIn(this, 'friends', groups);
  }

  /** Строка друга: аватар-буква (звонил — колокольчик на нём), имя, «Гл. N · этап M», чип силы и кнопка-колокольчик. */
  private friendRow(f: FriendInfo, y: number): Phaser.GameObjects.Container {
    const trail = this.add.container(0, 0);
    const ring = bellButton(this, f.giftSent, this.area.tap(() => void this.ring(f, ring)));
    ring.container.setName(`ring_${f.id}`);
    const parts: Phaser.GameObjects.Container[] = [];
    if (f.power > 0) parts.push(chip(this, 0, 0, 'swords', compactNumber(f.power), 'neutral', { size: 's' }));
    parts.push(ring.container);
    const w = parts.reduce((s, p) => s + p.width, 0) + S.xs * (parts.length - 1);
    let cx = -w / 2;
    for (const p of parts) {
      p.setX(cx + p.width / 2);
      cx += p.width + S.xs;
    }
    trail.add(parts).setSize(w, BTN.m);
    const row = listRow(this, GAME_W / 2, y, CW, {
      icon: (s, x, iy, size) => avatar(s, x, iy, size, f.name, f.giftWaiting),
      title: f.name,
      subtitle: friendWhere(f.chapter, f.stage),
      trailing: trail,
      h: FRIEND_H,
    });
    row.setName(`friend_${f.id}`);
    return row;
  }

  private busy = false;

  private async ring(f: FriendInfo, b: BellButton): Promise<void> {
    if (f.giftSent) {
      toast(this, `Сегодня вы уже звонили: ${f.name}`);
      return;
    }
    if (this.busy) return;
    this.busy = true;
    const ok = await api.giftSend(f.id);
    this.busy = false;
    if (!this.sys.isActive()) return;
    if (!ok) {
      toast(this, 'Не дозвонились — нет связи', COLOR.negative);
      return;
    }
    f.giftSent = true;
    b.setSent(true);
    haptic('reward');
    toast(this, `Дзынь! ${f.name} получит ${BELL_GEMS} гемов`, COLOR.positive);
  }

  private async claim(b: ButtonView): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    b.setEnabled(false);
    const n = await claimBells();
    this.busy = false;
    if (!this.sys.isActive()) return;
    if (n === null) {
      b.setEnabled(true);
      toast(this, 'Нет связи с сервером — колокольчики подождут', COLOR.negative);
      return;
    }
    cache.friends = null;
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () =>
      toast(this, n > 0 ? `+${BELL_GEMS * n} гемов от друзей` : `На сегодня максимум — ${BELLS_PER_DAY}. Остальные — завтра`, n > 0 ? COLOR.gem : COLOR.title),
    );
  }

  // ---------- Рекорды ----------

  private recordsTab(): void {
    const { board, scope } = this.opts;
    let y = this.top;
    // Доски — один сегмент со значками; под ним — «Все игроки / Друзья» и неделя (у недельных досок).
    const kinds = BOARD_KINDS.map((k) => k.id);
    const bi = Math.max(0, kinds.indexOf(board));
    const bseg = segmented(this, GAME_W / 2, y + 44, CW, kinds.map((k) => BOARD_SHORT[k]), bi, (i) => this.scene.restart({ board: kinds[i] } satisfies FriendsData));
    bseg.container.setName('boardTabs');
    segIcons(this, bseg.container, kinds.map((k) => BOARD_ICON[k]), bi);
    y += 88 + S.xs;
    const si = Math.max(0, SCOPES.findIndex((s) => s.id === scope));
    const sseg = segmented(this, S.l + 260, y + 40, 520, SCOPES.map((s) => s.label), si, (i) => this.scene.restart({ scope: SCOPES[i].id } satisfies FriendsData), { h: 80 });
    sseg.container.setName('scopeTabs');
    const weekY = y + 40;
    y += 80 + S.s;
    // Внизу — моё место (плашка), над ней — список.
    const bottom = contentBottom();
    const mineY = bottom - ROW_H / 2;
    const listTop = y;
    this.area = new ScrollArea(this, listTop, mineY - ROW_H / 2 - S.xs);
    const gen = this.gen;
    const key = `${board}:${scope}`;
    const draw = (d: BoardResp) => {
      if (!this.alive(gen)) return;
      this.clearStatus();
      this.area.clear();
      const week = weekLabel(d.week);
      if (week) text(this, GAME_W - S.l, weekY, week, T.caption, COLOR.textSecondary, { fontStyle: 'bold' }).setOrigin(1, 0.5).setName('boardWeek');
      this.drawBoard(d, mineY);
    };
    const statusY = Math.round((listTop + mineY) / 2) - 60;
    const load = async () => {
      this.showStatus(statusY, 'Загружаем рекорды…');
      const d = await api.board(board, scope);
      if (!this.alive(gen)) return;
      if (!d) {
        this.showStatus(statusY, 'Нет связи с сервером.\nРекорды подождут.', () => void load());
        return;
      }
      cache.boards.set(key, { at: Date.now(), data: d });
      draw(d);
    };
    const c = cache.boards.get(key);
    if (c && fresh(c.at)) draw(c.data);
    else void load();
  }

  private drawBoard(d: BoardResp, mineY: number): void {
    const a = this.area;
    const kind = this.opts.board;
    if (!d.top.length) {
      const weekly = kind === 'tower' || kind === 'mvp';
      const msg = this.opts.scope === 'friends' ? 'Друзей пока нет на доске' : weekly ? 'На этой неделе рекордов ещё нет' : 'На доске пока никого';
      a.add(plate(this, GAME_W / 2, 150, CW, 300, { ...SURFACE.surface, r: R.l }));
      a.add(iconTrophy(this, GAME_W / 2, 100));
      a.add(text(this, GAME_W / 2, 200, msg, T.heading, COLOR.textSecondary, { fontStyle: 'bold' }));
      a.add(text(this, GAME_W / 2, 252, 'Будьте первым!', T.body, COLOR.textTertiary));
      a.setContentHeight(320);
    } else {
      const groups: Phaser.GameObjects.GameObject[][] = [];
      d.top.forEach((r, i) => {
        const row = boardRow(this, kind, r, i * (ROW_H + S.xxs) + ROW_H / 2);
        a.add(row);
        groups.push([row]);
      });
      a.setContentHeight(d.top.length * (ROW_H + S.xxs) + S.xs);
      staggerIn(this, 'board', groups);
    }
    // Моё место — всегда видно внизу.
    mineRow(this, kind, d.mine, mineY);
  }
}

// ---------- мелкие виды ----------

const mixHexN = (a: string, b: string, t: number) => parseInt(mixHex(a, b, t).slice(1), 16);

/** Кружок-аватар с первой буквой имени; звонил — золотой колокольчик в углу. */
function avatar(scene: Phaser.Scene, x: number, y: number, size: number, name: string, bell: boolean): Phaser.GameObjects.Container {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const fill = AVATAR[h % AVATAR.length];
  const r = size * 0.62;
  const disc = scene.add.circle(0, 0, r, parseInt(fill.slice(1), 16)).setStrokeStyle(3, mixHexN(fill, '#ffffff', 0.35));
  const letter = text(scene, 0, 2, (name.trim()[0] ?? '?').toUpperCase(), T.heading, COLOR.textPrimary, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
  const c = scene.add.container(x, y, [disc, letter]);
  if (bell) {
    c.add(scene.add.circle(r * 0.72, -r * 0.72, 22, COLOR_N.accent).setStrokeStyle(3, COLOR_N.onAccent));
    c.add(bellIcon(scene, r * 0.72, -r * 0.72 - 1, 28, COLOR_N.onAccent));
    c.setName('friendBellMark');
  }
  return c;
}

interface BellButton {
  container: Phaser.GameObjects.Container;
  setSent: (sent: boolean) => void;
}

/** Кнопка-колокольчик 96×96: позвонить; позвонили сегодня — приглушённая галка. */
function bellButton(scene: Phaser.Scene, sent: boolean, onTap: () => void): BellButton {
  const b = button(scene, 0, 0, BTN.icon, BTN.icon, '', '', onTap, T.body, { variant: 'icon' });
  const glyph = scene.add.container(0, -2);
  b.container.add(glyph);
  const setSent = (s: boolean) => {
    glyph.removeAll(true);
    if (s) glyph.add(scene.add.image(0, 0, 'skin_ico_check').setDisplaySize(44, 44).setTint(COLOR_N.textTertiary));
    else glyph.add(bellIcon(scene, 0, 0, 50, COLOR_N.accent));
    b.setEnabled(!s);
  };
  setSent(sent);
  b.container.setSize(BTN.icon, BTN.icon);
  return { container: b.container, setSent };
}

/** Чипы в ряд по центру x (контейнер). */
function chipRow(scene: Phaser.Scene, x: number, y: number, chips: Phaser.GameObjects.Container[]): Phaser.GameObjects.Container {
  const w = chips.reduce((s, c) => s + c.width, 0) + S.xs * (chips.length - 1);
  let cx = -w / 2;
  for (const c of chips) {
    c.setPosition(cx + c.width / 2, 0);
    cx += c.width + S.xs;
  }
  return scene.add.container(x, y, chips).setSize(w, 56);
}

/** Значки скина слева от подписей сегмента (segmented рисует только текст): выбранный — золотой, остальные — вторичные. */
function segIcons(scene: Phaser.Scene, box: Phaser.GameObjects.Container, icons: string[], selected: number): void {
  const labels = box.list.filter((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
  labels.forEach((t, i) => {
    const key = `skin_ico_${icons[i]}`;
    if (!scene.textures.exists(key)) return;
    const size = 40;
    const w = size + S.xxs + t.width;
    const ix = t.x - w / 2 + size / 2;
    t.setX(t.x + (size + S.xxs) / 2);
    box.add(scene.add.image(ix, 0, key).setDisplaySize(size, size).setTint(i === selected ? COLOR_N.title : COLOR_N.textSecondary));
  });
}

/** Значок кубка для пустой доски. */
function iconTrophy(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, 'skin_ico_trophy').setDisplaySize(80, 80).setTint(COLOR_N.textTertiary);
}

/** Место: медаль для 1–3 (золото, серебро, бронза), дальше — число. */
function placeBadge(scene: Phaser.Scene, x: number, y: number, size: number, place: number): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  if (place <= 3) {
    const col = MEDAL[place - 1];
    const r = size * 0.42;
    c.add(scene.add.circle(0, 0, r, parseInt(col.slice(1), 16)).setStrokeStyle(4, mixHexN(col, '#000000', 0.45)));
    c.add(scene.add.circle(0, 0, r - 9).setStrokeStyle(2, mixHexN(col, '#ffffff', 0.45), 0.8));
    c.add(text(scene, 0, 1, String(place), T.heading, COLOR.onAccent, { fontStyle: 'bold' }));
  } else {
    const t = text(scene, 0, 0, String(place), place > 99 ? T.caption : T.body, COLOR.textSecondary, { fontStyle: 'bold' });
    ellipsize(t, size - 8);
    c.add(t);
  }
  return c.setName(`place_${place}`);
}

/** Подсветка «это вы»: золотистая заливка и кромка поверх подложки строки. */
function meGlow(scene: Phaser.Scene, row: Phaser.GameObjects.Container): void {
  const g = plate(scene, 0, 0, row.width, row.height, { fill: COLOR.accent, alpha: 0.14, border: mixHex(COLOR.border, COLOR.accent, 0.7), borderW: 3, r: R.m });
  row.addAt(g, 1);
}

/** Строка доски: место, имя (вы — подсветка), мелко — глава и сила; справа — значение доски. */
function boardRow(scene: Phaser.Scene, kind: BoardKind, r: BoardRow, y: number): Phaser.GameObjects.Container {
  const sub = boardSubLine(kind, r);
  const row = listRow(scene, GAME_W / 2, y, CW, {
    icon: (s, x, iy, size) => placeBadge(s, x, iy, size, r.place),
    title: r.me ? `${r.name} · вы` : r.name,
    ...(sub ? { subtitle: sub } : {}),
    trailing: boardValueText(kind, r),
    trailingTone: r.place <= 3 || r.me ? 'accent' : 'neutral',
    h: ROW_H,
  });
  if (r.me) {
    meGlow(scene, row);
    row.setName('boardMeRow');
  }
  return row;
}

/** «Ваше место» внизу: место и значение или короткая подсказка, как попасть на доску. */
function mineRow(scene: Phaser.Scene, kind: BoardKind, mine: BoardMine | null, y: number): void {
  const how: Record<BoardKind, string> = { power: 'Пройдите этап', progress: 'Пройдите этап', tower: 'Поднимитесь в Башне', mvp: 'Сразитесь с MVP' };
  const row = listRow(scene, GAME_W / 2, y, CW, {
    icon: mine ? (s, x, iy, size) => placeBadge(s, x, iy, size, mine.place) : 'flag',
    title: mine ? 'Ваше место' : 'Вас пока нет на доске',
    ...(mine ? {} : { subtitle: how[kind] }),
    ...(mine ? { trailing: boardValueText(kind, { value: mine.value, chapter: mine.chapter, stage: mine.stage }), trailingTone: 'accent' as const } : {}),
    raised: true,
    h: ROW_H,
  });
  if (mine) meGlow(scene, row);
  row.setName('myPlace');
}
