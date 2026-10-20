# BE-01 — основа Go API

Реализовано 20 октября 2026 от `ab6b105`, ветка `codex/be-01-foundation`.
Карточка: [BE-01](../../../../docs/development/tasks/foundation.md#be-01--основа-go-api-и-http-инфраструктура).
Изменения ограничены `cmd/api/**`, `internal/platform/**`, `internal/transport/httpapi/**`.
Общие зависимости, генерация, OpenAPI, миграции, веб и корневые конфигурации не менялись.

Последующая [BE-02](../../internal/modules/auth/README.md) подключила настоящий
вход/регистрацию, аккаунты, каталог аватаров и общий JWT+SQL guard. Схема/seed и
общий контейнерный запуск OPS-01 уже проверены; ниже сохранён исходный отчёт BE-01.

## Что работает

- HTTP-сервер chi: `GET /api/v1/health/live` и `GET /api/v1/health/ready`.
  Префикс `/api/v1` соответствует servers в OpenAPI. Эти внутренние маршруты
  не требуют публикации через proxy.
- Процесс стартует при недоступной БД: live возвращает 200, ready — 503.
  Readiness проверяет точную ожидаемую goose-версию, доступность всех 11 таблиц
  и singleton `demo_state.id=1`; не запускает миграции/seed.
- Каждый ответ содержит новый серверный X-Request-ID и private, no-store.
  Ошибки используют сгенерированный ErrorResponse; SQL, токены, пароли и значения
  некорректных полей не включаются в ответы/диагностику обработчиков.
- Проверка точного Origin для мутаций; JSON/UTF-8, тип тела без сжатия,
  неизвестные/повторённые query-параметры, лишнее тело, параметры пути.
  Обычный лимит 65536 байт, SVG JSON — 1048576; граница включена,
  проверяются Content-Length и поток неизвестной длины.
- Синтаксис/параметры дают 400, поля/лишние свойства — 422 с JSON Pointer.
  Проверка полей защищённого запроса следует после текущей сессии/прав.
  Схемы и метаданные читаются из существующего generated OpenAPI; второго DTO нет.
- Общая транзакция READ COMMITTED: сначала demo_state FOR SHARE, затем guard,
  затем предметный callback. Исключение adminResetDemoData использует FOR UPDATE
  с ожиданием до 5 секунд и повторной проверкой ADMIN после барьера.
  Health и статический каталог аватаров не берут предметный барьер.
- Callback не получает HTTP ResponseWriter. Ответ/Set-Cookie публикуются после
  успешного commit; ошибка приводит к rollback. Автоматических повторов нет.
- SIGTERM/SIGINT завершают сервер с ожиданием активных запросов до 10 секунд.

## Конфигурация и запуск

Нужен закреплённый Go 1.27.2. Из `apps/api`: `go run ./cmd/api`.
Перед запуском задаются переменные окружения:

| Переменная | Назначение |
| --- | --- |
| API_ADDR | Адрес прослушивания, по умолчанию `:8080` |
| DATABASE_URL | PostgreSQL URL с именем БД, без значения по умолчанию |
| DATABASE_SCHEMA_VERSION | Положительная goose-версия схемы, требуемая этой сборкой; назначается при интеграции DB-01 |
| WEB_ORIGIN | Один точный origin без пути и завершающего `/` |
| COOKIE_SECURE | По умолчанию true; локальный HTTP требует явного false и loopback origin; HTTPS требует true |
| AUTH_JWT_SECRET | Base64 минимум 32 случайных байт; без встроенного ключа; неверный/пустой ключ блокирует запуск |

JWT-ключ проверяется как конфигурация; криптография/пароли и реальный guard
будут реализованы AUTH-01/BE-02. Сейчас продуктовых маршрутов не зарегистрировано.
Из-за отсутствия DB-01 и продуктовой среды readiness обычного приложения
пока не означает готовность пользовательских сценариев.

## Подключение следующих модулей

`httpapi.Server.Register(operationID, handler)` берёт путь, метод, x-access,
лимит тела и валидацию из generated OpenAPI. Поддерживаются все шесть режимов:
public / optional-session / session / event-owner / organization-owner / admin.
oapi-codegen меняет регистр operationId во встроенной схеме, поэтому поиск ID
не зависит от регистра. Неизвестные и повторно подключённые операции отклоняются.

AUTH-01/BE-02 передают реализацию `transaction.Guard` в Runner. Authenticate
обязан в переданной транзакции взять accounts актёра FOR SHARE и проверить
подпись/claims JWT, ACTIVE и sessions, в том числе после ожидания блокировок.
Authorize проверяет владение ресурсом; чужие ID скрываются по контракту.
Без guard предъявленная cookie не разрешает защищённый доступ.
Public игнорирует cookie; optional-session без cookie допускает гостя,
а пустая предъявленная cookie передаётся в guard как недействительная сессия.

Ошибки SESSION_EXPIRED/ACCOUNT_BLOCKED на защищённом/optional-session маршруте
передаются с `fault.Error.ClearSession=true`; транспорт очищает HttpOnly cookie
с Path=/api/v1, SameSite=Lax и настроенным Secure. Ошибка публичного login не
должна очищать прежнюю сессию. HTTP-ответ и новая cookie возвращаются результатом
handler, без записи до commit. Предметные модули получают только общую tx,
не создают независимый pool/транзакцию и не обходят барьер.

## Проверка

Из корня репозитория; используется отдельный проект `ryadom-be01`, временная БД
без опубликованных портов и без постоянного тома:

```bash
docker compose -p ryadom-be01 -f compose.foundation.yaml -f apps/api/internal/platform/database/testdata/compose.yaml build go-check
docker compose -p ryadom-be01 -f compose.foundation.yaml -f apps/api/internal/platform/database/testdata/compose.yaml up -d --wait db
docker compose -p ryadom-be01 -f compose.foundation.yaml -f apps/api/internal/platform/database/testdata/compose.yaml run --rm --no-deps go-check go test -race -count=1 ./...
docker compose -p ryadom-be01 -f compose.foundation.yaml -f apps/api/internal/platform/database/testdata/compose.yaml down
```

Прогон выполнен успешно с закреплёнными Go 1.27.2/PostgreSQL 17.11.
Интеграционные тесты действительно выполнены, без SKIP. Проверены неполная
схема/неверная версия/отсутствующий singleton, rollback, ошибка deferred constraint
при commit и реальное ожидание общего PostgreSQL-барьера с последующим чтением
нового статуса аккаунта. Проверен отдельный HTTP-процесс: live 200 / ready 503
при недоступной БД и успешное завершение SIGTERM. Race detector ошибок не нашёл.

Также прошли go vet, локальный go test, check_repository.py, check_handoff.py,
git diff --check и отдельная проверка пробелов в новых файлах. Без
RYADOM_API_TEST_DATABASE_URL живые SQL-тесты и процессный smoke явно пропускаются;
контейнерная команда задаёт этот адрес. SQL-фикстуры создают случайные отдельные
схемы и удаляют только их; это не миграции и не приёмка DB-01.

## Остаток для координатора

DB-01 должна передать настоящие миграции и ожидаемую версию; AUTH-01/BE-02 — guard.
OPS-01 объединяет основу с БД, миграциями, вебом/proxy и постоянным томом;
там ещё требуется проверка реальной схемы и сохранения данных после пересоздания.
DOCS-01 подключает Swagger UI. Изолированный прогон BE-01 не закрывает эти
карточки, продуктовые сценарии и общую контейнерную приёмку.

Статусы общей очереди/CONTEXT/manifest должен обновить координатор по этому отчёту.
По последующему поручению пользователя промежуточные результаты сохранены
коммитом в серверной ветке. Push, публикация и развёртывание не выполнялись.
