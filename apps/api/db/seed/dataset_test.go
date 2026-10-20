package seed

import (
	"testing"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/google/uuid"
)

func TestDatasetAccountsAndRelativeDates(t *testing.T) {
	now := time.Date(2026, 10, 20, 18, 30, 0, 0, time.UTC) // 21 October locally.
	d, err := build(now, "ryadom-companion")
	if err != nil {
		t.Fatal(err)
	}
	if d.baseDate != "2026-10-21" {
		t.Fatal("base date used host/UTC timezone", d.baseDate)
	}
	if len(d.accounts) != 6 || len(d.organizations) != 5 || len(d.activities) != 7 || len(d.events) != 16 || len(d.participations) != 13 || len(d.messages) != 7 || len(d.reports) != 7 {
		t.Fatal("incomplete seed")
	}
	credentials := map[string]string{"alex": "Ryadom-Alex-2026!", "anna": "Ryadom-Anna-2026!", "marina": "Ryadom-Marina-2026!", "blocked": "Ryadom-Blocked-2026!", "ivan": "Ryadom-Ivan-2026!", "dasha": "Ryadom-Dasha-2026!"}
	ids := map[uuid.UUID]bool{}
	for _, a := range d.accounts {
		if a.id == uuid.Nil || ids[a.id] {
			t.Fatal("invalid/duplicate ID")
		}
		ids[a.id] = true
		if ok, err := authn.VerifyPassword(credentials[a.key], a.passwordHash); err != nil || !ok {
			t.Fatal("demonstration credential not usable", a.key, err)
		}
		if a.key == "marina" && (a.role != "ADMIN" || a.status != "ACTIVE") {
			t.Fatal("admin access unavailable")
		}
		if (a.key == "anna" || a.key == "alex") && a.status != "ACTIVE" {
			t.Fatal("primary account blocked")
		}
	}
	zone, _ := time.LoadLocation("Asia/Krasnoyarsk")
	for _, e := range d.events {
		switch e.key {
		case "today":
			if e.starts.After(now) || e.starts.In(zone).Format("2006-01-02") != d.baseDate {
				t.Fatal("today fixture not started locally")
			}
		case "yesterday":
			if !e.starts.Before(now) || e.starts.In(zone).Format("2006-01-02") == d.baseDate {
				t.Fatal("yesterday fixture in today's block")
			}
		default:
			if !e.starts.After(now) {
				t.Fatal("future demo meeting already started", e.key)
			}
		}
	}
	// Different loads have fresh IDs and independently salted credential hashes.
	next, err := build(now.AddDate(0, 0, 1), "ryadom-companion")
	if err != nil {
		t.Fatal(err)
	}
	if next.baseDate != "2026-10-22" {
		t.Fatal(next.baseDate)
	}
	for i, a := range next.accounts {
		if ids[a.id] || a.passwordHash == d.accounts[i].passwordHash {
			t.Fatal("old ID or salt reused")
		}
	}
}

func TestDatasetInvalidOptionsAndEmptyCatalog(t *testing.T) {
	for _, item := range []struct {
		now    time.Time
		preset string
	}{
		{time.Time{}, "ryadom-companion"}, {time.Date(1999, 1, 1, 0, 0, 0, 0, time.UTC), ""}, {time.Now(), "https://external.test/a.svg"},
	} {
		if _, err := build(item.now, item.preset); err == nil {
			t.Fatal("invalid seed options accepted")
		}
	}
	d, err := build(time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC), "")
	if err != nil || d.presetID != "" {
		t.Fatal("empty catalogue invented an avatar", err)
	}
}
