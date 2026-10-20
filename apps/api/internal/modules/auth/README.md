# BE-02 — вход, JWT-сессии и аккаунты

Реализовано 20 октября 2026 после AUTH-01/DB-02/OPS-01 в серверном worktree
`codex/be-01-foundation` от `ab6b105`. Работают шесть операций существующего
OpenAPI **0.13.0**; контракт, генерация DTO, зависимости приложения и миграции
не менялись. По последующему поручению пользователя промежуточные результаты сохранены
коммитом в серверной ветке. Push и развёртывание не выполнялись.

## Реализованные операции

| Операция | Результат |
| --- | --- |
| POST /api/v1/auth/register | USER/ACTIVE, PRESET/APPROVED/revision=1 и сессия одним commit; 201 Me |
| POST /api/v1/auth/login | Проверка пароля/ACTIVE и новая сессия; 200 Me |
| POST /api/v1/auth/logout | Удаление предъявленной сессии и очистка cookie; 204 также гостю/при BLOCKED |
| GET /api/v1/me | Профиль, приватный email, роль, срок сессии, собственные организации |
| GET /api/v1/accounts/{accountId} | Только PublicAccount: id, displayName, avatarUrl, isBlocked; cookie игнорируется |
| GET /api/v1/avatar-presets | Неизменяемый каталог из общего manifest, без зависимости от БД/reset |

Пароли и JWT — существующий AUTH-01. В accounts хранится только Argon2id PHC,
в sessions — SHA-256 полного подписанного JWT, UUID/времена из его claims.
Cookie HttpOnly, SameSite=Lax, Path=/api/v1, Max-Age=86400, без Domain; Secure
для HTTPS. Токена в JSON нет. HTTP-ответ/Set-Cookie выдаётся только после commit.
Неопределённый результат POST не повторяется автоматически; GET /me показывает
текущую сессию и не доказывает выполнение потерянной регистрации.

Email канонизируется в lowercase без изменения точек/суффиксов; пробелы/не-ASCII
отклоняются. Имя trim, пароль сохраняет все исходные байты/Unicode/пробелы.
UNIQUE email разрешает конкурентную регистрацию: один 201, второй EMAIL_TAKEN.
Неизвестный email проверяет фиктивный Argon2id-хеш с общей ошибкой 401; BLOCKED
даёт 403 только после правильного пароля. Ошибки нового входа/регистрации не
меняют прежнюю cookie/сессию. При успешной смене отзывается только предъявленная
старая сессия браузера, другие устройства остаются действующими.

Пустой/исключённый ID, null/пропуск, роль/статус/SVG/чужие поля не создают частичные
данные. Каталог из [единого читателя](../../platform/avatarpresets/catalog.go)
возвращает копии, проверяет уникальность ID/ключей, обязательные поля/UTF-8/размер
и точный локальный URL. Пустой items допустим: закрывает новую регистрацию,
вход сохранёнными аккаунтами остаётся. Исключённый PRESET даёт avatarUrl=null.
CUSTOM URL возвращается только для текущего APPROVED revision; сами операции
загрузки/модерации ещё MEDIA-01A. PRESET-изображение уже включено в веб-образ.

## Общая авторизация для следующих модулей

[Guard](guard.go) подключён к общему Runner BE-01:

1. demo_state FOR SHARE берётся Runner до всех предметных запросов.
2. Подписанный JWT даёт только идентификаторы; accounts актёра берётся FOR SHARE.
3. JWT/срок повторно проверяются **после ожидания**; BLOCKED возвращает 403
   раньше проверки sessions/роли, включая уже удалённые сессии.
4. ACTIVE требует актуальную строку sessions с совпадением sub/jti/хеша/iat/exp
   и текущим сроком; роль читается из БД. Замок актёра держится до commit.
5. Admin проверяется Runner. EventOwner/OrganizationOwner проверяют реальное
   владение через общие SQL-запросы; ADMIN не подменяет автора. Чужое — 404.

Public игнорирует cookie; optional-session допускает отсутствие, неверная/пустая
предъявленная сессия даёт SESSION_EXPIRED и очистку cookie. BLOCKED очищает cookie
только на защищённых/optional-session запросах; ошибка публичного login этого
не делает. Logout допускает очистку после блокировки, но не обходит Origin.
После разблокировки прежний отозванный JWT остаётся SESSION_EXPIRED.
Защищённые callback следующих модулей используют переданную Tx/Actor; не создают
свой pool и не проверяют подпись JWT вместо общего guard.

[Обработчики](handlers.go) используют лимиты AUTH-01 до дорогой криптографии.
429 передаёт Retry-After через общий безопасный fault.Error; транспорт выдаёт
одинаковый формат JSON. Origin/формат/предел тела проверяются прежним транспортом.

## SQL и контейнерная конфигурация

Запросы — [accounts.sql](../../../db/queries/accounts.sql),
[account_avatars.sql](../../../db/queries/account_avatars.sql),
[sessions.sql](../../../db/queries/sessions.sql). Единственный sqlc-пакет —
[internal/db](../../db/db.go), конфигурация — [db/sqlc.yaml](../../../db/sqlc.yaml).
Проверяемая генерация sqlc **1.31.1** добавлена в API Dockerfile: файлы генерируются
из миграций/SQL и сравниваются с сохранёнными. Ручные правки generated запрещены.
Образ инструмента закреплён digest; новых библиотек в go.mod/go.sum нет.

Новые настройки API:

| Переменная | Значение |
| --- | --- |
| AVATAR_PRESETS_FILE | Файл общего manifest, по умолчанию ../../packages/contracts/avatar-presets.json для запуска из apps/api; в образе /assets/avatar-presets.json |
| TRUSTED_PROXY_CIDRS | Явные сети/адреса доверенного proxy через запятую; пусто — только TCP peer, forwarding-заголовки игнорируются |

Compose закрепляет отдельный адрес Nginx в backend-сети и передаёт API только его
/32. BACKEND_SUBNET и PROXY_BACKEND_IP согласованы в env-примере; при конфликте
частных сетей меняются вместе. API/DB не публикуют порты. Nginx перезаписывает
присланные X-Real-IP/forwarding-заголовки. Тестовые Compose-проекты подбирают
свободные отдельные подсети. Ключ JWT сохраняется при обычном пересоздании.

## Выполненные проверки

- Весь Go-набор с race detector в Docker/PostgreSQL прошёл, включая прежние
  миграции/seed/криптографию/HTTP/барьеры/SVG. Новые SQL-тесты не пропущены:
  каждая фикстура создаёт случайную схему и применяет настоящую goose-миграцию.
- Реальный PHC/хеш JWT/сроки, две независимые сессии, успешная замена только одной,
  выход/повторный вход, приватность PublicAccount, роли/владение, пустой каталог,
  обязательный PRESET, корректные Me/пять статусов организаций из демонабора.
- Конкурентная регистрация одного email; deferred SQL-ошибка при commit без
  cookie/аккаунта/аватара и без удаления прежней сессии; без частичного успеха.
- Лимиты login/register и Retry-After, одинаковая ошибка неизвестного email,
  правильный/неправильный пароль BLOCKED, запрет лишних полей/эскалации роли,
  пароль с Unicode/пробелами. Истечение ровно на exp и после ожидания замка.
- Изменение токен-хеша/iat-exp/удаление sessions сразу отзывает доступ; текущая
  роль берётся из БД. Блокировка/удаление сессий во время ожидания отклоняет
  login/GET /me. Чтение и новая регистрация ждут общий reset-барьер.
- [HTTPS-приёмка](../../../../../infra/tests/auth_accept.py): настоящие endpoint
  через Nginx, проверенный локальный TLS-сертификат, cookie двух клиентов,
  регистрация с немедленной статической картинкой, ошибка без потери старой
  сессии, digest в БД, down/up с тем же томом/ключом, GET /me и повторный login
  после пересоздания. Подмена forwarding-заголовков не обходит 429.
- [Chrome](../../../../../infra/tests/auth_browser.cjs): настоящая форма регистрации,
  явный выбор «Спутник», профиль на 390 px, обновление, выход и повторный вход,
  снимок на 1280 px. Ровно три POST, без моков/автоповторов/ошибок JavaScript;
  JWT недоступен JS. Снимки просмотрены.
- Проверены OpenAPI/все 280 примеров и совпадение генерации Go/TypeScript;
  внешняя схема/DTO/версия не менялись. Локальные go vet и проверки репозитория
  выполнены; общая OPS-приёмка прошла повторно после изменения сети proxy.

Пример проверки из корня worktree:

```bash
docker build --network=host -f apps/api/internal/platform/svg/testdata/Dockerfile -t ryadom-be02-go-check .
docker compose -p ryadom-be02 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml -f apps/api/db/seed/testdata/compose.yaml -f apps/api/internal/platform/svg/testdata/compose.yaml -f apps/api/internal/modules/auth/testdata/compose.yaml up -d --wait db
docker compose -p ryadom-be02 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml -f apps/api/db/seed/testdata/compose.yaml -f apps/api/internal/platform/svg/testdata/compose.yaml -f apps/api/internal/modules/auth/testdata/compose.yaml run --rm --no-deps go-check go test -race -count=1 ./...
docker compose -p ryadom-be02 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml -f apps/api/db/seed/testdata/compose.yaml -f apps/api/internal/platform/svg/testdata/compose.yaml -f apps/api/internal/modules/auth/testdata/compose.yaml down
```

Полный запуск образов/HTTPS — [OPS-01](../../../../../infra/README.md).
После сборки одинаковых api/migrate/seed/web образов из объединённого снимка:
`python3 infra/tests/auth_accept.py --source /path/to/combined-source`.
Скрипт использует только новые временные проекты/секреты/БД и очищает их сам.
Без RYADOM_AUTH_TEST_DATABASE_URL SQL-группа Go явно пропускается.

## Границы передачи

После объединения 20 октября ограничение свежей FE-сборки снято: весь
FE-01–07 из 6d1dab9 компилируется и проходит браузерные проверки, реальный
auth-путь повторно принят с сервером f4ef6a5. [Общий отчёт](../../../../../docs/development/integration/2026-10-20/README.md).
Следующее описание — история проверки до объединения, не текущая ошибка сборки.

Свежий фронтенд параллельно развивается: при первой попытке его сборка была
остановлена TS2339/TS2322 в features/admin/organizations/OrganizationListPage.tsx
(queryKey/ref). Чужие файлы не менялись. Для BE-02 использован проверенный
фронтенд FE-01–04 из снимка OPS-01 и актуальный бэкенд:
`/tmp/ryadom-be02-verified-source`. Его сборка и реальный auth-путь прошли.
Это не утверждение о сборке всего свежего фронтенда или готовности S1–S6/A1–A6.

BE-03/BE-05/BE-13 могут использовать общий guard и DTO аккаунта. Каталог/создание
встреч, кабинеты/допуск организаций, участие/обсуждения, модерация/жалобы/сброс,
личные SVG и финальная поставка остаются отдельными карточками.
