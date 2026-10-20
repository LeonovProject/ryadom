-- name: CreateInitialPresetAvatar :exec
INSERT INTO account_avatars (account_id, source, preset_id, status, revision)
VALUES ($1, 'PRESET', $2, 'APPROVED', 1);

-- name: ReadAvatar :one
SELECT * FROM account_avatars WHERE account_id=$1;

-- name: ReadAvatarOrigin :one
SELECT created_at FROM accounts WHERE id=$1;

-- name: EnsureEmptyAvatar :exec
INSERT INTO account_avatars(account_id,created_at,updated_at)
SELECT id,created_at,created_at FROM accounts WHERE id=$1 ON CONFLICT DO NOTHING;

-- name: LockAvatar :one
SELECT * FROM account_avatars WHERE account_id=$1 FOR UPDATE;

-- name: ReplaceAvatar :exec
UPDATE account_avatars SET source=$2,preset_id=$3,svg=$4,status=$5,revision=revision+1,
 uploaded_at=$6,reviewed_at=NULL,reviewed_by=NULL,updated_at=$7 WHERE account_id=$1;

-- name: ModerateAvatar :exec
UPDATE account_avatars SET status=$2,revision=revision+1,reviewed_at=$3,reviewed_by=$4,updated_at=$3
WHERE account_id=$1;

-- name: ReadAdminAvatar :one
SELECT sqlc.embed(v), a.display_name, (a.status='BLOCKED')::boolean AS is_blocked
FROM account_avatars v JOIN accounts a ON a.id=v.account_id WHERE v.account_id=$1 AND v.source='CUSTOM';

-- name: ListAdminAvatars :many
SELECT sqlc.embed(v), a.display_name, (a.status='BLOCKED')::boolean AS is_blocked
FROM account_avatars v JOIN accounts a ON a.id=v.account_id
WHERE v.source='CUSTOM' AND (sqlc.arg(avatar_status)::text='' OR v.status=sqlc.arg(avatar_status)::text)
 AND (sqlc.arg(search_query)::text='' OR strpos(lower(btrim(regexp_replace(a.display_name, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+',' ','g'))),sqlc.arg(search_query)::text)>0)
 AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (v.uploaded_at,v.account_id)>(sqlc.narg(cursor_time)::timestamptz,sqlc.narg(cursor_id)::uuid))
ORDER BY v.uploaded_at ASC,v.account_id ASC LIMIT sqlc.arg(page_size);
