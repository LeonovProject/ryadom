package auth_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
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
	authmodule "github.com/LeonovProject/ryadom/apps/api/internal/modules/auth"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
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
	dsn := os.Getenv("RYADOM_AUTH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set RYADOM_AUTH_TEST_DATABASE_URL for PostgreSQL auth integration")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "be02_" + strings.ToLower(rand.Text())
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

func TestRegisterLoginLogoutAndPrivacy(t *testing.T) {
	f := newFixture(t, false)
	first, me := f.register(t, "NEW@EXAMPLE.TEST")
	if me.Email != "new@example.test" || me.Account.DisplayName != "Новый участник" || me.SystemRole != "USER" || me.Account.AvatarUrl == nil || me.Organizations == nil {
		t.Fatal("incorrect account/preset")
	}
	if scalar[string](t, f, "SELECT token_hash FROM sessions") != authn.TokenDigest(first) {
		t.Fatal("JWT digest mismatch")
	}
	hash := scalar[string](t, f, "SELECT password_hash FROM accounts")
	ok, err := authn.VerifyPassword(password, hash)
	if err != nil || !ok {
		t.Fatal("real password not stored")
	}
	public := f.call("GET", "/accounts/"+me.Account.Id.String(), nil, "invalid-cookie")
	code(t, public, 200, "")
	var shape map[string]any
	_ = json.Unmarshal(public.Body.Bytes(), &shape)
	if len(shape) != 4 || shape["email"] != nil || shape["systemRole"] != nil || public.Header().Get("Set-Cookie") != "" {
		t.Fatal("public privacy/cookie")
	}
	wrong := f.call("POST", "/auth/login", map[string]string{"email": "new@example.test", "password": "wrong"}, first)
	code(t, wrong, 401, "INVALID_CREDENTIALS")
	if wrong.Header().Get("Set-Cookie") != "" {
		t.Fatal("failed login replaced cookie")
	}
	code(t, f.call("GET", "/me", nil, first), 200, "")
	unknown := f.call("POST", "/auth/login", map[string]string{"email": "unknown@example.test", "password": "wrong"}, first)
	code(t, unknown, 401, "INVALID_CREDENTIALS")
	secondResponse := f.call("POST", "/auth/login", map[string]string{"email": "NEW@EXAMPLE.TEST", "password": password}, "")
	code(t, secondResponse, 200, "")
	second := token(t, secondResponse)
	replacement := f.call("POST", "/auth/login", map[string]string{"email": "new@example.test", "password": password}, first)
	code(t, replacement, 200, "")
	third := token(t, replacement)
	code(t, f.call("GET", "/me", nil, first), 401, "SESSION_EXPIRED")
	code(t, f.call("GET", "/me", nil, second), 200, "")
	code(t, f.call("GET", "/me", nil, third), 200, "")
	logout := f.call("POST", "/auth/logout", nil, third)
	code(t, logout, 204, "")
	if logout.Result().Cookies()[0].MaxAge >= 0 {
		t.Fatal("logout did not clear cookie")
	}
	code(t, f.call("GET", "/me", nil, third), 401, "SESSION_EXPIRED")
	code(t, f.call("GET", "/me", nil, second), 200, "")
	code(t, f.call("POST", "/auth/logout", nil, "nonsense"), 204, "")
	code(t, f.call("POST", "/auth/logout", nil, ""), 204, "")
	code(t, f.call("GET", "/me", nil, ""), 401, "AUTH_REQUIRED")
}
func TestDemoLoginAndEmptyPresetCatalogue(t *testing.T) {
	f := newFixture(t, true)
	f.seed(t)
	r := f.call("POST", "/auth/login", map[string]string{"email": "anna@example.test", "password": "Ryadom-Anna-2026!"}, "")
	code(t, r, 200, "")
	cookie := token(t, r)
	var me openapi.Me
	_ = json.Unmarshal(r.Body.Bytes(), &me)
	if me.Account.AvatarUrl != nil || len(me.Organizations) != 5 {
		t.Fatal("removed preset or organization refs")
	}
	approved := 0
	states := map[openapi.ApprovalState]int{}
	for _, org := range me.Organizations {
		switch org.ApprovalState {
		case openapi.ApprovalStateNOTSUBMITTED, openapi.ApprovalStatePENDING, openapi.ApprovalStateAPPROVED, openapi.ApprovalStateREJECTED:
		default:
			t.Fatalf("organization state outside OpenAPI contract: %s", org.ApprovalState)
		}
		states[org.ApprovalState]++
		if org.CanPublish {
			approved++
		}
	}
	if approved != 1 || states["PENDING"] != 2 || states["NOT_SUBMITTED"] != 1 || states["REJECTED"] != 1 {
		t.Fatal("independent organization states")
	}
	code(t, f.call("GET", "/me", nil, cookie), 200, "")
	r = f.call("GET", "/avatar-presets", nil, "nonsense")
	code(t, r, 200, "")
	if strings.TrimSpace(r.Body.String()) != `{"items":[]}` {
		t.Fatal("empty catalogue not usable")
	}
	r = f.call("POST", "/auth/register", map[string]string{"displayName": "Name", "email": "empty@example.test", "password": password, "presetId": "ryadom-companion"}, cookie)
	code(t, r, 422, "VALIDATION_ERROR")
	if r.Header().Get("Set-Cookie") != "" || scalar[int](t, f, "SELECT count(*) FROM accounts") != 6 {
		t.Fatal("empty catalogue created account")
	}
	for _, correct := range []bool{false, true} {
		pw := "wrong"
		status := 401
		want := "INVALID_CREDENTIALS"
		if correct {
			pw = "Ryadom-Blocked-2026!"
			status = 403
			want = "ACCOUNT_BLOCKED"
		}
		r = f.call("POST", "/auth/login", map[string]string{"email": "blocked@example.test", "password": pw}, cookie)
		code(t, r, status, want)
		if r.Header().Get("Set-Cookie") != "" {
			t.Fatal("blocked login cleared another session")
		}
	}
}
func TestRegistrationValidationAndPasswordBytes(t *testing.T) {
	f := newFixture(t, false)
	existing, _ := f.register(t, "existing@example.test")
	valid := map[string]any{"displayName": "Name", "email": "fresh@example.test", "password": password, "presetId": "ryadom-companion"}
	for _, change := range []map[string]any{{"displayName": "\u00a0 \t"}, {"email": " fresh@example.test"}, {"email": "адрес@example.test"}, {"password": "short"}, {"password": strings.Repeat("я", 129)}, {"presetId": "missing"}, {"presetId": nil}, {"systemRole": "ADMIN"}, {"status": "ACTIVE"}, {"svg": "<svg/>"}, {"email": "EXISTING@EXAMPLE.TEST"}} {
		body := map[string]any{}
		for k, v := range valid {
			body[k] = v
		}
		for k, v := range change {
			body[k] = v
		}
		r := f.call("POST", "/auth/register", body, existing)
		want := 422
		errorCode := "VALIDATION_ERROR"
		if change["email"] == "EXISTING@EXAMPLE.TEST" {
			want = 409
			errorCode = "EMAIL_TAKEN"
		}
		code(t, r, want, errorCode)
		if r.Header().Get("Set-Cookie") != "" {
			t.Fatal("failed registration changed cookie")
		}
	}
	delete(valid, "presetId")
	code(t, f.call("POST", "/auth/register", valid, existing), 422, "VALIDATION_ERROR")
	if scalar[int](t, f, "SELECT count(*) FROM accounts") != 1 || scalar[int](t, f, "SELECT count(*) FROM account_avatars") != 1 || scalar[int](t, f, "SELECT count(*) FROM sessions") != 1 {
		t.Fatal("validation left partial rows")
	}
	pw := " пароль с пробелами "
	r := f.call("POST", "/auth/register", map[string]string{"displayName": "Name", "email": "unicode@example.test", "password": pw, "presetId": "ryadom-companion"}, "")
	code(t, r, 201, "")
	code(t, f.call("POST", "/auth/login", map[string]string{"email": "unicode@example.test", "password": strings.TrimSpace(pw)}, ""), 401, "INVALID_CREDENTIALS")
	code(t, f.call("POST", "/auth/login", map[string]string{"email": "unicode@example.test", "password": pw}, ""), 200, "")
	req := httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
	req.Header.Set("Origin", "https://evil.test")
	req.AddCookie(&http.Cookie{Name: "ryadom_session", Value: existing})
	rec := httptest.NewRecorder()
	f.server.ServeHTTP(rec, req)
	code(t, rec, 403, "CSRF_REJECTED")
	if rec.Header().Get("Set-Cookie") != "" {
		t.Fatal("CSRF logged out")
	}
}
func TestConcurrentRegistrationAndAtomicCommitFailure(t *testing.T) {
	f := newFixture(t, false)
	results := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() {
			results <- f.call("POST", "/auth/register", map[string]string{"displayName": "Same", "email": "race@example.test", "password": password, "presetId": "ryadom-companion"}, "")
		}()
	}
	statuses := map[int]int{}
	var old string
	for range 2 {
		r := <-results
		statuses[r.Code]++
		if r.Code == 201 {
			old = token(t, r)
		} else {
			code(t, r, 409, "EMAIL_TAKEN")
			if r.Header().Get("Set-Cookie") != "" {
				t.Fatal("unique failure set cookie")
			}
		}
	}
	if statuses[201] != 1 || statuses[409] != 1 || scalar[int](t, f, "SELECT count(*) FROM account_avatars") != 1 {
		t.Fatal("duplicate or orphan registration")
	}
	execute(t, f, `CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced deferred failure'; END $$; CREATE CONSTRAINT TRIGGER reject_session AFTER INSERT ON sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_session()`)
	for _, route := range []string{"register", "login"} {
		body := map[string]string{"displayName": "New", "email": "race@example.test", "password": password, "presetId": "ryadom-companion"}
		if route == "register" {
			body["email"] = "rollback@example.test"
		} else {
			delete(body, "displayName")
			delete(body, "presetId")
		}
		r := f.call("POST", "/auth/"+route, body, old)
		code(t, r, 500, "INTERNAL_ERROR")
		if r.Header().Get("Set-Cookie") != "" {
			t.Fatal("cookie before commit")
		}
	}
	if scalar[int](t, f, "SELECT count(*) FROM accounts") != 1 || scalar[int](t, f, "SELECT count(*) FROM sessions") != 1 {
		t.Fatal("failed commit changed accounts/sessions")
	}
	code(t, f.call("GET", "/me", nil, old), 200, "")
}
func TestLimitsAndCookieForgery(t *testing.T) {
	f := newFixture(t, false)
	good, _ := f.register(t, "limit@example.test")
	for i := 0; i < 11; i++ {
		r := f.call("POST", "/auth/login", map[string]string{"email": "limit@example.test", "password": "wrong"}, good)
		if i < 10 {
			code(t, r, 401, "INVALID_CREDENTIALS")
		} else {
			code(t, r, 429, "RATE_LIMITED")
			if r.Header().Get("Retry-After") != "900" || r.Header().Get("Set-Cookie") != "" {
				t.Fatal("retry header/cookie")
			}
		}
	}
	for _, bad := range []string{"invalid", good[:len(good)-1] + "X"} {
		r := f.call("GET", "/me", nil, bad)
		code(t, r, 401, "SESSION_EXPIRED")
		if len(r.Result().Cookies()) != 1 || r.Result().Cookies()[0].MaxAge >= 0 {
			t.Fatal("invalid session not cleared")
		}
	}
	code(t, f.call("GET", "/me", nil, good), 200, "")
	f.now.Add(86400)
	code(t, f.call("GET", "/me", nil, good), 401, "SESSION_EXPIRED")
}
func TestBlockGuardAndOwnerPolicies(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	login := func(email, pw string) string {
		r := f.call("POST", "/auth/login", map[string]string{"email": email, "password": pw}, "")
		code(t, r, 200, "")
		return token(t, r)
	}
	user := login("alex@example.test", "Ryadom-Alex-2026!")
	admin := login("marina@example.test", "Ryadom-Marina-2026!")
	owner := login("anna@example.test", "Ryadom-Anna-2026!")
	event := scalar[string](t, f, "SELECT id::text FROM events WHERE created_by_account_id=(SELECT id FROM accounts WHERE demo_key='anna') LIMIT 1")
	for _, test := range []struct {
		access transaction.Access
		cookie string
		path   map[string]string
		want   string
	}{{transaction.Admin, user, nil, "FORBIDDEN"}, {transaction.EventOwner, admin, map[string]string{"eventId": event}, "NOT_FOUND"}, {transaction.EventOwner, owner, map[string]string{"eventId": event}, ""}, {transaction.OptionalSession, "bad", nil, "SESSION_EXPIRED"}, {transaction.Public, "bad", nil, ""}} {
		called := false
		err := f.runner.Run(context.Background(), transaction.Request{Access: test.access, Token: &test.cookie, Resource: transaction.Resource{PathParams: test.path}}, func(pgx.Tx, transaction.Principal) error { called = true; return nil })
		if test.want == "" {
			if err != nil || !called {
				t.Fatal("valid policy rejected", err)
			}
		} else {
			var safe *fault.Error
			if !errors.As(err, &safe) || string(safe.Code) != test.want || called {
				t.Fatal("policy not enforced", err)
			}
		}
	}
	execute(t, f, `UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=(SELECT id FROM accounts WHERE demo_key='marina') WHERE demo_key='alex'; DELETE FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE demo_key='alex')`)
	code(t, f.call("GET", "/me", nil, user), 403, "ACCOUNT_BLOCKED")
	id := scalar[string](t, f, "SELECT id::text FROM accounts WHERE demo_key='alex'")
	r := f.call("GET", "/accounts/"+id, nil, user)
	code(t, r, 200, "")
	if !strings.Contains(r.Body.String(), `"isBlocked":true`) {
		t.Fatal("public status missing")
	}
	code(t, f.call("POST", "/auth/logout", nil, user), 204, "")
	execute(t, f, "UPDATE accounts SET status='ACTIVE',blocked_at=NULL,blocked_by_account_id=NULL WHERE demo_key='alex'")
	code(t, f.call("GET", "/me", nil, user), 401, "SESSION_EXPIRED")
}
func TestAuthorizationRechecksAfterWaiting(t *testing.T) {
	f := newFixture(t, false)
	cookie, me := f.register(t, "waiting@example.test")
	_, admin := f.register(t, "admin@example.test")
	execute(t, f, "UPDATE accounts SET system_role='ADMIN' WHERE id=$1", admin.Account.Id)
	lock, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(context.Background())
	if _, err = lock.Exec(context.Background(), "SELECT id FROM accounts WHERE id=$1 FOR UPDATE", me.Account.Id); err != nil {
		t.Fatal(err)
	}
	result := make(chan *httptest.ResponseRecorder, 2)
	go func() { result <- f.call("GET", "/me", nil, cookie) }()
	go func() {
		result <- f.call("POST", "/auth/login", map[string]string{"email": "waiting@example.test", "password": password}, "")
	}()
	waitLock(t, f, "%FROM accounts%FOR SHARE%")
	if _, err = lock.Exec(context.Background(), "UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=$2 WHERE id=$1", me.Account.Id, admin.Account.Id); err != nil {
		t.Fatal(err)
	}
	if _, err = lock.Exec(context.Background(), "DELETE FROM sessions WHERE account_id=$1", me.Account.Id); err != nil {
		t.Fatal(err)
	}
	if err = lock.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		code(t, <-result, 403, "ACCOUNT_BLOCKED")
	}
	if scalar[int](t, f, "SELECT count(*) FROM sessions WHERE account_id=$1", me.Account.Id) != 0 {
		t.Fatal("login crossed block")
	}
}
func TestExpiryAndResetBarrierAfterWaiting(t *testing.T) {
	f := newFixture(t, false)
	cookie, me := f.register(t, "expiry@example.test")
	lock, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(context.Background())
	if _, err = lock.Exec(context.Background(), "SELECT id FROM accounts WHERE id=$1 FOR UPDATE", me.Account.Id); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- f.call("GET", "/me", nil, cookie) }()
	waitLock(t, f, "%FROM accounts%FOR SHARE%")
	f.now.Add(86400)
	if err = lock.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-done, 401, "SESSION_EXPIRED")
	f.now.Add(-86400)
	barrier, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer barrier.Rollback(context.Background())
	if _, err = barrier.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	go func() { done <- f.call("GET", "/me", nil, cookie) }()
	waitLock(t, f, "%demo_state%FOR SHARE%")
	if _, err = barrier.Exec(context.Background(), "DELETE FROM sessions"); err != nil {
		t.Fatal(err)
	}
	if err = barrier.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-done, 401, "SESSION_EXPIRED")
}

func TestSessionDatabaseIsAuthoritative(t *testing.T) {
	f := newFixture(t, false)
	cookie, me := f.register(t, "authoritative@example.test")
	execute(t, f, "UPDATE sessions SET token_hash=repeat('b',64)")
	code(t, f.call("GET", "/me", nil, cookie), 401, "SESSION_EXPIRED")
	execute(t, f, "UPDATE sessions SET token_hash=$1", authn.TokenDigest(cookie))
	execute(t, f, "UPDATE sessions SET created_at=created_at+interval '1 second',expires_at=expires_at+interval '1 second'")
	code(t, f.call("GET", "/me", nil, cookie), 401, "SESSION_EXPIRED")
	execute(t, f, "UPDATE sessions SET created_at=created_at-interval '1 second',expires_at=expires_at-interval '1 second'")
	execute(t, f, "UPDATE accounts SET system_role='ADMIN' WHERE id=$1", me.Account.Id)
	r := f.call("GET", "/me", nil, cookie)
	code(t, r, 200, "")
	var current openapi.Me
	_ = json.Unmarshal(r.Body.Bytes(), &current)
	if current.SystemRole != "ADMIN" {
		t.Fatal("role taken from token rather than database")
	}
	execute(t, f, "DELETE FROM sessions")
	code(t, f.call("GET", "/me", nil, cookie), 401, "SESSION_EXPIRED")
}
func TestRegisterLimitAndResetSerialization(t *testing.T) {
	f := newFixture(t, false)
	barrier, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer barrier.Rollback(context.Background())
	if _, err = barrier.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- f.call("POST", "/auth/register", map[string]string{"displayName": "After barrier", "email": "after-barrier@example.test", "password": password, "presetId": "ryadom-companion"}, "")
	}()
	waitLock(t, f, "%demo_state%FOR SHARE%")
	if scalar[int](t, f, "SELECT count(*) FROM accounts") != 0 {
		t.Fatal("register crossed reset barrier")
	}
	if _, err = barrier.Exec(context.Background(), "UPDATE demo_state SET generation=gen_random_uuid()"); err != nil {
		t.Fatal(err)
	}
	if err = barrier.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-done, 201, "")
	for index := 0; index < 20; index++ {
		r := f.call("POST", "/auth/register", map[string]string{"displayName": "Invalid preset", "email": "limited@example.test", "password": password, "presetId": "unknown"}, "")
		if index < 19 {
			code(t, r, 422, "VALIDATION_ERROR")
		} else {
			code(t, r, 429, "RATE_LIMITED")
			if r.Header().Get("Retry-After") != "3600" {
				t.Fatal("registration Retry-After")
			}
		}
	}
	if scalar[int](t, f, "SELECT count(*) FROM accounts") != 1 {
		t.Fatal("limited attempt created account")
	}
}
