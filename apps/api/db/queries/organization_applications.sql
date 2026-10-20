-- name: ReadOrganizationApplication :one
SELECT * FROM organization_applications WHERE organization_id=$1;

-- name: InsertOrganizationApplication :one
INSERT INTO organization_applications(organization_id,created_at,updated_at) VALUES ($1,$2,$2) RETURNING *;

-- name: FindApplicationOrganization :one
SELECT organization_id FROM organization_applications WHERE id=$1;

-- name: LockOrganizationApplication :one
SELECT * FROM organization_applications WHERE id=$1 FOR UPDATE;

-- name: DecideOrganizationApplication :one
UPDATE organization_applications SET status=$2,reviewed_by=$3,reviewed_at=$4,
 rejection_reason=$5,updated_at=$4 WHERE id=$1 RETURNING *;
