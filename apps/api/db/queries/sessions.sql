-- name: CreateSession :exec
INSERT INTO sessions (id, account_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5);

-- name: SessionMatches :one
SELECT EXISTS(SELECT 1 FROM sessions
WHERE id = sqlc.arg(session_id) AND account_id = sqlc.arg(account_id)
AND token_hash = sqlc.arg(token_hash) AND created_at = sqlc.arg(issued_at)
AND expires_at = sqlc.arg(expires_at) AND expires_at > sqlc.arg(checked_at));

-- name: DeletePresentedSession :exec
DELETE FROM sessions WHERE id = $1 AND account_id = $2 AND token_hash = $3;

-- name: RevokeAccountSessions :exec
DELETE FROM sessions WHERE account_id=$1;
