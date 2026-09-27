# Заливка на Vercel

Игра — статический сайт: `npm run build` собирает `dist/` (≈ 3.6 МБ: JS ≈ 430 КБ в gzip и только используемый арт).
Настройки уже в репозитории (`vercel.json`): установка `npm ci`, сборка `npm run build`, папка `dist`, Node ≥ 20.11 (`package.json → engines`).
Перед сборкой идёт проверка типов (`tsc --noEmit`): сломанный код на прод не уедет.

## Вариант 1. Через сайт (5 минут, без терминала)

1. vercel.com → **Add New… → Project** → **Import Git Repository** → `bbutterm/chronoworld`
   (если репозитория нет в списке — «Adjust GitHub App Permissions» и дать доступ к нему).
2. Framework Preset определится сам (**Vite**), остальные поля не трогать — их задаёт `vercel.json`.
3. **Production Branch.** Vercel берёт в прод ветку по умолчанию (`main`). Работа сейчас в
   `claude/idle-hero-rpg-gdd-rolicg`, поэтому одно из двух:
   - слить ветку в `main` (pull request) — тогда каждый пуш в `main` = новый прод;
   - или в проекте: в настройках проекта найти **Production Branch** (раздел Git или Environments → Production, зависит от версии интерфейса) и указать `claude/idle-hero-rpg-gdd-rolicg`.
   Любая другая ветка всё равно получает свою Preview-ссылку на каждый пуш.
4. **Deploy.** Через ~1 минуту будет ссылка вида `https://chronoworld.vercel.app` — открыть на телефоне.

## Вариант 2. Из терминала

```bash
npm i -g vercel
vercel login
vercel          # первый раз: привязать папку к проекту, получить preview-ссылку
vercel --prod   # выложить в прод
```

## Проверка перед заливкой

```bash
npm ci && npm run check      # контент, типы, тесты
npm run build && npm run preview   # собранная версия на http://localhost:4173
npm run e2e:chapter1         # глава 1 проходится через интерфейс (нужен Playwright)
```

## Что важно знать

- Сохранение игры — в `localStorage` браузера: на другом устройстве/браузере прогресс свой. Облако Telegram — позже.
- Кэш: файлы `assets/*` (JS с хэшем в имени) кэшируются навсегда, арт и `index.html` — обычный кэш, обновление видно после перезагрузки.
- Для Telegram Mini App нужна именно HTTPS-ссылка Vercel — её потом укажем в @BotFather (фаза Telegram).
- Отладочный `window.__game` есть только в dev-сборке, в проде его нет.
