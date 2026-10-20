package events_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/db/seed"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes"
	authmodule "github.com/LeonovProject/ryadom/apps/api/internal/modules/auth"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/events"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/transaction"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const origin = "http://localhost:8080"
const password = "A real test password 2026!"

type fixture struct {
	pool   *pgxpool.Pool
	server *httpapi.Server
	runner *transaction.Runner
	now    atomic.Int64
	schema string
	tokens *authn.Tokens
}

func newFixture(t *testing.T, empty bool) *fixture {
	t.Helper()
	dsn := os.Getenv("RYADOM_EVENTS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set RYADOM_EVENTS_TEST_DATABASE_URL for PostgreSQL events integration")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "be03_" + strings.ToLower(rand.Text())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, e := admin.Exec(context.Background(), "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
		if e != nil {
			t.Error(e)
		}
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	query.Set("application_name", schema)
	query.Set("timezone", "UTC")
	u.RawQuery = query.Encode()
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	migration, err := filepath.Abs("../../../db/migrations")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("goose", "-env=none", "-dir", migration, "-table", schema+".goose_db_version", "up")
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if key != "GOOSE_DRIVER" && key != "GOOSE_DBSTRING" && key != "GOOSE_TABLE" {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "GOOSE_DRIVER=postgres", "GOOSE_DBSTRING="+u.String())
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("migration: %v %s", err, out)
	}
	f := &fixture{pool: pool, schema: schema}
	f.now.Store(time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC).Unix())
	clock := func() time.Time { return time.Unix(f.now.Load(), 0).UTC() }
	catalog, err := avatarpresets.Read(strings.NewReader(`{"items":[{"id":"ryadom-companion","label":"Спутник","imageUrl":"/assets/avatars/presets/ryadom-companion.svg"}]}`))
	if empty {
		catalog, err = avatarpresets.Read(strings.NewReader(`{"items":[]}`))
	}
	if err != nil {
		t.Fatal(err)
	}
	f.tokens, err = authn.NewTokens(bytes.Repeat([]byte{7}, 32), clock)
	if err != nil {
		t.Fatal(err)
	}
	ips, _ := authn.NewClientIPs(nil)
	accountService := accounts.New(catalog)
	guard, err := authmodule.New(authmodule.Options{Tokens: f.tokens, Attempts: authn.NewAttemptLimiter(clock), IPs: ips, Catalog: catalog, Accounts: accountService, Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	f.runner = &transaction.Runner{DB: pool, Guard: guard}
	f.server, err = httpapi.New(httpapi.Options{Origin: origin, Transactions: f.runner, Ready: func(context.Context) error { return nil }, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	if err = accountService.Register(f.server); err != nil {
		t.Fatal(err)
	}
	if err = guard.Register(f.server); err != nil {
		t.Fatal(err)
	}
	reads, err := events.New(accountService, bytes.Repeat([]byte{7}, 32), clock)
	if err != nil {
		t.Fatal(err)
	}
	if err = reads.Register(f.server); err != nil {
		t.Fatal(err)
	}
	if err = activitytypes.Register(f.server); err != nil {
		t.Fatal(err)
	}
	return f
}
func (f *fixture) call(method, path string, input any, token string) *httptest.ResponseRecorder {
	var body io.Reader
	if input != nil {
		data, _ := json.Marshal(input)
		body = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, "http://localhost:8080/api/v1"+path, body)
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("Origin", origin)
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "ryadom_session", Value: token})
	}
	out := httptest.NewRecorder()
	f.server.ServeHTTP(out, req)
	return out
}
func code(t *testing.T, r *httptest.ResponseRecorder, status int, want string) {
	t.Helper()
	if r.Code != status {
		t.Fatalf("status %d, want %d; response %s", r.Code, status, r.Body.String())
	}
	if want != "" {
		var body openapi.ErrorResponse
		if json.Unmarshal(r.Body.Bytes(), &body) != nil || string(body.Error.Code) != want {
			t.Fatalf("unexpected error %s", r.Body.String())
		}
		if body.Error.RequestId != r.Header().Get("X-Request-ID") {
			t.Fatal("request ID mismatch")
		}
	}
	if !strings.Contains(r.Header().Get("Cache-Control"), "no-store") {
		t.Fatal("private response cached")
	}
}
func token(t *testing.T, r *httptest.ResponseRecorder) string {
	t.Helper()
	cookies := r.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "ryadom_session" || cookies[0].Value == "" {
		t.Fatal("missing session cookie")
	}
	c := cookies[0]
	if !c.HttpOnly || c.Path != "/api/v1" || c.MaxAge != 86400 || c.SameSite != http.SameSiteLaxMode || c.Domain != "" {
		t.Fatal("cookie attributes")
	}
	return c.Value
}
func (f *fixture) register(t *testing.T, email string) (string, openapi.Me) {
	t.Helper()
	r := f.call("POST", "/auth/register", map[string]any{"displayName": "  Новый участник  ", "email": email, "password": password, "presetId": "ryadom-companion"}, "")
	code(t, r, 201, "")
	var me openapi.Me
	if json.Unmarshal(r.Body.Bytes(), &me) != nil {
		t.Fatal("bad Me")
	}
	return token(t, r), me
}
func execute(t *testing.T, f *fixture, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}
func scalar[T any](t *testing.T, f *fixture, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := f.pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}
func (f *fixture) seed(t *testing.T) {
	t.Helper()
	if _, err := seed.Initialize(context.Background(), f.pool, seed.Options{PresetID: "ryadom-companion", Clock: func() time.Time { return time.Unix(f.now.Load(), 0) }}); err != nil {
		t.Fatal(err)
	}
}
func waitLock(t *testing.T, f *fixture, pattern string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if scalar[int](t, f, `SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2`, f.schema, pattern) > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("expected SQL lock wait")
}
