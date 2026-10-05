# Повтор сюжета: Telegram Back, 05.10.2026

Исправление только `src/game/dialogue.ts`: повторный просмотр (`readOnly`) регистрируется в существующем стеке окон. Первое нажатие SDK Back закрывает реплей; отдельное следующее нажатие ведёт к логическому родителю. Закрытие останавливает таймеры, удаляет подписки и вызывает завершение один раз. Внешний DESTROY при активном родителе также освобождает блокировку списка истории, без повторного destroy. SHUTDOWN или DESTROY неактивной сцены останавливает работу и не продвигает очередь.

Обычный сюжет, сохранение выбора, default и выдача наград используют прежние ветви. Изменение существующего теста выбора — только Map/setData в макете Phaser (две строки); прежние проверки сохранены. Shared screen, ModalBack, core/data, спрайты не входят в пакет.

## Доказательства

- Browser BEFORE владельца Story: `/tmp/chronoworld-night-story-ui/readonly-replay-before-report.json`. На Canvas360×640 и WebGL390×640 законный сохранённый маршрут Boot → Home → Chronicle → история → ▶ открывал dialogue при пустом модальном стеке; SDK Back уводил Chronicle → Home. Save оставался побайтово прежним.
- Новый регрессионный стенд использует настоящие `screen`, `ModalBack`, `telegram` SDK bridge и mock только отрисовки Phaser. Девять тестов: незаданный/два сохранённых выбора, Back до родителя, Back корневого экрана, внешний DESTROY, SHUTDOWN/неактивный DESTROY, очередь и 20 повторов без listener/timer debt, неизменный live plot. Исходный helper: 7 FAIL / 2 PASS; после исправления все 9 PASS.
- Все пять выбранных файлов (новый стенд, campaign-choice-ui, story, game-lore-social, modal-telegram-back): **66/66 PASS**; `npm run typecheck`: PASS; `git diff --check`: PASS. Логи приложены. Бюджеты и утверждения не ослаблялись.
- Файл dialogue заморожен SHA `4ce623a286d9dfb43f9ce8f5ced93bf1a2f7e61f16401d5be3b1d4703ab033ca`; исходник SHA `a8db250ebe7b652430973ede66146a5b514a01e79404186cb3ff160d99ca13f3`.

Actual compiled AFTER на Canvas/WebGL, пересмотр ChapterDone и сохранение положения истории выполняют владельцы Story/Chronicle со своими экранами и отдельным Runtime lazy Back. Этот пакет не выдаёт модульный стенд за браузерную приёмку, не измеряет FPS физического iPhone. Полный `npm run check` и публикация — после точной интеграции оркестратором.
