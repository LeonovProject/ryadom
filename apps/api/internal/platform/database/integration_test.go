package database_test

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/database"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/transaction"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func fixture(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("RYADOM_API_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set RYADOM_API_TEST_DATABASE_URL to an isolated PostgreSQL 17 database")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "be01_" + strings.ToLower(rand.Text())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.ConnConfig.RuntimeParams["application_name"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func execute(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

// These deliberately minimal tables are test fixtures, not DB-01 migrations.
func TestReadinessRequiresSchema(t *testing.T) {
	pool := fixture(t)
	ctx := context.Background()
	if err := database.Ready(ctx, pool, 1); err == nil {
		t.Fatal("empty database ready")
	}
	execute(t, pool, `CREATE TABLE goose_db_version(id bigserial PRIMARY KEY, version_id bigint NOT NULL, is_applied boolean NOT NULL);
	INSERT INTO goose_db_version(version_id,is_applied) VALUES(0,true),(1,true)`)
	for _, table := range []string{"accounts", "sessions", "account_avatars", "organizations", "organization_applications", "activity_types", "events", "participations", "messages", "reports"} {
		column := "id"
		if table == "account_avatars" {
			column = "account_id"
		}
		execute(t, pool, "CREATE TABLE "+pgx.Identifier{table}.Sanitize()+" ("+column+" text PRIMARY KEY)")
	}
	execute(t, pool, "CREATE TABLE demo_state(id smallint PRIMARY KEY CHECK(id=1))")
	if err := database.Ready(ctx, pool, 1); err == nil {
		t.Fatal("missing singleton accepted")
	}
	execute(t, pool, "INSERT INTO demo_state VALUES(1)")
	if err := database.Ready(ctx, pool, 1); err != nil {
		t.Fatal(err)
	}
	if err := database.Ready(ctx, pool, 2); err == nil {
		t.Fatal("wrong migration version ready")
	}
	execute(t, pool, "INSERT INTO goose_db_version(version_id,is_applied) VALUES(2,true),(2,false)")
	if err := database.Ready(ctx, pool, 1); err != nil {
		t.Fatalf("rolled back goose migration: %v", err)
	}
	execute(t, pool, "DROP TABLE reports")
	if err := database.Ready(ctx, pool, 1); err == nil {
		t.Fatal("incomplete schema ready")
	}
}

func TestTransactionRollbackAndDeferredCommitFailure(t *testing.T) {
	pool := fixture(t)
	execute(t, pool, "CREATE TABLE demo_state(id smallint PRIMARY KEY); INSERT INTO demo_state VALUES(1); CREATE TABLE test_writes(id int PRIMARY KEY DEFERRABLE INITIALLY DEFERRED)")
	runner := &transaction.Runner{DB: pool}
	ctx := context.Background()
	write := func(tx pgx.Tx, _ transaction.Principal) error {
		_, err := tx.Exec(ctx, "INSERT INTO test_writes VALUES(1)")
		return err
	}
	err := runner.Run(ctx, transaction.Request{Access: transaction.Public}, func(tx pgx.Tx, p transaction.Principal) error {
		if err := write(tx, p); err != nil {
			return err
		}
		return errors.New("abort")
	})
	if err == nil {
		t.Fatal("failed operation accepted")
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM test_writes").Scan(&count); err != nil || count != 0 {
		t.Fatal("write did not roll back", count, err)
	}
	if err := runner.Run(ctx, transaction.Request{Access: transaction.Public}, write); err != nil {
		t.Fatal(err)
	}
	err = runner.Run(ctx, transaction.Request{Access: transaction.Public}, func(tx pgx.Tx, _ transaction.Principal) error {
		_, err := tx.Exec(ctx, "INSERT INTO test_writes VALUES(2),(2)")
		return err
	})
	if err == nil {
		t.Fatal("commit constraint failure ignored")
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM test_writes").Scan(&count); err != nil || count != 1 {
		t.Fatal("failed commit left partial writes", count, err)
	}
}

type liveGuard struct{ called chan struct{} }

func (g liveGuard) Authenticate(ctx context.Context, tx pgx.Tx, _ string) (transaction.Principal, error) {
	close(g.called)
	var status string
	if err := tx.QueryRow(ctx, "SELECT status FROM accounts WHERE id='actor' FOR SHARE").Scan(&status); err != nil {
		return transaction.Principal{}, err
	}
	if status == "BLOCKED" {
		return transaction.Principal{}, fault.New(403, openapi.ErrorCodeACCOUNTBLOCKED, "Аккаунт заблокирован.")
	}
	return transaction.Principal{AccountID: "actor", Role: openapi.MeSystemRoleUSER}, nil
}
func (liveGuard) Authorize(context.Context, pgx.Tx, transaction.Access, transaction.Principal, transaction.Resource) error {
	return nil
}

func TestBarrierWaitsAndAuthenticatesFreshState(t *testing.T) {
	pool := fixture(t)
	execute(t, pool, "CREATE TABLE demo_state(id smallint PRIMARY KEY); INSERT INTO demo_state VALUES(1); CREATE TABLE accounts(id text PRIMARY KEY,status text); INSERT INTO accounts VALUES('actor','ACTIVE')")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	reset, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer reset.Rollback(context.Background())
	var id int
	if err := reset.QueryRow(ctx, "SELECT id FROM demo_state WHERE id=1 FOR UPDATE").Scan(&id); err != nil {
		t.Fatal(err)
	}
	guard := liveGuard{called: make(chan struct{})}
	runner := &transaction.Runner{DB: pool, Guard: guard}
	done := make(chan error, 1)
	token := "test-token"
	go func() {
		done <- runner.Run(ctx, transaction.Request{Access: transaction.Session, Token: &token}, func(pgx.Tx, transaction.Principal) error { return fmt.Errorf("stale authorization allowed callback") })
	}()
	// Observe a real PostgreSQL lock wait rather than assume the goroutine ran.
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=current_setting('application_name') AND wait_event_type='Lock' AND query LIKE '%demo_state%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-guard.called:
			t.Fatal("authenticated before the barrier")
		case err := <-done:
			t.Fatalf("finished before release: %v", err)
		case <-deadline.C:
			t.Fatal("did not observe barrier wait")
		case <-ticker.C:
		}
	}
	select {
	case <-guard.called:
		t.Fatal("guard bypassed reset lock")
	default:
	}
	if _, err := reset.Exec(ctx, "UPDATE accounts SET status='BLOCKED' WHERE id='actor'"); err != nil {
		t.Fatal(err)
	}
	if err := reset.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if fault.Public(err).Code != openapi.ErrorCodeACCOUNTBLOCKED {
			t.Fatalf("stale state after wait: %v", err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	// The refused operation released the shared barrier.
	if _, err := pool.Exec(ctx, "SELECT id FROM demo_state WHERE id=1 FOR UPDATE NOWAIT"); err != nil {
		t.Fatal(err)
	}
}

func TestOpenDoesNotRequireAvailableDatabase(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	pool, err := database.Open(ctx, "postgres://unused:unused@127.0.0.1:1/unavailable?sslmode=disable")
	if err != nil {
		t.Fatal("database outage prevented process construction", err)
	}
	defer pool.Close()
	if err := database.Ready(ctx, pool, 1); err == nil {
		t.Fatal("unavailable database ready")
	}
}
