package events_test

import (
	"bytes"
	"context"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	accountmoderation "github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts/moderation"
	"github.com/google/uuid"
)

func accountModerationFixture(t *testing.T) *fixture {
	t.Helper()
	f := adminFixture(t)
	s, err := accountmoderation.New(f.accountService, bytes.Repeat([]byte{7}, 32), func() time.Time { return time.Unix(f.now.Load(), 0).UTC() })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Register(f.server); err != nil {
		t.Fatal(err)
	}
	return f
}
func accountStatus(f *fixture, id, status string, revision int, session string) *httptest.ResponseRecorder {
	return f.call("PATCH", "/admin/accounts/"+id+"/status", map[string]any{"status": status, "expectedRevision": revision}, session)
}
func TestAccountModerationSessionsAndPreservation(t *testing.T) {
	f := accountModerationFixture(t)
	admin := f.login(t, "marina")
	first := f.login(t, "anna")
	second := f.login(t, "anna")
	reader := f.login(t, "alex")
	id := f.account(t, "anna")
	path := "/admin/accounts/" + id
	for _, p := range []string{"/admin/accounts", path} {
		code(t, f.call("GET", p, nil, ""), 401, "AUTH_REQUIRED")
		code(t, f.call("GET", p, nil, reader), 403, "FORBIDDEN")
	}
	code(t, accountStatus(f, id, "BLOCKED", 1, reader), 403, "FORBIDDEN")
	initial := f.call("GET", path, nil, admin)
	validResponse(t, initial, "AdminAccount")
	if object(t, initial)["blockedAt"] != nil {
		t.Fatal("active block metadata")
	}
	snapshot := func() string {
		var values []string
		for _, table := range []string{"account_avatars", "organizations", "organization_applications", "activity_types", "events", "participations", "messages", "reports", "demo_state"} {
			values = append(values, scalar[string](t, f, "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text FROM "+table+" t"))
		}
		return strings.Join(values, "\n")
	}
	before := snapshot()
	blockedR := accountStatus(f, id, "BLOCKED", 1, admin)
	validResponse(t, blockedR, "AdminAccount")
	blocked := object(t, blockedR)
	if blocked["status"] != "BLOCKED" || blocked["revision"] != float64(2) || blocked["blockedAt"] == nil || blocked["blockedByAccountId"] != f.account(t, "marina") || blocked["account"].(map[string]any)["isBlocked"] != true {
		t.Fatal(blocked)
	}
	if scalar[int](t, f, "SELECT count(*) FROM sessions WHERE account_id=$1", id) != 0 || snapshot() != before {
		t.Fatal("sessions not revoked or content changed")
	}
	for _, session := range []string{first, second} {
		code(t, f.call("GET", "/me", nil, session), 403, "ACCOUNT_BLOCKED")
		code(t, f.call("POST", "/events", creation(), session), 403, "ACCOUNT_BLOCKED")
	}
	code(t, f.call("POST", "/auth/login", map[string]any{"email": "anna@example.test", "password": "wrong password"}, ""), 401, "INVALID_CREDENTIALS")
	code(t, f.call("POST", "/auth/login", map[string]any{"email": "anna@example.test", "password": "Ryadom-Anna-2026!"}, ""), 403, "ACCOUNT_BLOCKED")
	code(t, accountStatus(f, id, "BLOCKED", 1, admin), 409, "ACCOUNT_REVISION_CONFLICT")
	stored := scalar[string](t, f, "SELECT row_to_json(a)::text FROM accounts a WHERE id=$1", id)
	object(t, accountStatus(f, id, "BLOCKED", 2, admin))
	if scalar[string](t, f, "SELECT row_to_json(a)::text FROM accounts a WHERE id=$1", id) != stored {
		t.Fatal("same-revision repeat rewrote metadata")
	}
	public := object(t, f.call("GET", "/accounts/"+id, nil, ""))
	if len(public) != 4 || public["isBlocked"] != true {
		t.Fatal("public account privacy/state")
	}
	football := f.event(t, "Футбол во дворе")
	detail := object(t, f.call("GET", "/events/"+football, nil, reader))
	if detail["organizer"].(map[string]any)["ownerIsBlocked"] != true || detail["publicationStatus"] != "PUBLISHED" {
		t.Fatal("block became unpublication")
	}
	activeR := accountStatus(f, id, "ACTIVE", 2, admin)
	validResponse(t, activeR, "AdminAccount")
	active := object(t, activeR)
	if active["revision"] != float64(3) || active["blockedAt"] != nil || active["blockedByAccountId"] != nil {
		t.Fatal(active)
	}
	for _, session := range []string{first, second} {
		code(t, f.call("GET", "/me", nil, session), 401, "SESSION_EXPIRED")
	}
	fresh := f.login(t, "anna")
	code(t, f.call("GET", "/me", nil, fresh), 200, "")
	if snapshot() != before {
		t.Fatal("unblock changed content")
	}
	// Protected targets are rejected before trying their exclusive lock.
	secondAdmin, me := f.register(t, "be13-second-admin@example.test")
	execute(t, f, "UPDATE accounts SET system_role='ADMIN' WHERE id=$1", me.Account.Id)
	done := make(chan *httptest.ResponseRecorder, 2)
	go func() { done <- accountStatus(f, me.Account.Id.String(), "BLOCKED", 99, admin) }()
	go func() { done <- accountStatus(f, f.account(t, "marina"), "BLOCKED", 99, secondAdmin) }()
	for i := 0; i < 2; i++ {
		select {
		case r := <-done:
			code(t, r, 409, "ACCOUNT_PROTECTED")
		case <-time.After(3 * time.Second):
			t.Fatal("protected ADMIN lock wait")
		}
	}
	code(t, accountStatus(f, f.account(t, "marina"), "BLOCKED", 1, admin), 409, "ACCOUNT_PROTECTED")
	code(t, accountStatus(f, uuid.NewString(), "BLOCKED", 1, admin), 404, "NOT_FOUND")
	for _, body := range []map[string]any{{"status": "BLOCKED", "expectedRevision": 3, "reason": "extra"}, {"status": "BLOCKED", "expectedRevision": 0}, {"status": "ADMIN", "expectedRevision": 3}} {
		code(t, f.call("PATCH", path+"/status", body, admin), 422, "VALIDATION_ERROR")
	}
}
func TestAccountModerationFiltersAndCursor(t *testing.T) {
	f := accountModerationFixture(t)
	admin := f.login(t, "marina")
	id := f.account(t, "anna")
	execute(t, f, `INSERT INTO accounts(display_name,email,password_hash,created_at) SELECT 'Filter filler '||n,'be13-'||n||'@example.test',a.password_hash,'2026-10-19T10:00:00Z' FROM accounts a,generate_series(1,23)n WHERE a.demo_key='alex'`)
	filtered := f.call("GET", "/admin/accounts?status=BLOCKED&limit=1", nil, admin)
	validResponse(t, filtered, "AdminAccountPage")
	list, next := items(t, filtered)
	if len(list) != 1 || next != nil || list[0].(map[string]any)["status"] != "BLOCKED" {
		t.Fatal("filter after limit")
	}
	for _, q := range []string{"  ANNA@EXAMPLE.TEST  ", "  АННА  ", strings.ToUpper(id)} {
		list, _ = items(t, f.call("GET", "/admin/accounts?q="+url.QueryEscape(q), nil, admin))
		if len(list) != 1 || list[0].(map[string]any)["account"].(map[string]any)["id"] != id {
			t.Fatal("name/email/UUID search")
		}
	}
	list, _ = items(t, f.call("GET", "/admin/accounts?q=%25", nil, admin))
	if len(list) != 0 {
		t.Fatal("wildcard search")
	}
	_, cursor := items(t, f.call("GET", "/admin/accounts?status=ACTIVE&limit=1", nil, admin))
	if cursor == nil {
		t.Fatal("missing cursor")
	}
	for _, filter := range []string{"status=BLOCKED", "status=ACTIVE&q=anna"} {
		code(t, f.call("GET", "/admin/accounts?"+filter+"&cursor="+url.QueryEscape(*cursor), nil, admin), 400, "INVALID_CURSOR")
	}
	other, me := f.register(t, "be13-cursor-admin@example.test")
	execute(t, f, "UPDATE accounts SET system_role='ADMIN' WHERE id=$1", me.Account.Id)
	code(t, f.call("GET", "/admin/accounts?status=ACTIVE&cursor="+url.QueryEscape(*cursor), nil, other), 400, "INVALID_CURSOR")
	var got []string
	q := url.Values{"status": {"ACTIVE"}, "limit": {"7"}}
	for i := 0; i < 10; i++ {
		page, c := items(t, f.call("GET", "/admin/accounts?"+q.Encode(), nil, admin))
		for _, v := range page {
			got = append(got, v.(map[string]any)["account"].(map[string]any)["id"].(string))
		}
		if c == nil {
			break
		}
		q.Set("cursor", *c)
	}
	all, _ := items(t, f.call("GET", "/admin/accounts?status=ACTIVE&limit=100", nil, admin))
	var want []string
	for _, v := range all {
		want = append(want, v.(map[string]any)["account"].(map[string]any)["id"].(string))
	}
	if len(got) != len(want) || strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatal("descending pagination")
	}
	code(t, f.call("GET", "/admin/accounts?cursor=bad.signature", nil, admin), 400, "INVALID_CURSOR")
}
func TestAccountModerationCommitAndWaits(t *testing.T) {
	f := accountModerationFixture(t)
	admin := f.login(t, "marina")
	user := f.login(t, "anna")
	id := f.account(t, "anna")
	before := scalar[string](t, f, "SELECT row_to_json(a)::text FROM accounts a WHERE id=$1", id)
	count := scalar[int](t, f, "SELECT count(*) FROM sessions WHERE account_id=$1", id)
	execute(t, f, `CREATE FUNCTION reject_block_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_block_commit AFTER DELETE ON sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_block_commit()`)
	code(t, accountStatus(f, id, "BLOCKED", 1, admin), 500, "INTERNAL_ERROR")
	if scalar[string](t, f, "SELECT row_to_json(a)::text FROM accounts a WHERE id=$1", id) != before || scalar[int](t, f, "SELECT count(*) FROM sessions WHERE account_id=$1", id) != count {
		t.Fatal("partial failed block")
	}
	execute(t, f, "DROP TRIGGER reject_block_commit ON sessions")
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM accounts WHERE id=$1 FOR UPDATE", id); err != nil {
		t.Fatal(err)
	}
	block := make(chan *httptest.ResponseRecorder, 1)
	login := make(chan *httptest.ResponseRecorder, 1)
	operation := make(chan *httptest.ResponseRecorder, 1)
	go func() { block <- accountStatus(f, id, "BLOCKED", 1, admin) }()
	waitLock(t, f, "%accounts WHERE id=%FOR UPDATE%")
	go func() {
		login <- f.call("POST", "/auth/login", map[string]any{"email": "anna@example.test", "password": "Ryadom-Anna-2026!"}, "")
	}()
	waitLock(t, f, "%accounts WHERE email =%FOR SHARE%")
	go func() { operation <- f.call("POST", "/events", creation(), user) }()
	waitLock(t, f, "%accounts WHERE id =%FOR SHARE%")
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-block, 200, "")
	code(t, <-login, 403, "ACCOUNT_BLOCKED")
	code(t, <-operation, 403, "ACCOUNT_BLOCKED")
	if scalar[int](t, f, "SELECT count(*) FROM sessions WHERE account_id=$1", id) != 0 {
		t.Fatal("login escaped block")
	}
	object(t, accountStatus(f, id, "ACTIVE", 2, admin))
	done := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() { done <- accountStatus(f, id, "BLOCKED", 3, admin) }()
	}
	a, b := <-done, <-done
	if !((a.Code == 200 && b.Code == 409) || (a.Code == 409 && b.Code == 200)) {
		t.Fatalf("concurrent revision %d/%d", a.Code, b.Code)
	}
}
