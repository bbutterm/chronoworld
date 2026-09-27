/**
 * content:check, раздел 8 — карточки героев (data/heroes) и Таверна (data/summon.json). Чистая функция: тест
 * tests/content-check-heroes.test.ts подаёт ей контекст и реестр листов.
 *
 * Ошибки (✗, сломанные ссылки):
 *   - summon-карточка, которая никогда не выпадет: её baseRarity нет ни в одной редкости Таверны с шансом > 0
 *     (rates[].baseRarities) или maxRarity ниже всех таких редкостей;
 *   - visual.sprite карточки/формы задан, но итоговый лист не найден нигде (ни свой, ни лист класса) — в бою плейсхолдер;
 *   - у листа указан портрет, а файла нет (проверяется в разделе 3 content-check.ts вместе с листами).
 * Предупреждения (⚠, не хватает арта):
 *   - своего листа карточки (visual.sprite) нет в реестре — откат на лист класса;
 *   - лист класса не того пола (откат на базовый лист);
 *   - у итогового листа нет портрета — рамка героя берёт кадр листа (docs/ART_REQUEST_HEROES.md);
 *   - visual.portrait задан: игра его не читает (портрет берётся по листу).
 * Навыки карточек (существуют, своя линия, уровни, различие карточек класса) — validateHeroes ядра: ошибки в сборке (п. 1),
 * предупреждения — здесь же (validateHeroes(content, [], warnings)).
 */
import { rarityIndex, validateHeroes, type GameContext, type HeroState } from '../../src/core';
import { heroSprite } from '../../src/game/flow';
import type { SpriteDef } from '../../src/pipeline/sprites';

export interface HeroLintResult {
  errors: string[];
  warnings: string[];
  /** Листы, которые используют карточки (для проверки файлов листов, раздел 3). */
  sprites: Set<string>;
}

/**
 * ctx — собранный контекст; registry — реестр листов (buildRegistry); sheetGender — пол листа v2 ('m' | 'f') по id.
 */
export function lintHeroes(ctx: GameContext, registry: Record<string, SpriteDef>, sheetGender: Record<string, string | undefined>): HeroLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sprites = new Set<string>();
  const has = (id: string) => id in registry;
  validateHeroes(ctx.content, [], warnings);

  const fallbacks: string[] = [];
  const noPortrait = new Map<string, string[]>();
  for (const t of Object.values(ctx.content.heroes)) {
    const own = [t.visual.sprite, ...t.forms.map((f) => f.visual.sprite)].filter((x): x is string => !!x);
    for (const id of own) {
      if (!has(id)) warnings.push(`карточка ${t.id}: листа "${id}" нет в реестре — будет лист класса`);
      else sprites.add(id);
    }
    if (t.visual.portrait) warnings.push(`карточка ${t.id}: visual.portrait игрой не используется — портрет берётся по листу (assets/sprites/sprites.json → portrait)`);
    for (const r of [t.baseRarity, ...t.forms.map((f) => f.rarity)]) {
      const hero: HeroState = { id: 'check', templateId: t.id, rarity: r, level: 1 };
      const label = `${t.id}${r === t.baseRarity ? '' : ` (${r})`}`;
      const sprite = heroSprite(hero, ctx, has);
      const def = registry[sprite];
      if (!def) {
        errors.push(`карточка ${label}: лист "${sprite}" не найден ни своим, ни листом класса — в бою будет плейсхолдер (visual.sprite / data/jobs → visual.sprite)`);
        continue;
      }
      sprites.add(sprite);
      const g = sheetGender[sprite];
      if (g && g !== t.gender) fallbacks.push(`${label} → ${sprite}`);
      if (!def.portrait) noPortrait.set(sprite, [...(noPortrait.get(sprite) ?? []), label]);
    }
  }
  if (fallbacks.length) warnings.push(`карточки без листа своего пола (откат на лист класса, арт — docs/ART_REQUEST_HEROES.md): ${fallbacks.join(', ')}`);
  if (noPortrait.size) {
    const list = [...noPortrait].map(([s, who]) => `${s} (${who.join(', ')})`).join('; ');
    warnings.push(`листы карточек без портрета — в рамке будет кадр листа: ${list}`);
  }

  // Таверна: пул собирается сам по source/baseRarity/maxRarity — ловим карточки, которые не выпадут никогда.
  const live = ctx.summon.rates.filter((r) => r.chance > 0);
  for (const t of Object.values(ctx.content.heroes)) {
    if (t.source !== 'summon') continue;
    const drops = live.some((r) => r.baseRarities.includes(t.baseRarity) && rarityIndex(t.maxRarity) >= rarityIndex(r.rarity));
    if (!drops) {
      const rates = live.map((r) => `${r.rarity}: ${r.baseRarities.join('/')}`).join(', ');
      errors.push(`карточка ${t.id}: призывная (baseRarity ${t.baseRarity}, maxRarity ${t.maxRarity}), но Таверна её не выдаёт — data/summon.json → rates (${rates})`);
    }
  }
  return { errors, warnings, sprites };
}
