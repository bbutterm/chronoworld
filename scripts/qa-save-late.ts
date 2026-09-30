/**
 * QA: сохранение «опытный игрок в поздней игре» для ручного/браузерного прогона глав 6–10 и меты.
 *
 *   npx tsx scripts/qa-save-late.ts [--day 9] [--from 6] [--out save.json] [--old-route]
 *
 * 1. Модель игрока (scripts/lib/player-model.ts → runBalance) играет `--day` дней (по умолчанию 9: отряд модели как раз
 *    входит в главу 6 — 5 фиолетовых ур. ~48, мощь ~11 тыс.).
 * 2. Прогресс кампании «откатывается» к началу главы с номером `--from` (order главы): пройденные этапы, увиденные сцены,
 *    находки, страницы «Эпизод/Летопись» этих глав и очередь сюжета убираются — игрок как будто только что дошёл до главы.
 *    Герои, снаряжение, валюта, Башня, экспедиции остаются как у модели.
 * 3. Часы и даты сдвигаются на «сейчас»: сундук копился 1 ч, «сегодня» — последний игровой день модели, аккаунту `--day` дней.
 * 4. Баннеры «Новая функция!» для уже открытого не всплывут (seenUnlocks убирается — sanitizeSave отметит открытое показанным).
 *
 * `--old-route` — дополнительно сохранение «старого маршрута» для проверки писем world_changed_*: пройдены главы 1–8 и 10
 * до ch10_s6, глава 9 не пройдена, письма не доставлены (как у игрока, начавшего до главы 9).
 *
 * Положить в браузер: localStorage.setItem('chronoworld.save.v1', <файл>) до загрузки игры (как в scripts/e2e.mjs), затем reload.
 * В stderr — сводка: этапы, отряд, мощь, валюта.
 */
import { writeFileSync } from 'node:fs';
import { serialize, squadPower, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';
import { runBalance } from './lib/player-model';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DAY = Number(arg('day', '9'));
const FROM = Number(arg('from', '6'));
const OUT = arg('out', '');
const OLD_ROUTE = process.argv.includes('--old-route');

const ctx = loadFullContext();
const res = runBalance(ctx, DAY);
let save: SaveState = res.save;

const chapters = ctx.content.chapters;
const orderOf = (chapterId: string) => chapters.find((c) => c.id === chapterId)?.order ?? 0;
const stageChapter = new Map(ctx.content.stages.map((s) => [s.id, s.chapter]));

/** Убрать прогресс глав, для которых drop(order) = true. */
function rollBack(s: SaveState, drop: (order: number) => boolean): SaveState {
  const dropStage = (id: string) => drop(orderOf(stageChapter.get(id) ?? ''));
  const dropChapter = new Set(chapters.filter((c) => drop(c.order)).map((c) => c.id));
  const sceneChapter = new Map(ctx.story.scenes.map((sc) => [sc.id, sc.chapter]));
  const findingStage = new Map(ctx.content.stages.filter((st) => st.finding).map((st) => [st.finding as unknown as string, st.id]));
  return {
    ...s,
    campaign: { cleared: s.campaign.cleared.filter((id) => !dropStage(id)) },
    seenScenes: s.seenScenes.filter((id) => !dropChapter.has(sceneChapter.get(id) ?? '')),
    storyQueue: [],
    pendingChapterDone: undefined,
    findings: s.findings?.filter((f) => !dropStage(findingStage.get(f) ?? '')),
    seenPages: s.seenPages?.filter((p) => !dropChapter.has(p.split(':')[1] ?? '')),
  };
}

save = rollBack(save, (order) => order >= FROM);

/** Сдвиг времени модели на «сейчас» (как qa-late/rebase.py ночного тестера). */
function rebase(s: SaveState, days: number): SaveState {
  const now = Date.now();
  const off = now - 3_600_000 - s.offline.lastClaimAt;
  const today = new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const dayDiff = Math.round((Date.parse(today) - Date.parse(s.daily.day)) / 86_400_000);
  const TIME_KEYS = new Set(['lastClaimAt', 'startedAt', 'endsAt', 'claimedAt', 'openedAt', 'since', 'at']);
  const fix = (o: unknown, k?: string): unknown => {
    if (Array.isArray(o)) return o.map((v) => fix(v, k));
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([kk, v]) => [kk, fix(v, kk)]));
    if (typeof o === 'string' && /^\d{4}-\d\d-\d\d$/.test(o)) return new Date(Date.parse(o) + dayDiff * 86_400_000).toISOString().slice(0, 10);
    if (typeof o === 'number' && k && TIME_KEYS.has(k) && o > 0) return o + off;
    return o;
  };
  const out = fix(s) as SaveState;
  const { seenUnlocks: _drop, ...rest } = out;
  return { ...rest, createdAt: now - days * 86_400_000 } as SaveState;
}

save = rebase(save, DAY);

if (OLD_ROUTE) {
  // Игрок старого маршрута: всё до ch10_s6 пройдено, кроме главы 9; письма world_changed_* ещё не доставлены.
  const ch10 = ctx.content.stages.filter((s) => orderOf(s.chapter) === 10).map((s) => s.id);
  const upTo = ch10.slice(0, ch10.indexOf('ch10_s6') + 1);
  const all = ctx.content.stages.filter((s) => orderOf(s.chapter) < 9).map((s) => s.id);
  save = {
    ...save,
    campaign: { cleared: [...all, ...upTo] },
    mail: { ...save.mail, delivered: save.mail.delivered.filter((d) => !d.startsWith('world_changed')) },
    seenScenes: [...new Set([...save.seenScenes, ...ctx.story.scenes.filter((sc) => orderOf(sc.chapter) !== 9 && orderOf(sc.chapter) <= 10).map((sc) => sc.id)])],
  };
}

const last = save.campaign.cleared.at(-1);
process.stderr.write(
  `день ${DAY}, откат с главы ${FROM}${OLD_ROUTE ? ', старый маршрут' : ''}: пройдено ${save.campaign.cleared.length}, последний ${last}\n` +
    `мощь ${squadPower(save, ctx)} · золото ${save.resources.gold} · опыт ${save.resources.heroExp} · гемы ${save.currency.gems} · ` +
    `свитки ${save.currency.scrolls} · руда ${save.currency.blessedOre ?? 0} · Башня ${save.tower.floor}\n` +
    `отряд: ${save.squad
      .map((id) => save.heroes.find((h) => h.id === id))
      .filter(Boolean)
      .map((h) => `${h!.templateId}${h!.branch ? '/' + h!.branch : ''} ${h!.rarity} ур.${h!.level}`)
      .join(', ')}\n` +
    `героев ${save.heroes.length}, предметов ${save.inventory.items.length}\n`,
);
const text = serialize(save);
if (OUT) writeFileSync(OUT, text);
else process.stdout.write(text);
