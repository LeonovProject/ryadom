package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Open is lazy: a database outage must not prevent liveness from starting.
func Open(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("invalid database configuration")
	}
	cfg.ConnConfig.ConnectTimeout = 3 * time.Second
	cfg.MinConns = 0
	cfg.MaxConns = 10
	return pgxpool.NewWithConfig(ctx, cfg)
}

// Ready checks a release's goose version, all required tables and the reset barrier.
// It never creates schema or runs migrations/seed.
func Ready(ctx context.Context, pool *pgxpool.Pool, version int64) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var actual int64
	err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(version_id), 0) FROM (
		SELECT DISTINCT ON (version_id) version_id, is_applied
		FROM goose_db_version ORDER BY version_id, id DESC
	) versions WHERE is_applied`).Scan(&actual)
	if err != nil {
		return err
	}
	if version < 1 || actual != version {
		return fmt.Errorf("schema version mismatch")
	}
	for _, table := range []string{"accounts", "sessions", "account_avatars", "organizations", "organization_applications", "activity_types", "events", "participations", "messages", "reports", "demo_state"} {
		// Identifiers come only from this fixed list, never from a request.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM `+pgx.Identifier{table}.Sanitize()+` LIMIT 0`); err != nil {
			return err
		}
	}
	var id int
	if err := tx.QueryRow(ctx, "SELECT id FROM demo_state WHERE id = 1").Scan(&id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
