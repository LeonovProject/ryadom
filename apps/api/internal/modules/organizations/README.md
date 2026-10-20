# BE-P1 — публикация встреч, организации и допуск

Пакет выполнен последовательно одним BACKEND/DATABASE в ветке
`codex/be-03-event-reads`, worktree `be-03-event-reads/championship_18_10`.
База **origin/main e7d6958**, получена fetch и fast-forward без reset;
предыдущий BE-03 574e593 и интеграция b43dab2 сохранены в истории.
Пользователь назначил BE-04 → BE-05 → BE-06, самостоятельную регистрацию,
проверки/коммиты по карточкам и единую передачу после всего пакета.

| Карточка | Состояние | Коммит / отчёт |
| --- | --- | --- |
| BE-04 | Реализована и проверена | c74dfcd, [создание встречи](../events/BE-04.md) |
| BE-05 | Реализована и проверена | 7754d7d, [профили и заявки](BE-05.md) |
| BE-06 | Реализована и проверена | Итоговый коммит пакета с этим отчётом, [допуск](BE-06.md) |

Итоговый SHA передаётся в сообщении вместе с отчётом; его можно получить
`git log -1 --format=%H`. Проверенный исполняемый API/SQL соответствует исходникам
этого коммита: [code-sources.json](testdata/code-sources.json) фиксирует SHA-256
30 производственных файлов, использованных в сборке и интеграционной приёмке.
Их агрегат (JSON с sort_keys=True/separators=(',',':')):
`e2f7c6853837a2bbcd28191bb6e39a2deffd33874614acc9f949eef208484561`.
После полного прогона производственный код не менялся; добавлены только отчёты
и привязка проверенного кода к итоговому коммиту. Веб проверки — из **e7d6958**,
не снимок параллельной незавершённой фронтенд-ветки.

## Реальные операции

Пакет добавляет девять операций:

- createEvent — личная встреча либо своя APPROVED организация; новый спорт и
  встреча атомарны. NFC/пробелы/регистр не создают дубль направления; PENDING
  не задерживает публикацию, REJECTED не сбрасывается. Будущая дата проверяется
  повторно после ожидания замков; IANA-зона и допустимые тексты обязательны.
- createOrganization, listMyOrganizations, getMyOrganization, getOrganization,
  submitOrganization — отдельный частный профиль и заявка. Публично только
  APPROVED; чужие кабинеты/мутации — 404. Первый submit 201, повтор 200 с прежней
  заявкой и решением, включая REJECTED.
- adminListOrganizations, adminGetOrganization, adminDecideOrganization —
  все состояния/поиск/пагинация, допуск либо отказ с причиной. ADMIN не получает
  владение автоматически. Одинаковое решение возвращает прежний результат;
  противоположное/другая причина — 409 без изменения.

Все маршруты подключены в обычной производственной сборке. Для дальнейшего
слияния не нужны патчи регистрации. Сохраняются общие demo_state → актуальная
сессия/ACTIVE/accounts FOR SHARE → предметные замки → один commit → ответ.
Организация блокируется перед её заявкой; UNIQUE сериализует новые направления.
Блокировка владельца не снимает публикации/допуск и не раскрывает приватные поля.

## Проверки и результат

- BE-04: контейнерный race-набор events — PASS, **20.126s**.
- BE-05: контейнерный race-набор organizations — PASS, **6.987s**.
- Полный финальный серверный `go test -race -count=1 ./...` с настоящими
  PostgreSQL/goose — PASS. Events **21.950s**, organizations **14.684s**; auth,
  миграции, seed, общий SVG, HTTP и общий барьер также PASS. SQL-группы исполнялись,
  не пропускались; overlay задаёт RYADOM_EVENTS_TEST_DATABASE_URL.
- Проверены параллельные имена/подачи/решения, конфликт противоположных решений,
  отложенные ошибки COMMIT с полным откатом, свежая авторизация после ожидания,
  закрытые поля/DTO, все статусы и поиск/курсоры. Ответы проверяются исходными
  OpenAPI-схемами. Нет новой схемы DTO или фиктивного успеха.
- Четыре поставляемых образа (api/migrate/seed/web) построены из снимка с текущим
  сервером. Docker повторно генерирует sqlc и проверяет байтовое совпадение.
  Сборка существующего веба прошла typecheck/build; SVG исходников проверены.
- HTTP по настоящему TLS/Nginx/Go/PostgreSQL — PASS: S1 создать личную встречу с
  новым спортом → найти → открыть вторым человеком; S2 создать профиль → подать →
  найти ADMIN → допустить → опубликовать от организации → открыть вторым человеком.
  Отдельная организация получила отказ, причина доступна владельцу, повторная
  подача и публикация недоступны. USER не получил административного доступа.
- Обычный Compose down/up с тем же томом сохранил новые события, оба решения,
  причину и действующие сессии; продолжили чтения теми же клиентами — PASS.
- Браузер без перехвата API повторил S1/S2 через существующие формы под тремя
  независимыми сессиями. Новый спорт, подтверждённая публикация, допуск/отказ,
  причина в кабинете, публичная организация и её встреча — PASS. Ровно два POST
  создания встреч, два создания организаций, два submit и два решения: без
  автоматических повторов. JS-ошибок/горизонтального переполнения в проверенных
  мобильных состояниях нет. Зона устройства Pacific/Honolulu не подменяла зону.
- go vet ./..., check_repository.py, check_handoff.py (48 карточек/3 пакета),
  check_api_contract.py (60 операций/100 схем/280 примеров/64 отрицательных),
  каноническая Go/TS-генерация с байтовым сравнением, Python/JS-синтаксис,
  gofmt и git diff --check — PASS.

Снимки приёмки просмотрены локально в `/tmp/ryadom-bep1-browser`:
`s1-published-desktop.png`, `s1-second-person-mobile.png`,
`s2-pending-desktop.png`, `s2-approved-admin.png`, `s2-club-event-mobile.png`,
`s2-rejection-owner-mobile.png`. Исходники фронтенда не менялись.
Все временные Compose-проекты приёмки и их тестовые тома удалены; общий preview
и его данные не изменялись. Секреты/сертификаты были только во временной среде.

## Воспроизведение

Из корня проверяемой ветки (закреплённые Docker/Go/sqlc/PostgreSQL):

```bash
docker build --network=host -f apps/api/internal/platform/svg/testdata/Dockerfile -t ryadom-be03-go-check .
compose_args=(-p ryadom-bep1 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml -f apps/api/db/seed/testdata/compose.yaml -f apps/api/internal/platform/svg/testdata/compose.yaml -f apps/api/internal/modules/auth/testdata/compose.yaml -f apps/api/internal/modules/events/testdata/compose.yaml)
docker compose "${compose_args[@]}" up -d --wait db
docker compose "${compose_args[@]}" run --rm --no-deps go-check go test -race -count=1 ./...
docker compose "${compose_args[@]}" down
```

`--network=host` требуется сборщику этой среды из-за DNS. Тестовая БД работает
в отдельной сети/проекте без публикации порта. Для полного HTTPS/браузерного пути:

```bash
task_source="$PWD"
python3 infra/prepare_source.py --web-source "$task_source" --output /tmp/ryadom-bep1-review
cd /tmp/ryadom-bep1-review
docker build --network=host --target api -t ryadom-bep1-api .
docker build --network=host --target migrate -t ryadom-bep1-migrate .
docker build --network=host --target seed -t ryadom-bep1-seed .
docker build --network=host -f infra/web/Dockerfile --build-arg WEB_DEMO_ACCESS=true -t ryadom-bep1-web .
cd "$task_source"
python3 apps/api/internal/modules/organizations/testdata/http_accept.py --source /tmp/ryadom-bep1-review --browser --screenshots /tmp/ryadom-bep1-browser
```

Выходной каталог должен быть новым. Нужны Playwright/Chromium; при внешней
установке задать PLAYWRIGHT_MODULE и PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
Скрипт создаёт случайный проект ryadom-bep1check-*, временный сертификат/секреты,
свободные порт/подсеть, seed только своей чистой БД и удаляет только свой том.
Общая БД не сбрасывается, в пользовательский сервер скрипт не обращается.

## Координатору

Принимать три последовательных коммита от e7d6958 (обычный merge без reset).
Изменены только серверные модули events/activitytypes/organizations и
moderation/organizations, их запросы/sqlc, main.go, тесты и отчёты внутри модулей.
OpenAPI **0.13.0**, общий клиент/Go/TS DTO, миграции, go.mod/go.sum, lock-файлы,
Compose/infra, бренд, корневые документы и фронтенд не менялись.

При интеграции проверить diff/main.go и сохранить исходники проверенного SHA.
Обновить общие статусы/manifest/CONTEXT по этому отчёту: BE-04/05/06 реализованы,
S1/S2 локально проверены, остальные S3–S6/A2/A3 и общая QA/DELIVERY не закрыты.
Совместить с текущей FE-P1 и принять её собственные изменения отдельно; этот
пакет не объявляет принятой незавершённую параллельную ветку фронтенда.
BE-P2 самовольно не начиналась. Коммиты локальные; push, внешнее развёртывание
и сообщения в другие чаты не выполнялись.
