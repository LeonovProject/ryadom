-- name: ReadAdminEvent :one
SELECT sqlc.embed(e),sqlc.embed(t),coalesce(o.name,'')::text AS organization_name,
 coalesce(o.owner_account_id,e.organizer_account_id)::uuid AS responsible_account_id,
 (owner.status='BLOCKED')::boolean AS owner_is_blocked,
 (SELECT count(*) FROM participations p WHERE p.event_id=e.id AND p.status='CONFIRMED')::integer AS confirmed_count,
 (SELECT count(*) FROM reports r WHERE r.target_event_id=e.id AND r.status='OPEN')::integer AS open_event_reports_count,
 (SELECT count(*) FROM reports r JOIN messages m ON m.id=r.target_message_id WHERE m.event_id=e.id AND r.status='OPEN')::integer AS open_message_reports_count
FROM events e JOIN activity_types t ON t.id=e.activity_type_id
 LEFT JOIN organizations o ON o.id=e.organization_id
 JOIN accounts owner ON owner.id=coalesce(o.owner_account_id,e.organizer_account_id)
WHERE e.id=$1;

-- name: ListAdminEvents :many
SELECT sqlc.embed(e),sqlc.embed(t),coalesce(o.name,'')::text AS organization_name,
 coalesce(o.owner_account_id,e.organizer_account_id)::uuid AS responsible_account_id,
 (owner.status='BLOCKED')::boolean AS owner_is_blocked,
 (SELECT count(*) FROM participations p WHERE p.event_id=e.id AND p.status='CONFIRMED')::integer AS confirmed_count,
 (SELECT count(*) FROM reports r WHERE r.target_event_id=e.id AND r.status='OPEN')::integer AS open_event_reports_count,
 (SELECT count(*) FROM reports r JOIN messages m ON m.id=r.target_message_id WHERE m.event_id=e.id AND r.status='OPEN')::integer AS open_message_reports_count
FROM events e JOIN activity_types t ON t.id=e.activity_type_id
 LEFT JOIN organizations o ON o.id=e.organization_id
 JOIN accounts owner ON owner.id=coalesce(o.owner_account_id,e.organizer_account_id)
WHERE true
    AND (sqlc.arg(search_query)::text = '' OR (strpos(lower(btrim(regexp_replace(e.title, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))), sqlc.arg(search_query)::text) > 0 OR strpos(lower(btrim(regexp_replace(e.description, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))), sqlc.arg(search_query)::text) > 0 OR strpos(lower(btrim(regexp_replace(t.name, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))), sqlc.arg(search_query)::text) > 0))

 AND (sqlc.arg(publication_status)::text='' OR e.publication_status=sqlc.arg(publication_status)::text)
 AND (sqlc.narg(organization_id)::uuid IS NULL OR e.organization_id=sqlc.narg(organization_id)::uuid)
 AND (sqlc.narg(activity_type_id)::uuid IS NULL OR e.activity_type_id=sqlc.narg(activity_type_id)::uuid)
 AND (sqlc.narg(has_open_reports)::boolean IS NULL OR (
  EXISTS(SELECT 1 FROM reports r WHERE r.target_event_id=e.id AND r.status='OPEN')
  OR EXISTS(SELECT 1 FROM reports r JOIN messages m ON m.id=r.target_message_id WHERE m.event_id=e.id AND r.status='OPEN')
 )=sqlc.narg(has_open_reports)::boolean)
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (e.created_at,e.id)<(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY e.created_at DESC,e.id DESC LIMIT sqlc.arg(page_size);

-- name: LockEventForUnpublication :one
SELECT * FROM events WHERE id=$1 FOR UPDATE;

-- name: UnpublishEvent :exec
UPDATE events SET publication_status='UNPUBLISHED',unpublished_by=$2,unpublished_at=$3,unpublish_reason=$4,updated_at=$3 WHERE id=$1;

-- name: ResolveOpenEventReports :exec
WITH resolved AS (
 UPDATE reports SET status='RESOLVED',reviewed_at=sqlc.arg(reviewed_at),reviewed_by=sqlc.arg(reviewed_by),updated_at=sqlc.arg(reviewed_at)
 WHERE target_type='EVENT' AND target_event_id=sqlc.arg(event_id)::uuid AND status='OPEN' RETURNING id
)
UPDATE events SET reports_revision=reports_revision+1,updated_at=sqlc.arg(reviewed_at)
WHERE id=sqlc.arg(event_id)::uuid AND EXISTS(SELECT 1 FROM resolved);
