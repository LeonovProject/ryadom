package events_test

import (
	"bytes"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts/avatar"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/svg"
)

const mediaSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>`

func mediaFixture(t *testing.T) *fixture {
	t.Helper()
	f := accountModerationFixture(t)
	catalog, err := avatarpresets.Read(strings.NewReader(`{"items":[{"id":"ryadom-companion","label":"Спутник","imageUrl":"/assets/avatars/presets/ryadom-companion.svg"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	s, err := avatar.New(f.accountService, catalog, bytes.Repeat([]byte{7}, 32), func() time.Time { return time.Unix(f.now.Load(), 0).UTC() })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Register(f.server); err != nil {
		t.Fatal(err)
	}
	return f
}
func avatarUpload(f *fixture, document string, rev int, session string) *httptest.ResponseRecorder {
	return f.call("PUT", "/me/avatar", map[string]any{"svg": document, "expectedRevision": rev}, session)
}
func avatarModerate(f *fixture, id, decision string, rev int, session string) *httptest.ResponseRecorder {
	return f.call("POST", "/admin/accounts/"+id+"/avatar/moderation", map[string]any{"decision": decision, "expectedRevision": rev}, session)
}
func assertSVG(t *testing.T, r *httptest.ResponseRecorder, document string) {
	t.Helper()
	code(t, r, 200, "")
	normalized, err := svg.Normalize(document)
	if err != nil {
		t.Fatal(err)
	}
	if r.Body.String() != normalized || r.Header().Get("Content-Type") != "image/svg+xml" || r.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(r.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("unsafe/encoded image: %v %s", r.Header(), r.Body.String())
	}
}
func TestMediaAvatarLifecycleAndPrivacy(t *testing.T) {
	f := mediaFixture(t)
	user, admin, reader := f.login(t, "anna"), f.login(t, "marina"), f.login(t, "alex")
	id := f.account(t, "anna")
	path := "/admin/accounts/" + id + "/avatar"
	initial := object(t, f.call("GET", "/me/avatar", nil, user))
	rev := int(initial["revision"].(float64))
	code(t, f.call("GET", "/me/avatar", nil, ""), 401, "AUTH_REQUIRED")
	code(t, f.call("GET", path, nil, reader), 403, "FORBIDDEN")
	r := avatarUpload(f, mediaSVG, rev, user)
	validResponse(t, r, "AvatarState")
	pending := object(t, r)
	rev++
	if pending["source"] != "CUSTOM" || pending["status"] != "PENDING" || pending["revision"] != float64(rev) || pending["presetId"] != nil || pending["reviewedAt"] != nil {
		t.Fatal(pending)
	}
	if repeated := object(t, avatarUpload(f, mediaSVG, 0, user)); repeated["revision"] != float64(rev) || repeated["updatedAt"] != pending["updatedAt"] {
		t.Fatal("pending retry changed revision")
	}
	assertSVG(t, f.call("GET", strings.TrimPrefix(pending["previewUrl"].(string), "/api/v1"), nil, user), mediaSVG)
	code(t, f.call("GET", "/me/avatar/image?revision="+strings.TrimPrefix(pending["previewUrl"].(string), "/api/v1/me/avatar/image?revision="), nil, ""), 401, "AUTH_REQUIRED")
	publicURL := "/accounts/" + id + "/avatar?revision="
	code(t, f.call("GET", publicURL+"999", nil, user), 404, "NOT_FOUND")
	if object(t, f.call("GET", "/accounts/"+id, nil, ""))["avatarUrl"] != nil {
		t.Fatal("pending leaked")
	}
	r = avatarModerate(f, id, "APPROVE", rev, admin)
	validResponse(t, r, "AdminAvatar")
	approved := object(t, r)
	rev++
	if approved["status"] != "APPROVED" || approved["reviewedBy"] != f.account(t, "marina") {
		t.Fatal(approved)
	}
	published := object(t, f.call("GET", "/accounts/"+id, nil, ""))["avatarUrl"].(string)
	assertSVG(t, f.call("GET", strings.TrimPrefix(published, "/api/v1"), nil, "invalid-cookie-ignored"), mediaSVG)
	code(t, f.call("GET", strings.TrimPrefix(pending["previewUrl"].(string), "/api/v1"), nil, user), 404, "NOT_FOUND")
	if object(t, avatarModerate(f, id, "APPROVE", rev-1, admin))["revision"] != float64(rev) {
		t.Fatal("moderation retry")
	}
	code(t, avatarUpload(f, mediaSVG, rev-1, user), 409, "AVATAR_CHANGED")
	object(t, avatarModerate(f, id, "HIDE", rev, admin))
	rev++
	code(t, f.call("GET", strings.TrimPrefix(published, "/api/v1"), nil, admin), 404, "NOT_FOUND")
	code(t, avatarModerate(f, id, "APPROVE", rev-2, admin), 409, "AVATAR_CHANGED")
	current := object(t, f.call("GET", "/me/avatar", nil, user))
	assertSVG(t, f.call("GET", strings.TrimPrefix(current["previewUrl"].(string), "/api/v1"), nil, user), mediaSVG)
	object(t, avatarUpload(f, strings.Replace(mediaSVG, "#fff", "#000", 1), rev, user))
	rev++
	code(t, avatarModerate(f, id, "APPROVE", rev-2, admin), 409, "AVATAR_CHANGED")
	preset := map[string]any{"presetId": "ryadom-companion", "expectedRevision": rev}
	r = f.call("PUT", "/me/avatar/preset", preset, user)
	validResponse(t, r, "AvatarState")
	selected := object(t, r)
	rev++
	if selected["source"] != "PRESET" || selected["status"] != "APPROVED" || selected["uploadedAt"] != nil || selected["revision"] != float64(rev) {
		t.Fatal(selected)
	}
	code(t, f.call("GET", path, nil, admin), 404, "NOT_FOUND")
	code(t, avatarModerate(f, id, "HIDE", rev-1, admin), 404, "NOT_FOUND")
	if object(t, f.call("PUT", "/me/avatar/preset", preset, user))["revision"] != float64(rev) {
		t.Fatal("preset retry")
	}
	code(t, f.call("PUT", "/me/avatar/preset", map[string]any{"presetId": "unknown", "expectedRevision": rev}, user), 422, "VALIDATION_ERROR")
	code(t, f.call("DELETE", "/me/avatar", map[string]any{"expectedRevision": rev - 1}, user), 409, "AVATAR_CHANGED")
	r = f.call("DELETE", "/me/avatar", map[string]any{"expectedRevision": rev}, user)
	validResponse(t, r, "AvatarState")
	empty := object(t, r)
	rev++
	if empty["source"] != "NONE" || empty["status"] != "EMPTY" || empty["revision"] != float64(rev) || empty["previewUrl"] != nil {
		t.Fatal(empty)
	}
	if object(t, f.call("DELETE", "/me/avatar", map[string]any{"expectedRevision": 0}, user))["revision"] != float64(rev) {
		t.Fatal("empty retry")
	}
}
func TestMediaAvatarLimitsAtomicityAndConcurrency(t *testing.T) {
	f := mediaFixture(t)
	user, admin := f.login(t, "anna"), f.login(t, "marina")
	id := f.account(t, "anna")
	rev := int(object(t, f.call("GET", "/me/avatar", nil, user))["revision"].(float64))
	boundary := mediaSVG + strings.Repeat(" ", svg.MaxBytes-len(mediaSVG))
	object(t, avatarUpload(f, boundary, rev, user))
	rev++
	snapshot := func() string {
		return scalar[string](t, f, "SELECT row_to_json(v)::text FROM account_avatars v WHERE account_id=$1", id)
	}
	before := snapshot()
	for _, bad := range []string{`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"/>`, `<!DOCTYPE svg [<!ENTITY bad SYSTEM "file:///etc/passwd">]>` + mediaSVG} {
		code(t, avatarUpload(f, bad, rev, user), 422, "VALIDATION_ERROR")
	}
	code(t, avatarUpload(f, boundary+" ", rev, user), 413, "PAYLOAD_TOO_LARGE")
	unicode := strings.Replace(mediaSVG, "<rect", "<!--"+strings.Repeat("я", svg.MaxBytes/2)+"--><rect", 1)
	code(t, avatarUpload(f, unicode, rev, user), 413, "PAYLOAD_TOO_LARGE")
	code(t, avatarUpload(f, strings.Repeat(" ", 1048576), rev, user), 413, "PAYLOAD_TOO_LARGE")
	if snapshot() != before {
		t.Fatal("rejected upload changed state")
	}
	execute(t, f, `CREATE FUNCTION reject_media_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`)
	execute(t, f, `CREATE CONSTRAINT TRIGGER reject_media_commit AFTER UPDATE ON account_avatars DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_media_commit()`)
	code(t, avatarUpload(f, strings.Replace(mediaSVG, "#fff", "#123", 1), rev, user), 500, "INTERNAL_ERROR")
	if snapshot() != before {
		t.Fatal("failed commit published success/partial avatar")
	}
	execute(t, f, "DROP TRIGGER reject_media_commit ON account_avatars")
	results := make(chan *httptest.ResponseRecorder, 2)
	for _, color := range []string{"#456", "#789"} {
		go func(c string) { results <- avatarUpload(f, strings.Replace(mediaSVG, "#fff", c, 1), rev, user) }(color)
	}
	a, b := <-results, <-results
	if !((a.Code == 200 && b.Code == 409) || (a.Code == 409 && b.Code == 200)) {
		t.Fatalf("concurrent replacement %d/%d", a.Code, b.Code)
	}
	rev++
	object(t, accountStatus(f, id, "BLOCKED", 1, admin))
	code(t, avatarUpload(f, mediaSVG, rev, user), 403, "ACCOUNT_BLOCKED")
	object(t, avatarModerate(f, id, "HIDE", rev, admin)) // Blocked content remains reviewable.
}
func TestMediaAvatarQueueAndRemovedPreset(t *testing.T) {
	f := mediaFixture(t)
	admin := f.login(t, "marina")
	anna := f.login(t, "anna")
	alex := f.login(t, "alex")
	for _, session := range []string{anna, alex} {
		v := object(t, f.call("GET", "/me/avatar", nil, session))
		object(t, avatarUpload(f, mediaSVG, int(v["revision"].(float64)), session))
	}
	page := f.call("GET", "/admin/avatars?status=PENDING&limit=1", nil, admin)
	validResponse(t, page, "AdminAvatarPage")
	first, c := items(t, page)
	if len(first) != 1 || c == nil {
		t.Fatal("queue pagination")
	}
	second, end := items(t, f.call("GET", "/admin/avatars?status=PENDING&limit=9&cursor="+url.QueryEscape(*c), nil, admin))
	if len(second) != 1 || end != nil || second[0].(map[string]any)["account"].(map[string]any)["id"] == first[0].(map[string]any)["account"].(map[string]any)["id"] {
		t.Fatal("queue duplicate/loss")
	}
	code(t, f.call("GET", "/admin/avatars?status=HIDDEN&cursor="+url.QueryEscape(*c), nil, admin), 400, "INVALID_CURSOR")
	found, _ := items(t, f.call("GET", "/admin/avatars?status=PENDING&limit=1&q="+url.QueryEscape("  АННА  "), nil, admin))
	if len(found) != 1 || found[0].(map[string]any)["account"].(map[string]any)["id"] != f.account(t, "anna") {
		t.Fatal("filter before limit")
	}
	removed, _ := f.register(t, "media-removed@example.test")
	execute(t, f, `UPDATE account_avatars SET preset_id='removed-preset' WHERE account_id=(SELECT id FROM accounts WHERE email='media-removed@example.test')`)
	state := object(t, f.call("GET", "/me/avatar", nil, removed))
	if state["presetId"] != "removed-preset" || state["previewUrl"] != nil || state["revision"] != float64(1) {
		t.Fatal("removed preset mutated")
	}
}
