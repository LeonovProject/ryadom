# Развёртывание Рядом на Ubuntu 24.04.5 LTS

Основной вариант по уточнениям пользователя: **выделенная машина, доступ по IP,
обычный HTTP без домена и сертификата**. Адрес приложения — `http://IP_МАШИНЫ`.
Предустановленный nginx Ubuntu останавливаем; порт 80 занимает web-контейнер
проекта. PostgreSQL и API наружу не публикуются.

Это демонстрационный стенд с вымышленными данными и публичными демопаролями.
HTTP передаёт пароль и cookie сессии без шифрования. Для настоящих данных
используйте HTTPS. Исключение HTTP требует трёх явных настроек ниже; по умолчанию
API по-прежнему запрещает сетевой HTTP. Уточнение — DEC-27.

Инструкция соответствует `compose.yaml` и текущим исходникам **после добавления
ALLOW_INSECURE_HTTP**. В прежнем a65d1c9 этого флага ещё нет: нельзя использовать
его для нового HTTP-запуска. Берите последующий согласованный коммит с этой
инструкцией и изменением config. Сама инструкция не подтверждает развёртывание
на предоставленной машине; пользователь выполняет его самостоятельно.

## 1. Проверка машины

Уже установлены Git 2.43.0, Docker 29.9.1, Compose 5.6.0, Python 3.12.3,
nginx 1.24.0, curl, wget, unzip, htop, tree, vim и nano. Переустановка не нужна.
Go, Node.js, pnpm и PostgreSQL на хост не устанавливаем: сборка и запуск контейнерные.
Команды ниже выполняются в Bash пользователем с `sudo`.

```bash
git --version
sudo docker version
sudo docker compose version
python3 --version
free -h
df -h /srv /var/lib/docker
sudo systemctl enable --now docker
sudo systemctl disable --now nginx
sudo ss -lntp
```

Это выделенная машина для прототипа, поэтому host nginx не нужен. Порт TCP **80**
должен освободиться и быть доступным с компьютера эксперта. При NAT нужен проброс
порта; в облачной/предоставленной сети — соответствующее входящее правило.
Не открывайте 5432 PostgreSQL и внутренний 8080 API. Сохраните доступ SSH.
Не включайте новый firewall вслепую. Публикация Docker взаимодействует с firewall
отдельно от обычных правил UFW: [документация Docker](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## 2. Получить исходники

```bash
sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" /srv/ryadom
git clone git@gitverse.ru:hackrus.experts/cr-pr-final-2026_leonov_product_4.git /srv/ryadom
cd /srv/ryadom
git switch main
git pull --ff-only origin main
git rev-parse HEAD
```

В новой копии `origin` указывает на GitVerse. Нужен SSH-доступ пользователя сервера
к этому репозиторию; при его отсутствии используйте доступный способ клонирования
из GitVerse. Если каталог уже содержит репозиторий, пропустите install/clone,
проверьте `git status` и сохраните местную работу перед обновлением.
Для конкретной согласованной версии: `git switch --detach SHA`.

Проверьте наличие необходимого изменения:

```bash
python3 - <<'PY'
from pathlib import Path
assert 'ALLOW_INSECURE_HTTP' in Path('compose.yaml').read_text(), 'Нужен новый общий коммит с HTTP-режимом'
print('HTTP-режим присутствует в исходниках')
PY
```

`203.0.113.10` ниже — **вымышленный IPv4, замените на IP машины, доступный экспертам**:

```bash
export RYADOM_IP='203.0.113.10'
export RYADOM_PORT='80'
```

## 3. Один раз создать .env

Из `/srv/ryadom` выполнить блок. Он не выводит секреты, создаёт файл с правами
600 и **отказывается перезаписывать существующий .env**.

```bash
cd /srv/ryadom
python3 - <<'PY'
import base64, ipaddress, os, secrets
ip = str(ipaddress.IPv4Address(os.environ['RYADOM_IP']))
port = int(os.environ['RYADOM_PORT'])
assert 1 <= port <= 65535
origin = f'http://{ip}' + (f':{port}' if port != 80 else '')
text = '\n'.join([
    'WEB_BIND=0.0.0.0', f'WEB_PORT={port}', f'WEB_ORIGIN={origin}',
    'COOKIE_SECURE=false', 'DEMO_MODE=true', 'ALLOW_INSECURE_HTTP=true',
    'WEB_DEMO_ACCESS=true',
    'BACKEND_SUBNET=172.30.18.0/24', 'PROXY_BACKEND_IP=172.30.18.10',
    'POSTGRES_USER=ryadom', 'POSTGRES_DB=ryadom',
    'POSTGRES_PASSWORD=' + secrets.token_hex(32),
    'DATABASE_URL=postgres://ryadom:${POSTGRES_PASSWORD}@db:5432/ryadom?sslmode=disable',
    'AUTH_JWT_SECRET=' + base64.b64encode(secrets.token_bytes(32)).decode(), '',
])
with os.fdopen(os.open('.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as file:
    file.write(text)
print('Создан .env; значения секретов не выводятся')
PY
```

| Настройка | Значение для этого стенда |
| --- | --- |
| WEB_ORIGIN | Точный адрес браузера без пути и `/` в конце, например `http://203.0.113.10` |
| WEB_BIND / WEB_PORT | `0.0.0.0` / `80`; публикация единственного web-сервиса |
| DEMO_MODE / ALLOW_INSECURE_HTTP | Оба `true`: явное исключение сетевого HTTP; также доступен подтверждаемый ADMIN-сброс |
| COOKIE_SECURE | `false` для HTTP; HttpOnly, SameSite, JWT и проверка Origin сохраняются |
| WEB_DEMO_ACCESS | `true` при сборке web: /demo, файл доступов и подстановка в login |
| POSTGRES_PASSWORD / AUTH_JWT_SECRET | Два разных случайных секрета; сохраняются при обычных обновлениях |

Без сочетания `DEMO_MODE=true`, `ALLOW_INSECURE_HTTP=true`, `COOKIE_SECURE=false`
API не разрешит HTTP по IP. Флаг не отменяет точное совпадение Origin и не выдаёт
роль ADMIN без пароля. Не выполняйте `source .env`: `${POSTGRES_PASSWORD}`
в DATABASE_URL раскрывает сам Compose. [Правила подстановки](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

Если подсеть `172.30.18.0/24` конфликтует с существующей сетью машины/Docker,
до первого запуска замените BACKEND_SUBNET и PROXY_BACKEND_IP согласованно
на свободную подсеть и адрес внутри неё. Посмотреть: `ip route`,
`sudo docker network ls`, `sudo docker network inspect ИМЯ_СЕТИ`.

## 4. Собрать и запустить

Определите функцию в Bash. После нового SSH-входа повторяйте определение.
Все дальнейшие `dc` используют постоянные каталог, имя проекта и `.env`.
HTTPS override для этого варианта **не подключаем**.

```bash
dc() {
  sudo docker compose --project-name ryadom --env-file /srv/ryadom/.env \
    -f /srv/ryadom/compose.yaml "$@"
}
cd /srv/ryadom
dc config --quiet
dc build migrate api seed web
dc up -d --wait --wait-timeout 180 web
dc ps --all
```

Ожидается: db/api/web — healthy, migrate — Exited (0). Миграции выполняются до API.
Первый build скачивает закреплённые образы и зависимости: нужен интернет.
Не публикуйте обычный вывод `docker compose config`, он раскрывает секреты;
для проверки используется `config --quiet`.

На **новой БД при первом наполнении** явно выполните:

```bash
dc run --rm --no-deps seed
```

Создаются 6 демоаккаунтов, встречи, организации, заявки, сообщения и жалобы.
Seed не запускается при обычном up. Повтор с целым сидом не обновляет даты и
решения; частично заполненную чужую БД не исправляет. После обычных обновлений
его повторять не нужно. Вымышленные пароли публичны, включая ADMIN: не используйте
этот набор с настоящими данными. Выключение страницы /demo не меняет пароли в БД.

## 5. Проверить с сервера и другого компьютера

Подставьте реальный IP, если переменные отсутствуют после нового SSH-входа:

```bash
export RYADOM_IP='203.0.113.10'
RYADOM_URL="http://${RYADOM_IP}"
# При другом внешнем порте: RYADOM_URL="http://${RYADOM_IP}:8080"
cd /srv/ryadom
dc exec -T api /healthcheck
curl --fail "$RYADOM_URL/" -o /dev/null
curl --fail --location "$RYADOM_URL/api/docs" -o /dev/null
curl --fail "$RYADOM_URL/api/openapi.yaml" -o /tmp/ryadom-deployed-openapi.yaml
cmp packages/contracts/openapi.yaml /tmp/ryadom-deployed-openapi.yaml
curl --fail "$RYADOM_URL/demo" -o /dev/null
curl --fail "$RYADOM_URL/demo/accounts.txt" -o /dev/null
dc logs --tail 100 migrate api web
```

Внутренние `/api/v1/health/*` снаружи намеренно закрыты: проверка здоровья идёт
внутри API. Если внешний IP проходит через NAT без обратного доступа с самой
машины, проверьте страницы локально через `http://127.0.0.1` и обязательно
по внешнему адресу **с другого компьютера**.

| Адрес | Назначение |
| --- | --- |
| `http://IP_МАШИНЫ/` | Приложение |
| `/demo` | Демоаккаунты и описания |
| `/demo/accounts.txt` | Скачиваемые доступы |
| `/api/docs` | Swagger UI в режиме просмотра |
| `/api/openapi.yaml` | Текущая схема API |

В форме входа выбрать Алексея (участник), Анну (организации/автор) или Марину
(ADMIN), затем явно нажать «Войти». Выбор сам не выполняет login.
Из двух независимых браузерных профилей проверить создание/поиск встречи,
оба режима записи, вопрос/ответ, модерацию. Обновить страницу и убедиться,
что вход и данные сохраняются. Время встречи подписано её зоной.

Не проверяйте успешность запуска сбросом рабочей БД: ADMIN-сброс завершает
все сессии и удаляет созданные данные, требует отдельного точного подтверждения.
Финальную сетевую приёмку DELIVERY-01B выполняют после этого развёртывания;
локальная QA-01 не подтверждает доступ эксперта извне.

## 6. Резервная копия

Создайте закрытый каталог для текущего пользователя:

```bash
sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/ryadom-backups
umask 077
RYADOM_BACKUP="/srv/ryadom-backups/$(date -u +%Y%m%dT%H%M%SZ).dump"
dc exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$RYADOM_BACKUP"
test -s "$RYADOM_BACKUP"
dc exec -T db pg_restore --list < "$RYADOM_BACKUP" > /dev/null
```

Проверьте успешное завершение всех команд до обновления. Отдельно сохраните
`.env` в защищённом месте: одного дампа недостаточно. Проверять восстановление
следует в отдельном проекте/томе с подходящей схемой, без подмены рабочей БД.

## 7. Обновить без потери данных

Сначала раздел 6, затем записать прежний SHA и обновить согласованную версию:

```bash
cd /srv/ryadom
git status --short
git rev-parse HEAD
git fetch origin main
git switch main
git pull --ff-only origin main
# Либо после fetch: git switch --detach СОГЛАСОВАННЫЙ_SHA
dc build migrate api seed web
dc up -d --wait --wait-timeout 180 web
dc ps --all
```

Повторить раздел 5. Сохраняются `.env`, JWT-ключ и том `ryadom_postgres-data`.
Не менять имя проекта. В обычном обновлении нет seed, ADMIN-reset,
`down --volumes` или удаления тома. Смена JWT-ключа завершает старые входы.
Смена POSTGRES_PASSWORD только в env не меняет пароль уже существующей БД.

Остановить/вернуть с теми же данными: `dc down`, затем
`dc up -d --wait --wait-timeout 180 web`. После перезагрузки постоянные сервисы
возвращаются по restart policy при работающем Docker; проверьте `dc ps`.
Изменение env требует пересоздания соответствующего сервиса; изменение
WEB_DEMO_ACCESS — ещё и пересборки web.

Откат к прежнему SHA допускается только при совместимости старого кода с уже
применённой схемой. Миграции сами назад не откатываются: при несовместимости
нужен согласованный откат БД из копии, а не только `git switch`.

## 8. Если запуск не получился

| Симптом | Проверка |
| --- | --- |
| `permission denied` Docker | Команды Docker здесь идут через sudo; права сокета на 666 не менять |
| `address already in use` | `sudo ss -lntp`; host nginx должен быть остановлен, порт 80 свободен перед запуском |
| Нет доступа с другого компьютера | IP/маршрут, `0.0.0.0:80`, правила предоставленной сети/провайдера, NAT |
| API запрещает HTTP | Новый коммит с ALLOW_INSECURE_HTTP, все три настройки раздела 3, после правки пересоздать API |
| Вход даёт 403 CSRF_REJECTED | WEB_ORIGIN точно совпадает со схемой/IP/портом браузера; используйте основной адрес, не localhost для входа |
| API не healthy | `dc logs --tail 100 migrate api`, успешная миграция, DATABASE_URL, JWT-ключ; секреты в чат не выводить |
| `/demo` отсутствует | WEB_DEMO_ACCESS=true именно при сборке web, затем пересоздание web |
| Аккаунт не входит | Явный seed на новой БД, правильный пароль; blocked-профиль намеренно заблокирован |
| Сборку завершает OOM | RAM/диск; собирать последовательно `dc build migrate`, `dc build api`, `dc build seed`, `dc build web` |
| Не скачиваются зависимости | Проверить интернет/DNS Docker; обход сети сборщика ниже |

Если обычная сеть сборщика не имеет DNS/интернета, из корня допустим обход
только при сборке, без изменения runtime-сетей:

```bash
sudo docker build --network=host --target migrate -t ryadom-migrate:local .
sudo docker build --network=host --target api -t ryadom-api:local .
sudo docker build --network=host --target seed -t ryadom-seed:local .
sudo docker build --network=host --build-arg VITE_DEMO_ACCESS=true -f infra/web/Dockerfile -t ryadom-web:local .
dc up -d --no-build --wait --wait-timeout 180 web
```

## 9. Позже включить HTTPS

Используйте [infra/compose.https.yaml](../../infra/compose.https.yaml) и раздел
HTTPS в [infra/README](../../infra/README.md): WEB_ORIGIN=https://адрес,
COOKIE_SECURE=true, ALLOW_INSECURE_HTTP=false, доступные сертификат/ключ,
публикация TLS-порта. Для публичного IP возможен доверенный сертификат без
домена ([Let's Encrypt](https://letsencrypt.org/2026/03/11/shorter-certs-certbot));
его получение и автопродление — отдельная настройка, не условие
этого HTTP-запуска. Для просмотра и API должен оставаться один origin.

[QA-01](../../tests/e2e/qa01/README.md) описывает проверку ядра до этого уточнения.
Проверка HTTP-исключения и инструкции оформлена отдельно в этом каталоге.
Бизнес-операции, схема БД, OpenAPI и пароли этим решением не меняются.
