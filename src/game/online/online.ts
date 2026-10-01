/**
 * Онлайн фаза 1 — связка с игрой (docs/design/online.md, раздел «Клиент»). Непринуждённо: вне Telegram и без сети
 * ничего не происходит и ничего не показывается; ошибки сети молчат.
 *
 * - Вход (startOnline, из main.ts): `hello` → награда пригласившему (`ref_claim`, письмо) → облачное сохранение
 *   («Найдено облачное сохранение…» — Да / Нет, оставить это) → `sync`.
 * - Каждая запись игры (session.onCommit): победа на этапе, новый этаж Башни, бой охоты — `sync` (через 2 с, пачкой) и
 *   облачное сохранение `save_put` не чаще раза в минуту; при сворачивании (lifecycle.onAppHidden) — тоже.
 *   Пока не решён вопрос с облачным сохранением (не было удачного `hello`), в облако ничего не пишется.
 * - Награды — существующими механизмами ядра: письмо с гемами (sendMail) и grantRewards (колокольчики).
 */
import Phaser from 'phaser';
import { deserialize, grantRewards, sendMail, serialize, squadPower } from '../../core';
import { GAME } from '../content';
import { GAME_H, GAME_W } from '../layout';
import { popIn } from '../screen';
import { commit, now, onCommit, session, today } from '../session';
import { LocalStorageAdapter, SAVE_KEY } from '../storage';
import { C, FS } from '../theme';
import { button, panel, text, toast } from '../ui';
import { onAppHidden } from '../lifecycle';
import { haptic } from '../haptics';
import { api, onlineAvailable } from './api';
import {
  agoText,
  BELL_GEMS,
  cloudSaveDelay,
  isFreshSave,
  isoWeek,
  nextMvpWeek,
  progressOf,
  REF_INVITER_GEMS,
  REF_WELCOME_GEMS,
  REF_WELCOME_SOURCE,
  shouldOfferCloud,
  victoryOf,
  type CloudSaveInfo,
  type HelloResp,
  type WeekBest,
} from './logic';

/** Ключи localStorage онлайна («Начать заново» их тоже очищает — префикс chronoworld.). */
const KEY_LOCAL_AT = 'chronoworld.online.localAt';
const KEY_DECLINED = 'chronoworld.online.declinedAt';
const KEY_MVP = 'chronoworld.online.mvpWeek';

const SYNC_DEBOUNCE_MS = 2000;

const ls = {
  get(k: string): string | null {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {
      /* не запомнили — не страшно */
    }
  },
};

/** Что знает игра об онлайне сейчас (экран друзей, кнопка на «Городе»). */
export const onlineState = {
  /** Последний удачный hello (null — ещё не было или нет сети). */
  profile: null as HelloResp | null,
  /** Колокольчиков ждёт (по hello / после «Забрать»). */
  giftsWaiting: 0,
  /** Вопрос «какое сохранение» решён — можно писать в облако. */
  cloudReady: false,
};

const listeners = new Set<() => void>();

/** Подписка на изменения onlineState (кнопка «Друзья» обновляет точку). Возвращает отписку. */
export function onOnlineChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* слушатель со снятой сцены */
    }
  }
}

let game: Phaser.Game | null = null;
let started = false;
let helloing: Promise<HelloResp | null> | null = null;
let dirty = false;
let lastPut = 0;
let putTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Запустить онлайн (один раз, из main.ts). Вне Telegram — ничего. */
export function startOnline(g: Phaser.Game): void {
  if (started || !onlineAvailable()) return;
  started = true;
  game = g;
  onCommit(handleCommit);
  onAppHidden(() => flushCloud(true));
  void login();
}

// ---------- вход ----------

/** hello (повторный вызов ждёт тот же запрос). Неудача — null, следующая победа попробует снова. */
function login(): Promise<HelloResp | null> {
  if (onlineState.profile) return Promise.resolve(onlineState.profile);
  helloing ??= (async () => {
    const h = await api.hello();
    helloing = null;
    if (!h) return null;
    onlineState.profile = h;
    onlineState.giftsWaiting = h.giftsWaiting;
    emit();
    if (h.refBonus > 0) void claimRef();
    resolveCloud(h.cloudSave);
    return h;
  })();
  return helloing;
}

/** Пригласившему: друзья прошли главу 1 — письмо с гемами за каждого. */
async function claimRef(): Promise<void> {
  const n = await api.refClaim();
  if (!n) return;
  const many = n > 1;
  commit(
    sendMail(session.save, today(), {
      from: 'Гильдия искателей',
      title: many ? `${n} друга прошли первую главу` : 'Ваш друг прошёл первую главу',
      body: many
        ? `Друзья, которых вы позвали, прошли первую главу. Гильдия благодарит: ${REF_INVITER_GEMS} гемов за каждого. Зовите ещё — вместе веселее!`
        : `Друг, которого вы позвали, прошёл первую главу. Гильдия благодарит: ${REF_INVITER_GEMS} гемов. Зовите ещё — вместе веселее!`,
      rewards: { gems: REF_INVITER_GEMS * n },
    }),
  );
  onScene((s) => toast(s, many ? `Друзья прошли первую главу — ${REF_INVITER_GEMS * n} гемов в почте` : `Друг прошёл первую главу — ${REF_INVITER_GEMS} гемов в почте`, C.gem, 4500));
}

/** Приглашённому (sync → refRewarded): письмо «Друг рад, что ты с нами» с гемами — один раз. */
function grantWelcome(): void {
  if (session.save.mail?.delivered.includes(REF_WELCOME_SOURCE)) return;
  commit(
    sendMail(session.save, today(), {
      from: 'Друг',
      title: 'Друг рад, что ты с нами',
      body: `Ты прошёл первую главу по приглашению друга — держи ${REF_WELCOME_GEMS} гемов на дорогу. Не забывай звонить друг другу в колокольчик!`,
      rewards: { gems: REF_WELCOME_GEMS },
      source: REF_WELCOME_SOURCE,
    }),
  );
  onScene((s) => toast(s, `Подарок от друга — ${REF_WELCOME_GEMS} гемов в почте`, C.gem, 4500));
}

// ---------- облачное сохранение: выбор ----------

function resolveCloud(cloud: CloudSaveInfo | null): void {
  const local = { chapter: progressOf(session.save, GAME).chapter, fresh: isFreshSave(session.save), changedAt: Number(ls.get(KEY_LOCAL_AT)) || 0 };
  if (!shouldOfferCloud(local, cloud, Number(ls.get(KEY_DECLINED)) || 0)) {
    cloudDecided();
    return;
  }
  onScene((s) => askCloud(s, cloud!));
}

function cloudDecided(): void {
  onlineState.cloudReady = true;
  dirty = true;
  scheduleSync();
  scheduleCloud();
}

/** Окно «Найдено облачное сохранение: глава N, X назад. Продолжить его?». Ушли со сцены не ответив — спросим на следующей. */
function askCloud(scene: Phaser.Scene, cloud: CloudSaveInfo): void {
  let answered = false;
  const cx = GAME_W / 2;
  const cy = GAME_H / 2;
  const layer = scene.add.container(0, 0).setDepth(9500).setName('cloudSaveModal');
  const shade = scene.add.rectangle(cx, cy, GAME_W, GAME_H, 0x000000, 0.75).setInteractive();
  const title = text(scene, cx, 0, 'Найдено облачное сохранение', FS.h1, C.title, { fontStyle: 'bold', wordWrap: { width: 800 } });
  const ago = agoText(Date.now() - cloud.updatedAt);
  const q = text(scene, cx, 0, `Глава ${cloud.chapter}, ${ago}. Продолжить его?`, FS.h2, C.text, { wordWrap: { width: 780 }, lineSpacing: 8 });
  const note = text(scene, cx, 0, 'Если оставить эту игру, облачное сохранение заменится ею.', FS.small, C.muted, { wordWrap: { width: 780 } });
  const boxH = title.height + q.height + note.height + 380;
  const top = cy - boxH / 2;
  const box = panel(scene, cx, cy, 900, boxH, 'ui_panel').setInteractive();
  title.setY(top + 70 + title.height / 2);
  q.setY(title.y + title.height / 2 + 40 + q.height / 2);
  note.setY(q.y + q.height / 2 + 30 + note.height / 2);
  const by = top + boxH - 110;
  const yes = button(scene, cx - 210, by, 380, 120, 'ui_btn_primary', 'Да', () => {
    answered = true;
    layer.destroy();
    void applyCloud();
  });
  const no = button(scene, cx + 210, by, 380, 120, 'k:buttonLong_beige', 'Нет, оставить это', () => {
    answered = true;
    layer.destroy();
    ls.set(KEY_DECLINED, String(cloud.updatedAt));
    cloudDecided();
  }, FS.h3);
  yes.container.setName('cloudYes');
  no.container.setName('cloudNo');
  layer.add([shade, box, title, q, note, yes.container, no.container]);
  layer.once(Phaser.GameObjects.Events.DESTROY, () => {
    if (!answered) setTimeout(() => onScene((s) => askCloud(s, cloud)), 300);
  });
  popIn(scene, layer, shade);
}

/** Загрузить облачное сохранение, проверить, заменить им локальное (локальное — в резервную копию) и перезапустить игру. */
async function applyCloud(): Promise<void> {
  const d = await api.saveGet();
  const fail = (msg: string) => onScene((s) => toast(s, msg, C.error, 5000));
  if (!d) {
    // Сохранение не тронуто; в облако ничего не пишем — спросим снова при следующем входе.
    fail('Не удалось загрузить облачное сохранение. Попробуйте позже — эта игра пока остаётся.');
    return;
  }
  const data = { ...(d.data as Record<string, unknown>), revision: (session.save.revision ?? 0) + 1 };
  const textData = JSON.stringify(data);
  try {
    deserialize(textData);
  } catch (e) {
    const newer = (e as { kind?: string }).kind === 'newer_version';
    fail(newer ? 'Облачное сохранение — из более новой версии игры. Перезапустите игру, чтобы обновиться.' : 'Облачное сохранение повреждено — эта игра остаётся.');
    if (!newer) cloudDecided();
    return;
  }
  const storage = new LocalStorageAdapter(SAVE_KEY);
  storage.backup(serialize(session.save), now());
  storage.save(textData);
  ls.set(KEY_LOCAL_AT, String(Date.now()));
  ls.set(KEY_DECLINED, String(d.updatedAt));
  if (typeof location !== 'undefined') location.reload();
}

// ---------- после записи: sync и облако ----------

function handleCommit(next: typeof session.save, prev: typeof session.save): void {
  dirty = true;
  ls.set(KEY_LOCAL_AT, String(Date.now()));
  const v = victoryOf(prev, next);
  if (!v) return;
  if (v === 'hunt') {
    const cur = readMvp();
    const upd = nextMvpWeek(cur, isoWeek(new Date(now())), prev, next);
    if (upd !== cur) ls.set(KEY_MVP, JSON.stringify(upd));
  }
  scheduleSync();
  scheduleCloud();
}

function readMvp(): WeekBest | null {
  try {
    const o = JSON.parse(ls.get(KEY_MVP) ?? 'null');
    return o && typeof o.week === 'string' && Number.isFinite(o.value) ? { week: o.week, value: o.value } : null;
  } catch {
    return null;
  }
}

function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void doSync();
  }, SYNC_DEBOUNCE_MS);
}

async function doSync(): Promise<void> {
  if (!(await login())) return;
  const save = session.save;
  const p = progressOf(save, GAME);
  const mvp = readMvp();
  const week = isoWeek(new Date(now()));
  const r = await api.sync({
    chapter: p.chapter,
    stage: p.stage,
    power: Math.round(squadPower(save, GAME)),
    towerBest: save.tower.floor,
    mvpWeek: mvp && mvp.week === week ? Math.round(mvp.value) : 0,
  });
  if (r?.refRewarded) grantWelcome();
}

function scheduleCloud(): void {
  if (!onlineState.cloudReady) {
    // Не было удачного hello (нет сети при входе) — попробуем войти; облако — после решения.
    void login();
    return;
  }
  const wait = cloudSaveDelay(Date.now(), lastPut);
  if (wait === 0) void putCloud(false);
  else if (!putTimer)
    putTimer = setTimeout(() => {
      putTimer = null;
      void putCloud(false);
    }, wait);
}

/** Свернули: отправить, если минутное окно позволяет (иначе — по таймеру, когда вернутся). */
function flushCloud(keepalive: boolean): void {
  if (!onlineState.cloudReady || !dirty) return;
  if (cloudSaveDelay(Date.now(), lastPut) === 0) void putCloud(keepalive);
  else scheduleCloud();
}

async function putCloud(keepalive: boolean): Promise<void> {
  if (!dirty || !onlineState.cloudReady) return;
  dirty = false;
  lastPut = Date.now();
  const save = session.save;
  const ok = await api.savePut(JSON.parse(serialize(save)), save.version, progressOf(save, GAME).chapter, keepalive);
  if (!ok) dirty = true;
}

// ---------- колокольчики ----------

/** «Забрать колокольчики»: gift_claim → 20 гемов за каждый (grantRewards). null — нет связи. */
export async function claimBells(): Promise<number | null> {
  const n = await api.giftClaim();
  if (n === null) return null;
  if (n > 0) {
    commit(grantRewards(session.save, { gems: BELL_GEMS * n }, GAME, 'online_bells').save);
    haptic('reward');
  }
  onlineState.giftsWaiting = Math.max(0, onlineState.giftsWaiting - n);
  emit();
  return n;
}

/** Колокольчиков ждёт по свежему списку друзей (экран друзей). */
export function setGiftsWaiting(n: number): void {
  if (n === onlineState.giftsWaiting) return;
  onlineState.giftsWaiting = n;
  emit();
}

// ---------- помощники ----------

/** Выполнить на текущем экране (не на экране загрузки); экрана ещё нет — подождать. */
function onScene(fn: (s: Phaser.Scene) => void, tries = 60): void {
  const s = game?.scene.getScenes(true).filter((x) => x.scene.key !== 'Boot').pop();
  if (s && s.sys.settings.active) {
    fn(s);
    return;
  }
  if (tries > 0) setTimeout(() => onScene(fn, tries - 1), 500);
}

/** Для тестов: сброс внутреннего состояния. */
export function resetOnlineForTests(): void {
  started = false;
  game = null;
  helloing = null;
  dirty = false;
  lastPut = 0;
  onlineState.profile = null;
  onlineState.giftsWaiting = 0;
  onlineState.cloudReady = false;
  listeners.clear();
}
