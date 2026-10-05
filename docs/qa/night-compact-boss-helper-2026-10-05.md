# Независимая проверка компактного боя с финальным боссом

Проверен замороженный пакет Battle/Result/ChapterDone из `night-rpg-economy` (7 производственных файлов; байтовое совпадение с `/tmp/night-compact-battle-manifest.json`). Проверка не меняла боевые данные, спрайты и сохранение реального игрока.

| Законный снимок | Экран / renderer | Бой | Перекрытие героя боссом, максимум | Результат |
| --- | --- | --- | --- | --- |
| seed2, AFTER ch10_s18, 180/180 | 390×844 Telegram, WebGL1 | A, 81,8 с; seed 2763811228 | 0% | PASS |
| тот же AFTER | 360×640 Telegram, Canvas | тот же бой | 1,7796% | PASS |

У каждого прогона 416 выборок после реального `postrender`, 0 кадров с перекрытием более 50%, 0 ошибок. Нажатие выбрано по видимому непрозрачному пикселю босса с исключением соседей выше по depth и проверено реальным Phaser hit test: B1, имя раскрыто с alpha=1.

Два изменения верхнего отступа Telegram 136→156→136 сохранили объект сцены, объект боевого результата, cursor, clock, core units и сохранение. В Result и открытой статистике проверены четыре изменения высоты окна: идентичность данных и сохранения, продолжающийся рендер, видимый текст ≥12 CSS px и цели касания ≥44 CSS px. Статистика открыта настоящим нажатием, прокручена, закрыта; кнопка возврата достигла Campaign.

## Воспроизведение

Используется глобальный Playwright; зависимости и браузеры в репозиторий не устанавливаются. Vite должен обслуживать замороженный пакет.

```bash
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
node scripts/night-boss-ui-qa.mjs \
  --origin http://127.0.0.1:5536 \
  --save /tmp/chronoworld-night-after-rational-seed2/saves/after-ch10_s18.json \
  --clock /tmp/chronoworld-night-after-rational-seed2/saves/after-ch10_s18.clock.json \
  --stage ch10_s18 --width 390 --height 844 --renderer webgl1 \
  --telegram 1 --compact 1 --render-every 6 --max-seconds 300 \
  --out /tmp/night-compact-lord-390-webgl-final
```

Для Canvas: `--width 360 --height 640 --renderer canvas`. Все файлы результата и PNG сохраняются под `--out`; пропуск сцены, ошибка, недоступная цель, остановка рендера или нарушение утверждения завершают процесс с exit 1.

Новый `--compact 1` устанавливает URL opt-in **после** открытия старого Stage и **перед** настоящим нажатием видимой кнопки боя, без промежуточного resize. Battle START применяет новую раскладку. Прежний classic alpha threshold 0.5 сохраняется; новый compact сценарий требует alpha=1. Порог сохранения снимка худшего перекрытия 0.02 сохранён, итоговый максимум рассчитывается по всем raw samples.

Прогоны с BEFORE first-win (179/180) корректно прошли бой, имя босса и live resize, но **не являются PASS статистики**: финальный сюжет штатно перевёл Result в ChapterDone. Ошибочное предположение helper о продолжении в Result зафиксировано как FAIL. Для полного протокола Result используется AFTER снимок. Сюжеты и объявления закрываются реальными кнопками «Пропустить» / «Позже».

## Доказательства и ограничения

- `/tmp/night-compact-lord-390-webgl-final/report.json`
- `/tmp/night-compact-lord-360-canvas-after/report.json`
- Входной clock: `1792645582503`, день `2026-10-22`.
- Manual replay обновляется в 30 Hz с согласованными частными часами. `--render-every 6` пропускает только промежуточный рендер: каждая выборка и PNG следуют за реальным рендером. Это проверка поведения и геометрии, не измерение FPS телефона.
- Физический iPhone/Safari недоступен; реально проверены Chromium WebGL1 и Canvas.
- Это независимый replay уже законно пройденного этапа, не новое полное прохождение кампании.
