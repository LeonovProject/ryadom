-- +goose Up
-- Statuses are independent columns with finite CHECK sets. Authorization and
-- cross-row business transitions are performed under the shared API transaction.
CREATE TABLE demo_state (
    id smallint PRIMARY KEY CHECK (id = 1),
    generation uuid NOT NULL DEFAULT gen_random_uuid(),
    last_reset_id uuid,
    last_reset_from_generation uuid,
    last_reset_at timestamptz,
    last_reset_seed_version varchar(80),
    last_reset_base_date date,
    CONSTRAINT demo_state_receipt_check CHECK (
        (num_nonnulls(last_reset_id, last_reset_from_generation, last_reset_at,
            last_reset_seed_version, last_reset_base_date) = 0)
        OR (num_nonnulls(last_reset_id, last_reset_from_generation, last_reset_at,
            last_reset_seed_version, last_reset_base_date) = 5
            AND last_reset_from_generation <> generation
            AND btrim(last_reset_seed_version) <> '')
    )
);

-- Only the technical barrier is initialized; no accounts, sessions or seed data.
INSERT INTO demo_state (id) VALUES (1);

CREATE TABLE accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name varchar(120) NOT NULL CHECK (btrim(display_name) <> ''),
    email varchar(254) NOT NULL UNIQUE,
    password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%' AND octet_length(password_hash) <= 512),
    system_role text NOT NULL DEFAULT 'USER' CHECK (system_role IN ('USER', 'ADMIN')),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    blocked_at timestamptz,
    blocked_by_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    demo_key varchar(80) UNIQUE CHECK (demo_key IS NULL OR btrim(demo_key) <> ''),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT accounts_email_check CHECK (
        char_length(email) >= 3 AND email = lower(email COLLATE "C")
        AND email COLLATE "C" ~ '^[!-~]+$' AND email ~ '^[^@]+@[^@]+$'
    ),
    CONSTRAINT accounts_blocking_check CHECK (
        (status = 'ACTIVE' AND blocked_at IS NULL AND blocked_by_account_id IS NULL)
        OR (status = 'BLOCKED' AND blocked_at IS NOT NULL AND blocked_by_account_id IS NOT NULL)
    ),
    CONSTRAINT accounts_admin_active_check CHECK (system_role <> 'ADMIN' OR status = 'ACTIVE')
);

CREATE TABLE account_avatars (
    account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE RESTRICT,
    source text NOT NULL DEFAULT 'NONE' CHECK (source IN ('NONE', 'PRESET', 'CUSTOM')),
    preset_id varchar(64) CHECK (preset_id IS NULL OR preset_id COLLATE "C" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    svg text CHECK (svg IS NULL OR octet_length(svg) BETWEEN 1 AND 131072),
    status text NOT NULL DEFAULT 'EMPTY' CHECK (status IN ('EMPTY', 'PENDING', 'APPROVED', 'HIDDEN')),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    uploaded_at timestamptz,
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT account_avatars_source_state_check CHECK (
        (source = 'NONE' AND status = 'EMPTY' AND preset_id IS NULL AND svg IS NULL
            AND uploaded_at IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (source = 'PRESET' AND status = 'APPROVED' AND preset_id IS NOT NULL AND revision >= 1
            AND svg IS NULL AND uploaded_at IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (source = 'CUSTOM' AND preset_id IS NULL AND svg IS NOT NULL
            AND uploaded_at IS NOT NULL AND revision >= 1
            AND ((status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL)
                OR (status IN ('APPROVED', 'HIDDEN') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)))
    )
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    token_hash text NOT NULL UNIQUE CHECK (token_hash COLLATE "C" ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT date_trunc('second', CURRENT_TIMESTAMP),
    expires_at timestamptz NOT NULL,
    CONSTRAINT sessions_lifetime_check CHECK (
        isfinite(created_at) AND isfinite(expires_at)
        AND created_at = date_trunc('second', created_at)
        AND expires_at = created_at + INTERVAL '24 hours'
    )
);

CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    name varchar(160) NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 4000),
    sport_interests text NOT NULL CHECK (btrim(sport_interests) <> '' AND char_length(sport_interests) <= 2000),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_at timestamptz,
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT organization_applications_decision_check CHECK (
        (status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
        OR (status = 'APPROVED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
        OR (status = 'REJECTED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
            AND rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '' AND char_length(rejection_reason) <= 2000)
    )
);

CREATE TABLE activity_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL CHECK (btrim(name) <> ''),
    normalized_name text NOT NULL UNIQUE CHECK (btrim(normalized_name) <> ''),
    is_seeded boolean NOT NULL DEFAULT false,
    catalog_status text NOT NULL DEFAULT 'PENDING' CHECK (catalog_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_by_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_by_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    reviewed_at timestamptz,
    rejection_reason text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT activity_types_review_check CHECK (
        (is_seeded AND catalog_status = 'APPROVED' AND created_by_account_id IS NULL
            AND reviewed_by_account_id IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
        OR (NOT is_seeded AND created_by_account_id IS NOT NULL
            AND ((catalog_status = 'PENDING' AND reviewed_by_account_id IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
                OR (catalog_status = 'APPROVED' AND reviewed_by_account_id IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
                OR (catalog_status = 'REJECTED' AND reviewed_by_account_id IS NOT NULL AND reviewed_at IS NOT NULL
                    AND rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '' AND char_length(rejection_reason) <= 2000)))
    )
);

CREATE TABLE events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    organizer_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
    activity_type_id uuid NOT NULL REFERENCES activity_types(id) ON DELETE RESTRICT,
    title varchar(160) NOT NULL CHECK (btrim(title) <> ''),
    description text NOT NULL CHECK (btrim(description) <> '' AND char_length(description) <= 10000),
    starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
    timezone varchar(80) NOT NULL CHECK (btrim(timezone) <> ''),
    city varchar(120) NOT NULL CHECK (btrim(city) <> ''),
    location_text text NOT NULL CHECK (btrim(location_text) <> '' AND char_length(location_text) <= 1000),
    conditions text NOT NULL DEFAULT '' CHECK (char_length(conditions) <= 4000),
    cover_svg text CHECK (cover_svg IS NULL OR octet_length(cover_svg) BETWEEN 1 AND 131072),
    join_mode text NOT NULL CHECK (join_mode IN ('OPEN', 'APPROVAL')),
    publication_status text NOT NULL DEFAULT 'PUBLISHED' CHECK (publication_status IN ('PUBLISHED', 'UNPUBLISHED')),
    unpublished_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    unpublished_at timestamptz,
    unpublish_reason text,
    reports_revision integer NOT NULL DEFAULT 0 CHECK (reports_revision >= 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT events_organizer_check CHECK (
        num_nonnulls(organizer_account_id, organization_id) = 1
        AND (organizer_account_id IS NULL OR organizer_account_id = created_by_account_id)
    ),
    CONSTRAINT events_unpublication_check CHECK (
        (publication_status = 'PUBLISHED' AND unpublished_by IS NULL AND unpublished_at IS NULL AND unpublish_reason IS NULL)
        OR (publication_status = 'UNPUBLISHED' AND unpublished_by IS NOT NULL AND unpublished_at IS NOT NULL
            AND unpublish_reason IS NOT NULL AND btrim(unpublish_reason) <> '' AND char_length(unpublish_reason) <= 2000)
    )
);

CREATE TABLE participations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
    decided_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, account_id),
    CONSTRAINT participations_decision_check CHECK (
        (status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL)
        OR (status = 'CONFIRMED' AND ((decided_by IS NULL AND decided_at IS NULL)
            OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)))
        OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    author_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    body text NOT NULL CHECK (btrim(body) <> '' AND char_length(body) <= 4000),
    status text NOT NULL DEFAULT 'VISIBLE' CHECK (status IN ('VISIBLE', 'HIDDEN')),
    hidden_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    hidden_at timestamptz,
    restored_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    restored_at timestamptz,
    moderation_revision integer NOT NULL DEFAULT 0 CHECK (moderation_revision >= 0),
    reports_revision integer NOT NULL DEFAULT 0 CHECK (reports_revision >= 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT messages_moderation_check CHECK (
        (hidden_by IS NULL) = (hidden_at IS NULL)
        AND (restored_by IS NULL) = (restored_at IS NULL)
        AND (status <> 'HIDDEN' OR hidden_by IS NOT NULL)
        AND (restored_at IS NULL OR hidden_at IS NOT NULL)
        AND (status <> 'VISIBLE' OR hidden_at IS NULL OR restored_at IS NOT NULL)
    )
);

CREATE TABLE reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    target_type text NOT NULL CHECK (target_type IN ('EVENT', 'MESSAGE')),
    target_event_id uuid REFERENCES events(id) ON DELETE RESTRICT,
    target_message_id uuid REFERENCES messages(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reports_target_check CHECK (
        (target_type = 'EVENT' AND target_event_id IS NOT NULL AND target_message_id IS NULL)
        OR (target_type = 'MESSAGE' AND target_event_id IS NULL AND target_message_id IS NOT NULL)
    ),
    CONSTRAINT reports_review_check CHECK (
        (status = 'OPEN' AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status IN ('RESOLVED', 'DISMISSED') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    )
);

CREATE INDEX accounts_status_created_idx ON accounts (status, created_at, id);
CREATE INDEX accounts_blocked_by_idx ON accounts (blocked_by_account_id) WHERE blocked_by_account_id IS NOT NULL;
CREATE INDEX account_avatars_queue_idx ON account_avatars (status, uploaded_at, account_id) WHERE source = 'CUSTOM';
CREATE INDEX account_avatars_reviewer_idx ON account_avatars (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
CREATE INDEX organizations_owner_idx ON organizations (owner_account_id);
CREATE INDEX organization_applications_queue_idx ON organization_applications (status, created_at, id);
CREATE INDEX organization_applications_reviewer_idx ON organization_applications (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX activity_types_queue_idx ON activity_types (catalog_status, created_at, id);
CREATE INDEX activity_types_creator_idx ON activity_types (created_by_account_id) WHERE created_by_account_id IS NOT NULL;
CREATE INDEX activity_types_reviewer_idx ON activity_types (reviewed_by_account_id) WHERE reviewed_by_account_id IS NOT NULL;
CREATE INDEX events_catalog_idx ON events (publication_status, starts_at, id);
CREATE INDEX events_activity_catalog_idx ON events (activity_type_id, publication_status, starts_at, id);
CREATE INDEX events_creator_idx ON events (created_by_account_id);
CREATE INDEX events_personal_organizer_idx ON events (organizer_account_id) WHERE organizer_account_id IS NOT NULL;
CREATE INDEX events_organization_idx ON events (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX events_unpublisher_idx ON events (unpublished_by) WHERE unpublished_by IS NOT NULL;
CREATE INDEX participations_event_status_created_idx ON participations (event_id, status, created_at, id);
CREATE INDEX participations_account_status_event_idx ON participations (account_id, status, event_id);
CREATE INDEX participations_decider_idx ON participations (decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX messages_event_created_idx ON messages (event_id, created_at, id);
CREATE INDEX messages_author_idx ON messages (author_account_id);
CREATE INDEX messages_hidden_by_idx ON messages (hidden_by) WHERE hidden_by IS NOT NULL;
CREATE INDEX messages_restored_by_idx ON messages (restored_by) WHERE restored_by IS NOT NULL;
CREATE UNIQUE INDEX reports_event_reporter_key ON reports (reporter_account_id, target_event_id) WHERE target_event_id IS NOT NULL;
CREATE UNIQUE INDEX reports_message_reporter_key ON reports (reporter_account_id, target_message_id) WHERE target_message_id IS NOT NULL;
CREATE INDEX reports_reporter_idx ON reports (reporter_account_id);
CREATE INDEX reports_event_target_idx ON reports (target_event_id) WHERE target_event_id IS NOT NULL;
CREATE INDEX reports_message_target_idx ON reports (target_message_id) WHERE target_message_id IS NOT NULL;
CREATE INDEX reports_open_events_idx ON reports (target_event_id, created_at, id) WHERE status = 'OPEN' AND target_event_id IS NOT NULL;
CREATE INDEX reports_open_messages_idx ON reports (target_message_id, created_at, id) WHERE status = 'OPEN' AND target_message_id IS NOT NULL;
CREATE INDEX reports_reviewer_idx ON reports (reviewed_by) WHERE reviewed_by IS NOT NULL;

-- +goose Down
-- Explicit rollback removes this schema's product tables, never another schema.
DROP TABLE reports;
DROP TABLE messages;
DROP TABLE participations;
DROP TABLE events;
DROP TABLE activity_types;
DROP TABLE organization_applications;
DROP TABLE organizations;
DROP TABLE sessions;
DROP TABLE account_avatars;
DROP TABLE accounts;
DROP TABLE demo_state;
