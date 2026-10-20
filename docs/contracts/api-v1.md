# Интеграционный контракт API 0.13.0

Дата: 2026-10-19. Статус: **зафиксирован для параллельной разработки по поручению
пользователя**. Это спецификация, не работающий API. Реализация приложения и
развёртывание ещё не начаты. Основание — [приёмка](../product/acceptance.md) и
[первичные требования](../requirements/README.md).

Единственный источник форм данных — [OpenAPI](../../packages/contracts/openapi.yaml).
Все свойства, required/nullable, варианты ответов, параметры, статусы и operationId
заданы там. Этот документ фиксирует семантику, которую нельзя выразить одной схемой.
Прежний [проект API](api-proposal.md) сохранён как ссылка на текущий контракт.
Версия 0.2.0 ввела [решения пользователя DEC-01/02](../product/decisions.md):
закрытие записи/решений в момент начала и отображение времени в зоне встречи.
Версия 0.3.0 по DEC-06 уменьшила SVG до 128 КиБ включительно, JSON-тело — до 1 МиБ.
Версия 0.4.0 по DEC-07 добавила модерацию общего справочника направлений,
activityTypeReview автору встречи и фильтр activityTypeId административных событий.
Версия 0.5.0 по [DEC-08](../product/reports-and-moderation.md) добавила жалобы
на встречи/сообщения, их разбор и восстановление сообщений. adminHideMessage
теперь требует JSON с expectedRevision. AdminMessage/AdminEvent получили
обязательные счётчики и версии; прежние клиенты нужно обновить согласованно.
Версия 0.6.0 по [DEC-09](../product/avatars.md) заменила готовые аватары личным
SVG с модерацией. PublicAccount/NullablePublicAccount теперь содержат avatarUrl
вместо avatarId; listAvatars/setAvatar исключены. Клиенты обновляются согласованно.
Версия 0.7.0 по DEC-10 добавила выбор готового SVG наряду с личной загрузкой:
listAvatarPresets/selectPresetAvatar, source/presetId в AvatarState, поддержку
статических avatarUrl. По последующему DEC-22 manifest содержит подготовленный
`ryadom-companion.svg`; ожидание стартовых изображений снято.
Версия 0.8.0 по [DEC-11](../product/registration.md) добавила необязательный
nullable presetId в DemoRegisterInput. Аккаунт, начальный аватар и сессия создаются
одной транзакцией, ответ Me уже содержит выбранный avatarUrl. Прежний запрос
только с именем остаётся допустимым. Новых операций или таблиц нет.
Версия 0.9.0 по DEC-12 делает presetId обязательным, не nullable; прежний запрос
с одним именем больше не допускается. DEC-13 добавляет adminGetDemoState и
adminResetDemoData, техническую demo_state и общий барьер транзакций. Это изменения
контракта: потребители/seed/обработчики обновляются согласованно до интеграции.
Версия 0.10.0 по DEC-14 расширяет listMyParticipations параметрами eventWindow
и referenceTime; MyParticipationPage содержит обязательный nullable referenceTime.
Главная получает будущие подтверждённые встречи и начавшиеся сегодня раздельно.
Без временного фильтра поведение полного списка сохраняется.
Версия 0.11.0 по DEC-15 добавляет STARTED со startsAt/event.id DESC; интерфейс
«Участвую» по умолчанию использует UPCOMING и предоставляет «Начавшиеся»/«Все записи».
DEC-16 меняет клиентский переход после входа/регистрации на / при отсутствии returnTo.
Версия 0.12.0 по DEC-18 добавляет order публичного обсуждения, а по DEC-19 —
dateFrom/dateTo каталога в зоне каждой встречи. Новых операций/схем/таблиц нет.
Текущая 0.13.0 по DEC-20/21 заменяет демовход на email/пароль и JWT,
добавляет блокировку USER с отзывом всех сессий и сохранением контента.
60 операций, 100 схем; прежние demo-маршруты исключены. Новых таблиц нет.

## Общие соглашения

После разработки контракт доступен на адресе прототипа: `/api/docs` — Swagger UI,
`/api/openapi.yaml` — этот же OpenAPI текущей сборки. Это обязательное
[требование к документации и сдаче](../development/api-documentation.md),
отдельное от бизнес-маршрутов `/api/v1`. Пока сетевой документации нет.

- Базовый путь `/api/v1`, REST/JSON, поля camelCase. UUID — строки; входные даты
  ISO 8601 с зоной/смещением, выходные — UTC с `Z`. IANA-зона встречи хранится отдельно.
- Обычные JSON-тела не больше 64 КиБ; для SVG-фона и личного SVG-аватара — 1 МиБ. Принимается
  `application/json` с возможным charset=utf-8, без сжатого Content-Encoding.
  У операций без requestBody тело не передаётся; непустое тело даёт 400 INVALID_REQUEST.
- Неизвестные поля объектов запрещены `additionalProperties: false`.
  Неизвестные/повторённые query-параметры — 400 INVALID_REQUEST; фильтры статусов
  передаются одним параметром через запятую. Пустой курсор не равен отсутствию.
- Длины строк — Unicode code points после JSON-декодирования, размер SVG — байты
  UTF-8. Максимумы применяются до и после нормализации. Сервер делает trim для обычных текстов;
  password не trim/normalize, email отклоняет пробелы и приводится к lowercase. Для обычных текстов
  обязательная строка из пробелов даёт 422. `conditions` может быть пустой.
- `null` допускается только там, где указан nullable. Обязательные nullable-поля
  не пропускаются. Скрытый текст сообщения, напротив, отсутствует как поле.
- Все API-ответы имеют `X-Request-ID`, а также `Cache-Control: private, no-store`.
  Стандартная статическая заглушка может кешироваться отдельно. Никакие сессии,
  внутренние ошибки SQL и токены не включаются в JSON.
- Ссылки фронтенд строит из типа организатора и ID. API не возвращает hash-маршруты
  локального макета. `coverUrl` — относительный серверный путь, а не сырой SVG.

## Сессия, вход и роли — DEC-20/21

Полная спецификация — [аутентификация](../architecture/authentication.md),
пользовательский путь — [регистрация](../product/registration.md).
login/register заменяют demoLogin/demoRegister/listDemoProfiles; API демовыбора
исключён. DEMO_MODE не отключает обычную регистрацию или проверку пароля.

LoginInput: email/password. RegisterInput: email/password/displayName/presetId.
Email ASCII 3..254 без пробелов, lowercase/UNIQUE; пароль регистрации 15..128
code points без trim, входа 1..128. Хранение Argon2id с солью; роль/статус/SVG/URL
не принимаются регистрацией. Подтверждение email/восстановление исключены из MVP.
Пустой каталог блокирует регистрацию, обычный вход существующими данными доступен.

Один register атомарно создаёт USER/ACTIVE, PRESET/APPROVED/revision=1 и сессию;
ошибка не создаёт частичных данных. Cookie после commit, 201 Me содержит email и
avatarUrl. Равные displayName разрешены. Занятый email — 409 EMAIL_TAKEN с /email.
Неверный/пустой presetId — 422 /presetId. При таймауте POST не повторяется сам;
getMe не доказывает выполнение потерянного запроса, доступен явный login.

JWT: HS256, typ=ryadom-session+jwt; iss=ryadom-api, aud=ryadom-web,
sub=account ID, jti=session ID, iat/exp, 24 часа без refresh/продления чтением.
Cookie ryadom_session: HttpOnly; Path=/api/v1; SameSite=Lax; Max-Age=86400,
без Domain, Secure на HTTPS. В БД SHA-256 JWT в sessions.token_hash;
валидатор проверяет подпись/claims, текущий ACTIVE и строку sessions с теми же
ID/аккаунтом/хешем/сроком. JWT не возвращается в JSON/localStorage.
Выход отзывает текущую сессию; блокировка USER — все; разблокировка их не возвращает.

Мутации, включая login/register/logout, проверяют допустимый Origin, иначе
403 CSRF_REJECTED. Браузер/proxy — один origin, credentials: same-origin.
Неверная пара email/пароль — общий 401 INVALID_CREDENTIALS; правильный пароль
BLOCKED — 403 ACCOUNT_BLOCKED. Лимиты дают 429 RATE_LIMITED + Retry-After.
Точные криптографические параметры/лимиты/порядок замков заданы в спецификации входа.

Без cookie на закрытом маршруте — 401 AUTH_REQUIRED; неверный/истёкший JWT,
удалённый аккаунт или отозванная сессия ACTIVE — 401 SESSION_EXPIRED.
Подписанный неистёкший JWT BLOCKED — 403 ACCOUNT_BLOCKED до предметных прав,
даже после удаления sessions. На защищённом/optional-session маршруте
401 SESSION_EXPIRED и 403 ACCOUNT_BLOCKED очищают cookie и персональный кеш.
Ошибка login не заменяет и не очищает прежнюю сессию другого аккаунта.
После разблокировки старый JWT — 401.
Logout с любым состоянием cookie — 204 при допустимом Origin.

Публичные маршруты security: [] игнорируют cookie. Optional-session без cookie
разрешает гостя; с неверной/истёкшей даёт 401, с JWT BLOCKED — 403. После очистки
cookie общедоступный ресурс доступен как гостю. Заголовки роли/accountId не авторизуют.

GET /me возвращает публичные данные аккаунта, приватный email, systemRole,
sessionExpiresAt и собственные организации/canPublish. USER/ADMIN — системные
полномочия; организация — контекст владения. Отдельной роли организатора нет.
Безопасный returnTo, иначе /; автоматических записей/вопросов/жалоб после входа нет.

## Административная блокировка — DEC-21

[Полные правила](../product/account-blocking.md): adminListAccounts,
adminGetAccount, adminSetAccountStatus. Поиск q/status до LIMIT, createdAt/id DESC.
Изменение принимает status ACTIVE/BLOCKED и expectedRevision. Цель только USER:
ADMIN — 409 ACCOUNT_PROTECTED; чужие полномочия — 403, нет цели — 404.
После проверки цели/USER несовпавшая revision — 409 ACCOUNT_REVISION_CONFLICT.
При той же revision и статусе 200 без изменения; переход увеличивает revision.
BLOCKED и удаление sessions атомарны; ACTIVE очищает blockedAt/blockedByAccountId.
Старое решение не отменяет новое, timeout не запускает автоматический PATCH retry.

Контент, участие и допуск организаций сохраняются; ADMIN не заменяет автора
при принятии заявок. Запись других пользователей по обоим режимам остаётся
доступна до начала. PublicAccount.isBlocked и ownerIsBlocked организатора-организации
позволяют предупредить о недоступности автора. Email/подробности решения только ADMIN.
Синхронизация с бизнес-операциями: demo_state → accounts актёра FOR SHARE →
предметные замки; блокировка берёт accounts цели USER FOR UPDATE до удаления sessions.
ADMIN-цель отклоняется до эксклюзивного замка, запрос FOR UPDATE фильтрует USER;
после ожидания повторно проверяются роль/версия.

## Видимость и права

| Ресурс / действие | Точное правило |
| --- | --- |
| Публичный аккаунт | Только id, displayName, isBlocked, avatarUrl: существующий PRESET либо APPROVED CUSTOM, иначе null; роль и его участия не раскрываются |
| Публичная организация | Только APPROVED; до допуска — 404, включая владельца на публичном маршруте |
| Частный кабинет организации | Через `/me/organizations/{organizationId}` только владельцу; чужой ID — 404 |
| Административный маршрут | Сначала сессия, затем ADMIN; обычный пользователь — 403 FORBIDDEN |
| Создание от организации | Только своя APPROVED; чужая — 404, своя без допуска — 409 ORG_NOT_APPROVED |
| Участие и вопрос | От человека; организацию/роль нельзя назначить телом запроса. Вопрос до записи разрешён |
| Состав и решения по заявкам | Только автор встречи или ответственный за организацию-автора; ADMIN без авторства — 404 |
| Собственная запись автора | Запрещена: 409 ALREADY_ORGANIZER; автор уже указан организатором |
| Чтение опубликованного обсуждения | Публично для обоих режимов; поле body у HIDDEN отсутствует даже для ADMIN на публичном маршруте |
| Исходный текст скрытого сообщения | Только ADMIN через adminListMessages/adminGetMessage; работает и для снятого события |
| Жалобы | Вошедший на опубликованную встречу/чужое видимое сообщение; собственные цели запрещены; участие не требуется |

После снятия публичный каталог и публичная организация больше не предлагают
встречу. `GET /events/{eventId}` для автора, ADMIN и человека с собственной записью
(включая PENDING/REJECTED) возвращает `UnavailableEventDetail`; постороннему — 404.
Причина заполнена только автору/ADMIN, остальным `unpublishReason: null`.
В ограниченной карточке нет адреса, времени, организатора, обсуждения или фона.

Новые записи, сообщения, решения по участию и изменение фона заблокированы.
Для субъекта с доступом к снятому событию мутация даёт 409 EVENT_UNAVAILABLE;
постороннему, который не должен знать о нём, — 404. Проверка состояния выполняется
до возврата результата повтора. Существующее участие сохраняет свой статус,
публикация и участие не смешиваются. Это не автоматическая отмена события.

Администратор получает полное событие, создателя, состояние и причину снятия через
`/admin/events/{eventId}`. Полный состав участников не выдаётся как побочное
следствие системной роли. Скрывать сообщения можно и после снятия публикации.

## DTO, которые нужно различать

| Схема | Использование |
| --- | --- |
| PublishedEventSummary | Публичные списки: направление, организатор, время/место, режим, coverUrl |
| PublishedEventDetail | Описание, условия, confirmedCount, myParticipation, capabilities |
| UnavailableEventSummary | Только id/title/publicationStatus в собственных списках |
| UnavailableEventDetail | Ограниченная карточка и своё участие; причина по правилам выше |
| OwnedEventEntry | `{event, canManageParticipants}` для списка своих созданных встреч |
| MyParticipationEntry | `{participation, event}` для «Участвую / Заявки», без запроса на каждую строку |
| PrivateOrganization | Частный профиль, owner, application/null, approvalState и доступные действия |
| PublicOrganization | Название/деятельность/интересы; заявка и причины не выдаются |
| PublicMessage | VISIBLE с body или HIDDEN без body; discriminator=status |
| AdminMessage | body всегда содержит исходный текст, плюс hiddenAt/hiddenBy или null |
| AdminActivityType | Имя/состояние справочника, создатель/проверка/причина, eventCount и canDecide; только ADMIN |

Варианты карточки и сводки различаются по `publicationStatus`. `Organizer`
различается по type: PERSONAL содержит account, ORGANIZATION — organization.
В создании activityType — ровно один из `{id}` и `{name}`.
Пример, где смешаны варианты, должен отклоняться, а не молча исправляться.

PublishedEventDetail дополнительно имеет обязательный nullable activityTypeReview.
Автор опубликованной встречи получает catalogStatus/rejectionReason; остальным
возвращается null, в том числе ADMIN без авторства. У PENDING/APPROVED причина null,
у REJECTED непустая. Это сведения о включении в список, не запрет использования.
Ограниченный UnavailableEventDetail и публичный ActivityType их не получают.

`capabilities` PublishedEventDetail вычисляет сервер для текущего запроса.
При серверном `now >= startsAt` canJoin=false, joinBlockedReason=EVENT_STARTED
для любого субъекта. До начала canJoin=false для гостя, автора и уже имеющего
участие; причины соответственно AUTH_REQUIRED, ALREADY_ORGANIZER или
ALREADY_PARTICIPATING. При canJoin=true причина null.
canManageParticipants разрешает автору читать состав и остаётся true после начала;
новое обязательное canDecideParticipations разрешает автору решения только до начала.
canPostMessage требует только сессию; canSetCover — авторство. Для опубликованной
встречи эти два флага не зависят от начала. Клиентские флаги не заменяют проверки API.

startsAt передаётся в UTC, timezone хранит IANA-зону встречи. Веб показывает
начало по timezone встречи с явным GMT/UTC-смещением на её дату, включая каталог,
сводку формы и кабинеты. Зона устройства не подменяет это время — см. DEC-02.

## Направления и модерация справочника — DEC-07

Полные правила и ограничения — [в спецификации направлений](../product/activity-types.md).
listActivityTypes возвращает только APPROVED. createEvent с новым именем атомарно
создаёт PENDING и сразу опубликованное событие. Имя/известный ID любого состояния
разрешены; повторное использование REJECTED не меняет решение и не создаёт проверку.
Поиск q и фильтр activityTypeId событий учитывают PENDING/REJECTED, включая
административный список. Публичная форма ActivityType остаётся id/name.

| Операция | Метод и путь относительно /api/v1 | Результат |
| --- | --- | --- |
| adminListActivityTypes | GET /admin/activity-types | AdminActivityTypePage; q/catalogStatus/limit/cursor; без статуса все |
| adminGetActivityType | GET /admin/activity-types/{activityTypeId} | Текущее состояние/имя по ID, в том числе после исчезновения из очереди |
| adminDecideActivityType | POST /admin/activity-types/{activityTypeId}/decision | APPROVE либо REJECT с причиной; 200 AdminActivityType |
| adminRenameActivityType | PATCH /admin/activity-types/{activityTypeId} | Свободное name, прежний ID/статус; 200 AdminActivityType |

Все четыре требуют ADMIN, изменения — разрешённый Origin. Новое решение требует
expectedName текущего отображаемого имени; APPROVE может атомарно исправить name,
REJECT требует reason и не принимает name. Устаревшее expectedName даёт 409
ACTIVITY_TYPE_CHANGED, занятое другим ID имя — 409 ACTIVITY_TYPE_NAME_CONFLICT.
При конфликте ни имя, ни решение не меняются. Переименование разрешено в любом
состоянии, включая seed, без смены решения и без обновления FK событий.

Проверка/исправление выполняются под блокировкой строки. Терминальный повтор
того же решения — 200 без смены reviewer/времени: у REJECT та же нормализованная
причина, у APPROVE переданное name совпадает с текущим. expectedName такому повтору
не мешает. Иначе терминальное решение даёт DECISION_CONFLICT. Для PATCH уже
текущее name даёт 200 без смены updatedAt, иначе проверяются expectedName и UNIQUE.
Объединения, удаления, алиасов, повторной подачи и пересмотра решения в 0.13.0 нет.
Прежнее написание после исправления не резервируется; фильтр по прежнему ID работает.

## Списки, фильтры и пагинация

Все постраничные ответы имеют `{items, nextCursor}`. Пустой результат — 200,
items=[], nextCursor=null; последняя неполная или полная страница тоже имеет null,
если следующей строки нет. Общее total в контракт не входит. limit по умолчанию
20, допустимо 1–100; фильтры применяются до пагинации. Публичный справочник направлений, справочники
аватаров и демопрофилей небольшие и возвращают полный items без nextCursor.

| Операция | Фильтры сверх limit/cursor | Порядок |
| --- | --- | --- |
| listEvents | q, city, activityTypeId, joinMode, from, to, dateFrom, dateTo, organizationId либо organizerAccountId | startsAt, id по возрастанию |
| listMyEvents | organizationId своей организации; без него только личные | createdAt, id по убыванию |
| listMyParticipations | status=PENDING,CONFIRMED,REJECTED, можно подмножество; eventWindow, referenceTime по DEC-14/15 | Без окна: participation.createdAt/id DESC; UPCOMING/STARTED_TODAY: event.startsAt/id ASC; STARTED: event.startsAt/id DESC |
| listEventParticipations | тот же status; только автор | createdAt, id по возрастанию |
| listMyOrganizations | Нет | createdAt, id по убыванию |
| adminListOrganizations | q, approvalState | createdAt, id по возрастанию |
| adminListEvents | q, publicationStatus, organizationId, activityTypeId | createdAt, id по убыванию |
| adminListActivityTypes | q, catalogStatus=PENDING/APPROVED/REJECTED либо без него все | createdAt, id по возрастанию |
| listMessages | order=OLDEST_FIRST (API default) либо NEWEST_FIRST (явно запрашивает интерфейс) | OLDEST_FIRST: createdAt/id ASC; NEWEST_FIRST: DESC |
| adminListMessages | hasOpenReports; без параметра все | createdAt, id по возрастанию |

Поиск q — регистронезависимая подстрока после нормализации пробелов, без SQL-wildcard
семантики `%`/`_`: в событиях название/описание/название направления, в организациях
название/деятельность/интересы. city — точное нормализованное совпадение. Пустые
q/city равны отсутствию. Иные пустые фильтры невалидны. from включительно,
to исключительно; при обеих границах to > from. Без from сервер не скрывает
прошлые события автоматически: главная/каталог будущих встреч передают его явно.

По DEC-19 dateFrom/dateTo — отдельные календарные границы `YYYY-MM-DD` в зоне
каждой встречи: dateFrom включительно, dateTo исключительно. Условие — сравнение
`(starts_at AT TIME ZONE timezone)::date` с этими датами. Это не сутки UTC и не
день устройства/единой зоны сервера. При обеих границах dateTo > dateFrom;
невалидная дата/пустота/обратный или нулевой диапазон — 400 INVALID_REQUEST.
Параметры можно сочетать с абсолютными from/to через AND, до сортировки/LIMIT.
Например, каталог будущих с фильтром дня передаёт from и dateFrom/dateTo.
Для одного выбранного дня 7 ноября UI отправляет dateFrom=2026-11-07 и
dateTo=2026-11-08; для включительного диапазона «7–9 ноября» — dateTo=2026-11-10.
Дата календаря не преобразуется через Date.toISOString; в URL остаётся дата без
времени. Все границы входят в область курсора, их смена требует первой страницы.
Пресет «Сегодня» по единой зоне не добавляется этим решением; фильтр задаёт явные даты.

Курсор непрозрачный, keyset по указанным полям; клиент передаёт его без разбора.
Он связан с маршрутом, нормализованными фильтрами и аккаунтом закрытого списка.
При смене фильтров/аккаунта клиент начинает с первой страницы. limit можно менять.
Пустой/повреждённый курсор, чужая область или несовпадение фильтров дают
400 INVALID_CURSOR. Новые данные и смена статуса между страницами не образуют
снимок БД; клиент удаляет дубли по ID и обновляет список после своих мутаций.

### Личные временные выборки DEC-14

`GET /me/participations` сохраняет существующий маршрут. eventWindow необязателен:

| eventWindow | Условия поверх своих записей и status | Порядок |
| --- | --- | --- |
| Не передан | Все даты, включая разрешённые ограниченные UNPUBLISHED | participation.createdAt DESC, participation.id DESC |
| UPCOMING | Только PUBLISHED, startsAt > referenceTime | event.startsAt ASC, event.id ASC |
| STARTED_TODAY | Только PUBLISHED, startsAt <= referenceTime; дата начала равна дате referenceTime в IANA-зоне встречи | event.startsAt ASC, event.id ASC |
| STARTED (DEC-15) | Только PUBLISHED, startsAt <= referenceTime, независимо от дня | event.startsAt DESC, event.id DESC |

Главная и вкладка «Участвую» передают status=CONFIRMED; свободная запись и принятая заявка равноправны.
Статус не подразумевается параметром eventWindow: допустимы и другие значения
status по прежним правилам. Фильтры/JOIN/сортировка выполняются до LIMIT.
Одинаковое начало разрешается по event.id в направлении соответствующего окна,
а не по времени принятия/создания записи.
При startsAt == referenceTime встреча уже в STARTED_TODAY; вчерашняя исключена.
«Сегодня» определяется отдельно в зоне каждого события, не устройства/сервера.

MyParticipationPage всегда содержит referenceTime: null без eventWindow,
UTC-время с Z при временной выборке, включая пустую выдачу. На первой странице
без явного referenceTime используется один серверный момент, захваченный для
всего запроса. Необязательный query referenceTime — дата-время со смещением;
сервис нормализует её в UTC. Клиент передаёт момент первого ответа во второй
блок, поэтому окна не пересекаются на границе начала/полуночи.
Это только опорный момент чтения: он не меняет реальные права и актуальный now
для записи/решений и не означает снимок БД на указанную дату.

referenceTime без eventWindow, пустое/неизвестное окно, невалидное время или
время без зоны дают 400 INVALID_REQUEST. Временной курсор хранит referenceTime,
последние event.startsAt/event.id, аккаунт, status, окно и порядок. При продолжении
параметр referenceTime можно опустить — берётся из курсора; если он указан,
должен обозначать тот же момент, иначе 400 INVALID_CURSOR. Смена окна/status
с прежним курсором также INVALID_CURSOR. У полной выдачи referenceTime=null.

Главная сначала читает UPCOMING с limit=3, затем STARTED_TODAY с тем же
referenceTime и limit=3; nextCursor второго блока даёт путь к остальным.
Состояния загрузки/ошибки/пустоты различаются. Обновление начинает оба окна
с нового опорного момента и без старых курсоров; realtime/точные счётчики не добавлены.
По DEC-15 «Мои встречи → Участвую» по умолчанию запрашивает CONFIRMED/UPCOMING;
переключатель «Начавшиеся» — CONFIRMED/STARTED. В UI это view=upcoming (по умолчанию),
view=started или view=all при tab=confirmed. «Все записи» без eventWindow сохраняет
все даты/публикации, включая ограниченные UNPUBLISHED по прежним правам; ссылка
на этот режим видима рядом с переключателем, а не спрятана в пагинации. У STARTED
при равном времени порядок event.id DESC; курсор хранит это направление.
Порядок PENDING/REJECTED и «Организую» не меняется. Статуса «завершено/посетил» нет. Правила —
[DEC-14](../product/decisions.md), [личный блок](../product/home-proposal.md).

### Обсуждение с последними сообщениями — DEC-18

listMessages принимает order=OLDEST_FIRST/NEWEST_FIRST. Без параметра сохранён
старый порядок ASC; интерфейс явно выбирает NEWEST_FIRST и получает последнюю
страницу по createdAt/id DESC. nextCursor ведёт к более ранним сообщениям.
Курсор связан также с order; смена порядка с прежним курсором — INVALID_CURSOR.
Административный adminListMessages сохраняет ASC и фильтр hasOpenReports;
новый параметр там не разрешён. Статусы HIDDEN/права чтения не меняются.

Внутри интерфейса загруженные сообщения показываются по createdAt/id ASC,
ранние догружаются сверху с сохранением позиции. Это только порядок отображения
уже загруженного диапазона; для получения хвоста используется серверный DESC,
не пересортировка первой старой страницы. ID уникальны, страницы объединяются
с удалением дублей. Из заглушек HIDDEN не извлекается скрытый body.

После подтверждённого createMessage и при обновлении/возврате во вкладку клиент
заново читает актуальный хвост, сбрасывая прежнюю цепочку курсоров. Не склеивает
новый хвост со старой первой страницей через незагруженный промежуток. 201 с ID
подтверждает отправку; при потерянном ответе совпадение текста её не доказывает
и POST не повторяется автоматически. Нет realtime/непрочитанных счётчиков.

## Переходы и повторные запросы

| Операция | Первое выполнение | Повтор |
| --- | --- | --- |
| register | 201, USER/начальный аватар/сессия одним commit | Идемпотентного повтора нет; POST автоматически не повторяется |
| joinEvent, OPEN | 201 CONFIRMED, decidedAt=null | 200 существующей записи без смены статуса |
| joinEvent, APPROVAL | 201 PENDING | 200 существующей записи, включая REJECTED |
| decideParticipation | 200, PENDING → CONFIRMED/REJECTED | То же решение 200; другое 409 DECISION_CONFLICT |
| submitOrganization | 201, отсутствие заявки → PENDING | 200 существующей заявки, включая REJECTED; повторной подачи нет |
| adminDecideOrganization | 200, PENDING → APPROVED/REJECTED | То же решение/нормализованная причина 200, другое — конфликт |
| adminUnpublishEvent | 200, PUBLISHED → UNPUBLISHED | Та же причина 200, другая — конфликт |
| adminHideMessage/adminRestoreMessage | 200, VISIBLE ↔ HIDDEN, при совпадении expectedRevision | Уже нужный status — 200 без изменений; иначе старая версия — 409 MESSAGE_CHANGED |
| reportEvent/reportMessage | 201 OPEN | 200 той же жалобы в текущем статусе, без открытия заново |
| adminDismissEventReports/adminDismissMessageReports | 200, OPEN → DISMISSED, при совпадении expectedReportsRevision | Нет OPEN — 200 без изменений; иначе старая версия — 409 REPORTS_CHANGED |
| setEventCover | 200 после сохранения | Повтор того же значения не создаёт новый объект |
| uploadAvatar | 200 PENDING, revision +1 | Тот же нормализованный SVG уже PENDING — 200 без изменений; иначе нужна текущая expectedRevision |
| selectPresetAvatar | 200 PRESET/APPROVED, revision +1 | Тот же допустимый presetId уже выбран — 200 без изменений; иначе нужна текущая expectedRevision |
| deleteMyAvatar | 200 EMPTY, revision +1 | Уже EMPTY — 200 без изменений; иначе старая версия — 409 AVATAR_CHANGED |
| adminModerateAvatar | 200 APPROVED/HIDDEN, revision +1 | Нужный статус — 200 только при expectedRevision=current/current-1; прочее AVATAR_CHANGED |
| deleteEventCover | 204, штатный фон | 204 при отсутствии фона, пока встреча PUBLISHED |
| logout | 204 и очистка cookie | 204, включая отсутствующую/истёкшую cookie |

Для CONFIRMED свободной записи decidedAt=null; для принятой/отклонённой заявки —
дата решения. Свободную запись нельзя переоформить операцией решения: 409.
decideParticipation принимает только APPROVE/REJECT, без поля причины в обеих
ветках. Непустая reason до 2000 символов при REJECT относится к допуску
организации и модерации направления; при их APPROVE причина не принимается.
Снятие события требует свою причину. Жалобы, скрытие/восстановление сообщения
и модерация аватара причин не запрашивают. Эти правила нельзя переносить
между разными операциями только по совпадению слова «отказ».
Время, проверяющий, статус и авторство всегда назначаются сервером.

Создание встречи, организации, сообщения и регистрация не имеют ключа
идемпотентности. Клиент блокирует повторное нажатие и не повторяет эти POST
автоматически. После timeout/обрыва результат неизвестен: сначала перечитывается
свой список/обсуждение. Сообщение «успешно» показывается только по подтверждённому
ответу. Совпадение имени/названия/текста в перечитанном списке не является
квитанцией именно потерянного запроса: такие значения не уникальны. Интерфейс
сохраняет неподтверждённый результат и предлагает просмотр списка, не заявляет
успех и не повторяет POST автоматически. Отмена события/участия, повторная
заявка после отказа, восстановление публикации события и редактирование события
целиком не входят в 0.13.0. Восстановление сообщения/аватара сохраняется по DEC-08/09.

Для joinEvent и decideParticipation время проверяется после блокировок,
непосредственно перед операцией: `now >= startsAt` даёт 409 EVENT_STARTED,
включая точное равенство и повтор ранее успешного запроса. Таблица повторов выше
действует для опубликованного события до начала. Проверка снятой публикации
предшествует проверке времени; обе предшествуют возврату повтора. После начала
сохранённый результат восстанавливают чтением getEvent/своего участия/состава.
Время начала транзакции или поступления запроса не заменяет актуальное время
после ожидания блокировки. Прошедшая проверку до границы операция может завершить
commit после неё. Существующие статусы участия и публикации автоматически не меняются;
вопрос/ответ и чтение состава опубликованной встречи остаются доступны.
Точные граничные проверки — [DEC-01](../product/decisions.md).

Операции над событием сериализуются по строке события. Запись перед снятием
сохраняется; снятие перед записью запрещает запись. Решение по участнику/создание
сообщения не выполняются поверх снятого события; административная модерация
сообщений разрешена. Обязателен UNIQUE(event_id, account_id).
Принципы транзакций — [в модели данных](../architecture/data-model.md).

## Жалобы и восстановление — DEC-08

Полная семантика — [в спецификации модерации](../product/reports-and-moderation.md).
На встречу — `POST /events/{eventId}/reports`, на сообщение —
`POST /messages/{messageId}/reports`: без тела, только сессия/Origin. Ответ Report
содержит id, target {type,id}, status, createdAt, reviewedAt, без сведений о заявителе.
Одна запись аккаунта/цели за всё время. Новые жалобы разрешены только при PUBLISHED,
на сообщения — только VISIBLE. Повтор существующей возвращается и при HIDDEN,
если встреча опубликована; закрытую жалобу нельзя открыть повтором. Начало встречи
не закрывает жалобы. Проверки доступа/публикации предшествуют поиску повтора.

adminListEvents/adminListMessages принимают hasOpenReports=true/false (без параметра
все). Булевы query передаются строками true/false; фильтры входят в область курсора
и применяются до пагинации. AdminEvent содержит openEventReportsCount,
openMessageReportsCount, eventReportsRevision; AdminMessage — openReportsCount,
reportsRevision, moderationRevision, restoredAt/By. Поля обязательны, даты/авторы
последнего скрытия/восстановления nullable. В публичных DTO этих полей нет.
Счётчики только OPEN; у встречи фильтр учитывает обе группы, а версия — прямые жалобы.

`POST /admin/messages/{messageId}/hide` и `/restore` принимают
MessageModerationInput {expectedRevision}; причин нет. Нужный status уже установлен —
200 без изменений; иначе версия должна совпасть. Фактический переход увеличивает
moderationRevision на один, обновляет соответствующую пару дат/автора и сохраняет
предыдущую пару. Восстановление не меняет id/текст/автора/createdAt, публикацию
встречи или закрытые жалобы. Работает и при UNPUBLISHED, доступ обычных читателей
к обсуждению от этого не появляется. adminGetMessage доступен для перечитывания
оригинала и текущих версий даже после исчезновения строки из фильтра.

Скрытие атомарно закрывает OPEN-жалобы только сообщения как RESOLVED. Снятие
встречи с обязательной причиной — только её прямые жалобы, сохраняя жалобы сообщений.
Отклонение через `/admin/events/{eventId}/reports/dismiss` либо
`/admin/messages/{messageId}/reports/dismiss` принимает ReportDismissInput
{expectedReportsRevision}, без причины. Нет OPEN — 200 без изменений; иначе версия
должна совпасть. Только OPEN → DISMISSED; видимость контента не меняется.
Версия жалоб соответствующей цели +1 при новой уникальной жалобе или закрытии
непустой группы; повтор без изменений её не увеличивает. reviewedAt/By закрытых
жалоб сохраняются. Число жалоб никогда автоматически не скрывает контент.

После MESSAGE_CHANGED/REPORTS_CHANGED или таймаута перечитывается adminGetMessage/
adminGetEvent. Клиент не подставляет новую версию и не переотправляет старое
решение автоматически. Новое решение требует действия администратора.

## Сброс к штатному сиду — DEC-13

Полные правила/границы — [сброс демобазы](../product/demo-reset.md).
GET /admin/demo-state (adminGetDemoState) возвращает generation, seedVersion
текущей сборки, plannedBaseDate и nullable lastReset. Только ADMIN и DEMO_MODE;
обычная роль 403, отсутствие сессии 401, выключенный деморежим 404.

POST /admin/demo-reset (adminResetDemoData) принимает expectedGeneration,
expectedSeedVersion, новый resetId UUID и confirmation="СБРОСИТЬ". Origin обязателен.
В одной транзакции берётся эксклюзивный барьер demo_state, снова проверяются
сессия/ADMIN и версии, очищаются десять предметных таблиц и вставляется штатный
сид. Новые UUID, стабильные demoKey, базовая дата Asia/Krasnoyarsk. Обновление
поколения/последней квитанции тем же commit. Все сессии удалены, включая ADMIN.
Схема, миграции, статические ресурсы и техническая demo_state не сбрасываются.
Клиентский SQL/дамп/дата не принимаются. Обычный запуск/seed не вызывают этот сброс.

200 DemoResetReceipt и cookie Max-Age=0 выдаются только после commit. На ошибке
все удаления/вставки/сессии/поколение откатываются, очищающей cookie нет.
Старая generation/версия сида/последний resetId дают 409 DEMO_STATE_CHANGED;
эксклюзивный барьер не получен за 5 секунд — 409 DEMO_RESET_BUSY. Старый токен
после успешного сброса — 401 SESSION_EXPIRED. Автоматического retry нет.
После повторного входа ADMIN по email/паролю lastReset.resetId подтверждает потерянный
успешный ответ; другая квитанция не разрешает повторить прежнее удаление.

Все транзакции бизнес-данных/сессий до предметных блокировок берут FOR SHARE
на singleton demo_state и затем проверяют свежую авторизацию. Сброс — FOR UPDATE
первым, с повторной проверкой ADMIN после ожидания. Это общее правило BE-01/02,
а не локальная блокировка только нового обработчика. Healthcheck/статика исключены.
Старые формы/сессии не изменяют восстановленные данные. Чтения не смешивают
SQL-результаты до/после сброса. Доставленные клиентам данные/картинки не отзываются.

## Ошибки

Форма всегда `{error: {code, message, requestId, fieldErrors}}`. fieldErrors —
объект, значения — массивы строк, ключи — JSON Pointer (`/startsAt`, `/svg`,
`/organizer/organizationId`). При отсутствии ошибок полей это `{}`.
requestId совпадает с X-Request-ID. Точный набор code для каждой операции задан
в её `x-error-codes` в OpenAPI; интерфейс принимает решения по code, не по message.

| HTTP | Назначение |
| --- | --- |
| 400 | INVALID_REQUEST: JSON/query/путь/лишнее тело; INVALID_CURSOR: курсор |
| 401 | AUTH_REQUIRED / SESSION_EXPIRED |
| 403 | FORBIDDEN для административных прав; CSRF_REJECTED для Origin; CANNOT_REPORT_OWN_CONTENT |
| 404 | NOT_FOUND для отсутствующего или закрытого от этого субъекта ресурса |
| 409 | ORG_NOT_APPROVED, EVENT_UNAVAILABLE, EVENT_STARTED, DECISION_CONFLICT, ALREADY_ORGANIZER, ACTIVITY_TYPE_NAME_CONFLICT, ACTIVITY_TYPE_CHANGED, MESSAGE_UNAVAILABLE, MESSAGE_CHANGED, REPORTS_CHANGED, AVATAR_CHANGED, DEMO_STATE_CHANGED, DEMO_RESET_BUSY |
| 413 | PAYLOAD_TOO_LARGE, исходное значение не меняется |
| 415 | UNSUPPORTED_MEDIA_TYPE: неверный тип тела или сжатая загрузка |
| 422 | VALIDATION_ERROR: поля, неизвестные свойства, прошедшая дата, IANA-зона, SVG |
| 500 | INTERNAL_ERROR без внутренней диагностики |
| 503 | SERVICE_UNAVAILABLE для readiness |

Приоритет для корректно разобранного запроса: сессия → системная роль (admin)
→ ресурс и его видимость/владение → состояние → предметная операция в транзакции.
Лимиты транспорта и синтаксис могут отклоняться раньше. Вне API возможен сбой
сети/proxy без JSON; фронтенд сохраняет данные формы и не считает операцию успешной.

## MEDIA-01

По DEC-09/10 аватар выбирается из готового каталога либо загружается как личный
SVG. В account_avatars одна текущая строка: source=NONE/PRESET/CUSTOM, отдельно
status и revision. NONE/EMPTY и CUSTOM/PENDING/HIDDEN в публичном аккаунте дают
avatarUrl=null; CUSTOM/APPROVED — API URL с текущей revision; PRESET/APPROVED —
статический URL существующего ID из manifest. AvatarState содержит обязательные
source и nullable presetId. У PRESET svg/uploadedAt/reviewedAt/By пусты, presetId
задан; у CUSTOM presetId=null. Роль, допуск и участие от источника не меняются.

`GET /avatar-presets` (listAvatarPresets) — полный список items {id,label,imageUrl}
без пагинации/фильтров, порядок manifest. Он сейчас пуст: реальные SVG ещё не
получены. Фикстуры заполненного каталога не являются готовыми файлами. Единый
`packages/contracts/avatar-presets.json` используется API и вебом при сборке,
проверенные SVG из соседнего avatar-presets/ входят в веб-образ. imageUrl равен
`/assets/avatars/presets/<id>.svg`. ID не переиспользуется под другое изображение.

`PUT /me/avatar/preset` (selectPresetAvatar) принимает presetId/expectedRevision.
Неизвестный ID даёт 422 VALIDATION_ERROR /presetId без изменения прежнего выбора.
Уже выбранный тот же допустимый PRESET — 200 без изменений; иначе версия должна
совпасть, или AVATAR_CHANGED. Выбор атомарно делает PRESET/APPROVED с revision+1
и очищает прежний личный SVG/uploadedAt/reviewedAt/By. Нового одобрения не нужно:
готовые SVG проверяются до включения в сборку. По DEC-22 исходник «Спутник»
уже включён в manifest. Если каталог пуст в другой сборке/ошибочном состоянии,
профиль предлагает свой SVG, а регистрация блокируется; автовыбора нет.
Если сохранённый presetId исключён из новой сборки, он остаётся в AvatarState,
previewUrl/avatarUrl=null; показывается заглушка и предлагается заменить выбор.
Смена manifest сама не меняет revision аккаунта. Статические SVG могут кешироваться.

Владелец читает getMyAvatar, загружает uploadAvatar {svg,
expectedRevision}, сбрасывает deleteMyAvatar {expectedRevision}. Ошибка файла
сохраняет старые данные. Успешная замена APPROVED сразу PENDING и публичная
заглушка, без сохранения старого изображения на время проверки. Смена с PRESET
на загрузку делает CUSTOM/PENDING, очищает presetId и снова требует одобрения.
Сброс очищает любой источник до NONE/EMPTY, версия не обнуляется. Автоматического
возврата к прежней загрузке/готовому выбору нет.

adminListAvatars: q по имени, status=PENDING/APPROVED/HIDDEN, limit/cursor;
без status все CUSTOM, UI начинает с PENDING. NONE/PRESET не входят в очередь;
на прямых административных маршрутах дают 404. Порядок uploadedAt/accountId ASC,
фильтры до пагинации и в курсоре. adminGetAvatar/adminGetAvatarImage показывают
только текущую загрузку. adminModerateAvatar {decision: APPROVE|HIDE,
expectedRevision} без причины; APPROVE также восстанавливает HIDDEN.
Перечитывание после таймаута/конфликта обязательно; автоматически подставлять
новую версию в старую команду нельзя. EMPTY у adminGetAvatar даёт 404.
Полные правила повторов/версий — [аватары](../product/avatars.md).

getAccountAvatar — публичный, только CUSTOM/APPROVED; getMyAvatarImage — приватный
владельцу; adminGetAvatarImage — только ADMIN. Обязательный query revision
совпадает с текущей версией, иначе 404, без возврата другого файла. Все изображения
и отказы private/no-store, SVG с CSP sandbox/nosniff, без кеша proxy и inline SVG.
Сырой SVG не включается в DTO; личный/административный previewUrl CUSTOM не публичный.
Для PRESET используется статический previewUrl, API-маршруты личного изображения
отвечают 404. Каталог сборки не получает отдельного административного интерфейса;
очередь SCR-21 по-прежнему только для личных загрузок.

SVG-фон меняется после создания встречи. Для обоих видов изображений исходная и нормализованная строка SVG
не больше **131072 UTF-8 байт**, JSON-тело — **1048576 байт**. Предыдущий фон
сохраняется при ошибке. XML-проверки и способы показа — [в media.md](../architecture/media.md).
Схема строки не доказывает безопасность XML. Публикация и запись работают без фона.

`GET /events/{eventId}/cover` возвращает image/svg+xml с nosniff, ограничивающей
CSP с sandbox и private, no-store. Чтение проверяет доступ к событию; отсутствие
фона — 404. Текст не вставляется в DOM, object/iframe/embed не применяются.
S3, отдельный файловый том и растрирование не используются.

## Экран → запросы

| Экран | Операции |
| --- | --- |
| Главная / каталог | listActivityTypes, listEvents с фильтрами/from; после входа listMyParticipations с CONFIRMED и двумя eventWindow по DEC-14 |
| Встреча | getEvent, listMessages; joinEvent/createMessage/reportEvent/reportMessage после действия пользователя |
| Публичный человек | getAccount, listEvents с organizerAccountId; getAccountAvatar для APPROVED |
| Публичная организация | getOrganization, listEvents с organizationId |
| Вход / регистрация | listAvatarPresets; login; register с email/password/displayName/обязательным presetId, затем getMe |
| Личный кабинет | getMe; listAvatarPresets/selectPresetAvatar; getMyAvatar/uploadAvatar/deleteMyAvatar/getMyAvatarImage для MEDIA-01 |
| Мои встречи | listMyEvents, listMyParticipations с нужным status |
| Создание | getMe, listActivityTypes, createEvent |
| Участники / заявки | getEvent, listEventParticipations, decideParticipation; setEventCover/deleteEventCover отдельно |
| Свои организации / создание / кабинет | listMyOrganizations, createOrganization, getMyOrganization, submitOrganization |
| Административные организации | adminListOrganizations, adminGetOrganization, adminDecideOrganization |
| Административные встречи | adminListEvents, adminGetEvent, adminListMessages, adminGetMessage, adminUnpublishEvent, adminHideMessage, adminRestoreMessage, adminDismissEventReports, adminDismissMessageReports |
| Административные направления SCR-20 | adminListActivityTypes, adminGetActivityType, adminDecideActivityType, adminRenameActivityType; adminListEvents с activityTypeId |
| Административные аватары SCR-21 | adminListAvatars, adminGetAvatar, adminGetAvatarImage, adminModerateAvatar |
| Аккаунт ADMIN, блок демоданных SCR-08 | adminGetDemoState, adminResetDemoData; после успеха новый login |
| Модерация аккаунтов SCR-22 | adminListAccounts, adminGetAccount, adminSetAccountStatus; status/expectedRevision |

После мутации клиент перечитывает затронутые данные: участие — карточку/свои
записи/состав; решение организации — очереди/кабинет/getMe; сообщение — обсуждение;
снятие — карточку/каталог/свои списки/административный список; скрытие — оба вида
обсуждения и административную встречу; аватар — getMyAvatar/getMe/публичные данные
и затронутые списки/обсуждения, административную очередь; фон — карточку и изображение заново.
Жалоба — квитанцию в кеше текущего аккаунта; скрытие/восстановление/разбор жалоб —
административную карточку, сообщение и оба административных списка с их фильтрами.
Восстановление также перечитывает публичное обсуждение опубликованной встречи.
Решение/исправление направления — административную очередь, listActivityTypes,
карточки и списки встреч с этим ID, включая activityTypeReview автора.
Другой пользователь видит результат после собственного повторного чтения;
WebSocket и push отсутствуют. Смена аккаунта очищает весь персональный кеш.

## Передача исполнителям

Координатор — единственный владелец спецификации, примеров и генерации.
Бэкенд реализует поведение, фронтенд — эти DTO/состояния; расхождение не исправляется
созданием второго формата на одной стороне. Изменения вносятся в контракт и
потребителей вместе с повышением версии. Базовая проверка —
[валидатор контракта](../../scripts/check_api_contract.py); примеры —
[в пакете](../../packages/contracts/README.md). Проверки API с БД и сценарии двух
пользователей остаются необходимыми после реализации.


## SVG-профиль реализации — подготовка 20 октября

Формы HTTP/API остаются 0.13.0; для первоначальной реализации MEDIA-00 закреплён
[SVG-профиль 1.0.0](../architecture/svg-profile.md), машинный список/лимиты —
`packages/contracts/svg-policy.json`. Парсер encoding/xml Go 1.27.2, 128 КиБ
до/после нормализации, глубина 16, 512 элементов и другие конечные бюджеты.
Размер даёт прежний 413 PAYLOAD_TOO_LARGE, содержимое/сложность — прежний
422 VALIDATION_ERROR с `/svg`. Примеры ожидаемого поведения — svg-cases.json;
серверного исполнения этих случаев ещё нет. Клиент не подменяет серверную
проверку и показывает понятное сообщение при неподдерживаемой графике.
