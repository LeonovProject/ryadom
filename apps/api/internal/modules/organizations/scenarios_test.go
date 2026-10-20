package organizations_test

import (
	"context"
	"encoding/json"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func (f *fixture) login(t *testing.T, name string) string {
	t.Helper()
	passwords := map[string]string{"alex": "Alex", "anna": "Anna", "marina": "Marina", "ivan": "Ivan", "dasha": "Dasha"}
	r := f.call("POST", "/auth/login", map[string]string{"email": name + "@example.test", "password": "Ryadom-" + passwords[name] + "-2026!"}, "")
	code(t, r, 200, "")
	return token(t, r)
}
func object(t *testing.T, r *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	code(t, r, 200, "")
	var body map[string]any
	if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}
func items(t *testing.T, r *httptest.ResponseRecorder) ([]any, *string) {
	t.Helper()
	body := object(t, r)
	list, ok := body["items"].([]any)
	if !ok {
		t.Fatal("items must be an array")
	}
	var cursor *string
	if body["nextCursor"] != nil {
		value := body["nextCursor"].(string)
		cursor = &value
	}
	return list, cursor
}
func validResponse(t *testing.T, r *httptest.ResponseRecorder, schema string) {
	t.Helper()
	code(t, r, 200, "")
	var value any
	if err := json.Unmarshal(r.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	spec, err := openapi.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	if err = spec.Components.Schemas[schema].Value.VisitJSON(value); err != nil {
		t.Fatalf("%s response invalid: %v; %s", schema, err, r.Body.String())
	}
}
func (f *fixture) account(t *testing.T, name string) string {
	return scalar[string](t, f, `SELECT id::text FROM accounts WHERE email=$1`, name+"@example.test")
}

func organizationInput() map[string]any {
	return map[string]any{"name": " Новый клуб ", "description": " Спортивные встречи ", "sportInterests": " Бег и шахматы "}
}
func createOrganization(t *testing.T, f *fixture, token string) map[string]any {
	t.Helper()
	r := f.call("POST", "/organizations", organizationInput(), token)
	code(t, r, 201, "")
	r.Code = 200
	validResponse(t, r, "PrivateOrganization")
	return object(t, r)
}
func TestOrganizationCreationPrivacyAndSubmission(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	other := f.login(t, "alex")
	admin := f.login(t, "marina")
	org := createOrganization(t, f, owner)
	id := org["id"].(string)
	if org["name"] != "Новый клуб" || org["approvalState"] != "NOT_SUBMITTED" || org["application"] != nil || org["canSubmit"] != true || org["canPublish"] != false {
		t.Fatal(org)
	}
	for _, session := range []string{"", owner, other, admin} {
		code(t, f.call("GET", "/organizations/"+id, nil, session), 404, "NOT_FOUND")
	}
	for _, session := range []string{other, admin} {
		code(t, f.call("GET", "/me/organizations/"+id, nil, session), 404, "NOT_FOUND")
		code(t, f.call("POST", "/organizations/"+id+"/application", nil, session), 404, "NOT_FOUND")
	}
	code(t, f.call("GET", "/me/organizations/"+uuid.NewString(), nil, owner), 404, "NOT_FOUND")
	pending := f.call("POST", "/organizations/"+id+"/application", nil, owner)
	code(t, pending, 201, "")
	pending.Code = 200
	validResponse(t, pending, "OrganizationApplication")
	app := object(t, pending)
	if app["status"] != "PENDING" || app["reviewedAt"] != nil || app["reviewedBy"] != nil || app["rejectionReason"] != nil {
		t.Fatal(app)
	}
	repeated := object(t, f.call("POST", "/organizations/"+id+"/application", nil, owner))
	if repeated["id"] != app["id"] || repeated["createdAt"] != app["createdAt"] {
		t.Fatal("duplicate submission")
	}
	profile := object(t, f.call("GET", "/me/organizations/"+id, nil, owner))
	if profile["approvalState"] != "PENDING" || profile["canSubmit"] != false || profile["canPublish"] != false {
		t.Fatal(profile)
	}
	for _, status := range []string{"REJECTED", "APPROVED"} {
		reason := any(nil)
		if status == "REJECTED" {
			reason = "Причина отказа"
		}
		execute(t, f, "UPDATE organization_applications SET status=$2,reviewed_at=now(),reviewed_by=$3,rejection_reason=$4 WHERE organization_id=$1", id, status, f.account(t, "marina"), reason)
		repeat := object(t, f.call("POST", "/organizations/"+id+"/application", nil, owner))
		if repeat["status"] != status || repeat["id"] != app["id"] {
			t.Fatal("terminal submission reset")
		}
		profile = object(t, f.call("GET", "/me/organizations/"+id, nil, owner))
		if profile["canSubmit"] != false || profile["canPublish"] != (status == "APPROVED") {
			t.Fatal(profile)
		}
		if status == "APPROVED" {
			public := f.call("GET", "/organizations/"+id, nil, "broken-cookie")
			validResponse(t, public, "PublicOrganization")
			if len(object(t, public)) != 6 {
				t.Fatal("private organization leaked")
			}
		}
	}
	execute(t, f, "UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=$2 WHERE id=$1", f.account(t, "anna"), f.account(t, "marina"))
	public := object(t, f.call("GET", "/organizations/"+id, nil, ""))
	if public["ownerIsBlocked"] != true {
		t.Fatal("block removed organization")
	}
	code(t, f.call("GET", "/me/organizations/"+id, nil, owner), 403, "ACCOUNT_BLOCKED")
	code(t, f.call("POST", "/organizations/"+id+"/application", nil, owner), 403, "ACCOUNT_BLOCKED")
}
func TestOrganizationListPaginationAndValidation(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	other := f.login(t, "alex")
	for key, value := range map[string]any{"name": " ", "description": "\t", "sportInterests": " ", "ownerAccountId": uuid.NewString(), "approvalState": "APPROVED"} {
		input := organizationInput()
		input[key] = value
		code(t, f.call("POST", "/organizations", input, owner), 422, "VALIDATION_ERROR")
	}
	code(t, f.call("POST", "/organizations", organizationInput(), ""), 401, "AUTH_REQUIRED")
	empty, next := items(t, f.call("GET", "/me/organizations", nil, other))
	if len(empty) != 0 || next != nil {
		t.Fatal("empty list")
	}
	for i := 0; i < 2; i++ {
		createOrganization(t, f, owner)
	}
	var seen []string
	q := url.Values{"limit": {"2"}}
	for page := 0; page < 10; page++ {
		r := f.call("GET", "/me/organizations?"+q.Encode(), nil, owner)
		validResponse(t, r, "OrganizationPage")
		list, next := items(t, r)
		for _, v := range list {
			seen = append(seen, v.(map[string]any)["id"].(string))
		}
		if next == nil {
			break
		}
		q.Set("cursor", *next)
	}
	if len(seen) != 7 {
		t.Fatalf("own list rows %v", seen)
	}
	for i := 1; i < len(seen); i++ {
		if seen[i] == seen[i-1] {
			t.Fatal("duplicate list")
		}
	}
	_, cursor := items(t, f.call("GET", "/me/organizations?limit=1", nil, owner))
	if cursor == nil {
		t.Fatal("cursor missing")
	}
	for _, session := range []string{other} {
		code(t, f.call("GET", "/me/organizations?cursor="+url.QueryEscape(*cursor), nil, session), 400, "INVALID_CURSOR")
	}
	code(t, f.call("GET", "/me/organizations?cursor=", nil, owner), 400, "INVALID_CURSOR")
	code(t, f.call("GET", "/me/organizations?limit=100&cursor="+url.QueryEscape(*cursor), nil, owner), 200, "")
}
func TestOrganizationConcurrentSubmitAndCommitFailure(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	org := createOrganization(t, f, owner)
	path := "/organizations/" + org["id"].(string) + "/application"
	done := make(chan *httptest.ResponseRecorder, 2)
	go func() { done <- f.call("POST", path, nil, owner) }()
	go func() { done <- f.call("POST", path, nil, owner) }()
	a, b := <-done, <-done
	if a.Code+b.Code != 401 {
		t.Fatalf("concurrent statuses %d/%d", a.Code, b.Code)
	}
	if a.Code == 201 {
		a.Code = 200
	}
	if b.Code == 201 {
		b.Code = 200
	}
	if object(t, a)["id"] != object(t, b)["id"] {
		t.Fatal("duplicate application")
	}
	fresh := createOrganization(t, f, owner)
	execute(t, f, `CREATE FUNCTION fail_org_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER fail_submission AFTER INSERT ON organization_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_org_commit()`)
	code(t, f.call("POST", "/organizations/"+fresh["id"].(string)+"/application", nil, owner), 500, "INTERNAL_ERROR")
	if scalar[int](t, f, "SELECT count(*) FROM organization_applications WHERE organization_id=$1", fresh["id"]) != 0 {
		t.Fatal("partial submission")
	}
	// Wait behind reset barrier, then reject the old session rather than submitting.
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	go func() { done <- f.call("POST", "/organizations/"+fresh["id"].(string)+"/application", nil, owner) }()
	waitLock(t, f, "SELECT id FROM demo_state%")
	if _, err = tx.Exec(context.Background(), "DELETE FROM sessions"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-done:
		code(t, r, 401, "SESSION_EXPIRED")
	case <-time.After(5 * time.Second):
		t.Fatal("barrier wait")
	}
}
