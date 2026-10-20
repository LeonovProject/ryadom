# AUTH-01 — общие средства аутентификации

Реализовано 20 октября 2026 после проверенных BE-01/DB-01 в изолированном
worktree бэкенда, ветка `codex/be-01-foundation`, исходный коммит `ab6b105`.
Область: `internal/platform/authn/**`. Пользователь отдельно разрешил минимально
обновить `apps/api/go.mod` и `go.sum` для подключения зависимостей AUTH-01.
SQL, миграции, HTTP-обработчики, OpenAPI 0.13.0 и фронтенд не менялись.

## Реализовано

- [Пароли](password.go): Argon2id PHC v=19, m=19456 КиБ, t=2, p=1,
  соль 16 случайных байт и результат 32 байта. Регистрация принимает 15–128
  Unicode code points, вход — 1–128. Пароль сохраняет пробелы и Unicode без
  trim/нормализации. Проверка результата использует constant-time comparison.
  PHC с другими параметрами или неправильной длиной отклоняется до Argon2id,
  чтобы повреждённая строка не задавала произвольную память/число проходов.
- `VerifyLoginPassword(password, storedHash)` выполняет фиксированную Argon2id
  проверку и при пустом storedHash неизвестного email. Результат неизвестного
  аккаунта всегда false, даже если пароль совпал с входом публичного dummy-хеша.
- [JWT](token.go): только HS256, typ=ryadom-session+jwt, обязательные
  iss=ryadom-api/aud=ryadom-web/sub/jti/iat/exp. UUID канонические и ненулевые,
  даты — целые Unix seconds, exp=iat+86400. Граница now>=exp отклоняется без
  льготы; iat может быть впереди максимум на 30 секунд. Нет refresh/продления.
  Некорректная подпись, algorithm/typ, критические расширения, дубли ключей JSON,
  неканонический base64url и токен длиннее 4096 байт отклоняются.
- `NewTokens` получает декодированный секрет не короче 32 байт из существующей
  конфигурации BE-01, копирует его и не имеет встроенного ключа. `TokenDigest`
  выдаёт SHA-256 в нижнем hex для sessions.token_hash. Объект Token требует
  явного Value() для cookie; обычное форматирование скрывает значение, JSON
  не содержит исходного JWT/ключа. Ошибки пакета фиксированные, без секретов.
- [Попытки](attempts.go): до 10 login на IP/email и до 100 login на IP за
  15 минут; до 20 register на IP за час. Окно начинается с первого запроса;
  считаются разрешённые и отклонённые попытки, успех ничего не обнуляет.
  RetryAfter — максимум оставшегося времени ограничивающих окон, вверх до
  целых секунд, минимум 1. Хранилище процесса ограничено 10000 ключей; при
  заполнении новые ключи получают отказ до ближайшего освобождения. Живые
  счётчики не вытесняются; истёкшие удаляются по TTL. Mutex защищает совместные
  login/register; количество ключей/куча истечения остаются ограниченными.
- `CanonicalEmail` проверяет ASCII 3–254 без пробелов/имени получателя и
  приводит весь адрес к lowercase; точки и +суффиксы сохраняются.
- [Адрес клиента](client_ip.go): по умолчанию только RemoteAddr соединения.
  X-Real-IP учитывается лишь от явно доверенного proxy CIDR и должен содержать
  ровно один IP без порта/зоны/цепочки. X-Forwarded-For/Forwarded игнорируются.
  IPv4-mapped IPv6 приводится к одному IPv4, чтобы не обходить лимиты.

## Подключение BE-02 и OPS-01

Один `NewAttemptLimiter(nil)` живёт на экземпляр API. Создавать его на каждый
запрос нельзя. Origin/транспортная проверка из BE-01 предшествует обработчику;
Resolve и CheckLogin/CheckRegister выполняются **до любого Argon2id**, включая
фиктивную проверку неизвестного email. При `Allowed=false` BE-02 возвращает
429 RATE_LIMITED и `Retry-After: <RetryAfter>`, без вычисления хеша и без
автоматического повторения POST. Неизвестный email и неверный пароль дают один
INVALID_CREDENTIALS. Верный пароль BLOCKED проверяется следующим шагом.

`NewTokens(cfg.JWTSecret, nil)` использует реальное время; тесты передают Clock.
Для новой сессии BE-02 генерирует случайный UUID/jti через uuid.NewRandom(),
выпускает Issue(accountID, sessionID), сохраняет claims и Digest() одной
транзакцией. Cookie с Value() разрешена только после commit. Часы Issue дают
целые секунды, согласованные с ограничениями sessions в миграции DB-01.

`Verify` подтверждает **только криптографию**, не авторизацию. В общем Runner
после demo_state-барьера BE-02 берёт accounts актёра FOR SHARE и проверяет
свежий статус, строку sessions, ID/аккаунт/хеш/время. BLOCKED для ещё действительного
подписанного JWT проверяется до отсутствующей отозванной sessions; данные ролей
берутся из БД. Cookie/очистку, права владения и транзакционный guard добавляет
BE-02. Публичный login при отказе не очищает прежнюю сессию другого аккаунта.

Доверенные сети proxy задаёт OPS-01: Nginx обязан **перезаписывать** X-Real-IP
адресом TCP-клиента. Нельзя доверять произвольным внешним forwarding-заголовкам
или брать клиентский IP из query/тела. Пустой список доверенных сетей безопасно
игнорирует заголовки. Новых переменных окружения и настройки proxy эта карточка
не добавляет; сетевое подключение доверия ещё предстоит координатору.

## Зависимости

Подключены проверенные версии `golang.org/x/crypto v0.58.0` и
`github.com/golang-jwt/jwt/v5 v5.3.1`; уже существующий uuid v1.5.0 стал прямой
зависимостью. Модульный граф требует x/sys v0.49.0, x/sync v0.24.0 и x/text
v0.43.0; остальные закреплённые прямые зависимости и Go 1.27.2 сохранены.
Go.sum обновлён реальным go mod tidy, go mod verify прошёл.

Первичные сведения об API библиотек:
[Argon2id](https://pkg.go.dev/golang.org/x/crypto@v0.58.0/argon2),
[JWT v5.3.1](https://pkg.go.dev/github.com/golang-jwt/jwt/v5@v5.3.1),
[параметры JWT-валидатора](https://golang-jwt.github.io/jwt/usage/parse/).
Параметры проекта задаёт [DEC-20](../../../../../docs/architecture/authentication.md),
а не настройки библиотек по умолчанию.

## Проверки и воспроизведение

Прошли локальные `go test -race -count=1 ./...`, `go vet ./...`, `go mod verify`,
check_repository.py, check_handoff.py, git diff --check и проверка новых файлов.
В локальном запуске без явных адресов SQL-тесты пропускаются; ниже они выполнены
в настоящей временной PostgreSQL без SKIP.

Использована прежняя проверочная среда DB-01, без изменения её файлов:

```bash
docker build --network=host -f apps/api/db/migrations/testdata/Dockerfile -t ryadom-auth01-go-check .
docker compose -p ryadom-auth01 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml up -d --wait db
docker compose -p ryadom-auth01 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml run --rm --no-deps go-check go test -race -count=1 ./...
docker compose -p ryadom-auth01 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml run --rm --no-deps go-check go test ./internal/platform/authn -run '^$' -fuzz '^FuzzJWTValidation$' -fuzztime=3s -parallel=2
docker compose -p ryadom-auth01 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml run --rm --no-deps go-check go test ./internal/platform/authn -run '^$' -fuzz '^FuzzPasswordHashParser$' -fuzztime=3s -parallel=2
docker compose -p ryadom-auth01 -f compose.foundation.yaml -f apps/api/db/migrations/testdata/compose.yaml down
```

Сеть хоста нужна только сборке из-за DNS в стандартной сети сборки этой среды.
Тесты работают в выделенной Compose-сети, без внешних портов/постоянного тома.
Go 1.27.2, PostgreSQL 17.11 и goose 3.29.0 закреплены прежней основой.

Полный контейнерный прогон прошёл с race detector, включая миграции/барьер/
readiness и жизненный цикл HTTP-процесса. Новые тесты проверили независимый
libargon2-вектор, разные соли, пробелы/Unicode/длины, повреждённый PHC, dummy-хеш;
JWT alg/typ/iss/aud/sub/jti/iat/exp, неверную подпись/ключ и точные временные
границы; общие лимиты, счёт всех попыток, округление RetryAfter, заполнение
10000 ключей без вытеснения, конкуренцию и поддельные forwarding-заголовки.
За отдельные короткие fuzz-прогоны проверены 85537 JWT-входов и 115208 PHC-строк,
без паник/падений.

## Остаток

AUTH-01 не подключает HTTP login/register/logout/getMe, серверный guard,
демосид или административную блокировку. DB-02 использует HashPassword для
штатного набора. BE-02 подключает настоящие операции и общую проверку sessions/
ACTIVE после OPS-01/DB-02; общая контейнерная среда и внешний HTTPS остаются
за координатором. Продуктовый вход пока не реализован.

Общие статусы очереди/CONTEXT/manifest обновляет координатор по этому отчёту.
Коммит, push и развёртывание не выполнялись.
