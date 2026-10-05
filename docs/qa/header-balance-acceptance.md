# Баланс валют и шапка после resize

Приёмка: 2026-10-04, частный локальный dev5511, production policy без `compact=1`. Telegram360×640, safeTop136/safeBottom34, WebGL1 и Canvas; раскрытие640↔760 и поздние insets в сюжетном выборе.

Две визуальные строки валют получают одну цель «Баланс» ≥44CSSpx; тап по каждой строке показывает полные текущие золото и гемы. В высокой полосе отдельные цели разрешены, лишь когда обе умещаются по высоте без пересечения. Классические экраны сохраняют прежний вид.

Перед перерисовкой frame сохраняется фактическая позиция старой шапки: поздно добавленные полосы background bleed больше не закрывают заголовок после resize. До исправления Canvas скриншот показывал перекрытие90world/30CSSpx, после — заголовок полностью виден.

Проверены44 фактических snapshots: новая игра/вступление, Campaign→Adventure→Stage/Battle/Result→Campaign, scroll, nav, resize и законный выборch3_rescue; обе валюты нажаты в Campaign и Adventure. Ошибки браузера/уничтоженные texture source отсутствуют; headerAboveBleed и render heartbeat проверяются в каждом кадре приёмки. Сюжетный выбор записан ровно один раз.

Воспроизведение: `PLAYWRIGHT_MODULE=<глобальный playwright> CHROME_EXECUTABLE_PATH=/usr/bin/chromium URL=http://127.0.0.1:5511/ MODES=webgl1,canvas OUT=<папка> node scripts/night-compact-ui-qa.cjs`. Только localhost, все внешние и неGET/HEAD запросы блокируются. Полная compiled приёмка foundation описана в `compact-ui-acceptance.md`; этот новый header packet отдельно проверен dev, typecheck и22 focused tests.
