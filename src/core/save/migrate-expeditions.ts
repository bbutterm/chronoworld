/**
 * Миграция сохранения v5 → v6: доска поручений (K9) заменена экспедициями по локациям (meta/expeditions.ts).
 *
 * Отдельная функция цепочки MIGRATIONS (save.ts, шаг 5). Если понадобится ещё одна миграция (например, героев), она
 * добавляется следующим шагом MIGRATIONS[6] (v6 → v7) и SAVE_VERSION = 7, эту функцию не меняя; если два шага
 * приходится выпустить одной версией — композиция `5: (old) => другойШаг(migrateBountiesToExpeditions(old))`
 * (поле version каждый шаг выставляет сам — последний выигрывает).
 *
 * Что делает (ядро без контекста — только данные сохранения):
 * - ключ `bounties` остаётся (исторический, как id функции в data/unlocks.json и счётчик bounties_done), форма новая:
 *   `{ active: [] }` — доска, дневные обновления и поручения в работе убираются, все герои свободны;
 * - награда всех поручений в работе (и завершённых, и нет — времени миграция не знает) сохраняется письмом в почте
 *   «Поручения стали экспедициями»: золото, гемы, опыт в общий пул; осколки конвертируются в гемы (SHARD_TO_GEMS
 *   за осколок — у письма нет осколков, а «отстающего» героя без контента не выбрать);
 * - и одно сообщение игроку (notices → предупреждение при загрузке).
 * Поручений в работе не было — без письма и сообщения. Счётчик достижений bounties_done не меняется.
 */
import { DayStringSchema, DEFAULT_DAY, emptyMail, type Letter } from './schema';

/** Гемов за осколок старого поручения (письмо не умеет осколки). */
export const SHARD_TO_GEMS = 5;

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isRecord = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function migrateBountiesToExpeditions(old: any): any {
  const bounties = isRecord(old?.bounties) ? old.bounties : {};
  const active: unknown[] = Array.isArray(bounties.active) ? bounties.active : [];
  const sum = { gold: 0, jobExp: 0, gems: 0, shards: 0 };
  for (const b of active) {
    const r = isRecord(b) && isRecord(b.rewards) ? b.rewards : {};
    sum.gold += int(r.gold);
    sum.jobExp += int(r.jobExp);
    sum.gems += int(r.gems);
    sum.shards += int(r.shards);
  }
  const out: any = { ...old, version: 6, bounties: { active: [] } };
  if (!active.length) return out;

  const gems = sum.gems + sum.shards * SHARD_TO_GEMS;
  const rewards: Letter['rewards'] = {};
  if (sum.gold) rewards.gold = sum.gold;
  if (gems) rewards.gems = gems;
  if (sum.jobExp) rewards.jobExp = sum.jobExp;
  const mail = isRecord(old?.mail) && Array.isArray(old.mail.letters) ? old.mail : emptyMail();
  const day = DayStringSchema.safeParse(bounties.lastRefreshDay).success ? bounties.lastRefreshDay : DEFAULT_DAY;
  if (Object.keys(rewards).length) {
    const seq = int(mail.seq) + 1;
    const letter: Letter = {
      id: `m${seq}`,
      from: 'Гильдия искателей',
      title: 'Поручения стали экспедициями',
      body:
        'Доску поручений сменили экспедиции: выберите локацию и срок — отряд соберётся сам одним нажатием. ' +
        `Ваши герои вернулись с поручений (${active.length}), вот их награда целиком` +
        (sum.shards ? ` (осколки — гемами, ${SHARD_TO_GEMS} за осколок).` : '.'),
      day,
      rewards,
      read: false,
      claimed: false,
    };
    out.mail = { ...mail, seq, letters: [letter, ...mail.letters] };
  }
  out.notices = [
    ...(Array.isArray(old?.notices) ? old.notices : []),
    `Поручения заменены экспедициями. Герои вернулись, награда за начатые поручения (${active.length}) — в почте.`,
  ];
  return out;
}
