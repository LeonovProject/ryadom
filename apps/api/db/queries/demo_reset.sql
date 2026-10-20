-- name: ReadDemoState :one
SELECT * FROM demo_state WHERE id=1;
-- name: RecordDemoReset :exec
UPDATE demo_state SET generation=sqlc.arg(generation)::uuid,last_reset_id=sqlc.arg(reset_id)::uuid,
 last_reset_from_generation=sqlc.arg(previous_generation)::uuid,last_reset_at=sqlc.arg(completed_at)::timestamptz,
 last_reset_seed_version=sqlc.arg(seed_version)::text,last_reset_base_date=sqlc.arg(base_date)::date WHERE id=1;
-- name: DeleteResetReports :exec
DELETE FROM reports;
-- name: DeleteResetMessages :exec
DELETE FROM messages;
-- name: DeleteResetParticipations :exec
DELETE FROM participations;
-- name: DeleteResetEvents :exec
DELETE FROM events;
-- name: DeleteResetOrganizationApplications :exec
DELETE FROM organization_applications;
-- name: DeleteResetOrganizations :exec
DELETE FROM organizations;
-- name: DeleteResetSessions :exec
DELETE FROM sessions;
-- name: DeleteResetAccountAvatars :exec
DELETE FROM account_avatars;
-- name: DeleteResetActivityTypes :exec
DELETE FROM activity_types;
-- name: DeleteResetAccounts :exec
DELETE FROM accounts;
