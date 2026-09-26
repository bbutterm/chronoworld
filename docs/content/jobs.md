# Профессии (джобы)

Герой игрока = профессия + джоб-уровень + история пройденных профессий. Профессии — JSON в `data/jobs/`, навыки профессий — `data/skills/job_<профессия>_<название>.json`. Схема — `JobSchema` в `src/core/progression/schema.ts`, правила перехода — `data/progression.json`. Все числа — заглушки, баланса нет.

## Дерево

```
Новичок (novice, tier 0, джоб 1–10)
├─ Мечник   (swordman) ─┬─ Рыцарь      (knight)
│                       └─ Крестоносец (crusader)
├─ Аколит   (acolyte)  ─┬─ Жрец        (priest)
│                       └─ Монах       (monk)
├─ Маг      (mage)     ─┬─ Волшебник   (wizard)
│                       └─ Мудрец      (sage)
├─ Лучник   (archer)   ─┬─ Охотник     (hunter)
│                       └─ Бард        (bard)
├─ Вор      (thief)    ─┬─ Ассасин     (assassin)
│                       └─ Разбойник   (rogue)
└─ Торговец (merchant) ─┬─ Кузнец      (blacksmith)
                        └─ Алхимик     (alchemist)
```

tier 1 и tier 2 — джоб 1–50. Переход на tier 1 — с джоба 10 Новичка, на tier 2 — с джоба 50 первой профессии (`progression.json → jobChange.tierLevel`); после смены джоб-уровень сбрасывается в 1 (`resetJobLevel`).

## Навыки

- `skills: [{ "jobLevel": 20, "skill": "job_mage_frost_diver" }]` — навык открывается, когда герой достигает этого джоб-уровня. На одном уровне — один навык.
- У каждой профессии tier 1–2 сейчас 5 навыков: на джобах 1, 10, 20, 30, 40 (активные и пассивные вперемешку).
- Навык **без** `trigger` — активный. Ультой героя становится **последний открытый** активный навык (срабатывает на 100 энергии).
- Навык **с** `trigger` (`battleStart`, `turnStart`, `hit`, `kill`, `allyDeath`) — пассивка; работают все открытые.
- Если `keepSkillsOnJobChange: true`, навыки прошлых профессий (до уровня, на котором с них ушли) остаются у героя.
- Обычная атака — `basic` профессии: `basic_melee` (ближний бой), `basic_ranged` (дальний, нужен `visual.projectile`), `basic_heal` (лекари).
- Статы: `baseStats + growth × (джоб − 1)`. База tier 2 ≈ статы профессии tier 1 на джобе ~30.

## Как добавить профессию

1. Скопировать похожую: `data/jobs/knight.json` → `data/jobs/<id>.json`, поменять `id`, `name`, `description`.
2. Указать `tier` и `from` — профессии, из которых можно перейти (их tier строго меньше; у tier 0 `from` пустой).
3. Роль, `baseStats`, `growth`, `basic`, `visual` (`sprite` — id из реестра спрайтов; нет спрайта — рисуется плейсхолдер, `content:check` предупредит).
4. Навыки: `npm run content:new -- skill job_<id>_<название> --from <похожий навык>`, затем добавить в `skills` с уровнем открытия ≤ `maxJobLevel`.
5. `npm run content:check`, потом `npm run check`.

## Что проверяет content:check

- `basic` и навыки существуют, `basic` без `trigger`;
- уровни открытия навыков уникальны и ≤ `maxJobLevel`;
- у tier 0 `from` пустой, у tier ≥ 1 — непустой, tier каждого источника строго меньше;
- каждая профессия достижима от Новичка по цепочке `from`.

Код проверок — `src/core/progression/validate.ts`, тесты — `tests/jobs.test.ts`.
