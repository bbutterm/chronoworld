import { AutobattlerSaveSchema, type AutobattlerState } from './schema';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const safeCounter = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
const validDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Repair optional arena data before the campaign schema is parsed. Never discard a daily receipt. */
export function recoverAutobattlerState(raw: unknown, recoveryDay?: string): { state: AutobattlerState; warning?: string } {
  const source = record(raw) ? raw : {};
  const completeReceipt = (source.rewardDay !== undefined) === (source.rewardWins !== undefined);
  const parsed = AutobattlerSaveSchema.safeParse(raw);
  if (parsed.success && completeReceipt) return { state: parsed.data };
  const { run: _run, last: _last, ...ledger } = source;
  const persistent = AutobattlerSaveSchema.safeParse(ledger);
  if (persistent.success && completeReceipt) {
    const state = { ...persistent.data, seq: Math.max(persistent.data.seq, safeCounter(record(source.run) ? source.run.id : 0), safeCounter(record(source.last) ? source.last.runId : 0)) };
    const last = AutobattlerSaveSchema.shape.last.safeParse(source.last);
    if (last.success && last.data) state.last = last.data;
    return { state, warning: 'Повреждённый матч Арены завершён. Прогресс кампании и награда дня сохранены.' };
  }
  // Unknown receipt data cannot be treated as an unused reward. The caller supplies its UTC day;
  // without a clock, protect future rewards until a valid backup is restored.
  const days = [recoveryDay, source.rewardDay, record(source.run) ? source.run.day : undefined].filter(validDay);
  const day = validDay(recoveryDay) ? days.sort().at(-1)! : '9999-12-31';
  return {
    state: {
      seq: Math.max(safeCounter(source.seq), safeCounter(record(source.run) ? source.run.id : 0), safeCounter(record(source.last) ? source.last.runId : 0)),
      bestWins: Math.min(12, safeCounter(source.bestWins)),
      completed: safeCounter(source.completed),
      rewardDay: day,
      rewardWins: 12,
    },
    warning: validDay(recoveryDay)
      ? 'Данные Арены восстановлены без изменения кампании. Награда дня закрыта, поскольку её прежний учёт повреждён.'
      : 'Данные Арены восстановлены без изменения кампании. Для восстановления наград нужна исправная резервная копия.',
  };
}
