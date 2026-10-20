-- name: InsertOrganization :one
INSERT INTO organizations(owner_account_id,name,description,sport_interests) VALUES ($1,$2,$3,$4) RETURNING id;

-- name: LockOrganizationForSubmission :one
SELECT id,owner_account_id FROM organizations WHERE id=$1 FOR UPDATE;

-- name: ReadPrivateOrganization :one
SELECT sqlc.embed(o), a.id AS application_id,a.status AS application_status,
 a.created_at AS application_created_at,a.reviewed_at,a.reviewed_by,a.rejection_reason
FROM organizations o LEFT JOIN organization_applications a ON a.organization_id=o.id
WHERE o.id=$1;

-- name: ListOwnedOrganizations :many
SELECT sqlc.embed(o), a.id AS application_id,a.status AS application_status,
 a.created_at AS application_created_at,a.reviewed_at,a.reviewed_by,a.rejection_reason
FROM organizations o LEFT JOIN organization_applications a ON a.organization_id=o.id
WHERE o.owner_account_id=sqlc.arg(owner_id)::uuid
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (o.created_at,o.id)<(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY o.created_at DESC,o.id DESC LIMIT sqlc.arg(page_size);

-- name: ReadPublicOrganization :one
SELECT o.id,o.name,o.description,o.sport_interests,o.created_at,(owner.status='BLOCKED')::boolean AS owner_is_blocked
FROM organizations o JOIN organization_applications a ON a.organization_id=o.id
JOIN accounts owner ON owner.id=o.owner_account_id WHERE o.id=$1 AND a.status='APPROVED';

-- name: ListAdminOrganizations :many
SELECT sqlc.embed(o), a.id AS application_id,a.status AS application_status,
 a.created_at AS application_created_at,a.reviewed_at,a.reviewed_by,a.rejection_reason
FROM organizations o LEFT JOIN organization_applications a ON a.organization_id=o.id
WHERE (sqlc.arg(search_query)::text='' OR (strpos(lower(btrim(regexp_replace(o.name, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))),sqlc.arg(search_query)::text)>0 OR strpos(lower(btrim(regexp_replace(o.description, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))),sqlc.arg(search_query)::text)>0 OR strpos(lower(btrim(regexp_replace(o.sport_interests, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))),sqlc.arg(search_query)::text)>0))
 AND (sqlc.arg(approval_state)::text='' OR coalesce(a.status,'NOT_SUBMITTED')=sqlc.arg(approval_state)::text)
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (o.created_at,o.id)>(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY o.created_at,o.id LIMIT sqlc.arg(page_size);
