-- name: ParticipationOwnedBy :one
SELECT EXISTS(SELECT 1 FROM participations p JOIN events e ON e.id=p.event_id
 LEFT JOIN organizations o ON o.id=e.organization_id
 WHERE p.id=sqlc.arg(participation_id)::uuid AND coalesce(o.owner_account_id,e.organizer_account_id)=sqlc.arg(owner_id)::uuid);

-- name: LockParticipationEvent :one
SELECT sqlc.embed(e),coalesce(o.owner_account_id,e.organizer_account_id)::uuid AS responsible_account_id
FROM events e LEFT JOIN organizations o ON o.id=e.organization_id WHERE e.id=$1 FOR UPDATE OF e;

-- name: ReadOwnParticipation :one
SELECT * FROM participations WHERE event_id=$1 AND account_id=$2;

-- name: FindParticipationEvent :one
SELECT event_id FROM participations WHERE id=$1;

-- name: LockParticipation :one
SELECT * FROM participations WHERE id=$1 FOR UPDATE;

-- name: InsertParticipation :one
INSERT INTO participations(event_id,account_id,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) RETURNING *;

-- name: DecideParticipation :one
UPDATE participations SET status=$2,decided_by=$3,decided_at=$4,updated_at=$4 WHERE id=$1 RETURNING *;

-- name: ListEventParticipations :many
SELECT * FROM participations WHERE event_id=sqlc.arg(event_id)::uuid
 AND (cardinality(sqlc.arg(statuses)::text[])=0 OR status=ANY(sqlc.arg(statuses)::text[]))
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (created_at,id)>(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY created_at,id LIMIT sqlc.arg(page_size);

-- name: ListMyParticipations :many
SELECT sqlc.embed(p),sqlc.embed(e),sqlc.embed(t),coalesce(o.name,'')::text AS organization_name,
 coalesce(o.owner_account_id,e.organizer_account_id)::uuid AS responsible_account_id,
 (owner.status='BLOCKED')::boolean AS owner_is_blocked
FROM participations p JOIN events e ON e.id=p.event_id JOIN activity_types t ON t.id=e.activity_type_id
 LEFT JOIN organizations o ON o.id=e.organization_id
 JOIN accounts owner ON owner.id=coalesce(o.owner_account_id,e.organizer_account_id)
WHERE p.account_id=sqlc.arg(account_id)::uuid
 AND (cardinality(sqlc.arg(statuses)::text[])=0 OR p.status=ANY(sqlc.arg(statuses)::text[]))
 AND (sqlc.arg(event_window)::text='' OR (e.publication_status='PUBLISHED' AND (
  (sqlc.arg(event_window)::text='UPCOMING' AND e.starts_at>sqlc.narg(reference_time)::timestamptz)
  OR (sqlc.arg(event_window)::text='STARTED' AND e.starts_at<=sqlc.narg(reference_time)::timestamptz)
  OR (sqlc.arg(event_window)::text='STARTED_TODAY' AND e.starts_at<=sqlc.narg(reference_time)::timestamptz
   AND (e.starts_at AT TIME ZONE e.timezone)::date=(sqlc.narg(reference_time)::timestamptz AT TIME ZONE e.timezone)::date))))
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL
  OR (sqlc.arg(event_window)::text IN ('UPCOMING','STARTED_TODAY') AND (e.starts_at,e.id)>(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
  OR (sqlc.arg(event_window)::text='STARTED' AND (e.starts_at,e.id)<(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
  OR (sqlc.arg(event_window)::text='' AND (p.created_at,p.id)<(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid)))
ORDER BY
 CASE WHEN sqlc.arg(event_window)::text IN ('UPCOMING','STARTED_TODAY') THEN e.starts_at END ASC,
 CASE WHEN sqlc.arg(event_window)::text IN ('UPCOMING','STARTED_TODAY') THEN e.id END ASC,
 CASE WHEN sqlc.arg(event_window)::text='STARTED' THEN e.starts_at END DESC,
 CASE WHEN sqlc.arg(event_window)::text='STARTED' THEN e.id END DESC,
 CASE WHEN sqlc.arg(event_window)::text='' THEN p.created_at END DESC,p.id DESC
LIMIT sqlc.arg(page_size);
