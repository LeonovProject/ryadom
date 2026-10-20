-- name: AccountForLogin :one
SELECT id, email, password_hash, system_role, status FROM accounts WHERE email = $1 FOR SHARE;

-- name: LockSessionActor :one
SELECT id, system_role, status FROM accounts WHERE id = $1 FOR SHARE;

-- name: CreateAccount :one
INSERT INTO accounts (display_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id;

-- name: ReadPublicAccount :one
SELECT a.id, a.display_name, (a.status = 'BLOCKED') AS is_blocked,
    coalesce(v.source, 'NONE')::text AS avatar_source,
    coalesce(v.status, 'EMPTY')::text AS avatar_status,
    coalesce(v.revision, 0)::integer AS avatar_revision, v.preset_id
FROM accounts a LEFT JOIN account_avatars v ON v.account_id = a.id WHERE a.id = $1;

-- name: ReadPrivateAccount :one
SELECT email, system_role FROM accounts WHERE id = $1;

-- name: ListOwnedOrganizationRefs :many
SELECT o.id, o.name, coalesce(a.status, 'DRAFT')::text AS approval_state,
    coalesce(a.status = 'APPROVED', false)::boolean AS can_publish
FROM organizations o LEFT JOIN organization_applications a ON a.organization_id = o.id
WHERE o.owner_account_id = $1 ORDER BY o.created_at, o.id;

-- name: EventOwnedBy :one
SELECT EXISTS(SELECT 1 FROM events e LEFT JOIN organizations o ON o.id=e.organization_id
 WHERE e.id=sqlc.arg(id)::uuid AND coalesce(o.owner_account_id,e.organizer_account_id)=sqlc.arg(created_by_account_id)::uuid);

-- name: OrganizationOwnedBy :one
SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1 AND owner_account_id = $2);
