-- name: CreateInitialPresetAvatar :exec
INSERT INTO account_avatars (account_id, source, preset_id, status, revision)
VALUES ($1, 'PRESET', $2, 'APPROVED', 1);
