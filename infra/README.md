# OPS-01 — контейнерный запуск основы

Актуально после интеграции: исходники f4ef6a5 и 6d1dab9 объединены в main.
Временный combined-source больше не нужен. Сборки и полная контейнерная/HTTPS-
приёмка повторены с FE-01–07; [отчёт и локальный просмотр](../docs/development/integration/2026-10-20/README.md).
Ниже сохранены команды и история первоначальной проверки двух worktree.

Реализовано 20 октября 2026 по дополнительному разрешению пользователя вести
OPS-01 и общие файлы. Бэкенд — worktree `codex/be-01-foundation` от `ab6b105`.
Фронтенд FE-01–04 находится отдельно в `codex/fe-01-shell`; для проверки создан
временный объединённый снимок. Чужая рабочая копия не менялась. По поручению пользователя промежуточные
результаты сохранены коммитом в серверной ветке; push не выполнялся.

Работают общий запуск web/API/PostgreSQL, мигратор перед API, отдельный seed,
постоянный том, proxy, healthcheck и локальная HTTPS-конфигурация. Это приёмка
основы. Последующая [BE-02](../apps/api/internal/modules/auth/README.md) уже
подключила настоящие login/register, guard и аккаунты: HTTPS-вход, регистрация
с аватаром и сохранение аутентификации после пересоздания проверены отдельно.
Первоначальная OPS-проверка транспорта cookie использует отдельную
тестовую цель. Этот обработчик не входит в продуктовый API.

## Сборка и локальный запуск

Нужны Docker Engine с Compose v2; для HTTPS override — Compose **2.24.4+**.
Go/Node/pnpm на хосте для сборки образов не нужны. Основные команды выполняются
из корня **объединённых** исходников. Версии и digest базовых образов закреплены
в [versions.json](../tools/foundation/versions.json); добавлен Nginx 1.30.6.

Если сервер и веб пока в разных worktree, подготовить одноразовую копию:

```bash
python3 infra/prepare_source.py \
  --web-source /absolute/path/to/frontend-worktree \
  --output /tmp/ryadom-combined-source
```

Выходной каталог должен быть новым и вне исходных worktree. Скрипт проверяет
совпадение общих OpenAPI/manifest/зависимостей и не копирует node_modules, dist,
локальные env, ключи или сертификаты. Веб получает свои текущие исходники,
сервер/контракты/контейнеры — из этой рабочей копии. Это снимок для сборки,
не merge/коммит и не подмена чужого владения. После интеграции в одну ветку
снимок не нужен. При проверке использован `/tmp/ryadom-ops01-build`.

Создать `.env` по [.env.example](../.env.example), заполнить два разных секрета:
POSTGRES_PASSWORD — `openssl rand -hex 32`, AUTH_JWT_SECRET — `openssl rand -base64 32`.
У DATABASE_URL тот же пароль (для hex URL-кодирование не требуется). JWT-ключ
создаётся один раз, сохраняется при обычных рестартах и не передаётся вебу.
Не используйте вывод `docker compose config` для публикации: он содержит env;
синтаксис можно проверить через `config --quiet`.

```bash
docker compose config --quiet
docker compose build api migrate web seed
docker compose up -d --wait web
# Только явно, на пустой подготовленной БД:
docker compose run --rm --no-deps seed
```

При копировании `.env.example` в объединённый снимок берите его из основной
рабочей копии: prepare_source намеренно исключает env-файлы. Обычный up не
создаёт аккаунтов и не запускает seed. Повтор явного seed сохраняет изменения;
правила и демонстрационные доступы — [DB-02](../apps/api/db/seed/README.md).

Локальный адрес примера — `http://127.0.0.1:8080`, COOKIE_SECURE=false явно.
WEB_ORIGIN обязан точно совпадать со схемой/хостом/портом браузера, без пути и `/`
в конце. База и API портов на хост не публикуют, веб по умолчанию привязан к loopback.

В этой среде DNS стандартной сети сборщика недоступен. Проверенный обход только
для сборки, без изменения runtime-сети:

```bash
docker build --network=host --target api -t ryadom-api:local .
docker build --network=host --target migrate -t ryadom-migrate:local .
docker build --network=host --target seed -t ryadom-seed:local .
docker build --network=host -f infra/web/Dockerfile -t ryadom-web:local .
```

## Устройство и эксплуатация

### Публичные демодоступы

В демонстрационной поставке задать `WEB_DEMO_ACCESS=true` в `.env` и пересобрать
веб: `docker compose build web`, затем `docker compose up -d --wait web`.
Доступны `/demo`, `/demo/accounts.txt` и выбор в форме входа. По умолчанию выключено;
смена переменной требует пересборки. Обычный email/пароль проверяет API, сессии
и БД не сбрасываются. Это не `DEMO_MODE` будущего административного сброса.
Состав и ограничения — [демодоступы](../docs/product/demo-access.md).

Для сборки напрямую добавить `--build-arg VITE_DEMO_ACCESS=true` к команде
`docker build --network=host -f infra/web/Dockerfile -t ryadom-web:local .`.

### Хранение и сеть

[compose.yaml](../compose.yaml) ждёт PostgreSQL health, затем успешный goose up,
затем API readiness и веб. Миграции не создают seed и повторно безопасны.
Мигратор и API собираются из одной версии исходников; ожидаемая схема этой
поставки — **2026102001**. При ошибке миграции новый API не стартует.

[Dockerfile](../Dockerfile) компилирует статические Go-бинарники. Runtime scratch,
CA/часовые пояса, UID 65532, read-only filesystem, без shell/SDK. У веба UID 101,
read-only filesystem и временные каталоги только в tmpfs. Нормализацию SVG перед
веб-сборкой выполняет MEDIA-00. Готовые файлы уже входят по URL manifest; при
пустом каталоге сборка сохраняет работоспособность, регистрацию ограничит BE-02.

[Proxy](web/proxy.conf) сохраняет `/api/v1` и cookie, перезаписывает X-Real-IP,
X-Forwarded-For/Proto/Host/Port, удаляет присланный Forwarded. Внешние forwarding
заголовки не становятся адресом клиента. У API нет опубликованного порта.
DNS upstream обновляется после пересоздания API. Повторов upstream/кеша нет;
личные ответы и ошибки API — no-store. Nginx ограничивает JSON до 1048576 байт;
его 413 и отказ upstream возвращают общий JSON ошибок, не HTML-страницу.

Вложенные SPA-ссылки поддерживают обновление; отсутствующая статика даёт 404.
В том же веб-образе локальные Swagger UI 5.34.0 `/api/docs/` и исходный OpenAPI
`/api/openapi.yaml`, вне React fallback. UI показывает 60 операций версии 0.13.0,
не выполняет запросов изменения и не обращается к CDN/валидатору. Отдельный
сетевой адрес после развёртывания пользователем проверяется в DELIVERY-01B.

```bash
docker compose ps
docker compose logs --tail 100 api migrate web
docker compose exec api /healthcheck
docker compose exec api /healthcheck http://127.0.0.1:8080/api/v1/health/live
docker compose down
# Пересоздание с тем же томом и прежним JWT-ключом:
docker compose up -d --wait web
```

Внутренние health-маршруты через proxy закрыты. Остановка `down` сохраняет
postgres-data; обычное пересоздание не удаляет данные/решения/сессии. Параметр
`--volumes` для рабочей среды не используется. Смена JWT-ключа завершит прежние
JWT и потребует нового входа. Изменение POSTGRES_PASSWORD в env не меняет пароль
уже инициализированного PostgreSQL: настройка существующей БД — отдельная операция.

## HTTPS

Для сетевого входа с паролем нужен HTTPS. Подготовлена конфигурация с TLS именно
в веб-контейнере; произвольному внешнему X-Forwarded-Proto доверие не делегируется.
Задать WEB_ORIGIN=https://ваш-домен (или с портом), COOKIE_SECURE=true,
WEB_TLS_PORT, абсолютные TLS_CERT_PATH/TLS_KEY_PATH. Контейнерному UID 101 нужны
права чтения смонтированных файлов; закрытый ключ остаётся вне репозитория/образа.
WEB_BIND задаётся явно для нужного интерфейса. По умолчанию остаётся loopback.

```bash
docker compose -f compose.yaml -f infra/compose.https.yaml config --quiet
docker compose -f compose.yaml -f infra/compose.https.yaml up -d --wait web
```

Override заменяет публикацию HTTP на TLS-порт, сертификаты монтируются read-only.
Внутренний HTTP health веба наружу не публикуется. Проверка выполнена только
локально с одноразовым тестовым сертификатом; доступ на сервер пользователя,
внешний DNS/сертификат и развёртывание не выполнялись.

## Выполненная приёмка

[accept.py](tests/accept.py) создаёт случайные проекты `ryadom-opscheck-*`, свои
случайные секреты и временный сертификат. Общую/пользовательскую БД не использует.
Удаляет только собственные контейнеры/тома после проверки их сохранности:

```bash
python3 infra/tests/accept.py --source /path/to/combined-source --host-build-network
# Для уже собранных локальных образов:
python3 infra/tests/accept.py --source /path/to/combined-source --no-build
```

Пройдено: старт с пустого тома; реальные миграции до API; отсутствие seed при up;
непубликация DB/API; непривилегированные read-only runtime; SPA/статика/API;
точное совпадение OpenAPI и доступность локальных ресурсов UI; Content-Length
и chunked 413 на 1048577 при пропуске 1048576; явный/повторный seed; сохранение
всех десяти предметных таблиц, demo_state, истории миграций, строки sessions и
JWT-ключа после down/up с тем же томом; live при отказе БД и ready после её
возврата; отказ API без ключа/с неверным ключом; отдельная ошибка миграции,
не допускающая API к запуску; HTTPS с проверкой сертификата; замена поддельных
forwarding-заголовков; Path/HttpOnly/Secure/SameSite/Max-Age cookie и обратная
передача браузерным cookie jar на изолированной тестовой цели; отсутствие
тестовых секретов в логах и конфигурации образа/веба.

[browser.cjs](tests/browser.cjs) проверяет настоящий веб-образ в Chrome:
60 операций OpenAPI 0.13.0, прямой переход/обновление Swagger, локальные ресурсы,
отсутствие изменяющих/внешних запросов; форму входа на 1280 и 390 px, её обновление,
отсутствие горизонтального переполнения, ошибок JavaScript/CSP. При недоступной
проверке сессии форма открывается через явную кнопку, без ложного входа.
Результаты рендера просмотрены; снимки хранятся вне исходников.

```bash
OPS_BASE_URL=http://127.0.0.1:8080 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
node infra/tests/browser.cjs
```

После обычного `pnpm install --frozen-lockfile` Playwright берётся из общего
workspace. Для раздельных worktree тест допускает PLAYWRIGHT_MODULE с абсолютным
путём к уже установленному пакету и OPS_BROWSER_OUTPUT для снимков.
Сервер не содержит подставных бизнес-обработчиков. Реальный login/JWT-guard,
регистрация/явный аватар и сохранение аутентифицированной сессии уже прошли
дополнительную BE-02; все S1–S6/A1–A6 и финальная поставка остаются впереди.
