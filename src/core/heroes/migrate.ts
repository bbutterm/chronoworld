/**
 * Миграция сохранения v3 → v4 (герои-профессии → карточки героев, docs/design/heroes.md, раздел 6).
 * Не зависит от текущего data/: всё, что нужно о старых профессиях и карточках, заморожено здесь (как было на момент v4),
 * чтобы старое сохранение читалось одинаково при любом будущем контенте. Получает сырой объект v3 (структура не
 * гарантирована), возвращает объект v4 (проверку делает SaveStateSchema).
 */

/** Сюжетные карточки по порядку (hero1…hero5). */
const STORY = ['alan', 'bran', 'vika', 'greta', 'dorn'] as const;

/** Имена героев старых сохранений → сюжетная карточка (Бэлла и Вик — прежние стартовые, Грег — прежняя Грета). */
const NAME_TO_CARD: Record<string, string> = {
  Алан: 'alan',
  Бран: 'bran',
  Бэлла: 'bran',
  Вика: 'vika',
  Вик: 'vika',
  Грета: 'greta',
  Грег: 'greta',
  Дорн: 'dorn',
};

/** Линия (первая профессия ветки) старых профессий; Новичок — null. */
const JOB_LINE: Record<string, string | null> = {
  novice: null,
  swordman: 'swordman',
  knight: 'swordman',
  crusader: 'swordman',
  mage: 'mage',
  wizard: 'mage',
  sage: 'mage',
  archer: 'archer',
  hunter: 'archer',
  bard: 'archer',
  acolyte: 'acolyte',
  priest: 'acolyte',
  monk: 'acolyte',
  merchant: 'merchant',
  blacksmith: 'merchant',
  alchemist: 'merchant',
  thief: 'thief',
  assassin: 'thief',
  rogue: 'thief',
};

/** Линия сюжетных карточек и их название класса (для сообщения «Алан теперь Мечник»). */
const CARD_LINE: Record<string, { line: string; className: string; name: string }> = {
  alan: { line: 'swordman', className: 'Мечник', name: 'Алан' },
  bran: { line: 'archer', className: 'Лучник', name: 'Бран' },
  vika: { line: 'acolyte', className: 'Аколит', name: 'Вика' },
  greta: { line: 'merchant', className: 'Торговка', name: 'Грета' },
  dorn: { line: 'thief', className: 'Вор', name: 'Дорн' },
};

/** Лишние герои (шестой и дальше, несюжетные имена без свободной сюжетной карточки) → призывная карточка своей линии. */
const LINE_CARD: Record<string, string> = { swordman: 'iris', archer: 'meilin', acolyte: 'teo', mage: 'kai', merchant: 'otto', thief: 'zara' };

/** Пределы уровня редкостей v4 и кривая стоимости уровня (data/cards.json на момент v4). */
const CAPS: [string, number][] = [
  ['green', 20],
  ['blue', 40],
  ['purple', 60],
];
const levelExp = (l: number) => Math.max(1, Math.floor(100 * Math.pow(l, 1.5)));

const int = (v: unknown, min = 0): number => (Number.isInteger(v) && (v as number) >= min ? (v as number) : min);

/** Этап, после которого открывается Таверна (summon.json на момент v4), и её подарок. */
const TAVERN_STAGE = 'ch1_s5';
const WELCOME = { gems: 150, scrolls: 1 };

export function migrateV3toV4(old: any): any {
  const heroesIn: any[] = Array.isArray(old?.heroes) ? old.heroes : [];
  const used = new Set<string>();
  const notices: string[] = [];
  const changed: string[] = [];
  let pool = int(old?.resources?.heroExp);

  // 1) Сюжетные — по имени; 2) остальные — свободная сюжетная по порядку; 3) лишние — призывная карточка линии.
  const cardOf = new Map<number, string>();
  heroesIn.forEach((h, i) => {
    const card = NAME_TO_CARD[String(h?.name ?? '')];
    if (card && !used.has(card)) {
      cardOf.set(i, card);
      used.add(card);
    }
  });
  heroesIn.forEach((h, i) => {
    if (cardOf.has(i)) return;
    const free = STORY.find((c) => !used.has(c));
    if (free) {
      cardOf.set(i, free);
      used.add(free);
    } else cardOf.set(i, LINE_CARD[JOB_LINE[String(h?.job)] ?? 'swordman'] ?? 'iris');
  });

  const heroes = heroesIn.map((h, i) => {
    const templateId = cardOf.get(i)!;
    const job = String(h?.job ?? 'novice');
    const history: any[] = Array.isArray(h?.jobHistory) ? h.jobHistory : [];
    const jobLevel = int(h?.jobLevel, 1);
    // Ранг профессии: второй — если профессия второго круга или в истории две записи.
    const second = !['novice', 'swordman', 'mage', 'archer', 'acolyte', 'merchant', 'thief'].includes(job) && (job in JOB_LINE || history.length >= 2);
    // Тот же уровень; редкость — самая низкая, чей предел его вмещает (первая профессия — не выше синей,
    // вторая — фиолетовая, как вторая форма сюжетной карточки). Уровни сверх предела — опытом в пул.
    let level = second ? 40 + jobLevel : jobLevel;
    const [rarity, maxLevel] = second ? CAPS[2] : level <= CAPS[0][1] ? CAPS[0] : CAPS[1];
    if (level > maxLevel) {
      for (let l = maxLevel; l < level; l++) pool += levelExp(l);
      level = maxLevel;
    }
    pool += int(h?.jobExp) + int(h?.bankedExp);
    const story = CARD_LINE[templateId];
    const line = JOB_LINE[job];
    if (story && line && line !== story.line) changed.push(`${story.name} теперь ${story.className}`);
    const out: any = { id: String(h?.id), templateId, rarity, level };
    return out;
  });

  // Отряд: второй экземпляр той же карточки (лишние герои одной линии) — из отряда.
  const templateOfId = new Map(heroes.map((h) => [h.id, h.templateId]));
  const inSquad = new Set<string>();
  const squad = Array.isArray(old?.squad)
    ? old.squad.map((id: any) => {
        if (typeof id !== 'string') return id ?? null;
        const t = templateOfId.get(id);
        if (!t) return id;
        if (inSquad.has(t)) return null;
        inSquad.add(t);
        return id;
      })
    : old?.squad;

  const cleared: unknown[] = Array.isArray(old?.campaign?.cleared) ? old.campaign.cleared : [];
  const tavern = cleared.includes(TAVERN_STAGE);
  const gems = int(old?.currency?.gems) + (tavern ? WELCOME.gems : 0);
  const scrolls = int(old?.currency?.scrolls) + 1 + (tavern ? WELCOME.scrolls : 0);
  notices.push(
    'Обновление: герои стали карточками, как в AFK. Уровни сохранены, опыт собран в общий запас («Улучшить» на карточке). В подарок — свиток призыва.' +
      (tavern ? ' Таверна уже открыта: там ждут гемы и ещё один свиток.' : ''),
  );
  if (changed.length) notices.push(`Классы сюжетных героев теперь постоянные: ${changed.join(', ')}.`);

  const { heroes: _h, ...rest } = old ?? {};
  const counters = { ...(old?.achievements?.counters ?? {}) };
  if (Number.isInteger(counters.hero_max_job_level)) {
    counters.hero_max_level = Math.max(int(counters.hero_max_level), counters.hero_max_job_level);
    delete counters.hero_max_job_level;
  }
  return {
    ...rest,
    version: 4,
    heroes,
    squad,
    resources: { ...(old?.resources ?? {}), gold: int(old?.resources?.gold), heroExp: pool },
    currency: { ...(old?.currency ?? {}), gems, scrolls },
    ...(old?.achievements ? { achievements: { ...old.achievements, counters } } : {}),
    shards: old?.shards ?? {},
    summon: old?.summon ?? {
      seq: 0,
      total: 0,
      sincePurple: 0,
      firstTenDone: false,
      welcomeGiven: tavern,
      discovered: [...new Set(heroes.map((h) => h.templateId))],
    },
    notices: [...(Array.isArray(old?.notices) ? old.notices : []), ...notices],
  };
}
