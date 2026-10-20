-- name: ReadAdminAccount :one
SELECT a.id,a.display_name,a.email,a.system_role,a.status,a.revision,a.blocked_at,a.blocked_by_account_id,a.created_at,
 coalesce(v.source,'NONE')::text AS avatar_source,coalesce(v.status,'EMPTY')::text AS avatar_status,
 coalesce(v.revision,0)::integer AS avatar_revision,v.preset_id
FROM accounts a LEFT JOIN account_avatars v ON v.account_id=a.id
WHERE a.id=$1;

-- name: ListAdminAccounts :many
SELECT a.id,a.display_name,a.email,a.system_role,a.status,a.revision,a.blocked_at,a.blocked_by_account_id,a.created_at,
 coalesce(v.source,'NONE')::text AS avatar_source,coalesce(v.status,'EMPTY')::text AS avatar_status,
 coalesce(v.revision,0)::integer AS avatar_revision,v.preset_id
FROM accounts a LEFT JOIN account_avatars v ON v.account_id=a.id
WHERE (sqlc.arg(search_query)::text='' OR strpos(lower(btrim(regexp_replace(a.display_name,U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+',' ','g'))),sqlc.arg(search_query)::text)>0
 OR strpos(lower(a.email),sqlc.arg(search_query)::text)>0 OR a.id=sqlc.narg(exact_id)::uuid)
 AND (sqlc.arg(account_status)::text='' OR a.status=sqlc.arg(account_status)::text)
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (a.created_at,a.id)<(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY a.created_at DESC,a.id DESC LIMIT sqlc.arg(page_size);

-- name: ReadModerationTargetRole :one
SELECT system_role FROM accounts WHERE id=$1;

-- name: LockModeratedUser :one
SELECT id,system_role,status,revision FROM accounts WHERE id=$1 AND system_role='USER' FOR UPDATE;

-- name: SetModeratedAccountStatus :exec
UPDATE accounts SET status=sqlc.arg(account_status)::text,revision=revision+1,
 blocked_at=CASE WHEN sqlc.arg(account_status)::text='BLOCKED' THEN sqlc.arg(changed_at)::timestamptz ELSE NULL END,
 blocked_by_account_id=CASE WHEN sqlc.arg(account_status)::text='BLOCKED' THEN sqlc.arg(changed_by)::uuid ELSE NULL END,
 updated_at=sqlc.arg(changed_at)::timestamptz WHERE id=sqlc.arg(account_id)::uuid AND system_role='USER';
