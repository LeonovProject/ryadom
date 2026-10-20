-- name: LockDiscussionEvent :one
SELECT e.id,e.publication_status,coalesce(o.owner_account_id,e.organizer_account_id)::uuid AS responsible_account_id
FROM events e LEFT JOIN organizations o ON o.id=e.organization_id WHERE e.id=$1 FOR UPDATE OF e;

-- name: ReadDiscussionPublication :one
SELECT publication_status FROM events WHERE id=$1 FOR SHARE;

-- name: InsertMessage :one
INSERT INTO messages(event_id,author_account_id,body,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) RETURNING *;

-- name: FindMessageEvent :one
SELECT event_id FROM messages WHERE id=$1;

-- name: LockMessage :one
SELECT * FROM messages WHERE id=$1 FOR UPDATE;

-- name: HideMessage :exec
UPDATE messages SET status='HIDDEN',hidden_at=$2,hidden_by=$3,moderation_revision=moderation_revision+1,updated_at=$2 WHERE id=$1;

-- name: ResolveOpenMessageReports :exec
WITH resolved AS (
 UPDATE reports SET status='RESOLVED',reviewed_at=sqlc.arg(reviewed_at),reviewed_by=sqlc.arg(reviewed_by),updated_at=sqlc.arg(reviewed_at)
 WHERE target_type='MESSAGE' AND target_message_id=sqlc.arg(message_id)::uuid AND status='OPEN' RETURNING id
)
UPDATE messages SET reports_revision=reports_revision+1,updated_at=sqlc.arg(reviewed_at)
WHERE id=sqlc.arg(message_id)::uuid AND EXISTS(SELECT 1 FROM resolved);

-- name: ReadAdminMessage :one
SELECT sqlc.embed(m),(m.author_account_id=coalesce(o.owner_account_id,e.organizer_account_id))::boolean AS author_is_organizer,
 (SELECT count(*) FROM reports r WHERE r.target_message_id=m.id AND r.status='OPEN')::integer AS open_reports_count
FROM messages m JOIN events e ON e.id=m.event_id LEFT JOIN organizations o ON o.id=e.organization_id WHERE m.id=$1;

-- name: ListPublicMessages :many
SELECT m.id,m.event_id,m.author_account_id,m.status,m.created_at,
 CASE WHEN m.status='VISIBLE' THEN m.body ELSE '' END::text AS body,
 (m.author_account_id=coalesce(o.owner_account_id,e.organizer_account_id))::boolean AS author_is_organizer
FROM messages m JOIN events e ON e.id=m.event_id LEFT JOIN organizations o ON o.id=e.organization_id
WHERE m.event_id=sqlc.arg(event_id)::uuid AND e.publication_status='PUBLISHED'
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL
  OR (NOT sqlc.arg(newest_first)::boolean AND (m.created_at,m.id)>(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
  OR (sqlc.arg(newest_first)::boolean AND (m.created_at,m.id)<(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid)))
ORDER BY CASE WHEN sqlc.arg(newest_first)::boolean THEN m.created_at END DESC,
 CASE WHEN sqlc.arg(newest_first)::boolean THEN m.id END DESC,m.created_at,m.id LIMIT sqlc.arg(page_size);

-- name: ListAdminMessages :many
SELECT sqlc.embed(m),(m.author_account_id=coalesce(o.owner_account_id,e.organizer_account_id))::boolean AS author_is_organizer,
 (SELECT count(*) FROM reports r WHERE r.target_message_id=m.id AND r.status='OPEN')::integer AS open_reports_count
FROM messages m JOIN events e ON e.id=m.event_id LEFT JOIN organizations o ON o.id=e.organization_id
WHERE m.event_id=sqlc.arg(event_id)::uuid
 AND (sqlc.narg(has_open_reports)::boolean IS NULL OR EXISTS(SELECT 1 FROM reports r WHERE r.target_message_id=m.id AND r.status='OPEN')=sqlc.narg(has_open_reports)::boolean)
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (m.created_at,m.id)>(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY m.created_at,m.id LIMIT sqlc.arg(page_size);
