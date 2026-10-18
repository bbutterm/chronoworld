import type { CodesConfig } from './schema';

/** Только для динамического import внутри import.meta.env.DEV. Не экспортируется из публичного core. */
export function withLabCodes(config: CodesConfig): CodesConfig {
  return { codes: [...config.codes, { code: '300', once: false, gems: 300, scrolls: 0, gold: 0, hours: 0 }, { code: '12', once: false, gems: 0, scrolls: 0, gold: 0, hours: 12 }] };
}
