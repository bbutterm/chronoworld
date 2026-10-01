/**
 * Заглушка сервера cw-api для ручной проверки вне Telegram (?tgmock=1 в dev-сборке, api.ts mockMode): друзья,
 * колокольчики, рекорды недели — в памяти страницы, без сети. ?tgmock=cloud — ещё и «облачное сохранение»
 * (окно «Найдено облачное сохранение»). Ответы — в том же виде, что у настоящей функции.
 */

const FRIENDS = [
  { id: 101, name: 'Вика', chapter: 4, stage: 12, towerBest: 37, giftWaiting: true },
  { id: 102, name: 'Артём', chapter: 2, stage: 5, towerBest: 12, giftWaiting: true },
  { id: 103, name: 'Маргарита-Звёздная', chapter: 6, stage: 18, towerBest: 64, giftWaiting: false },
  { id: 104, name: 'Лёша', chapter: 1, stage: 9, towerBest: 3, giftWaiting: false },
  { id: 105, name: 'Ника', chapter: 3, stage: 2, towerBest: 21, giftWaiting: true },
];

const NAMES = ['Кира', 'Тимур', 'Соня', 'Глеб', 'Ульяна', 'Пётр', 'Злата', 'Даня', 'Ева', 'Марк', 'Лиза', 'Олег'];

const state = {
  sent: new Set<number>(),
  claimedBells: false,
  refClaimed: false,
};

const me = { id: 100, name: 'Вы' };

function board(kind: string, scope: string) {
  const base = kind === 'mvp' ? 1_800_000 : 70;
  const people =
    scope === 'friends'
      ? [...FRIENDS.map((f) => ({ name: f.name, value: kind === 'mvp' ? f.towerBest * 41_000 : f.towerBest })), { name: me.name, value: kind === 'mvp' ? 640_000 : 18 }]
      : [...NAMES.map((name, i) => ({ name, value: Math.round(base * (1 - i * 0.07)) })), ...FRIENDS.map((f) => ({ name: f.name, value: kind === 'mvp' ? f.towerBest * 41_000 : f.towerBest })), { name: me.name, value: kind === 'mvp' ? 640_000 : 18 }];
  people.sort((a, b) => b.value - a.value);
  const top = people.map((p, i) => ({ place: i + 1, name: p.name, value: p.value, me: p.name === me.name }));
  const mine = top.find((r) => r.me);
  return { ok: true, week: '2026-W40', top, mine: mine ? { place: mine.place, value: mine.value } : null };
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
