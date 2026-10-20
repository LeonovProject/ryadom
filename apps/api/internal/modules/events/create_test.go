package events_test

import (
	"context"
	"github.com/google/uuid"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func creation() map[string]any {
	return map[string]any{
		"organizer": map[string]any{"type": "PERSONAL"}, "activityType": map[string]any{"name": "  Новый\u00a0 спорт  "},
		"title": "  Первая встреча  ", "description": " Подробное описание ", "startsAt": "2026-11-07T18:00:00.123456Z", "timezone": "Asia/Krasnoyarsk",
		"city": " Красноярск ", "locationText": " У входа ", "conditions": "  ", "joinMode": "OPEN",
	}
}
func created(t *testing.T, r *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	code(t, r, 201, "")
	r.Code = 200
	validResponse(t, r, "EventDetail")
	return object(t, r)
}
func TestCreateAtomicPersonalAndSharedActivity(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	anna := f.login(t, "anna")
	other := f.login(t, "alex")
	before := scalar[int](t, f, "SELECT count(*) FROM events")
	body := created(t, f.call("POST", "/events", creation(), anna))
	id := body["id"].(string)
	if body["title"] != "Первая встреча" || body["conditions"] != "" || body["publicationStatus"] != "PUBLISHED" || body["activityTypeReview"].(map[string]any)["catalogStatus"] != "PENDING" {
		t.Fatal(body)
	}
	if scalar[int](t, f, "SELECT count(*) FROM events") != before+1 {
		t.Fatal("event not saved")
	}
	activity := body["activityType"].(map[string]any)["id"]
	if scalar[string](t, f, "SELECT normalized_name FROM activity_types WHERE id=$1", activity) != "новый спорт" {
		t.Fatal("normalization")
	}
	public := object(t, f.call("GET", "/events/"+id, nil, other))
	if public["activityTypeReview"] != nil || public["capabilities"].(map[string]any)["canJoin"] != true {
		t.Fatal(public)
	}
	list, _ := items(t, f.call("GET", "/events?q="+url.QueryEscape("новый спорт"), nil, ""))
	wantIDs(t, list, id)
	input := creation()
	input["activityType"] = map[string]any{"name": "НОВЫЙ СПОРТ"}
	second := created(t, f.call("POST", "/events", input, other))
	if second["activityType"].(map[string]any)["id"] != activity {
		t.Fatal("duplicate activity")
	}
	for _, variant := range []any{map[string]any{"name": "  ДВОРОВЫЕ   ЭСТАФЕТЫ  "}, map[string]any{"id": scalar[string](t, f, "SELECT id::text FROM activity_types WHERE catalog_status='REJECTED'")}} {
		input = creation()
		input["activityType"] = variant
		value := created(t, f.call("POST", "/events", input, anna))
		if value["activityTypeReview"].(map[string]any)["catalogStatus"] != "REJECTED" {
			t.Fatal("decision reset")
		}
	}
	input = creation()
	input["activityType"] = map[string]any{"name": "е\u0308ж"}
	one := created(t, f.call("POST", "/events", input, anna))
	input["activityType"] = map[string]any{"name": "ЁЖ"}
	two := created(t, f.call("POST", "/events", input, other))
	if one["activityType"].(map[string]any)["id"] != two["activityType"].(map[string]any)["id"] {
		t.Fatal("NFC duplicate")
	}
}
func TestCreateValidationOrganizationRightsAndRollback(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	anna := f.login(t, "anna")
	admin := f.login(t, "marina")
	initial := scalar[int](t, f, "SELECT count(*) FROM events")
	types := scalar[int](t, f, "SELECT count(*) FROM activity_types")
	for key, value := range map[string]any{"title": "  ", "description": "\n", "locationText": " ", "city": " ", "timezone": "Local", "startsAt": "2026-10-20T12:00:00Z", "joinMode": "INVALID", "extra": "field", "activityType": map[string]any{"id": uuid.NewString(), "name": "both"}} {
		input := creation()
		input[key] = value
		code(t, f.call("POST", "/events", input, anna), 422, "VALIDATION_ERROR")
	}
	for _, zone := range []string{"Mars/Olympus", "../etc/passwd", "/usr/share/zoneinfo/UTC"} {
		input := creation()
		input["timezone"] = zone
		code(t, f.call("POST", "/events", input, anna), 422, "VALIDATION_ERROR")
	}
	for _, name := range []string{"\x00", " ", strings.Repeat("a", 101)} {
		input := creation()
		input["activityType"] = map[string]any{"name": name}
		code(t, f.call("POST", "/events", input, anna), 422, "VALIDATION_ERROR")
	}
	input := creation()
	input["activityType"] = map[string]any{"id": uuid.NewString()}
	code(t, f.call("POST", "/events", input, anna), 404, "NOT_FOUND")
	code(t, f.call("POST", "/events", creation(), ""), 401, "AUTH_REQUIRED")
	for _, status := range []string{"NOT_SUBMITTED", "PENDING", "REJECTED", "APPROVED"} {
		var org string
		if status == "NOT_SUBMITTED" {
			org = scalar[string](t, f, "SELECT o.id::text FROM organizations o LEFT JOIN organization_applications a ON a.organization_id=o.id WHERE a.id IS NULL")
		} else {
			org = scalar[string](t, f, "SELECT organization_id::text FROM organization_applications WHERE status=$1 LIMIT 1", status)
		}
		input := creation()
		input["organizer"] = map[string]any{"type": "ORGANIZATION", "organizationId": org}
		code(t, f.call("POST", "/events", input, admin), 404, "NOT_FOUND")
		if status == "APPROVED" {
			value := created(t, f.call("POST", "/events", input, anna))
			if value["organizer"].(map[string]any)["type"] != "ORGANIZATION" {
				t.Fatal(value)
			}
		} else {
			code(t, f.call("POST", "/events", input, anna), 409, "ORG_NOT_APPROVED")
		}
	}
	if scalar[int](t, f, "SELECT count(*) FROM events") != initial+1 || scalar[int](t, f, "SELECT count(*) FROM activity_types") != types+1 {
		t.Fatal("invalid creation left rows")
	}
	// A failure at COMMIT must roll back both the activity and event, not publish 201.
	execute(t, f, `CREATE FUNCTION fail_event_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit rejection'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_new_event AFTER INSERT ON events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_event_commit()`)
	input = creation()
	input["activityType"] = map[string]any{"name": "Rollback sport"}
	code(t, f.call("POST", "/events", input, anna), 500, "INTERNAL_ERROR")
	if scalar[int](t, f, "SELECT count(*) FROM activity_types WHERE normalized_name='rollback sport'") != 0 {
		t.Fatal("orphan activity after commit failure")
	}
}
func TestConcurrentActivityAndTimeAfterWait(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	one := f.login(t, "anna")
	two := f.login(t, "alex")
	done := make(chan *httptest.ResponseRecorder, 2)
	go func() { done <- f.call("POST", "/events", creation(), one) }()
	go func() { done <- f.call("POST", "/events", creation(), two) }()
	a := created(t, <-done)
	b := created(t, <-done)
	if a["activityType"].(map[string]any)["id"] != b["activityType"].(map[string]any)["id"] {
		t.Fatal("parallel name duplicated")
	}
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM activity_types WHERE normalized_name='новый спорт' FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	input := creation()
	input["startsAt"] = time.Unix(f.now.Load()+1, 0).Format(time.RFC3339)
	go func() { done <- f.call("POST", "/events", input, one) }()
	waitLock(t, f, "%activity_types%")
	f.now.Add(1)
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-done, 422, "VALIDATION_ERROR")
}
