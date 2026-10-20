-- name: ReadOwnEventReport :one
SELECT * FROM reports WHERE reporter_account_id=$1 AND target_event_id=$2;
-- name: CreateEventReport :one
INSERT INTO reports(reporter_account_id,target_type,target_event_id,created_at,updated_at) VALUES ($1,'EVENT',$2,$3,$3) RETURNING *;
-- name: IncrementEventReportsRevision :exec
UPDATE events SET reports_revision=reports_revision+1,updated_at=$2 WHERE id=$1;
-- name: DismissEventReports :exec
WITH closed AS (UPDATE reports SET status='DISMISSED',reviewed_at=sqlc.arg(reviewed_at),reviewed_by=sqlc.arg(reviewed_by),updated_at=sqlc.arg(reviewed_at)
 WHERE target_event_id=sqlc.arg(target_id)::uuid AND status='OPEN' RETURNING id)
UPDATE events SET reports_revision=reports_revision+1,updated_at=sqlc.arg(reviewed_at) WHERE id=sqlc.arg(target_id)::uuid AND EXISTS(SELECT 1 FROM closed);
-- name: ReadOwnMessageReport :one
SELECT * FROM reports WHERE reporter_account_id=$1 AND target_message_id=$2;
-- name: CreateMessageReport :one
INSERT INTO reports(reporter_account_id,target_type,target_message_id,created_at,updated_at) VALUES ($1,'MESSAGE',$2,$3,$3) RETURNING *;
-- name: IncrementMessageReportsRevision :exec
UPDATE messages SET reports_revision=reports_revision+1,updated_at=$2 WHERE id=$1;
-- name: DismissMessageReports :exec
WITH closed AS (UPDATE reports SET status='DISMISSED',reviewed_at=sqlc.arg(reviewed_at),reviewed_by=sqlc.arg(reviewed_by),updated_at=sqlc.arg(reviewed_at)
 WHERE target_message_id=sqlc.arg(target_id)::uuid AND status='OPEN' RETURNING id)
UPDATE messages SET reports_revision=reports_revision+1,updated_at=sqlc.arg(reviewed_at) WHERE id=sqlc.arg(target_id)::uuid AND EXISTS(SELECT 1 FROM closed);
-- name: RestoreMessage :exec
UPDATE messages SET status='VISIBLE',moderation_revision=moderation_revision+1,restored_at=$2,restored_by=$3,updated_at=$2 WHERE id=$1;
