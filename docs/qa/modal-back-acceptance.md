# Telegram Back для модального стека

`screen` создаёт ModalBack с исходным переходом сцены; `registerModal` включает Back для верхнего окна. Закрытие последнего слоя возвращает прежний переход или скрытую кнопку корневой вкладки. SHUTDOWN и поздний destroy старого слоя не занимают Back новой сцены. Быстрый повтор при анимации закрытия не уводит со страницы.

65 focused tests/6 files, typecheck PASS. Семь новых регрессий выполняют настоящий setTgBack на поддельном SDK с onClick/offClick: корневая вкладка, nested Hero/Ascend,20 циклов без накопления listeners, закрывающаяся анимация, inactive/old destroy и открытие внутри create до RUNNING.

Независимая реальная browser приёмка heroes_ui: Telegram360×640 и390×844, физические taps classFilter→resize640↔760→SDK Back→проверка отсутствия modal→reopen→class choice→sort→scroll→Hero→SDK Back.16 реальных taps,14 state/flow checks, ошибок page/console нет. Browser SDK Back использует зарегистрированные продуктом onClick callbacks; прямого вызова closeTopModal нет. Физические nested Hero/Ascend modals покрываются отдельными RPG chains; новый пакет явно не приписывает их этой root проверке.

Документ привязан к screen SHA a766009bee6e2de2593147a8f5497036fa0876f0b8969bd27b77c859d06e3c44 и modalBack SHA27d7595b8469e3f4bab8ac4bf0897cc012480f928a09a4b33ba177e1dd81a8d0.
