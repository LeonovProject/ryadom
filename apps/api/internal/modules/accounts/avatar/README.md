# MEDIA-01A — личные SVG-аватары

База: a65d1c9 (QA-01 завершена). BACKEND/DATABASE, ветка codex/be-03-event-reads.

Подключены десять операций существующего OpenAPI 0.13.0: состояние/загрузка/сброс,
выбор PRESET, три маршрута изображения, очередь/карточка/решение ADMIN.
listAvatarPresets и manifest переиспользуются из BE-02; второй каталог не вводится.
Схема, миграции, зависимости, seed и веб не менялись.

Один SVG-валидатор MEDIA-00; нормализованный TEXT сохраняется с revision в одной
транзакции. Порядок замков: барьер demo_state → аккаунт актёра → аккаунт цели
(ADMIN, FOR SHARE) → account_avatars FOR UPDATE. Повтор PENDING/того же PRESET/EMPTY
не меняет версию; решения ADMIN связаны с просмотренной revision. PRIVATE preview
проверяет сессию; публично только текущий CUSTOM/APPROVED с точной revision.
Изображения выдаются байтами, image/svg+xml, nosniff, CSP sandbox, private/no-store.
При исключении PRESET из manifest его ID/версия сохраняются, URL становится null.

Проверки исполнителя в изолированном Compose/PostgreSQL:

- `go test -race -count=1 -run '^TestMediaAvatar' ./internal/modules/events` — 3 PASS:
  переходы/повторы/старые URL, роли, снятый PRESET, фильтры до LIMIT и курсор;
  131072/131073 байт, UTF-8, опасный XML и 1 МиБ JSON; неизменность после отказа,
  откат отложенной ошибки commit, конкурирующая замена и блокировка аккаунта.
- `go test ./cmd/api ./internal/transport/httpapi ./internal/modules/accounts/avatar`
  — PASS; отдельный процесс без PostgreSQL здесь пропущен, как предусматривает тест.
- sqlc 1.31.1 — генерация успешна. Миграции на реальной PostgreSQL применяются
  фикстурой, предметные запросы выполняются через общий HTTP/transaction runner.

Проверки общего HTTPS/сохранности выполняются после MEDIA-01B для всего серверного
пакета. Полный QA-01 повторно не запускается по поручению пользователя; веб-сценарии
MEDIA-01D/E и итоговая совместная приёмка остаются интегратору.
