# Компактный Telegram: Campaign и Adventure, 05.10.2026

Первый проверенный набор адаптивных сцен — только Campaign/Adventure. Политика выбирается до `create`,
следующий classic Stage/Battle/Result возвращает прежнее поле1920. Dev `?compact=1` предназначен для
проверки следующего экрана до его включения в production allowlist. Другие сцены этим пакетом не адаптированы.

## Геометрия и состояния

При360×640, Telegram top136/bottom34 доступно470CSS по высоте. Сохраняется ширина1080, высота UI1410,
body40 даёт13,3CSSpx, нижний предел текста12CSSpx. Основные CTA48CSSpx, минимальная цель44CSSpx.
Шапка/навигация и кнопки Campaign независимы от прокручиваемой карты/строя. Adventure сохраняет баннер
минимум120CSSpx: картина, название и строка состояния имеют место, четвёртый режим достигается прокруткой.

`ScrollArea.setBounds` пересчитывает маску/полосу/ввод и сохраняет допустимый offset. Scene subscriptions
живут до shutdown. Graphics маски явно освобождаются при уничтожении; тестовые Graphics получили только
настоящий API `destroy`, прежние assertions очистки/кнопок/достижимости остались. Белая маска рисуется
одним общим методом, бюджет цветов не повышен. Telegram insets могут прийти после `create`: body всегда
готов к reflow, не создаётся условно только при первой compact высоте.

Сюжетные страницы сохраняют текущую страницу, длинный текст прокручивается и последняя строка доступна;
Next/Skip фиксированы. Dialogue, choice, bottomSheet и unlock banner используют новую высоту. Resize
640→760→640 не перезапускает сцены, не выбирает сюжетный ответ и не закрывает модальное окно.

## Реальная приёмка

- Три профиля (freshWebGL,lateWebGL,lateCanvas),33 снимка: реальные Adventure/scroll/возврат, Campaign/map/строй,
  CTA, resize, Stage classic и возврат к Campaign;0 page/console errors и source-null.
- Обе кнопки choice имеют44CSSpx. WebGL и Canvas: ch3_rescue сохраняет block ровно один раз после
  реального нажатия; resize с открытым выбором сохраняет pending/не пишет choice, ответ прочитан,
  реальная нижняя кнопка достигает Adventure.
- Собранная production версия:14 настоящих снимков Campaign→Adventure→Campaign→Stage→Battle→Result→
  Campaign→Adventure, размеры1410/1920 переключаются, реальный бой/Result/возврат, heartbeat растёт.
  Private fixture/instrumentation этой локальной сборки не изменяют настоящий production save.
- Cold сюжет:6 снимков, реальная прокрутка до последней строки, resize без потери страницы, Next меняет
  страницу, Skip возвращает карту. Тексты не подменены пустыми тестовыми строками.

Первые diagnostic snapshots `adaptive-final` содержали возврат к Campaign вместо заявленной Adventure:
новый сюжет перехватил нажатие. Этот шаг не считается PASS; окончательные choice и compiled проходят
строгое имя сцены. Выбранные доказательства — в
[summary.json](../REPORTS/2026-10-05-night-compact-ui/summary.json),
[Campaign](../REPORTS/2026-10-05-night-compact-ui/late-webgl-Campaign-compact.png),
[Adventure](../REPORTS/2026-10-05-night-compact-ui/late-webgl-Adventure-compact.png).
Manifest содержит точные SHA source. Последний ui.ts — `1c949cf5b1f9bb5f1e27e85a98ecf62f93d4636783a31255b1df3313aff7e418`.
Общий совмещённый check197files/2153Vitest+3Node PASS; отдельные viewport/frame/focused61 PASS и
старые notice/settings40 PASS. Сборка root успешна; source на время полного UI e2e заморожен.

Наблюдения относятся к Chromium/SwiftShader, WebGL1/Canvas. Физические Safari/Telegram iPhone и FPS
не измерены. Разница classic остальных экранов видима; их адаптация выполняется следующими пакетами.

Переносимая приёмка: [команды](compact-ui-acceptance.md), `scripts/night-compact-ui-qa.cjs`.
Новый helper фактически прошёл44DEV(WebGL+Canvas) и22снимка fresh compiledWebGL:0errors/source-null, реальныйchoice1write.
Результаты: `portable-dev-report.json`/`portable-compiled-report.json` рядом с основнымsummary.
Rootbuild/e2e29снимков/18UIпобедпервойглавы проходят на неизменном продукте.
