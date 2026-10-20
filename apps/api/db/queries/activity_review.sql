-- name: ReadAdminActivity :one
SELECT sqlc.embed(t),(SELECT count(*) FROM events e WHERE e.activity_type_id=t.id)::integer AS event_count FROM activity_types t WHERE t.id=$1;
-- name: LockActivityReview :one
SELECT * FROM activity_types WHERE id=$1 FOR UPDATE;
-- name: ListAdminActivities :many
SELECT sqlc.embed(t),(SELECT count(*) FROM events e WHERE e.activity_type_id=t.id)::integer AS event_count FROM activity_types t
WHERE (sqlc.arg(search_query)::text='' OR strpos(t.normalized_name,sqlc.arg(search_query)::text)>0)
 AND (sqlc.arg(catalog_status)::text='' OR t.catalog_status=sqlc.arg(catalog_status)::text)
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (t.created_at,t.id)>(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY t.created_at,t.id LIMIT sqlc.arg(page_size);
-- name: RenameActivity :exec
UPDATE activity_types SET name=$2,normalized_name=$3,updated_at=$4 WHERE id=$1;
-- name: DecideActivity :exec
UPDATE activity_types SET name=$2,normalized_name=$3,catalog_status=$4,reviewed_by_account_id=$5,reviewed_at=$6,updated_at=$6,rejection_reason=$7 WHERE id=$1;
