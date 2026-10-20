package participation

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type cursor struct {
	Version                                 int `json:"v"`
	Route, Account, Event, Statuses, Window string
	Reference                               *time.Time `json:"reference"`
	Time                                    time.Time  `json:"t"`
	ID                                      uuid.UUID  `json:"id"`
}

func invalidRequest() error {
	return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректные фильтры.")
}
func invalidCursor() error {
	return fault.New(400, openapi.ErrorCodeINVALIDCURSOR, "Курсор не соответствует списку. Начните с первой страницы.")
}
func validTime(t time.Time) bool { return !t.IsZero() && t.Year() >= 1 && t.Year() <= 9999 }
func (s *Service) encode(c cursor) string {
	c.Version = 1
	c.Time = c.Time.UTC()
	data, _ := json.Marshal(c)
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) decode(raw string) (cursor, error) {
	var c cursor
	if len(raw) == 0 || len(raw) > 2048 {
		return c, invalidCursor()
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return c, invalidCursor()
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil {
		return c, invalidCursor()
	}
	sig, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return c, invalidCursor()
	}
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write(data)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return c, invalidCursor()
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&c) != nil || decoder.Decode(new(any)) != io.EOF || c.Version != 1 || !validTime(c.Time) || c.ID == uuid.Nil || (c.Reference != nil && !validTime(*c.Reference)) {
		return cursor{}, invalidCursor()
	}
	return c, nil
}
func (s *Service) page(q url.Values, route, account, event string) (cursor, int, []string, error) {
	c := cursor{Route: route, Account: account, Event: event, Window: q.Get("eventWindow")}
	limit := 20
	if _, ok := q["limit"]; ok {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil || n < 1 || n > 100 {
			return c, 0, nil, invalidRequest()
		}
		limit = n
	}
	statuses := []string{}
	if _, ok := q["status"]; ok {
		statuses = strings.Split(q.Get("status"), ",")
		seen := map[string]bool{}
		for _, status := range statuses {
			if seen[status] || (status != "PENDING" && status != "CONFIRMED" && status != "REJECTED") {
				return c, 0, nil, invalidRequest()
			}
			seen[status] = true
		}
		sort.Strings(statuses)
	}
	c.Statuses = strings.Join(statuses, ",")
	_, windowPresent := q["eventWindow"]
	if windowPresent && c.Window != "UPCOMING" && c.Window != "STARTED_TODAY" && c.Window != "STARTED" {
		return c, 0, nil, invalidRequest()
	}
	if values, ok := q["referenceTime"]; ok {
		if c.Window == "" {
			return c, 0, nil, invalidRequest()
		}
		t, err := time.Parse(time.RFC3339Nano, values[0])
		if err != nil || !validTime(t.UTC()) {
			return c, 0, nil, invalidRequest()
		}
		t = t.UTC()
		c.Reference = &t
	}
	if values, ok := q["cursor"]; ok {
		stored, err := s.decode(values[0])
		if err != nil {
			return c, 0, nil, err
		}
		if stored.Route != c.Route || stored.Account != c.Account || stored.Event != c.Event || stored.Statuses != c.Statuses || stored.Window != c.Window || (stored.Reference == nil) != (c.Window == "") {
			return c, 0, nil, invalidCursor()
		}
		if c.Reference != nil && !c.Reference.Equal(*stored.Reference) {
			return c, 0, nil, invalidCursor()
		}
		c = stored
	} else if c.Window != "" && c.Reference == nil {
		at := s.clock().UTC()
		c.Reference = &at
	}
	return c, limit, statuses, nil
}
func (c cursor) key() (pgtype.Timestamptz, pgtype.UUID) {
	if c.ID == uuid.Nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}
	}
	return pgtype.Timestamptz{Time: c.Time, Valid: true}, pgtype.UUID{Bytes: c.ID, Valid: true}
}
