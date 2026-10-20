package participation_test

import (
	"context"
	"encoding/json"
	"fmt"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
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

func idFor(t *testing.T, f *fixture, title string) string {
	return scalar[string](t, f, "SELECT id::text FROM events WHERE title=$1", title)
}
func responseObject(t *testing.T, r *httptest.ResponseRecorder, status int, schema string) map[string]any {
	t.Helper()
	code(t, r, status, "")
	r.Code = 200
	validResponse(t, r, schema)
	return object(t, r)
}
func join(t *testing.T, f *fixture, event, session string, status int) map[string]any {
	t.Helper()
	return responseObject(t, f.call("POST", "/events/"+event+"/participations", nil, session), status, "Participation")
}
func decision(f *fixture, id, kind, session string) *httptest.ResponseRecorder {
	return f.call("POST", "/participations/"+id+"/decision", map[string]any{"decision": kind}, session)
}
func TestOpenApprovalAuthorAndPrivacyS3S4(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	alex := f.login(t, "alex")
	ivan := f.login(t, "ivan")
	dasha := f.login(t, "dasha")
	admin := f.login(t, "marina")
	open := idFor(t, f, "Пробежка для знакомства")
	approval := idFor(t, f, "Футбол во дворе")
	confirmed := join(t, f, open, alex, 201)
	if confirmed["status"] != "CONFIRMED" || confirmed["decidedAt"] != nil {
		t.Fatal(confirmed)
	}
	again := join(t, f, open, alex, 200)
	if again["id"] != confirmed["id"] || again["createdAt"] != confirmed["createdAt"] {
		t.Fatal("duplicate repeat")
	}
	code(t, decision(f, confirmed["id"].(string), "ACCEPT", owner), 409, "DECISION_CONFLICT")
	code(t, f.call("POST", "/events/"+open+"/participations", nil, owner), 409, "ALREADY_ORGANIZER")
	code(t, f.call("POST", "/events/"+approval+"/participations", nil, owner), 409, "ALREADY_ORGANIZER")
	pending := join(t, f, approval, alex, 201)
	if pending["status"] != "PENDING" {
		t.Fatal(pending)
	}
	for _, session := range []string{alex, admin} {
		code(t, decision(f, pending["id"].(string), "ACCEPT", session), 404, "NOT_FOUND")
		code(t, f.call("GET", "/events/"+approval+"/participations", nil, session), 404, "NOT_FOUND")
	}
	accept := responseObject(t, decision(f, pending["id"].(string), "ACCEPT", owner), 200, "Participation")
	if accept["status"] != "CONFIRMED" || accept["decidedAt"] == nil {
		t.Fatal(accept)
	}
	before := scalar[string](t, f, "SELECT row_to_json(p)::text FROM participations p WHERE id=$1", pending["id"])
	code(t, decision(f, pending["id"].(string), "ACCEPT", owner), 200, "")
	if scalar[string](t, f, "SELECT row_to_json(p)::text FROM participations p WHERE id=$1", pending["id"]) != before {
		t.Fatal("repeat rewrote decision")
	}
	code(t, decision(f, pending["id"].(string), "REJECT", owner), 409, "DECISION_CONFLICT")
	rejected := join(t, f, approval, dasha, 200)
	responseObject(t, decision(f, rejected["id"].(string), "REJECT", owner), 200, "Participation")
	repeat := join(t, f, approval, dasha, 200)
	if repeat["status"] != "REJECTED" || repeat["id"] != rejected["id"] {
		t.Fatal("rejected application reset")
	}
	code(t, decision(f, rejected["id"].(string), "REJECT", owner), 200, "")
	code(t, decision(f, rejected["id"].(string), "ACCEPT", owner), 409, "DECISION_CONFLICT")
	r := f.call("GET", "/events/"+approval+"/participations?status=CONFIRMED&limit=1", nil, owner)
	validResponse(t, r, "ParticipantPage")
	list, _ := items(t, r)
	if len(list) != 1 || list[0].(map[string]any)["account"].(map[string]any)["id"] != f.account(t, "alex") {
		t.Fatal("roster not updated")
	}
	account := list[0].(map[string]any)["account"].(map[string]any)
	if len(account) != 4 {
		t.Fatal("private account leaked")
	}
	code(t, decision(f, uuid.NewString(), "ACCEPT", owner), 404, "NOT_FOUND")
	for _, input := range []map[string]any{{"decision": "APPROVE"}, {"decision": "ACCEPT", "reason": "extra"}, {"decision": "REJECT", "decidedBy": f.account(t, "alex")}} {
		code(t, f.call("POST", "/participations/"+pending["id"].(string)+"/decision", input, owner), 422, "VALIDATION_ERROR")
	}
	code(t, f.call("POST", "/events/"+open+"/participations", nil, ""), 401, "AUTH_REQUIRED")
	code(t, f.call("POST", "/events/"+open+"/participations", map[string]any{}, ivan), 400, "INVALID_REQUEST")
}
func TestBoundariesBothModesAndUnpublishedPriority(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	alex := f.login(t, "alex")
	ivan := f.login(t, "ivan")
	dasha := f.login(t, "dasha")
	admin := f.login(t, "marina")
	base := time.Unix(0, f.now.Load()).UTC()
	for _, title := range []string{"Пробежка для знакомства", "Футбол во дворе"} {
		event := idFor(t, f, title)
		execute(t, f, "UPDATE events SET starts_at=$2 WHERE id=$1", event, base.Add(time.Millisecond))
		p := join(t, f, event, ivan, 200)
		for _, offset := range []time.Duration{time.Millisecond, 2 * time.Millisecond} {
			f.now.Store(base.Add(offset).UnixNano())
			before := scalar[string](t, f, "SELECT row_to_json(p)::text FROM participations p WHERE id=$1", p["id"])
			for _, session := range []string{ivan, alex, owner, admin} {
				code(t, f.call("POST", "/events/"+event+"/participations", nil, session), 409, "EVENT_STARTED")
			}
			for _, kind := range []string{"ACCEPT", "REJECT"} {
				code(t, decision(f, p["id"].(string), kind, owner), 409, "EVENT_STARTED")
			}
			if scalar[string](t, f, "SELECT row_to_json(p)::text FROM participations p WHERE id=$1", p["id"]) != before {
				t.Fatal("boundary mutation")
			}
			code(t, f.call("GET", "/events/"+event+"/participations", nil, owner), 200, "")
		}
		f.now.Store(base.UnixNano())
		execute(t, f, "UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=$2,unpublish_reason='Fixture unpublication' WHERE id=$1", event, f.account(t, "marina"))
		f.now.Store(base.Add(2 * time.Millisecond).UnixNano())
		for _, session := range []string{ivan, owner, admin} {
			code(t, f.call("POST", "/events/"+event+"/participations", nil, session), 409, "EVENT_UNAVAILABLE")
		}
		code(t, decision(f, p["id"].(string), "ACCEPT", owner), 409, "EVENT_UNAVAILABLE")
		if scalar[int](t, f, "SELECT count(*) FROM participations WHERE event_id=$1 AND account_id=$2", event, f.account(t, "dasha")) == 0 {
			code(t, f.call("POST", "/events/"+event+"/participations", nil, dasha), 404, "NOT_FOUND")
		}
		code(t, f.call("GET", "/events/"+event+"/participations", nil, owner), 200, "")
		f.now.Store(base.UnixNano())
	}
}
func TestConcurrentJoinsDecisionsWaitAndCommit(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	ivan := f.login(t, "ivan")
	dasha := f.login(t, "dasha")
	event := idFor(t, f, "Шахматы в парке")
	done := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() { done <- f.call("POST", "/events/"+event+"/participations", nil, ivan) }()
	}
	a, b := <-done, <-done
	if a.Code+b.Code != 401 {
		t.Fatalf("parallel joins %d/%d", a.Code, b.Code)
	}
	if a.Code == 201 {
		a.Code = 200
	}
	if b.Code == 201 {
		b.Code = 200
	}
	if object(t, a)["id"] != object(t, b)["id"] {
		t.Fatal("parallel duplicate")
	}
	approval := idFor(t, f, "Футбол во дворе")
	p := join(t, f, approval, dasha, 200)
	id := p["id"].(string)
	go func() { done <- decision(f, id, "ACCEPT", owner) }()
	go func() { done <- decision(f, id, "REJECT", owner) }()
	a, b = <-done, <-done
	if !((a.Code == 200 && b.Code == 409) || (a.Code == 409 && b.Code == 200)) {
		t.Fatalf("parallel decisions %d/%d", a.Code, b.Code)
	}
	// A wait on a participation lock must recheck time too, not only the event lock.
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM participations WHERE id=$1 FOR UPDATE", id); err != nil {
		t.Fatal(err)
	}
	start := time.Unix(0, f.now.Load()).Add(time.Millisecond)
	execute(t, f, "UPDATE events SET starts_at=$2 WHERE id=$1", approval, start)
	go func() { done <- decision(f, id, "ACCEPT", owner) }()
	waitLock(t, f, "%FROM participations WHERE id=%")
	f.now.Store(start.UnixNano())
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-done, 409, "EVENT_STARTED")
	// Failed COMMIT publishes neither success nor a partial participation.
	execute(t, f, `CREATE FUNCTION fail_participation_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_join AFTER INSERT ON participations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_participation_commit()`)
	code(t, f.call("POST", "/events/"+event+"/participations", nil, dasha), 500, "INTERNAL_ERROR")
	if scalar[int](t, f, "SELECT count(*) FROM participations WHERE event_id=$1 AND account_id=$2", event, f.account(t, "dasha")) != 0 {
		t.Fatal("partial failed join")
	}
}
func addWindow(t *testing.T, f *fixture, account, title, starts, zone, created, state, publication string) string {
	t.Helper()
	id := uuid.NewString()
	owner := f.account(t, "anna")
	execute(t, f, `INSERT INTO events(id,created_by_account_id,organizer_account_id,activity_type_id,title,description,starts_at,timezone,city,location_text,join_mode) VALUES ($1,$2,$2,(SELECT id FROM activity_types WHERE name='Бег'),$3,'Window fixture',$4,$5,'Красноярск','Парк','APPROVAL')`, id, owner, title, starts, zone)
	if publication == "UNPUBLISHED" {
		execute(t, f, "UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=$2,unpublish_reason='Window reason' WHERE id=$1", id, f.account(t, "marina"))
	}
	var decider any
	var decided any
	if state == "REJECTED" {
		decider = owner
		decided = time.Now()
	}
	execute(t, f, `INSERT INTO participations(event_id,account_id,status,created_at,decided_by,decided_at) VALUES ($1,$2,$3,$4,$5,$6)`, id, account, state, created, decider, decided)
	return id
}
func eventIDs(list []any) []string {
	ids := []string{}
	for _, v := range list {
		ids = append(ids, v.(map[string]any)["event"].(map[string]any)["id"].(string))
	}
	return ids
}
func checkIDs(t *testing.T, got, want []string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("IDs %v; want %v", got, want)
	}
}
func TestWindowsSortingBeforeLimitAndReferenceCursor(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	token, me := f.register(t, "window-person@example.test")
	account := me.Account.Id.String()
	reference := "2026-11-07T18:00:00.000000001Z"
	// Closest plan has the oldest participation, behind a full unwindowed first page.
	nearest := addWindow(t, f, account, "nearest", "2026-11-07T18:00:00.000001Z", "UTC", "2026-01-01T00:00:00Z", "CONFIRMED", "PUBLISHED")
	for i := 0; i < 23; i++ {
		addWindow(t, f, account, fmt.Sprintf("far %02d", i), fmt.Sprintf("2026-12-%02dT18:00:00Z", i+1), "UTC", "2026-10-01T00:00:00Z", "CONFIRMED", "PUBLISHED")
	}
	pair := []string{addWindow(t, f, account, "tie a", "2026-11-08T18:00:00Z", "UTC", "2026-10-01T00:00:00Z", "CONFIRMED", "PUBLISHED"), addWindow(t, f, account, "tie b", "2026-11-08T18:00:00Z", "UTC", "2026-10-01T00:00:00Z", "CONFIRMED", "PUBLISHED")}
	sort.Strings(pair)
	moscow := addWindow(t, f, account, "Moscow today", "2026-11-07T12:00:00Z", "Europe/Moscow", "2026-10-01T00:00:00Z", "CONFIRMED", "PUBLISHED")
	kras := addWindow(t, f, account, "Kras previous day", "2026-11-07T12:00:00Z", "Asia/Krasnoyarsk", "2026-10-01T00:00:00Z", "CONFIRMED", "PUBLISHED")
	equal := addWindow(t, f, account, "equal boundary", "2026-11-07T18:00:00Z", "UTC", "2026-10-01T00:00:00Z", "CONFIRMED", "PUBLISHED")
	unavailable := addWindow(t, f, account, "unavailable", "2026-11-10T18:00:00Z", "UTC", "2026-10-02T00:00:00Z", "CONFIRMED", "UNPUBLISHED")
	addWindow(t, f, account, "pending future", "2026-11-07T18:00:00.000001Z", "UTC", "2026-10-02T00:00:00Z", "PENDING", "PUBLISHED")
	q := url.Values{"eventWindow": {"UPCOMING"}, "referenceTime": {reference}, "status": {"CONFIRMED"}, "limit": {"1"}}
	first := f.call("GET", "/me/participations?"+q.Encode(), nil, token)
	validResponse(t, first, "MyParticipationPage")
	list, cursor := items(t, first)
	checkIDs(t, eventIDs(list), []string{nearest})
	if cursor == nil {
		t.Fatal("cursor missing")
	}
	if object(t, first)["referenceTime"] != reference {
		t.Fatal("reference precision lost")
	}
	q.Set("cursor", *cursor)
	q.Del("referenceTime")
	q.Set("limit", "2")
	second := f.call("GET", "/me/participations?"+q.Encode(), nil, token)
	list, next := items(t, second)
	checkIDs(t, eventIDs(list), pair)
	if next == nil || object(t, second)["referenceTime"] != reference {
		t.Fatal("reference cursor lost")
	}
	for key, value := range map[string]string{"status": "PENDING", "eventWindow": "STARTED", "referenceTime": "2026-11-07T18:00:01Z"} {
		changed, _ := url.ParseQuery(q.Encode())
		changed.Set(key, value)
		code(t, f.call("GET", "/me/participations?"+changed.Encode(), nil, token), 400, "INVALID_CURSOR")
	}
	todayQ := url.Values{"eventWindow": {"STARTED_TODAY"}, "referenceTime": {reference}, "status": {"CONFIRMED"}, "limit": {"100"}}
	today := f.call("GET", "/me/participations?"+todayQ.Encode(), nil, token)
	validResponse(t, today, "MyParticipationPage")
	list, next = items(t, today)
	checkIDs(t, eventIDs(list), []string{moscow, equal})
	if next != nil {
		t.Fatal("tail cursor")
	}
	startedQ := url.Values{"eventWindow": {"STARTED"}, "referenceTime": {reference}, "status": {"CONFIRMED"}, "limit": {"1"}}
	var started []string
	for i := 0; i < 10; i++ {
		r := f.call("GET", "/me/participations?"+startedQ.Encode(), nil, token)
		list, c := items(t, r)
		started = append(started, eventIDs(list)...)
		if c == nil {
			break
		}
		startedQ.Set("cursor", *c)
		startedQ.Del("referenceTime")
	}
	older := []string{moscow, kras}
	sort.Sort(sort.Reverse(sort.StringSlice(older)))
	checkIDs(t, started, append([]string{equal}, older...))
	all := f.call("GET", "/me/participations?limit=100", nil, token)
	validResponse(t, all, "MyParticipationPage")
	if object(t, all)["referenceTime"] != nil {
		t.Fatal("full list reference")
	}
	list, _ = items(t, all)
	found := false
	for _, v := range list {
		e := v.(map[string]any)["event"].(map[string]any)
		if e["id"] == unavailable {
			found = true
			if len(e) != 3 {
				t.Fatal("unavailable leaked fields")
			}
		}
	}
	if !found {
		t.Fatal("unavailable record lost")
	}
	for _, path := range []string{"/me/participations?referenceTime=" + url.QueryEscape(reference), "/me/participations?eventWindow=", "/me/participations?eventWindow=NEXT", "/me/participations?eventWindow=UPCOMING&referenceTime=2026-11-07T18:00:00", "/me/participations?status=CONFIRMED,CONFIRMED"} {
		code(t, f.call("GET", path, nil, token), 400, "INVALID_REQUEST")
	}
}

func TestPaginationScopesAndCurrentOrganizationOwner(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	alex := f.login(t, "alex")
	admin := f.login(t, "marina")
	event := idFor(t, f, "Футбол во дворе")
	join(t, f, event, alex, 201)
	// Roster ordering is creation/id ASC, including ties and filter before LIMIT.
	execute(t, f, "UPDATE participations SET created_at='2026-10-19T10:00:00Z' WHERE event_id=$1", event)
	rows, err := f.pool.Query(context.Background(), "SELECT id::text FROM participations WHERE event_id=$1 ORDER BY created_at,id", event)
	if err != nil {
		t.Fatal(err)
	}
	var want []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		want = append(want, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	path := "/events/" + event + "/participations"
	first := f.call("GET", path+"?status=PENDING,CONFIRMED&limit=1", nil, owner)
	list, c := items(t, first)
	if len(list) != 1 || c == nil {
		t.Fatal("first roster page")
	}
	got := []string{list[0].(map[string]any)["id"].(string)}
	q := url.Values{"status": {"CONFIRMED,PENDING"}, "limit": {"100"}, "cursor": {*c}}
	list, next := items(t, f.call("GET", path+"?"+q.Encode(), nil, owner))
	for _, v := range list {
		got = append(got, v.(map[string]any)["id"].(string))
	}
	checkIDs(t, got, want)
	if next != nil {
		t.Fatal("extra final cursor")
	}
	q.Set("status", "REJECTED")
	code(t, f.call("GET", path+"?"+q.Encode(), nil, owner), 400, "INVALID_CURSOR")
	code(t, f.call("GET", "/events/"+idFor(t, f, "Пробежка для знакомства")+"/participations?cursor="+url.QueryEscape(*c), nil, owner), 400, "INVALID_CURSOR")
	code(t, f.call("GET", "/me/participations?cursor="+url.QueryEscape(*c), nil, owner), 400, "INVALID_CURSOR")
	code(t, f.call("GET", path+"?cursor=bad.signature", nil, owner), 400, "INVALID_CURSOR")
	// Current organization owner is responsible, rather than the historical creator.
	execute(t, f, "UPDATE organizations SET owner_account_id=$2 WHERE id=(SELECT organization_id FROM events WHERE id=$1)", event, f.account(t, "alex"))
	code(t, f.call("GET", path, nil, owner), 404, "NOT_FOUND")
	code(t, f.call("GET", path, nil, alex), 200, "")
	code(t, f.call("GET", path, nil, admin), 404, "NOT_FOUND")
	code(t, f.call("POST", "/events/"+event+"/participations", nil, alex), 409, "ALREADY_ORGANIZER")
	pending := scalar[string](t, f, "SELECT id::text FROM participations WHERE event_id=$1 AND account_id=$2", event, f.account(t, "ivan"))
	code(t, decision(f, pending, "ACCEPT", owner), 404, "NOT_FOUND")
	code(t, decision(f, pending, "ACCEPT", alex), 200, "")
	// Full own list remains participation.createdAt/id DESC and binds actor/status.
	first = f.call("GET", "/me/participations?limit=1", nil, alex)
	list, c = items(t, first)
	if c == nil {
		t.Fatal("own cursor missing")
	}
	code(t, f.call("GET", "/me/participations?cursor="+url.QueryEscape(*c), nil, owner), 400, "INVALID_CURSOR")
	code(t, f.call("GET", "/me/participations?status=CONFIRMED&cursor="+url.QueryEscape(*c), nil, alex), 400, "INVALID_CURSOR")
	// The key cannot be changed without invalidating its signature.
	parts := strings.Split(*c, ".")
	parts[0] = "A" + parts[0][1:]
	code(t, f.call("GET", "/me/participations?cursor="+url.QueryEscape(strings.Join(parts, ".")), nil, alex), 400, "INVALID_CURSOR")
	all, _ := items(t, f.call("GET", "/me/participations?limit=100", nil, alex))
	var allIDs []string
	for _, v := range all {
		allIDs = append(allIDs, v.(map[string]any)["participation"].(map[string]any)["id"].(string))
	}
	rows, err = f.pool.Query(context.Background(), "SELECT id::text FROM participations WHERE account_id=$1 ORDER BY created_at DESC,id DESC", f.account(t, "alex"))
	if err != nil {
		t.Fatal(err)
	}
	want = nil
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		want = append(want, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	checkIDs(t, allIDs, want)
}

func TestJoinWaitRechecksStateTimeAndSession(t *testing.T) {
	for _, change := range []string{"start", "unpublish", "block", "reset"} {
		t.Run(change, func(t *testing.T) {
			f := newFixture(t, false)
			f.seed(t)
			session := f.login(t, "alex")
			event := idFor(t, f, "Шахматы в парке")
			actor := f.account(t, "alex")
			tx, err := f.pool.Begin(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			pattern := "%FROM events e LEFT JOIN organizations%"
			switch change {
			case "reset":
				_, err = tx.Exec(context.Background(), "SELECT id FROM demo_state WHERE id=1 FOR UPDATE")
				pattern = "%demo_state%FOR SHARE%"
			case "block":
				_, err = tx.Exec(context.Background(), "SELECT id FROM accounts WHERE id=$1 FOR UPDATE", actor)
				pattern = "%accounts%FOR SHARE%"
			default:
				_, err = tx.Exec(context.Background(), "SELECT id FROM events WHERE id=$1 FOR UPDATE", event)
			}
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() { done <- f.call("POST", "/events/"+event+"/participations", nil, session) }()
			waitLock(t, f, pattern)
			switch change {
			case "start":
				start := time.Unix(0, f.now.Load()).Add(time.Millisecond)
				_, err = tx.Exec(context.Background(), "UPDATE events SET starts_at=$2 WHERE id=$1", event, start)
				f.now.Store(start.UnixNano())
			case "unpublish":
				_, err = tx.Exec(context.Background(), "UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=$2,unpublish_reason='Wait fixture' WHERE id=$1", event, f.account(t, "marina"))
			case "block":
				_, err = tx.Exec(context.Background(), "UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=$2 WHERE id=$1", actor, f.account(t, "marina"))
			case "reset":
				_, err = tx.Exec(context.Background(), "DELETE FROM sessions WHERE account_id=$1", actor)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = tx.Commit(context.Background()); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "start":
				code(t, <-done, 409, "EVENT_STARTED")
			case "unpublish":
				code(t, <-done, 404, "NOT_FOUND")
			case "block":
				code(t, <-done, 403, "ACCOUNT_BLOCKED")
			case "reset":
				code(t, <-done, 401, "SESSION_EXPIRED")
			}
			if scalar[int](t, f, "SELECT count(*) FROM participations WHERE event_id=$1 AND account_id=$2", event, actor) != 0 {
				t.Fatal("join survived invalidation")
			}
		})
	}
}
