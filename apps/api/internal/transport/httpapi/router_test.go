package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/transaction"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/jackc/pgx/v5"
)

type testTx struct {
	pgx.Tx
	committed bool
	commitErr error
}

func (tx *testTx) QueryRow(context.Context, string, ...any) pgx.Row { return testRow{} }
func (tx *testTx) Commit(context.Context) error {
	tx.committed = tx.commitErr == nil
	return tx.commitErr
}
func (tx *testTx) Rollback(context.Context) error { return nil }

type testRow struct{}

func (testRow) Scan(dest ...any) error { *dest[0].(*int) = 1; return nil }

type testDB struct {
	tx     *testTx
	begins int
}

func (db *testDB) BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error) {
	db.begins++
	return db.tx, nil
}

type expiredGuard struct{}

func (expiredGuard) Authenticate(context.Context, pgx.Tx, string) (transaction.Principal, error) {
	e := fault.New(401, openapi.ErrorCodeSESSIONEXPIRED, "Сессия истекла.")
	e.ClearSession = true
	return transaction.Principal{}, e
}
func (expiredGuard) Authorize(context.Context, pgx.Tx, transaction.Access, transaction.Principal, transaction.Resource) error {
	panic("unexpected authorization")
}

func newTestServer(t *testing.T, ready func(context.Context) error) (*Server, *testDB) {
	t.Helper()
	db := &testDB{tx: &testTx{}}
	s, err := New(Options{Origin: "https://ryadom.example", CookieSecure: true, Ready: ready, Transactions: &transaction.Runner{DB: db}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	return s, db
}

func request(s *Server, method, path, body string, headers map[string]string, chunked bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if chunked {
		r.ContentLength = -1
	}
	for name, value := range headers {
		r.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func assertError(t *testing.T, w *httptest.ResponseRecorder, status int, code openapi.ErrorCode) openapi.Error {
	t.Helper()
	var response openapi.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err, w.Body.String())
	}
	if w.Code != status || response.Error.Code != code {
		t.Fatalf("got %d %s, want %d %s", w.Code, w.Body.String(), status, code)
	}
	if response.Error.FieldErrors == nil || response.Error.RequestId == "" || response.Error.RequestId != w.Header().Get("X-Request-ID") || w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("invalid error envelope", w.Header(), w.Body.String())
	}
	return response.Error
}

func TestHealthDoesNotUseBarrier(t *testing.T) {
	ready := false
	s, db := newTestServer(t, func(context.Context) error {
		if !ready {
			return errors.New("SQL password must stay private")
		}
		return nil
	})
	for _, path := range []string{"/api/v1/health/live", "/api/v1/health/ready"} {
		w := request(s, "GET", path, "", map[string]string{"Cookie": "ryadom_session=invalid", "X-Request-ID": "untrusted"}, false)
		if strings.HasSuffix(path, "live") {
			if w.Code != 200 || w.Body.String() != "{\"status\":\"ok\"}\n" {
				t.Fatal(w.Code, w.Body.String())
			}
		} else {
			assertError(t, w, 503, openapi.ErrorCodeSERVICEUNAVAILABLE)
		}
		if w.Header().Get("X-Request-ID") == "untrusted" || strings.Contains(w.Body.String(), "password") {
			t.Fatal("untrusted data leaked")
		}
	}
	ready = true
	if w := request(s, "GET", "/api/v1/health/ready", "", nil, false); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if db.begins != 0 {
		t.Fatal("health acquired the business barrier")
	}
	assertError(t, request(s, "GET", "/api/v1/health/live?extra=1", "", nil, false), 400, openapi.ErrorCodeINVALIDREQUEST)
	assertError(t, request(s, "GET", "/api/v1/health/live", "x", nil, true), 400, openapi.ErrorCodeINVALIDREQUEST)
	assertError(t, request(s, "GET", "/api/v1/events", "", nil, false), 404, openapi.ErrorCodeNOTFOUND)
}

func TestContractValidationBeforeTransaction(t *testing.T) {
	s, db := newTestServer(t, func(context.Context) error { return nil })
	called := 0
	if err := s.Register("register", func(ctx context.Context, r Request) (Response, error) {
		called++
		var input openapi.RegisterInput
		if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
			return Response{}, err
		}
		if input.Password != "  abcdefghijklmno  " {
			t.Fatal("password changed")
		}
		return Response{Status: 204}, nil
	}); err != nil {
		t.Fatal(err)
	}
	valid := `{"displayName":"Алексей","email":"alex@example.test","password":"  abcdefghijklmno  ","presetId":"ryadom-companion"}`
	for _, test := range []struct {
		name, body, origin, contentType, encoding, query string
		status                                           int
		code                                             openapi.ErrorCode
		chunked                                          bool
	}{
		{name: "missing origin", body: valid, contentType: "application/json", status: 403, code: openapi.ErrorCodeCSRFREJECTED},
		{name: "foreign origin", body: valid, origin: "https://evil.example", contentType: "application/json", status: 403, code: openapi.ErrorCodeCSRFREJECTED},
		{name: "null origin", body: valid, origin: "null", contentType: "application/json", status: 403, code: openapi.ErrorCodeCSRFREJECTED},
		{name: "wrong media", body: valid, origin: "https://ryadom.example", contentType: "text/plain", status: 415, code: openapi.ErrorCodeUNSUPPORTEDMEDIATYPE},
		{name: "compression", body: valid, origin: "https://ryadom.example", contentType: "application/json", encoding: "gzip", status: 415, code: openapi.ErrorCodeUNSUPPORTEDMEDIATYPE},
		{name: "malformed JSON", body: `{"password":`, origin: "https://ryadom.example", contentType: "application/json", status: 400, code: openapi.ErrorCodeINVALIDREQUEST},
		{name: "two JSON objects", body: valid + valid, origin: "https://ryadom.example", contentType: "application/json", status: 400, code: openapi.ErrorCodeINVALIDREQUEST},
		{name: "missing fields", body: `{}`, origin: "https://ryadom.example", contentType: "application/json", status: 422, code: openapi.ErrorCodeVALIDATIONERROR},
		{name: "null body", body: `null`, origin: "https://ryadom.example", contentType: "application/json", status: 422, code: openapi.ErrorCodeVALIDATIONERROR},
		{name: "unknown property", body: strings.TrimSuffix(valid, "}") + `,"role":"ADMIN"}`, origin: "https://ryadom.example", contentType: "application/json", status: 422, code: openapi.ErrorCodeVALIDATIONERROR},
		{name: "unknown query", body: valid, origin: "https://ryadom.example", contentType: "application/json", query: "?role=ADMIN", status: 400, code: openapi.ErrorCodeINVALIDREQUEST},
		{name: "too large known", body: strings.Repeat("x", 65537), origin: "https://ryadom.example", contentType: "application/json", status: 413, code: openapi.ErrorCodePAYLOADTOOLARGE},
		{name: "too large chunked", body: strings.Repeat("x", 65537), origin: "https://ryadom.example", contentType: "application/json", status: 413, code: openapi.ErrorCodePAYLOADTOOLARGE, chunked: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			headers := map[string]string{"Origin": test.origin, "Content-Type": test.contentType, "Content-Encoding": test.encoding}
			w := request(s, "POST", "/api/v1/auth/register"+test.query, test.body, headers, test.chunked)
			e := assertError(t, w, test.status, test.code)
			if strings.Contains(w.Body.String(), "abcdefghijklmno") {
				t.Fatal("password in error")
			}
			if test.name == "missing fields" && e.FieldErrors["/presetId"] == nil {
				t.Fatal("missing field pointer", e.FieldErrors)
			}
			if test.name == "unknown property" && e.FieldErrors["/role"] == nil {
				t.Fatal("unknown field pointer", e.FieldErrors)
			}
		})
	}
	if db.begins != 0 || called != 0 {
		t.Fatal("invalid input reached database")
	}
	w := request(s, "POST", "/api/v1/auth/register", valid, map[string]string{"Origin": "https://ryadom.example", "Content-Type": "application/json; charset=UTF-8", "Cookie": "ryadom_session=ignored"}, false)
	if w.Code != 204 || !db.tx.committed || called != 1 {
		t.Fatal(w.Code, w.Body.String(), db.tx.committed, called)
	}
	if err := s.Register("register", func(context.Context, Request) (Response, error) { return Response{}, nil }); err == nil {
		t.Fatal("duplicate registration")
	}
}

func TestParametersAndMediaBodyLimit(t *testing.T) {
	s, db := newTestServer(t, func(context.Context) error { return nil })
	for _, id := range []string{"listEvents", "setEventCover"} {
		if err := s.Register(id, func(context.Context, Request) (Response, error) { return Response{Status: 204}, nil }); err != nil {
			t.Fatal(err)
		}
	}
	for _, query := range []string{"?limit=1&limit=2", "?limit=x", "?unknown=1", "?q=%ZZ"} {
		assertError(t, request(s, "GET", "/api/v1/events"+query, "", nil, false), 400, openapi.ErrorCodeINVALIDREQUEST)
	}
	for _, size := range []int{1048576, 1048577} {
		body := `{"svg":"<svg/>"}` + strings.Repeat(" ", size-len(`{"svg":"<svg/>"}`))
		w := request(s, "PUT", "/api/v1/events/00000000-0000-4000-8000-000000000001/cover", body, map[string]string{"Origin": "https://ryadom.example", "Content-Type": "application/json"}, true)
		if size == 1048576 {
			assertError(t, w, 401, openapi.ErrorCodeAUTHREQUIRED)
		} else {
			assertError(t, w, 413, openapi.ErrorCodePAYLOADTOOLARGE)
		}
	}
	if db.begins != 1 {
		t.Fatalf("unexpected transactions: %d", db.begins)
	}
}

func TestCommitFailureAndRecovery(t *testing.T) {
	s, db := newTestServer(t, func(context.Context) error { return nil })
	db.tx.commitErr = errors.New("database secret")
	if err := s.Register("getAccount", func(context.Context, Request) (Response, error) {
		return Response{Status: 200, Body: map[string]bool{"success": true}, Header: http.Header{"Set-Cookie": []string{"new-session"}}}, nil
	}); err != nil {
		t.Fatal(err)
	}
	w := request(s, "GET", "/api/v1/accounts/00000000-0000-4000-8000-000000000001", "", nil, false)
	assertError(t, w, 500, openapi.ErrorCodeINTERNALERROR)
	if w.Header().Get("Set-Cookie") != "" || strings.Contains(w.Body.String(), "success") || strings.Contains(w.Body.String(), "secret") {
		t.Fatal("success or internal detail escaped failed commit")
	}
	if err := s.Register("listEvents", func(context.Context, Request) (Response, error) { panic("do not expose") }); err != nil {
		t.Fatal(err)
	}
	assertError(t, request(s, "GET", "/api/v1/events", "", nil, false), 500, openapi.ErrorCodeINTERNALERROR)
}

func TestOptionalSessionAndCookieCleanup(t *testing.T) {
	s, _ := newTestServer(t, func(context.Context) error { return nil })
	s.options.Transactions.Guard = expiredGuard{}
	if err := s.Register("getEvent", func(context.Context, Request) (Response, error) { return Response{Status: 204}, nil }); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/events/00000000-0000-4000-8000-000000000001"
	if w := request(s, "GET", path, "", nil, false); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, token := range []string{"invalid", ""} {
		w := request(s, "GET", path, "", map[string]string{"Cookie": "ryadom_session=" + token}, false)
		assertError(t, w, 401, openapi.ErrorCodeSESSIONEXPIRED)
		cookies := w.Result().Cookies()
		if len(cookies) != 1 || cookies[0].MaxAge != -1 || cookies[0].Path != "/api/v1" || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode {
			t.Fatal("cookie not cleared safely", cookies)
		}
	}
}

func TestStaticCatalogSkipsBarrier(t *testing.T) {
	s, db := newTestServer(t, func(context.Context) error { return nil })
	if err := s.Register("listAvatarPresets", func(_ context.Context, r Request) (Response, error) {
		if r.Tx != nil {
			t.Fatal("static catalog got a transaction")
		}
		return Response{Status: 204}, nil
	}); err != nil {
		t.Fatal(err)
	}
	w := request(s, "GET", "/api/v1/avatar-presets", "", map[string]string{"Cookie": "ryadom_session=ignored"}, false)
	if w.Code != 204 || db.begins != 0 {
		t.Fatal(w.Code, db.begins)
	}
}

type validGuard struct{}

func (validGuard) Authenticate(context.Context, pgx.Tx, string) (transaction.Principal, error) {
	return transaction.Principal{AccountID: "actor", Role: openapi.MeSystemRoleUSER}, nil
}
func (validGuard) Authorize(context.Context, pgx.Tx, transaction.Access, transaction.Principal, transaction.Resource) error {
	return nil
}

func TestProtectedFieldsFollowAuthentication(t *testing.T) {
	s, _ := newTestServer(t, func(context.Context) error { return nil })
	s.options.Transactions.Guard = validGuard{}
	if err := s.Register("createEvent", func(context.Context, Request) (Response, error) {
		t.Fatal("invalid fields reached module")
		return Response{}, nil
	}); err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"Origin": "https://ryadom.example", "Content-Type": "application/json"}
	assertError(t, request(s, "POST", "/api/v1/events", `{}`, headers, false), 401, openapi.ErrorCodeAUTHREQUIRED)
	headers["Cookie"] = "ryadom_session=valid-for-test"
	assertError(t, request(s, "POST", "/api/v1/events", `{}`, headers, false), 422, openapi.ErrorCodeVALIDATIONERROR)
}
