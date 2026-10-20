package events_test

import (
	"bytes"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	activityreview "github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes/review"
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
