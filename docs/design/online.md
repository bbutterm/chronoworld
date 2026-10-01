# Онлайн «без обязательств» (01.10.2026)

Решение владельца: онлайн непринуждённый, ни к чему не обязывает, привязан к Telegram ID. Бот уже в BotFather,
игра открывается в Telegram — нужно «ловить» пользователя. Сервер — Supabase-проект владельца **Imgtexh**
(`ajltzwomvyvntvtjnrrf`, общий с другими его играми), поэтому всё наше — с префиксом `cw_`.

## Принципы

- Игра полностью работает без сети и вне Telegram (веб-сборка): онлайн — надстройка. Нет сети — тихо, без ошибок.
- Никаких расписаний, гильдий с обязательным участием, штрафов за пропуск. Всё асинхронно.
- Ядро детерминировано; сеть — только в `src/game/online/*` (клиент) и `supabase/functions/cw-api` (сервер).
- Игрок опознаётся по `Telegram.WebApp.initData`: сервер проверяет подпись HMAC-SHA256 токеном бота
  (секрет `CHRONOWORLD_BOT_TOKEN` в Supabase → Edge Functions → Secrets) и срок `auth_date` (≤ 24 ч).
  Ключей сессии нет — initData приходит в каждом запросе.
- Таблицы закрыты RLS без политик: читать и писать может только функция `cw-api` (service role).

## Фаза 1 (сейчас)

1. **Профиль и облачное сохранение.** `hello` — проверка, создание/обновление `cw_player` (имя, @username, язык),
   реферал из `start_param` (`ref_<tg_id>`). `save_put` / `save_get` — сохранение в `cw_save` (jsonb, ≤ 512 КБ,
   версия и `updated_at`); при входе с другого устройства — «Продолжить облачное сохранение (глава N, X ч назад)?».
2. **Рекорды недели.** `sync` — клиент шлёт главу/этап, мощь, рекорд Башни, лучший зачёт MVP недели; сервер хранит
   максимум за ISO-неделю в `cw_score` (доски `tower`, `mvp`) с разумными потолками (неправдоподобное отбрасывается).
   `board` — топ-50 и место игрока; фильтр «друзья».
3. **Друзья.** Ссылка-приглашение `https://t.me/<бот>/<app>?startapp=ref_<tg_id>` (кнопка «Позвать друга» через
   `Telegram.WebApp.openTelegramLink` / share). Дружба взаимная автоматически при входе по ссылке (`cw_friend`).
   Список друзей: имя, глава, рекорд Башни. **Колокольчик** раз в день каждому другу (`cw_gift`) — получатель
   забирает 20 гемов за колокольчик, не больше 5 в день. За приглашённого, прошедшего главу 1, — награда обоим.

## Клиент (src/game/online, 01.10.2026)

Всё онлайн-отображение и сеть — в `src/game/online/*` и экране `FriendsScene`; ядро не тронуто. Вне Telegram
(нет `Telegram.WebApp.initData`; SDK грузится только при `tgWebApp` в адресе, index.html) онлайн выключен целиком:
кнопки «Друзья» нет, запросов нет.

- `api.ts` — `call(action, payload)`: POST `{ action, initData, ... }` на `VITE_CW_API`, таймаут 8 с, ответ или `null`
  (сеть, 401/500, мусор — без исключений). `api.hello/saveGet/savePut/sync/board/friends/giftSend/giftClaim/refClaim`.
- `logic.ts` — чистые функции с тестами (`tests/online-client.test.ts`): разбор ответов, `shouldOfferCloud`,
  `normalizeAppLink`/`refLink`/`shareUrl`, `progressOf` (глава = `order` главы первого открытого этапа, этап — номер в
  главе), `victoryOf`, `nextMvpWeek`, `isoWeek` (как на сервере), `cloudSaveDelay`, награды (`REF_*`, `BELL_GEMS`).
- `online.ts` — связка с игрой, запуск из `main.ts` (`startOnline`):
  1. Вход: `hello` → `refBonus > 0` — `ref_claim`, письмо «Ваш друг прошёл первую главу» с 200 гемами за каждого.
  2. Облачное сохранение: окно «Найдено облачное сохранение: глава N, X назад. Продолжить его?» (Да / Нет, оставить это),
     если в облаке есть игра и здесь новая игра, или облачная дальше по главе, или та же глава записана на 10+ мин позже
     последней игры здесь (`chronoworld.online.localAt`). «Нет» запоминается (`chronoworld.online.declinedAt`) — про это
     облачное сохранение больше не спросим, его заменит текущая игра. «Да» — `save_get`, проверка `deserialize` (формат новее
     сборки — тост «перезапустите игру»), локальное — в резервную копию (`chronoworld.save.v1.backup.<время>`), запись и
     перезагрузка. Пока вопрос не решён (не было удачного `hello`), в облако ничего не пишется — чужой прогресс не затирается.
  3. `session.onCommit`: победа на этапе (`campaign.cleared` вырос), новый этаж Башни (`tower.floor`), бой охоты
     (`hunt` изменился) → `sync` через 2 с и `save_put` (данные — `JSON.parse(serialize(save))`, `saveVersion`, глава),
     не чаще раза в 60 с; сворачивание (`lifecycle.onAppHidden`: вкладка скрыта, Telegram `deactivated`) — тоже
     (`keepalive`, если тело < 60 КБ). `sync`: глава/этап, мощь отряда `squadPower`, `towerBest` = `tower.floor`,
     `mvpWeek` — лучший зачёт MVP недели.
  4. `sync → refRewarded` — приглашённому письмо «Друг рад, что ты с нами» со 100 гемами (один раз, source
     `online_ref_welcome`). Колокольчики — `gift_claim` → `grantRewards` 20 гемов за каждый.
- Зачёт MVP недели: в сохранении нет результата каждой попытки, только рекорд по каждому MVP (`hunt.best`, «зачёт»
  `huntScore`). Клиент хранит `chronoworld.online.mvpWeek` = { неделя, значение }: новый рекорд по MVP на этой неделе
  поднимает значение; с новой ISO-неделей — с нуля. Бой без личного рекорда в доску MVP не попадает (нужна правка сервера
  или поле в сохранении, если захотим честный «лучший бой недели»).
- `entry.ts` — кнопка «Друзья» слева от ленты «Город» (только в Telegram), красный кружок — ждущие колокольчики
  (`hello.giftsWaiting`, обновляется по списку друзей).
- `FriendsScene` (`Friends`) — вкладки «Друзья» (колокольчики и «Забрать», «Позвать друга», список: имя, глава и этап,
  рекорд Башни, «Колокольчик» раз в день, «Прислал вам колокольчик») и «Рекорды недели» (Башня / MVP, все / друзья,
  «Ваше место»). Ответы кэшируются на минуту; нет сети — «Нет связи…» и «Повторить».
- Ручная проверка без Telegram: `?tgmock=1` (dev-сборка, или вместе с `?dev=1`) — ответы-заглушки `mock.ts`,
  `?tgmock=cloud` — ещё и окно облачного сохранения. e2e (`npm run e2e`, вне Telegram) проверяет, что кнопки «Друзья» нет.

### Переменные сборки (Vercel → Settings → Environment Variables, см. `.env.example`)

- `VITE_TG_APP_LINK` — ссылка на Mini App для приглашений, `https://t.me/<бот>/<app>` (Direct Link из BotFather,
  `/newapp`) или `https://t.me/<бот>` (главное приложение бота). Не задана — `https://t.me/Chronoworldbot` (main Mini App
  бота); задана, но не t.me — «Позвать друга» скрыта.
- `VITE_CW_API` — адрес функции; по умолчанию `https://ajltzwomvyvntvtjnrrf.supabase.co/functions/v1/cw-api`.

## Бот и уведомления (01.10.2026)

Бот @Chronoworldbot: main Mini App (кнопка меню «Play» → https://chronoworld-ecru.vercel.app/), ссылка с параметром —
`https://t.me/Chronoworldbot?startapp=<param>`. Голос бота — трактирщик Бруно из «Двух колоколов» (и Грета, Гаррет).
Ненавязчиво: короткие ответы, в каждом — кнопка «Играть».

Код: `supabase/functions/_shared/bot.ts` — вся чистая логика без Deno API (секреты, разбор команд, ответы, выбор и тексты
уведомлений, разбор полей от клиента; тесты `tests/online-bot.test.ts`), `_shared/telegram.ts` — вызов Bot API,
`cw-bot/index.ts` — вебхук, `cw-cron/index.ts` — уведомления, SQL — `supabase/migrations/20261001120000_cw_bot.sql`.

### Команды (cw-bot)

- `/start [payload]` — приветствие Бруно и «Играть»; payload `ref_<id>` уходит в `startapp` (реферал срабатывает при
  первом входе в игру). Игрок уже есть в `cw_player` — «С возвращением». Любое сообщение боту отмечает «можно писать»:
  `cw_bot_start` (если игрока ещё нет) и `cw_player.bot_started`.
- `/play` — «Играть» (кнопка web_app). `/help` — список команд.
- `/friends` — сколько друзей и «Позвать друга» (`t.me/share/url?url=https://t.me/Chronoworldbot?startapp=ref_<id>`).
- `/top` — рекорды недели: топ-5 Башни (имена), место игрока в Башне и в охоте на MVP (как `board` в cw-api).
- `/me` — глава и этап, рекорд Башни, друзья, ждущие колокольчики, включены ли уведомления.
- `/notify` — включить/выключить (inline-кнопки «Включить»/«Выключить», callback `notify_on`/`notify_off`).
- Неизвестная команда или просто текст — «такого заказа в меню нет» и список команд. Только личные чаты.

Защита: Telegram шлёт заголовок `X-Telegram-Bot-Api-Secret-Token` = `hex(HMAC_SHA256(токен, 'cw-webhook')).slice(0,48)`;
служебный вызов — заголовок `X-CW-Admin` = `hex(HMAC_SHA256(токен, 'cw-admin')).slice(0,48)` (`webhookSecret`/`adminKey`).
Оба выводятся из `CHRONOWORLD_BOT_TOKEN`, отдельных секретов хранить не нужно.

### Уведомления (cw-cron)

Кому: `notify = true` (по умолчанию) и `bot_started = true` — Telegram даёт писать только тем, кто нажал Start (или
разрешил боту писать: `allows_write_to_pm` в initData — hello ставит `bot_started`). Ответ 403 (заблокировал) —
`notify = false`, `bot_started = false`, `blocked_at`; новый /start после блокировки снова включает уведомления.
«chat not found» — `bot_started = false`.

Лимиты (`planNotice`): одно за проход cron (каждые 15 мин), не больше 2 в сутки (местный день), не чаще раза в 3 ч,
не в тихие часы 22:00–09:00 местного времени (клиент шлёт `tzOffset` = `getTimezoneOffset()`; нет — Москва), не пока
игрок в игре (hello/sync меньше 15 мин назад). Порядок важности:

1. Колокольчик — `gift_send` в cw-api ставит получателю `gift_at`; не чаще раза в день (`gift_notified_day`); вход в
   игру (hello) снимает отметку.
2. Отряд вернулся — `exp_done_at` (клиент: ближайший `endsAt` из `bounties.active`). Один раз; потом снимается.
3. Сундук полон — `chest_full_at` (клиент: `now + offlineFullInMs`; уже полон — null: игрок в игре и видит). Раз на заполнение.
   Сундук и экспедиция, наступившие до последнего входа или больше 2 суток назад, снимаются молча.
4. Новая неделя рекордов — в первые двое суток ISO-недели (UTC), если игрок был в доске Башни прошлой недели: «ты был
   N-м» (`week_notified`).
5. «Возвращайся» — 3 дня без входа, второй раз через 7 дней после первого, дальше тишина (`comeback_stage` 0→1→2;
   hello/sync сбрасывают в 0).

Клиент (`online.ts`): hello и sync шлют `tzOffset`, `chestFullAt`, `expeditionsDoneAt` (мс или null; `notifyTimersOf` в
`logic.ts`). После записи игры без победы (забрал сундук, отправил/забрал отряд) — sync, если сроки сдвинулись больше
чем на минуту (`timersChanged`); при сворачивании — тоже (keepalive). Сервер (`clientNotifyFields`): `tzOffset` в
[−840, 720], моменты — в будущем не дальше 7 суток (прошлое — null), мусор и отсутствующие поля колонку не трогают
(старый клиент работает как раньше). На экране «Друзья» — строка «Уведомления в боте: @Chronoworldbot» и «Открыть бота».

### Как развернуть

1. Миграция `supabase/migrations/20261001120000_cw_bot.sql` (колонки `cw_player`, таблицы `cw_bot_start`, `cw_config`
   с RLS без политик, задача pg_cron `cw-cron` каждые 15 мин → `net.http_post` на cw-cron с заголовком `X-CW-Cron`).
   Применять ДО новой cw-api — она пишет новые колонки.
2. Ключ cron (в репозиторий не кладём): `insert into public.cw_config (key, value) values ('cron_key',
   replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (key) do update set value = excluded.value;` Без ключа cron молчит.
3. Функции (все с verify_jwt = false): `cw-api` (`cw-api/index.ts`, `cw-api/tg.ts`, `_shared/bot.ts`), `cw-bot`
   (`cw-bot/index.ts`, `_shared/bot.ts`, `_shared/telegram.ts`, `cw-api/tg.ts`), `cw-cron` (`cw-cron/index.ts`,
   `_shared/bot.ts`, `_shared/telegram.ts`, `cw-api/tg.ts`). Секрет — тот же `CHRONOWORLD_BOT_TOKEN`.
4. Настройка бота: `POST https://ajltzwomvyvntvtjnrrf.supabase.co/functions/v1/cw-bot` с заголовком `X-CW-Admin: <adminKey>`
   и телом `{"action":"setup"}` — setWebhook (url функции, secret_token, allowed_updates message/callback_query),
   setMyCommands (по умолчанию и `ru`), в ответе getWebhookInfo. `{"action":"info"}` — только getWebhookInfo.
   adminKey: `node -e "console.log(require('crypto').createHmac('sha256', process.env.T).update('cw-admin').digest('hex').slice(0,48))"`
   с токеном в переменной `T`.
5. Проверка: `select net.http_post(...)` вручную или подождать 15 мин — ответ cw-cron `{ ok, players, sent, failed, cleared }`
   виден в `net._http_response`.

## Фаза 2 (дальше)

4. **Арена (асинхронная).** Отряд-защита (снимок юнитов) в `cw_defense`; 5 попыток в день против снимков соперников
   близкой мощи, бой считает ядро на клиенте с seed от сервера, сервер перепроверяет результат тем же ядром
   (общий код ядра в функции) — рейтинг, недельная награда, журнал защиты.
5. **Наёмник друга** на один бой в день. 6. **Общий босс сообщества** (по желанию).

## Проверка

- Юнит-тесты клиента: разбор initData/реферала, офлайн-режим, слияние облачного сохранения.
- Функция: тест проверки подписи на известном примере; ручной smoke через `curl` с поддельной подписью → 401.
- e2e вне Telegram: игра работает, онлайн-кнопки скрыты/неактивны.
