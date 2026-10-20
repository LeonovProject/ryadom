package events_test

import (
	"bytes"
	"context"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	activityreview "github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes/review"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/admin/demoreset"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/discussion"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/reports"
	"github.com/google/uuid"
)

func reviewFixture(t *testing.T) *fixture {
	t.Helper()
	f := adminFixture(t)
	s, err := activityreview.New(f.accountService, bytes.Repeat([]byte{7}, 32), func() time.Time { return time.Unix(f.now.Load(), 0).UTC() })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Register(f.server); err != nil {
		t.Fatal(err)
	}
	return f
}
func TestP3ActivityReview(t *testing.T) {
	f := reviewFixture(t)
	admin := f.login(t, "marina")
	user := f.login(t, "alex")
	code(t, f.call("GET", "/admin/activity-types", nil, user), 403, "FORBIDDEN")
	r := f.call("GET", "/admin/activity-types?catalogStatus=PENDING&limit=1", nil, admin)
	validResponse(t, r, "AdminActivityTypePage")
	list, cursor := items(t, r)
	first := list[0].(map[string]any)
	if cursor == nil {
		t.Fatal("pending cursor")
	}
	code(t, f.call("GET", "/admin/activity-types?catalogStatus=APPROVED&cursor="+url.QueryEscape(*cursor), nil, admin), 400, "INVALID_CURSOR")
	next, _ := items(t, f.call("GET", "/admin/activity-types?catalogStatus=PENDING&cursor="+url.QueryEscape(*cursor), nil, admin))
	second := next[0].(map[string]any)
	path := "/admin/activity-types/" + first["id"].(string)
	code(t, f.call("POST", path+"/decision", map[string]any{"decision": "APPROVE", "expectedName": "Устарело"}, admin), 409, "ACTIVITY_TYPE_CHANGED")
	code(t, f.call("POST", path+"/decision", map[string]any{"decision": "APPROVE", "expectedName": first["name"], "name": "Бег"}, admin), 409, "ACTIVITY_TYPE_NAME_CONFLICT")
	if scalar[string](t, f, "SELECT catalog_status FROM activity_types WHERE id=$1", first["id"]) != "PENDING" {
		t.Fatal("partial decision")
	}
	input := map[string]any{"decision": "APPROVE", "expectedName": first["name"], "name": "  Новый   спорт "}
	decidedR := f.call("POST", path+"/decision", input, admin)
	validResponse(t, decidedR, "AdminActivityType")
	decided := object(t, decidedR)
	if decided["name"] != "Новый спорт" || decided["catalogStatus"] != "APPROVED" || decided["reviewedBy"] == nil || decided["eventCount"].(float64) < 1 {
		t.Fatal(decided)
	}
	snapshot := scalar[string](t, f, "SELECT row_to_json(t)::text FROM activity_types t WHERE id=$1", first["id"])
	object(t, f.call("POST", path+"/decision", input, admin))
	if scalar[string](t, f, "SELECT row_to_json(t)::text FROM activity_types t WHERE id=$1", first["id"]) != snapshot {
		t.Fatal("repeat changed decision")
	}
	code(t, f.call("POST", path+"/decision", map[string]any{"decision": "REJECT", "expectedName": "ignored", "reason": "Other"}, admin), 409, "DECISION_CONFLICT")
	secondPath := "/admin/activity-types/" + second["id"].(string)
	reject := map[string]any{"decision": "REJECT", "expectedName": second["name"], "reason": " Уточните название "}
	object(t, f.call("POST", secondPath+"/decision", reject, admin))
	object(t, f.call("POST", secondPath+"/decision", reject, admin))
	// Renaming competes across all states; exactly one can reserve the free key.
	done := make(chan *httptest.ResponseRecorder, 2)
	go func() {
		done <- f.call("PATCH", path, map[string]any{"expectedName": "Новый спорт", "name": "Общее свободное имя"}, admin)
	}()
	go func() {
		done <- f.call("PATCH", secondPath, map[string]any{"expectedName": second["name"], "name": "Общее свободное имя"}, admin)
	}()
	a, b := <-done, <-done
	if !((a.Code == 200 && b.Code == 409) || (a.Code == 409 && b.Code == 200)) {
		t.Fatalf("rename race %d/%d", a.Code, b.Code)
	}
	// Seed rename leaves its decision metadata absent and its ID stable.
	seedID := scalar[string](t, f, "SELECT id::text FROM activity_types WHERE name='Бег'")
	seed := f.call("PATCH", "/admin/activity-types/"+seedID, map[string]any{"expectedName": "Бег", "name": "Бег трусцой"}, admin)
	validResponse(t, seed, "AdminActivityType")
	v := object(t, seed)
	if v["isSeeded"] != true || v["createdBy"] != nil || v["reviewedBy"] != nil {
		t.Fatal(v)
	}
	code(t, f.call("PATCH", "/admin/activity-types/"+seedID, map[string]any{"expectedName": "Бег", "name": "Другое имя"}, admin), 409, "ACTIVITY_TYPE_CHANGED")
}

func reportsFixture(t *testing.T) *fixture {
	t.Helper()
	f := reviewFixture(t)
	clock := func() time.Time { return time.Unix(f.now.Load(), 0).UTC() }
	m, err := discussion.New(f.accountService, bytes.Repeat([]byte{7}, 32), clock)
	if err != nil {
		t.Fatal(err)
	}
	s, err := reports.New(f.eventService, m, clock)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Register(f.server); err != nil {
		t.Fatal(err)
	}
	return f
}
func p3Created(t *testing.T, r *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	code(t, r, 201, "")
	r.Code = 200
	return object(t, r)
}
func TestP3ReportsAndRestore(t *testing.T) {
	f := reportsFixture(t)
	owner := f.login(t, "anna")
	alex := f.login(t, "alex")
	dasha := f.login(t, "dasha")
	ivan := f.login(t, "ivan")
	admin := f.login(t, "marina")
	event := f.add(t, "Report target", "2026-11-07T00:00:00Z", "UTC", "Город", "Бег", "anna", "")
	path := "/events/" + event + "/reports"
	code(t, f.call("POST", path, nil, ""), 401, "AUTH_REQUIRED")
	code(t, f.call("POST", path, nil, owner), 403, "CANNOT_REPORT_OWN_CONTENT")
	done := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() { done <- f.call("POST", path, nil, alex) }()
	}
	a, b := <-done, <-done
	if a.Code+b.Code != 401 {
		t.Fatalf("parallel report %d/%d", a.Code, b.Code)
	}
	if a.Code == 201 {
		a.Code = 200
	}
	if b.Code == 201 {
		b.Code = 200
	}
	validResponse(t, a, "Report")
	if object(t, a)["id"] != object(t, b)["id"] {
		t.Fatal("duplicate report")
	}
	dismiss := "/admin/events/" + event + "/reports/dismiss"
	code(t, f.call("POST", dismiss, map[string]any{"expectedReportsRevision": 0}, admin), 409, "REPORTS_CHANGED")
	p3Created(t, f.call("POST", path, nil, dasha))
	object(t, f.call("POST", dismiss, map[string]any{"expectedReportsRevision": 2}, admin))
	repeat := object(t, f.call("POST", path, nil, alex))
	if repeat["status"] != "DISMISSED" {
		t.Fatal("closed report reopened")
	}
	p3Created(t, f.call("POST", path, nil, ivan))
	code(t, f.call("POST", dismiss, map[string]any{"expectedReportsRevision": 2}, admin), 409, "REPORTS_CHANGED")
	m := p3Created(t, f.call("POST", "/events/"+event+"/messages", map[string]any{"body": "Исходный текст"}, alex))
	id := m["id"].(string)
	mp := "/messages/" + id + "/reports"
	ap := "/admin/messages/" + id
	code(t, f.call("POST", mp, nil, alex), 403, "CANNOT_REPORT_OWN_CONTENT")
	p3Created(t, f.call("POST", mp, nil, owner))
	p3Created(t, f.call("POST", mp, nil, dasha))
	hidden := object(t, f.call("POST", ap+"/hide", map[string]any{"expectedRevision": 0}, admin))
	if hidden["openReportsCount"] != float64(0) || hidden["reportsRevision"] != float64(3) {
		t.Fatal(hidden)
	}
	if object(t, f.call("POST", mp, nil, owner))["status"] != "RESOLVED" {
		t.Fatal("hidden repeat")
	}
	code(t, f.call("POST", mp, nil, ivan), 409, "MESSAGE_UNAVAILABLE")
	code(t, f.call("POST", ap+"/restore", map[string]any{"expectedRevision": 0}, admin), 409, "MESSAGE_CHANGED")
	restored := f.call("POST", ap+"/restore", map[string]any{"expectedRevision": 1}, admin)
	validResponse(t, restored, "AdminMessage")
	v := object(t, restored)
	if v["body"] != m["body"] || v["createdAt"] != m["createdAt"] || v["status"] != "VISIBLE" || v["hiddenAt"] == nil || v["restoredAt"] == nil {
		t.Fatal(v)
	}
	object(t, f.call("POST", ap+"/restore", map[string]any{"expectedRevision": 0}, admin))
	code(t, f.call("POST", ap+"/hide", map[string]any{"expectedRevision": 0}, admin), 409, "MESSAGE_CHANGED")
	p3Created(t, f.call("POST", mp, nil, ivan))
	code(t, f.call("POST", ap+"/reports/dismiss", map[string]any{"expectedReportsRevision": 3}, admin), 409, "REPORTS_CHANGED")
	object(t, f.call("POST", ap+"/reports/dismiss", map[string]any{"expectedReportsRevision": 4}, admin))
	object(t, f.call("POST", ap+"/reports/dismiss", map[string]any{"expectedReportsRevision": 0}, admin))
	code(t, f.call("GET", ap, nil, owner), 403, "FORBIDDEN")
	object(t, unpublish(f, event, "Причина", admin))
	code(t, f.call("POST", path, nil, alex), 404, "NOT_FOUND")
	code(t, f.call("POST", path, nil, owner), 409, "EVENT_UNAVAILABLE")
	object(t, f.call("POST", ap+"/hide", map[string]any{"expectedRevision": 2}, admin))
	object(t, f.call("POST", ap+"/restore", map[string]any{"expectedRevision": 3}, admin))
	code(t, f.call("GET", "/events/"+event+"/messages", nil, admin), 404, "NOT_FOUND")
}

func registerReset(t *testing.T, f *fixture, enabled bool) {
	t.Helper()
	s, err := demoreset.New(enabled, false, "ryadom-companion", func() time.Time { return time.Unix(f.now.Load(), 0).UTC() })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Register(f.server); err != nil {
		t.Fatal(err)
	}
}
func TestP3ResetDisabled(t *testing.T) {
	f := newFixture(t, false)
	registerReset(t, f, false)
	code(t, f.call("GET", "/admin/demo-state", nil, ""), 404, "NOT_FOUND")
	code(t, f.call("POST", "/admin/demo-reset", nil, ""), 404, "NOT_FOUND")
}
func TestP3DemoReset(t *testing.T) {
	f := reportsFixture(t)
	registerReset(t, f, true)
	admin := f.login(t, "marina")
	otherAdmin := f.login(t, "marina")
	user := f.login(t, "alex")
	oldAccount := f.account(t, "alex")
	code(t, f.call("GET", "/admin/demo-state", nil, user), 403, "FORBIDDEN")
	r := f.call("GET", "/admin/demo-state", nil, admin)
	validResponse(t, r, "DemoState")
	state := object(t, r)
	if state["lastReset"] != nil {
		t.Fatal("unexpected receipt")
	}
	input := map[string]any{"expectedGeneration": state["generation"], "expectedSeedVersion": state["seedVersion"], "resetId": uuid.NewString(), "confirmation": "СБРОСИТЬ"}
	wrong := map[string]any{"expectedGeneration": state["generation"], "expectedSeedVersion": "wrong", "resetId": uuid.NewString(), "confirmation": "СБРОСИТЬ"}
	code(t, f.call("POST", "/admin/demo-reset", wrong, admin), 409, "DEMO_STATE_CHANGED")
	tables := []string{"accounts", "account_avatars", "sessions", "organizations", "organization_applications", "activity_types", "events", "participations", "messages", "reports", "demo_state"}
	snapshot := func() string {
		var data []string
		for _, table := range tables {
			data = append(data, scalar[string](t, f, "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text FROM "+table+" t"))
		}
		return strings.Join(data, "\n")
	}
	before := snapshot()
	execute(t, f, `CREATE FUNCTION reject_reset_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture seed failure'; END $$`)
	execute(t, f, `CREATE TRIGGER reject_reset_seed BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION reject_reset_seed()`)
	failed := f.call("POST", "/admin/demo-reset", input, admin)
	code(t, failed, 500, "INTERNAL_ERROR")
	if failed.Header().Get("Set-Cookie") != "" || snapshot() != before {
		t.Fatal("reset rollback changed data/session/cookie")
	}
	execute(t, f, "DROP TRIGGER reject_reset_seed ON messages")
	// Busy failure leaves every row and session intact.
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR SHARE"); err != nil {
		t.Fatal(err)
	}
	code(t, f.call("POST", "/admin/demo-reset", input, admin), 409, "DEMO_RESET_BUSY")
	if snapshot() != before {
		t.Fatal("busy reset changed data")
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Queue reset behind an exclusive fixture barrier, then the business operation.
	tx, err = f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	business := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- f.call("POST", "/admin/demo-reset", input, admin) }()
	waitLock(t, f, "%demo_state%FOR UPDATE%")
	go func() { business <- f.call("POST", "/events", creation(), user) }()
	waitLock(t, f, "%demo_state%FOR SHARE%")
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	receiptR := <-done
	validResponse(t, receiptR, "DemoResetReceipt")
	receipt := object(t, receiptR)
	cookies := receiptR.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge != -1 {
		t.Fatal("reset did not clear cookie")
	}
	code(t, <-business, 401, "SESSION_EXPIRED")
	code(t, f.call("GET", "/me", nil, otherAdmin), 401, "SESSION_EXPIRED")
	code(t, f.call("GET", "/me", nil, user), 401, "SESSION_EXPIRED")
	if scalar[int](t, f, "SELECT count(*) FROM sessions") != 0 || f.account(t, "alex") == oldAccount || receipt["generation"] == state["generation"] || receipt["resetId"] != input["resetId"] {
		t.Fatal("reset did not replace dataset/session/generation")
	}
	admin = f.login(t, "marina")
	current := object(t, f.call("GET", "/admin/demo-state", nil, admin))
	last := current["lastReset"].(map[string]any)
	if last["resetId"] != input["resetId"] || last["generation"] != receipt["generation"] {
		t.Fatal("lost-response receipt missing")
	}
	after := snapshot()
	code(t, f.call("POST", "/admin/demo-reset", input, admin), 409, "DEMO_STATE_CHANGED")
	if snapshot() != after {
		t.Fatal("old request reset fresh data")
	}
	input["expectedGeneration"] = receipt["generation"]
	code(t, f.call("POST", "/admin/demo-reset", input, admin), 409, "DEMO_STATE_CHANGED")
}
