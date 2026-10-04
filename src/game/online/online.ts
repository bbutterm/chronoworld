/**
 * Онлайн фаза 1 — связка с игрой (docs/design/online.md, раздел «Клиент»). Непринуждённо: вне Telegram и без сети
 * ничего не происходит и ничего не показывается; ошибки сети молчат.
 *
 * - Вход: `hello` → выбор облачного сохранения → доставка наград по постоянным ID → `sync`.
 * - Каждая запись игры (session.onCommit): победа на этапе, новый этаж Башни, бой охоты — `sync` (через 2 с, пачкой) и
 *   облачное сохранение `save_put` не чаще раза в минуту; при сворачивании (lifecycle.onAppHidden) — тоже.
 *   Пока не решён вопрос с облачным сохранением (не было удачного `hello`), в облако ничего не пишется.
 * - Награды — существующими механизмами ядра: письмо с гемами (sendMail) и grantRewards (колокольчики).
 */
import Phaser from 'phaser';
import { deserialize, serialize, squadPower } from '../../core';
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
  applyRewardGrants,
  BELL_GEMS,
  cloudSaveDelay,
  isFreshSave,
  isoWeek,
  nextMvpWeek,
  notifyTimersOf,
  progressOf,
  shouldOfferCloud,
  syncDelay,
  syncPower,
  timersChanged,
  victoryOf,
  type CloudSaveInfo,
  type HelloResp,
  type NotifyTimers,
  type WeekBest,
  type OnlineProgress,
} from './logic';

/** Ключи localStorage онлайна («Начать заново» их тоже очищает — префикс chronoworld.). */
const KEY_LOCAL_AT = 'chronoworld.online.localAt';
const KEY_DECLINED = 'chronoworld.online.declinedAt';
const KEY_MVP = 'chronoworld.online.mvpWeek';
const KEY_CLOUD_REVISION = 'chronoworld.online.cloudRevision';

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
  /** Другая копия игры записала облако: локальное продолжает сохраняться, облако ждёт выбора игрока. */
  cloudConflict: false,
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
/** Что последним ушло на сервер для уведомлений бота (null — ещё ничего). */
let sentTimers: NotifyTimers | null = null;
/** Сила отряда, ушедшая с последним sync (-1 — ещё не было), и когда был sync (Date.now). */
let sentPower = -1;
let lastSync = 0;
let cloudRevision = 0;
let putting = false;
let claiming: Promise<{ bells: number; refs: number } | null> | null = null;
let pendingPut: { save: typeof session.save; data: unknown; expectedRevision: number; writeId: string } | null = null;
let rewardTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Для уведомлений бота (docs/design/online.md, «Бот и уведомления»): часовой пояс устройства (как getTimezoneOffset —
 * в слое игры, не в ядре), когда сундук полон и когда вернётся ближайшая экспедиция.
 */
function notifyFields(): { tzOffset: number; chestFullAt: number | null; expeditionsDoneAt: number | null } {
  const t = notifyTimersOf(session.save, now(), GAME);
  sentTimers = t;
  // Часы игры (now()) могут быть сдвинуты (режим тестировщика «+12 ч») — серверу нужно настоящее время.
  const shift = Date.now() - now();
  const real = (x: number | null) => (x === null ? null : x + shift);
  return { tzOffset: new Date().getTimezoneOffset(), chestFullAt: real(t.chestFullAt), expeditionsDoneAt: real(t.expeditionsDoneAt) };
}

/** Запустить онлайн (один раз, из main.ts). Вне Telegram — ничего. */
export function startOnline(g: Phaser.Game): void {
  if (started || !onlineAvailable()) return;
  started = true;
  game = g;
  onCommit(handleCommit);
  onAppHidden(() => {
    flushCloud(true);
    // Забрал сундук или отправил отряд и свернул — пусть бот знает новые сроки.
    // Отложенный sync (сила выросла меньше минуты назад) — тоже сейчас: страницу могут выгрузить.
    if (!onlineState.profile) return;
    const pending = syncTimer !== null || syncPower(squadPower(session.save, GAME)) !== sentPower;
    if (pending || timersChanged(sentTimers, notifyTimersOf(session.save, now(), GAME))) {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = null;
      void doSync(true);
    }
  });
  void login();
}

// ---------- вход ----------

/** hello (повторный вызов ждёт тот же запрос). Неудача — null, следующая победа попробует снова. */
function login(): Promise<HelloResp | null> {
  if (onlineState.profile) return Promise.resolve(onlineState.profile);
  helloing ??= (async () => {
    const h = await api.hello(notifyFields());
    helloing = null;
    if (!h) return null;
    onlineState.profile = h;
    onlineState.giftsWaiting = h.giftsWaiting;
    emit();
    // Старый сервер может прочесть игру, но ещё не обеспечивает CAS/долговечные grants.
    if (h.protocol === 2) resolveCloud(h.cloudSave);
    return h;
  })();
  return helloing;
}

/** Grants остаются на сервере до CAS-записи снимка с appliedGrantIds. */
function receiveRewards(notify = true): Promise<{ bells: number; refs: number } | null> {
  if (!onlineState.cloudReady || onlineState.profile?.protocol !== 2) return Promise.resolve(null);
  if (battleActive()) { scheduleRewards(); return Promise.resolve(null); }
  claiming ??= (async () => {
    try {
      const grants = await api.rewardClaim();
      if (!grants || !onlineState.cloudReady) return null;
      // Бой уже посчитан из снимка при входе. Его итог не должен затереть фоновую выдачу во время анимации.
      if (battleActive()) { scheduleRewards(); return null; }
      const out = applyRewardGrants(session.save, grants, today(), GAME);
      if (out.save !== session.save) {
        commit(out.save);
        // Если устаревшая вкладка отклонила запись, grant остаётся неполученным и не подтверждается.
        const persisted = onlineProgress().appliedGrantIds;
        if (!grants.every((g) => persisted.includes(g.id))) return null;
      }
      if (out.refs) onScene((s) => toast(s, 'Подарок за приглашение друзей — в почте', C.gem, 4500));
      if (out.bells) {
        onlineState.giftsWaiting = Math.max(0, onlineState.giftsWaiting - out.bells);
        emit();
        if (notify) onScene((s) => toast(s, `Колокольчики друзей: +${out.bells * BELL_GEMS} гемов`, C.gem, 4500));
      }
      return { bells: out.bells, refs: out.refs };
    } finally { claiming = null; }
  })();
  return claiming;
}

function battleActive(): boolean {
  return game?.scene.getScenes(true).some((scene) => scene.scene.key === 'Battle') ?? false;
}

function scheduleRewards(): void {
  if (rewardTimer) return;
  rewardTimer = setTimeout(() => { rewardTimer = null; void receiveRewards(); }, 500);
}

async function waitForBattle(): Promise<void> {
  while (battleActive()) await new Promise<void>((done) => setTimeout(done, 500));
}

function showCloudChoice(cloud: CloudSaveInfo): void {
  // Медленный/ручной бой может идти дольше 30 секунд. Выбор остаётся ожидающим до безопасного экрана.
  onScene((scene) => askCloud(scene, cloud), Number.POSITIVE_INFINITY);
}

// ---------- облачное сохранение: выбор ----------

function resolveCloud(cloud: CloudSaveInfo | null, force = false): void {
  cloudRevision = cloud?.writeRevision ?? 0;
  const previous = readCloudRevision();
  const local = { chapter: progressOf(session.save, GAME).chapter, fresh: isFreshSave(session.save), changedAt: Number(ls.get(KEY_LOCAL_AT)) || 0 };
  // Первое обновление протокола и изменение серверной ревизии требуют явного выбора вместо тихого overwrite.
  const changedRemote = cloud !== null && (previous === null || previous !== cloudRevision);
  if (!force && !changedRemote && !shouldOfferCloud(local, cloud, Number(ls.get(KEY_DECLINED)) || 0)) {
    cloudDecided();
    return;
  }
  showCloudChoice(cloud!);
}

function cloudDecided(): void {
  onlineState.cloudReady = true;
  onlineState.cloudConflict = false;
  rememberCloudRevision();
  pendingPut = null;
  dirty = true;
  void receiveRewards();
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
    void keepLocal(cloud);
  }, FS.h3);
  yes.container.setName('cloudYes');
  no.container.setName('cloudNo');
  layer.add([shade, box, title, q, note, yes.container, no.container]);
  layer.once(Phaser.GameObjects.Events.DESTROY, () => {
    if (!answered) setTimeout(() => showCloudChoice(cloud), 300);
  });
  popIn(scene, layer, shade);
}

/** Осознанно оставили локальную игру: сохраняем общую историю выдачи, не восстанавливая уже потраченные награды. */
async function keepLocal(offered: CloudSaveInfo): Promise<void> {
  const cloud = await api.saveGet();
  if (!cloud) {
    onScene((s) => { toast(s, 'Не удалось связаться с облаком. Прогресс остаётся здесь.', C.error, 5000); askCloud(s, offered); });
    return;
  }
  await waitForBattle(); // После нажатия игрок успел войти в бой, пока шёл сетевой запрос.
  if (cloud.writeRevision !== offered.writeRevision) {
    resolveCloud(cloud, true);
    return;
  }
  const remote = (cloud.data as { online?: OnlineProgress }).online;
  const history = cloud.appliedGrantIds ?? (Array.isArray(remote?.appliedGrantIds) ? remote.appliedGrantIds.filter((id) => typeof id === 'string') : []);
  const appliedGrantIds = [...new Set([...onlineProgress().appliedGrantIds, ...history])];
  commit({ ...session.save, online: { ...onlineProgress(), appliedGrantIds } } as typeof session.save);
  ls.set(KEY_DECLINED, String(cloud.updatedAt));
  cloudDecided();
}

function readCloudRevision(): number | null {
  try {
    const o = JSON.parse(ls.get(KEY_CLOUD_REVISION) ?? 'null');
    return o?.id === onlineState.profile?.id && Number.isSafeInteger(o?.revision) ? o.revision : null;
  } catch { return null; }
}

function rememberCloudRevision(): void {
  ls.set(KEY_CLOUD_REVISION, JSON.stringify({ id: onlineState.profile?.id, revision: cloudRevision }));
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
  await waitForBattle(); // Резервируем уже завершённый локальный бой, затем меняем выбранную игру.
  const cloudData = d.data as Record<string, unknown>;
  const data = { ...cloudData, revision: (session.save.revision ?? 0) + 1,
    ...(d.appliedGrantIds ? { online: { ...(cloudData.online as Record<string, unknown> ?? {}), appliedGrantIds: d.appliedGrantIds } } : {}) };
  const textData = JSON.stringify(data);
  try {
    deserialize(textData);
  } catch (e) {
    const newer = (e as { kind?: string }).kind === 'newer_version';
    fail(newer ? 'Облачное сохранение — из более новой версии игры. Перезапустите игру, чтобы обновиться.' : 'Облачное сохранение повреждено — эта игра остаётся.');
    // Повреждённое/новое облако не затираем автоматически: локальная игра и резервная копия остаются.
    return;
  }
  const storage = new LocalStorageAdapter(SAVE_KEY);
  storage.backup(serialize(session.save), now());
  storage.save(textData);
  if (!storage.writable) {
    fail('Не удалось записать облачную игру на устройство. Текущая игра остаётся; освободите место и попробуйте снова.');
    return;
  }
  cloudRevision = d.writeRevision ?? cloudRevision;
  rememberCloudRevision();
  ls.set(KEY_LOCAL_AT, String(Date.now()));
  ls.set(KEY_DECLINED, String(d.updatedAt));
  if (typeof location !== 'undefined') location.reload();
}

// ---------- после записи: sync и облако ----------

function handleCommit(next: typeof session.save, prev: typeof session.save): void {
  dirty = true;
  ls.set(KEY_LOCAL_AT, String(Date.now()));
  scheduleCloud(); // Любая запись: письмо, прокачка и колокольчик тоже должны попасть в облако.
  const v = victoryOf(prev, next);
  if (!v) {
    // Улучшили героя или снаряжение (сила отряда изменилась), забрали сундук, отряд ушёл или вернулся — sync,
    // но не чаще раза в минуту (доска «Сила отряда» и сроки уведомлений бота).
    if (!onlineState.profile) return;
    if (syncPower(squadPower(next, GAME)) !== sentPower || timersChanged(sentTimers, notifyTimersOf(next, now(), GAME))) scheduleSync(true);
    return;
  }
  scheduleSync();
  scheduleCloud();
}

function readMvp(): WeekBest | null {
  if (onlineProgress().mvpWeek) return onlineProgress().mvpWeek!;
  try {
    const o = JSON.parse(ls.get(KEY_MVP) ?? 'null');
    return o && typeof o.week === 'string' && Number.isFinite(o.value) ? { week: o.week, value: o.value } : null;
  } catch {
    return null;
  }
}

function onlineProgress(): OnlineProgress {
  return (session.save as typeof session.save & { online?: OnlineProgress }).online ?? { appliedGrantIds: [] };
}

/** Вызывается после commit каждого результата охоты, включая зачёт ниже рекорда за всё время. */
export function recordMvpAttempt(score: number): void {
  const cur = readMvp();
  const next = nextMvpWeek(cur, isoWeek(new Date()), score);
  if (next === onlineProgress().mvpWeek) return;
  commit({ ...session.save, online: { ...onlineProgress(), mvpWeek: next } } as typeof session.save);
  scheduleSync();
}

/** Только после успешного сыгранного боя Башни. Resume/чтение run.floor само по себе зачётом не является. */
export function recordTowerProgress(floor: number): void {
  if (!Number.isFinite(floor) || floor <= 0) return;
  const progress = onlineProgress();
  const next = nextMvpWeek(progress.towerWeek ?? null, isoWeek(new Date()), Math.floor(floor));
  if (next === progress.towerWeek) return;
  commit({ ...session.save, online: { ...progress, towerWeek: next } } as typeof session.save);
  scheduleSync();
}

/** sync пачкой: после победы — через 2 с; не по победе (slow) — не раньше минуты после прошлого sync. */
function scheduleSync(slow = false): void {
  if (slow && syncTimer) return; // уже ждёт — отправит свежее состояние
  if (syncTimer) clearTimeout(syncTimer);
  const wait = slow ? syncDelay(Date.now(), lastSync, SYNC_DEBOUNCE_MS) : SYNC_DEBOUNCE_MS;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void doSync();
  }, wait);
}

async function doSync(keepalive = false): Promise<void> {
  if (!(await login()) || !onlineState.cloudReady) return;
  const save = session.save;
  const p = progressOf(save, GAME);
  const mvp = readMvp();
  const tower = onlineProgress().towerWeek;
  const week = isoWeek(new Date());
  // Та же «Мощь отряда», что на экране героев и на карте кампании (squadPower ядра, с экипировкой).
  const power = syncPower(squadPower(save, GAME));
  sentPower = power;
  lastSync = Date.now();
  const r = await api.sync({
    chapter: p.chapter,
    stage: p.stage,
    power,
    towerBest: save.tower.floor,
    towerWeek: tower?.week === week ? Math.floor(tower.value) : 0,
    towerWeekId: week,
    mvpWeek: mvp && mvp.week === week ? Math.round(mvp.value) : 0,
    mvpWeekId: week,
    ...notifyFields(),
  }, keepalive);
  if (r?.refRewarded) void receiveRewards();
  if (!r) { sentPower = -1; sentTimers = null; }
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
  void putCloud(keepalive); // Сворачивание обходит минутную задержку: это последняя возможность записать прогресс.
}

/** randomUUID появился позже getRandomValues (старые iOS WebView). ID — ключ retry, не авторизация. */
function cloudWriteId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function putCloud(keepalive: boolean): Promise<void> {
  if ((!dirty && !pendingPut) || !onlineState.cloudReady || putting) return;
  putting = true;
  lastPut = Date.now();
  try {
    const snapshot = pendingPut ?? { save: session.save, data: JSON.parse(serialize(session.save)), expectedRevision: cloudRevision, writeId: cloudWriteId() };
    pendingPut = snapshot;
    const result = await api.savePut(snapshot.data, snapshot.save.version, progressOf(snapshot.save, GAME).chapter, { expectedRevision: snapshot.expectedRevision, writeId: snapshot.writeId, keepalive });
    if (result?.status === 'saved') {
      cloudRevision = result.writeRevision;
      rememberCloudRevision();
      pendingPut = null;
      dirty = session.save !== snapshot.save;
    } else if (result) {
      // Локальный SaveSlot не трогаем. Новые действия продолжают писаться здесь; overwrite требует выбора.
      onlineState.cloudReady = false;
      onlineState.cloudConflict = true;
      pendingPut = null;
      emit();
      const latest = result.status === 'conflict' ? result.cloudSave : result.status === 'reward_history_conflict' ? await api.saveGet() : null;
      if (latest) resolveCloud(latest, true);
      onScene((s) => toast(s, result.status === 'upgrade_required'
        ? 'Для облака нужна новая версия игры. Перезапустите игру; прогресс сохраняется на этом устройстве.'
        : 'Облачная игра изменилась. Выберите, какой прогресс продолжить.', C.gold, 5000));
    }
  } finally {
    putting = false;
    if ((dirty || pendingPut) && onlineState.cloudReady) scheduleCloud();
  }
}

// ---------- колокольчики ----------

/** «Забрать колокольчики»: grants → ресурс + маркер одним commit. null — сеть/выбор облака ещё не готовы. */
export async function claimBells(): Promise<number | null> {
  const out = await receiveRewards(false);
  if (!out) return null;
  const n = out.bells;
  if (n > 0) haptic('reward');
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
  const s = game?.scene.getScenes(true).filter((x) => x.scene.key !== 'Boot' && x.scene.key !== 'Battle').pop();
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
  sentTimers = null;
  sentPower = -1;
  cloudRevision = 0;
  putting = false;
  claiming = null;
  pendingPut = null;
  if (rewardTimer) clearTimeout(rewardTimer);
  rewardTimer = null;
  lastSync = 0;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  if (putTimer) clearTimeout(putTimer);
  putTimer = null;
  onlineState.profile = null;
  onlineState.giftsWaiting = 0;
  onlineState.cloudReady = false;
  onlineState.cloudConflict = false;
  listeners.clear();
}
