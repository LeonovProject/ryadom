package discussion_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
)

func (f *fixture) login(t *testing.T, name string) string {
	t.Helper()
	cap := map[string]string{"anna": "Anna", "alex": "Alex", "marina": "Marina"}[name]
	r := f.call("POST", "/auth/login", map[string]string{"email": name + "@example.test", "password": "Ryadom-" + cap + "-2026!"}, "")
	code(t, r, 200, "")
	return token(t, r)
}
func object(t *testing.T, r *httptest.ResponseRecorder, status int, schema string) map[string]any {
	t.Helper()
	code(t, r, status, "")
	var value map[string]any
	if err := json.Unmarshal(r.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	if schema != "" {
		spec, err := openapi.GetSwagger()
		if err != nil {
			t.Fatal(err)
		}
		if err = spec.Components.Schemas[schema].Value.VisitJSON(value); err != nil {
			t.Fatalf("invalid %s: %v", schema, err)
		}
	}
	return value
}
func eventID(t *testing.T, f *fixture, title string) string {
	return scalar[string](t, f, "SELECT id::text FROM events WHERE title=$1", title)
}
func hide(f *fixture, id string, revision int, session string) *httptest.ResponseRecorder {
	return f.call("POST", "/admin/messages/"+id+"/hide", map[string]any{"expectedRevision": revision}, session)
}
func entries(t *testing.T, r *httptest.ResponseRecorder, schema string) ([]any, *string) {
	value := object(t, r, 200, schema)
	var next *string
	if value["nextCursor"] != nil {
		v := value["nextCursor"].(string)
		next = &v
	}
	return value["items"].([]any), next
}
func TestDiscussionAndAtomicModerationS5A3(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	alex := f.login(t, "alex")
	admin := f.login(t, "marina")
	event := eventID(t, f, "Шахматы в парке")
	path := "/events/" + event + "/messages"
	if scalar[int](t, f, "SELECT count(*) FROM participations p JOIN accounts a ON a.id=p.account_id WHERE event_id=$1 AND a.email='alex@example.test'", event) != 0 {
		t.Fatal("fixture must have no participation")
	}
	// A started published meeting still permits questions and replies.
	execute(t, f, "UPDATE events SET starts_at='2026-10-19T00:00:00Z' WHERE id=$1", event)
	question := object(t, f.call("POST", path, map[string]any{"body": "  Нужен ли свой инвентарь?  "}, alex), 201, "VisibleMessage")
	if question["authorIsOrganizer"] != false || question["body"] != "Нужен ли свой инвентарь?" {
		t.Fatal(question)
	}
	reply := object(t, f.call("POST", path, map[string]any{"body": "<b>Можно без инвентаря</b>"}, owner), 201, "VisibleMessage")
	if reply["authorIsOrganizer"] != true {
		t.Fatal(reply)
	}
	for _, body := range []map[string]any{{"body": " \n\t"}, {"body": "text", "authorIsOrganizer": true}, {"body": "bad\x00text"}, {"body": strings.Repeat("я", 4001)}} {
		code(t, f.call("POST", path, body, alex), 422, "VALIDATION_ERROR")
	}
	code(t, f.call("POST", path, map[string]any{"body": "Гость"}, ""), 401, "AUTH_REQUIRED")
	target := scalar[string](t, f, "SELECT m.id::text FROM messages m JOIN reports r ON r.target_message_id=m.id WHERE m.event_id=$1 AND r.status='OPEN' LIMIT 1", event)
	code(t, hide(f, target, 0, alex), 403, "FORBIDDEN")
	filtered := object(t, f.call("GET", "/admin/events/"+event+"/messages?hasOpenReports=true&limit=1", nil, admin), 200, "AdminMessagePage")
	before := filtered["items"].([]any)[0].(map[string]any)
	if before["id"] != target || before["openReportsCount"].(float64) < 1 {
		t.Fatal("real report filter/count")
	}
	direct := scalar[int](t, f, "SELECT count(*) FROM reports WHERE target_event_id=$1 AND status='OPEN'", event)
	hidden := object(t, hide(f, target, int(before["moderationRevision"].(float64)), admin), 200, "AdminMessage")
	if hidden["status"] != "HIDDEN" || hidden["openReportsCount"] != float64(0) || hidden["reportsRevision"] != before["reportsRevision"].(float64)+1 {
		t.Fatal(hidden)
	}
	if hidden["moderationRevision"] != before["moderationRevision"].(float64)+1 || hidden["hiddenAt"] == nil || hidden["hiddenBy"] == nil {
		t.Fatal(hidden)
	}
	if scalar[int](t, f, "SELECT count(*) FROM reports WHERE target_event_id=$1 AND status='OPEN'", event) != direct {
		t.Fatal("direct reports changed")
	}
	snapshot := scalar[string](t, f, "SELECT row_to_json(m)::text FROM messages m WHERE id=$1", target)
	object(t, hide(f, target, 0, admin), 200, "AdminMessage")
	if scalar[string](t, f, "SELECT row_to_json(m)::text FROM messages m WHERE id=$1", target) != snapshot {
		t.Fatal("repeat changed moderation")
	}
	for _, session := range []string{"", owner, alex, admin} {
		list, _ := entries(t, f.call("GET", path+"?limit=100", nil, session), "MessagePage")
		found := false
		for _, raw := range list {
			m := raw.(map[string]any)
			if m["status"] == "HIDDEN" {
				if _, ok := m["body"]; ok {
					t.Fatal("hidden body leaked")
				}
			}
			if m["id"] == target {
				found = true
			}
		}
		if !found {
			t.Fatal("hidden placeholder missing")
		}
	}
	code(t, hide(f, reply["id"].(string), 99, admin), 409, "MESSAGE_CHANGED")
	empty, _ := entries(t, f.call("GET", "/admin/events/"+event+"/messages?hasOpenReports=true", nil, admin), "AdminMessagePage")
	if len(empty) != 0 {
		t.Fatal("closed reports retained in filter")
	}
	// Future restore preserves history; an old hide must not undo it.
	execute(t, f, "UPDATE messages SET status='VISIBLE',restored_at=now(),restored_by=hidden_by,moderation_revision=moderation_revision+1 WHERE id=$1", target)
	code(t, hide(f, target, 0, admin), 409, "MESSAGE_CHANGED")
	restored := scalar[string](t, f, "SELECT restored_at::text FROM messages WHERE id=$1", target)
	object(t, hide(f, target, int(hidden["moderationRevision"].(float64))+1, admin), 200, "AdminMessage")
	if scalar[string](t, f, "SELECT restored_at::text FROM messages WHERE id=$1", target) != restored {
		t.Fatal("restoration history erased")
	}
	// A deferred failure must roll back both message and report transitions.
	execute(t, f, `CREATE FUNCTION reject_report_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_report AFTER UPDATE ON reports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_report_commit()`)
	execute(t, f, "INSERT INTO reports(reporter_account_id,target_type,target_message_id) SELECT id,'MESSAGE',$1 FROM accounts WHERE email='alex@example.test'", reply["id"])
	code(t, hide(f, reply["id"].(string), 0, admin), 500, "INTERNAL_ERROR")
	if scalar[string](t, f, "SELECT status FROM messages WHERE id=$1", reply["id"]) != "VISIBLE" || scalar[int](t, f, "SELECT count(*) FROM reports WHERE target_message_id=$1 AND status='OPEN'", reply["id"]) != 1 {
		t.Fatal("partial failed commit")
	}
	execute(t, f, "DROP TRIGGER reject_report ON reports")
	execute(t, f, "UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=(SELECT id FROM accounts WHERE email='marina@example.test'),unpublish_reason='Fixture' WHERE id=$1", event)
	for _, session := range []string{"", owner, admin} {
		code(t, f.call("GET", path, nil, session), 404, "NOT_FOUND")
	}
	code(t, f.call("POST", path, map[string]any{"body": "Поздний вопрос"}, owner), 409, "EVENT_UNAVAILABLE")
	code(t, f.call("POST", path, map[string]any{"body": "Чужой вопрос"}, alex), 404, "NOT_FOUND")
	object(t, hide(f, reply["id"].(string), 0, admin), 200, "AdminMessage")
	object(t, f.call("GET", "/admin/events/"+event+"/messages", nil, admin), 200, "AdminMessagePage")
}
func TestMessagePaginationDirectionsAndScopes(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	admin := f.login(t, "marina")
	event := eventID(t, f, "Ближайший подтверждённый план")
	path := "/events/" + event + "/messages"
	execute(t, f, "INSERT INTO messages(event_id,author_account_id,body,created_at) SELECT $1,(SELECT id FROM accounts WHERE email='alex@example.test'),'message '||n,'2026-10-19T10:00:00Z' FROM generate_series(1,26) n", event)
	for _, order := range []string{"OLDEST_FIRST", "NEWEST_FIRST"} {
		q := url.Values{"order": {order}, "limit": {"5"}}
		var got []string
		var firstCursor string
		for i := 0; i < 10; i++ {
			list, c := entries(t, f.call("GET", path+"?"+q.Encode(), nil, ""), "MessagePage")
			for _, v := range list {
				got = append(got, v.(map[string]any)["id"].(string))
			}
			if c == nil {
				break
			}
			if firstCursor == "" {
				firstCursor = *c
			}
			q.Set("cursor", *c)
		}
		direction := "ASC"
		if order == "NEWEST_FIRST" {
			direction = "DESC"
		}
		rows, err := f.pool.Query(context.Background(), "SELECT id::text FROM messages WHERE event_id=$1 ORDER BY created_at "+direction+",id "+direction, event)
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
		if len(got) != 26 || strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatal("unstable message ordering")
		}
		changed := "NEWEST_FIRST"
		if order == "NEWEST_FIRST" {
			changed = "OLDEST_FIRST"
		}
		code(t, f.call("GET", path+"?order="+changed+"&cursor="+url.QueryEscape(firstCursor), nil, ""), 400, "INVALID_CURSOR")
		if order == "NEWEST_FIRST" {
			object(t, f.call("POST", path, map[string]any{"body": "Новый хвост"}, owner), 201, "VisibleMessage")
			next, _ := entries(t, f.call("GET", path+"?order=NEWEST_FIRST&cursor="+url.QueryEscape(firstCursor), nil, ""), "MessagePage")
			if next[0].(map[string]any)["id"] != got[5] {
				t.Fatal("new tail changed older page")
			}
		}
	}
	defaults, _ := entries(t, f.call("GET", path+"?limit=1", nil, ""), "MessagePage")
	explicit, _ := entries(t, f.call("GET", path+"?limit=1&order=OLDEST_FIRST", nil, ""), "MessagePage")
	if defaults[0].(map[string]any)["id"] != explicit[0].(map[string]any)["id"] {
		t.Fatal("default order")
	}
	_, cursor := entries(t, f.call("GET", "/admin/events/"+event+"/messages?limit=1", nil, admin), "AdminMessagePage")
	code(t, f.call("GET", "/admin/events/"+event+"/messages?hasOpenReports=false&cursor="+url.QueryEscape(*cursor), nil, admin), 400, "INVALID_CURSOR")
	code(t, f.call("GET", path+"?cursor="+url.QueryEscape(*cursor), nil, ""), 400, "INVALID_CURSOR")
	code(t, f.call("GET", path+"?cursor=bad.signature", nil, ""), 400, "INVALID_CURSOR")
}
func TestCreateWaitsForUnpublication(t *testing.T) {
	f := newFixture(t, false)
	f.seed(t)
	owner := f.login(t, "anna")
	admin := f.login(t, "marina")
	event := eventID(t, f, "Шахматы в парке")
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM events WHERE id=$1 FOR UPDATE", event); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- f.call("POST", "/events/"+event+"/messages", map[string]any{"body": "Wait fixture"}, owner)
	}()
	waitLock(t, f, "%FROM events e LEFT JOIN organizations%")
	if _, err = tx.Exec(context.Background(), "UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=(SELECT id FROM accounts WHERE email='marina@example.test'),unpublish_reason='Wait fixture' WHERE id=$1", event); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-done, 409, "EVENT_UNAVAILABLE")
	if scalar[int](t, f, "SELECT count(*) FROM messages WHERE event_id=$1 AND body='Wait fixture'", event) != 0 {
		t.Fatal("message crossed unpublication")
	}
	// Two hide calls serialize to the same transition and revision.
	target := scalar[string](t, f, "SELECT id::text FROM messages WHERE event_id=$1 AND status='VISIBLE' LIMIT 1", event)
	revision := scalar[int](t, f, "SELECT moderation_revision FROM messages WHERE id=$1", target)
	for i := 0; i < 2; i++ {
		go func() { done <- hide(f, target, revision, admin) }()
	}
	a := object(t, <-done, 200, "AdminMessage")
	b := object(t, <-done, 200, "AdminMessage")
	if a["moderationRevision"] != float64(revision+1) || a["hiddenAt"] != b["hiddenAt"] {
		t.Fatal("concurrent duplicate transition")
	}
}
