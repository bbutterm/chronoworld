/**
 * Заглушка сервера cw-api для ручной проверки вне Telegram (?tgmock=1 в dev-сборке, api.ts mockMode): друзья,
 * колокольчики, доски рекордов — в памяти страницы, без сети. ?tgmock=cloud — ещё и «облачное сохранение»
 * (окно «Найдено облачное сохранение»). Ответы — в том же виде, что у настоящей функции.
 */

const FRIENDS = [
  { id: 101, name: 'Вика', chapter: 4, stage: 12, power: 48_350, towerBest: 37, giftWaiting: true },
  { id: 102, name: 'Артём', chapter: 2, stage: 5, power: 9_870, towerBest: 12, giftWaiting: true },
  { id: 103, name: 'Маргарита-Звёздная', chapter: 6, stage: 18, power: 1_254_300, towerBest: 64, giftWaiting: false },
  { id: 104, name: 'Лёша', chapter: 1, stage: 9, power: 2_140, towerBest: 3, giftWaiting: false },
  { id: 105, name: 'Ника', chapter: 3, stage: 2, power: 21_600, towerBest: 21, giftWaiting: true },
];

const NAMES = ['Кира', 'Тимур', 'Соня', 'Глеб', 'Ульяна', 'Пётр', 'Злата', 'Даня', 'Ева', 'Марк', 'Лиза', 'Олег-Длинноименный'];

const state = {
  sent: new Set<number>(),
  claimedBells: false,
  refClaimed: false,
};

const me = { id: 100, name: 'Алекс', chapter: 3, stage: 7, power: 18_420, towerBest: 18 };

interface Person {
  name: string;
  chapter: number;
  stage: number;
  power: number;
  towerBest: number;
}

const others: Person[] = NAMES.map((name, i) => ({
  name,
  chapter: Math.max(1, 10 - i),
  stage: 18 - ((i * 5) % 17),
  power: Math.round(3_400_000 * Math.pow(0.62, i)),
  towerBest: Math.round(70 * (1 - i * 0.07)),
}));

/** Значение на доске (как на сервере: прогресс — глава·100 + этап). */
function valueOf(kind: string, p: Person): number {
  if (kind === 'power') return p.power;
  if (kind === 'progress') return p.chapter * 100 + p.stage;
  if (kind === 'mvp') return p.towerBest * 41_000;
  return p.towerBest;
}

function board(kind: string, scope: string) {
  const people: Person[] = scope === 'friends' ? [...FRIENDS, me] : [...others, ...FRIENDS, me];
  const rows = people.map((p) => ({ p, value: valueOf(kind, p) })).sort((a, b) => b.value - a.value || b.p.power - a.p.power);
  const top = rows.map(({ p, value }, i) => ({ place: i + 1, name: p.name, value, me: p === me, chapter: p.chapter, stage: p.stage, power: p.power }));
  const mine = top.find((r) => r.me);
  const weekly = kind === 'tower' || kind === 'mvp';
  return {
    ok: true,
    board: kind,
    scope,
    week: weekly ? '2026-W40' : '',
    top,
    mine: mine ? { place: mine.place, value: mine.value, chapter: mine.chapter, stage: mine.stage, power: mine.power } : null,
  };
}

export async function mockCall(action: string, payload: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 250));
  const cloud = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tgmock') === 'cloud';
  switch (action) {
    case 'hello':
      return {
        ok: true,
        id: me.id,
        name: me.name,
        fresh: false,
        cloudSave: cloud ? { chapter: 4, save_version: 7, updated_at: new Date(Date.now() - 3 * 3600_000).toISOString() } : null,
        giftsWaiting: state.claimedBells ? 0 : FRIENDS.filter((f) => f.giftWaiting).length,
        refBonus: state.refClaimed ? 0 : 1,
      };
    case 'friends':
      return {
        ok: true,
        friends: FRIENDS.map((f) => ({ ...f, giftSent: state.sent.has(f.id), giftWaiting: f.giftWaiting && !state.claimedBells, lastSeen: new Date().toISOString() })),
      };
    case 'gift_send':
      state.sent.add(Number(payload.to));
      return { ok: true };
    case 'gift_claim': {
      const n = state.claimedBells ? 0 : FRIENDS.filter((f) => f.giftWaiting).length;
      state.claimedBells = true;
      return { ok: true, claimed: n };
    }
    case 'ref_claim': {
      const n = state.refClaimed ? 0 : 1;
      state.refClaimed = true;
      return { ok: true, claimed: n };
    }
    case 'board':
      return board(String(payload.board), String(payload.scope));
    case 'sync':
      return { ok: true, refRewarded: false };
    case 'save_put':
      return { ok: true };
    case 'save_get':
      return { ok: true, save: null };
    default:
      return { error: 'unknown_action' };
  }
}
