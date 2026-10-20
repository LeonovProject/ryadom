# Публичные направления — чтение BE-03

`Register(*httpapi.Server)` связывает только listActivityTypes. Справочник читается
из PostgreSQL в общей транзакции/barrier; возвращаются id/name только APPROVED,
сортировка normalized_name/id, без курсора. Cookie публичного запроса игнорируется.

SQL — `db/queries/activity_types.sql`, sqlc — `internal/db/activity_types.sql.go`.
Запись/разрешение нового имени и административная модерация остаются BE-04/BE-10.
Общие зависимости и контракт не менялись. Проверки и передача регистрации —
[в отчёте BE-03](../events/README.md).
