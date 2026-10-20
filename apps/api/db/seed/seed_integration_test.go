package seed

import (
	"context"
	"crypto/rand"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fixture struct {
	pool         *pgxpool.Pool
	dsn, presets string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("RYADOM_SEED_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set RYADOM_SEED_TEST_DATABASE_URL for the isolated real-migration seed check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "db02_" + strings.ToLower(rand.Text())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	query.Set("timezone", "UTC")
	query.Set("application_name", schema)
	parsed.RawQuery = query.Encode()
	cfg, err := pgxpool.ParseConfig(parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	dir, err := filepath.Abs("../migrations")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "goose", "-env=none", "-dir", dir, "-table", schema+".goose_db_version", "up")
	cmd.Env = replaceEnv(os.Environ(), map[string]string{"GOOSE_DRIVER": "postgres", "GOOSE_DBSTRING": parsed.String(), "GOOSE_TABLE": schema + ".goose_db_version"})
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("migration failed: %v %s", err, output)
	}
	presets, err := filepath.Abs("../../../../packages/contracts/avatar-presets.json")
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{pool: pool, dsn: parsed.String(), presets: presets}
}

func replaceEnv(env []string, settings map[string]string) []string {
	out := []string{}
	for _, entry := range env {
		key, _, _ := strings.Cut(entry, "=")
		if _, replace := settings[key]; !replace {
			out = append(out, entry)
		}
	}
	for key, value := range settings {
		out = append(out, key+"="+value)
	}
	return out
}

func scalar[T any](t *testing.T, f *fixture, sql string, args ...any) T {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var value T
	if err := f.pool.QueryRow(ctx, sql, args...).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}
func execute(t *testing.T, f *fixture, sql string, args ...any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := f.pool.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}
func options() Options {
	return Options{Clock: func() time.Time { return time.Date(2026, 10, 20, 18, 30, 0, 0, time.UTC) }, PresetID: "ryadom-companion"}
}
func initialize(t *testing.T, f *fixture) Result {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	result, err := Initialize(ctx, f.pool, options())
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func snapshot(t *testing.T, f *fixture) string {
	t.Helper()
	result := ""
	for _, table := range []string{"demo_state", "accounts", "account_avatars", "sessions", "organizations", "organization_applications", "activity_types", "events", "participations", "messages", "reports", "goose_db_version"} {
		result += scalar[string](t, f, "SELECT md5(COALESCE(string_agg(row_to_json(t)::text,',' ORDER BY row_to_json(t)::text),'')) FROM "+pgx.Identifier{table}.Sanitize()+" t")
	}
	return result
}

func TestSeedDatasetAndSQLWindows(t *testing.T) {
	f := newFixture(t)
	if result := initialize(t, f); !result.Applied || result.BaseDate != "2026-10-21" || result.Version != Version {
		t.Fatal("incorrect seed result", result)
	}
	for table, want := range map[string]int{"accounts": 6, "account_avatars": 6, "sessions": 0, "organizations": 5, "organization_applications": 4, "activity_types": 7, "events": 16, "participations": 13, "messages": 7, "reports": 7} {
		if got := scalar[int](t, f, "SELECT count(*) FROM "+pgx.Identifier{table}.Sanitize()); got != want {
			t.Fatalf("%s: got %d, want %d", table, got, want)
		}
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM accounts a JOIN account_avatars v ON v.account_id=a.id WHERE a.demo_key IN ('alex','anna','marina') AND a.status='ACTIVE' AND v.source='PRESET' AND v.status='APPROVED' AND v.preset_id='ryadom-companion'`); got != 3 {
		t.Fatal("primary demo access/avatar unavailable")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM events e JOIN accounts a ON a.id=e.organizer_account_id WHERE a.status='BLOCKED' AND e.publication_status='PUBLISHED'`); got != 1 {
		t.Fatal("blocked content removed")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM participations p JOIN accounts a ON a.id=p.account_id JOIN events e ON e.id=p.event_id WHERE a.demo_key='alex' AND e.title IN ('Пробежка для знакомства','Футбол во дворе')`); got != 0 {
		t.Fatal("seed consumed expert's fresh join targets")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM organization_applications WHERE status='PENDING'`); got != 2 {
		t.Fatal("both admission decisions cannot be demonstrated")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM participations p JOIN events e ON e.id=p.event_id WHERE e.title='Футбол во дворе' AND p.status='PENDING'`); got != 2 {
		t.Fatal("both participation decisions cannot be demonstrated")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM events e JOIN activity_types a ON a.id=e.activity_type_id WHERE NOT a.is_seeded AND a.catalog_status IN ('PENDING','REJECTED') AND e.publication_status='PUBLISHED'`); got != 3 {
		t.Fatal("custom sports incorrectly delayed publication")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM messages WHERE status='HIDDEN' AND moderation_revision=1 AND reports_revision=2`); got != 1 {
		t.Fatal("hidden fixture absent")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM messages WHERE status='VISIBLE' AND hidden_at IS NOT NULL AND restored_at IS NOT NULL AND moderation_revision=2`); got != 1 {
		t.Fatal("restored fixture absent")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM reports WHERE status='OPEN'`); got != 2 {
		t.Fatal("separate event/message open reports absent")
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM reports r JOIN messages m ON m.id=r.target_message_id WHERE r.status='RESOLVED' AND r.reviewed_at<>m.hidden_at`); got != 0 {
		t.Fatal("hidden report closure time inconsistent")
	}
	// Exact SQL window semantics, not a claim that BE-07 endpoints exist.
	reference := options().Clock()
	future := scalar[int](t, f, `SELECT count(*) FROM participations p JOIN events e ON e.id=p.event_id JOIN accounts a ON a.id=p.account_id WHERE a.demo_key='alex' AND p.status='CONFIRMED' AND e.publication_status='PUBLISHED' AND e.starts_at>$1`, reference)
	if future != 4 {
		t.Fatal("upcoming plans include wrong states", future)
	}
	first := scalar[string](t, f, `SELECT e.title FROM participations p JOIN events e ON e.id=p.event_id JOIN accounts a ON a.id=p.account_id WHERE a.demo_key='alex' AND p.status='CONFIRMED' AND e.publication_status='PUBLISHED' AND e.starts_at>$1 ORDER BY e.starts_at,e.id LIMIT 1`, reference)
	if first != "Ближайший подтверждённый план" {
		t.Fatal("nearest plan missing")
	}
	newest := scalar[string](t, f, `SELECT e.title FROM participations p JOIN events e ON e.id=p.event_id JOIN accounts a ON a.id=p.account_id WHERE a.demo_key='alex' AND p.status='CONFIRMED' AND e.publication_status='PUBLISHED' AND e.starts_at>$1 ORDER BY p.created_at DESC LIMIT 1`, reference)
	if newest != "Дальний подтверждённый план" {
		t.Fatal("fixture cannot expose incorrect participation-date sorting")
	}
	today := scalar[int](t, f, `SELECT count(*) FROM participations p JOIN events e ON e.id=p.event_id JOIN accounts a ON a.id=p.account_id WHERE a.demo_key='alex' AND p.status='CONFIRMED' AND e.publication_status='PUBLISHED' AND e.starts_at<=$1 AND (e.starts_at AT TIME ZONE e.timezone)::date=($1::timestamptz AT TIME ZONE e.timezone)::date`, reference)
	if today != 1 {
		t.Fatal("started-today local window", today)
	}
	if got := scalar[int](t, f, `SELECT count(*) FROM events WHERE title IN ('Утренняя зарядка в парке','Бег в то же время') GROUP BY starts_at`); got != 2 {
		t.Fatal("tie fixtures do not share start")
	}
}

func TestSeedRepeatPreservesUserChangesAndSession(t *testing.T) {
	f := newFixture(t)
	initialize(t, f)
	execute(t, f, `UPDATE accounts SET display_name='Изменённое имя' WHERE demo_key='alex'`)
	execute(t, f, `UPDATE accounts SET status='BLOCKED',revision=revision+1,blocked_at=now(),blocked_by_account_id=(SELECT id FROM accounts WHERE demo_key='marina') WHERE demo_key='anna'`)
	execute(t, f, `UPDATE organization_applications SET status='REJECTED',reviewed_by=(SELECT id FROM accounts WHERE demo_key='marina'),reviewed_at=now(),rejection_reason='Решение эксперта' WHERE organization_id=(SELECT id FROM organizations WHERE name='Кружок «Дворовая команда»')`)
	account := scalar[string](t, f, `SELECT id::text FROM accounts WHERE demo_key='alex'`)
	hash := scalar[string](t, f, `SELECT password_hash FROM accounts WHERE demo_key='alex'`)
	execute(t, f, `INSERT INTO accounts(display_name,email,password_hash) VALUES('Новый пользователь','new@example.test',$1)`, hash)
	execute(t, f, `INSERT INTO sessions(account_id,token_hash,created_at,expires_at) VALUES($1,$2,date_trunc('second',now()),date_trunc('second',now())+interval '24 hours')`, account, strings.Repeat("a", 64))
	execute(t, f, `UPDATE demo_state SET generation=gen_random_uuid(),last_reset_id=gen_random_uuid(),last_reset_from_generation=generation,last_reset_at=now(),last_reset_seed_version='previous-fixture',last_reset_base_date=current_date WHERE id=1`)
	before := snapshot(t, f)
	result, err := Initialize(context.Background(), f.pool, Options{Clock: func() time.Time { t.Fatal("no-op consulted new date"); return time.Time{} }, PresetID: ""})
	if err != nil || result.Applied || result.BaseDate != "" {
		t.Fatal(result, err)
	}
	if before != snapshot(t, f) {
		t.Fatal("repeat changed expert edits, session, receipt or dates")
	}
}

func TestSeedRefusesForeignNonemptyDatabase(t *testing.T) {
	f := newFixture(t)
	hash, err := authn.HashPassword("Existing-Password-2026!")
	if err != nil {
		t.Fatal(err)
	}
	execute(t, f, `INSERT INTO accounts(display_name,email,password_hash) VALUES('Существующий пользователь','alex@example.test',$1)`, hash)
	before := snapshot(t, f)
	if _, err := Initialize(context.Background(), f.pool, options()); !errors.Is(err, ErrDatabaseNotEmpty) {
		t.Fatal("foreign database was not refused", err)
	}
	if snapshot(t, f) != before {
		t.Fatal("existing account was overwritten")
	}
}

func TestSeedFailureIsAtomic(t *testing.T) {
	f := newFixture(t)
	execute(t, f, `ALTER TABLE reports ADD CONSTRAINT fail_seed_reports CHECK(false)`)
	before := snapshot(t, f)
	if _, err := Initialize(context.Background(), f.pool, options()); err == nil {
		t.Fatal("forced late failure ignored")
	}
	if before != snapshot(t, f) {
		t.Fatal("failed seed left partial data or changed barrier")
	}
	execute(t, f, "ALTER TABLE reports DROP CONSTRAINT fail_seed_reports")
	if !initialize(t, f).Applied {
		t.Fatal("seed failed after removing test constraint")
	}
}

func TestConcurrentSeedInitializers(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan Result, 2)
	failures := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() { <-start; result, err := Initialize(ctx, f.pool, options()); results <- result; failures <- err }()
	}
	close(start)
	applied := 0
	for i := 0; i < 2; i++ {
		if result := <-results; result.Applied {
			applied++
		}
		if err := <-failures; err != nil {
			t.Fatal(err)
		}
	}
	if applied != 1 || scalar[int](t, f, "SELECT count(*) FROM accounts") != 6 {
		t.Fatal("duplicate or partially applied seed", applied)
	}
}

func TestSeedReusesCallerTransaction(t *testing.T) {
	f := newFixture(t)
	initialize(t, f)
	alex := scalar[string](t, f, `SELECT id::text FROM accounts WHERE demo_key='alex'`)
	execute(t, f, `INSERT INTO sessions(account_id,token_hash,created_at,expires_at) VALUES($1,$2,date_trunc('second',now()),date_trunc('second',now())+interval '24 hours')`, alex, strings.Repeat("b", 64))
	before := snapshot(t, f)
	for _, commit := range []bool{false, true} {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		tx, err := f.pool.Begin(ctx)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		var id int
		if err := tx.QueryRow(ctx, "SELECT id FROM demo_state WHERE id=1 FOR UPDATE").Scan(&id); err != nil {
			t.Fatal(err)
		}
		// Test-only deletion inside a random schema models the caller's work;
		// the production seed has no delete/reset operation.
		for _, table := range []string{"reports", "messages", "participations", "events", "organization_applications", "organizations", "sessions", "account_avatars", "activity_types", "accounts"} {
			if _, err := tx.Exec(ctx, "DELETE FROM "+pgx.Identifier{table}.Sanitize()); err != nil {
				t.Fatal(err)
			}
		}
		if result, err := Apply(ctx, tx, options()); err != nil || !result.Applied {
			t.Fatal(result, err)
		}
		var newID string
		if err := tx.QueryRow(ctx, "SELECT id::text FROM accounts WHERE demo_key='alex'").Scan(&newID); err != nil {
			t.Fatal(err)
		}
		if newID == alex {
			t.Fatal("subject IDs reused")
		}
		if !commit {
			if err := tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			cancel()
			if before != snapshot(t, f) {
				t.Fatal("Apply escaped caller rollback")
			}
		} else {
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			cancel()
		}
	}
	if scalar[int](t, f, "SELECT count(*) FROM sessions") != 0 {
		t.Fatal("seed manufactured a session")
	}
	if scalar[string](t, f, "SELECT id::text FROM accounts WHERE demo_key='alex'") == alex {
		t.Fatal("new seed reused old UUID")
	}
}

func TestEmptyCataloguePreparedAccountsRemainUsable(t *testing.T) {
	f := newFixture(t)
	result, err := Initialize(context.Background(), f.pool, Options{Clock: options().Clock})
	if err != nil || !result.Applied {
		t.Fatal(result, err)
	}
	if scalar[int](t, f, `SELECT count(*) FROM account_avatars WHERE source='NONE' AND status='EMPTY' AND preset_id IS NULL`) != 6 {
		t.Fatal("empty manifest fabricated presets")
	}
	hash := scalar[string](t, f, `SELECT password_hash FROM accounts WHERE demo_key='alex'`)
	if ok, err := authn.VerifyPassword("Ryadom-Alex-2026!", hash); err != nil || !ok {
		t.Fatal("prepared password unavailable", err)
	}
}

func TestExplicitSeedCommand(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	binary := filepath.Join(t.TempDir(), "seed")
	if output, err := exec.CommandContext(ctx, "go", "build", "-o", binary, "./cmd/seed").CombinedOutput(); err != nil {
		t.Fatalf("build seed CLI: %v %s", err, output)
	}
	run := func() string {
		cmd := exec.CommandContext(ctx, binary, "-presets", f.presets)
		cmd.Env = replaceEnv(os.Environ(), map[string]string{"DATABASE_URL": f.dsn})
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("seed CLI: %v %s", err, output)
		}
		return string(output)
	}
	if output := run(); !strings.Contains(output, "загружен") {
		t.Fatal("CLI did not report applied result")
	}
	before := snapshot(t, f)
	if output := run(); !strings.Contains(output, "сохранены") {
		t.Fatal("CLI did not report no-op")
	}
	if before != snapshot(t, f) {
		t.Fatal("CLI repeat changed data")
	}
}

func TestSeedWaitsForSharedResetBarrier(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	blocking, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocking.Rollback(context.Background())
	var id int
	if err := blocking.QueryRow(ctx, "SELECT id FROM demo_state WHERE id=1 FOR UPDATE").Scan(&id); err != nil {
		t.Fatal(err)
	}
	clockRead := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := Initialize(ctx, f.pool, Options{PresetID: "ryadom-companion", Clock: func() time.Time { close(clockRead); return options().Clock() }})
		done <- err
	}()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		waiting := scalar[bool](t, f, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=current_setting('application_name') AND wait_event_type='Lock' AND query LIKE '%demo_state%')`)
		if waiting {
			break
		}
		select {
		case <-clockRead:
			t.Fatal("date chosen before barrier")
		case err := <-done:
			t.Fatal("finished before barrier", err)
		case <-deadline.C:
			t.Fatal("seed did not wait for barrier")
		case <-ticker.C:
		}
	}
	if err := blocking.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}
