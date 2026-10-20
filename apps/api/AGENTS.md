# Сервер

Прочитайте ../../docs/development/handoff/backend.md. BACKEND владеет серверным
кодом; DATABASE — db/** и internal/db/**. COORDINATOR ведёт go.mod/go.sum,
internal/transport/openapi/** и подготовительные internal/foundation/**.
Генерируемый api.gen.go вручную не редактируется: pnpm generate:api из корня.
Перед передачей: go test ./..., общие проверки и нужная контейнерная приёмка.
Тест подготовки с SELECT 1 не доказывает готовность предметной схемы или API.

По принятому пакетному процессу прочитайте
../../docs/development/handoff/work-packets.md. BACKEND сам подключает модули
в cmd/api/main.go; DATABASE единолично ведёт SQL/sqlc. Продолжайте карточки
назначенного пакета последовательно без промежуточного merge. Пакет/отчёт
проверок с итоговым SHA передаются координатору в конце.
