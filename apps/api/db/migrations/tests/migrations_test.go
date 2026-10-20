package migrations_test

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/database"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const schemaVersion int64 = 2026102001

var productTables = []string{"accounts", "account_avatars", "sessions", "organizations", "organization_applications", "activity_types", "events", "participations", "messages", "reports"}

type fixture struct {
	pool                   *pgxpool.Pool
	dsn, schema, directory string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("RYADOM_MIGRATIONS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set RYADOM_MIGRATIONS_TEST_DATABASE_URL for the isolated PostgreSQL/goose migration check")
	}
	if _, err := exec.LookPath("goose"); err != nil {
		t.Fatal("the pinned goose 3.29.0 CLI is required; run the DB-01 Compose check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	var version int
	var encoding string
	if err := admin.QueryRow(ctx, "SELECT current_setting('server_version_num')::integer, current_setting('server_encoding')").Scan(&version, &encoding); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 180000 || encoding != "UTF8" {
		t.Fatalf("expected PostgreSQL 17/UTF8, got %d/%s", version, encoding)
	}
	schema := "db01_" + strings.ToLower(rand.Text())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
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
	directory, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{pool: pool, dsn: parsed.String(), schema: schema, directory: directory}
}

func (f *fixture) goose(t *testing.T, command string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "goose", "-env=none", "-dir", f.directory, "-table", f.schema+".goose_db_version", command)
	settings := map[string]string{"GOOSE_DRIVER": "postgres", "GOOSE_DBSTRING": f.dsn, "GOOSE_MIGRATION_DIR": f.directory, "GOOSE_TABLE": f.schema + ".goose_db_version"}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, replaced := settings[key]; !replaced {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	for key, value := range settings {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("goose %s failed: %v\n%s", command, err, output)
	}
}

func execute(t *testing.T, f *fixture, sql string, args ...any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := f.pool.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
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

func assertReady(t *testing.T, f *fixture, want int) {
	t.Helper()
	server, err := httpapi.New(httpapi.Options{Origin: "https://ryadom.example", Ready: func(ctx context.Context) error { return database.Ready(ctx, f.pool, schemaVersion) }})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/health/ready", nil))
	if response.Code != want {
		t.Fatalf("readiness: got %d, want %d: %s", response.Code, want, response.Body.String())
	}
}

// SQL fixtures describe relational states only; they are not the DB-02 demo seed.
type ids struct{ admin, alice, bob, carol, organization, activity, event, orgEvent, message, report, closedReport string }

func populate(t *testing.T, f *fixture) ids {
	t.Helper()
	account := func(email, role string) string {
		return scalar[string](t, f, `INSERT INTO accounts(display_name,email,password_hash,system_role) VALUES('Человек',$1,$2,$3) RETURNING id::text`, email, "$argon2id$v=19$m=19456,t=2,p=1$"+strings.Repeat("A", 22)+"$"+strings.Repeat("A", 43), role)
	}
	x := ids{admin: account("admin@example.test", "ADMIN"), alice: account("alice@example.test", "USER"), bob: account("bob@example.test", "USER"), carol: account("carol@example.test", "USER")}
	execute(t, f, `INSERT INTO account_avatars(account_id,source,preset_id,status,revision) VALUES($1,'PRESET','ryadom-companion','APPROVED',1)`, x.alice)
	execute(t, f, `INSERT INTO sessions(account_id,token_hash,created_at,expires_at) VALUES($1,$2,date_trunc('second',now()),date_trunc('second',now())+interval '24 hours')`, x.alice, strings.Repeat("c", 64))
	x.organization = scalar[string](t, f, `INSERT INTO organizations(owner_account_id,name,description,sport_interests) VALUES($1,'Клуб','Занятия во дворе','Бег и шахматы') RETURNING id::text`, x.alice)
	execute(t, f, `INSERT INTO organization_applications(organization_id,status,reviewed_by,reviewed_at) VALUES($1,'APPROVED',$2,now())`, x.organization, x.admin)
	x.activity = scalar[string](t, f, `INSERT INTO activity_types(name,normalized_name,is_seeded,catalog_status) VALUES('Бег','бег',true,'APPROVED') RETURNING id::text`)
	pending := scalar[string](t, f, `INSERT INTO activity_types(name,normalized_name,created_by_account_id) VALUES('Свой спорт','свой спорт',$1) RETURNING id::text`, x.bob)
	x.event = scalar[string](t, f, `INSERT INTO events(created_by_account_id,organizer_account_id,activity_type_id,title,description,starts_at,timezone,city,location_text,join_mode,cover_svg) VALUES($1,$1,$2,'Встреча','Бегаем вместе',now()+interval '1 day','Asia/Krasnoyarsk','Красноярск','Парк','OPEN','<svg/>') RETURNING id::text`, x.alice, x.activity)
	x.orgEvent = scalar[string](t, f, `INSERT INTO events(created_by_account_id,organization_id,activity_type_id,title,description,starts_at,timezone,city,location_text,join_mode) VALUES($1,$2,$3,'Встреча клуба','Новая дисциплина',now()+interval '2 days','Asia/Krasnoyarsk','Красноярск','Двор','APPROVAL') RETURNING id::text`, x.alice, x.organization, pending)
	execute(t, f, `INSERT INTO participations(event_id,account_id,status) VALUES($1,$2,'CONFIRMED')`, x.event, x.bob)
	x.message = scalar[string](t, f, `INSERT INTO messages(event_id,author_account_id,body) VALUES($1,$2,'Где встречаемся?') RETURNING id::text`, x.event, x.bob)
	x.report = scalar[string](t, f, `INSERT INTO reports(reporter_account_id,target_type,target_message_id) VALUES($1,'MESSAGE',$2) RETURNING id::text`, x.alice, x.message)
	x.closedReport = scalar[string](t, f, `INSERT INTO reports(reporter_account_id,target_type,target_event_id,status,reviewed_by,reviewed_at) VALUES($1,'EVENT',$2,'DISMISSED',$3,now()) RETURNING id::text`, x.bob, x.orgEvent, x.admin)
	return x
}

func TestMigrationLifecycle(t *testing.T) {
	f := newFixture(t)
	output, err := exec.Command("goose", "-version").CombinedOutput()
	if err != nil || !strings.Contains(string(output), "3.29.0") {
		t.Fatalf("expected goose 3.29.0: %s %v", output, err)
	}
	assertReady(t, f, 503)
	f.goose(t, "validate")
	f.goose(t, "up")
	assertReady(t, f, 200)
	if count := scalar[int](t, f, `SELECT count(*) FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'goose_db_version'`); count != 11 {
		t.Fatalf("expected 11 tables, got %d", count)
	}
	for _, table := range productTables {
		if scalar[int](t, f, "SELECT count(*) FROM "+pgx.Identifier{table}.Sanitize()) != 0 {
			t.Fatalf("migration seeded %s", table)
		}
	}
	if scalar[int](t, f, "SELECT count(*) FROM demo_state WHERE id=1") != 1 {
		t.Fatal("missing technical singleton")
	}
	populate(t, f)
	execute(t, f, `UPDATE demo_state SET generation=gen_random_uuid(), last_reset_id=gen_random_uuid(), last_reset_from_generation=generation,last_reset_at=now(),last_reset_seed_version='db01-fixture',last_reset_base_date=current_date WHERE id=1`)
	receipt := scalar[string](t, f, "SELECT row_to_json(demo_state)::text FROM demo_state")
	accountIDs := scalar[string](t, f, "SELECT string_agg(id::text,',' ORDER BY id) FROM accounts")
	versions := scalar[int](t, f, "SELECT count(*) FROM goose_db_version")
	f.goose(t, "up")
	if receipt != scalar[string](t, f, "SELECT row_to_json(demo_state)::text FROM demo_state") || accountIDs != scalar[string](t, f, "SELECT string_agg(id::text,',' ORDER BY id) FROM accounts") || versions != scalar[int](t, f, "SELECT count(*) FROM goose_db_version") {
		t.Fatal("repeat migration changed data/history")
	}
	if bad := scalar[int](t, f, `SELECT count(*) FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND contype='f' AND confdeltype<>'r'`); bad != 0 {
		t.Fatal("foreign key permits cascading deletion")
	}
	if missing := scalar[int](t, f, `SELECT count(*) FROM pg_constraint c WHERE c.connamespace=current_schema()::regnamespace AND c.contype='f' AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indkey[0]=c.conkey[1])`); missing != 0 {
		t.Fatalf("%d foreign keys lack a leading index", missing)
	}
	f.goose(t, "down")
	assertReady(t, f, 503)
	if scalar[int](t, f, `SELECT count(*) FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'goose_db_version'`) != 0 {
		t.Fatal("rollback left product tables")
	}
	f.goose(t, "up")
	assertReady(t, f, 200)
	for _, table := range productTables {
		if scalar[int](t, f, "SELECT count(*) FROM "+pgx.Identifier{table}.Sanitize()) != 0 {
			t.Fatalf("rollback/up retained %s", table)
		}
	}
}

func TestMigrationAtomicFailure(t *testing.T) {
	f := newFixture(t)
	// A collision late in Up must roll back earlier tables and the singleton.
	execute(t, f, "CREATE TABLE messages(marker text); INSERT INTO messages VALUES('preserve')")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "goose", "-env=none", "-dir", f.directory, "-table", f.schema+".goose_db_version", "up")
	cmd.Env = append(os.Environ(), "GOOSE_DRIVER=postgres", "GOOSE_DBSTRING="+f.dsn)
	if output, err := cmd.CombinedOutput(); err == nil {
		t.Fatalf("conflicting schema accepted: %s", output)
	}
	if scalar[int](t, f, `SELECT count(*) FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT IN ('goose_db_version','messages')`) != 0 {
		t.Fatal("failed migration left partial product schema")
	}
	if scalar[string](t, f, "SELECT marker FROM messages") != "preserve" {
		t.Fatal("migration replaced existing data")
	}
	execute(t, f, "DROP TABLE messages")
	f.goose(t, "up")
	assertReady(t, f, 200)
}

func TestConstraints(t *testing.T) {
	f := newFixture(t)
	f.goose(t, "up")
	x := populate(t, f)
	cases := constraintCases(x)
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			tx, err := f.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			_, err = tx.Exec(ctx, test.sql, test.args...)
			if test.code == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != test.code {
				t.Fatalf("got %v, expected SQLSTATE %s", err, test.code)
			}
		})
	}
	if scalar[string](t, f, "SELECT cover_svg FROM events WHERE id=$1", x.event) != "<svg/>" {
		t.Fatal("invalid SVG update changed previous cover")
	}
}

func TestConcurrentParticipationUnique(t *testing.T) {
	f := newFixture(t)
	f.goose(t, "up")
	x := populate(t, f)
	start := make(chan struct{})
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, err := f.pool.Exec(ctx, `INSERT INTO participations(event_id,account_id,status) VALUES($1,$2,'CONFIRMED')`, x.event, x.carol)
			done <- err
		}()
	}
	close(start)
	successes, duplicates := 0, 0
	for i := 0; i < 2; i++ {
		err := <-done
		if err == nil {
			successes++
			continue
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			duplicates++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || duplicates != 1 || scalar[int](t, f, "SELECT count(*) FROM participations WHERE event_id=$1 AND account_id=$2", x.event, x.carol) != 1 {
		t.Fatal("concurrent inserts created duplicate participation")
	}
}

func TestExplicitDeletionOrderPreservesDemoState(t *testing.T) {
	f := newFixture(t)
	f.goose(t, "up")
	x := populate(t, f)
	execute(t, f, `UPDATE accounts SET status='BLOCKED',revision=revision+1,blocked_at=now(),blocked_by_account_id=$1 WHERE id=$2`, x.admin, x.bob)
	before := scalar[string](t, f, "SELECT row_to_json(demo_state)::text FROM demo_state")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	// Only test data in this random schema is deleted, in DEC-13's FK order.
	for _, table := range []string{"reports", "messages", "participations", "events", "organization_applications", "organizations", "sessions", "account_avatars", "activity_types", "accounts"} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+pgx.Identifier{table}.Sanitize()); err != nil {
			t.Fatal(fmt.Errorf("%s: %w", table, err))
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if scalar[string](t, f, "SELECT row_to_json(demo_state)::text FROM demo_state") != before {
		t.Fatal("subject deletion changed barrier/receipt")
	}
	assertReady(t, f, 200)
}
