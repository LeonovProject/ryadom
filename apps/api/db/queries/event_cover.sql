-- name: SetEventCover :exec
UPDATE events SET cover_svg=$2,updated_at=$3 WHERE id=$1 AND cover_svg IS DISTINCT FROM $2;
