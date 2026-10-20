-- name: ListApprovedActivityTypes :many
SELECT id, name FROM activity_types
WHERE catalog_status = 'APPROVED' ORDER BY normalized_name, id;

-- name: FindActivityForCreation :one
SELECT id FROM activity_types WHERE normalized_name = $1 FOR SHARE;

-- name: LockActivityForCreation :one
SELECT id FROM activity_types WHERE id = $1 FOR SHARE;

-- name: InsertPendingActivity :exec
INSERT INTO activity_types (name, normalized_name, created_by_account_id)
VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING;
