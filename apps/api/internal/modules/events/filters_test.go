package events

import (
	"bytes"
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/google/uuid"
)

func TestScopeAndSignedCursor(t *testing.T) {
	catalog, _ := avatarpresets.Read(strings.NewReader(`{"items":[]}`))
	service, err := New(accounts.New(catalog), bytes.Repeat([]byte{1}, 32), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 7, 18, 0, 0, 123456000, time.UTC)
	id := uuid.New()
	f, limit, err := parseFilters(url.Values{"q": {"  БЕГ\u00a0ВМЕСТЕ "}, "from": {"2026-11-07T21:00:00+03:00"}, "dateFrom": {"2026-11-07"}})
	if err != nil || f.Query != "бег вместе" || f.From != "2026-11-07T18:00:00Z" || limit != 20 {
		t.Fatalf("filter normalization: %+v %v", f, err)
	}
	sc := scope("listEvents", "", f)
	raw := service.encodeCursor(sc, at, id)
	decoded, err := service.decodeCursor(raw, sc)
	if err != nil || !decoded.Time.Equal(at) || decoded.ID != id {
		t.Fatalf("cursor: %+v %v", decoded, err)
	}
	second, _ := New(accounts.New(catalog), bytes.Repeat([]byte{1}, 32), time.Now)
	if _, err = second.decodeCursor(raw, sc); err != nil {
		t.Fatal("cursor lost on service restart")
	}
	other, _ := New(accounts.New(catalog), bytes.Repeat([]byte{2}, 32), time.Now)
	if _, err = other.decodeCursor(raw, sc); err == nil {
		t.Fatal("wrong secret accepted")
	}
	for _, value := range []string{"", "bad", raw + "=", raw + ".x", strings.Repeat("x", 2049), strings.Replace(raw, ".", "A.", 1), base64.RawURLEncoding.EncodeToString([]byte(`{}`)) + "." + strings.Split(raw, ".")[1]} {
		if _, err := service.decodeCursor(value, sc); err == nil {
			t.Fatal("invalid cursor accepted")
		}
	}
	for _, changed := range []string{scope("listMyEvents", "", f), scope("listEvents", "someone", f), scope("listEvents", "", filters{})} {
		if _, err := service.decodeCursor(raw, changed); err == nil {
			t.Fatal("scope mismatch accepted")
		}
	}
}
func TestFilterRangesAndCapabilities(t *testing.T) {
	for _, q := range []url.Values{
		{"dateFrom": {"2026-02-29"}}, {"dateTo": {"2026-11-31"}}, {"dateFrom": {""}}, {"dateFrom": {"0000-01-01"}},
		{"dateFrom": {"2026-11-08"}, "dateTo": {"2026-11-07"}}, {"dateFrom": {"2026-11-07"}, "dateTo": {"2026-11-07"}},
		{"from": {"2026-11-07T18:00:00Z"}, "to": {"2026-11-07T21:00:00+03:00"}}, {"limit": {"0"}}, {"limit": {"101"}}, {"limit": {""}},
		{"activityTypeId": {""}}, {"joinMode": {""}}, {"organizationId": {uuid.NewString()}, "organizerAccountId": {uuid.NewString()}},
	} {
		if _, _, err := parseFilters(q); err == nil {
			t.Fatalf("accepted %v", q)
		}
	}
	start := time.Now()
	for _, auth := range []bool{false, true} {
		for _, owner := range []bool{false, true} {
			for _, participating := range []bool{false, true} {
				c := capabilities(start, start, auth, owner, participating)
				if c.CanJoin || c.CanDecideParticipations || c.JoinBlockedReason == nil || *c.JoinBlockedReason != "EVENT_STARTED" || c.CanManageParticipants != owner || c.CanPostMessage != auth || c.CanSetCover != owner {
					t.Fatalf("start boundary: %+v", c)
				}
			}
		}
	}
}

func TestSubMicrosecondAbsoluteBounds(t *testing.T) {
	boundary := nullableTime("2026-11-07T18:00:00.000000001Z")
	if !boundary.Valid || boundary.Time.Nanosecond() != 1000 {
		t.Fatalf("boundary lost precision: %v", boundary)
	}
}
