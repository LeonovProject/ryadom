// Package seed owns the versioned demonstration dataset. It never deletes data,
// starts migrations, creates sessions or runs on ordinary API startup.
package seed

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

const Version = "2026-10-20.1"

var (
	ErrDatabaseNotEmpty = errors.New("database contains data without the complete demo account markers; no changes made")
	ErrInvalidOptions   = errors.New("invalid seed reference time or preset ID")
	presetIDPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
)

type Options struct {
	// Clock is read after the database barrier. Nil uses the current time.
	Clock func() time.Time
	// PresetID must come from this build's shared manifest. Empty means NONE for
	// these predefined demo accounts only, never a registration bypass.
	PresetID string
}

type Result struct {
	Applied  bool
	Version  string // Supported version of this build, not a claim about older data.
	BaseDate string // Actual inserted date in Asia/Krasnoyarsk; empty on a no-op.
}

type Beginner interface {
	BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
}

// Initialize is the explicit ordinary-seed wrapper. It performs one commit and
// leaves every existing row alone. A failed operation is never automatically retried.
func Initialize(ctx context.Context, db Beginner, options Options) (Result, error) {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Result{}, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	result, err := Apply(ctx, tx, options)
	if err != nil {
		return Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return result, nil
}

// Apply populates only an empty dataset using the caller's transaction. The
// caller must roll back on any error. BE-12 first holds its exclusive demo_state
// barrier, checks ADMIN/version/generation and deletes subjects itself; this
// function can then insert fresh UUIDs without committing or replacing a receipt.
func Apply(ctx context.Context, tx pgx.Tx, options Options) (Result, error) {
	if options.PresetID != "" && !presetIDPattern.MatchString(options.PresetID) {
		return Result{}, ErrInvalidOptions
	}
	var singleton int
	if err := tx.QueryRow(ctx, "SELECT id FROM demo_state WHERE id=1 FOR SHARE").Scan(&singleton); err != nil {
		return Result{}, err
	}
	// Serialize two explicit initializers without bypassing the common barrier.
	// READ COMMITTED then sees the first initializer's committed account markers.
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext(current_schema()), 20261020)"); err != nil {
		return Result{}, err
	}
	var nonempty bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts)
		OR EXISTS(SELECT 1 FROM account_avatars) OR EXISTS(SELECT 1 FROM sessions)
		OR EXISTS(SELECT 1 FROM organizations) OR EXISTS(SELECT 1 FROM organization_applications)
		OR EXISTS(SELECT 1 FROM activity_types) OR EXISTS(SELECT 1 FROM events)
		OR EXISTS(SELECT 1 FROM participations) OR EXISTS(SELECT 1 FROM messages) OR EXISTS(SELECT 1 FROM reports)`).Scan(&nonempty); err != nil {
		return Result{}, err
	}
	if nonempty {
		var markers int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM accounts WHERE
			(demo_key,email) IN (('alex','alex@example.test'),('anna','anna@example.test'),
			('marina','marina@example.test'),('blocked','blocked@example.test'),
			('ivan','ivan@example.test'),('dasha','dasha@example.test'))`).Scan(&markers); err != nil {
			return Result{}, err
		}
		if markers != 6 {
			return Result{}, ErrDatabaseNotEmpty
		}
		// Presence is only a safe no-op marker, not proof of dataset completeness.
		return Result{Version: Version}, nil
	}
	clock := options.Clock
	if clock == nil {
		clock = time.Now
	}
	data, err := build(clock(), options.PresetID)
	if err != nil {
		return Result{}, err
	}
	if err := data.insert(ctx, tx); err != nil {
		return Result{}, err
	}
	return Result{Applied: true, Version: Version, BaseDate: data.baseDate}, nil
}
