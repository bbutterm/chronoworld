/**
 * Миграция сохранения v6 → v7 (герои v2, docs/design/heroes-v2.md, раздел 8.1). ЗАМОРОЖЕНА: не читает data/,
 * всё о старых шаблонах, новых героях и ветках — таблицы ниже (как было на момент v6), чтобы старое сохранение
 * читалось одинаково при любом будущем контенте. Получает сырой объект v6 (структура не гарантирована), возвращает
 * объект v7 (проверку делает SaveStateSchema). Шаг цепочки MIGRATIONS[6] (save/save.ts), после экспедиций
 * (MIGRATIONS[5], save/migrate-expeditions.ts).
 *
 * Что делает:
 * 1. 13 фиолетовых призывных шаблонов (герои Биолаборатории) → герой из 12 + ветка (по полу и классу, таблица
 *    OLD_TEMPLATES). Редкость, уровень и id экземпляра те же: отряд, пресеты, поручения и надетые вещи не ломаются.
 * 2. Сюжетные на фиолетовом и выше (прежняя фиксированная вторая профессия) получают ту же ветку (STORY_BRANCH).
 *    Первые призывные (Ирис, Мэйлин…) — без изменений (на фиолетовом без ветки — «Выберите ветку!»).
 * 3. Два экземпляра одного героя в отряде / пресете — остаётся сильнейший (редкость, затем уровень), слот второго
 *    пустеет. На поручениях дубли допустимы — не трогаем.
 * 4. Осколки сюжетных героев (save.shards, {герой: n}) → копии этого же героя: каждые 10 осколков (с округлением
 *    вверх) — зелёная копия, каждые 3 зелёные — синяя (так 20 осколков старого «зелёный → синий» = 2 зелёные копии
 *    нового правила, 30 = синяя). Копии — новые экземпляры ур. 1 с «Новый!».
 * 5. Таверна: summon.sinceBlue = 0, discovered — через таблицу, без дублей.
 * 6. Почта: у незабранных писем старые фиолетовые шаблоны в rewards.heroes → «Контракт героя» (heroPicks purple).
 * 7. Экспедиции в пути (bounties.active, снимок добычи): rewards.shards n → +n × 5 гемов (как при переходе
 *    поручений в экспедиции, SHARD_TO_GEMS), rewards.heroCards = { blue: 0, purple: 0 }.
 * 8. Лавка: слот осколков (kind shards, hero) → зелёная карта того же героя (kind heroCard) по той же цене.
 * 9. Сообщение игроку (notices) и подарок — 10 свитков, если хоть один экземпляр переведён (решение 9.6).
 */

/** Старый фиолетовый призывной шаблон → герой, ветка, имена для сообщения. */
const OLD_TEMPLATES: Record<string, { hero: string; branch: string; oldName: string; branchName: string }> = {
  seyren: { hero: 'alan', branch: 'knight', oldName: 'Сейрен Виндзор', branchName: 'Рыцарь' },
  randel: { hero: 'alan', branch: 'crusader', oldName: 'Рандел Лоуренс', branchName: 'Крестоносец' },
  cecil: { hero: 'meilin', branch: 'hunter', oldName: 'Сесиль Деймон', branchName: 'Охотница' },
  alphoccio: { hero: 'bran', branch: 'bard', oldName: 'Альфоччо Базиль', branchName: 'Бард' },
  trentini: { hero: 'meilin', branch: 'dancer', oldName: 'Трентини', branchName: 'Танцовщица' },
  kathryne: { hero: 'lira', branch: 'wizard', oldName: 'Кэтрин Кейрон', branchName: 'Волшебница' },
  celia: { hero: 'lira', branch: 'sage', oldName: 'Селия Альде', branchName: 'Мудрец' },
  eremes: { hero: 'dorn', branch: 'assassin', oldName: 'Эремес Гиль', branchName: 'Ассасин' },
  gertie: { hero: 'zara', branch: 'rogue', oldName: 'Герти Вай', branchName: 'Разбойница' },
  margaretha: { hero: 'vika', branch: 'priest', oldName: 'Маргарета Сорин', branchName: 'Жрица' },
  chen: { hero: 'teo', branch: 'monk', oldName: 'Чен Лю', branchName: 'Монах' },
  howard: { hero: 'otto', branch: 'blacksmith', oldName: 'Говард Альт-Айзен', branchName: 'Кузнец' },
  flamel: { hero: 'otto', branch: 'alchemist', oldName: 'Фламель Эмюль', branchName: 'Алхимик' },
};

/** Ветка сюжетных героев на фиолетовом и выше — та, что была их фиксированной формой в v5. */
const STORY_BRANCH: Record<string, string> = { alan: 'knight', bran: 'hunter', vika: 'priest', greta: 'blacksmith', dorn: 'rogue' };

/** 12 героев v6 и их имена (для сообщения). */
const HERO_NAMES: Record<string, string> = {
  alan: 'Алан',
  iris: 'Ирис',
  bran: 'Бран',
  meilin: 'Мэйлин',
  kai: 'Кай',
  lira: 'Лира',
  dorn: 'Дорн',
  zara: 'Зара',
  vika: 'Вика',
  teo: 'Тео',
  greta: 'Грета',
  otto: 'Отто',
};

const RARITIES = ['green', 'blue', 'purple', 'gold', 'red'];
const RARITY_NAMES: Record<string, string> = { green: 'зелёный', blue: 'синий', purple: 'фиолетовый', gold: 'золотой', red: 'красный' };
const rank = (r: unknown): number => Math.max(0, RARITIES.indexOf(String(r)));
const COMPENSATION_SCROLLS = 10;
const SHARDS_PER_GREEN = 10;
const GREENS_PER_BLUE = 3;
/** Гемов за осколок в снимке добычи экспедиции (как SHARD_TO_GEMS в save/migrate-expeditions.ts). */
const SHARD_TO_GEMS = 5;

const int = (v: unknown, min = 0): number => (Number.isInteger(v) && (v as number) >= min ? (v as number) : min);
const isRec = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Новый шаблон для старого id (неизвестный — как есть: sanitizeSave уберёт). */
function mapTemplate(id: unknown): string {
  const s = String(id);
  return OLD_TEMPLATES[s]?.hero ?? s;
}

export function migrateHeroesV2(old: any): any {
  const heroesIn: any[] = Array.isArray(old?.heroes) ? old.heroes : [];
  const moved: string[] = [];
  const heroes: any[] = heroesIn.map((h) => {
    if (!isRec(h)) return h;
    const from = OLD_TEMPLATES[String(h.templateId)];
    if (from) {
      moved.push(`${from.oldName} теперь ${HERO_NAMES[from.hero]}-${from.branchName} (${RARITY_NAMES[String(h.rarity)] ?? h.rarity}, ур. ${h.level})`);
      return { ...h, templateId: from.hero, branch: from.branch };
    }
    const story = STORY_BRANCH[String(h.templateId)];
    if (story && rank(h.rarity) >= rank('purple') && !h.branch) return { ...h, branch: story };
    return h;
  });

  // Осколки → копии того же героя (новые экземпляры).
  let maxId = 0;
  for (const h of heroes) {
    const m = /^h(\d+)$/.exec(String(h?.id));
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }
  const shardLines: string[] = [];
  const shardsIn = isRec(old?.shards) ? old.shards : {};
  for (const [tid, raw] of Object.entries(shardsIn)) {
    const n = int(raw);
    const hero = mapTemplate(tid);
    if (n <= 0 || !HERO_NAMES[hero]) continue;
    const greensTotal = Math.ceil(n / SHARDS_PER_GREEN);
    const blues = Math.floor(greensTotal / GREENS_PER_BLUE);
    const greens = greensTotal - blues * GREENS_PER_BLUE;
    for (let i = 0; i < blues; i++) heroes.push({ id: `h${++maxId}`, templateId: hero, rarity: 'blue', level: 1, isNew: true });
    for (let i = 0; i < greens; i++) heroes.push({ id: `h${++maxId}`, templateId: hero, rarity: 'green', level: 1, isNew: true });
    const parts = [blues ? `${blues} син.` : '', greens ? `${greens} зел.` : ''].filter(Boolean).join(' и ');
    shardLines.push(`${HERO_NAMES[hero]}: ${n} осколков → ${parts} копии`);
  }

  // Отряд и пресеты: один экземпляр героя — сильнейший.
  const byId = new Map<string, any>(heroes.filter(isRec).map((h) => [String(h.id), h]));
  const dedupe = (squad: unknown): unknown => {
    if (!Array.isArray(squad)) return squad;
    const best = new Map<string, any>();
    for (const id of squad) {
      const h = typeof id === 'string' ? byId.get(id) : undefined;
      if (!h) continue;
      const cur = best.get(h.templateId);
      if (!cur || rank(h.rarity) > rank(cur.rarity) || (h.rarity === cur.rarity && int(h.level) > int(cur.level))) best.set(h.templateId, h);
    }
    return squad.map((id) => {
      const h = typeof id === 'string' ? byId.get(id) : undefined;
      return h && best.get(h.templateId) !== h ? null : id;
    });
  };
  const squad = dedupe(old?.squad);
  const presets = Array.isArray(old?.presets) ? old.presets.map((p: any) => (isRec(p) ? { ...p, squad: dedupe(p.squad) } : p)) : old?.presets;

  // Таверна.
  const summon = isRec(old?.summon)
    ? {
        ...old.summon,
        sinceBlue: 0,
        discovered: Array.isArray(old.summon.discovered) ? [...new Set(old.summon.discovered.map(mapTemplate))] : old.summon.discovered,
      }
    : old?.summon;

  // Почта: незабранные старые фиолетовые шаблоны → «Контракт героя».
  const mail = isRec(old?.mail) && Array.isArray(old.mail.letters)
    ? {
        ...old.mail,
        letters: old.mail.letters.map((l: any) => {
          if (!isRec(l) || l.claimed || !isRec(l.rewards) || !Array.isArray(l.rewards.heroes)) return l;
          const oldOnes = l.rewards.heroes.filter((t: unknown) => OLD_TEMPLATES[String(t)]);
          if (!oldOnes.length) return l;
          const { heroes: hs, ...rest } = l.rewards;
          const keep = hs.filter((t: unknown) => !OLD_TEMPLATES[String(t)]);
          return {
            ...l,
            rewards: { ...rest, ...(keep.length ? { heroes: keep } : {}), heroPicks: [...(Array.isArray(rest.heroPicks) ? rest.heroPicks : []), ...oldOnes.map(() => ({ rarity: 'purple' }))] },
          };
        }),
      }
    : old?.mail;

  // Экспедиции в пути: осколки снимка добычи → гемы (5 за осколок, как save/migrate-expeditions.ts).
  const fixExpedition = (e: any) => {
    if (!isRec(e) || !isRec(e.rewards)) return e;
    const { shards, ...rest } = e.rewards;
    return { ...e, rewards: { ...rest, gems: int(rest.gems) + int(shards) * SHARD_TO_GEMS, heroCards: isRec(rest.heroCards) ? rest.heroCards : { blue: 0, purple: 0 } } };
  };
  const bounties = isRec(old?.bounties) && Array.isArray(old.bounties.active) ? { ...old.bounties, active: old.bounties.active.map(fixExpedition) } : old?.bounties;

  // Лавка: слот осколков → зелёная карта того же героя.
  const shop = isRec(old?.shop) && Array.isArray(old.shop.slots)
    ? {
        ...old.shop,
        slots: old.shop.slots.map((s: any) => {
          if (!isRec(s) || s.kind !== 'shards') return s;
          const hero = mapTemplate(s.hero);
          return { ...s, kind: 'heroCard', hero: HERO_NAMES[hero] ? hero : 'alan', rarity: 'green', count: 1 };
        }),
      }
    : old?.shop;

  const notices: string[] = [];
  const currency = isRec(old?.currency) ? { ...old.currency } : old?.currency;
  if (moved.length) {
    notices.push(
      `Герои обновлены: у каждого класса теперь парень и девушка, а вторая профессия — выбор на фиолетовом. ${moved.join('; ')}. В подарок — ${COMPENSATION_SCROLLS} свитков призыва.`,
    );
    if (isRec(currency)) currency.scrolls = int(currency.scrolls) + COMPENSATION_SCROLLS;
  }
  if (shardLines.length) notices.push(`Осколки героев стали копиями героев (для вознесения): ${shardLines.join('; ')}.`);

  const { shards: _s, ...rest } = old ?? {};
  return {
    ...rest,
    version: 7,
    heroes,
    squad,
    ...(presets !== undefined ? { presets } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(summon !== undefined ? { summon } : {}),
    ...(mail !== undefined ? { mail } : {}),
    ...(bounties !== undefined ? { bounties } : {}),
    ...(shop !== undefined ? { shop } : {}),
    ...(notices.length ? { notices: [...(Array.isArray(old?.notices) ? old.notices : []), ...notices] } : {}),
  };
}
