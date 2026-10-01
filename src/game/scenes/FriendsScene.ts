import Phaser from 'phaser';
import { GAME_W } from '../layout';
import { badge, card, CONTENT_TOP, contentBottom, screen } from '../screen';
import { button, ellipsize, emptyState, ScrollArea, text, toast } from '../ui';
import { C, FS, OUTLINE, TOUCH } from '../theme';
import { haptic } from '../haptics';
import { api, onlineAvailable, openTgLink } from '../online/api';
import { appLink } from '../online/entry';
import { BELL_GEMS, BELLS_PER_DAY, BOT_LINK, groupDigits, REF_INVITER_GEMS, REF_WELCOME_GEMS, shareUrl, type BoardKind, type BoardResp, type BoardScope, type FriendInfo } from '../online/logic';
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

let last: Required<FriendsData> = { tab: 'friends', board: 'tower', scope: 'all' };

const LEFT = 60;
const CARD_H = 190;
const ROW_H = 104;

/**
 * «Друзья и рекорды» (онлайн фаза 1, docs/design/online.md): вкладки «Друзья» (колокольчики, «Позвать друга», список
 * друзей с кнопкой «Колокольчик» раз в день) и «Рекорды недели» (Башня / MVP, все / друзья, моё место). Вход — кнопка
 * «Друзья» на странице «Город», только в Telegram (online/entry.ts). Нет сети — спокойное «Нет связи» и «Повторить».
 */
export class FriendsScene extends Phaser.Scene {
  private area!: ScrollArea;
  private opts: Required<FriendsData> = last;
  /** Номер показа: ответ, пришедший после перезапуска экрана, не рисуется. */
  private gen = 0;
  private status: Phaser.GameObjects.GameObject[] = [];

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
      emptyState(this, GAME_W / 2, CONTENT_TOP + 400, 'Друзья и рекорды работают, когда игра открыта в Telegram.');
      return;
    }
    const tabs: { id: FriendsTab; label: string }[] = [
      { id: 'friends', label: 'Друзья' },
      { id: 'records', label: 'Рекорды недели' },
    ];
    const w = 1040 / tabs.length;
    const ty = CONTENT_TOP + 50;
    tabs.forEach((t, i) => {
      const on = t.id === this.opts.tab;
      const x = 20 + w * (i + 0.5);
      const b = button(this, x, ty, w - 12, TOUCH, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t.label, () => {
        if (!on) this.scene.restart({ tab: t.id } satisfies FriendsData);
      }, FS.h3, { sound: 'ui_tab' });
      b.container.setName(`friendsTab_${t.id}`);
      if (t.id === 'friends' && !on && onlineState.giftsWaiting > 0) badge(this, x + (w - 12) / 2 - 34, ty, onlineState.giftsWaiting);
    });
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

  /** «Загружаем…» / «Нет связи» с «Повторить» посреди списка. */
  private showStatus(y: number, msg: string, retry?: () => void): void {
    this.clearStatus();
    this.status.push(emptyState(this, GAME_W / 2, y, msg));
    if (retry) {
      const b = button(this, GAME_W / 2, y + 150, 380, 110, 'ui_btn_secondary', 'Повторить', retry, FS.h3);
      b.container.setName('friendsRetry');
      this.status.push(b.container);
    }
  }

  // ---------- Друзья ----------

  private friendsTab(): void {
    let y = CONTENT_TOP + 120;
    // Колокольчики: сколько ждут и «Забрать».
    const bellH = 170;
    card(this, GAME_W / 2, y + bellH / 2, 1040, bellH);
    const n = onlineState.giftsWaiting;
    text(this, LEFT, y + 55, n > 0 ? `Колокольчиков ждёт: ${n}` : 'Новых колокольчиков нет', FS.h3, n > 0 ? C.title : C.text, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5).setName('bellsTitle');
    text(this, LEFT, y + 115, n > 0 ? `${BELL_GEMS} гемов за каждый, до ${BELLS_PER_DAY} в день` : 'Друзья звонят — вы получаете гемы', FS.small, C.muted, OUTLINE).setOrigin(0, 0.5);
    if (n > 0) {
      const b = button(this, 870, y + bellH / 2, 280, 110, 'ui_btn_primary', 'Забрать', () => void this.claim(b), FS.h3);
      b.container.setName('bellsClaim');
      badge(this, 870 + 140 - 16, y + bellH / 2 - 55 - 4, n);
    }
    y += bellH + 24;
    // «Позвать друга»: share-ссылка с startapp=ref_<id> (VITE_TG_APP_LINK, по умолчанию — главное приложение бота).
    const link = appLink();
    if (link) {
      const inv = button(this, GAME_W / 2, y + 60, 1040, 120, 'ui_btn_primary', 'Позвать друга', () => {
        const id = onlineState.profile?.id;
        if (!id) {
          toast(this, 'Нет связи с сервером — попробуйте чуть позже', C.error);
          return;
        }
        openTgLink(shareUrl(link, id));
      }, FS.h2);
      inv.container.setName('inviteFriend');
      y += 130;
      text(this, GAME_W / 2, y + 40, `Друг пройдёт главу 1 — вам ${REF_INVITER_GEMS} гемов, ему ${REF_WELCOME_GEMS}`, FS.small, C.muted, { ...OUTLINE, wordWrap: { width: 1000 } });
      y += 90;
    }
    // Бот: уведомления (сундук, экспедиция, колокольчик) — маленькая строка с «Открыть бота».
    text(this, LEFT, y + 45, 'Уведомления в боте: @Chronoworldbot', FS.small, C.muted, OUTLINE).setOrigin(0, 0.5).setName('botHint');
    const bot = button(this, 900, y + 45, 240, 80, 'k:buttonLong_beige', 'Открыть бота', () => openTgLink(BOT_LINK), FS.small);
    bot.container.setName('openBot');
    y += 100;
    this.area = new ScrollArea(this, y, contentBottom() + 10);
    const gen = this.gen;
    const draw = (list: FriendInfo[]) => {
      if (!this.alive(gen)) return;
      this.clearStatus();
      this.area.clear();
      this.drawFriends(list, link !== null);
    };
    const load = async () => {
      this.showStatus(y + 160, 'Загружаем друзей…');
      const list = await api.friends();
      if (!this.alive(gen)) return;
      if (!list) {
        this.showStatus(y + 160, 'Нет связи с сервером. Игра работает как обычно — друзья подождут.', () => void load());
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

  private drawFriends(list: FriendInfo[], canInvite: boolean): void {
    const a = this.area;
    if (!list.length) {
      a.add(
        emptyState(
          this,
          GAME_W / 2,
          160,
          canInvite
            ? 'Пока никого. Позовите друга — как только он откроет игру по вашей ссылке, вы станете друзьями.'
            : 'Пока никого. Друг, открывший игру по вашей ссылке-приглашению, появится здесь.',
        ),
      );
      a.setContentHeight(320);
      return;
    }
    const sorted = [...list].sort((x, y) => Number(y.giftWaiting) - Number(x.giftWaiting) || y.chapter - x.chapter || y.stage - x.stage);
    let top = 0;
    for (const f of sorted) {
      const cy = top + CARD_H / 2;
      a.add(card(this, GAME_W / 2, cy, 1040, CARD_H));
      a.add(ellipsize(text(this, LEFT, cy - 50, f.name, FS.h3, C.text, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5), 560));
      const where = f.chapter > 0 ? `Глава ${f.chapter} · этап ${Math.max(1, f.stage)}` : 'Только начинает';
      a.add(text(this, LEFT, cy + 2, `${where} · Башня: ${f.towerBest}`, FS.small, C.muted, OUTLINE).setOrigin(0, 0.5));
      if (f.giftWaiting) a.add(text(this, LEFT, cy + 52, 'Прислал вам колокольчик', FS.small, C.gold, OUTLINE).setOrigin(0, 0.5).setName('friendBellMark'));
      const b = button(this, 860, cy, 300, 110, f.giftSent ? 'k:buttonLong_grey' : 'ui_btn_secondary', f.giftSent ? 'Отправлен' : 'Колокольчик', a.tap(() => void this.ring(f, b)), FS.h3);
      if (f.giftSent) b.setEnabled(false);
      b.container.setName(`ring_${f.id}`);
      a.add(b.container);
      top += CARD_H + 16;
    }
    a.add(text(this, GAME_W / 2, top + 36, 'Колокольчик можно послать каждому другу раз в день', FS.small, C.dim, OUTLINE));
    a.setContentHeight(top + 90);
  }

  private busy = false;

  private async ring(f: FriendInfo, b: ReturnType<typeof button>): Promise<void> {
    if (f.giftSent) {
      toast(this, `Сегодня вы уже звонили: ${f.name}. Завтра — снова`);
      return;
    }
    if (this.busy) return;
    this.busy = true;
    const ok = await api.giftSend(f.id);
    this.busy = false;
    if (!this.sys.isActive()) return;
    if (!ok) {
      toast(this, 'Не дозвонились — нет связи. Попробуйте чуть позже', C.error);
      return;
    }
    f.giftSent = true;
    b.setLabel('Отправлен');
    b.setEnabled(false);
    haptic('reward');
    toast(this, `Дзынь! ${f.name} получит ${BELL_GEMS} гемов`, C.success);
  }

  private async claim(b: ReturnType<typeof button>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    b.setEnabled(false);
    const n = await claimBells();
    this.busy = false;
    if (!this.sys.isActive()) return;
    if (n === null) {
      b.setEnabled(true);
      toast(this, 'Нет связи с сервером — колокольчики подождут', C.error);
      return;
    }
    cache.friends = null;
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () =>
      toast(this, n > 0 ? `+${BELL_GEMS * n} гемов от друзей` : `Сегодня забрано максимум — ${BELLS_PER_DAY} колокольчиков. Остальные — завтра`, n > 0 ? C.gem : C.title),
    );
  }

  // ---------- Рекорды недели ----------

  private recordsTab(): void {
    const { board, scope } = this.opts;
    const y = CONTENT_TOP + 160;
    const seg = (x: number, label: string, on: boolean, name: string, go: FriendsData) => {
      const b = button(this, x, y, 250, TOUCH, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', label, () => {
        if (!on) this.scene.restart(go);
      }, FS.small, { sound: 'ui_tab' });
      b.container.setName(name);
    };
    seg(150, 'Башня', board === 'tower', 'boardTower', { board: 'tower' });
    seg(406, 'MVP', board === 'mvp', 'boardMvp', { board: 'mvp' });
    seg(674, 'Все', scope === 'all', 'scopeAll', { scope: 'all' });
    seg(930, 'Друзья', scope === 'friends', 'scopeFriends', { scope: 'friends' });
    text(this, GAME_W / 2, y + 90, board === 'tower' ? 'Лучший этаж Башни за неделю' : 'Лучший зачёт охоты на MVP за неделю', FS.small, C.muted, OUTLINE);
    // Внизу — моё место (плашка), над ней — список.
    const bottom = contentBottom();
    const mineY = bottom - 60;
    this.area = new ScrollArea(this, y + 140, mineY - 80);
    const gen = this.gen;
    const key = `${board}:${scope}`;
    const draw = (d: BoardResp) => {
      if (!this.alive(gen)) return;
      this.clearStatus();
      this.area.clear();
      this.drawBoard(d, mineY);
    };
    const load = async () => {
      this.showStatus(y + 400, 'Загружаем рекорды…');
      const d = await api.board(board, scope);
      if (!this.alive(gen)) return;
      if (!d) {
        this.showStatus(y + 400, 'Нет связи с сервером. Рекорды подождут — игра работает как обычно.', () => void load());
        return;
      }
      cache.boards.set(key, { at: Date.now(), data: d });
      draw(d);
    };
    const c = cache.boards.get(key);
    if (c && fresh(c.at)) draw(c.data);
    else void load();
  }

  private value(v: number): string {
    return this.opts.board === 'tower' ? `этаж ${v}` : groupDigits(v);
  }

  private drawBoard(d: BoardResp, mineY: number): void {
    const a = this.area;
    if (!d.top.length) {
      a.add(emptyState(this, GAME_W / 2, 140, this.opts.scope === 'friends' ? 'У друзей пока нет рекордов на этой неделе. Будьте первым!' : 'На этой неделе рекордов ещё нет. Будьте первым!'));
      a.setContentHeight(280);
    } else {
      d.top.forEach((r, i) => {
        const cy = i * ROW_H + ROW_H / 2;
        if (r.me) a.add(this.add.rectangle(GAME_W / 2, cy, 1040, ROW_H - 8, 0xf0cf8a, 0.22).setStrokeStyle(3, 0xf0cf8a));
        else if (i % 2 === 0) a.add(this.add.rectangle(GAME_W / 2, cy, 1040, ROW_H - 8, 0x000000, 0.35));
        const medal = r.place <= 3 ? C.gold : C.text;
        a.add(text(this, LEFT + 40, cy, String(r.place), FS.h3, medal, { fontStyle: 'bold', ...OUTLINE }));
        a.add(ellipsize(text(this, LEFT + 110, cy, r.me ? `${r.name} (вы)` : r.name, FS.body, r.me ? C.title : C.text, OUTLINE).setOrigin(0, 0.5), 520));
        a.add(text(this, GAME_W - LEFT, cy, this.value(r.value), FS.body, C.title, OUTLINE).setOrigin(1, 0.5));
      });
      a.setContentHeight(d.top.length * ROW_H + 20);
    }
    // Моё место — всегда видно внизу.
    card(this, GAME_W / 2, mineY, 1040, 120).setName('myPlace');
    const mine = d.mine;
    const msg = mine
      ? `Ваше место: ${mine.place} · ${this.value(mine.value)}`
      : this.opts.board === 'tower'
        ? 'Вас пока нет в рекордах — поднимитесь в Башне'
        : 'Вас пока нет в рекордах — сразитесь с MVP';
    text(this, GAME_W / 2, mineY, msg, FS.body, mine ? C.title : C.muted, { ...OUTLINE, wordWrap: { width: 980 } }).setName('myPlaceText');
  }
}
