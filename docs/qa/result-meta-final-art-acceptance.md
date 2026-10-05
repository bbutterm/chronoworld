# Итоги боя после изменения ширины: финальная сборка с артом

Один согласованный native Canvas-контекст прошёл на production bundle `index-BPki5j24.js`, SHA256 `98bf58903ae72dd2200f6710bf995401d3a64910f5e52b5a587cf5249ffdf7c5` (Root source975, Result SHA `273bbb9201fed6ec41ed576fb5116e270f68b32a22a0cfe90ede88d4c9d23d3a`). Прогон завершён, браузер закрыт. Эта проверка дополняет исторический 2×2 PASS на aeWR/5f0f и не переатрибутирует его новой графике.

На ширинах320 → 360 «Первая победа» и подпись этапа разделены на32world units:9,481 → 10,667 CSS px между реальными glyph bounds. Плашка347/309world units вмещает подпись315/277 плюс32 отступа. Контейнер metadata сохраняется; PNG обеих ширин просмотрены, наложения этих двух подписей больше нет.

Интерактивный Text «Хватает опыта на новый уровень» сохраняет центр Rectangle(0,0), размеры шрифта12,148 → 12 CSS px и высоту нажатия44,148 → 44 CSS px. Text/Input/Rectangle/callback/enabled те же. Scene/create0, save и число записей неизменны. Физическое нажатие открывает «Герои». Ошибок JavaScript и потерянных Frame.source нет; postrender продолжается.

Подготовка — только public newGame → actPlayStage победа на первом этапе → actClaimOffline за12ч. Сам маршрут проходит обычный Boot → Кампания → этап → бой → итоги. Часы/RAF идут штатно, источник UI в браузер не импортируется, сцены не подставляются; контекст допускает только локальные GET/HEAD.

Source fix пересобирает только дочерние объекты строки metadata после изменения шрифта и снимает view callback на DESTROY. Body scroll, другие объекты результата, scene/core/save не пересоздаются. Три meaningful regression до исправления:3FAIL/10прежнихPASS; после:13PASS. Parent исправил одну type-only аннотацию dynamic import; финальный Root check226files/2374Vitest+3Node, UI-lint/build GREEN.

Воспроизведение из корня, на локальной финальной сборке:

```sh
URL=http://127.0.0.1:5603/ MODES=canvas META_GAP=1 OUT=/tmp/result-meta-tail node scripts/night-auto-text-hit-ui-qa.cjs
```

Для внешней установки браузерных инструментов задаются PLAYWRIGHT_MODULE и CHROME_EXECUTABLE_PATH. META_GAP — опция QA helper; default сохраняет прежнюю проверку360 → 320 → 360 в Canvas/WebGL1.

[Сырой отчёт](../REPORTS/2026-10-05-night-result-meta-final-art/raw.json.gz), [PNG320](../REPORTS/2026-10-05-night-result-meta-final-art/result-320.png), [PNG360](../REPORTS/2026-10-05-night-result-meta-final-art/result-360.png), [точный manifest](../REPORTS/2026-10-05-night-result-meta-final-art/READY.json).
