package events_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/modules/events/cover"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/svg"
)

func coverFixture(t *testing.T) *fixture {
	t.Helper()
	f := mediaFixture(t)
	if err := cover.Register(f.server, func() time.Time { return time.Unix(f.now.Load(), 0).UTC() }); err != nil {
		t.Fatal(err)
	}
	return f
}
func TestMediaCoverVisibilityAndValidation(t *testing.T) {
	f := coverFixture(t)
	owner, admin, participant := f.login(t, "anna"), f.login(t, "marina"), f.login(t, "alex")
	stranger, _ := f.register(t, "media-cover-stranger@example.test")
	id := f.event(t, "Футбол во дворе")
	path := "/events/" + id + "/cover"
	code(t, f.call("GET", path, nil, ""), 404, "NOT_FOUND")
	code(t, f.call("PUT", path, map[string]any{"svg": mediaSVG}, ""), 401, "AUTH_REQUIRED")
	for _, session := range []string{participant, admin} {
		code(t, f.call("PUT", path, map[string]any{"svg": mediaSVG}, session), 404, "NOT_FOUND")
		code(t, f.call("DELETE", path, nil, session), 404, "NOT_FOUND")
	}
	// An admin has reading/moderation rights, no exception to event ownership.
	r := f.call("PUT", path, map[string]any{"svg": mediaSVG}, owner)
	validResponse(t, r, "CoverSelection")
	if object(t, r)["coverUrl"] != "/api/v1"+path {
		t.Fatal("cover URL")
	}
	for _, session := range []string{"", owner, admin, stranger} {
		assertSVG(t, f.call("GET", path, nil, session), mediaSVG)
	}
	if object(t, f.call("GET", "/events/"+id, nil, ""))["coverUrl"] != "/api/v1"+path {
		t.Fatal("event cover projection")
	}
	snapshot := func() string {
		return scalar[string](t, f, "SELECT row_to_json(e)::text FROM events e WHERE id=$1", id)
	}
	before := snapshot()
	code(t, f.call("PUT", path, map[string]any{"svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script/></svg>`}, owner), 422, "VALIDATION_ERROR")
	code(t, f.call("PUT", path, map[string]any{"svg": mediaSVG + strings.Repeat(" ", svg.MaxBytes-len(mediaSVG)+1)}, owner), 413, "PAYLOAD_TOO_LARGE")
	code(t, f.call("PUT", path, map[string]any{"svg": strings.Repeat("я", svg.MaxBytes/2) + mediaSVG}, owner), 413, "PAYLOAD_TOO_LARGE")
	code(t, f.call("PUT", path, map[string]any{"svg": strings.Repeat(" ", 1048576)}, owner), 413, "PAYLOAD_TOO_LARGE")
	if snapshot() != before {
		t.Fatal("rejected cover changed event")
	}
	boundary := mediaSVG + strings.Repeat(" ", svg.MaxBytes-len(mediaSVG))
	code(t, f.call("PUT", path, map[string]any{"svg": boundary}, owner), 200, "")
	assertSVG(t, f.call("GET", path, nil, ""), mediaSVG)
	for i := 0; i < 2; i++ {
		code(t, f.call("DELETE", path, nil, owner), 204, "")
	}
	code(t, f.call("GET", path, nil, ""), 404, "NOT_FOUND")
	if object(t, f.call("GET", "/events/"+id, nil, ""))["coverUrl"] != nil {
		t.Fatal("deleted cover projected")
	}
	// Upload after start remains allowed; only join/decide has the time barrier.
	execute(t, f, "UPDATE events SET starts_at='2026-10-20T10:00:00Z' WHERE id=$1", id)
	code(t, f.call("PUT", path, map[string]any{"svg": mediaSVG}, owner), 200, "")
	code(t, f.call("POST", "/events/"+id+"/participations", nil, participant), 409, "EVENT_STARTED")
	// A prior participation grants the same limited read as getEvent after unpublication.
	execute(t, f, "UPDATE events SET starts_at='2026-10-21T10:00:00Z' WHERE id=$1", id)
	code(t, f.call("POST", "/events/"+id+"/participations", nil, participant), 201, "")
	code(t, unpublish(f, id, "Недопустимое место", admin), 200, "")
	for _, session := range []string{"", stranger} {
		code(t, f.call("GET", path, nil, session), 404, "NOT_FOUND")
	}
	for _, session := range []string{owner, admin, participant} {
		assertSVG(t, f.call("GET", path, nil, session), mediaSVG)
	}
	code(t, f.call("PUT", path, map[string]any{"svg": mediaSVG}, owner), 409, "EVENT_UNAVAILABLE")
	code(t, f.call("DELETE", path, nil, owner), 409, "EVENT_UNAVAILABLE")
	code(t, f.call("GET", path, nil, "invalid-cookie"), 401, "SESSION_EXPIRED")
}
func TestMediaCoverCommitAndUnpublicationLock(t *testing.T) {
	f := coverFixture(t)
	owner, admin := f.login(t, "anna"), f.login(t, "marina")
	id := f.event(t, "Футбол во дворе")
	path := "/events/" + id + "/cover"
	code(t, f.call("PUT", path, map[string]any{"svg": mediaSVG}, owner), 200, "")
	execute(t, f, `CREATE FUNCTION reject_cover_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_cover_commit AFTER UPDATE ON events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_cover_commit()`)
	code(t, f.call("PUT", path, map[string]any{"svg": strings.Replace(mediaSVG, "#fff", "#000", 1)}, owner), 500, "INTERNAL_ERROR")
	assertSVG(t, f.call("GET", path, nil, ""), mediaSVG)
	execute(t, f, "DROP TRIGGER reject_cover_commit ON events")
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "SELECT id FROM events WHERE id=$1 FOR UPDATE", id); err != nil {
		t.Fatal(err)
	}
	removed := make(chan *httptest.ResponseRecorder, 1)
	set := make(chan *httptest.ResponseRecorder, 1)
	go func() { removed <- unpublish(f, id, "Конкурирующее снятие", admin) }()
	waitLock(t, f, "%FROM events WHERE id=%FOR UPDATE%")
	go func() {
		set <- f.call("PUT", path, map[string]any{"svg": strings.Replace(mediaSVG, "#fff", "#123", 1)}, owner)
	}()
	waitLock(t, f, "%coalesce(o.owner_account_id,e.organizer_account_id)%FOR UPDATE OF e%")
	if err = tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	code(t, <-removed, 200, "")
	code(t, <-set, 409, "EVENT_UNAVAILABLE")
	assertSVG(t, f.call("GET", path, nil, owner), mediaSVG)
}
