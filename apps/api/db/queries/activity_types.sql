-- name: ListApprovedActivityTypes :many
SELECT id, name FROM activity_types
WHERE catalog_status = 'APPROVED' ORDER BY normalized_name, id;
