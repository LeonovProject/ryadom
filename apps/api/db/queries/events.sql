-- name: ListCatalogEvents :many
SELECT sqlc.embed(e), sqlc.embed(t), coalesce(o.name, '')::text AS organization_name,
    coalesce(o.owner_account_id, e.created_by_account_id)::uuid AS responsible_account_id,
    (a.status = 'BLOCKED')::boolean AS owner_is_blocked,
    (SELECT count(*) FROM participations c WHERE c.event_id = e.id AND c.status = 'CONFIRMED')::integer AS confirmed_count,
    p.id AS participation_id, p.account_id AS participation_account_id,
    p.status AS participation_status, p.created_at AS participation_created_at,
    p.decided_at AS participation_decided_at
FROM events e
JOIN activity_types t ON t.id = e.activity_type_id
LEFT JOIN organizations o ON o.id = e.organization_id
JOIN accounts a ON a.id = coalesce(o.owner_account_id, e.organizer_account_id)
LEFT JOIN participations p ON p.event_id = e.id AND p.account_id = sqlc.narg(viewer_id)::uuid
WHERE e.publication_status = 'PUBLISHED'
    AND (sqlc.arg(search_query)::text = '' OR (strpos(lower(btrim(regexp_replace(e.title, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))), sqlc.arg(search_query)::text) > 0 OR strpos(lower(btrim(regexp_replace(e.description, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))), sqlc.arg(search_query)::text) > 0 OR strpos(lower(btrim(regexp_replace(t.name, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))), sqlc.arg(search_query)::text) > 0))
    AND (sqlc.arg(city)::text = '' OR lower(btrim(regexp_replace(e.city, U&'[[:space:]\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g'))) = sqlc.arg(city)::text)
    AND (sqlc.arg(join_mode)::text = '' OR e.join_mode = sqlc.arg(join_mode)::text)
    AND (sqlc.narg(activity_type_id)::uuid IS NULL OR e.activity_type_id = sqlc.narg(activity_type_id)::uuid)
    AND (sqlc.narg(organization_id)::uuid IS NULL OR e.organization_id = sqlc.narg(organization_id)::uuid)
    AND (sqlc.narg(organizer_account_id)::uuid IS NULL OR e.organizer_account_id = sqlc.narg(organizer_account_id)::uuid)
    AND (sqlc.narg(from_time)::timestamptz IS NULL OR e.starts_at >= sqlc.narg(from_time)::timestamptz)
    AND (sqlc.narg(to_time)::timestamptz IS NULL OR e.starts_at < sqlc.narg(to_time)::timestamptz)
    AND (sqlc.narg(date_from)::date IS NULL OR (e.starts_at AT TIME ZONE e.timezone)::date >= sqlc.narg(date_from)::date)
    AND (sqlc.narg(date_to)::date IS NULL OR (e.starts_at AT TIME ZONE e.timezone)::date < sqlc.narg(date_to)::date)
    AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (e.starts_at, e.id) > (sqlc.narg(cursor_time)::timestamptz, sqlc.narg(cursor_id)::uuid))
ORDER BY e.starts_at, e.id LIMIT sqlc.arg(page_size);

-- name: ListOwnedEvents :many
SELECT sqlc.embed(e), sqlc.embed(t), coalesce(o.name, '')::text AS organization_name,
    coalesce(o.owner_account_id, e.created_by_account_id)::uuid AS responsible_account_id,
    (a.status = 'BLOCKED')::boolean AS owner_is_blocked,
    (SELECT count(*) FROM participations c WHERE c.event_id = e.id AND c.status = 'CONFIRMED')::integer AS confirmed_count,
    p.id AS participation_id, p.account_id AS participation_account_id,
    p.status AS participation_status, p.created_at AS participation_created_at,
    p.decided_at AS participation_decided_at
FROM events e
JOIN activity_types t ON t.id = e.activity_type_id
LEFT JOIN organizations o ON o.id = e.organization_id
JOIN accounts a ON a.id = coalesce(o.owner_account_id, e.organizer_account_id)
LEFT JOIN participations p ON p.event_id = e.id AND p.account_id = sqlc.narg(viewer_id)::uuid
WHERE ((sqlc.narg(organization_id)::uuid IS NOT NULL AND e.organization_id = sqlc.narg(organization_id)::uuid
        AND o.owner_account_id = sqlc.arg(owner_id)::uuid)
    OR (sqlc.narg(organization_id)::uuid IS NULL AND e.organization_id IS NULL
        AND e.organizer_account_id = sqlc.arg(owner_id)::uuid))
    AND (sqlc.narg(cursor_time)::timestamptz IS NULL OR (e.created_at, e.id) < (sqlc.narg(cursor_time)::timestamptz, sqlc.narg(cursor_id)::uuid))
ORDER BY e.created_at DESC, e.id DESC LIMIT sqlc.arg(page_size);

-- name: ReadEvent :one
SELECT sqlc.embed(e), sqlc.embed(t), coalesce(o.name, '')::text AS organization_name,
    coalesce(o.owner_account_id, e.created_by_account_id)::uuid AS responsible_account_id,
    (a.status = 'BLOCKED')::boolean AS owner_is_blocked,
    (SELECT count(*) FROM participations c WHERE c.event_id = e.id AND c.status = 'CONFIRMED')::integer AS confirmed_count,
    p.id AS participation_id, p.account_id AS participation_account_id,
    p.status AS participation_status, p.created_at AS participation_created_at,
    p.decided_at AS participation_decided_at
FROM events e
JOIN activity_types t ON t.id = e.activity_type_id
LEFT JOIN organizations o ON o.id = e.organization_id
JOIN accounts a ON a.id = coalesce(o.owner_account_id, e.organizer_account_id)
LEFT JOIN participations p ON p.event_id = e.id AND p.account_id = sqlc.narg(viewer_id)::uuid
WHERE e.id = sqlc.arg(event_id)::uuid
    AND (e.publication_status = 'PUBLISHED' OR coalesce(o.owner_account_id, e.organizer_account_id) = sqlc.narg(viewer_id)::uuid OR sqlc.arg(is_admin)::boolean OR p.id IS NOT NULL);

-- name: ReadOwnedEventsOrganization :one
SELECT id FROM organizations WHERE id = $1 AND owner_account_id = $2;
