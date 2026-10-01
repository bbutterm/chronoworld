/** Отряды для съёмки: ульты, которыми хвастаемся (шаблон/ветка). */
export const SQUADS: Record<string, string[]> = {
  // Магнум Брейк, Великая снежная буря, Великий Магнус, Владыка Вермилиона, Поле клейморов
  storm: ['alan', 'lira/wizard', 'vika/priest', 'kai/wizard', 'bran/hunter'],
  // Удар Асуры, Двойной Боулинг Баш, Соколиный шквал, Кирие, Соник блоу
  asura: ['vika/monk', 'iris/knight', 'meilin/hunter', 'teo/priest', 'zara/assassin'],
};

/** Все 36 форм (12 героев × первая профессия и две ветки) — проверка, что ульта каждой читается в кадре боя. */
const FORMS: Record<string, [string, string]> = {
  alan: ['knight', 'crusader'], bran: ['hunter', 'bard'], dorn: ['assassin', 'rogue'], greta: ['blacksmith', 'alchemist'],
  iris: ['knight', 'crusader'], kai: ['wizard', 'sage'], lira: ['wizard', 'sage'], meilin: ['hunter', 'dancer'],
  otto: ['blacksmith', 'alchemist'], teo: ['priest', 'monk'], vika: ['priest', 'monk'], zara: ['assassin', 'rogue'],
};
const ALL_FORMS = [0, 1, 2].flatMap((f) => Object.entries(FORMS).map(([t, b]) => (f ? `${t}/${b[f - 1]}` : t)));
/** Окно из 5 подряд при периоде 12 — герои в отряде не повторяются (PROMO_AUDIT=1 для saves.ts). */
export const AUDIT: Record<string, string[]> = Object.fromEntries(
  Array.from({ length: Math.ceil(ALL_FORMS.length / 5) }, (_, i) => [`audit${i + 1}`, ALL_FORMS.slice(i * 5, i * 5 + 5)]),
);
