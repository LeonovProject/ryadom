package organizations_test

import (
	"context"
	"github.com/google/uuid"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func pending(t *testing.T, f *fixture, owner string) (string, string) {
	t.Helper()
	org := createOrganization(t, f, owner)
	orgID := org["id"].(string)
	r := f.call("POST", "/organizations/"+orgID+"/application", nil, owner)
	code(t, r, 201, "")
	r.Code = 200
	return orgID, object(t, r)["id"].(string)
}
func eventInput(org string) map[string]any {
	return map[string]any{"organizer": map[string]any{"type": "ORGANIZATION", "organizationId": org}, "activityType": map[string]any{"name": "Клубная игра"}, "title": "Встреча допущенного клуба", "description": "Всем знакомство", "startsAt": "2026-11-07T18:00:00Z", "timezone": "Asia/Krasnoyarsk", "city": "Красноярск", "locationText": "У входа", "conditions": "Вода", "joinMode": "APPROVAL"}
}
func TestOrganizationDecisionsAndPublicationS2(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	user := f.login(t, "alex")
	admin := f.login(t, "marina")
	org, app := pending(t, f, owner)
	path := "/admin/applications/" + app + "/decision"
	code(t, f.call("GET", "/admin/organizations", nil, ""), 401, "AUTH_REQUIRED")
	for _, p := range []string{"/admin/organizations", "/admin/organizations/" + org} {
		code(t, f.call("GET", p, nil, user), 403, "FORBIDDEN")
	}
	code(t, f.call("POST", path, map[string]any{"decision": "APPROVE"}, user), 403, "FORBIDDEN")
	code(t, f.call("POST", "/events", eventInput(org), owner), 409, "ORG_NOT_APPROVED")
	for _, input := range []map[string]any{{"decision": "APPROVE", "reason": "extra"}, {"decision": "REJECT"}, {"decision": "REJECT", "reason": " \t "}, {"decision": "REJECT", "reason": strings.Repeat("a", 2001)}, {"decision": "OTHER"}, {"decision": "APPROVE", "reviewedBy": f.account(t, "alex")}} {
		code(t, f.call("POST", path, input, admin), 422, "VALIDATION_ERROR")
	}
	approved := object(t, f.call("POST", path, map[string]any{"decision": "APPROVE"}, admin))
	if approved["status"] != "APPROVED" || approved["reviewedBy"] != f.account(t, "marina") || approved["rejectionReason"] != nil {
		t.Fatal(approved)
	}
	f.now.Add(1)
	again := object(t, f.call("POST", path, map[string]any{"decision": "APPROVE"}, admin))
	if again["reviewedAt"] != approved["reviewedAt"] {
		t.Fatal("repeat changed decision date")
	}
	code(t, f.call("POST", path, map[string]any{"decision": "REJECT", "reason": "Changed"}, admin), 409, "DECISION_CONFLICT")
	public := f.call("GET", "/organizations/"+org, nil, "")
	validResponse(t, public, "PublicOrganization")
	profile := object(t, f.call("GET", "/me/organizations/"+org, nil, owner))
	if profile["canPublish"] != true || profile["approvalState"] != "APPROVED" {
		t.Fatal(profile)
	}
	response := f.call("POST", "/events", eventInput(org), owner)
	code(t, response, 201, "")
	response.Code = 200
	event := object(t, response)
	if event["organizer"].(map[string]any)["organization"].(map[string]any)["id"] != org {
		t.Fatal(event)
	}
	code(t, f.call("GET", "/events/"+event["id"].(string), nil, user), 200, "")
	list, _ := items(t, f.call("GET", "/events?organizationId="+org, nil, ""))
	if len(list) != 1 {
		t.Fatal("published organization event not in catalog")
	}
	rejectedOrg, rejectedApp := pending(t, f, owner)
	rejectedPath := "/admin/applications/" + rejectedApp + "/decision"
	rejected := object(t, f.call("POST", rejectedPath, map[string]any{"decision": "REJECT", "reason": " Уточните деятельность "}, admin))
	if rejected["status"] != "REJECTED" || rejected["rejectionReason"] != "Уточните деятельность" {
		t.Fatal(rejected)
	}
	repeat := object(t, f.call("POST", rejectedPath, map[string]any{"decision": "REJECT", "reason": "Уточните деятельность\n"}, admin))
	if repeat["reviewedAt"] != rejected["reviewedAt"] {
		t.Fatal("changed rejection")
	}
	for _, input := range []map[string]any{{"decision": "APPROVE"}, {"decision": "REJECT", "reason": "Другая причина"}} {
		code(t, f.call("POST", rejectedPath, input, admin), 409, "DECISION_CONFLICT")
	}
	private := object(t, f.call("GET", "/me/organizations/"+rejectedOrg, nil, owner))
	if private["application"].(map[string]any)["rejectionReason"] != "Уточните деятельность" || private["canPublish"] != false || private["canSubmit"] != false {
		t.Fatal(private)
	}
	code(t, f.call("GET", "/organizations/"+rejectedOrg, nil, ""), 404, "NOT_FOUND")
	code(t, f.call("POST", "/events", eventInput(rejectedOrg), owner), 409, "ORG_NOT_APPROVED")
	repeat = object(t, f.call("POST", "/organizations/"+rejectedOrg+"/application", nil, owner))
	if repeat["status"] != "REJECTED" {
		t.Fatal("resubmitted rejection")
	}
	code(t, f.call("POST", "/admin/applications/"+uuid.NewString()+"/decision", map[string]any{"decision": "APPROVE"}, admin), 404, "NOT_FOUND")
	code(t, f.call("GET", "/admin/organizations/"+uuid.NewString(), nil, admin), 404, "NOT_FOUND")
}
func TestAdminOrganizationSearchScopesAndPagination(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	admin := f.login(t, "marina")
	first := createOrganization(t, f, owner)
	second := createOrganization(t, f, owner)
	execute(t, f, "UPDATE organizations SET name=$2,description=$3,sport_interests=$4 WHERE id=$1", first["id"], "Точный\u00a0 КЛУБ %_", "Спорт для всех", "Скалолазание")
	execute(t, f, "UPDATE organizations SET name=$2,description=$3 WHERE id=$1", second["id"], "Точный клуб второй", "Скалолазание")
	for _, q := range []string{"%_", "ТОЧНЫЙ КЛУБ %_", "  Спорт\tдля всех ", "скалолазание"} {
		r := f.call("GET", "/admin/organizations?"+url.Values{"q": {q}, "limit": {"100"}}.Encode(), nil, admin)
		validResponse(t, r, "OrganizationPage")
		list, _ := items(t, r)
		want := 1
		if q == "скалолазание" {
			want = 2
		}
		if len(list) != want {
			t.Fatalf("search %s: %s", q, r.Body.String())
		}
		for _, v := range list {
			if v.(map[string]any)["canSubmit"] != false || v.(map[string]any)["canPublish"] != false {
				t.Fatal("ADMIN gained ownership")
			}
		}
	}
	for _, state := range []string{"NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED"} {
		list, _ := items(t, f.call("GET", "/admin/organizations?approvalState="+state, nil, admin))
		if len(list) == 0 {
			t.Fatal(state)
		}
		for _, v := range list {
			if v.(map[string]any)["approvalState"] != state {
				t.Fatal("state filter")
			}
		}
	}
	for _, q := range []string{"_not_wildcard_", "%not-wildcard%", "' OR 1=1 --"} {
		list, _ := items(t, f.call("GET", "/admin/organizations?q="+url.QueryEscape(q), nil, admin))
		if len(list) != 0 {
			t.Fatal("search wildcard")
		}
	}
	var seen []string
	q := url.Values{"limit": {"1"}}
	for page := 0; page < 10; page++ {
		list, next := items(t, f.call("GET", "/admin/organizations?"+q.Encode(), nil, admin))
		for _, v := range list {
			seen = append(seen, v.(map[string]any)["id"].(string))
		}
		if next == nil {
			break
		}
		q.Set("cursor", *next)
		q.Set("limit", "2")
	}
	if len(seen) != 7 {
		t.Fatal(seen)
	}
	rows, err := f.pool.Query(context.Background(), "SELECT id::text FROM organizations ORDER BY created_at,id")
	if err != nil {
		t.Fatal(err)
	}
	var expected []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			t.Fatal(err)
		}
		expected = append(expected, v)
	}
	rows.Close()
	if strings.Join(seen, ",") != strings.Join(expected, ",") {
		t.Fatal("wrong admin order")
	}
	_, cursor := items(t, f.call("GET", "/admin/organizations?limit=1", nil, admin))
	if cursor == nil {
		t.Fatal("cursor")
	}
	for _, path := range []string{"/admin/organizations?q=changed&cursor=", "/admin/organizations?approvalState=PENDING&cursor=", "/me/organizations?cursor="} {
		code(t, f.call("GET", path+url.QueryEscape(*cursor), nil, admin), 400, "INVALID_CURSOR")
	}
}
func TestConcurrentDecisionsWaitAndRollback(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	admin := f.login(t, "marina")
	_, app := pending(t, f, owner)
	path := "/admin/applications/" + app + "/decision"
	done := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() { done <- f.call("POST", path, map[string]any{"decision": "APPROVE"}, admin) }()
	}
	one, two := object(t, <-done), object(t, <-done)
	if one["reviewedAt"] != two["reviewedAt"] {
		t.Fatal("parallel same decision changed")
	}
	org, app := pending(t, f, owner)
	path = "/admin/applications/" + app + "/decision"
	go func() { done <- f.call("POST", path, map[string]any{"decision": "APPROVE"}, admin) }()
	go func() {
		done <- f.call("POST", path, map[string]any{"decision": "REJECT", "reason": "Нет допуска"}, admin)
	}()
	a, b := <-done, <-done
	if !((a.Code == 200 && b.Code == 409) || (a.Code == 409 && b.Code == 200)) {
		t.Fatalf("opposite results %d/%d", a.Code, b.Code)
	}
	// A blocked owner remains approved publicly, and ADMIN capabilities stay contextual.
	if scalar[string](t, f, "SELECT status FROM organization_applications WHERE id=$1", app) == "APPROVED" {
		code(t, f.call("GET", "/organizations/"+org, nil, ""), 200, "")
	}
	_, app = pending(t, f, owner)
	path = "/admin/applications/" + app + "/decision"
	execute(t, f, `CREATE FUNCTION fail_decision_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture decision failure'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_decision AFTER UPDATE ON organization_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_decision_commit()`)
	code(t, f.call("POST", path, map[string]any{"decision": "APPROVE"}, admin), 500, "INTERNAL_ERROR")
	if scalar[string](t, f, "SELECT status FROM organization_applications WHERE id=$1", app) != "PENDING" {
		t.Fatal("partial decision after failed commit")
	}
	execute(t, f, "DROP TRIGGER reject_decision ON organization_applications")
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	go func() { done <- f.call("POST", path, map[string]any{"decision": "APPROVE"}, admin) }()
	waitLock(t, f, "SELECT id FROM demo_state%")
	if _, err = tx.Exec(context.Background(), "DELETE FROM sessions WHERE account_id=$1", f.account(t, "marina")); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-done:
		code(t, r, 401, "SESSION_EXPIRED")
	case <-time.After(5 * time.Second):
		t.Fatal("stale admin after barrier")
	}
}
