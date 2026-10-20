-- name: ReadOrganizationApplication :one
SELECT * FROM organization_applications WHERE organization_id=$1;

-- name: InsertOrganizationApplication :one
INSERT INTO organization_applications(organization_id,created_at,updated_at) VALUES ($1,$2,$2) RETURNING *;
