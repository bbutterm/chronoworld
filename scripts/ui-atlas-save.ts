/**
 * Сохранения для атласа экранов (scripts/ui-atlas.mjs): три игрока — new, mid, late. Печатает JSON:
 *   { saves: { new: { save, stageId, heroId, chapterId, label } … }, hints: [...] }
 *
 *   npx tsx scripts/ui-atlas-save.ts [--saves new,mid,late] [--now <мс>] > /tmp/atlas-saves.json
 *
 * new  — свежий игрок после обучения: стартовые герои + двое из Таверны, ур. 8, пройдены первые 7 этапов главы 1
 *        (Таверна открыта).
 * mid  — модель игрока (scripts/lib/player-model.ts) за 2 дня, прогресс откатан до 4-6 (герои ур. ~24, синие/фиолетовые, снаряжение).
 * late — как scripts/qa-save-late.ts по умолчанию: модель за 9 дней, откат к началу главы 6.
 *
 * Содержимое детерминировано (модель игрока и бои ядра — с seed); только часы сдвигаются на `--now` (по умолчанию — сейчас),
 * чтобы сундук, день и события выглядели как у живого игрока. seenUnlocks убирается — открытое отмечается показанным
 * (без баннеров «Новая функция!»). hints — все подсказки обучения (браузер кладёт их в localStorage «пройденными»).
 */
import { addHeroCard, maxLevelOf, newGame, placeInSquad, playStage, serialize, type SaveState } from '../src/core';
import { HINT_TEXT } from '../src/game/hints';
import { loadFullContext } from './lib/content-node';
import { runBalance } from './lib/player-model';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const WANT = arg('saves', 'new,mid,late').split(',');
const NOW = Number(arg('now', String(Date.now())));
const DAY_MS = 86_400_000;

const ctx = loadFullContext();
const chapters = ctx.content.chapters;
const orderOf = (chapterId: string) => chapters.find((c) => c.id === chapterId)?.order ?? 0;
/** Этапы в порядке кампании (глава по order, затем index). */
const route = [...ctx.content.stages].sort((a, b) => orderOf(a.chapter) - orderOf(b.chapter) || a.index - b.index);
const stageById = new Map(route.map((s) => [s.id, s]));

/** Оставить пройденными только этапы до (order, index) не включительно; прогресс сюжета позже — убрать. */
function rollBack(s: SaveState, order: number, index: number): SaveState {
  const keep = (id: string) => {
    const st = stageById.get(id);
    if (!st) return false;
    const o = orderOf(st.chapter);
    return o < order || (o === order && st.index < index);
  };
  const dropChapter = new Set(chapters.filter((c) => c.order > order || (c.order === order && index === 0)).map((c) => c.id));
  const sceneInfo = new Map(ctx.story.scenes.map((sc) => [sc.id, sc]));
  const findingStage = new Map(route.filter((st) => st.finding).map((st) => [st.finding as unknown as string, st.id]));
  return {
    ...s,
    campaign: { ...s.campaign, cleared: s.campaign.cleared.filter(keep) },
    seenScenes: s.seenScenes.filter((id) => {
      const sc = sceneInfo.get(id);
      if (!sc) return true;
      if (dropChapter.has(sc.chapter)) return false;
      return !sc.stageId || keep(sc.stageId);
    }),
    storyQueue: [],
    pendingChapterDone: undefined,
    findings: s.findings?.filter((f) => keep(findingStage.get(f) ?? '')),
    seenPages: s.seenPages?.filter((p) => !dropChapter.has(p.split(':')[1] ?? '')),
  };
}

/** Сдвиг часов сохранения на NOW (как в qa-save-late.ts): сундук копился 1 ч, «сегодня» — последний день модели. */
function rebase(s: SaveState, days: number): SaveState {
  const off = NOW - 3_600_000 - s.offline.lastClaimAt;
  const today = new Date(NOW - new Date(NOW).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const dayDiff = Math.round((Date.parse(today) - Date.parse(s.daily.day)) / DAY_MS);
  const TIME_KEYS = new Set(['lastClaimAt', 'startedAt', 'endsAt', 'claimedAt', 'openedAt', 'since', 'at']);
  const fix = (o: unknown, k?: string): unknown => {
    if (Array.isArray(o)) return o.map((v) => fix(v, k));
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([kk, v]) => [kk, fix(v, kk)]));
    if (typeof o === 'string' && /^\d{4}-\d\d-\d\d$/.test(o)) return new Date(Date.parse(o) + dayDiff * DAY_MS).toISOString().slice(0, 10);
    if (typeof o === 'number' && k && TIME_KEYS.has(k) && o > 0) return o + off;
    return o;
  };
  const { seenUnlocks: _drop, ...rest } = fix(s) as SaveState;
  return { ...rest, createdAt: NOW - days * DAY_MS } as SaveState;
}

/** Новичок: стартовые герои, двое из Таверны, первые 7 этапов главы 1 (бои ядра, seed — номер попытки). */
function newPlayer(): SaveState {
  let save = newGame(ctx, 1_700_000_000_000);
  for (const t of ['bran', 'lira']) {
    if (!ctx.content.heroes[t] || save.heroes.some((h) => h.templateId === t)) continue;
    const r = addHeroCard(save, t, ctx.content.heroes[t].baseRarity ?? 'green');
    save = { ...r.save, squad: placeInSquad(r.save.squad, r.hero, r.save, ctx) };
  }
  // Уровни — как после первых боёв и «Улучшить» из обучения.
  save = { ...save, heroes: save.heroes.map((h) => ({ ...h, level: Math.min(8, maxLevelOf(ctx, h.rarity)) })) };
  for (const st of route.filter((s) => orderOf(s.chapter) === 1).slice(0, 7)) {
    for (let seed = 1; seed <= 8; seed++) {
      const out = playStage(save, st.id, seed, ctx, 1_700_000_000_000 + seed * 60_000);
      save = out.save;
      if (out.result.winner === 'A') break;
    }
  }
  return save;
}

function describe(name: string, s: SaveState) {
  const next = route.find((st) => !s.campaign.cleared.includes(st.id)) ?? route[route.length - 1];
  const squad = s.squad.map((id) => s.heroes.find((h) => h.id === id)).filter((h) => !!h);
  const heroId = squad[0]?.id ?? s.heroes[0]?.id ?? '';
  const doneChapter = [...chapters]
    .sort((a, b) => b.order - a.order)
    .find((c) => route.filter((st) => st.chapter === c.id).every((st) => s.campaign.cleared.includes(st.id)));
  const label = `${name}: следующий этап ${orderOf(next.chapter)}-${next.index + 1} (${next.id}), героев ${s.heroes.length}, отряд ${squad.map((h) => `${h.templateId} ${h.rarity} ${h.level}`).join(', ')}`;
  process.stderr.write(label + '\n');
  return { save: serialize(s), stageId: next.id, heroId, chapterId: (doneChapter ?? chapters[0]).id, label };
}

const out: Record<string, ReturnType<typeof describe>> = {};
if (WANT.includes('new')) out.new = describe('new', rebase(newPlayer(), 1));
if (WANT.includes('mid')) out.mid = describe('mid', rebase(rollBack(runBalance(ctx, 2).save, 4, 5), 2));
if (WANT.includes('late')) out.late = describe('late', rebase(rollBack(runBalance(ctx, 9).save, 6, 0), 9));
process.stdout.write(JSON.stringify({ saves: out, hints: Object.keys(HINT_TEXT) }));
