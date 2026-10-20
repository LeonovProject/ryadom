package events_test

import (
	"bytes"
	"context"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/modules/discussion"
	eventmoderation "github.com/LeonovProject/ryadom/apps/api/internal/modules/moderation/events"
	messagemoderation "github.com/LeonovProject/ryadom/apps/api/internal/modules/moderation/messages"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/participation"
	"github.com/google/uuid"
)

func adminFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t, false)
	clock := func() time.Time { return time.Unix(f.now.Load(), 0).UTC() }
	if err := eventmoderation.Register(f.server, f.eventService); err != nil {
		t.Fatal(err)
	}
	part, err := participation.New(f.accountService, f.eventService, bytes.Repeat([]byte{7}, 32), clock)
	if err != nil {
		t.Fatal(err)
	}
	if err = part.Register(f.server); err != nil {
		t.Fatal(err)
	}
	messages, err := discussion.New(f.accountService, bytes.Repeat([]byte{7}, 32), clock)
	if err != nil {
		t.Fatal(err)
	}
	if err = messages.Register(f.server); err != nil {
		t.Fatal(err)
	}
	if err = messagemoderation.Register(f.server, messages); err != nil {
		t.Fatal(err)
	}
	f.seed(t)
	return f
}
func unpublish(f *fixture, event, reason, session string) *httptest.ResponseRecorder {
	return f.call("POST", "/admin/events/"+event+"/unpublish", map[string]any{"reason": reason}, session)
}
func TestAdminEventUnpublicationS6(t *testing.T) {
	f := adminFixture(t)
	admin := f.login(t, "marina")
	owner := f.login(t, "anna")
	alex := f.login(t, "alex")
	ivan := f.login(t, "ivan")
	event := f.event(t, "Шахматы в парке")
	path := "/admin/events/" + event
	for _, p := range []string{"/admin/events", path} {
		code(t, f.call("GET", p, nil, alex), 403, "FORBIDDEN")
		code(t, f.call("GET", p, nil, ""), 401, "AUTH_REQUIRED")
	}
	code(t, unpublish(f, event, "Причина", owner), 403, "FORBIDDEN")
	joined := f.call("POST", "/events/"+event+"/participations", nil, alex)
	code(t, joined, 201, "")
	beforeR := f.call("GET", path, nil, admin)
	validResponse(t, beforeR, "AdminEvent")
	before := object(t, beforeR)
	if before["openEventReportsCount"].(float64) < 1 || before["openMessageReportsCount"].(float64) < 1 || before["canManageParticipants"] != false || before["canUnpublish"] != true {
		t.Fatal(before)
	}
	messages := scalar[string](t, f, "SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM messages m WHERE event_id=$1", event)
	participants := scalar[string](t, f, "SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM participations p WHERE event_id=$1", event)
	messageReports := scalar[string](t, f, "SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text FROM reports r JOIN messages m ON m.id=r.target_message_id WHERE m.event_id=$1", event)
	resultR := unpublish(f, event, "  Некорректные условия встречи  ", admin)
	validResponse(t, resultR, "AdminEvent")
	result := object(t, resultR)
	if result["publicationStatus"] != "UNPUBLISHED" || result["canUnpublish"] != false || result["openEventReportsCount"] != float64(0) || result["openMessageReportsCount"] != before["openMessageReportsCount"] || result["eventReportsRevision"] != before["eventReportsRevision"].(float64)+1 {
		t.Fatal(result)
	}
	if result["unpublication"].(map[string]any)["reason"] != "Некорректные условия встречи" {
		t.Fatal("reason normalization")
	}
	if scalar[string](t, f, "SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM messages m WHERE event_id=$1", event) != messages || scalar[string](t, f, "SELECT jsonb_agg(to_jsonb(p) ORDER BY id)::text FROM participations p WHERE event_id=$1", event) != participants || scalar[string](t, f, "SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text FROM reports r JOIN messages m ON m.id=r.target_message_id WHERE m.event_id=$1", event) != messageReports {
		t.Fatal("unrelated data changed")
	}
	snapshot := scalar[string](t, f, "SELECT row_to_json(e)::text FROM events e WHERE id=$1", event)
	object(t, unpublish(f, event, "Некорректные условия встречи", admin))
	code(t, unpublish(f, event, "Другая причина", admin), 409, "DECISION_CONFLICT")
	if scalar[string](t, f, "SELECT row_to_json(e)::text FROM events e WHERE id=$1", event) != snapshot {
		t.Fatal("repeat changed event")
	}
	for _, session := range []string{owner, admin, alex} {
		r := f.call("GET", "/events/"+event, nil, session)
		validResponse(t, r, "UnavailableEventDetail")
		v := object(t, r)
		if v["unpublishReason"] == nil && (session == owner || session == admin) {
			t.Fatal("reason hidden from owner/admin")
		}
		if session == alex && v["unpublishReason"] != nil {
			t.Fatal("reason leaked to participant")
		}
		code(t, f.call("POST", "/events/"+event+"/participations", nil, session), 409, "EVENT_UNAVAILABLE")
		code(t, f.call("POST", "/events/"+event+"/messages", map[string]any{"body": "Ещё вопрос"}, session), 409, "EVENT_UNAVAILABLE")
	}
	for _, session := range []string{"", ivan} {
		code(t, f.call("GET", "/events/"+event, nil, session), 404, "NOT_FOUND")
	}
	code(t, f.call("POST", "/events/"+event+"/participations", nil, ivan), 404, "NOT_FOUND")
	for _, session := range []string{"", owner, admin, alex} {
		code(t, f.call("GET", "/events/"+event+"/messages", nil, session), 404, "NOT_FOUND")
	}
	code(t, f.call("GET", "/events/"+event+"/participations", nil, owner), 200, "")
	validResponse(t, f.call("GET", path+"/messages", nil, admin), "AdminMessagePage")
	all, _ := items(t, f.call("GET", "/me/participations?limit=100", nil, alex))
	found := false
	for _, v := range all {
		e := v.(map[string]any)["event"].(map[string]any)
		if e["id"] == event {
			found = true
			if len(e) != 3 {
				t.Fatal("private details in saved participation")
			}
		}
	}
	if !found {
		t.Fatal("saved participation missing")
	}
	catalog, _ := items(t, f.call("GET", "/events?limit=100", nil, ""))
	for _, v := range catalog {
		if v.(map[string]any)["id"] == event {
			t.Fatal("unpublished in catalog")
		}
	}
	// Unpublishing an APPROVAL event also closes decisions on existing PENDING.
	approval := f.event(t, "Футбол во дворе")
	pending := scalar[string](t, f, "SELECT id::text FROM participations WHERE event_id=$1 AND account_id=$2", approval, f.account(t, "ivan"))
	object(t, unpublish(f, approval, "Условия требуют уточнения", admin))
	for _, kind := range []string{"ACCEPT", "REJECT"} {
		code(t, f.call("POST", "/participations/"+pending+"/decision", map[string]any{"decision": kind}, owner), 409, "EVENT_UNAVAILABLE")
	}
	if scalar[string](t, f, "SELECT status FROM participations WHERE id=$1", pending) != "PENDING" {
		t.Fatal("pending decision changed")
	}
	code(t, unpublish(f, uuid.NewString(), "Причина", admin), 404, "NOT_FOUND")
	for _, body := range []map[string]any{{"reason": " \n\t"}, {"reason": "bad\x00reason"}, {"reason": "text", "publicationStatus": "UNPUBLISHED"}, {"reason": strings.Repeat("я", 2001)}} {
		code(t, f.call("POST", path+"/unpublish", body, admin), 422, "VALIDATION_ERROR")
	}
}
func TestAdminEventFiltersAndCursor(t *testing.T) {
	f := adminFixture(t)
	admin := f.login(t, "marina")
	// Put reported events behind more than a page of newer unreported meetings.
	execute(t, f, `INSERT INTO events(created_by_account_id,organizer_account_id,activity_type_id,title,description,starts_at,timezone,city,location_text,join_mode,created_at) SELECT a.id,a.id,t.id,'Filter filler '||n,'No reports','2026-11-07T00:00:00Z','UTC','Город','Парк','OPEN','2026-10-20T12:00:00Z' FROM accounts a,activity_types t,generate_series(1,23)n WHERE a.email='anna@example.test' AND t.name='Бег'`)
	f.now.Add(1)
	for _, q := range []string{"hasOpenReports=true&limit=1", "publicationStatus=UNPUBLISHED&limit=100", "organizationId=" + scalar[string](t, f, "SELECT organization_id::text FROM events WHERE title='Футбол во дворе'") + "&limit=100", "activityTypeId=" + scalar[string](t, f, "SELECT id::text FROM activity_types WHERE name='Бег'") + "&limit=100"} {
		r := f.call("GET", "/admin/events?"+q, nil, admin)
		validResponse(t, r, "AdminEventPage")
		list, _ := items(t, r)
		if len(list) == 0 {
			t.Fatal("filter dropped data")
		}
		for _, v := range list {
			e := v.(map[string]any)
			if strings.Contains(q, "hasOpenReports=true") && e["openEventReportsCount"].(float64)+e["openMessageReportsCount"].(float64) == 0 {
				t.Fatal("filter applied after limit")
			}
			if strings.Contains(q, "publicationStatus=UNPUBLISHED") && e["publicationStatus"] != "UNPUBLISHED" {
				t.Fatal("publication filter")
			}
		}
	}
	// Both publication states remain visible for a catalog direction.
	activity := scalar[string](t, f, "SELECT id::text FROM activity_types WHERE name='Бег'")
	list, _ := items(t, f.call("GET", "/admin/events?activityTypeId="+activity+"&limit=100", nil, admin))
	states := map[string]bool{}
	for _, v := range list {
		states[v.(map[string]any)["publicationStatus"].(string)] = true
	}
	if !states["PUBLISHED"] || !states["UNPUBLISHED"] {
		t.Fatal("activity lost a publication state")
	}
	_, cursor := items(t, f.call("GET", "/admin/events?hasOpenReports=false&limit=1", nil, admin))
	if cursor == nil {
		t.Fatal("cursor missing")
	}
	for _, q := range []string{"hasOpenReports=true", "hasOpenReports=false&publicationStatus=PUBLISHED", "hasOpenReports=false&q=бег", "hasOpenReports=false&activityTypeId=" + activity} {
		code(t, f.call("GET", "/admin/events?"+q+"&cursor="+url.QueryEscape(*cursor), nil, admin), 400, "INVALID_CURSOR")
	}
	var got []string
	q := url.Values{"hasOpenReports": {"false"}, "limit": {"7"}}
	for i := 0; i < 20; i++ {
		page, next := items(t, f.call("GET", "/admin/events?"+q.Encode(), nil, admin))
		for _, v := range page {
			got = append(got, v.(map[string]any)["id"].(string))
		}
		if next == nil {
			break
		}
		q.Set("cursor", *next)
	}
	all, _ := items(t, f.call("GET", "/admin/events?hasOpenReports=false&limit=100", nil, admin))
	var want []string
	for _, v := range all {
		want = append(want, v.(map[string]any)["id"].(string))
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatal("unstable descending cursor")
	}
	query, _ := items(t, f.call("GET", "/admin/events?q="+url.QueryEscape("  ШАХМАТЫ   ")+"&limit=100", nil, admin))
	if len(query) == 0 {
		t.Fatal("normalized query")
	}
	literal, _ := items(t, f.call("GET", "/admin/events?q=%25&limit=100", nil, admin))
	if len(literal) != 0 {
		t.Fatal("wildcard search")
	}
}
func TestUnpublishAtomicityAndConcurrentJoin(t *testing.T) {
	f := adminFixture(t)
	admin := f.login(t, "marina")
	alex := f.login(t, "alex")
	event := f.event(t, "Шахматы в парке")
	before := scalar[string](t, f, "SELECT row_to_json(e)::text FROM events e WHERE id=$1", event)
	execute(t, f, `CREATE FUNCTION reject_unpublication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_unpublication AFTER UPDATE ON reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_unpublication()`)
	code(t, unpublish(f, event, "Fixture", admin), 500, "INTERNAL_ERROR")
	if scalar[string](t, f, "SELECT row_to_json(e)::text FROM events e WHERE id=$1", event) != before || scalar[int](t, f, "SELECT count(*) FROM reports WHERE target_event_id=$1 AND status='OPEN'", event) == 0 {
		t.Fatal("partial failed commit")
	}
	execute(t, f, "DROP TRIGGER reject_unpublication ON reports")
	done := make(chan *httptest.ResponseRecorder, 2)
	go func() { done <- f.call("POST", "/events/"+event+"/participations", nil, alex) }()
	go func() { done <- unpublish(f, event, "Fixture", admin) }()
	a, b := <-done, <-done
	if !((a.Code == 201 || a.Code == 404 || a.Code == 409) && b.Code == 200 || (b.Code == 201 || b.Code == 404 || b.Code == 409) && a.Code == 200) {
		t.Fatalf("race %d/%d", a.Code, b.Code)
	}
	count := scalar[int](t, f, "SELECT count(*) FROM participations WHERE event_id=$1 AND account_id=$2", event, f.account(t, "alex"))
	if (a.Code == 201 || b.Code == 201) && count != 1 {
		t.Fatal("successful join lost")
	}
	if a.Code != 201 && b.Code != 201 && count != 0 {
		t.Fatal("rejected join persisted")
	}
	go func() { done <- unpublish(f, event, "Fixture", admin) }()
	go func() { done <- unpublish(f, event, "Other", admin) }()
	a, b = <-done, <-done
	if !((a.Code == 200 && b.Code == 409) || (a.Code == 409 && b.Code == 200)) {
		t.Fatal("concurrent reasons")
	}
	// The winning state also governs a request queued behind the event lock.
	other := f.event(t, "Пробежка для знакомства")
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM events WHERE id=$1 FOR UPDATE", other); err != nil {
		t.Fatal(err)
	}
	go func() { done <- unpublish(f, other, "Late", admin) }()
	waitLock(t, f, "%FROM events WHERE id=%FOR UPDATE%")
	if _, err = tx.Exec(context.Background(), "UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=$2,unpublish_reason='Earlier' WHERE id=$1", other, f.account(t, "marina")); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-done, 409, "DECISION_CONFLICT")
}
