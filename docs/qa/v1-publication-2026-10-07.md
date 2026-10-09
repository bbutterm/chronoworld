# Публикация Chronoworld v1.0.0 — 07.10.2026

Версия **1.0.0 опубликована в main и Vercel** по распоряжению владельца.
Сайт: [chronoworld-ecru.vercel.app](https://chronoworld-ecru.vercel.app/).

- [PR #148](https://github.com/bbutterm/chronoworld/pull/148) слит merge-коммитом
  `91a4db853bd395a8ec85a54e87d43680aecf70b9`; проверенный исходник — `9d52550b10b3b9fe0f0cb5f39aec2ee9b6df2c91`.
- [CI PR](https://github.com/bbutterm/chronoworld/actions/runs/37616173170) и
  [CI main](https://github.com/bbutterm/chronoworld/actions/runs/37616771510): `check` и `backend` — success.
  Обе цепочки выполняют обычные проверки; клиентская включает production build.
- [Vercel deployment](https://vercel.com/bbutterms-projects/chronoworld/8ZTExcUDPRLgPDNQ35YPLUSFSewa) — success.
  При приёмке code main `91a4db8` публичный адрес ответил HTTP 200 и отдавал `index-DJY0EgJZ.js`
  вместо прежнего `index-BE_nZCYN.js`. Это зафиксированный снимок: последующие сборки могут менять имена assets.
- SHA256 опубликованного index:
  `1d6142584a95ee076ad86e9491e267b59ecac7a26473d550002e4239b5e73c9b`.
  Локальная приёмка использовала `index-CIEAz6zU.js`; Vercel собирает с production-окружением.
  Проверка ниже выполнена на настоящем опубликованном JS.

## Проверка опубликованной игры

WebGL 390×844 (фактический renderer 2) и Canvas 360×640 (renderer 1) — **PASS**:

- нормальная загрузка Boot → Campaign → финальный ChapterDone;
- native касание «К приключениям» из финала главы 10 → Adventure;
- завершённая Campaign → та же действующая кнопка → Adventure;
- в настройках Home показано «Chronoworld · версия 1.0.0»;
- после переходов сохранены 180 этапов, `pendingChapterDone` снят;
- ошибок браузера, console.error и внешних запросов — ноль в обоих прогонах.

Использована отдельная копия законного финального профиля и отдельный browser storage.
Перед UI-приёмкой помечены просмотренными обучение/сюжет и выставлен `pendingChapterDone=chapter10`.
Прогресс/ресурсы не дописывались. Phaser найден через CDP; исходник игры и bundle не подменялись.
Разрешены только GET/HEAD к указанному production origin, все другие запросы блокируются.
Облачные записи и данные реальных игроков не затрагивались. TLS проверялся с настроенным CA среды.

Артефакты: [production report](../REPORTS/2026-10-07-v1/production/report.json),
[metadata и SHA](../REPORTS/2026-10-07-v1/production/metadata.json),
[Canvas 360, финал](../REPORTS/2026-10-07-v1/production/canvas360-chapter-final.png).
Для повторения из корня репозитория, с распакованным `legal-campaign.tar.gz`:

```bash
NODE_USE_ENV_PROXY=1 \
QA_V1_URL=https://chronoworld-ecru.vercel.app/ \
QA_FINAL_SAVE=/tmp/legal-campaign/final-save.json \
QA_FINAL_CLOCK=/tmp/legal-campaign/final-clock.json \
node docs/REPORTS/2026-10-07-v1/production/driver.mjs
```

Среда использует наследуемый HTTPS_PROXY и настроенный CA; браузерный модуль/Chromium задаются через
`PLAYWRIGHT_MODULE` и `CHROME_EXECUTABLE_PATH`. Для среды без прокси driver допускает обычный browser launch.

Полный локальный аудит: [v1-final-audit-2026-10-07.md](v1-final-audit-2026-10-07.md).
Save v7 / протокол v2 сохранены; SQL и Edge Functions в этом пакете не менялись и повторно не публиковались.
Физический Telegram, авторизованные live API, прежний долг арт-валидатора и бюджета остаются в указанных там границах.
