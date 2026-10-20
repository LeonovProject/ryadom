# Проверка инструкции Ubuntu / HTTP-демостенда

20 октября 2026. База **a65d1c9** плюс рабочая дельта DEC-27. Пользователь
разрешил обычный HTTP для своей выделенной машины без домена. Вместо
неработающей инструкции добавлен явный runtime-флаг ALLOW_INSECURE_HTTP.
Его default false; он требует DEMO_MODE=true. Для HTTP также обязательно
COOKIE_SECURE=false. Штатные HTTPS и локальный HTTP сохраняют прежние правила.

## Выполнено

- Проверен Bash-синтаксис **11 блоков** инструкции, Python-синтаксис **2 программ**.
- Настоящая программа из инструкции создала временный .env с правами 600,
  отказалась перезаписывать его и не вывела секреты. Compose разобрал этот
  файл: внешний 80 → внутренний web 8080, точный http://IPv4 Origin, оба флага,
  CookieSecure=false, демодоступы при сборке, отсутствие портов у API/БД,
  корректное раскрытие DATABASE_URL и JWT-ключ 32 байта.
- Go **1.27.2**, `go test -race -count=1 -v ./internal/platform/config` PASS:
  прежние проверки и новые 12 случаев. HTTP закрыт по умолчанию и без DEMO_MODE,
  принимается только явно, включая публичный/частный IPv4 и нестандартный порт;
  HTTPS всё ещё требует Secure cookie, неверный Origin-URL не принимается.
- Затем полный `go test -race -count=1 -v ./...` и `go vet ./...` в отдельной
  PostgreSQL прошли: 18 пакетов, 120 верхнеуровневых PASS (408 с вложенными).
  [Вывод](evidence/go-race-vet.txt). Опциональный экспорт SVG-образцов SKIP,
  предметные DB-тесты выполнены; экспорт не затронут этим изменением.
- Production API собран с SQL/sqlc-проверкой из текущих исходников:
  `ryadom-http-demo-api`,
  `sha256:3adcd35a613fd79598cf7c32273539b073f0c104b0f02cd3561c96168766010c`.
- [HTTP Compose-проверка](../../infra/tests/http_demo/accept.py) создала свою
  БД/том/секреты/сеть/порт, выполнила миграции и seed, затем удалила свой проект.
  Переиспользованы неизменные migrate/seed/web из QA-01; API новый.
- [Настоящий Chrome](../../infra/tests/http_demo/browser.cjs), без моков и
  перехвата запросов: HTTP origin `ryadom-demo.test` с локальным DNS mapping,
  реальный вход, cookie HttpOnly/SameSite=Lax/Path=/api/v1 **без Secure**,
  сохранение входа после reload, отказ чужому Origin (403 CSRF_REJECTED),
  logout с очисткой cookie. Swagger отображает 60 операций и точную схему.
  DNS mapping меняет только разрешение тестового имени, не HTTP/Origin/cookie.
- Общие проверки репозитория, handoff, контракта (60/100/280/64), Python/JS
  syntax и diff --check прошли. [Привязка к исходникам](verified-sources.json)
  фиксирует базовый SHA и хеши рабочей дельты; [вывод HTTP](evidence/http-compose.txt).
- Обе итоговые строки реального прохода:

```text
PASS real HTTP browser: non-loopback origin, login, non-Secure HttpOnly cookie, reload, foreign Origin denied, logout, Swagger 60 and exact schema
PASS disposable HTTP Compose: migrate, seed, real browser login/HTTP cookie/Origin/logout; no shared DB used
```

Проверка loader на IP и разбор env инструкции подтверждают настройку IP;
браузерный проход использует тестовое сетевое имя на локальной машине.
Это не выдаётся за проверку внешнего IP пользователя или его Ubuntu.

## Воспроизведение адресного прохода

Подготовить локальные образы `ryadom-http-demo-api` из текущего Dockerfile,
`ryadom-qa01-web` из infra/web/Dockerfile с VITE_DEMO_ACCESS=true и обычные
migrate/seed с тегами `ryadom-qa01-migrate` / `ryadom-qa01-seed`. Нужны Docker,
Python, Node/Playwright и Chrome; это инструменты проверки на машине разработки,
их не нужно ставить на пользовательский сервер для обычного запуска.

```bash
python3 infra/tests/http_demo/accept.py --source "$PWD"
```

## Границы

Это изменение транспорта демонстрации после [QA-01](../../tests/e2e/qa01/README.md),
а не повтор всех UI-сценариев ядра. Полный серверный регресс выполнен.
OpenAPI 0.13.0, DTO, схема БД, зависимости, пароли,
Argon2id/JWT, сессии, Origin-проверка и права бизнес-действий не менялись.
ALLOW_INSECURE_HTTP передаётся только API; на web и в ответы не попадает.
DEMO_MODE по-прежнему включает возможность явно подтверждённого ADMIN-сброса,
но up ничего не сбрасывает.

Общий preview и его БД не изменялись, на машину пользователя не заходили.
Внешний доступ проверит пользователь после развёртывания (DELIVERY-01B).
Изменения пока без коммита/push. Предыдущая QA и её свидетельства сохранены.
