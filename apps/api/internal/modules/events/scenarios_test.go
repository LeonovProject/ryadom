package events_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"

	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
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
func (f *fixture) event(t *testing.T, title string) string {
	return scalar[string](t, f, `SELECT id::text FROM events WHERE title=$1`, title)
}
func (f *fixture) add(t *testing.T, title, starts, zone, city, activity, owner, organization string) string {
	t.Helper()
	id := uuid.NewString()
	var personal, org any
	ownerID := f.account(t, owner)
	if organization == "" {
		personal = ownerID
	} else {
		org = organization
	}
	execute(t, f, `INSERT INTO events (id,created_by_account_id,organizer_account_id,organization_id,activity_type_id,title,description,starts_at,timezone,city,location_text,conditions,join_mode)
VALUES ($1,$2,$3,$4,(SELECT id FROM activity_types WHERE name=$5),$6,$7,$8,$9,$10,'secret location','secret conditions','OPEN')`, id, ownerID, personal, org, activity, title, "Описание "+title, starts, zone, city)
	return id
}
func ids(list []any) []string {
	result := make([]string, 0, len(list))
	for _, item := range list {
		result = append(result, item.(map[string]any)["id"].(string))
	}
	return result
}
func wantIDs(t *testing.T, list []any, want ...string) {
	t.Helper()
	got := ids(list)
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("IDs %v, want %v", got, want)
	}
}
func TestCatalogVisibilityAndActivityTypes(t *testing.T) {
	f := newFixture(t, false)
	for _, path := range []string{"/events", "/activity-types"} {
		r := f.call("GET", path, nil, "")
		list, next := items(t, r)
		if len(list) != 0 || next != nil {
			t.Fatal("empty catalog")
		}
	}
	f.seed(t)
	r := f.call("GET", "/activity-types", nil, "invalid-cookie")
	validResponse(t, r, "ActivityTypes")
	list, _ := items(t, r)
	if len(list) != 4 {
		t.Fatalf("approved types: %s", r.Body.String())
	}
	var names []string
	for _, entry := range list {
		names = append(names, entry.(map[string]any)["name"].(string))
	}
	if strings.Join(names, ",") != "Бег,Зарядка,Футбол,Шахматы" {
		t.Fatal(names)
	}
	r = f.call("GET", "/events?limit=100", nil, "invalid-cookie")
	validResponse(t, r, "EventPage")
	list, next := items(t, r)
	if len(list) != 15 || next != nil {
		t.Fatalf("published count %d", len(list))
	}
	for _, entry := range list {
		e := entry.(map[string]any)
		if e["publicationStatus"] != "PUBLISHED" || e["description"] != nil || e["activityTypeReview"] != nil {
			t.Fatal("summary leaked private fields")
		}
		if e["title"] == "Зарядка у фонтана" && !e["organizer"].(map[string]any)["account"].(map[string]any)["isBlocked"].(bool) {
			t.Fatal("blocked author lost")
		}
	}
	for _, name := range []string{"Петанк", "Дворовые эстафеты"} {
		activity := scalar[string](t, f, `SELECT id::text FROM activity_types WHERE name=$1`, name)
		byQuery, _ := items(t, f.call("GET", "/events?q="+url.QueryEscape(name), nil, ""))
		byID, _ := items(t, f.call("GET", "/events?activityTypeId="+activity, nil, ""))
		if len(byQuery) == 0 || len(byID) != len(byQuery) {
			t.Fatalf("non-approved type missing: %s", name)
		}
	}
	code(t, f.call("GET", "/events?activityTypeId="+uuid.NewString(), nil, ""), 200, "")
}
func TestCatalogFiltersBeforePagination(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	// The first row is deliberately outside the sought substring and mode filters.
	f.add(t, "aaa early", "2020-01-01T00:00:00Z", "UTC", "Тестовый город", "Бег", "anna", "")
	id := f.add(t, "Точный\u00a0  поиск %_ ' ", "2026-11-07T18:00:00Z", "Asia/Krasnoyarsk", " Тестовый\tгород ", "Бег", "anna", "")
	for _, q := range []url.Values{
		{"q": {"  ТОЧНЫЙ\tПОИСК "}}, {"q": {"%_"}}, {"q": {"'"}}, {"q": {"описание точный поиск"}},
		{"q": {"точный"}, "joinMode": {"OPEN"}, "city": {" ТЕСТОВЫЙ\u2003ГОРОД "}, "limit": {"1"}},
		{"organizerAccountId": {strings.ToUpper(f.account(t, "anna"))}, "q": {"точный"}},
	} {
		list, next := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
		wantIDs(t, list, id)
		if next != nil {
			t.Fatal("exact full last page must not have cursor")
		}
	}
	for _, q := range []url.Values{
		{"q": {"%not-a-wildcard%"}}, {"q": {"_not-a-wildcard_"}}, {"q": {"' OR 1=1 --"}},
		{"q": {"точный"}, "joinMode": {"APPROVAL"}}, {"q": {"точный"}, "city": {"Тестовый"}},
		{"q": {"точный"}, "from": {"2026-11-07T18:00:00.000000001Z"}}, {"q": {"точный"}, "to": {"2026-11-07T18:00:00Z"}},
	} {
		list, next := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
		if len(list) != 0 || next != nil {
			t.Fatalf("filter ignored: %v", q)
		}
	}
	list, next := items(t, f.call("GET", "/events?"+url.Values{"q": {"точный"}, "to": {"2026-11-07T18:00:00.000000001Z"}}.Encode(), nil, ""))
	wantIDs(t, list, id)
	if next != nil {
		t.Fatal("sub-microsecond upper bound")
	}
	for _, path := range []string{"/events?q=++&city=++"} {
		list, _ := items(t, f.call("GET", path, nil, ""))
		if len(list) != 17 {
			t.Fatal("blank q/city must equal absent")
		}
	}
	org := scalar[string](t, f, `SELECT id::text FROM organizations WHERE name='Клуб «Шаг рядом»'`)
	list, _ = items(t, f.call("GET", "/events?organizationId="+org, nil, ""))
	if len(list) == 0 {
		t.Fatal("organization filter empty")
	}
	for _, entry := range list {
		if entry.(map[string]any)["organizer"].(map[string]any)["type"] != "ORGANIZATION" {
			t.Fatal("wrong organizer")
		}
	}
	for _, path := range []string{"/events?organizationId=" + org + "&organizerAccountId=" + f.account(t, "anna"), "/events?from=2026-11-08T00:00:00Z&to=2026-11-07T00:00:00Z", "/events?dateFrom=2026-02-29", "/events?dateTo=2026-11-31", "/events?dateFrom=", "/events?dateFrom=2026-11-07&dateTo=2026-11-07", "/events?joinMode=", "/events?organizationId=", "/events?limit=0", "/events?q=x&q=y", "/events?unknown=1"} {
		code(t, f.call("GET", path, nil, ""), 400, "INVALID_REQUEST")
	}
}
func TestLocalDateZonesAndAbsoluteBounds(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	city := "Дата каждой встречи"
	previous := f.add(t, "previous UTC", "2026-11-06T18:00:00Z", "Asia/Krasnoyarsk", city, "Бег", "anna", "")
	kras := f.add(t, "Krasnoyarsk midnight", "2026-11-07T17:00:00Z", "Asia/Krasnoyarsk", city, "Бег", "anna", "")
	moscow := f.add(t, "Moscow same instant", "2026-11-07T17:00:00Z", "Europe/Moscow", city, "Бег", "anna", "")
	next := f.add(t, "Moscow midnight", "2026-11-07T21:00:00Z", "Europe/Moscow", city, "Бег", "anna", "")
	dst := f.add(t, "DST", "2026-10-25T01:30:00Z", "Europe/Berlin", city, "Бег", "anna", "")
	for _, tc := range []struct {
		q    url.Values
		want []string
	}{
		{url.Values{"dateFrom": {"2026-11-07"}, "dateTo": {"2026-11-08"}}, []string{previous, moscow}},
		{url.Values{"dateFrom": {"2026-11-08"}, "dateTo": {"2026-11-09"}}, []string{kras, next}},
		{url.Values{"dateFrom": {"2026-11-07"}, "dateTo": {"2026-11-08"}, "from": {"2026-11-07T00:00:00Z"}}, []string{moscow}},
		{url.Values{"dateFrom": {"2026-11-07"}, "dateTo": {"2026-11-08"}, "to": {"2026-11-07T17:00:00Z"}}, []string{previous}},
		{url.Values{"dateFrom": {"2026-10-25"}, "dateTo": {"2026-10-26"}}, []string{dst}},
	} {
		tc.q.Set("city", city)
		tc.q.Set("limit", "100")
		list, _ := items(t, f.call("GET", "/events?"+tc.q.Encode(), nil, ""))
		wantIDs(t, list, tc.want...)
	}
	// SQL session timezone cannot reinterpret a calendar boundary or startsAt output.
	execute(t, f, "SET TIME ZONE 'Pacific/Honolulu'")
	q := url.Values{"city": {city}, "dateFrom": {"2026-11-07"}, "dateTo": {"2026-11-08"}, "limit": {"1"}}
	first, nextCursor := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
	wantIDs(t, first, previous)
	if nextCursor == nil {
		t.Fatal("filters must run before limit")
	}
	q.Set("cursor", *nextCursor)
	last, after := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
	wantIDs(t, last, moscow)
	if after != nil {
		t.Fatal("unexpected next page")
	}
}
func TestCursorsScopeOrderingAndConcurrentChanges(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	anna := f.login(t, "anna")
	alex := f.login(t, "alex")
	q := url.Values{"city": {"Красноярск"}, "limit": {"1"}}
	var seen []string
	for page := 0; page < 30; page++ {
		list, next := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
		seen = append(seen, ids(list)...)
		if next == nil {
			break
		}
		q.Set("cursor", *next)
		q.Set("limit", "3")
	}
	if len(seen) != 15 {
		t.Fatalf("pagination rows %d", len(seen))
	}
	if len(mapUnique(seen)) != 15 {
		t.Fatal("duplicate row on tied startsAt")
	}
	list, cur := items(t, f.call("GET", "/events?city="+url.QueryEscape("Красноярск")+"&limit=1", nil, ""))
	if cur == nil {
		t.Fatal("need cursor")
	}
	_ = list
	for _, path := range []string{"/events?cursor=bad", "/events?cursor=" + url.QueryEscape(*cur+"x"), "/events?city=Москва&cursor=" + url.QueryEscape(*cur), "/me/events?cursor=" + url.QueryEscape(*cur)} {
		code(t, f.call("GET", path, nil, anna), 400, "INVALID_CURSOR")
	}
	code(t, f.call("GET", "/events?city="+url.QueryEscape("  КРАСНОЯРСК ")+"&limit=2&cursor="+url.QueryEscape(*cur), nil, ""), 200, "")
	_, ownCur := items(t, f.call("GET", "/me/events?limit=1", nil, anna))
	if ownCur == nil {
		t.Fatal("need private cursor")
	}
	code(t, f.call("GET", "/me/events?cursor="+url.QueryEscape(*ownCur), nil, alex), 400, "INVALID_CURSOR")
	org := scalar[string](t, f, `SELECT id::text FROM organizations WHERE name='Клуб «Шаг рядом»'`)
	code(t, f.call("GET", "/me/events?organizationId="+org+"&cursor="+url.QueryEscape(*ownCur), nil, anna), 400, "INVALID_CURSOR")
	city := "Cursor changes"
	var expected []string
	for i := 0; i < 4; i++ {
		expected = append(expected, f.add(t, fmt.Sprintf("cursor %d", i), "2026-11-07T18:00:00Z", "UTC", city, "Бег", "anna", ""))
	}
	sort.Strings(expected)
	q = url.Values{"city": {city}, "limit": {"1"}}
	first, cur := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
	wantIDs(t, first, expected[0])
	execute(t, f, "DELETE FROM events WHERE id=$1", expected[0])
	f.add(t, "new before cursor", "2026-11-07T17:00:00Z", "UTC", city, "Бег", "anna", "")
	q.Set("cursor", *cur)
	q.Set("limit", "100")
	remaining, next := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
	wantIDs(t, remaining, expected[1:]...)
	if next != nil {
		t.Fatal("tail cursor")
	}
}
func mapUnique(values []string) map[string]bool {
	m := map[string]bool{}
	for _, v := range values {
		m[v] = true
	}
	return m
}

func TestPublishedDetailsCapabilitiesAndPrivateReview(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	anna := f.login(t, "anna")
	alex := f.login(t, "alex")
	admin := f.login(t, "marina")
	outsider := f.login(t, "dasha")
	event := f.event(t, "Ближайший подтверждённый план")
	for _, tc := range []struct {
		token, reason        string
		owner, authenticated bool
	}{
		{"", "AUTH_REQUIRED", false, false}, {anna, "ALREADY_ORGANIZER", true, true}, {alex, "ALREADY_PARTICIPATING", false, true}, {admin, "", false, true},
	} {
		r := f.call("GET", "/events/"+event, nil, tc.token)
		validResponse(t, r, "EventDetail")
		body := object(t, r)
		caps := body["capabilities"].(map[string]any)
		if caps["canJoin"] != (tc.reason == "") || caps["canManageParticipants"] != tc.owner || caps["canDecideParticipations"] != tc.owner || caps["canPostMessage"] != tc.authenticated || caps["canSetCover"] != tc.owner {
			t.Fatal(caps)
		}
		if tc.reason != "" && caps["joinBlockedReason"] != tc.reason {
			t.Fatal(caps)
		}
		if (body["activityTypeReview"] != nil) != tc.owner {
			t.Fatal("review visibility")
		}
		if body["confirmedCount"] != float64(scalar[int](t, f, "SELECT count(*) FROM participations WHERE event_id=$1 AND status='CONFIRMED'", event)) {
			t.Fatal("wrong count")
		}
		if tc.token == alex && body["myParticipation"] == nil {
			t.Fatal("own participation missing")
		}
	}
	for _, status := range []string{"PENDING", "CONFIRMED", "REJECTED"} {
		execute(t, f, `UPDATE participations SET status=$2,decided_at=CASE WHEN $2='REJECTED' THEN now() END,decided_by=CASE WHEN $2='REJECTED' THEN $3::uuid END WHERE event_id=$1 AND account_id=$4`, event, status, f.account(t, "anna"), f.account(t, "alex"))
		body := object(t, f.call("GET", "/events/"+event, nil, alex))
		if body["myParticipation"].(map[string]any)["status"] != status || body["capabilities"].(map[string]any)["joinBlockedReason"] != "ALREADY_PARTICIPATING" {
			t.Fatal(body)
		}
	}
	// Exactly equal server time outranks guest/owner/participation reasons.
	execute(t, f, "UPDATE events SET starts_at=$2 WHERE id=$1", event, time.Unix(f.now.Load(), 0))
	for _, session := range []string{"", anna, alex, outsider} {
		body := object(t, f.call("GET", "/events/"+event, nil, session))
		caps := body["capabilities"].(map[string]any)
		if caps["canJoin"] != false || caps["canDecideParticipations"] != false || caps["joinBlockedReason"] != "EVENT_STARTED" || caps["canManageParticipants"] != (session == anna) || caps["canSetCover"] != (session == anna) {
			t.Fatal(caps)
		}
	}
	for _, name := range []string{"Петанк", "Дворовые эстафеты"} {
		id := f.add(t, "review "+name, "2026-11-07T18:00:00Z", "UTC", "Reviews", name, "anna", "")
		for _, session := range []string{"", anna, alex, admin} {
			body := object(t, f.call("GET", "/events/"+id, nil, session))
			if (body["activityTypeReview"] != nil) != (session == anna) {
				t.Fatal("private review leaked")
			}
			if session == anna {
				review := body["activityTypeReview"].(map[string]any)
				if (review["rejectionReason"] != nil) != (name == "Дворовые эстафеты") {
					t.Fatal(review)
				}
			}
		}
	}
	code(t, f.call("GET", "/events/"+event, nil, "invalid-cookie"), 401, "SESSION_EXPIRED")
	code(t, f.call("GET", "/events/"+uuid.NewString(), nil, ""), 404, "NOT_FOUND")
}
func TestUnpublishedPrivacyAndOwnedLists(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	anna := f.login(t, "anna")
	alex := f.login(t, "alex")
	admin := f.login(t, "marina")
	outsider := f.login(t, "dasha")
	id := scalar[string](t, f, "SELECT id::text FROM events WHERE publication_status='UNPUBLISHED'")
	for _, session := range []string{"", outsider} {
		code(t, f.call("GET", "/events/"+id, nil, session), 404, "NOT_FOUND")
	}
	for _, status := range []string{"PENDING", "CONFIRMED", "REJECTED"} {
		execute(t, f, `UPDATE participations SET status=$2,decided_at=CASE WHEN $2='REJECTED' THEN now() END,decided_by=CASE WHEN $2='REJECTED' THEN $3::uuid END WHERE event_id=$1 AND account_id=$4`, id, status, f.account(t, "anna"), f.account(t, "alex"))
		for _, session := range []string{anna, alex, admin} {
			r := f.call("GET", "/events/"+id, nil, session)
			validResponse(t, r, "EventDetail")
			body := object(t, r)
			if len(body) != 6 || body["canJoin"] != false || body["publicationStatus"] != "UNPUBLISHED" || (body["unpublishReason"] != nil) != (session != alex) {
				t.Fatalf("limited detail: %s", r.Body.String())
			}
			if session == alex && body["myParticipation"].(map[string]any)["status"] != status {
				t.Fatal("participation lost")
			}
		}
	}
	var ownIDs []string
	q := url.Values{"limit": {"2"}}
	for i := 0; i < 30; i++ {
		r := f.call("GET", "/me/events?"+q.Encode(), nil, anna)
		validResponse(t, r, "OwnedEventPage")
		list, next := items(t, r)
		for _, v := range list {
			entry := v.(map[string]any)
			e := entry["event"].(map[string]any)
			if entry["canManageParticipants"] != true {
				t.Fatal("owner cannot read roster")
			}
			ownIDs = append(ownIDs, e["id"].(string))
			if e["publicationStatus"] == "UNPUBLISHED" {
				if len(e) != 3 {
					t.Fatal("limited summary leaked")
				}
			} else if e["organizer"].(map[string]any)["type"] != "PERSONAL" {
				t.Fatal("organization in personal list")
			}
		}
		if next == nil {
			break
		}
		q.Set("cursor", *next)
	}
	wantCount := scalar[int](t, f, "SELECT count(*) FROM events WHERE organizer_account_id=$1", f.account(t, "anna"))
	if len(ownIDs) != wantCount || len(mapUnique(ownIDs)) != wantCount {
		t.Fatal("own list pages")
	}
	rows, err := f.pool.Query(context.Background(), "SELECT id::text FROM events WHERE organizer_account_id=$1 ORDER BY created_at DESC,id DESC", f.account(t, "anna"))
	if err != nil {
		t.Fatal(err)
	}
	var expected []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		expected = append(expected, s)
	}
	rows.Close()
	if strings.Join(ownIDs, ",") != strings.Join(expected, ",") {
		t.Fatal("owned keyset order")
	}
	org := scalar[string](t, f, `SELECT id::text FROM organizations WHERE name='Клуб «Шаг рядом»'`)
	for _, session := range []string{alex, admin} {
		code(t, f.call("GET", "/me/events?organizationId="+org, nil, session), 404, "NOT_FOUND")
	}
	code(t, f.call("GET", "/me/events?organizationId="+uuid.NewString(), nil, anna), 404, "NOT_FOUND")
	code(t, f.call("GET", "/me/events", nil, ""), 401, "AUTH_REQUIRED")
	list, _ := items(t, f.call("GET", "/me/events?organizationId="+org, nil, anna))
	if len(list) == 0 {
		t.Fatal("missing org events")
	}
	draft := scalar[string](t, f, `SELECT o.id::text FROM organizations o LEFT JOIN organization_applications a ON a.organization_id=o.id WHERE a.id IS NULL`)
	list, _ = items(t, f.call("GET", "/me/events?organizationId="+draft, nil, anna))
	if len(list) != 0 {
		t.Fatal("draft empty list")
	}
	// Current responsible person is authoritative; blocking never unpublishes content.
	execute(t, f, `UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=$2 WHERE id=$1`, f.account(t, "anna"), f.account(t, "marina"))
	body := object(t, f.call("GET", "/events/"+listOrgEvent(t, f, org), nil, ""))
	if body["organizer"].(map[string]any)["ownerIsBlocked"] != true {
		t.Fatal("blocked org owner not current")
	}
	code(t, f.call("GET", "/me/events", nil, anna), 403, "ACCOUNT_BLOCKED")
	code(t, f.call("GET", "/events/"+id, nil, anna), 403, "ACCOUNT_BLOCKED")
}
func listOrgEvent(t *testing.T, f *fixture, org string) string {
	return scalar[string](t, f, "SELECT id::text FROM events WHERE organization_id=$1 LIMIT 1", org)
}

func TestReadBarrierAndFreshCapabilitiesAfterWaiting(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	session := f.login(t, "anna")
	id := f.event(t, "Пробежка для знакомства")
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- f.call("GET", "/events/"+id, nil, session) }()
	waitLock(t, f, "SELECT id FROM demo_state%")
	if _, err = tx.Exec(context.Background(), "UPDATE events SET starts_at=$2 WHERE id=$1", id, time.Unix(f.now.Load(), 0)); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-done:
		caps := object(t, response)["capabilities"].(map[string]any)
		if caps["joinBlockedReason"] != "EVENT_STARTED" || caps["canManageParticipants"] != true || caps["canDecideParticipations"] != false {
			t.Fatal("stale data after barrier")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("read did not finish")
	}
	// Reset-like session removal in this isolated schema cannot leave a stale actor.
	tx, err = f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	go func() { done <- f.call("GET", "/me/events", nil, session) }()
	waitLock(t, f, "SELECT id FROM demo_state%")
	if _, err = tx.Exec(context.Background(), "DELETE FROM sessions"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-done:
		code(t, response, 401, "SESSION_EXPIRED")
	case <-time.After(5 * time.Second):
		t.Fatal("guard did not resume")
	}
}

func TestEveryCatalogFilterBindsCursor(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	for i := 0; i < 2; i++ {
		f.add(t, fmt.Sprintf("Scope match %d", i), "2026-11-07T18:00:00Z", "UTC", "Scope city", "Бег", "anna", "")
	}
	activity := scalar[string](t, f, "SELECT id::text FROM activity_types WHERE name='Бег'")
	q := url.Values{"q": {"scope match"}, "city": {"scope city"}, "activityTypeId": {activity}, "joinMode": {"OPEN"}, "organizerAccountId": {f.account(t, "anna")}, "from": {"2026-11-07T00:00:00Z"}, "to": {"2026-11-10T00:00:00Z"}, "dateFrom": {"2026-11-07"}, "dateTo": {"2026-11-09"}, "limit": {"1"}}
	_, cursor := items(t, f.call("GET", "/events?"+q.Encode(), nil, ""))
	if cursor == nil {
		t.Fatal("scope fixture")
	}
	for field, value := range map[string]string{"q": "changed", "city": "changed", "activityTypeId": uuid.NewString(), "joinMode": "APPROVAL", "organizerAccountId": uuid.NewString(), "from": "2026-11-07T00:00:01Z", "to": "2026-11-11T00:00:00Z", "dateFrom": "2026-11-08", "dateTo": "2026-11-10"} {
		changed, _ := url.ParseQuery(q.Encode())
		changed.Set(field, value)
		changed.Set("cursor", *cursor)
		code(t, f.call("GET", "/events?"+changed.Encode(), nil, ""), 400, "INVALID_CURSOR")
	}
	q.Set("cursor", *cursor)
	q.Set("q", "  SCOPE\tMATCH ")
	q.Set("city", " SCOPE\u00a0CITY ")
	q.Set("from", "2026-11-07T03:00:00+03:00")
	q.Set("organizerAccountId", strings.ToUpper(f.account(t, "anna")))
	code(t, f.call("GET", "/events?"+q.Encode(), nil, ""), 200, "")
}
