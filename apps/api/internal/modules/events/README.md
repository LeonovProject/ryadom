# BE-03 — чтение встреч и направлений

База передачи — **ee620a7**, ветка `codex/be-03-event-reads`, отдельный worktree.
Реализованы и проверены четыре операции OpenAPI **0.13.0**. Общая регистрация
передаётся координатору через [integration.py](integration.py), который выдаёт фиксированный патч: в этой
ветке `cmd/api/main.go` и общая HTTP-оболочка **не менялись**. Полный запуск
проверен на временном снимке с применённым патчем. До его интеграции обычная
сборка этой ветки ещё не публикует новые маршруты.

## Поведение

| Операция | Результат |
| --- | --- |
| listActivityTypes | Полный APPROVED-список, `normalized_name, id`; только `id/name`, пустой `items: []` |
| listEvents | Только PUBLISHED, все фильтры до LIMIT; `startsAt, id ASC`, только PublishedEventSummary |
| getEvent | Полная опубликованная карточка либо ограниченная недоступная; свежие собственное участие, confirmedCount и capabilities |
| listMyEvents | Без organizationId только личные; с ним только текущая своя организация, чужая/неизвестная 404, включая ADMIN; `createdAt, id DESC` |

Все четыре операции используют общий `transaction.Runner`: сначала барьер
demo_state, затем актуальные sessions/ACTIVE и замок аккаунта для закрытых/
необязательных сессий. Публичные списки игнорируют cookie; некорректная cookie
на getEvent даёт SESSION_EXPIRED. Чтения не создают/не изменяют предметные данные.

q — подстрока в названии, описании или имени направления после свёртки Unicode-
пробелов/регистра; `%`, `_`, кавычки остаются буквальными символами. city — точное
нормализованное совпадение. Пустые q/city равны отсутствию. Поиск и фильтр по ID
работают также для PENDING/REJECTED-направлений; в общий справочник они не входят.

from/to — независимые абсолютные границы `[from,to)`. dateFrom/dateTo сравниваются
с `(starts_at AT TIME ZONE timezone)::date` каждой встречи через AND, до LIMIT.
Неверные календарные даты, пустые границы, равные/обратные диапазоны — 400.
Абсолютные доли меньше микросекунды округляются вверх перед передачей в PostgreSQL,
чтобы сохранить смысл включительной/исключительной границы при точности БД.
startsAt в ответе — UTC; исходная IANA-зона сохраняется отдельным полем.

Keyset-курсор подписан HMAC-SHA256 с отдельным ключом, производным от серверного
секрета. Он привязан к операции, всем нормализованным фильтрам и аккаунту личного
списка. limit можно менять. Повреждение/смена области — INVALID_CURSOR. Нет
снимка данных: вставки/удаления между страницами не удерживают старую БД. Курсор
не требует существования граничной строки и сохраняется после перезапуска с тем
же ключом. Последняя полная страница имеет nextCursor=null, если продолжения нет.

Авторство карточки определяется личным организатором либо текущим ответственным
организации. ADMIN без авторства не получает права автора. При `now >= startsAt`
EVENT_STARTED перекрывает остальные причины недоступности записи; чтение состава,
обсуждение и право автора на фон от начала не закрываются. activityTypeReview
получает только автор опубликованной встречи; другим, включая ADMIN, — null.

UNPUBLISHED отсутствует в каталоге. getEvent доступен автору, ADMIN или владельцу
любой своей записи (PENDING/CONFIRMED/REJECTED). У постороннего/гостя — 404.
Ответ содержит ровно id/title/publicationStatus/myParticipation/unpublishReason/
canJoin=false. Причина — только автору/ADMIN. В собственном списке снятая сводка
содержит лишь id/title/publicationStatus; canManageParticipants сохраняет чтение
состава. Нет времени, места, организатора, SVG или дополнительных полей.
Блокировка автора отражается публичными isBlocked/ownerIsBlocked и не меняет
публикацию, допуск организации или участие.

## Файлы и регистрация

- `events.go`, `filters.go`, `cursor.go` — обработчики, разрешения, DTO, фильтры/курсор.
- `../activitytypes/activitytypes.go` — единственный публичный читатель справочника.
- `../../../db/queries/events.sql`, `activity_types.sql` — запросы DATABASE;
  `../../db/events.sql.go`, `activity_types.sql.go` — их sqlc-генерация.
- `*_test.go` — модульные и настоящие HTTP/PostgreSQL-тесты.
- `testdata/compose.yaml`, `http_accept.py`, `browser.cjs` — изолированная приёмка.
- `integration.py` — выдаёт точечный патч двух общих файлов для COORDINATOR;
  проверяет SHA-256 исходников общей базы, не применяет изменения сам.

BACKEND/DATABASE совмещены одним исполнителем последовательно. Существующие
SQL-запросы аккаунтов/сессий не изменялись. sqlc **1.31.1** запущен из закреплённого
образа; Docker-сборка повторяет генерацию и сравнивает её с сохранёнными файлами.
Миграции, зависимости, OpenAPI/HTTP-примеры, Go/TS DTO, фронтенд и общая среда
этой задачей не менялись. Обслуживание фонов и пользовательских SVG относятся к MEDIA.

Координатору после интеграции серверных файлов:

```bash
python3 apps/api/internal/modules/events/integration.py --output /tmp/ryadom-be03-integration.patch
git apply --check /tmp/ryadom-be03-integration.patch
git apply /tmp/ryadom-be03-integration.patch
```

Патч добавляет events.New(accountService, cfg.JWTSecret, time.Now), регистрацию
трёх событийных операций и activitytypes.Register. Другой участок исправляет
два обнаруженных расхождения общей проверки с действующим контрактом:
пустые q/city разрешены; пустой/слишком длинный cursor даёт INVALID_CURSOR.
Валидация допустимых имён/повторяющихся параметров и остальных полей сохраняется.
Это исправление транспорта без изменения контракта. Требуется последовательное
применение владельцем; отдельная папка тестирования не заменяет интеграцию в main.

## Проверки

Полный контейнерный `go test -race -count=1 ./...` прошёл с настоящими PostgreSQL/
goose, включая прежние DB/AUTH/SVG/transport-группы. После добавления проверки
долей микросекунды и всех полей курсора повторно прошёл модуль events с race.
Без RYADOM_EVENTS_TEST_DATABASE_URL SQL-группа явно пропускается; контейнерный
overlay задаёт переменную и в принятом прогоне пропусков этой группы нет.

Проверены пустые списки; справочник; неутверждённые направления; литеральный поиск;
все фильтры до пагинации; локальные полуночи Красноярска/Москвы при одном UTC-
моменте; смена DST; независимость от SQL-зоны; ошибочные даты/диапазоны; точные
границы; сортировка и одинаковые даты; изменение limit; удаление граничной строки/
вставка перед курсором; подпись и все фильтры/аккаунт/операция курсора; приватные
сведения/роли; обе формы DTO; все статусы участия; свежесть после ожидания барьера.
Ответы списков/карточек дополнительно проверяются каноническими OpenAPI-схемами.

Воспроизведение SQL-проверки из корня этой ветки:

```bash
docker build --network=host -f apps/api/internal/platform/svg/testdata/Dockerfile -t ryadom-be03-go-check .
compose_args=(-p ryadom-be03 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml -f apps/api/db/seed/testdata/compose.yaml -f apps/api/internal/platform/svg/testdata/compose.yaml -f apps/api/internal/modules/auth/testdata/compose.yaml -f apps/api/internal/modules/events/testdata/compose.yaml)
docker compose "${compose_args[@]}" up -d --wait db
docker compose "${compose_args[@]}" run --rm --no-deps go-check go test -race -count=1 ./...
docker compose "${compose_args[@]}" down
```

Сеть хоста требуется только сборщику в этой среде из-за его DNS. БД проверки —
отдельный проект с tmpfs без опубликованных портов, не общий preview.

Реальный HTTPS-проход выполнен на снимке от ee620a7 + BE-03 + патч регистрации,
с вебом из **того же общего коммита**. Снимок не меняет рабочую копию фронтенда.
Для повторения выбрать новый выходной каталог и применить патч только в нём:

```bash
task_source="$PWD"
python3 infra/prepare_source.py --web-source "$task_source" --output /tmp/ryadom-be03-review
cd /tmp/ryadom-be03-review
python3 apps/api/internal/modules/events/integration.py --output /tmp/ryadom-be03-review.patch
git apply /tmp/ryadom-be03-review.patch
docker build --network=host --target api -t ryadom-be03-api .
docker build --network=host --target migrate -t ryadom-be03-migrate .
docker build --network=host --target seed -t ryadom-be03-seed .
docker build --network=host -f infra/web/Dockerfile --build-arg WEB_DEMO_ACCESS=true -t ryadom-be03-web .
cd "$task_source"
python3 apps/api/internal/modules/events/testdata/http_accept.py --source /tmp/ryadom-be03-review --browser --screenshots /tmp/ryadom-be03-browser
```

Для браузера нужны @playwright/test и Chromium. При внешней установке задать
PLAYWRIGHT_MODULE и PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. Проверка сама создаёт
случайный проект ryadom-eventscheck-*, секреты/локальный TLS-сертификат, свободную
подсеть и порт, выполняет явный seed только в своей БД, затем удаляет свой том.
Проверяет настоящий Nginx/JWT/SQL, три сессии, ограниченные ответы, курсоры/
фильтры, одинаковые хеши всех 11 предметных таблиц после чтений и обычного down/up,
сохранение сессии и подписи курсора. Это не публичное развёртывание.

Браузер без перехвата HTTP: главная/направления, каталог на 320/390/768/1280 px,
карточка с зоной встречи при зоне устройства Pacific/Honolulu, reload/back,
реальный вход автора и ограниченная снятая карточка. Скриншоты проверены локально
в /tmp/ryadom-be03-browser; артефакты не добавляются в исходники фронтенда.

Также прошли go vet, check_repository.py, check_handoff.py (48 карточек),
check_api_contract.py (60 операций/100 схем/280 примеров/64 отрицательных),
байтовое сравнение повторной канонической Go/TS-генерации, синтаксис Python/JS,
gofmt и git diff --check с проверкой новых файлов. Все временные проекты удалены.

## Передача и ограничения

Координатор применяет патч регистрации, повторяет предметный Compose-проход,
обновляет общие README/CONTEXT/manifest/статусы и передаёт обновлённый SHA фронтенду.
FE-03 должен принять свои текущие правки отдельно: этот проход проверял веб общей
базы ee620a7, а не параллельную незавершённую ветку другого исполнителя.
BE-03 не закрывает S1–S6: createEvent, участие/решения/обсуждение, организации,
модерация и MEDIA ещё требуют отдельных карточек. BE-04 здесь не начиналась.
Push, изменение общего preview и развёртывание на пользовательском сервере не
выполнялись. Общие файлы остались у назначенного владельца.
